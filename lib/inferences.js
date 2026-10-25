import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import {
  NPU_EXECUTION_PROVIDER,
  detectWindowsNpu,
  probeNpuRuntime
} from './compute.js';
import { VERSION } from './constants.js';
import { sha256File } from './hash.js';
import { runCommand, runCommandSync } from './process.js';
import { resolveScienceCodeHome } from './runtime.js';
import { redactText, scanSecrets } from './security.js';
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

export const INFERENCE_SCHEMA_VERSION = 2;
export const MAX_INFERENCE_MODEL_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_INFERENCE_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_INFERENCE_ITERATIONS = 1_000;

const INFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEVICE_PATTERN = /^(?:auto|cpu|npu)$/;
const RESULT_PREFIX = 'SCIENCECODE_RESULT_JSON=';

function inferenceError(message, code = 'INVALID_INFERENCE') {
  return Object.assign(new Error(message), { code });
}

function inferenceEnvironment(env, scienceCodeHome, inferenceId, inferenceDirectory) {
  const result = { ...env };
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete result[name];
  Object.assign(result, {
    SCIENCECODE_HOME: path.resolve(scienceCodeHome),
    SCIENCECODE_INFERENCE_ID: inferenceId,
    SCIENCECODE_INFERENCE_DIR: inferenceDirectory,
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    TEMP: path.join(path.resolve(scienceCodeHome), 'tmp'),
    TMP: path.join(path.resolve(scienceCodeHome), 'tmp'),
    TMPDIR: path.join(path.resolve(scienceCodeHome), 'tmp')
  });
  return result;
}

function parseWorkerResult(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/).reverse();
  const line = lines.find((value) => value.startsWith(RESULT_PREFIX));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(RESULT_PREFIX.length));
  } catch {
    return null;
  }
}

function collectFiles(root, directory = root, result = {}, issues = []) {
  if (!fs.existsSync(directory)) return { files: result, issues };
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const relative = relativePortable(root, file);
    if (relative === 'manifest.json' || relative === 'manifest.sha256') continue;
    if (entry.isSymbolicLink()) {
      issues.push({ file: relative, issue: 'symbolic_link_not_archived' });
    } else if (entry.isDirectory()) {
      collectFiles(root, file, result, issues);
    } else if (entry.isFile()) {
      result[relative] = {
        sha256: sha256File(file),
        bytes: fs.statSync(file).size
      };
    }
  }
  return { files: result, issues };
}

