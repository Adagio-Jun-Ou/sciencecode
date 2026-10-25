import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { resolveCadArtifact, verifyCadBuild } from './cad.js';
import { probeComputeRuntime, detectNvidiaGpu } from './compute.js';
import { VERSION } from './constants.js';
import { sha256File, sha256Text } from './hash.js';
import { runCommand, runCommandSync } from './process.js';
import { resolveScienceCodeHome } from './runtime.js';
import { redactText, scanSecrets } from './security.js';
import { diffSnapshots, snapshot } from './snapshot.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  relativePortable,
  resolveInsideRoot,
  writeJson,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';
import { makeRunId } from './runs.js';

export const SIMULATION_SCHEMA_VERSION = 1;

const SIMULATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PARAMETER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_PARAMETER_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const DEVICE_PATTERN = /^(?:auto|cpu|cuda(?::\d+)?)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function simulationError(message, code = 'INVALID_SIMULATION') {
  return Object.assign(new Error(message), { code });
}

export function parseSimulationParameter(value) {
  const separator = String(value).indexOf('=');
  if (separator < 1) throw simulationError('Simulation parameters must use NAME=VALUE.', 'INVALID_ARGUMENT');
  const name = String(value).slice(0, separator);
  const raw = String(value).slice(separator + 1);
  if (!PARAMETER_PATTERN.test(name) || FORBIDDEN_PARAMETER_NAMES.has(name)) {
    throw simulationError('Invalid simulation parameter name: ' + name, 'INVALID_ARGUMENT');
  }
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Plain strings are valid parameter values.
  }
  return [name, parsed];
}

function validateSimulationInput({
  project,
  script,
  seed,
  device,
  timeoutMs,
  parameters,
  scriptArgs,
  inputs,
  experiment,
  cadParent
}) {
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw simulationError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  if (!fs.statSync(script, { throwIfNoEntry: false })?.isFile()) {
    throw simulationError('Simulation script does not exist: ' + script, 'SIMULATION_SCRIPT_NOT_FOUND');
  }
  const projectReal = fs.realpathSync(project);
  if (!isPathInside(projectReal, fs.realpathSync(script))) {
    throw simulationError(
      'Simulation script resolves outside the project root.',
      'PATH_OUTSIDE_ROOT'
    );
  }
  if (path.extname(script).toLowerCase() !== '.py') {
    throw simulationError('Recorded simulations currently require a .py script.', 'INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw simulationError('Seed must be an integer from 0 through 4294967295.', 'INVALID_ARGUMENT');
  }
  if (!DEVICE_PATTERN.test(device)) {
    throw simulationError('Device must be auto, cpu, cuda, or cuda:N.', 'INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 86_400_000) {
    throw simulationError('Timeout must be between 1 and 86400 seconds.', 'INVALID_ARGUMENT');
  }
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') {
    throw simulationError('Simulation parameters must be an object.', 'INVALID_ARGUMENT');
  }
  const parameterEntries = Object.entries(parameters);
  if (parameterEntries.length > 128) {
    throw simulationError('Simulation parameters are limited to 128 named values.', 'INVALID_ARGUMENT');
  }
  for (const [name] of parameterEntries) {
    if (!PARAMETER_PATTERN.test(name) || FORBIDDEN_PARAMETER_NAMES.has(name)) {
      throw simulationError('Invalid simulation parameter name: ' + name, 'INVALID_ARGUMENT');
    }
  }
  if (!Array.isArray(scriptArgs) || scriptArgs.length > 128 ||
      scriptArgs.some((value) => typeof value !== 'string' || value.length > 4_096)) {
    throw simulationError(
      'Simulation script arguments must be an array of at most 128 strings, each at most 4096 characters.',
      'INVALID_ARGUMENT'
    );
  }
  let persistedText;
  try {
    persistedText = JSON.stringify({
      parameters,
      scriptArgs,
      experiment,
      cad_parent: cadParent
    });
  } catch {
    throw simulationError('Simulation parameters must be JSON-serializable.', 'INVALID_ARGUMENT');
  }
  if (Buffer.byteLength(persistedText) > 64 * 1024) {
    throw simulationError('Simulation parameters and arguments are limited to 64 KiB.', 'INVALID_ARGUMENT');
  }
  if (experiment !== null) {
    if (
      !experiment ||
      typeof experiment !== 'object' ||
      !SIMULATION_ID_PATTERN.test(String(experiment.experiment_id ?? '')) ||
      !Number.isSafeInteger(experiment.branch_index) ||
      experiment.branch_index < 0 ||
      !Number.isSafeInteger(experiment.branch_count) ||
      experiment.branch_count < 1 ||
      experiment.branch_index >= experiment.branch_count ||
      !SHA256_PATTERN.test(String(experiment.plan_sha256 ?? ''))
    ) {
      throw simulationError('Invalid parent experiment link.', 'INVALID_ARGUMENT');
    }
  }
  const findings = scanSecrets(persistedText);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in simulation arguments; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const sourceFindings = scanSecrets(fs.readFileSync(script, 'utf8'));
  if (sourceFindings.length) {
    throw Object.assign(
      new Error('Potential secret detected in simulation source; refusing to archive or execute it.'),
      { code: 'SECRET_DETECTED', findings: sourceFindings }
    );
  }
  for (const input of inputs) {
    if (!fs.statSync(input, { throwIfNoEntry: false })?.isFile()) {
      throw simulationError('Declared simulation input is not a regular file: ' + input, 'INVALID_INPUT');
    }
    if (!isPathInside(projectReal, fs.realpathSync(input))) {
      throw simulationError(
        'Declared simulation input resolves outside the project root.',
        'PATH_OUTSIDE_ROOT'
      );
    }
  }
}

function collectArtifactMetadata(root) {
  const artifacts = {};
  const issues = [];
  if (!fs.existsSync(root)) return { artifacts, issues };
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = relativePortable(root, file);
      if (entry.isSymbolicLink()) {
        issues.push({ file: relative, issue: 'symbolic_link_not_archived' });
      } else if (entry.isDirectory()) {
        visit(file);
      } else if (entry.isFile()) {
        artifacts[relative] = {
          sha256: sha256File(file),
          bytes: fs.statSync(file).size
        };
      }
    }
  };
  visit(root);
  return { artifacts, issues };
}

