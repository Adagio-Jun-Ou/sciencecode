import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import { sha256Buffer, sha256File, sha256Json } from './hash.js';
import { verifyPreregistration } from './preregistration.js';
import { scanSecrets } from './security.js';
import {
  INFERENCE_SIDEDNESS,
  INFERENCE_TESTS,
  RANK_BASED_INFERENCE_TESTS,
  MULTIPLICITY_CORRECTIONS,
  STATISTICS_ENGINE_NAME,
  STATISTICS_ENGINE_VERSION,
  SUPPORTED_STATISTICS_ENGINE_VERSIONS
} from './statistics.js';
import {
  SUPPORTED_UNIT_ENGINE_VERSIONS,
  UNIT_ENGINE_NAME,
  UNIT_ENGINE_VERSION,
  convertQuantity,
  normalizeUnitDeclaration
} from './units.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  relativePortable,
  resolveInsideRoot,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

export const ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION = 2;
export const ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION = 3;
export const ANALYSIS_CONTRACT_SCHEMA_VERSION = ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION;
export const ANALYSIS_CONTRACT_LEGACY_SCHEMA_VERSION = 1;
const SUPPORTED_SCHEMA_VERSIONS = [
  ANALYSIS_CONTRACT_LEGACY_SCHEMA_VERSION,
  ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION,
  ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION
];
export const MAX_ANALYSIS_CONTRACTS = 10_000;
export const MAX_ANALYSIS_OUTCOMES = 32;
export const MAX_ANALYSIS_SCRIPT_BYTES = 8 * 1024 * 1024;
export const MAX_ANALYSIS_SPEC_BYTES = 512 * 1024;

const CONTRACT_ID_PATTERN = /^analysis-contract-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUTCOME_ID_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const PARAMETER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const ROLES = new Set(['primary', 'secondary', 'exploratory']);
const AGGREGATIONS = new Set(['mean', 'median', 'minimum', 'maximum']);
const MISSING_POLICIES = new Set(['fail', 'exclude_after_minimum_count']);
const OPERATORS = new Set([
  'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal',
  'between_inclusive', 'outside_inclusive'
]);
const TOP_LEVEL_KEYS = new Set([
  'schema_version', 'name', 'hypothesis', 'preregistration_id', 'script', 'analysis_population',
  'conditions', 'missing_data_policy', 'multiplicity_policy', 'multiplicity_correction',
  'outcomes', 'sensitivity_analyses', 'exclusions', 'notes'
]);
const OUTCOME_KEYS = new Set([
  'outcome_id', 'role', 'label', 'statistic', 'variable', 'unit', 'timepoint',
  'summary_measure', 'intercurrent_event_strategy', 'aggregation',
  'minimum_count', 'filter', 'decision_rule', 'inference'
]);
const RULE_KEYS = new Set(['operator', 'value', 'lower', 'upper']);
const INFERENCE_KEYS = new Set([
  'test', 'sidedness', 'alpha', 'null_value', 'group_parameter', 'group_a', 'group_b',
  'pair_parameter', 'equivalence_lower', 'equivalence_upper'
]);

function contractError(message, code = 'INVALID_ANALYSIS_CONTRACT') {
  return Object.assign(new Error(message), { code });
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw contractError(label + ' must be a JSON object.');
  }
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw contractError('Unknown ' + label + ' field: ' + key);
  }
}

function boundedText(value, label, limit, { optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw contractError(label + ' is required.');
  }
  const text = String(value).replace(/\r\n/g, '\n').trim();
  if (text.length > limit) throw contractError(label + ' must be ' + limit + ' characters or fewer.');
  return text;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw contractError(label + ' must be a finite JSON number.');
  }
  return value;
}

function normalizeJsonValue(value, label, maximumBytes = 16 * 1024) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw contractError(label + ' must be JSON serializable: ' + error.message);
  }
  if (encoded === undefined || Buffer.byteLength(encoded) > maximumBytes) {
    throw contractError(label + ' must be a bounded JSON value.');
  }
  return JSON.parse(encoded);
}

function normalizeFilter(value) {
  if (value === undefined || value === null) return {};
  assertPlainObject(value, 'Outcome filter');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!PARAMETER_PATTERN.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw contractError('Invalid outcome filter parameter: ' + key);
    }
    result[key] = normalizeJsonValue(value[key], 'Outcome filter value');
  }
  return result;
}

function normalizeDecisionQuantity(value, label, unit) {
  const converted = convertQuantity(value, unit.symbol, label);
  return { value: converted.value, unit: converted.unit };
}

