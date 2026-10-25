import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import {
  ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION,
  getAnalysisContractBinding
} from './analysis-contracts.js';
import { probeComputeRuntime } from './compute.js';
import { VERSION } from './constants.js';
import { sha256File, sha256Text } from './hash.js';
import { resolveScienceCodeHome } from './runtime.js';
import { makeRunId } from './runs.js';
import { redactText, scanSecrets } from './security.js';
import {
  parseSimulationParameter,
  resolveCadSimulationParent,
  runSimulation,
  runSimulationAsync,
  verifySimulation
} from './simulations.js';
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
import {
  convertQuantity,
  differenceUnitFor,
  normalizeQuantity,
  parseUnit
} from './units.js';

export const EXPERIMENT_SCHEMA_VERSION = 1;
export const EXPERIMENT_RESULTS_SCHEMA_VERSION = 2;
export const EXPERIMENT_REVIEW_SCHEMA_VERSION = 2;
export const MAX_EXPERIMENT_RUNS = 64;

const EXPERIMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PARAMETER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_PARAMETER_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const DEVICE_PATTERN = /^(?:auto|cpu|cuda(?::\d+)?)$/;

function experimentError(message, code = 'INVALID_EXPERIMENT') {
  return Object.assign(new Error(message), { code });
}

function validateParameterName(name) {
  if (!PARAMETER_PATTERN.test(String(name ?? '')) || FORBIDDEN_PARAMETER_NAMES.has(name)) {
    throw experimentError('Invalid experiment parameter name: ' + String(name ?? ''), 'INVALID_ARGUMENT');
  }
}

function safeJson(value, label) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw experimentError(label + ' must be JSON serializable: ' + error.message, 'INVALID_ARGUMENT');
  }
  if (encoded === undefined) {
    throw experimentError(label + ' must be JSON serializable.', 'INVALID_ARGUMENT');
  }
  return encoded;
}

export function parseExperimentVariation(value) {
  const [name, parsed] = parseSimulationParameter(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw experimentError('--vary values must be a non-empty JSON array.', 'INVALID_ARGUMENT');
  }
  if (parsed.length > MAX_EXPERIMENT_RUNS) {
    throw experimentError(
      '--vary may contain at most ' + MAX_EXPERIMENT_RUNS + ' values.',
      'INVALID_ARGUMENT'
    );
  }
  const seen = new Set();
  for (const item of parsed) {
    const key = safeJson(item, 'Variation value');
    if (seen.has(key)) {
      throw experimentError('Duplicate value in variation ' + name + '.', 'INVALID_ARGUMENT');
    }
    seen.add(key);
  }
  return [name, parsed];
}

export function parseExperimentSeeds(value) {
  const tokens = String(value ?? '').split(',');
  if (!tokens.length || tokens.some((token) => !/^\d+$/.test(token.trim()))) {
    throw experimentError('--seeds must be a comma-separated list of integers.', 'INVALID_ARGUMENT');
  }
  const seeds = tokens.map((token) => Number(token.trim()));
  if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw experimentError('--seeds values must be integers from 0 through 4294967295.', 'INVALID_ARGUMENT');
  }
  if (new Set(seeds).size !== seeds.length) {
    throw experimentError('--seeds must not contain duplicates.', 'INVALID_ARGUMENT');
  }
  if (seeds.length > MAX_EXPERIMENT_RUNS) {
    throw experimentError(
      '--seeds may contain at most ' + MAX_EXPERIMENT_RUNS + ' values.',
      'INVALID_ARGUMENT'
    );
  }
  return seeds;
}

function validateParameterObject(parameters, label) {
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') {
    throw experimentError(label + ' must be an object.', 'INVALID_ARGUMENT');
  }
  for (const name of Object.keys(parameters)) {
    validateParameterName(name);
    safeJson(parameters[name], label + ' value');
  }
}

export function buildExperimentBranches({
  seeds = [0],
  parameters = {},
  variations = {}
} = {}) {
  validateParameterObject(parameters, 'Fixed parameters');
  validateParameterObject(variations, 'Variations');
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw experimentError('An experiment requires at least one seed.', 'INVALID_ARGUMENT');
  }
  const normalizedSeeds = seeds.map((seed) => Number(seed));
  if (normalizedSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw experimentError('Experiment seeds must be integers from 0 through 4294967295.', 'INVALID_ARGUMENT');
  }
  if (new Set(normalizedSeeds).size !== normalizedSeeds.length) {
    throw experimentError('Experiment seeds must be unique.', 'INVALID_ARGUMENT');
  }
  normalizedSeeds.sort((left, right) => left - right);

  const names = Object.keys(variations).sort();
  let combinations = 1;
  for (const name of names) {
    if (Object.hasOwn(parameters, name)) {
      throw experimentError('Parameter cannot be both fixed and varied: ' + name, 'INVALID_ARGUMENT');
    }
    const values = variations[name];
    if (!Array.isArray(values) || values.length === 0) {
      throw experimentError('Variation ' + name + ' must contain at least one value.', 'INVALID_ARGUMENT');
    }
    const seen = new Set();
    for (const value of values) {
      const key = safeJson(value, 'Variation value');
      if (seen.has(key)) {
        throw experimentError('Duplicate value in variation ' + name + '.', 'INVALID_ARGUMENT');
      }
      seen.add(key);
    }
    combinations *= values.length;
    if (combinations * normalizedSeeds.length > MAX_EXPERIMENT_RUNS) {
      throw experimentError(
        'Experiment matrix exceeds the safety limit of ' + MAX_EXPERIMENT_RUNS + ' runs.',
        'EXPERIMENT_TOO_LARGE'
      );
    }
  }

  let matrix = [{}];
  for (const name of names) {
    const next = [];
    for (const row of matrix) {
      for (const value of variations[name]) {
        next.push({ ...row, [name]: value });
      }
    }
    matrix = next;
  }

  const branches = [];
  for (const seed of normalizedSeeds) {
    for (const row of matrix) {
      branches.push({
        index: branches.length,
        seed,
        parameters: { ...parameters, ...row }
      });
    }
  }
  if (branches.length > MAX_EXPERIMENT_RUNS) {
    throw experimentError(
      'Experiment matrix exceeds the safety limit of ' + MAX_EXPERIMENT_RUNS + ' runs.',
      'EXPERIMENT_TOO_LARGE'
    );
  }
  return branches;
}