function standardArtifactMetadata(runDirectory, names) {
  const result = {};
  for (const name of names) {
    const file = path.join(runDirectory, name);
    if (!fs.existsSync(file)) continue;
    result[name.replace(/\\/g, '/')] = {
      sha256: sha256File(file),
      bytes: fs.statSync(file).size
    };
  }
  return result;
}

function simulationEnvironment(env, values) {
  const result = { ...env };
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete result[name];
  Object.assign(result, values, {
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONHASHSEED: String(values.SCIENCECODE_SEED),
    CUBLAS_WORKSPACE_CONFIG: ':4096:8',
    MPLBACKEND: 'Agg'
  });
  return result;
}

function inputMetadata(project, inputs) {
  return inputs.map((file) => ({
    path: relativePortable(project, file),
    sha256: sha256File(file),
    bytes: fs.statSync(file).size
  }));
}

export function resolveCadSimulationParent(project, cadBuildId) {
  if (cadBuildId === undefined || cadBuildId === null || cadBuildId === '') {
    return { parent: null, meshFile: null };
  }
  const buildId = String(cadBuildId);
  const verification = verifyCadBuild(project, buildId);
  if (!verification.ok) {
    throw Object.assign(
      new Error('CAD parent build failed integrity verification.'),
      {
        code: 'CAD_BUILD_INVALID',
        errors: verification.errors
      }
    );
  }
  const manifest = verification.manifest;
  if (manifest.status !== 'completed' || !manifest.artifacts?.['assembly.stl']) {
    throw Object.assign(
      new Error('A recorded CAD simulation requires a completed mesh build.'),
      { code: 'CAD_BUILD_NOT_COMPLETED' }
    );
  }
  const meshFile = resolveCadArtifact(project, {
    kind: 'build',
    id: buildId,
    file: 'assembly.stl'
  });
  return {
    meshFile,
    parent: {
      build_id: buildId,
      cad_project_id: manifest.cad_project_id,
      manifest_sha256: verification.manifest_sha256,
      mesh_path: relativePortable(project, meshFile),
      mesh_sha256: manifest.artifacts['assembly.stl'].sha256
    }
  };
}