function normalizeInference(value, unit, outcomeId, minimumCount) {
  if (value === undefined || value === null) return null;
  assertPlainObject(value, 'Outcome ' + outcomeId + ' inference');
  rejectUnknownKeys(value, INFERENCE_KEYS, 'inference');
  const test = String(value.test ?? '');
  if (!INFERENCE_TESTS.includes(test)) {
    throw contractError('Outcome ' + outcomeId + ' inference test is unsupported: ' + test);
  }
  const sidedness = String(value.sidedness ?? '');
  if (!INFERENCE_SIDEDNESS.includes(sidedness)) {
    throw contractError('Outcome ' + outcomeId + ' inference sidedness is unsupported.');
  }
  const alpha = value.alpha;
  if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw contractError('Outcome ' + outcomeId +
      ' inference alpha must be a number strictly between 0 and 1.');
  }
  if (minimumCount < 2) {
    throw contractError('Outcome ' + outcomeId +
      ' minimum_count must be at least 2 when an inference is declared.');
  }
  if (['welch_t_two_sample', 'student_t_paired', 'mann_whitney_u', 'wilcoxon_signed_rank']
    .includes(String(value.test ?? '')) && minimumCount < 4) {
    throw contractError('Outcome ' + outcomeId +
      ' minimum_count must be at least 4 for a two-sample or paired inference, ' +
      'since each group needs at least two observations.');
  }
  const nullValue = normalizeDecisionQuantity(
    value.null_value,
    'Outcome ' + outcomeId + ' inference null value',
    unit
  );
  // A rank test has no equivalence formulation here: it compares orderings,
  // not distances from a margin, so a margin claim cannot be expressed in it.
  if (RANK_BASED_INFERENCE_TESTS.includes(test) && sidedness === 'equivalence') {
    throw contractError('Outcome ' + outcomeId +
      ' rank-based tests do not support equivalence sidedness.');
  }
  if (test === 'wilcoxon_signed_rank' && value.pair_parameter === undefined) {
    throw contractError('Outcome ' + outcomeId +
      ' wilcoxon_signed_rank requires a pair_parameter.');
  }
  let equivalence = null;
  if (sidedness === 'equivalence') {
    // One bound expresses non-inferiority (lower margin only) or
    // non-superiority (upper margin only); both express two-sided equivalence.
    if (value.equivalence_lower === undefined && value.equivalence_upper === undefined) {
      throw contractError('Outcome ' + outcomeId +
        ' equivalence inference requires equivalence_lower, equivalence_upper, or both.');
    }
    const lower = value.equivalence_lower === undefined
      ? null
      : normalizeDecisionQuantity(value.equivalence_lower,
        'Outcome ' + outcomeId + ' equivalence lower bound', unit);
    const upper = value.equivalence_upper === undefined
      ? null
      : normalizeDecisionQuantity(value.equivalence_upper,
        'Outcome ' + outcomeId + ' equivalence upper bound', unit);
    if (lower && upper && !(lower.value < upper.value)) {
      throw contractError('Outcome ' + outcomeId +
        ' equivalence lower bound must be strictly below the upper bound.');
    }
    if (lower && nullValue.value <= lower.value) {
      throw contractError('Outcome ' + outcomeId +
        ' equivalence lower bound must lie below the declared null value.');
    }
    if (upper && nullValue.value >= upper.value) {
      throw contractError('Outcome ' + outcomeId +
        ' equivalence upper bound must lie above the declared null value.');
    }
    // A two-bound decision reports the 1 - 2*alpha interval, which does not
    // exist once alpha reaches one half. A single margin reports the one-sided
    // 1 - alpha interval and carries no such restriction. Rejecting at freeze
    // time keeps the assessment of an already-frozen contract from throwing.
    if (lower && upper && alpha >= 0.5) {
      throw contractError('Outcome ' + outcomeId +
        ' two-bound equivalence alpha must be below 0.5, because the reported ' +
        'interval is at 1 - 2*alpha.');
    }
    equivalence = {
      ...(lower ? { lower } : {}),
      ...(upper ? { upper } : {}),
      kind: lower && upper ? 'equivalence' : lower ? 'non_inferiority' : 'non_superiority'
    };
  } else if (value.equivalence_lower !== undefined ||
      value.equivalence_upper !== undefined) {
    throw contractError('Outcome ' + outcomeId +
      ' equivalence bounds require sidedness "equivalence".');
  }
  const grouped = ['welch_t_two_sample', 'student_t_paired',
    'mann_whitney_u', 'wilcoxon_signed_rank'].includes(test);
  if (!grouped) {
    if (value.group_parameter !== undefined || value.group_a !== undefined ||
        value.group_b !== undefined || value.pair_parameter !== undefined) {
      throw contractError('Outcome ' + outcomeId +
        ' one-sample inference must not declare comparison groups or pairing.');
    }
    return {
      test, sidedness, alpha, null_value: nullValue,
      ...(equivalence ? { equivalence } : {})
    };
  }
  let pairParameter = null;
  if (test === 'student_t_paired' || test === 'wilcoxon_signed_rank') {
    pairParameter = String(value.pair_parameter ?? '');
    if (!PARAMETER_PATTERN.test(pairParameter) ||
        ['__proto__', 'prototype', 'constructor'].includes(pairParameter)) {
      throw contractError('Outcome ' + outcomeId +
        ' paired inference requires a valid pair_parameter.');
    }
    if (pairParameter === String(value.group_parameter ?? '')) {
      throw contractError('Outcome ' + outcomeId +
        ' pair_parameter must differ from group_parameter; pairing on the arm ' +
        'itself can never align the two arms.');
    }
  } else if (value.pair_parameter !== undefined) {
    throw contractError('Outcome ' + outcomeId +
      ' pair_parameter is only valid for a paired inference.');
  }
  const groupParameter = String(value.group_parameter ?? '');
  if (!PARAMETER_PATTERN.test(groupParameter) ||
      ['__proto__', 'prototype', 'constructor'].includes(groupParameter)) {
    throw contractError('Outcome ' + outcomeId +
      ' two-sample inference requires a valid group_parameter.');
  }
  if (value.group_a === undefined || value.group_b === undefined) {
    throw contractError('Outcome ' + outcomeId +
      ' two-sample inference requires group_a and group_b values.');
  }
  const groupA = normalizeJsonValue(value.group_a, 'Inference group_a value');
  const groupB = normalizeJsonValue(value.group_b, 'Inference group_b value');
  if (sha256Json(groupA) === sha256Json(groupB)) {
    throw contractError('Outcome ' + outcomeId +
      ' two-sample inference groups must differ.');
  }
  return {
    test,
    sidedness,
    alpha,
    null_value: nullValue,
    group_parameter: groupParameter,
    group_a: groupA,
    group_b: groupB,
    ...(pairParameter ? { pair_parameter: pairParameter } : {}),
    ...(equivalence ? { equivalence } : {})
  };
}