function validateExperimentInput({
  project,
  script,
  inputs,
  parameters,
  variations,
  seeds,
  device,
  timeoutMs,
  scriptArgs,
  name,
  hypothesis
}) {
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw experimentError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  if (!fs.statSync(script, { throwIfNoEntry: false })?.isFile()) {
    throw experimentError('Experiment script does not exist: ' + script, 'SIMULATION_SCRIPT_NOT_FOUND');
  }
  const projectReal = fs.realpathSync(project);
  if (!isPathInside(projectReal, fs.realpathSync(script))) {
    throw experimentError(
      'Experiment script resolves outside the project root.',
      'PATH_OUTSIDE_ROOT'
    );
  }
  if (path.extname(script).toLowerCase() !== '.py') {
    throw experimentError('Recorded experiments currently require a .py script.', 'INVALID_ARGUMENT');
  }
  if (!DEVICE_PATTERN.test(String(device ?? ''))) {
    throw experimentError('Device must be auto, cpu, cuda, or cuda:N.', 'INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 86_400_000) {
    throw experimentError('Timeout must be between 1 and 86400 seconds.', 'INVALID_ARGUMENT');
  }
  if (name !== null && (typeof name !== 'string' || !name.trim() || name.length > 200)) {
    throw experimentError('Experiment name must be 1 through 200 characters.', 'INVALID_ARGUMENT');
  }
  if (
    hypothesis !== null &&
    (typeof hypothesis !== 'string' || !hypothesis.trim() || hypothesis.length > 4_000)
  ) {
    throw experimentError('Hypothesis must be 1 through 4000 characters.', 'INVALID_ARGUMENT');
  }
  for (const input of inputs) {
    if (!fs.statSync(input, { throwIfNoEntry: false })?.isFile()) {
      throw experimentError('Declared experiment input is not a regular file: ' + input, 'INVALID_INPUT');
    }
    if (!isPathInside(projectReal, fs.realpathSync(input))) {
      throw experimentError(
        'Declared experiment input resolves outside the project root.',
        'PATH_OUTSIDE_ROOT'
      );
    }
  }
  const persisted = safeJson(
    { parameters, variations, seeds, scriptArgs, name, hypothesis },
    'Experiment configuration'
  );
  const findings = scanSecrets(persisted);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in experiment configuration; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const sourceFindings = scanSecrets(fs.readFileSync(script, 'utf8'));
  if (sourceFindings.length) {
    throw Object.assign(
      new Error('Potential secret detected in experiment source; refusing to archive or execute it.'),
      { code: 'SECRET_DETECTED', findings: sourceFindings }
    );
  }
}

function inputMetadata(project, inputs) {
  return inputs.map((file) => ({
    path: relativePortable(project, file),
    sha256: sha256File(file),
    bytes: fs.statSync(file).size
  }));
}

function experimentsDirectory(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'experiments');
}

export function resolveExperimentDirectory(cwd, experimentId) {
  if (
    !EXPERIMENT_ID_PATTERN.test(String(experimentId ?? '')) ||
    experimentId === '.' ||
    experimentId === '..'
  ) {
    throw experimentError(
      'Invalid experiment ID: ' + String(experimentId ?? ''),
      'INVALID_EXPERIMENT_ID'
    );
  }
  return path.join(experimentsDirectory(cwd), experimentId);
}

export function getExperimentManifest(cwd, experimentId) {
  const directory = resolveExperimentDirectory(cwd, experimentId);
  const file = path.join(directory, 'manifest.json');
  if (!fs.existsSync(file)) {
    throw experimentError('Experiment not found: ' + experimentId, 'EXPERIMENT_NOT_FOUND');
  }
  return readJson(file);
}

function readSimulationSummary(runDirectory, manifest) {
  const name = 'artifacts/summary.json';
  if (!manifest.artifacts?.[name]) return null;
  try {
    return readJson(path.join(runDirectory, name));
  } catch {
    return null;
  }
}

function extractFinalStatistics(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  if (summary.final_statistics && typeof summary.final_statistics === 'object'
    && !Array.isArray(summary.final_statistics)) {
    return summary.final_statistics;
  }
  if (summary.classification !== 'surface_graph_heat_diffusion_not_volumetric_fea'
    || !summary.final || typeof summary.final !== 'object' || Array.isArray(summary.final)) {
    return null;
  }
  const minimum = summary.final.minimum_c;
  const mean = summary.final.mean_c;
  const maximum = summary.final.maximum_c;
  const delta = summary.integration?.last_maximum_delta_c;
  if (![minimum, mean, maximum].every(Number.isFinite)) return null;
  return {
    final_minimum_c: minimum,
    final_mean_c: mean,
    final_maximum_c: maximum,
    final_range_c: maximum - minimum,
    ...(Number.isFinite(delta) ? { last_maximum_delta_c: delta } : {})
  };
}