function prepareSimulationRun({
  cwd,
  packageRoot,
  script,
  seed = 0,
  device = 'auto',
  timeoutMs = 3_600_000,
  parameters = {},
  scriptArgs = [],
  inputs = [],
  experiment = null,
  cadBuildId = null,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime,
  probeRunner = runCommandSync,
  gpuProbe = detectNvidiaGpu
}) {
  const project = path.resolve(cwd);
  const source = resolveInsideRoot(project, script);
  const declaredInputs = inputs.map((value) => resolveInsideRoot(project, value));
  const cad = resolveCadSimulationParent(project, cadBuildId);
  if (cad.meshFile && !declaredInputs.some((file) =>
    path.resolve(file) === path.resolve(cad.meshFile))) {
    declaredInputs.push(cad.meshFile);
  }
  validateSimulationInput({
    project,
    script: source,
    seed,
    device,
    timeoutMs,
    parameters,
    scriptArgs,
    inputs: declaredInputs,
    experiment,
    cadParent: cad.parent
  });

  const compute = runtime ?? probeComputeRuntime({
    env,
    scienceCodeHome,
    runner: probeRunner
  });
  if (!compute.healthy || !compute.paths?.python) {
    throw Object.assign(
      new Error('ScienceCode GPU runtime is unavailable. Run "sciencecode compute setup" first.'),
      { code: 'COMPUTE_RUNTIME_UNAVAILABLE', runtime: compute }
    );
  }
  const driver = path.join(path.resolve(packageRoot), 'runtime', 'simulation_runner.py');
  if (!fs.statSync(driver, { throwIfNoEntry: false })?.isFile()) {
    throw simulationError('ScienceCode simulation launcher is missing: ' + driver, 'SIMULATION_RUNTIME_MISSING');
  }

  const before = snapshot(project);
  const scienceDirectory = ensureScienceDir(project);
  const id = makeRunId();
  const runDirectory = path.join(scienceDirectory, 'simulations', id);
  const artifactsDirectory = path.join(runDirectory, 'artifacts');
  fs.mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 });
  const sourceText = fs.readFileSync(source, 'utf8');
  writeTextExclusive(path.join(runDirectory, 'source.py'), sourceText);
  writeJsonExclusive(path.join(runDirectory, 'runtime-manifest.json'), compute.manifest ?? {});

  const started = new Date();
  const gpuBefore = gpuProbe({ env, runner: probeRunner });
  const manifest = {
    schema_version: SIMULATION_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    simulation_id: id,
    started_at: started.toISOString(),
    status: 'running',
    script: {
      path: relativePortable(project, source),
      archived_path: 'source.py',
      sha256: sha256Text(sourceText)
    },
    seed,
    device_request: device,
    timeout_ms: timeoutMs,
    parameters,
    script_arguments: scriptArgs,
    inputs: inputMetadata(project, declaredInputs),
    experiment,
    cad_parent: cad.parent,
    runtime: {
      python: compute.paths.python,
      profile: compute.profile,
      manifest_sha256: sha256File(path.join(runDirectory, 'runtime-manifest.json')),
      probe: compute.probe ?? null
    },
    gpu_before: gpuBefore,
    preservation_policy: 'append-only; generated artifacts are never overwritten by ScienceCode'
  };
  writeJsonExclusive(path.join(runDirectory, 'manifest.json'), manifest);
  appendAudit(project, {
    type: 'simulation.started',
    simulation_id: id,
    script: manifest.script.path,
    script_sha256: manifest.script.sha256,
    seed,
    device_request: device,
    ...(experiment ? {
      experiment_id: experiment.experiment_id,
      experiment_branch_index: experiment.branch_index
    } : {}),
    ...(cad.parent ? {
      cad_build_id: cad.parent.build_id,
      cad_project_id: cad.parent.cad_project_id,
      cad_mesh_sha256: cad.parent.mesh_sha256
    } : {})
  });

  const childArguments = [
    driver,
    '--script',
    source,
    '--output-dir',
    artifactsDirectory,
    '--seed',
    String(seed),
    '--device',
    device,
    '--parameters-json',
    JSON.stringify(parameters),
    '--',
    ...scriptArgs.map(String)
  ];
  const childOptions = {
    cwd: project,
    env: simulationEnvironment(env, {
      SCIENCECODE_HOME: scienceCodeHome,
      SCIENCECODE_SIMULATION_ID: id,
      SCIENCECODE_SIMULATION_DIR: runDirectory,
      SCIENCECODE_OUTPUT_DIR: artifactsDirectory,
      SCIENCECODE_SEED: String(seed),
      SCIENCECODE_DEVICE_REQUEST: device,
      ...(experiment ? {
        SCIENCECODE_EXPERIMENT_ID: experiment.experiment_id,
        SCIENCECODE_EXPERIMENT_BRANCH_INDEX: String(experiment.branch_index),
        SCIENCECODE_EXPERIMENT_BRANCH_COUNT: String(experiment.branch_count)
      } : {}),
      ...(cad.parent ? {
        SCIENCECODE_CAD_BUILD_ID: cad.parent.build_id,
        SCIENCECODE_CAD_PROJECT_ID: cad.parent.cad_project_id,
        SCIENCECODE_CAD_MESH_PATH: cad.meshFile,
        SCIENCECODE_CAD_MESH_SHA256: cad.parent.mesh_sha256
      } : {})
    }),
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  };
  return {
    project,
    id,
    runDirectory,
    artifactsDirectory,
    before,
    started,
    manifest,
    experiment,
    cad,
    env,
    compute,
    probeRunner,
    gpuProbe,
    childArguments,
    childOptions
  };
}