function normalizeDecisionRule(value, schemaVersion = 1, unit = null) {
  assertPlainObject(value, 'Outcome decision_rule');
  rejectUnknownKeys(value, RULE_KEYS, 'decision_rule');
  const operator = String(value.operator ?? '');
  if (!OPERATORS.has(operator)) {
    throw contractError('Outcome decision_rule operator is unsupported: ' + operator);
  }
  if (operator === 'between_inclusive' || operator === 'outside_inclusive') {
    if (schemaVersion >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION) {
      const lower = normalizeDecisionQuantity(value.lower, 'Decision lower bound', unit);
      const upper = normalizeDecisionQuantity(value.upper, 'Decision upper bound', unit);
      if (lower.value > upper.value) {
        throw contractError('Decision lower bound must not exceed the upper bound.');
      }
      return { operator, lower, upper };
    }
    const lower = finiteNumber(value.lower, 'Decision lower bound');
    const upper = finiteNumber(value.upper, 'Decision upper bound');
    if (lower > upper) throw contractError('Decision lower bound must not exceed the upper bound.');
    return { operator, lower, upper };
  }
  if (schemaVersion >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION) {
    return {
      operator,
      value: normalizeDecisionQuantity(value.value, 'Decision threshold', unit)
    };
  }
  return { operator, value: finiteNumber(value.value, 'Decision threshold') };
}

function normalizeOutcome(value, index, schemaVersion = 1) {
  assertPlainObject(value, 'Outcome ' + (index + 1));
  rejectUnknownKeys(value, OUTCOME_KEYS, 'outcome');
  const outcomeId = String(value.outcome_id ?? '');
  if (!OUTCOME_ID_PATTERN.test(outcomeId)) {
    throw contractError('Outcome ' + (index + 1) + ' has an invalid outcome_id.');
  }
  const role = String(value.role ?? '');
  if (!ROLES.has(role)) throw contractError('Outcome ' + outcomeId + ' has an invalid role.');
  const statistic = String(value.statistic ?? '');
  if (!PARAMETER_PATTERN.test(statistic) ||
      ['__proto__', 'prototype', 'constructor'].includes(statistic)) {
    throw contractError('Outcome ' + outcomeId + ' has an invalid statistic key.');
  }
  const aggregation = String(value.aggregation ?? '');
  if (!AGGREGATIONS.has(aggregation)) {
    throw contractError('Outcome ' + outcomeId + ' has an unsupported aggregation.');
  }
  const minimumCount = Number(value.minimum_count);
  if (!Number.isSafeInteger(minimumCount) || minimumCount < 1 || minimumCount > 64) {
    throw contractError('Outcome ' + outcomeId + ' minimum_count must be from 1 through 64.');
  }
  let unit;
  try {
    unit = schemaVersion >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION
      ? normalizeUnitDeclaration(value.unit, 'Outcome ' + outcomeId + ' unit')
      : boundedText(value.unit, 'Outcome unit', 120);
  } catch (error) {
    if (error.code === 'INVALID_UNIT' || error.code === 'INVALID_QUANTITY' ||
        error.code === 'UNIT_DIMENSION_MISMATCH') {
      throw contractError(error.message);
    }
    throw error;
  }
  let decisionRule;
  let inference = null;
  try {
    decisionRule = normalizeDecisionRule(value.decision_rule, schemaVersion, unit);
    if (schemaVersion >= ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION) {
      inference = normalizeInference(value.inference, unit, outcomeId, minimumCount);
    } else if (value.inference !== undefined) {
      throw contractError('Outcome ' + outcomeId +
        ' inference requires analysis contract schema_version 3.');
    }
  } catch (error) {
    if (error.code === 'INVALID_UNIT' || error.code === 'INVALID_QUANTITY' ||
        error.code === 'UNIT_DIMENSION_MISMATCH') {
      throw contractError(error.message);
    }
    throw error;
  }
  return {
    outcome_id: outcomeId,
    role,
    label: boundedText(value.label, 'Outcome label', 240),
    statistic,
    variable: boundedText(value.variable, 'Outcome variable', 500),
    unit,
    timepoint: boundedText(value.timepoint, 'Outcome timepoint', 500),
    summary_measure: boundedText(value.summary_measure, 'Outcome summary measure', 800),
    intercurrent_event_strategy: boundedText(
      value.intercurrent_event_strategy,
      'Outcome intercurrent-event strategy',
      1_200
    ),
    aggregation,
    minimum_count: minimumCount,
    filter: normalizeFilter(value.filter),
    decision_rule: decisionRule,
    ...(inference ? { inference } : {})
  };
}

function resolveAnalysisContractSchemaVersion(value, expectedVersion = null) {
  const explicit = value.schema_version;
  const selected = explicit ?? expectedVersion ?? ANALYSIS_CONTRACT_LEGACY_SCHEMA_VERSION;
  if (!Number.isSafeInteger(selected) || !SUPPORTED_SCHEMA_VERSIONS.includes(selected)) {
    throw contractError('Analysis contract schema_version must be 1, 2, or 3.');
  }
  if (expectedVersion !== null && selected !== expectedVersion) {
    throw contractError('Analysis contract request schema_version does not match its manifest.');
  }
  return selected;
}