function csvValue(value) {
  if (value === undefined || value === null) return '';
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return '"' + raw.replace(/"/g, '""') + '"';
}

function experimentSummaryCsv(results) {
  const parameterNames = [...new Set(results.flatMap((result) => Object.keys(result.parameters ?? {})))].sort();
  const statisticNames = [...new Set(
    results.flatMap((result) => Object.keys(result.final_statistics ?? {}))
  )].sort();
  const headers = [
    'branch_index',
    'simulation_id',
    'status',
    'verified',
    'seed',
    'device',
    'duration_ms',
    ...parameterNames.map((name) => 'parameter.' + name),
    ...statisticNames.map((name) => 'statistic.' + name)
  ];
  const rows = [headers.map(csvValue).join(',')];
  for (const result of results) {
    rows.push([
      result.branch_index,
      result.simulation_id,
      result.status,
      result.verified,
      result.seed,
      result.device,
      result.duration_ms,
      ...parameterNames.map((name) => result.parameters?.[name]),
      ...statisticNames.map((name) => result.final_statistics?.[name])
    ].map(csvValue).join(','));
  }
  return rows.join('\n') + '\n';
}

function numericAggregates(results) {
  const values = new Map();
  for (const result of results) {
    for (const [name, value] of Object.entries(result.final_statistics ?? {})) {
      if (!Number.isFinite(value)) continue;
      if (!values.has(name)) values.set(name, []);
      values.get(name).push(value);
    }
  }
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, samples]) => {
        const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        const variance = samples.length > 1
          ? samples.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (samples.length - 1)
          : 0;
        return [name, {
          count: samples.length,
          min: Math.min(...samples),
          max: Math.max(...samples),
          mean,
          sample_standard_deviation: Math.sqrt(variance)
        }];
      })
  );
}

function quantityStatisticsReview(results) {
  const diagnostics = [];
  const groups = new Map();
  for (const result of results) {
    const statistics = result.final_statistics;
    if (statistics === undefined || statistics === null) continue;
    if (!statistics || typeof statistics !== 'object' || Array.isArray(statistics) ||
        Object.getPrototypeOf(statistics) !== Object.prototype) {
      diagnostics.push({
        branch_index: result.branch_index,
        statistic: null,
        issue: 'final_statistics_not_object'
      });
      continue;
    }
    for (const [name, value] of Object.entries(statistics)) {
      if (!PARAMETER_PATTERN.test(name) || FORBIDDEN_PARAMETER_NAMES.has(name)) {
        diagnostics.push({
          branch_index: result.branch_index,
          statistic: null,
          issue: 'invalid_statistic_name'
        });
        continue;
      }
      try {
        const quantity = normalizeQuantity(value, 'Statistic ' + name);
        const parsed = parseUnit(quantity.unit);
        if (!groups.has(name)) {
          groups.set(name, {
            compatibility_key: parsed.compatibility_key,
            canonical_unit: parsed.canonical_unit,
            dimension: parsed.dimension,
            values: [],
            source_units: new Set(),
            invalid: false
          });
        }
        const group = groups.get(name);
        if (group.compatibility_key !== parsed.compatibility_key) {
          group.invalid = true;
          diagnostics.push({
            branch_index: result.branch_index,
            statistic: name,
            issue: 'incompatible_statistic_dimension'
          });
          continue;
        }
        const converted = convertQuantity(quantity, group.canonical_unit, 'Statistic ' + name);
        group.values.push(converted.value);
        group.source_units.add(quantity.unit);
      } catch (error) {
        diagnostics.push({
          branch_index: result.branch_index,
          statistic: name,
          issue: error.code === 'UNIT_DIMENSION_MISMATCH'
            ? 'incompatible_statistic_dimension'
            : error.code === 'INVALID_UNIT'
              ? 'invalid_statistic_unit'
              : 'invalid_statistic_quantity'
        });
      }
    }
  }
  const aggregates = {};
  for (const [name, group] of [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (group.invalid || !group.values.length) continue;
    const mean = group.values.reduce((sum, value) => sum + value, 0) / group.values.length;
    const variance = group.values.length > 1
      ? group.values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) /
        (group.values.length - 1)
      : 0;
    if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
      diagnostics.push({
        branch_index: null,
        statistic: name,
        issue: 'quantity_aggregate_nonfinite'
      });
      continue;
    }
    aggregates[name] = {
      count: group.values.length,
      min: Math.min(...group.values),
      max: Math.max(...group.values),
      mean,
      unit: group.canonical_unit,
      dimension: group.dimension,
      sample_standard_deviation: Math.sqrt(variance),
      sample_standard_deviation_unit: differenceUnitFor(group.canonical_unit),
      source_units: [...group.source_units].sort()
    };
  }
  return { ok: diagnostics.length === 0, diagnostics, aggregates };
}