function finalizeSimulationRun(prepared, child, { cancellationReason = null } = {}) {
  const {
    project,
    id,
    runDirectory,
    artifactsDirectory,
    before,
    started,
    manifest,
    experiment,
    cad,
    env,
    compute,
    probeRunner,
    gpuProbe
  } = prepared;
  const stdout = redactText(String(child.stdout ?? ''));
  const stderr = redactText(String(child.stderr ?? ''));
  writeTextExclusive(path.join(runDirectory, 'stdout.log'), stdout);
  writeTextExclusive(path.join(runDirectory, 'stderr.log'), stderr);

  const after = snapshot(project);
  writeJsonExclusive(path.join(runDirectory, 'snapshot-before.json'), before);
  writeJsonExclusive(path.join(runDirectory, 'snapshot-after.json'), after);
  const changes = diffSnapshots(before, after);
  const finished = new Date();
  const collected = collectArtifactMetadata(artifactsDirectory);
  let context = null;
  try {
    context = readJson(path.join(artifactsDirectory, 'simulation-context.json'));
  } catch {
    // A failed launcher may not have reached context creation.
  }
  const cancelled = Boolean(
    child.aborted ||
    child.error?.name === 'AbortError' ||
    child.error?.code === 'ABORT_ERR'
  );
  const exitCode = child.status ?? (cancelled ? null : child.error ? 127 : 1);
  manifest.finished_at = finished.toISOString();
  manifest.duration_ms = finished.getTime() - started.getTime();
  manifest.exit_code = exitCode;
  manifest.signal = child.signal ?? null;
  manifest.launch_error = child.error ? redactText(child.error.message ?? String(child.error)) : null;
  manifest.status = cancelled
    ? 'cancelled'
    : exitCode === 0 && collected.issues.length === 0 ? 'completed' : 'failed';
  if (cancelled) {
    const reason = redactText(String(cancellationReason ?? 'user_requested'))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    manifest.cancellation = {
      reason: reason || 'user_requested',
      cancelled_at: finished.toISOString(),
      partial_artifacts_preserved: true
    };
  }
  manifest.context = context;
  manifest.gpu_after = gpuProbe({ env, runner: probeRunner });
  manifest.changes = changes;
  manifest.artifact_issues = collected.issues;
  manifest.artifacts = {
    ...standardArtifactMetadata(runDirectory, [
      'source.py',
      'runtime-manifest.json',
      'stdout.log',
      'stderr.log',
      'snapshot-before.json',
      'snapshot-after.json'
    ]),
    ...Object.fromEntries(
      Object.entries(collected.artifacts).map(([name, metadata]) => ['artifacts/' + name, metadata])
    )
  };
  writeJson(path.join(runDirectory, 'manifest.json'), manifest);
  const manifestHash = sha256File(path.join(runDirectory, 'manifest.json'));
  writeTextExclusive(path.join(runDirectory, 'manifest.sha256'), manifestHash + '\n');
  appendAudit(project, {
    type: 'simulation.finished',
    simulation_id: id,
    status: manifest.status,
    exit_code: exitCode,
    manifest_sha256: manifestHash,
    artifacts: Object.keys(collected.artifacts).length,
    changes,
    ...(experiment ? {
      experiment_id: experiment.experiment_id,
      experiment_branch_index: experiment.branch_index
    } : {}),
    ...(cad.parent ? {
      cad_build_id: cad.parent.build_id,
      cad_project_id: cad.parent.cad_project_id,
      cad_mesh_sha256: cad.parent.mesh_sha256
    } : {})
  });
  return {
    child,
    manifest,
    runDirectory,
    displayStdout: stdout,
    displayStderr: stderr
  };
}