export function normalizeAnalysisContractSpec(value, { schemaVersion = null } = {}) {
  assertPlainObject(value, 'Analysis contract');
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, 'analysis contract');
  const resolvedSchemaVersion = resolveAnalysisContractSchemaVersion(value, schemaVersion);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_ANALYSIS_SPEC_BYTES) {
    throw contractError('Analysis contract exceeds the ' + MAX_ANALYSIS_SPEC_BYTES + '-byte limit.',
      'ANALYSIS_CONTRACT_TOO_LARGE');
  }
  const findings = scanSecrets(encoded);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in analysis contract; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const preregistrationId = String(value.preregistration_id ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(preregistrationId)) {
    throw contractError('Analysis contract requires a valid preregistration_id.');
  }
  const script = boundedText(value.script, 'Analysis script path', 500);
  if (path.extname(script).toLowerCase() !== '.py') {
    throw contractError('Analysis contracts currently bind to a Python experiment script.');
  }
  const missingDataPolicy = String(value.missing_data_policy ?? '');
  if (!MISSING_POLICIES.has(missingDataPolicy)) {
    throw contractError('missing_data_policy must be fail or exclude_after_minimum_count.');
  }
  if (!Array.isArray(value.outcomes) || value.outcomes.length < 1 ||
      value.outcomes.length > MAX_ANALYSIS_OUTCOMES) {
    throw contractError('Analysis contract requires 1 through ' + MAX_ANALYSIS_OUTCOMES + ' outcomes.');
  }
  const outcomes = value.outcomes.map((outcome, index) =>
    normalizeOutcome(outcome, index, resolvedSchemaVersion));
  if (new Set(outcomes.map((outcome) => outcome.outcome_id)).size !== outcomes.length) {
    throw contractError('Analysis outcome IDs must be unique.');
  }
  if (!outcomes.some((outcome) => outcome.role === 'primary')) {
    throw contractError('Analysis contract requires at least one primary outcome.');
  }
  const sensitivities = value.sensitivity_analyses ?? [];
  if (!Array.isArray(sensitivities) || sensitivities.length > 32) {
    throw contractError('sensitivity_analyses must contain at most 32 entries.');
  }
  const inferential = resolvedSchemaVersion === ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION;
  let multiplicityCorrection = null;
  if (inferential) {
    if (!outcomes.some((outcome) => outcome.inference && outcome.role === 'primary')) {
      throw contractError(
        'Schema version 3 requires at least one primary outcome with a declared ' +
        'inference, so the multiplicity-correction family cannot be empty; ' +
        'use schema version 2 for threshold-only contracts.'
      );
    }
    multiplicityCorrection = String(value.multiplicity_correction ?? '');
    if (!MULTIPLICITY_CORRECTIONS.includes(multiplicityCorrection)) {
      throw contractError(
        'multiplicity_correction must be none, bonferroni, or holm_bonferroni.'
      );
    }
  } else if (value.multiplicity_correction !== undefined) {
    throw contractError('multiplicity_correction requires analysis contract schema_version 3.');
  }
  return {
    ...(resolvedSchemaVersion >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION
      ? { schema_version: resolvedSchemaVersion }
      : {}),
    name: boundedText(value.name, 'Analysis contract name', 240),
    hypothesis: boundedText(value.hypothesis, 'Analysis hypothesis', 4_000),
    preregistration_id: preregistrationId,
    script: script.replace(/\\/g, '/').replace(/^(?:\.\/)+/, ''),
    analysis_population: boundedText(value.analysis_population, 'Analysis population', 2_000),
    conditions: boundedText(value.conditions, 'Conditions or comparisons', 2_000),
    missing_data_policy: missingDataPolicy,
    multiplicity_policy: boundedText(value.multiplicity_policy, 'Multiplicity policy', 2_000),
    ...(multiplicityCorrection ? { multiplicity_correction: multiplicityCorrection } : {}),
    outcomes,
    sensitivity_analyses: sensitivities.map((item, index) =>
      boundedText(item, 'Sensitivity analysis ' + (index + 1), 1_000)),
    exclusions: boundedText(value.exclusions, 'Exclusions', 2_000),
    notes: boundedText(value.notes, 'Analysis notes', 2_000, { optional: true })
  };
}

export function makeAnalysisContractId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'analysis-contract-' + stamp + '-' + crypto.randomBytes(4).toString('hex');
}

function contractsRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  const metadata = path.join(project, INTERNAL_DIR);
  const root = path.join(metadata, 'analysis-contracts');
  const verifyDirectory = (directory, parent, label) => {
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw contractError(label + ' must be a real project directory.',
        'INVALID_ANALYSIS_CONTRACT_PATH');
    }
    const parentReal = fs.realpathSync(parent);
    const directoryReal = fs.realpathSync(directory);
    if (!isPathInside(parentReal, directoryReal)) {
      throw contractError(label + ' escapes the project metadata root.',
        'INVALID_ANALYSIS_CONTRACT_PATH');
    }
    return directoryReal;
  };
  if (fs.existsSync(metadata)) {
    const projectReal = fs.realpathSync(project);
    const metadataStat = fs.lstatSync(metadata);
    if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() ||
        !isPathInside(projectReal, fs.realpathSync(metadata))) {
      throw contractError('ScienceCode metadata storage escapes the project.',
        'INVALID_ANALYSIS_CONTRACT_PATH');
    }
  }
  if (create) {
    ensureScienceDir(project);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  if (fs.existsSync(root)) return verifyDirectory(root, metadata, 'Analysis contract storage');
  return root;
}

function normalizeContractId(value) {
  const id = String(value ?? '');
  if (!CONTRACT_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw contractError('Invalid analysis contract ID: ' + id, 'INVALID_ANALYSIS_CONTRACT_ID');
  }
  return id;
}

export function resolveAnalysisContractDirectory(cwd, value) {
  return path.join(contractsRoot(cwd), normalizeContractId(value));
}