export function buildExperimentReview(
  results,
  expectedRuns = results.length,
  { quantityMode = false } = {}
) {
  const completed = results.filter((result) => result.status === 'completed').length;
  const verified = results.filter((result) => result.verified === true).length;
  const executed = results.filter((result) => result.simulation_id).length;
  const quantityReview = quantityMode ? quantityStatisticsReview(results) : null;
  const checks = [
    {
      name: 'all_branches_executed',
      ok: executed === expectedRuns,
      expected: expectedRuns,
      actual: executed
    },
    {
      name: 'all_branches_completed',
      ok: completed === expectedRuns,
      expected: expectedRuns,
      actual: completed
    },
    {
      name: 'all_simulations_verified',
      ok: verified === expectedRuns,
      expected: expectedRuns,
      actual: verified
    },
    {
      name: 'finite_numeric_summaries',
      ok: results.every((result) => Object.values(result.final_statistics ?? {})
        .every((value) => typeof value !== 'number' || Number.isFinite(value)))
    },
    ...(quantityMode ? [{
      name: 'valid_typed_quantity_summaries',
      ok: quantityReview.ok,
      diagnostics: quantityReview.diagnostics.length
    }] : [])
  ];
  const failedChecks = checks.filter((check) => !check.ok);
  return {
    schema_version: quantityMode ? EXPERIMENT_REVIEW_SCHEMA_VERSION : 1,
    reviewer: 'sciencecode-deterministic-reviewer',
    verdict: failedChecks.length === 0 ? 'pass' : completed > 0 ? 'warn' : 'fail',
    checks,
    numeric_aggregates: numericAggregates(results),
    ...(quantityMode ? {
      quantity_aggregates: quantityReview.aggregates,
      quantity_diagnostics: quantityReview.diagnostics
    } : {}),
    findings: failedChecks.map((check) => ({
      severity: check.name === 'finite_numeric_summaries' ||
        check.name === 'valid_typed_quantity_summaries' ? 'error' : 'warning',
      check: check.name,
      message: 'Automated experiment check did not pass.'
    }))
  };
}

function artifactMetadata(directory, names) {
  return Object.fromEntries(names.map((name) => {
    const file = path.join(directory, name);
    return [name, { sha256: sha256File(file), bytes: fs.statSync(file).size }];
  }));
}

function prepareExperimentRun({
  cwd,
  packageRoot,
  script,
  seeds = [0],
  device = 'auto',
  timeoutMs = 3_600_000,
  parameters = {},
  variations = {},
  scriptArgs = [],
  inputs = [],
  name = null,
  hypothesis = null,
  analysisContractId = null,
  cadBuildId = null,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime,
  probeRunner
}) {
  const project = path.resolve(cwd);
  const source = resolveInsideRoot(project, script);
  const declaredInputs = inputs.map((value) => resolveInsideRoot(project, value));
  const branches = buildExperimentBranches({ seeds, parameters, variations });
  validateExperimentInput({
    project,
    script: source,
    inputs: declaredInputs,
    parameters,
    variations,
    seeds,
    device,
    timeoutMs,
    scriptArgs,
    name,
    hypothesis
  });
  const cad = resolveCadSimulationParent(project, cadBuildId);

  const analysisContract = analysisContractId
    ? getAnalysisContractBinding(project, analysisContractId)
    : null;
  if (analysisContract && analysisContract.script_sha256 !== sha256File(source)) {
    throw experimentError(
      'Experiment script does not match the frozen analysis contract.',
      'ANALYSIS_CONTRACT_SCRIPT_MISMATCH'
    );
  }

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

  const scienceDirectory = ensureScienceDir(project);
  const id = makeRunId();
  const directory = path.join(scienceDirectory, 'experiments', id);
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  const sourceText = fs.readFileSync(source, 'utf8');
  const started = new Date();
  const plan = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    experiment_id: id,
    created_at: started.toISOString(),
    name,
    hypothesis,
    analysis_contract: analysisContract,
    cad_parent: cad.parent,
    script: {
      path: relativePortable(project, source),
      sha256: sha256Text(sourceText)
    },
    device_request: device,
    timeout_ms_per_branch: timeoutMs,
    seeds: [...new Set(branches.map((branch) => branch.seed))],
    fixed_parameters: parameters,
    variations,
    script_arguments: scriptArgs,
    inputs: inputMetadata(project, declaredInputs),
    branches,
    execution: 'sequential',
    max_runs: MAX_EXPERIMENT_RUNS,
    preservation_policy: 'append-only; experiment plans and branch records are never overwritten'
  };
  writeJsonExclusive(path.join(directory, 'plan.json'), plan);
  const planHash = sha256File(path.join(directory, 'plan.json'));
  const manifest = {
    schema_version: EXPERIMENT_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    experiment_id: id,
    started_at: started.toISOString(),
    status: 'running',
    name,
    hypothesis,
    analysis_contract: analysisContract,
    cad_parent: cad.parent,
    script: plan.script,
    plan_sha256: planHash,
    branch_count: branches.length,
    preservation_policy: plan.preservation_policy
  };
  writeJsonExclusive(path.join(directory, 'manifest.json'), manifest);
  appendAudit(project, {
    type: 'experiment.started',
    experiment_id: id,
    script: plan.script.path,
    script_sha256: plan.script.sha256,
    plan_sha256: planHash,
    branches: branches.length,
    analysis_contract_id: analysisContract?.analysis_contract_id ?? null,
    analysis_contract_sha256: analysisContract?.manifest_sha256 ?? null,
    cad_build_id: cad.parent?.build_id ?? null,
    cad_project_id: cad.parent?.cad_project_id ?? null,
    cad_mesh_sha256: cad.parent?.mesh_sha256 ?? null
  });

  return {
    project,
    packageRoot,
    source,
    declaredInputs,
    branches,
    cad,
    analysisContract,
    compute,
    id,
    directory,
    plan,
    planHash,
    manifest,
    started,
    device,
    timeoutMs,
    scriptArgs,
    env,
    scienceCodeHome
  };
}