function validateOptions({
  project,
  smoke,
  model,
  input,
  device,
  allowFallback,
  warmup,
  iterations,
  timeoutMs
}) {
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw inferenceError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  if (!DEVICE_PATTERN.test(device)) {
    throw inferenceError('Inference device must be npu, cpu, or auto.', 'INVALID_ARGUMENT');
  }
  if (typeof allowFallback !== 'boolean') {
    throw inferenceError('Fallback policy must be a boolean.', 'INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(warmup) || warmup < 0 || warmup > MAX_INFERENCE_ITERATIONS) {
    throw inferenceError('Warmup iterations must be from 0 through 1000.', 'INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_INFERENCE_ITERATIONS) {
    throw inferenceError('Inference iterations must be from 1 through 1000.', 'INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 86_400_000) {
    throw inferenceError('Inference timeout must be between 1 and 86400 seconds.', 'INVALID_ARGUMENT');
  }
  if (smoke) return { model: null, input: null };
  if (!fs.statSync(model, { throwIfNoEntry: false })?.isFile()) {
    throw inferenceError('ONNX model does not exist: ' + model, 'INFERENCE_MODEL_NOT_FOUND');
  }
  const projectReal = fs.realpathSync(project);
  const modelReal = fs.realpathSync(model);
  if (!isPathInside(projectReal, modelReal)) {
    throw inferenceError('ONNX model resolves outside the project root.', 'PATH_OUTSIDE_ROOT');
  }
  if (path.extname(model).toLowerCase() !== '.onnx') {
    throw inferenceError('Inference models must use the .onnx extension.', 'INVALID_ARGUMENT');
  }
  const modelBytes = fs.statSync(modelReal).size;
  if (modelBytes < 1 || modelBytes > MAX_INFERENCE_MODEL_BYTES) {
    throw inferenceError('ONNX model must be from 1 byte through 2 GiB.', 'INFERENCE_MODEL_TOO_LARGE');
  }
  if (!fs.statSync(input, { throwIfNoEntry: false })?.isFile()) {
    throw inferenceError('Inference input JSON does not exist: ' + input, 'INFERENCE_INPUT_NOT_FOUND');
  }
  const inputReal = fs.realpathSync(input);
  if (!isPathInside(projectReal, inputReal)) {
    throw inferenceError('Inference input resolves outside the project root.', 'PATH_OUTSIDE_ROOT');
  }
  const inputBytes = fs.statSync(inputReal).size;
  if (inputBytes < 2 || inputBytes > MAX_INFERENCE_INPUT_BYTES) {
    throw inferenceError('Inference input JSON must be from 2 bytes through 16 MiB.', 'INFERENCE_INPUT_TOO_LARGE');
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(inputReal, 'utf8'));
  } catch (error) {
    throw inferenceError('Inference input is not valid JSON: ' + error.message, 'INVALID_INFERENCE_INPUT');
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw inferenceError('Inference input JSON must contain an object.', 'INVALID_INFERENCE_INPUT');
  }
  const findings = scanSecrets(JSON.stringify(payload));
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in inference input; refusing to archive it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return { model: modelReal, input: inputReal };
}

function emitInferenceEvent(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(event);
  } catch {
    // A display callback cannot invalidate an immutable inference record.
  }
}

function executeInference({
  cwd,
  packageRoot,
  model = null,
  input = null,
  smoke = false,
  device = 'npu',
  allowFallback = false,
  warmup = 1,
  iterations = 3,
  timeoutMs = 900_000,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime = null,
  runner = runCommandSync,
  probeRunner = runner,
  signal,
  onEvent,
  npuProbe = detectWindowsNpu
} = {}) {
  const project = path.resolve(cwd);
  const modelSourcePath = smoke ? null : resolveInsideRoot(project, model);
  const inputSourcePath = smoke ? null : resolveInsideRoot(project, input);
  const validated = validateOptions({
    project,
    smoke,
    model: modelSourcePath,
    input: inputSourcePath,
    device,
    allowFallback,
    warmup,
    iterations,
    timeoutMs
  });
  const modelPath = validated.model;
  const inputPath = validated.input;

  const compute = runtime ?? probeNpuRuntime({
    packageRoot,
    env,
    scienceCodeHome,
    runner: probeRunner
  });
  if (!compute.healthy || !compute.paths?.python) {
    throw Object.assign(
      new Error(
        'ScienceCode NPU runtime is unavailable. Run "sciencecode compute setup --profile npu" first.'
      ),
      { code: 'NPU_RUNTIME_UNAVAILABLE', runtime: compute }
    );
  }
  const worker = path.join(path.resolve(packageRoot), 'runtime', 'npu_worker.py');
  if (!fs.statSync(worker, { throwIfNoEntry: false })?.isFile()) {
    throw inferenceError('ScienceCode NPU worker is missing: ' + worker, 'NPU_WORKER_MISSING');
  }

  const scienceDirectory = ensureScienceDir(project);
  const inferenceId = makeRunId();
  const runDirectory = path.join(scienceDirectory, 'inferences', inferenceId);
  const artifactsDirectory = path.join(runDirectory, 'artifacts');
  fs.mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 });
  writeJsonExclusive(path.join(runDirectory, 'runtime-manifest.json'), compute.manifest ?? {});
  let archivedModel = null;
  let archivedInput = null;
  if (!smoke) {
    archivedModel = path.join(artifactsDirectory, 'model.onnx');
    archivedInput = path.join(artifactsDirectory, 'input.json');
    fs.copyFileSync(modelPath, archivedModel, fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(inputPath, archivedInput, fs.constants.COPYFILE_EXCL);
  }

  const hardwareBefore = npuProbe({ env, runner: probeRunner });
  const started = new Date();
  const manifest = {
    schema_version: INFERENCE_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    inference_id: inferenceId,
    started_at: started.toISOString(),
    status: 'running',
    kind: smoke ? 'hardware_smoke' : 'onnx_inference',
    device_request: device,
    fallback_allowed: allowFallback,
    warmup_iterations: warmup,
    iterations,
    timeout_ms: timeoutMs,
    model: smoke ? {
      source: 'sciencecode_deterministic_smoke_fixture',
      archived_path: 'artifacts/smoke-model.onnx'
    } : {
      path: relativePortable(project, modelSourcePath),
      archived_path: 'artifacts/model.onnx',
      source_sha256: sha256File(modelPath),
      bytes: fs.statSync(modelPath).size
    },
    input: smoke ? {
      source: 'sciencecode_deterministic_smoke_fixture',
      archived_path: 'artifacts/smoke-input.json'
    } : {
      path: relativePortable(project, inputSourcePath),
      archived_path: 'artifacts/input.json',
      source_sha256: sha256File(inputPath),
      bytes: fs.statSync(inputPath).size
    },
    runtime: {
      profile: compute.profile,
      python: compute.paths.python,
      manifest_sha256: sha256File(path.join(runDirectory, 'runtime-manifest.json')),
      execution_provider: NPU_EXECUTION_PROVIDER,
      probe: compute.probe ?? null
    },
    hardware_before: hardwareBefore,
    preservation_policy: 'append-only; exact model, input, output arrays, profile, and logs are archived'
  };
  writeJsonExclusive(path.join(runDirectory, 'manifest.json'), manifest);
  appendAudit(project, {
    type: 'inference.started',
    inference_id: inferenceId,
    kind: manifest.kind,
    device_request: device,
    fallback_allowed: allowFallback,
    model_sha256: manifest.model.source_sha256 ?? null,
    input_sha256: manifest.input.source_sha256 ?? null
  });
  emitInferenceEvent(onEvent, {
    type: 'inference.started',
    timestamp: started.toISOString(),
    status: 'running',
    title: smoke ? 'Preparing the deterministic inference smoke model' : 'Preparing the archived ONNX model and inputs',
    inference_id: inferenceId,
    device_request: device
  });

  const childArguments = [
    worker,
    smoke ? 'smoke' : 'run',
    '--output-dir',
    artifactsDirectory,
    '--device',
    device,
    '--warmup',
    String(warmup),
    '--iterations',
    String(iterations)
  ];
  if (!smoke) {
    childArguments.push('--model', archivedModel, '--input-json', archivedInput);
  }
  if (compute.provider_library) {
    childArguments.push('--provider-library', compute.provider_library);
  }
  if (allowFallback) childArguments.push('--allow-fallback');
  emitInferenceEvent(onEvent, {
    type: 'inference.executing',
    timestamp: new Date().toISOString(),
    status: 'running',
    title: device === 'npu'
      ? 'Executing with strict profiled NPU attribution'
      : 'Executing the bounded ONNX inference',
    inference_id: inferenceId,
    device_request: device
  });
  let child;
  try {
    child = runner(compute.paths.python, childArguments, {
      cwd: project,
      env: inferenceEnvironment(env, scienceCodeHome, inferenceId, runDirectory),
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
      signal
    });
  } catch (error) {
    child = {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error,
      aborted: Boolean(signal?.aborted || error?.name === 'AbortError')
    };
  }
  const finalize = (resolvedChild) => {
  const child = resolvedChild ?? {};
  const stdout = redactText(String(child.stdout ?? ''));
  const stderr = redactText(String(child.stderr ?? ''));
  writeTextExclusive(path.join(runDirectory, 'stdout.log'), stdout);
  writeTextExclusive(path.join(runDirectory, 'stderr.log'), stderr);
  const result = parseWorkerResult(stdout);
  const files = collectFiles(runDirectory);
  const cancelled = child.aborted === true;
  const exitCode = cancelled ? null : child.status ?? (child.error ? 127 : 1);
  const profileEventCounts = result?.provider_profile_event_counts ??
    result?.provider_node_counts ?? {};
  const npuProfileEventCount = Number(
    result?.npu_profile_event_count ??
    result?.npu_node_count ??
    profileEventCounts[NPU_EXECUTION_PROVIDER] ??
    0
  );
  const npuVerified = [
    'verified_profiled_provider_execution',
    'verified_node_execution'
  ].includes(result?.provider_claim) && npuProfileEventCount > 0;
  const completed = (
    exitCode === 0 &&
    result?.ok === true &&
    files.issues.length === 0 &&
    (device !== 'npu' || npuVerified)
  );
  const finished = new Date();
  manifest.finished_at = finished.toISOString();
  manifest.duration_ms = finished.getTime() - started.getTime();
  manifest.exit_code = exitCode;
  manifest.signal = child.signal ?? null;
  manifest.launch_error = child.error ? redactText(child.error.message ?? String(child.error)) : null;
  manifest.status = cancelled ? 'cancelled' : completed ? 'completed' : 'failed';
  if (cancelled) {
    manifest.cancellation = {
      reason: redactText(String(signal?.reason ?? 'cancelled')).slice(0, 160),
      cancelled_at: finished.toISOString()
    };
  }
  manifest.execution = result;
  manifest.provider_verification = {
    requested: device,
    required_provider: device === 'npu' ? NPU_EXECUTION_PROVIDER : null,
    npu_executed: npuVerified,
    attribution_method: result?.provider_attribution_method ??
      'onnxruntime_profile_provider_event',
    profile_event_counts: profileEventCounts,
    fallback_detected: result?.fallback_detected ?? null,
    claim: result?.provider_claim ?? 'unavailable'
  };
  manifest.hardware_after = npuProbe({ env, runner: probeRunner });
  manifest.artifact_issues = files.issues;
  manifest.artifacts = files.files;
  if (smoke) {
    const generatedModel = path.join(artifactsDirectory, 'smoke-model.onnx');
    const generatedInput = path.join(artifactsDirectory, 'smoke-input.json');
    if (fs.statSync(generatedModel, { throwIfNoEntry: false })?.isFile()) {
      manifest.model.sha256 = sha256File(generatedModel);
      manifest.model.bytes = fs.statSync(generatedModel).size;
    }
    if (fs.statSync(generatedInput, { throwIfNoEntry: false })?.isFile()) {
      manifest.input.sha256 = sha256File(generatedInput);
      manifest.input.bytes = fs.statSync(generatedInput).size;
    }
  } else {
    manifest.model.sha256 = sha256File(archivedModel);
    manifest.input.sha256 = sha256File(archivedInput);
  }
  writeJson(path.join(runDirectory, 'manifest.json'), manifest);
  const manifestHash = sha256File(path.join(runDirectory, 'manifest.json'));
  writeTextExclusive(path.join(runDirectory, 'manifest.sha256'), manifestHash + '\n');
  appendAudit(project, {
    type: 'inference.finished',
    inference_id: inferenceId,
    status: manifest.status,
    exit_code: exitCode,
    device_request: device,
    npu_executed: npuVerified,
    provider_profile_event_counts: manifest.provider_verification.profile_event_counts,
    fallback_detected: manifest.provider_verification.fallback_detected,
    manifest_sha256: manifestHash
  });
  emitInferenceEvent(onEvent, {
    type: 'inference.finished',
    timestamp: finished.toISOString(),
    status: manifest.status,
    title: manifest.status === 'completed'
      ? (npuVerified ? 'Recorded inference completed with verified NPU execution' : 'Recorded inference completed')
      : manifest.status === 'cancelled'
        ? 'Inference stopped; partial artifacts were preserved'
        : 'Inference failed; logs and partial artifacts were preserved',
    inference_id: inferenceId,
    device_request: device,
    npu_executed: npuVerified
  });
  return {
    child,
    manifest,
    manifest_sha256: manifestHash,
    runDirectory,
    displayStdout: stdout,
    displayStderr: stderr
  };
  };
  const rejected = (error) => finalize({
    status: null,
    signal: null,
    stdout: '',
    stderr: '',
    error,
    aborted: Boolean(signal?.aborted || error?.name === 'AbortError')
  });
  return child && typeof child.then === 'function'
    ? child.then(finalize, rejected)
    : finalize(child);
}