export function runSimulation({
  cwd,
  packageRoot,
  script,
  seed = 0,
  device = 'auto',
  timeoutMs = 3_600_000,
  parameters = {},
  scriptArgs = [],
  inputs = [],
  experiment = null,
  cadBuildId = null,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime,
  runner = runCommandSync,
  gpuProbe = detectNvidiaGpu
}) {
  const prepared = prepareSimulationRun({
    cwd,
    packageRoot,
    script,
    seed,
    device,
    timeoutMs,
    parameters,
    scriptArgs,
    inputs,
    experiment,
    cadBuildId,
    env,
    scienceCodeHome,
    runtime,
    probeRunner: runner,
    gpuProbe
  });
  const child = runner(
    prepared.compute.paths.python,
    prepared.childArguments,
    prepared.childOptions
  );
  return finalizeSimulationRun(prepared, child);
}

export async function runSimulationAsync({
  cwd,
  packageRoot,
  script,
  seed = 0,
  device = 'auto',
  timeoutMs = 3_600_000,
  parameters = {},
  scriptArgs = [],
  inputs = [],
  experiment = null,
  cadBuildId = null,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime,
  runner = runCommand,
  probeRunner = runCommandSync,
  gpuProbe = detectNvidiaGpu,
  signal,
  onStarted,
  onStdout,
  onStderr
}) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Simulation cancelled before launch.'), {
      name: 'AbortError',
      code: 'ABORT_ERR'
    });
  }
  const prepared = prepareSimulationRun({
    cwd,
    packageRoot,
    script,
    seed,
    device,
    timeoutMs,
    parameters,
    scriptArgs,
    inputs,
    experiment,
    cadBuildId,
    env,
    scienceCodeHome,
    runtime,
    probeRunner,
    gpuProbe
  });
  onStarted?.({
    simulation_id: prepared.id,
    run_directory: prepared.runDirectory,
    cad_parent: prepared.manifest.cad_parent
  });
  let child;
  try {
    child = await runner(
      prepared.compute.paths.python,
      prepared.childArguments,
      {
        ...prepared.childOptions,
        signal,
        onStdout,
        onStderr
      }
    );
  } catch (error) {
    child = {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error,
      aborted: signal?.aborted || error?.name === 'AbortError'
    };
  }
  return finalizeSimulationRun(prepared, child, {
    cancellationReason: signal?.reason
  });
}