function experimentBranchResult(project, branch, simulation, device) {
  const summary = readSimulationSummary(simulation.runDirectory, simulation.manifest);
  const verification = verifySimulation(project, simulation.manifest.simulation_id);
  return {
    branch_index: branch.index,
    simulation_id: simulation.manifest.simulation_id,
    status: simulation.manifest.status,
    verified: verification.ok,
    seed: branch.seed,
    parameters: branch.parameters,
    device: simulation.manifest.context?.device?.selected ?? device,
    duration_ms: simulation.manifest.duration_ms,
    exit_code: simulation.manifest.exit_code,
    final_statistics: extractFinalStatistics(summary),
    summary
  };
}

function unlaunchedBranchResult(branch, status, message) {
  return {
    branch_index: branch.index,
    simulation_id: null,
    status,
    verified: false,
    seed: branch.seed,
    parameters: branch.parameters,
    device: null,
    duration_ms: null,
    final_statistics: null,
    error: message
  };
}

function finalizeExperimentRun(prepared, results, {
  cancelled = false,
  cancellationReason = null
} = {}) {
  const {
    project,
    id,
    directory,
    branches,
    manifest,
    started,
    analysisContract,
    cad
  } = prepared;

  const quantityMode = analysisContract?.schema_version ===
    ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION;
  const review = buildExperimentReview(results, branches.length, { quantityMode });
  writeJsonExclusive(path.join(directory, 'results.json'), {
    schema_version: quantityMode ? EXPERIMENT_RESULTS_SCHEMA_VERSION : 1,
    experiment_id: id,
    ...(quantityMode ? { measurement_mode: 'typed_quantity' } : {}),
    results
  });
  writeTextExclusive(path.join(directory, 'summary.csv'), experimentSummaryCsv(results));
  writeJsonExclusive(path.join(directory, 'review.json'), review);
  const finished = new Date();
  manifest.finished_at = finished.toISOString();
  manifest.duration_ms = finished.getTime() - started.getTime();
  manifest.status = cancelled
    ? 'cancelled'
    : review.verdict === 'pass' ? 'completed' : 'failed';
  if (cancelled) {
    const reason = redactText(String(cancellationReason ?? 'user_requested'))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    manifest.cancellation = {
      reason: reason || 'user_requested',
      cancelled_at: finished.toISOString(),
      partial_branches_preserved: true
    };
  }
  manifest.counts = {
    planned: branches.length,
    executed: results.filter((result) => result.simulation_id).length,
    completed: results.filter((result) => result.status === 'completed').length,
    verified: results.filter((result) => result.verified).length
  };
  manifest.review = {
    verdict: review.verdict,
    findings: review.findings.length,
    ...(quantityMode ? {
      schema_version: review.schema_version,
      measurement_mode: 'typed_quantity'
    } : {})
  };
  manifest.simulations = results.map((result) => ({
    branch_index: result.branch_index,
    simulation_id: result.simulation_id,
    status: result.status,
    verified: result.verified,
    seed: result.seed,
    parameters: result.parameters
  }));
  manifest.artifacts = artifactMetadata(directory, [
    'plan.json',
    'results.json',
    'summary.csv',
    'review.json'
  ]);
  writeJson(path.join(directory, 'manifest.json'), manifest);
  const manifestHash = sha256File(path.join(directory, 'manifest.json'));
  writeTextExclusive(path.join(directory, 'manifest.sha256'), manifestHash + '\n');
  appendAudit(project, {
    type: 'experiment.finished',
    experiment_id: id,
    status: manifest.status,
    manifest_sha256: manifestHash,
    planned: manifest.counts.planned,
    completed: manifest.counts.completed,
    verified: manifest.counts.verified,
    review_verdict: review.verdict,
    analysis_contract_id: analysisContract?.analysis_contract_id ?? null,
    analysis_contract_sha256: analysisContract?.manifest_sha256 ?? null,
    cad_build_id: cad.parent?.build_id ?? null,
    cad_project_id: cad.parent?.cad_project_id ?? null,
    cad_mesh_sha256: cad.parent?.mesh_sha256 ?? null
  });
  const verification = verifyExperiment(project, id);
  return {
    manifest,
    manifest_sha256: manifestHash,
    experimentDirectory: directory,
    results,
    review,
    verification
  };
}

export function runExperiment({
  cwd,
  packageRoot,
  script,
  seeds = [0],
  device = 'auto',
  timeoutMs = 3_600_000,
  parameters = {},
  variations = {},
  scriptArgs = [],
  inputs = [],
  name = null,
  hypothesis = null,
  analysisContractId = null,
  cadBuildId = null,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime,
  runner,
  gpuProbe
}) {
  const prepared = prepareExperimentRun({
    cwd,
    packageRoot,
    script,
    seeds,
    device,
    timeoutMs,
    parameters,
    variations,
    scriptArgs,
    inputs,
    name,
    hypothesis,
    analysisContractId,
    cadBuildId,
    env,
    scienceCodeHome,
    runtime,
    probeRunner: runner
  });
  const results = [];
  let abort = false;
  for (const branch of prepared.branches) {
    if (abort) {
      results.push(unlaunchedBranchResult(
        branch,
        'not_run',
        'A prior branch could not be launched.'
      ));
      continue;
    }
    try {
      const simulation = runSimulation({
        cwd: prepared.project,
        packageRoot: prepared.packageRoot,
        script: prepared.source,
        seed: branch.seed,
        device: prepared.device,
        timeoutMs: prepared.timeoutMs,
        parameters: branch.parameters,
        scriptArgs: prepared.scriptArgs,
        inputs: prepared.declaredInputs,
        env: prepared.env,
        scienceCodeHome: prepared.scienceCodeHome,
        runtime: prepared.compute,
        runner,
        gpuProbe,
        cadBuildId: prepared.cad.parent?.build_id ?? null,
        experiment: {
          experiment_id: prepared.id,
          branch_index: branch.index,
          branch_count: prepared.branches.length,
          plan_sha256: prepared.planHash
        }
      });
      results.push(experimentBranchResult(
        prepared.project,
        branch,
        simulation,
        prepared.device
      ));
    } catch (error) {
      results.push(unlaunchedBranchResult(
        branch,
        'launch_error',
        redactText(error.message ?? String(error))
      ));
      abort = true;
    }
  }
  return finalizeExperimentRun(prepared, results);
}