function contractFiles(cwd, value) {
  const directory = resolveAnalysisContractDirectory(cwd, value);
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    contract: path.join(directory, 'contract.json'),
    request: path.join(directory, 'request.json'),
    script: path.join(directory, 'script.py')
  };
}

function safeContractFiles(cwd, value) {
  const files = contractFiles(cwd, value);
  const root = contractsRoot(cwd);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw contractError('Analysis contract not found: ' + normalizeContractId(value),
      'ANALYSIS_CONTRACT_NOT_FOUND');
  }
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(root, directoryReal)) {
    throw contractError('Analysis contract escapes its storage root.',
      'INVALID_ANALYSIS_CONTRACT_PATH');
  }
  return { ...files, directory: directoryReal };
}

function safeRegularFile(file, directory) {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return Boolean(stat?.isFile() && !stat.isSymbolicLink() &&
      isPathInside(directory, fs.realpathSync(file)));
  } catch {
    return false;
  }
}

function validateChat(cwd, value) {
  if (value === undefined || value === null || value === '') return null;
  const chatId = String(value);
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw contractError('Invalid chat ID: ' + chatId, 'INVALID_CHAT_ID');
  }
  try {
    getChatManifest(cwd, chatId);
  } catch {
    throw contractError('Chat not found: ' + chatId, 'CHAT_NOT_FOUND');
  }
  return chatId;
}

function writeBufferExclusive(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fileDescriptor(file) {
  return { sha256: sha256File(file), bytes: fs.statSync(file).size };
}

function safeRemoveStaging(root, staging) {
  if (!isPathInside(root, staging) || path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith('.staging-analysis-contract-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function contractIds(cwd) {
  const ids = new Set();
  try {
    const root = contractsRoot(cwd);
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (CONTRACT_ID_PATTERN.test(entry.name)) ids.add(entry.name);
      }
    }
  } catch {
    // Audit discovery below still exposes previously created records, whose
    // verification will report the unsafe storage root.
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'analysis_contract.created' &&
          CONTRACT_ID_PATTERN.test(String(record.analysis_contract_id ?? ''))) {
        ids.add(record.analysis_contract_id);
      }
    }
  } catch {
    // Project verification reports an unreadable audit log. Audit-discovered
    // IDs make removed immutable records visible whenever the log is readable.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

function resolveSourceScript(project, relative) {
  const source = resolveInsideRoot(project, relative);
  const portable = relativePortable(project, source);
  if (portable === INTERNAL_DIR || portable.startsWith(INTERNAL_DIR + '/')) {
    throw contractError('Analysis script must be a research-project file outside .sciencecode.');
  }
  const stat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw contractError('Analysis script is not a regular project file: ' + relative,
      'ANALYSIS_SCRIPT_NOT_FOUND');
  }
  const projectReal = fs.realpathSync(project);
  const sourceReal = fs.realpathSync(source);
  if (!isPathInside(projectReal, sourceReal) || !fs.statSync(sourceReal).isFile()) {
    throw contractError('Analysis script escapes the project through a filesystem link.',
      'INVALID_ANALYSIS_CONTRACT_PATH');
  }
  const bytes = fs.statSync(sourceReal).size;
  if (bytes > MAX_ANALYSIS_SCRIPT_BYTES) {
    throw contractError('Analysis script exceeds the ' + MAX_ANALYSIS_SCRIPT_BYTES + '-byte limit.',
      'ANALYSIS_SCRIPT_TOO_LARGE');
  }
  const content = fs.readFileSync(sourceReal);
  const findings = scanSecrets(content.toString('utf8'));
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in analysis script; refusing to freeze it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return {
    file: sourceReal,
    relative: portable,
    content,
    sha256: sha256Buffer(content),
    bytes
  };
}