function simulationsDirectory(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'simulations');
}

export function resolveSimulationDirectory(cwd, simulationId) {
  if (!SIMULATION_ID_PATTERN.test(String(simulationId ?? '')) || simulationId === '.' || simulationId === '..') {
    throw simulationError('Invalid simulation ID: ' + String(simulationId ?? ''), 'INVALID_SIMULATION_ID');
  }
  return path.join(simulationsDirectory(cwd), simulationId);
}

export function getSimulationManifest(cwd, simulationId) {
  const directory = resolveSimulationDirectory(cwd, simulationId);
  const file = path.join(directory, 'manifest.json');
  if (!fs.existsSync(file)) {
    throw simulationError('Simulation not found: ' + simulationId, 'SIMULATION_NOT_FOUND');
  }
  return readJson(file);
}

export function listSimulations(cwd) {
  const directory = simulationsDirectory(cwd);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const manifest = getSimulationManifest(cwd, entry.name);
        return {
          simulation_id: entry.name,
          status: manifest.status ?? 'unknown',
          script: manifest.script?.path ?? null,
          device: manifest.context?.device?.selected ?? manifest.device_request ?? null,
          started_at: manifest.started_at ?? null,
          finished_at: manifest.finished_at ?? null,
          exit_code: manifest.exit_code ?? null
        };
      } catch (error) {
        return { simulation_id: entry.name, status: 'invalid', error: error.message };
      }
    })
    .sort((left, right) => right.simulation_id.localeCompare(left.simulation_id));
}