export async function runExperimentAsync({
  cwd,
  packageRoot,
  script,
  seeds = [0],
  device = 'auto',
  timeoutMs = 3_600_000,
  parameters = {},
  variations = {},
  scriptArgs = [],
  inputs = [],
  name = null,
  hypothesis = null,
  analysisContractId = null,
  cadBuildId = null,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runtime,
  runner,
  probeRunner,
  gpuProbe,
  signal,
  onStarted,
  onBranchStarted,
  onBranchFinished,
  onSimulationStarted
}) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Experiment cancelled before launch.'), {
      name: 'AbortError',
      code: 'ABORT_ERR'
    });
  }
  const prepared = prepareExperimentRun({
    cwd,
    packageRoot,
    script,
    seeds,
    device,
    timeoutMs,
    parameters,
    variations,
    scriptArgs,
    inputs,
    name,
    hypothesis,
    analysisContractId,
    cadBuildId,
    env,
    scienceCodeHome,
    runtime,
    probeRunner
  });
  onStarted?.({
    experiment_id: prepared.id,
    experiment_directory: prepared.directory,
    branch_count: prepared.branches.length,
    plan_sha256: prepared.planHash
  });

  const results = [];
  let stop = null;
  for (const branch of prepared.branches) {
    if (signal?.aborted) stop = 'cancelled';
    if (stop) {
      const result = unlaunchedBranchResult(
        branch,
        'not_run',
        stop === 'cancelled'
          ? 'Experiment cancelled before this branch launched.'
          : 'A prior branch could not be launched.'
      );
      results.push(result);
      onBranchFinished?.(result);
      continue;
    }
    onBranchStarted?.({
      branch_index: branch.index,
      branch_count: prepared.branches.length,
      seed: branch.seed,
      parameters: branch.parameters
    });
    try {
      const simulation = await runSimulationAsync({
        cwd: prepared.project,
        packageRoot: prepared.packageRoot,
        script: prepared.source,
        seed: branch.seed,
        device: prepared.device,
        timeoutMs: prepared.timeoutMs,
        parameters: branch.parameters,
        scriptArgs: prepared.scriptArgs,
        inputs: prepared.declaredInputs,
        env: prepared.env,
        scienceCodeHome: prepared.scienceCodeHome,
        runtime: prepared.compute,
        runner,
        probeRunner,
        gpuProbe,
        signal,
        cadBuildId: prepared.cad.parent?.build_id ?? null,
        experiment: {
          experiment_id: prepared.id,
          branch_index: branch.index,
          branch_count: prepared.branches.length,
          plan_sha256: prepared.planHash
        },
        onStarted: (started) => onSimulationStarted?.({
          ...started,
          branch_index: branch.index,
          branch_count: prepared.branches.length
        })
      });
      const result = experimentBranchResult(
        prepared.project,
        branch,
        simulation,
        prepared.device
      );
      results.push(result);
      onBranchFinished?.(result);
      if (simulation.manifest.status === 'cancelled' || signal?.aborted) {
        stop = 'cancelled';
      }
    } catch (error) {
      const cancelled = signal?.aborted || error?.name === 'AbortError' ||
        error?.code === 'ABORT_ERR';
      const result = unlaunchedBranchResult(
        branch,
        cancelled ? 'not_run' : 'launch_error',
        cancelled
          ? 'Experiment cancelled before this branch created a record.'
          : redactText(error.message ?? String(error))
      );
      results.push(result);
      onBranchFinished?.(result);
      stop = cancelled ? 'cancelled' : 'launch_error';
    }
  }
  return finalizeExperimentRun(prepared, results, {
    cancelled: stop === 'cancelled' || signal?.aborted,
    cancellationReason: signal?.reason
  });
}

export function listExperiments(cwd) {
  const directory = experimentsDirectory(cwd);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const manifest = getExperimentManifest(cwd, entry.name);
        return {
          experiment_id: entry.name,
          status: manifest.status ?? 'unknown',
          name: manifest.name ?? null,
          hypothesis: manifest.hypothesis ?? null,
          script: manifest.script?.path ?? null,
          branch_count: manifest.branch_count ?? 0,
          completed: manifest.counts?.completed ?? 0,
          verified: manifest.counts?.verified ?? 0,
          review_verdict: manifest.review?.verdict ?? null,
          analysis_contract_id: manifest.analysis_contract?.analysis_contract_id ?? null,
          cad_parent: manifest.cad_parent ?? null,
          started_at: manifest.started_at ?? null,
          finished_at: manifest.finished_at ?? null
        };
      } catch (error) {
        return { experiment_id: entry.name, status: 'invalid', error: error.message };
      }
    })
    .sort((left, right) => right.experiment_id.localeCompare(left.experiment_id));
}