export function createAnalysisContract({
  cwd,
  spec,
  chatId = null,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw contractError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw contractError('Analysis contract timestamp is invalid.');
  }
  const normalizedChatId = validateChat(project, chatId);
  const submitted = normalizeJsonValue(spec, 'Analysis contract', MAX_ANALYSIS_SPEC_BYTES);
  const contract = normalizeAnalysisContractSpec(submitted);
  const schemaVersion = contract.schema_version ?? ANALYSIS_CONTRACT_LEGACY_SCHEMA_VERSION;
  const preregistration = verifyPreregistration(project, contract.preregistration_id);
  if (!preregistration.ok) {
    throw Object.assign(
      new Error('Linked preregistration failed integrity verification.'),
      { code: 'ANALYSIS_PREREGISTRATION_INVALID', verification: preregistration }
    );
  }
  const preregistrationTime = Date.parse(preregistration.record.created_at);
  if (!Number.isFinite(preregistrationTime) || now.getTime() < preregistrationTime) {
    throw contractError(
      'Analysis contract must be frozen at or after its linked preregistration.',
      'ANALYSIS_CONTRACT_NOT_AFTER_PREREGISTRATION'
    );
  }
  const script = resolveSourceScript(project, contract.script);
  contract.script = script.relative;
  submitted.script = script.relative;
  if (contractIds(project).length >= MAX_ANALYSIS_CONTRACTS) {
    throw contractError('Analysis contract limit reached for this project.', 'ANALYSIS_CONTRACT_LIMIT');
  }

  const root = contractsRoot(project, { create: true });
  const id = makeAnalysisContractId(now);
  const finalDirectory = resolveAnalysisContractDirectory(project, id);
  const staging = path.join(
    root,
    '.staging-analysis-contract-' + crypto.randomBytes(8).toString('hex')
  );
  if (fs.existsSync(finalDirectory)) {
    throw contractError('Analysis contract already exists: ' + id, 'ANALYSIS_CONTRACT_EXISTS');
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    writeJsonExclusive(path.join(staging, 'request.json'), submitted);
    writeJsonExclusive(path.join(staging, 'contract.json'), contract);
    writeBufferExclusive(path.join(staging, 'script.py'), script.content);
    const preregistrationRecord = preregistration.record;
    const manifest = {
      schema_version: schemaVersion,
      sciencecode_version: VERSION,
      analysis_contract_id: id,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      name: contract.name,
      status: 'frozen',
      preregistration: {
        preregistration_id: contract.preregistration_id,
        record_sha256: preregistration.record_sha256,
        frozen_sha256: preregistrationRecord.frozen_sha256,
        created_at: preregistrationRecord.created_at
      },
      script: {
        source_path: script.relative,
        source_sha256: script.sha256,
        frozen_file: 'script.py',
        frozen_sha256: script.sha256,
        bytes: script.bytes
      },
      contract: {
        file: 'contract.json',
        ...fileDescriptor(path.join(staging, 'contract.json'))
      },
      request: {
        file: 'request.json',
        ...fileDescriptor(path.join(staging, 'request.json'))
      },
      counts: {
        outcomes: contract.outcomes.length,
        primary: contract.outcomes.filter((outcome) => outcome.role === 'primary').length,
        secondary: contract.outcomes.filter((outcome) => outcome.role === 'secondary').length,
        exploratory: contract.outcomes.filter((outcome) => outcome.role === 'exploratory').length
      },
      ...(schemaVersion >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION ? {
        unit_engine: {
          name: UNIT_ENGINE_NAME,
          version: UNIT_ENGINE_VERSION
        }
      } : {}),
      ...(schemaVersion >= ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION ? {
        statistics_engine: {
          name: STATISTICS_ENGINE_NAME,
          version: STATISTICS_ENGINE_VERSION
        }
      } : {}),
      interpretation: 'A frozen prospective decision contract; it does not establish statistical or regulatory validity.',
      preservation_policy: 'immutable contract, preregistration link, and frozen analysis script'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(path.join(staging, 'manifest.json')) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'analysis_contract.created',
      analysis_contract_id: id,
      chat_id: normalizedChatId,
      preregistration_id: contract.preregistration_id,
      manifest_sha256: manifestSha256,
      contract_sha256: manifest.contract.sha256,
      script_sha256: script.sha256
    });
    return {
      manifest,
      contract,
      manifest_sha256: manifestSha256,
      directory: finalDirectory
    };
  } catch (error) {
    if (fs.existsSync(staging)) safeRemoveStaging(root, staging);
    throw error;
  }
}

export function getAnalysisContractManifest(cwd, value) {
  const id = normalizeContractId(value);
  const files = safeContractFiles(cwd, id);
  if (!safeRegularFile(files.manifest, files.directory)) {
    throw contractError('Analysis contract not found: ' + id, 'ANALYSIS_CONTRACT_NOT_FOUND');
  }
  return readJson(files.manifest);
}

function verifyDescriptor(files, descriptor, expectedFile, errors, label) {
  if (!descriptor || descriptor.file !== expectedFile) {
    errors.push({ file: expectedFile, issue: 'invalid_' + label + '_descriptor' });
    return;
  }
  const file = path.join(files.directory, expectedFile);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!safeRegularFile(file, files.directory)) {
    errors.push({ file: expectedFile, issue: 'missing' });
    return;
  }
  const actual = sha256File(file);
  if (descriptor.sha256 !== actual) {
    errors.push({ file: expectedFile, issue: 'hash_mismatch', expected: descriptor.sha256, actual });
  }
  if (descriptor.bytes !== undefined && descriptor.bytes !== stat.size) {
    errors.push({ file: expectedFile, issue: 'size_mismatch', expected: descriptor.bytes, actual: stat.size });
  }
}