export function runInference(options = {}) {
  return executeInference(options);
}

export async function runInferenceAsync(options = {}) {
  return await executeInference({
    ...options,
    runner: options.runner ?? runCommand,
    probeRunner: options.probeRunner ?? runCommandSync
  });
}

function inferencesDirectory(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'inferences');
}

export function resolveInferenceDirectory(cwd, inferenceId) {
  if (
    !INFERENCE_ID_PATTERN.test(String(inferenceId ?? '')) ||
    inferenceId === '.' ||
    inferenceId === '..'
  ) {
    throw inferenceError('Invalid inference ID: ' + String(inferenceId ?? ''), 'INVALID_INFERENCE_ID');
  }
  return path.join(inferencesDirectory(cwd), inferenceId);
}

export function getInferenceManifest(cwd, inferenceId) {
  const directory = resolveInferenceDirectory(cwd, inferenceId);
  const file = path.join(directory, 'manifest.json');
  if (!fs.existsSync(file)) {
    throw inferenceError('Inference not found: ' + inferenceId, 'INFERENCE_NOT_FOUND');
  }
  return readJson(file);
}

export function listInferences(cwd) {
  const directory = inferencesDirectory(cwd);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const manifest = getInferenceManifest(cwd, entry.name);
        return {
          inference_id: entry.name,
          kind: manifest.kind ?? null,
          status: manifest.status ?? 'unknown',
          device: manifest.device_request ?? null,
          npu_executed: manifest.provider_verification?.npu_executed === true,
          model: manifest.model?.path ?? manifest.model?.source ?? null,
          started_at: manifest.started_at ?? null,
          finished_at: manifest.finished_at ?? null,
          duration_ms: manifest.duration_ms ?? null,
          mean_latency_ms: manifest.execution?.latency_ms?.mean ?? null
        };
      } catch (error) {
        return { inference_id: entry.name, status: 'invalid', error: error.message };
      }
    })
    .sort((left, right) => right.inference_id.localeCompare(left.inference_id));
}