export function verifySimulation(cwd, simulationId) {
  const errors = [];
  let directory;
  let manifest;
  try {
    directory = resolveSimulationDirectory(cwd, simulationId);
    manifest = getSimulationManifest(cwd, simulationId);
  } catch (error) {
    return {
      ok: false,
      simulation_id: simulationId,
      errors: [{ issue: error.code ?? 'simulation_error', detail: error.message }]
    };
  }
  const manifestFile = path.join(directory, 'manifest.json');
  const digestFile = path.join(directory, 'manifest.sha256');
  const actualManifestHash = sha256File(manifestFile);
  if (!fs.existsSync(digestFile)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else {
    const expected = fs.readFileSync(digestFile, 'utf8').trim();
    if (expected !== actualManifestHash) {
      errors.push({ file: 'manifest.json', issue: 'hash_mismatch', expected, actual: actualManifestHash });
    }
  }
  for (const [name, metadata] of Object.entries(manifest.artifacts ?? {})) {
    let file;
    try {
      file = resolveInsideRoot(directory, name);
    } catch (error) {
      errors.push({ file: name, issue: 'invalid_path', detail: error.message });
      continue;
    }
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      errors.push({ file: name, issue: 'missing' });
      continue;
    }
    const actual = sha256File(file);
    if (actual !== metadata.sha256) {
      errors.push({ file: name, issue: 'hash_mismatch', expected: metadata.sha256, actual });
    } else if (metadata.bytes !== undefined && fs.statSync(file).size !== metadata.bytes) {
      errors.push({ file: name, issue: 'size_mismatch', expected: metadata.bytes, actual: fs.statSync(file).size });
    }
  }
  for (const input of manifest.inputs ?? []) {
    let file;
    try {
      file = resolveInsideRoot(cwd, input.path);
    } catch (error) {
      errors.push({ file: input.path, issue: 'invalid_input_path', detail: error.message });
      continue;
    }
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      errors.push({ file: input.path, issue: 'input_missing' });
    } else {
      const actual = sha256File(file);
      if (actual !== input.sha256) {
        errors.push({ file: input.path, issue: 'input_drift', expected: input.sha256, actual });
      }
    }
  }
  if (manifest.cad_parent !== undefined && manifest.cad_parent !== null) {
    const parent = manifest.cad_parent;
    if (!parent || typeof parent !== 'object' || Array.isArray(parent) ||
        !SIMULATION_ID_PATTERN.test(String(parent.build_id ?? '')) ||
        typeof parent.cad_project_id !== 'string' ||
        !SHA256_PATTERN.test(String(parent.manifest_sha256 ?? '')) ||
        !SHA256_PATTERN.test(String(parent.mesh_sha256 ?? '')) ||
        typeof parent.mesh_path !== 'string') {
      errors.push({ issue: 'cad_parent_malformed' });
    } else {
      const parentVerification = verifyCadBuild(cwd, parent.build_id);
      if (!parentVerification.ok) {
        errors.push({
          issue: 'cad_parent_invalid',
          build_id: parent.build_id,
          errors: parentVerification.errors
        });
      } else {
        if (parentVerification.manifest_sha256 !== parent.manifest_sha256) {
          errors.push({
            issue: 'cad_parent_manifest_mismatch',
            expected: parent.manifest_sha256,
            actual: parentVerification.manifest_sha256
          });
        }
        if (parentVerification.manifest.cad_project_id !== parent.cad_project_id) {
          errors.push({ issue: 'cad_parent_project_mismatch' });
        }
        try {
          const mesh = resolveCadArtifact(cwd, {
            kind: 'build',
            id: parent.build_id,
            file: 'assembly.stl'
          });
          const meshPath = relativePortable(cwd, mesh);
          const meshSha = sha256File(mesh);
          if (meshPath !== parent.mesh_path || meshSha !== parent.mesh_sha256) {
            errors.push({
              issue: 'cad_parent_mesh_mismatch',
              expected_path: parent.mesh_path,
              actual_path: meshPath,
              expected_sha256: parent.mesh_sha256,
              actual_sha256: meshSha
            });
          }
          const linkedInput = (manifest.inputs ?? []).find((input) =>
            input.path === parent.mesh_path &&
            input.sha256 === parent.mesh_sha256
          );
          if (!linkedInput) errors.push({ issue: 'cad_parent_input_link_missing' });
        } catch (error) {
          errors.push({
            issue: 'cad_parent_mesh_invalid',
            detail: error.message
          });
        }
      }
    }
  }
  const audit = verifyAudit(cwd);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const finish = readAuditRecords(cwd).findLast(
      (record) => record.type === 'simulation.finished' && record.simulation_id === simulationId
    );
    if (!finish) {
      errors.push({ issue: 'missing_audit_event' });
    } else if (finish.manifest_sha256 !== actualManifestHash) {
      errors.push({
        issue: 'audit_manifest_mismatch',
        expected: finish.manifest_sha256 ?? null,
        actual: actualManifestHash
      });
    }
  }
  return {
    ok: errors.length === 0,
    simulation_id: simulationId,
    manifest,
    manifest_sha256: actualManifestHash,
    errors
  };
}

export function initializeSimulationTemplate(cwd, name, {
  packageRoot,
  target = path.join('simulations', name + '.py'),
  reuseExact = false
} = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(name ?? ''))) {
    throw simulationError('Invalid simulation template name.', 'INVALID_ARGUMENT');
  }
  const source = path.join(path.resolve(packageRoot), 'templates', 'simulations', name + '.py');
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw simulationError('Unknown simulation template: ' + name, 'SIMULATION_TEMPLATE_NOT_FOUND');
  }
  const destination = resolveInsideRoot(cwd, target);
  const sourceText = fs.readFileSync(source, 'utf8');
  const sourceSha256 = sha256Text(sourceText);
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (reuseExact && existing?.isFile() && sha256File(destination) === sourceSha256) {
    ensureScienceDir(cwd);
    appendAudit(cwd, {
      type: 'simulation.template_reused',
      template: name,
      file: relativePortable(cwd, destination),
      sha256: sourceSha256
    });
    return {
      template: name,
      file: destination,
      sha256: sourceSha256,
      created: false
    };
  }
  writeTextExclusive(destination, sourceText);
  ensureScienceDir(cwd);
  appendAudit(cwd, {
    type: 'simulation.template_created',
    template: name,
    file: relativePortable(cwd, destination),
    sha256: sourceSha256
  });
  return {
    template: name,
    file: destination,
    sha256: sourceSha256,
    created: true
  };
}