export function verifyAnalysisContract(cwd, value) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeContractId(value);
  } catch (error) {
    return {
      ok: false,
      analysis_contract_id: String(value ?? ''),
      errors: [{ issue: error.code ?? 'analysis_contract_error', detail: error.message }]
    };
  }
  let files;
  try {
    files = safeContractFiles(project, id);
  } catch (error) {
    return {
      ok: false,
      analysis_contract_id: id,
      errors: [{
        issue: error.code === 'ANALYSIS_CONTRACT_NOT_FOUND'
          ? 'analysis_contract_missing'
          : error.code ?? 'invalid_analysis_contract_path',
        detail: error.message
      }]
    };
  }
  const errors = [];
  let manifest = null;
  let contract = null;
  let request = null;
  try {
    if (!safeRegularFile(files.manifest, files.directory)) throw new Error('missing or unsafe file');
    manifest = readJson(files.manifest);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (!safeRegularFile(files.contract, files.directory)) throw new Error('missing or unsafe file');
    contract = readJson(files.contract);
  } catch (error) {
    errors.push({ file: 'contract.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (!safeRegularFile(files.request, files.directory)) throw new Error('missing or unsafe file');
    request = readJson(files.request);
  } catch (error) {
    errors.push({ file: 'request.json', issue: 'invalid_json', detail: error.message });
  }
  const manifestSha256 = safeRegularFile(files.manifest, files.directory)
    ? sha256File(files.manifest)
    : null;
  if (!safeRegularFile(files.digest, files.directory)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else {
    const expected = fs.readFileSync(files.digest, 'utf8').trim();
    if (expected !== manifestSha256) {
      errors.push({
        file: 'manifest.json',
        issue: 'hash_mismatch',
        expected,
        actual: manifestSha256
      });
    }
  }
  if (manifest) {
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schema_version)) {
      errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
    }
    if (manifest.schema_version >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION &&
        (manifest.unit_engine?.name !== UNIT_ENGINE_NAME ||
         !SUPPORTED_UNIT_ENGINE_VERSIONS.includes(manifest.unit_engine?.version))) {
      errors.push({ file: 'manifest.json', issue: 'invalid_unit_engine' });
    }
    if (manifest.schema_version >= ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION &&
        (manifest.statistics_engine?.name !== STATISTICS_ENGINE_NAME ||
         !SUPPORTED_STATISTICS_ENGINE_VERSIONS
           .includes(manifest.statistics_engine?.version))) {
      errors.push({ file: 'manifest.json', issue: 'invalid_statistics_engine' });
    }
    if (manifest.analysis_contract_id !== id) {
      errors.push({ file: 'manifest.json', issue: 'analysis_contract_id_mismatch' });
    }
    if (manifest.status !== 'frozen') {
      errors.push({ file: 'manifest.json', issue: 'invalid_status' });
    }
    verifyDescriptor(files, manifest.contract, 'contract.json', errors, 'contract');
    verifyDescriptor(files, manifest.request, 'request.json', errors, 'request');
    const scriptStat = fs.lstatSync(files.script, { throwIfNoEntry: false });
    if (manifest.script?.frozen_file !== 'script.py') {
      errors.push({ file: 'script.py', issue: 'invalid_script_descriptor' });
    } else if (!safeRegularFile(files.script, files.directory)) {
      errors.push({ file: 'script.py', issue: 'missing' });
    } else {
      const actual = sha256File(files.script);
      if (actual !== manifest.script.frozen_sha256 ||
          actual !== manifest.script.source_sha256) {
        errors.push({
          file: 'script.py',
          issue: 'hash_mismatch',
          expected: manifest.script.frozen_sha256,
          actual
        });
      }
      if (manifest.script.bytes !== undefined && manifest.script.bytes !== scriptStat.size) {
        errors.push({
          file: 'script.py',
          issue: 'size_mismatch',
          expected: manifest.script.bytes,
          actual: scriptStat.size
        });
      }
    }
  }
  if (request && contract) {
    try {
      const replayed = normalizeAnalysisContractSpec(request, {
        schemaVersion: manifest?.schema_version ?? null
      });
      if (sha256Json(replayed) !== sha256Json(contract)) {
        errors.push({ file: 'contract.json', issue: 'normalization_replay_mismatch' });
      }
    } catch (error) {
      errors.push({
        file: 'request.json',
        issue: error.code ?? 'normalization_replay_failed',
        detail: error.message
      });
    }
  }
  if (manifest && contract) {
    if ((contract.schema_version ?? ANALYSIS_CONTRACT_LEGACY_SCHEMA_VERSION) !==
        manifest.schema_version) {
      errors.push({ file: 'contract.json', issue: 'contract_schema_mismatch' });
    }
    if (manifest.name !== contract.name) {
      errors.push({ file: 'manifest.json', issue: 'contract_name_mismatch' });
    }
    if (manifest.preregistration?.preregistration_id !== contract.preregistration_id) {
      errors.push({ file: 'manifest.json', issue: 'preregistration_id_mismatch' });
    }
    if (manifest.script?.source_path !== contract.script) {
      errors.push({ file: 'manifest.json', issue: 'script_path_mismatch' });
    }
    const expectedCounts = {
      outcomes: contract.outcomes?.length ?? 0,
      primary: (contract.outcomes ?? []).filter((outcome) => outcome.role === 'primary').length,
      secondary: (contract.outcomes ?? []).filter((outcome) => outcome.role === 'secondary').length,
      exploratory: (contract.outcomes ?? []).filter((outcome) => outcome.role === 'exploratory').length
    };
    if (sha256Json(manifest.counts) !== sha256Json(expectedCounts)) {
      errors.push({ file: 'manifest.json', issue: 'outcome_counts_mismatch' });
    }
  }

  let preregistration = null;
  if (manifest?.preregistration?.preregistration_id) {
    preregistration = verifyPreregistration(
      project,
      manifest.preregistration.preregistration_id
    );
    if (!preregistration.ok) {
      errors.push({
        issue: 'linked_preregistration_invalid',
        preregistration_id: manifest.preregistration.preregistration_id,
        errors: preregistration.errors
      });
    } else {
      if (preregistration.record_sha256 !== manifest.preregistration.record_sha256) {
        errors.push({ issue: 'preregistration_record_mismatch' });
      }
      if (preregistration.record?.frozen_sha256 !== manifest.preregistration.frozen_sha256) {
        errors.push({ issue: 'preregistration_frozen_mismatch' });
      }
    }
  } else if (manifest) {
    errors.push({ file: 'manifest.json', issue: 'preregistration_missing' });
  }

  let sourceStatus = 'missing';
  if (manifest?.script?.source_path) {
    try {
      const source = resolveInsideRoot(project, manifest.script.source_path);
      const stat = fs.lstatSync(source, { throwIfNoEntry: false });
      if (stat?.isFile() && !stat.isSymbolicLink()) {
        const projectReal = fs.realpathSync(project);
        const sourceReal = fs.realpathSync(source);
        sourceStatus = isPathInside(projectReal, sourceReal)
          ? sha256File(sourceReal) === manifest.script.source_sha256 ? 'unchanged' : 'modified'
          : 'invalid';
      }
    } catch {
      sourceStatus = 'invalid';
    }
  }

  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else if (manifest) {
    const event = readAuditRecords(project).findLast((record) =>
      record.type === 'analysis_contract.created' &&
      record.analysis_contract_id === id
    );
    if (!event) {
      errors.push({ issue: 'missing_audit_event' });
    } else {
      if (event.manifest_sha256 !== manifestSha256) {
        errors.push({
          issue: 'audit_manifest_mismatch',
          expected: event.manifest_sha256 ?? null,
          actual: manifestSha256
        });
      }
      if (event.contract_sha256 !== manifest.contract?.sha256) {
        errors.push({ issue: 'audit_contract_mismatch' });
      }
      if (event.script_sha256 !== manifest.script?.frozen_sha256) {
        errors.push({ issue: 'audit_script_mismatch' });
      }
      if (event.preregistration_id !== manifest.preregistration?.preregistration_id) {
        errors.push({ issue: 'audit_preregistration_mismatch' });
      }
    }
  }
  return {
    ok: errors.length === 0,
    analysis_contract_id: id,
    manifest,
    contract,
    manifest_sha256: manifestSha256,
    contract_sha256: manifest?.contract?.sha256 ?? null,
    source_status: sourceStatus,
    preregistration,
    errors
  };
}