export function verifyInference(cwd, inferenceId) {
  const errors = [];
  let directory;
  let manifest;
  try {
    directory = resolveInferenceDirectory(cwd, inferenceId);
    manifest = getInferenceManifest(cwd, inferenceId);
  } catch (error) {
    return {
      ok: false,
      inference_id: inferenceId,
      errors: [{ issue: error.code ?? 'inference_error', detail: error.message }]
    };
  }
  const manifestFile = path.join(directory, 'manifest.json');
  const digestFile = path.join(directory, 'manifest.sha256');
  const actualManifestHash = sha256File(manifestFile);
  if (![1, INFERENCE_SCHEMA_VERSION].includes(manifest.schema_version)) {
    errors.push({
      issue: 'unsupported_schema_version',
      expected: [1, INFERENCE_SCHEMA_VERSION],
      actual: manifest.schema_version ?? null
    });
  }
  if (!fs.existsSync(digestFile)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else {
    const expected = fs.readFileSync(digestFile, 'utf8').trim();
    if (expected !== actualManifestHash) {
      errors.push({
        file: 'manifest.json',
        issue: 'hash_mismatch',
        expected,
        actual: actualManifestHash
      });
    }
  }
  for (const [name, descriptor] of Object.entries(manifest.artifacts ?? {})) {
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
    if (actual !== descriptor.sha256) {
      errors.push({
        file: name,
        issue: 'hash_mismatch',
        expected: descriptor.sha256,
        actual
      });
    } else if (descriptor.bytes !== undefined && fs.statSync(file).size !== descriptor.bytes) {
      errors.push({
        file: name,
        issue: 'size_mismatch',
        expected: descriptor.bytes,
        actual: fs.statSync(file).size
      });
    }
  }
  const providerCounts = manifest.schema_version === 1
    ? manifest.provider_verification?.node_counts ?? {}
    : manifest.provider_verification?.profile_event_counts ?? {};
  if (
    manifest.status === 'completed' &&
    manifest.device_request === 'npu' &&
    (
      manifest.provider_verification?.npu_executed !== true ||
      Number(providerCounts[NPU_EXECUTION_PROVIDER] ?? 0) < 1 ||
      (
        manifest.schema_version !== 1 &&
        manifest.provider_verification?.attribution_method !==
          'onnxruntime_profile_provider_event'
      )
    )
  ) {
    errors.push({ issue: 'npu_execution_claim_unverified' });
  }
  const audit = verifyAudit(cwd);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const finish = readAuditRecords(cwd).findLast(
      (record) => record.type === 'inference.finished' && record.inference_id === inferenceId
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
    inference_id: inferenceId,
    manifest,
    manifest_sha256: actualManifestHash,
    errors
  };
}