export function verifyExperiment(cwd, experimentId) {
  const errors = [];
  let directory;
  let manifest;
  try {
    directory = resolveExperimentDirectory(cwd, experimentId);
    manifest = getExperimentManifest(cwd, experimentId);
  } catch (error) {
    return {
      ok: false,
      experiment_id: experimentId,
      errors: [{ issue: error.code ?? 'experiment_error', detail: error.message }]
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
      errors.push({
        file: 'manifest.json',
        issue: 'hash_mismatch',
        expected,
        actual: actualManifestHash
      });
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
      errors.push({
        file: name,
        issue: 'size_mismatch',
        expected: metadata.bytes,
        actual: fs.statSync(file).size
      });
    }
  }

  const planFile = path.join(directory, 'plan.json');
  let plan = null;
  if (!fs.existsSync(planFile)) {
    errors.push({ file: 'plan.json', issue: 'missing' });
  } else {
    const actualPlanHash = sha256File(planFile);
    if (actualPlanHash !== manifest.plan_sha256) {
      errors.push({
        file: 'plan.json',
        issue: 'plan_hash_mismatch',
        expected: manifest.plan_sha256,
        actual: actualPlanHash
      });
    }
    try {
      plan = readJson(planFile);
    } catch (error) {
      errors.push({ file: 'plan.json', issue: 'invalid_json', detail: error.message });
    }
  }

  let resultDocument = null;
  let review = null;
  try {
    resultDocument = readJson(path.join(directory, 'results.json'));
  } catch (error) {
    errors.push({ file: 'results.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    review = readJson(path.join(directory, 'review.json'));
  } catch (error) {
    errors.push({ file: 'review.json', issue: 'invalid_json', detail: error.message });
  }
  if (plan && plan.experiment_id !== experimentId) {
    errors.push({ file: 'plan.json', issue: 'experiment_id_mismatch' });
  }
  if (plan && JSON.stringify(plan.analysis_contract ?? null) !==
      JSON.stringify(manifest.analysis_contract ?? null)) {
    errors.push({ file: 'plan.json', issue: 'analysis_contract_link_mismatch' });
  }
  if (plan && JSON.stringify(plan.cad_parent ?? null) !==
      JSON.stringify(manifest.cad_parent ?? null)) {
    errors.push({ file: 'plan.json', issue: 'cad_parent_link_mismatch' });
  }
  if (manifest.cad_parent !== undefined && manifest.cad_parent !== null) {
    const parent = manifest.cad_parent;
    if (!parent || typeof parent !== 'object' || Array.isArray(parent) ||
        typeof parent.build_id !== 'string' ||
        typeof parent.cad_project_id !== 'string' ||
        typeof parent.manifest_sha256 !== 'string' ||
        typeof parent.mesh_path !== 'string' ||
        typeof parent.mesh_sha256 !== 'string') {
      errors.push({ file: 'manifest.json', issue: 'cad_parent_malformed' });
    } else {
      try {
        const resolved = resolveCadSimulationParent(path.resolve(cwd), parent.build_id);
        if (JSON.stringify(resolved.parent) !== JSON.stringify(parent)) {
          errors.push({ file: 'manifest.json', issue: 'cad_parent_digest_mismatch' });
        }
      } catch (error) {
        errors.push({
          file: 'manifest.json',
          issue: 'cad_parent_invalid',
          detail: error.message
        });
      }
    }
  }
  if (manifest.analysis_contract) {
    try {
      const binding = getAnalysisContractBinding(
        cwd,
        manifest.analysis_contract.analysis_contract_id
      );
      if (JSON.stringify(binding) !== JSON.stringify(manifest.analysis_contract)) {
        errors.push({ file: 'manifest.json', issue: 'analysis_contract_digest_mismatch' });
      }
      if (binding.script_sha256 !== manifest.script?.sha256) {
        errors.push({ file: 'manifest.json', issue: 'analysis_contract_script_mismatch' });
      }
      if (Date.parse(binding.created_at) > Date.parse(manifest.started_at)) {
        errors.push({ file: 'manifest.json', issue: 'analysis_contract_not_prospective' });
      }
    } catch (error) {
      errors.push({
        file: 'manifest.json',
        issue: error.code ?? 'analysis_contract_invalid',
        detail: error.message
      });
    }
  }
  const plannedBranches = Array.isArray(plan?.branches) ? plan.branches : [];
  const aggregateResults = Array.isArray(resultDocument?.results) ? resultDocument.results : [];
  if (plan && !Array.isArray(plan.branches)) {
    errors.push({ file: 'plan.json', issue: 'invalid_branches' });
  }
  if (resultDocument && !Array.isArray(resultDocument.results)) {
    errors.push({ file: 'results.json', issue: 'invalid_results' });
  }
  if (plan && plannedBranches.length !== manifest.branch_count) {
    errors.push({
      file: 'plan.json',
      issue: 'branch_count_mismatch',
      expected: manifest.branch_count,
      actual: plannedBranches.length
    });
  }
  if (resultDocument && resultDocument.experiment_id !== experimentId) {
    errors.push({ file: 'results.json', issue: 'experiment_id_mismatch' });
  }
  const quantityMode = plan?.analysis_contract?.schema_version ===
    ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION;
  const expectedResultsSchema = quantityMode ? EXPERIMENT_RESULTS_SCHEMA_VERSION : 1;
  if (resultDocument && resultDocument.schema_version !== expectedResultsSchema) {
    errors.push({ file: 'results.json', issue: 'unsupported_results_schema' });
  }
  if (quantityMode && resultDocument?.measurement_mode !== 'typed_quantity') {
    errors.push({ file: 'results.json', issue: 'measurement_mode_mismatch' });
  }
  if (resultDocument && review) {
    const recomputed = buildExperimentReview(aggregateResults, manifest.branch_count, {
      quantityMode
    });
    if (JSON.stringify(recomputed) !== JSON.stringify(review)) {
      errors.push({ file: 'review.json', issue: 'review_calculation_mismatch' });
    }
  }

  const branchIndexes = new Set();
  const simulationIds = new Set();
  const simulationLinks = Array.isArray(manifest.simulations) ? manifest.simulations : [];
  if (!Array.isArray(manifest.simulations)) {
    errors.push({ file: 'manifest.json', issue: 'invalid_simulation_links' });
  }
  for (const link of simulationLinks) {
    if (branchIndexes.has(link.branch_index)) {
      errors.push({ branch_index: link.branch_index, issue: 'duplicate_branch_index' });
    }
    branchIndexes.add(link.branch_index);
    const planned = plannedBranches.find((branch) => branch.index === link.branch_index);
    const aggregate = aggregateResults.find(
      (result) => result.branch_index === link.branch_index
    );
    if (!planned) {
      errors.push({ branch_index: link.branch_index, issue: 'branch_missing_from_plan' });
    } else if (
      planned.seed !== link.seed ||
      JSON.stringify(planned.parameters) !== JSON.stringify(link.parameters)
    ) {
      errors.push({ branch_index: link.branch_index, issue: 'plan_branch_mismatch' });
    }
    if (!aggregate) {
      errors.push({ branch_index: link.branch_index, issue: 'branch_missing_from_results' });
    } else if (
      aggregate.simulation_id !== link.simulation_id ||
      aggregate.status !== link.status ||
      aggregate.seed !== link.seed ||
      JSON.stringify(aggregate.parameters) !== JSON.stringify(link.parameters)
    ) {
      errors.push({ branch_index: link.branch_index, issue: 'result_branch_mismatch' });
    }
    if (!link.simulation_id) {
      continue;
    }
    if (simulationIds.has(link.simulation_id)) {
      errors.push({
        branch_index: link.branch_index,
        simulation_id: link.simulation_id,
        issue: 'duplicate_simulation_link'
      });
    }
    simulationIds.add(link.simulation_id);
    const verification = verifySimulation(cwd, link.simulation_id);
    if (!verification.ok) {
      errors.push({
        branch_index: link.branch_index,
        simulation_id: link.simulation_id,
        issue: 'simulation_invalid',
        errors: verification.errors
      });
      continue;
    }
    const simulationManifest = verification.manifest;
    if (
      simulationManifest.experiment?.experiment_id !== experimentId ||
      simulationManifest.experiment?.branch_index !== link.branch_index ||
      simulationManifest.experiment?.branch_count !== manifest.branch_count ||
      simulationManifest.experiment?.plan_sha256 !== manifest.plan_sha256
    ) {
      errors.push({
        branch_index: link.branch_index,
        simulation_id: link.simulation_id,
        issue: 'simulation_link_mismatch'
      });
    }
    if (JSON.stringify(simulationManifest.cad_parent ?? null) !==
        JSON.stringify(manifest.cad_parent ?? null)) {
      errors.push({
        branch_index: link.branch_index,
        simulation_id: link.simulation_id,
        issue: 'simulation_cad_parent_mismatch'
      });
    }
    if (
      simulationManifest.seed !== link.seed ||
      simulationManifest.status !== link.status ||
      JSON.stringify(simulationManifest.parameters) !== JSON.stringify(link.parameters)
    ) {
      errors.push({
        branch_index: link.branch_index,
        simulation_id: link.simulation_id,
        issue: 'simulation_branch_mismatch'
      });
    }
  }
  if (branchIndexes.size !== manifest.branch_count) {
    errors.push({
      issue: 'recorded_branch_count_mismatch',
      expected: manifest.branch_count,
      actual: branchIndexes.size
    });
  }

  const audit = verifyAudit(cwd);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const finish = readAuditRecords(cwd).findLast(
      (record) => record.type === 'experiment.finished' && record.experiment_id === experimentId
    );
    if (!finish) {
      errors.push({ issue: 'missing_audit_event' });
    } else if (finish.manifest_sha256 !== actualManifestHash) {
      errors.push({
        issue: 'audit_manifest_mismatch',
        expected: finish.manifest_sha256 ?? null,
        actual: actualManifestHash
      });
    } else if (
      (finish.analysis_contract_id ?? null) !==
        (manifest.analysis_contract?.analysis_contract_id ?? null) ||
      (finish.analysis_contract_sha256 ?? null) !==
        (manifest.analysis_contract?.manifest_sha256 ?? null)
    ) {
      errors.push({ issue: 'audit_analysis_contract_mismatch' });
    } else if (
      (finish.cad_build_id ?? null) !== (manifest.cad_parent?.build_id ?? null) ||
      (finish.cad_project_id ?? null) !==
        (manifest.cad_parent?.cad_project_id ?? null) ||
      (finish.cad_mesh_sha256 ?? null) !==
        (manifest.cad_parent?.mesh_sha256 ?? null)
    ) {
      errors.push({ issue: 'audit_cad_parent_mismatch' });
    }
  }
  return {
    ok: errors.length === 0,
    experiment_id: experimentId,
    manifest,
    manifest_sha256: actualManifestHash,
    errors
  };
}