export function getAnalysisContract(cwd, value) {
  const id = normalizeContractId(value);
  const verification = verifyAnalysisContract(cwd, id);
  if (!verification.manifest || !verification.contract) {
    throw contractError('Analysis contract not found: ' + id, 'ANALYSIS_CONTRACT_NOT_FOUND');
  }
  return {
    manifest: verification.manifest,
    contract: verification.contract,
    verification
  };
}

export function listAnalysisContracts(cwd, { chatId, preregistrationId } = {}) {
  return contractIds(cwd).map((id) => {
    const verification = verifyAnalysisContract(cwd, id);
    const manifest = verification.manifest;
    const contract = verification.contract;
    return {
      analysis_contract_id: id,
      name: manifest?.name ?? contract?.name ?? id,
      status: manifest?.status ?? 'invalid',
      verified: verification.ok,
      created_at: manifest?.created_at ?? null,
      chat_id: manifest?.chat_id ?? null,
      preregistration_id: manifest?.preregistration?.preregistration_id ??
        contract?.preregistration_id ?? null,
      script: manifest?.script?.source_path ?? contract?.script ?? null,
      source_status: verification.source_status ?? null,
      schema_version: manifest?.schema_version ?? null,
      unit_engine: manifest?.unit_engine ?? null,
      statistics_engine: manifest?.statistics_engine ?? null,
      counts: manifest?.counts ?? {},
      errors: verification.errors,
      url: '/api/analysis-contracts/' + encodeURIComponent(id)
    };
  }).filter((item) =>
    (!chatId || item.chat_id === chatId) &&
    (!preregistrationId || item.preregistration_id === preregistrationId)
  ).sort((left, right) =>
    String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) ||
    right.analysis_contract_id.localeCompare(left.analysis_contract_id)
  );
}

export function getAnalysisContractBinding(cwd, value) {
  const verification = verifyAnalysisContract(cwd, value);
  if (!verification.ok) {
    throw Object.assign(
      new Error('Analysis contract failed integrity verification.'),
      { code: 'ANALYSIS_CONTRACT_INVALID', verification }
    );
  }
  const binding = {
    analysis_contract_id: verification.analysis_contract_id,
    manifest_sha256: verification.manifest_sha256,
    contract_sha256: verification.contract_sha256,
    created_at: verification.manifest.created_at,
    preregistration_id: verification.manifest.preregistration.preregistration_id,
    preregistration_record_sha256: verification.manifest.preregistration.record_sha256,
    script_sha256: verification.manifest.script.frozen_sha256
  };
  // The binding reports the versions recorded in the verified manifest, which
  // verification has already constrained to the supported sets, so a future
  // engine bump keeps old records readable under their own version.
  if (verification.manifest.schema_version >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION) {
    binding.schema_version = verification.manifest.schema_version;
    binding.unit_engine_version = verification.manifest.unit_engine.version;
  }
  if (verification.manifest.schema_version >= ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION) {
    binding.statistics_engine_version = verification.manifest.statistics_engine.version;
  }
  return binding;
}

export function analysisContractInteractionArtifact(value) {
  const manifest = value.manifest ?? value;
  return {
    kind: 'analysis-contract',
    record_id: manifest.analysis_contract_id,
    name: manifest.name ?? manifest.analysis_contract_id,
    url: '/api/analysis-contracts/' + encodeURIComponent(manifest.analysis_contract_id)
  };
}

export function analysisContractInteractionPayload(value) {
  const manifest = value.manifest ?? value;
  const contract = value.contract ?? {};
  return {
    analysis_contract_id: manifest.analysis_contract_id,
    schema_version: manifest.schema_version ?? ANALYSIS_CONTRACT_LEGACY_SCHEMA_VERSION,
    unit_engine: manifest.unit_engine ?? null,
    statistics_engine: manifest.statistics_engine ?? null,
    status: manifest.status,
    manifest_sha256: value.manifest_sha256 ?? value.verification?.manifest_sha256 ?? null,
    preregistration_id: manifest.preregistration?.preregistration_id ?? contract.preregistration_id,
    script_sha256: manifest.script?.frozen_sha256 ?? null,
    outcome_counts: manifest.counts ?? {},
    primary_outcomes: (contract.outcomes ?? [])
      .filter((outcome) => outcome.role === 'primary')
      .slice(0, MAX_ANALYSIS_OUTCOMES)
      .map((outcome) => ({
        outcome_id: outcome.outcome_id,
        label: outcome.label,
        statistic: outcome.statistic,
        unit: outcome.unit,
        aggregation: outcome.aggregation,
        minimum_count: outcome.minimum_count,
        decision_rule: outcome.decision_rule,
        ...(outcome.inference ? { inference: outcome.inference } : {})
      })),
    instruction: 'Use this exact frozen contract when launching and assessing the confirmatory experiment; disclose every deviation.'
  };
}
