import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from './constants.js';
import { sha256Buffer, sha256Json, sha256Text } from './hash.js';
import { extractScientificClaims } from './reviews.js';

export const BENCHMARK_MANIFEST_SCHEMA_VERSION = 1;
export const BENCHMARK_RUN_SCHEMA_VERSION = 1;
export const BENCHMARK_REPORT_SCHEMA_VERSION = 1;
export const SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER =
  'sciencecode_reviewer_citation_requirement_v1';
export const MAX_BENCHMARK_CASES = 50_000;
export const MAX_BENCHMARK_BASELINES = 8;
export const MAX_BENCHMARK_MANIFEST_BYTES = 1024 * 1024;
export const MAX_BENCHMARK_CASE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_BENCHMARK_LABEL_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_BENCHMARK_RUN_BYTES = 32 * 1024 * 1024;

const MAX_CASE_TEXT_BYTES = 64 * 1024;
const MAX_JSONL_LINE_BYTES = 256 * 1024;
const CONFIDENCE_LEVEL = 0.95;
const WILSON_Z = 1.959963984540054;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const VERSION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function benchmarkError(message, code = 'INVALID_BENCHMARK') {
  return Object.assign(new Error(message), { code });
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, optional, label) {
  if (!plainObject(value)) throw benchmarkError(label + ' must be a JSON object.');
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) {
    throw benchmarkError(label + ' contains unknown field(s): ' + unknown.join(', ') + '.');
  }
  if (missing.length) {
    throw benchmarkError(label + ' is missing field(s): ' + missing.join(', ') + '.');
  }
}

function boundedText(value, label, { min = 1, max = 4096, multiline = false } = {}) {
  if (typeof value !== 'string') throw benchmarkError(label + ' must be text.');
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes < min || bytes > max) {
    throw benchmarkError(label + ' must be from ' + min + ' through ' + max + ' UTF-8 bytes.');
  }
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (controls.test(normalized)) throw benchmarkError(label + ' contains control characters.');
  return normalized;
}

function boundedCaseText(value, label) {
  if (typeof value !== 'string') throw benchmarkError(label + ' must be text.');
  const normalized = value.replace(/\r\n?/g, '\n');
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (!normalized.trim() || bytes > MAX_CASE_TEXT_BYTES) {
    throw benchmarkError(label + ' must contain from 1 through ' +
      MAX_CASE_TEXT_BYTES + ' UTF-8 bytes of nonempty text.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw benchmarkError(label + ' contains control characters.');
  }
  return normalized;
}

function identifier(value, label) {
  const normalized = boundedText(value, label, { max: 128 });
  if (!IDENTIFIER.test(normalized)) {
    throw benchmarkError(label + ' must use lowercase letters, numbers, dots, underscores, or hyphens.');
  }
  return normalized;
}

function versionIdentifier(value, label) {
  const normalized = boundedText(value, label, { max: 128 });
  if (!VERSION_IDENTIFIER.test(normalized)) throw benchmarkError(label + ' is not portable.');
  return normalized;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw benchmarkError(label + ' must be a lowercase SHA-256 digest.');
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw benchmarkError(label + ' must be an integer from ' + minimum + ' through ' + maximum + '.');
  }
  return value;
}

function probability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw benchmarkError(label + ' must be a finite number from 0 through 1.');
  }
  return value;
}

function canonicalIso(value, label) {
  if (typeof value !== 'string') throw benchmarkError(label + ' must be an ISO timestamp.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw benchmarkError(label + ' must be a canonical ISO timestamp.');
  }
  return value;
}

function normalizedNow(value) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (!Number.isFinite(result.getTime())) throw benchmarkError('Benchmark time is invalid.');
  return result;
}

function relativeEscapesRoot(relative) {
  return path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep);
}

function portableFile(value, label, extension) {
  const normalized = boundedText(value, label, { max: 256 });
  if (normalized.includes('\\') || normalized.startsWith('/') ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(normalized)) {
    throw benchmarkError(label + ' must be a portable relative file path.');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw benchmarkError(label + ' must not contain empty, current, or parent segments.');
  }
  if (extension && !normalized.toLowerCase().endsWith(extension)) {
    throw benchmarkError(label + ' must end in ' + extension + '.');
  }
  return normalized;
}

function fileIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

function readStableUtf8File(file, maximumBytes, label) {
  const resolved = path.resolve(file);
  const pathBefore = fs.lstatSync(resolved, { bigint: true, throwIfNoEntry: false });
  if (!pathBefore?.isFile() || pathBefore.isSymbolicLink()) {
    throw benchmarkError(label + ' must be a regular non-link file.');
  }
  if (pathBefore.size > BigInt(maximumBytes)) {
    throw benchmarkError(label + ' exceeds ' + maximumBytes + ' bytes.', 'BENCHMARK_TOO_LARGE');
  }
  const descriptor = fs.openSync(resolved, 'r');
  let bytes;
  try {
    const openedBefore = fs.fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || fileIdentity(openedBefore) !== fileIdentity(pathBefore)) {
      throw benchmarkError(label + ' changed before it could be read.');
    }
    bytes = fs.readFileSync(descriptor);
    const openedAfter = fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = fs.lstatSync(resolved, { bigint: true, throwIfNoEntry: false });
    if (!pathAfter?.isFile() || pathAfter.isSymbolicLink() ||
        fileIdentity(openedBefore) !== fileIdentity(openedAfter) ||
        fileIdentity(openedAfter) !== fileIdentity(pathAfter)) {
      throw benchmarkError(label + ' changed while it was being read.');
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (bytes.length > maximumBytes) {
    throw benchmarkError(label + ' exceeds ' + maximumBytes + ' bytes.', 'BENCHMARK_TOO_LARGE');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw benchmarkError(label + ' must be valid UTF-8.');
  }
  return {
    file: resolved,
    bytes: bytes.length,
    sha256: sha256Buffer(bytes),
    text
  };
}

function parseJsonFile(read, label) {
  try {
    return JSON.parse(read.text);
  } catch {
    throw benchmarkError(label + ' must contain valid JSON.');
  }
}

function safeBundleRoot(manifestFile) {
  const root = path.dirname(manifestFile);
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) throw benchmarkError('Benchmark bundle root is unavailable.');
  return { lexical: root, real: fs.realpathSync(root) };
}

function resolveBundleFile(bundleRoot, relative, maximumBytes, label) {
  const parts = relative.split('/');
  let current = bundleRoot.lexical;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw benchmarkError(label + ' traverses an unsafe bundle directory.');
    }
  }
  const candidate = path.resolve(bundleRoot.lexical, ...parts);
  if (relativeEscapesRoot(path.relative(bundleRoot.lexical, candidate))) {
    throw benchmarkError(label + ' escapes the benchmark bundle.');
  }
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    throw benchmarkError(label + ' is unavailable.');
  }
  if (relativeEscapesRoot(path.relative(bundleRoot.real, real))) {
    throw benchmarkError(label + ' resolves outside the benchmark bundle.');
  }
  return readStableUtf8File(candidate, maximumBytes, label);
}

function validateReference(value, label, extension, maximumCount = MAX_BENCHMARK_CASES) {
  exactKeys(value, ['file', 'sha256', 'count'], [], label);
  return {
    file: portableFile(value.file, label + '.file', extension),
    sha256: sha256(value.sha256, label + '.sha256'),
    count: integer(value.count, label + '.count', 1, maximumCount)
  };
}

function validateGovernance(value) {
  const fields = [
    'independent_from_sciencecode',
    'independent_creator',
    'independence_statement',
    'labeler_count',
    'expertise_statement',
    'labeling_protocol',
    'adjudication_protocol',
    'blinding_protocol',
    'license',
    'source_citation',
    'limitations',
    'corpus_frozen_at',
    'labels_unsealed_at'
  ];
  exactKeys(value, fields, [], 'benchmark.governance');
  if (value.independent_from_sciencecode !== true) {
    throw benchmarkError('benchmark.governance.independent_from_sciencecode must be true.');
  }
  const governance = {
    independent_from_sciencecode: true,
    independent_creator: boundedText(value.independent_creator,
      'benchmark.governance.independent_creator', { min: 2, max: 256 }),
    independence_statement: boundedText(value.independence_statement,
      'benchmark.governance.independence_statement', { min: 20, max: 4096, multiline: true }),
    labeler_count: integer(value.labeler_count, 'benchmark.governance.labeler_count', 2, 10_000),
    expertise_statement: boundedText(value.expertise_statement,
      'benchmark.governance.expertise_statement', { min: 20, max: 4096, multiline: true }),
    labeling_protocol: boundedText(value.labeling_protocol,
      'benchmark.governance.labeling_protocol', { min: 20, max: 8192, multiline: true }),
    adjudication_protocol: boundedText(value.adjudication_protocol,
      'benchmark.governance.adjudication_protocol', { min: 20, max: 8192, multiline: true }),
    blinding_protocol: boundedText(value.blinding_protocol,
      'benchmark.governance.blinding_protocol', { min: 20, max: 8192, multiline: true }),
    license: boundedText(value.license, 'benchmark.governance.license', { min: 2, max: 256 }),
    source_citation: boundedText(value.source_citation,
      'benchmark.governance.source_citation', { min: 8, max: 2048, multiline: true }),
    limitations: boundedText(value.limitations,
      'benchmark.governance.limitations', { min: 20, max: 4096, multiline: true }),
    corpus_frozen_at: canonicalIso(value.corpus_frozen_at,
      'benchmark.governance.corpus_frozen_at'),
    labels_unsealed_at: canonicalIso(value.labels_unsealed_at,
      'benchmark.governance.labels_unsealed_at')
  };
  if (Date.parse(governance.labels_unsealed_at) <= Date.parse(governance.corpus_frozen_at)) {
    throw benchmarkError('Benchmark labels must unseal after the corpus is frozen.');
  }
  return governance;
}

function validateManifest(value) {
  exactKeys(value, [
    'schema_version', 'benchmark_id', 'benchmark_version', 'title', 'description',
    'split', 'task', 'cases', 'labels', 'baselines', 'thresholds', 'governance'
  ], [], 'benchmark manifest');
  if (value.schema_version !== BENCHMARK_MANIFEST_SCHEMA_VERSION) {
    throw benchmarkError('Unsupported benchmark manifest schema version.');
  }
  if (value.split !== 'held_out_test') {
    throw benchmarkError('Benchmark split must be held_out_test.');
  }
  exactKeys(value.task, ['adapter', 'positive_label', 'negative_label'], [], 'benchmark.task');
  if (value.task.adapter !== SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER) {
    throw benchmarkError('Unsupported benchmark task adapter.');
  }
  const positiveLabel = identifier(value.task.positive_label, 'benchmark.task.positive_label');
  const negativeLabel = identifier(value.task.negative_label, 'benchmark.task.negative_label');
  if (positiveLabel === negativeLabel) throw benchmarkError('Benchmark labels must be distinct.');
  const cases = validateReference(value.cases, 'benchmark.cases', '.jsonl');
  const labels = validateReference(value.labels, 'benchmark.labels', '.jsonl');
  if (labels.count !== cases.count) throw benchmarkError('Benchmark case and label counts must match.');
  if (!Array.isArray(value.baselines) || value.baselines.length < 1 ||
      value.baselines.length > MAX_BENCHMARK_BASELINES) {
    throw benchmarkError('Benchmark baselines must contain from 1 through ' +
      MAX_BENCHMARK_BASELINES + ' entries.');
  }
  const baselineIds = new Set();
  const baselineFiles = new Set();
  const baselines = value.baselines.map((entry, index) => {
    const label = 'benchmark.baselines[' + index + ']';
    exactKeys(entry, ['baseline_id', 'run_file', 'run_sha256'], [], label);
    const baseline = {
      baseline_id: identifier(entry.baseline_id, label + '.baseline_id'),
      run_file: portableFile(entry.run_file, label + '.run_file', '.json'),
      run_sha256: sha256(entry.run_sha256, label + '.run_sha256')
    };
    if (baselineIds.has(baseline.baseline_id)) throw benchmarkError('Benchmark baseline IDs must be unique.');
    if (baselineFiles.has(baseline.run_file)) throw benchmarkError('Benchmark baseline files must be unique.');
    baselineIds.add(baseline.baseline_id);
    baselineFiles.add(baseline.run_file);
    return baseline;
  });
  const referencedFiles = [cases.file, labels.file, ...baselines.map((item) => item.run_file)];
  if (new Set(referencedFiles).size !== referencedFiles.length) {
    throw benchmarkError('Benchmark case, label, and baseline files must be distinct.');
  }
  exactKeys(value.thresholds, [
    'minimum_accuracy', 'minimum_precision', 'minimum_recall', 'maximum_abstention_rate'
  ], [], 'benchmark.thresholds');
  return {
    schema_version: BENCHMARK_MANIFEST_SCHEMA_VERSION,
    benchmark_id: identifier(value.benchmark_id, 'benchmark.benchmark_id'),
    benchmark_version: versionIdentifier(value.benchmark_version, 'benchmark.benchmark_version'),
    title: boundedText(value.title, 'benchmark.title', { min: 4, max: 256 }),
    description: boundedText(value.description, 'benchmark.description',
      { min: 20, max: 4096, multiline: true }),
    split: 'held_out_test',
    task: {
      adapter: SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER,
      positive_label: positiveLabel,
      negative_label: negativeLabel
    },
    cases,
    labels,
    baselines,
    thresholds: {
      minimum_accuracy: probability(value.thresholds.minimum_accuracy,
        'benchmark.thresholds.minimum_accuracy'),
      minimum_precision: probability(value.thresholds.minimum_precision,
        'benchmark.thresholds.minimum_precision'),
      minimum_recall: probability(value.thresholds.minimum_recall,
        'benchmark.thresholds.minimum_recall'),
      maximum_abstention_rate: probability(value.thresholds.maximum_abstention_rate,
        'benchmark.thresholds.maximum_abstention_rate')
    },
    governance: validateGovernance(value.governance)
  };
}

function parseJsonLines(read, expectedCount, label, normalizeRecord) {
  const normalized = read.text.replace(/\r\n?/g, '\n');
  const lines = normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
  if (lines.length !== expectedCount || lines.some((line) => !line.trim())) {
    throw benchmarkError(label + ' must contain exactly ' + expectedCount + ' nonempty JSON lines.');
  }
  return lines.map((line, index) => {
    if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
      throw benchmarkError(label + ' line ' + (index + 1) + ' is too large.', 'BENCHMARK_TOO_LARGE');
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw benchmarkError(label + ' line ' + (index + 1) + ' is not valid JSON.');
    }
    return normalizeRecord(parsed, index);
  });
}

function parseCases(read, manifest) {
  if (read.sha256 !== manifest.cases.sha256) throw benchmarkError('Benchmark case-file SHA-256 mismatch.');
  const seen = new Set();
  const cases = parseJsonLines(read, manifest.cases.count, 'Benchmark case file', (value, index) => {
    exactKeys(value, ['case_id', 'text'], ['stratum'], 'benchmark case ' + (index + 1));
    const caseId = identifier(value.case_id, 'benchmark case ' + (index + 1) + '.case_id');
    if (seen.has(caseId)) throw benchmarkError('Benchmark case IDs must be unique.');
    seen.add(caseId);
    const text = boundedCaseText(value.text, 'benchmark case ' + caseId + '.text');
    return {
      case_id: caseId,
      text,
      input_sha256: sha256Text(text),
      stratum: Object.hasOwn(value, 'stratum')
        ? identifier(value.stratum, 'benchmark case ' + caseId + '.stratum')
        : null
    };
  });
  return cases;
}

function parseLabels(read, manifest, cases) {
  if (read.sha256 !== manifest.labels.sha256) throw benchmarkError('Benchmark label-file SHA-256 mismatch.');
  const caseIds = new Set(cases.map((item) => item.case_id));
  const labels = new Map();
  parseJsonLines(read, manifest.labels.count, 'Benchmark label file', (value, index) => {
    exactKeys(value, ['case_id', 'label'], [], 'benchmark label ' + (index + 1));
    const caseId = identifier(value.case_id, 'benchmark label ' + (index + 1) + '.case_id');
    if (!caseIds.has(caseId)) throw benchmarkError('Benchmark label references an unknown case: ' + caseId + '.');
    if (labels.has(caseId)) throw benchmarkError('Benchmark labels contain a duplicate case: ' + caseId + '.');
    if (![manifest.task.positive_label, manifest.task.negative_label].includes(value.label)) {
      throw benchmarkError('Benchmark label for ' + caseId + ' is not declared by the task.');
    }
    labels.set(caseId, value.label);
    return null;
  });
  if (labels.size !== cases.length) throw benchmarkError('Benchmark labels do not cover every case.');
  const positiveCount = [...labels.values()]
    .filter((value) => value === manifest.task.positive_label).length;
  const negativeCount = labels.size - positiveCount;
  if (!positiveCount || !negativeCount) {
    throw benchmarkError('Benchmark labels must contain both declared classes.');
  }
  return labels;
}

function canonicalPredictions(predictions) {
  return predictions
    .map((item) => ({ case_id: item.case_id, label: item.label }))
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
}

function parseRun(read, manifest, cases, label) {
  const value = parseJsonFile(read, label);
  exactKeys(value, [
    'schema_version', 'run_id', 'benchmark', 'system', 'predictions_frozen_at',
    'label_access', 'method', 'predictions', 'predictions_sha256'
  ], [], label);
  if (value.schema_version !== BENCHMARK_RUN_SCHEMA_VERSION) {
    throw benchmarkError(label + ' has an unsupported schema version.', 'INVALID_BENCHMARK_RUN');
  }
  exactKeys(value.benchmark, [
    'benchmark_id', 'benchmark_version', 'cases_sha256', 'labels_sha256'
  ], [], label + '.benchmark');
  const benchmark = {
    benchmark_id: identifier(value.benchmark.benchmark_id, label + '.benchmark.benchmark_id'),
    benchmark_version: versionIdentifier(value.benchmark.benchmark_version,
      label + '.benchmark.benchmark_version'),
    cases_sha256: sha256(value.benchmark.cases_sha256, label + '.benchmark.cases_sha256'),
    labels_sha256: sha256(value.benchmark.labels_sha256, label + '.benchmark.labels_sha256')
  };
  if (benchmark.benchmark_id !== manifest.benchmark_id ||
      benchmark.benchmark_version !== manifest.benchmark_version ||
      benchmark.cases_sha256 !== manifest.cases.sha256 ||
      benchmark.labels_sha256 !== manifest.labels.sha256) {
    throw benchmarkError(label + ' is bound to a different benchmark.', 'INVALID_BENCHMARK_RUN');
  }
  exactKeys(value.system, ['name', 'version', 'adapter'], [], label + '.system');
  const frozenAt = canonicalIso(value.predictions_frozen_at, label + '.predictions_frozen_at');
  if (Date.parse(frozenAt) < Date.parse(manifest.governance.corpus_frozen_at) ||
      Date.parse(frozenAt) >= Date.parse(manifest.governance.labels_unsealed_at)) {
    throw benchmarkError(label + ' was not frozen inside the declared blind window.',
      'INVALID_BENCHMARK_RUN');
  }
  if (value.label_access !== 'unavailable_until_predictions_frozen') {
    throw benchmarkError(label + ' must declare unavailable_until_predictions_frozen label access.',
      'INVALID_BENCHMARK_RUN');
  }
  if (!Array.isArray(value.predictions) || value.predictions.length !== cases.length) {
    throw benchmarkError(label + ' must contain exactly one prediction per case.',
      'INVALID_BENCHMARK_RUN');
  }
  const caseIds = new Set(cases.map((item) => item.case_id));
  const predictions = [];
  const byCase = new Map();
  for (let index = 0; index < value.predictions.length; index += 1) {
    const prediction = value.predictions[index];
    exactKeys(prediction, ['case_id', 'label'], [], label + '.predictions[' + index + ']');
    const caseId = identifier(prediction.case_id, label + '.predictions[' + index + '].case_id');
    if (!caseIds.has(caseId)) throw benchmarkError(label + ' predicts an unknown case: ' + caseId + '.');
    if (byCase.has(caseId)) throw benchmarkError(label + ' predicts a case more than once: ' + caseId + '.');
    const predictionLabel = prediction.label;
    if (predictionLabel !== null &&
        ![manifest.task.positive_label, manifest.task.negative_label].includes(predictionLabel)) {
      throw benchmarkError(label + ' uses an undeclared prediction label for ' + caseId + '.');
    }
    const normalized = { case_id: caseId, label: predictionLabel };
    predictions.push(normalized);
    byCase.set(caseId, normalized);
  }
  const predictionDigest = sha256(value.predictions_sha256, label + '.predictions_sha256');
  if (predictionDigest !== sha256Json(canonicalPredictions(predictions))) {
    throw benchmarkError(label + ' prediction digest does not match its canonical predictions.',
      'INVALID_BENCHMARK_RUN');
  }
  return {
    schema_version: BENCHMARK_RUN_SCHEMA_VERSION,
    run_id: identifier(value.run_id, label + '.run_id'),
    benchmark,
    system: {
      name: boundedText(value.system.name, label + '.system.name', { min: 2, max: 256 }),
      version: versionIdentifier(value.system.version, label + '.system.version'),
      adapter: boundedText(value.system.adapter, label + '.system.adapter', { min: 2, max: 256 })
    },
    predictions_frozen_at: frozenAt,
    label_access: value.label_access,
    method: boundedText(value.method, label + '.method', { min: 20, max: 4096, multiline: true }),
    predictions,
    predictions_sha256: predictionDigest,
    by_case: byCase,
    file_sha256: read.sha256,
    file_bytes: read.bytes
  };
}

function loadBenchmarkInputs(manifestPath) {
  const manifestRead = readStableUtf8File(
    manifestPath,
    MAX_BENCHMARK_MANIFEST_BYTES,
    'Benchmark manifest'
  );
  const manifest = validateManifest(parseJsonFile(manifestRead, 'Benchmark manifest'));
  const bundleRoot = safeBundleRoot(manifestRead.file);
  const casesRead = resolveBundleFile(
    bundleRoot,
    manifest.cases.file,
    MAX_BENCHMARK_CASE_FILE_BYTES,
    'Benchmark case file'
  );
  const cases = parseCases(casesRead, manifest);
  return { manifestRead, manifest, bundleRoot, casesRead, cases };
}

function rounded(value) {
  return value === null ? null : Number(Number(value).toFixed(9));
}

function wilsonInterval(numerator, denominator) {
  if (!denominator) return null;
  const proportion = numerator / denominator;
  const z2 = WILSON_Z * WILSON_Z;
  const scale = 1 + z2 / denominator;
  const center = (proportion + z2 / (2 * denominator)) / scale;
  const radius = WILSON_Z * Math.sqrt(
    proportion * (1 - proportion) / denominator + z2 / (4 * denominator * denominator)
  ) / scale;
  return {
    level: CONFIDENCE_LEVEL,
    method: 'wilson_score',
    lower: rounded(Math.max(0, center - radius)),
    upper: rounded(Math.min(1, center + radius))
  };
}

function ratioMetric(numerator, denominator) {
  return {
    numerator,
    denominator,
    value: denominator ? rounded(numerator / denominator) : null,
    confidence_interval: wilsonInterval(numerator, denominator)
  };
}

function scoreMetrics(cases, labels, predictionMap, positiveLabel, negativeLabel) {
  let correct = 0;
  let abstentions = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let abstainedPositive = 0;
  let abstainedNegative = 0;
  for (const item of cases) {
    const expected = labels.get(item.case_id);
    const observed = predictionMap.get(item.case_id)?.label ?? null;
    if (observed === null) abstentions += 1;
    if (observed === expected) correct += 1;
    if (expected === positiveLabel && observed === positiveLabel) truePositive += 1;
    else if (expected === negativeLabel && observed === positiveLabel) falsePositive += 1;
    else if (expected === negativeLabel && observed === negativeLabel) trueNegative += 1;
    else if (expected === positiveLabel && observed === negativeLabel) falseNegative += 1;
    else if (expected === positiveLabel && observed === null) abstainedPositive += 1;
    else if (expected === negativeLabel && observed === null) abstainedNegative += 1;
  }
  const precision = ratioMetric(truePositive, truePositive + falsePositive);
  const recall = ratioMetric(truePositive, truePositive + falseNegative + abstainedPositive);
  const specificity = ratioMetric(trueNegative, trueNegative + falsePositive + abstainedNegative);
  const f1Denominator = 2 * truePositive + falsePositive + falseNegative + abstainedPositive;
  return {
    cases: cases.length,
    correct,
    incorrect: cases.length - correct,
    abstentions,
    accuracy: ratioMetric(correct, cases.length),
    coverage: ratioMetric(cases.length - abstentions, cases.length),
    abstention_rate: ratioMetric(abstentions, cases.length),
    confusion: {
      true_positive: truePositive,
      false_positive: falsePositive,
      true_negative: trueNegative,
      false_negative: falseNegative,
      abstained_positive: abstainedPositive,
      abstained_negative: abstainedNegative
    },
    precision,
    recall,
    specificity,
    f1: {
      value: f1Denominator
        ? rounded(2 * truePositive / f1Denominator)
        : null
    }
  };
}

function thresholdResult(metrics, thresholds) {
  const checks = [
    {
      metric: 'accuracy', operator: '>=', threshold: thresholds.minimum_accuracy,
      observed: metrics.accuracy.value,
      pass: metrics.accuracy.value !== null && metrics.accuracy.value >= thresholds.minimum_accuracy
    },
    {
      metric: 'precision', operator: '>=', threshold: thresholds.minimum_precision,
      observed: metrics.precision.value,
      pass: metrics.precision.value !== null && metrics.precision.value >= thresholds.minimum_precision
    },
    {
      metric: 'recall', operator: '>=', threshold: thresholds.minimum_recall,
      observed: metrics.recall.value,
      pass: metrics.recall.value !== null && metrics.recall.value >= thresholds.minimum_recall
    },
    {
      metric: 'abstention_rate', operator: '<=', threshold: thresholds.maximum_abstention_rate,
      observed: metrics.abstention_rate.value,
      pass: metrics.abstention_rate.value !== null &&
        metrics.abstention_rate.value <= thresholds.maximum_abstention_rate
    }
  ];
  return { pass: checks.every((item) => item.pass), checks };
}

function scoreStrata(cases, labels, predictionMap, manifest) {
  const names = [...new Set(cases.map((item) => item.stratum).filter(Boolean))].sort();
  return names.map((stratum) => {
    const selected = cases.filter((item) => item.stratum === stratum);
    return {
      stratum,
      metrics: scoreMetrics(
        selected,
        labels,
        predictionMap,
        manifest.task.positive_label,
        manifest.task.negative_label
      )
    };
  });
}

function pairedComparison(cases, labels, candidateMap, baselineMap, candidateAccuracy, baselineAccuracy) {
  let candidateOnlyCorrect = 0;
  let baselineOnlyCorrect = 0;
  let bothCorrect = 0;
  let neitherCorrect = 0;
  for (const item of cases) {
    const expected = labels.get(item.case_id);
    const candidateCorrect = candidateMap.get(item.case_id)?.label === expected;
    const baselineCorrect = baselineMap.get(item.case_id)?.label === expected;
    if (candidateCorrect && baselineCorrect) bothCorrect += 1;
    else if (candidateCorrect) candidateOnlyCorrect += 1;
    else if (baselineCorrect) baselineOnlyCorrect += 1;
    else neitherCorrect += 1;
  }
  return {
    accuracy_delta: rounded(candidateAccuracy - baselineAccuracy),
    candidate_only_correct: candidateOnlyCorrect,
    baseline_only_correct: baselineOnlyCorrect,
    both_correct: bothCorrect,
    neither_correct: neitherCorrect
  };
}

function benchmarkIdentity(state) {
  return {
    benchmark_id: state.manifest.benchmark_id,
    benchmark_version: state.manifest.benchmark_version,
    title: state.manifest.title,
    description: state.manifest.description,
    split: state.manifest.split,
    task: state.manifest.task,
    manifest_sha256: state.manifestRead.sha256,
    cases_sha256: state.casesRead.sha256,
    labels_sha256: state.manifest.labels.sha256
  };
}

export function inspectScienceCodeBenchmark({ manifestPath } = {}) {
  const state = loadBenchmarkInputs(manifestPath);
  const strata = [...new Set(state.cases.map((item) => item.stratum).filter(Boolean))].sort();
  const report = {
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    report_kind: 'benchmark_inspection',
    sciencecode_version: VERSION,
    status: 'inputs_inspected',
    benchmark: benchmarkIdentity(state),
    governance: state.manifest.governance,
    cases: {
      count: state.cases.length,
      bytes: state.casesRead.bytes,
      strata,
      entries: state.cases.map((item) => ({
        case_id: item.case_id,
        input_sha256: item.input_sha256,
        stratum: item.stratum
      }))
    },
    sealed_bindings: {
      labels: {
        file: state.manifest.labels.file,
        sha256: state.manifest.labels.sha256,
        count: state.manifest.labels.count,
        opened: false
      },
      baselines: state.manifest.baselines.map((item) => ({
        baseline_id: item.baseline_id,
        run_file: item.run_file,
        run_sha256: item.run_sha256,
        opened: false
      }))
    },
    limitations: [
      'Inspection validates the manifest and case binding without opening expert labels or baseline runs; it does not prove that a person or external system avoided those files.',
      'Governance, independence, expertise, and blinding statements are bounded self-attestations whose truth requires external review.',
      'This external benchmark extends but never replaces or lowers the built-in ScienceCode release evaluation.'
    ]
  };
  return { ...report, fingerprint_sha256: sha256Json(report) };
}

export function createScienceCodeBenchmarkRun({ manifestPath, now } = {}) {
  const state = loadBenchmarkInputs(manifestPath);
  const frozenAt = normalizedNow(now);
  const frozenMs = frozenAt.getTime();
  if (frozenMs < Date.parse(state.manifest.governance.corpus_frozen_at) ||
      frozenMs >= Date.parse(state.manifest.governance.labels_unsealed_at)) {
    throw benchmarkError(
      'ScienceCode predictions must be frozen after corpus freeze and before label unsealing.',
      'BENCHMARK_PREDICTION_WINDOW_CLOSED'
    );
  }
  const predictions = state.cases.map((item) => {
    const claims = extractScientificClaims(item.text);
    return {
      case_id: item.case_id,
      label: claims.claims.some((claim) => claim.requires_citation)
        ? state.manifest.task.positive_label
        : state.manifest.task.negative_label
    };
  });
  const canonical = canonicalPredictions(predictions);
  return {
    schema_version: BENCHMARK_RUN_SCHEMA_VERSION,
    run_id: identifier(
      ('sciencecode-' + state.manifest.benchmark_id + '-' + state.manifest.benchmark_version)
        .toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 128),
      'generated benchmark run ID'
    ),
    benchmark: {
      benchmark_id: state.manifest.benchmark_id,
      benchmark_version: state.manifest.benchmark_version,
      cases_sha256: state.manifest.cases.sha256,
      labels_sha256: state.manifest.labels.sha256
    },
    system: {
      name: 'ScienceCode deterministic semantic reviewer',
      version: VERSION,
      adapter: SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER
    },
    predictions_frozen_at: frozenAt.toISOString(),
    label_access: 'unavailable_until_predictions_frozen',
    method: 'Applied the production extractScientificClaims implementation to each held-out text and predicted the positive label when at least one extracted claim required citation.',
    predictions,
    predictions_sha256: sha256Json(canonical)
  };
}

function safeOutputFile(cwd, outputPath) {
  const root = path.resolve(cwd ?? '');
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw benchmarkError('Benchmark output root must be a real directory.', 'BENCHMARK_OUTPUT_PATH');
  }
  const target = path.resolve(root, outputPath ?? '');
  if (relativeEscapesRoot(path.relative(root, target))) {
    throw benchmarkError('Benchmark output must remain inside the current working directory.',
      'BENCHMARK_OUTPUT_PATH');
  }
  const parent = path.dirname(target);
  let current = root;
  for (const part of path.relative(root, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw benchmarkError('Benchmark output parent must be an existing non-link directory.',
        'BENCHMARK_OUTPUT_PATH');
    }
  }
  const rootReal = fs.realpathSync(root);
  const parentReal = fs.realpathSync(parent);
  if (relativeEscapesRoot(path.relative(rootReal, parentReal))) {
    throw benchmarkError('Benchmark output parent resolves outside the current working directory.',
      'BENCHMARK_OUTPUT_PATH');
  }
  return target;
}

export function writeScienceCodeBenchmarkRun({ manifestPath, outputPath, cwd, now } = {}) {
  const run = createScienceCodeBenchmarkRun({ manifestPath, now });
  const target = safeOutputFile(cwd, outputPath);
  const serialized = JSON.stringify(run, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BENCHMARK_RUN_BYTES) {
    throw benchmarkError('Generated benchmark run is too large.', 'BENCHMARK_TOO_LARGE');
  }
  try {
    fs.writeFileSync(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw benchmarkError('Benchmark output already exists; predictions are never overwritten.',
        'BENCHMARK_OUTPUT_EXISTS');
    }
    throw error;
  }
  const read = readStableUtf8File(target, MAX_BENCHMARK_RUN_BYTES, 'Generated benchmark run');
  return {
    run,
    output_file: path.relative(path.resolve(cwd), target).replaceAll(path.sep, '/'),
    output_sha256: read.sha256,
    output_bytes: read.bytes
  };
}

export function scoreScienceCodeBenchmark({ manifestPath, predictionsPath, now } = {}) {
  const state = loadBenchmarkInputs(manifestPath);
  const candidateRead = readStableUtf8File(
    predictionsPath,
    MAX_BENCHMARK_RUN_BYTES,
    'Candidate benchmark run'
  );
  const candidate = parseRun(candidateRead, state.manifest, state.cases, 'Candidate benchmark run');
  if (state.manifest.baselines.some((item) => item.baseline_id === candidate.run_id)) {
    throw benchmarkError('Candidate run ID must be distinct from every published baseline.',
      'INVALID_BENCHMARK_RUN');
  }
  const baselines = state.manifest.baselines.map((binding) => {
    const read = resolveBundleFile(
      state.bundleRoot,
      binding.run_file,
      MAX_BENCHMARK_RUN_BYTES,
      'Benchmark baseline ' + binding.baseline_id
    );
    if (read.sha256 !== binding.run_sha256) {
      throw benchmarkError('Benchmark baseline SHA-256 mismatch: ' + binding.baseline_id + '.');
    }
    const run = parseRun(read, state.manifest, state.cases,
      'Benchmark baseline ' + binding.baseline_id);
    if (run.run_id !== binding.baseline_id) {
      throw benchmarkError('Benchmark baseline ID does not match its run: ' + binding.baseline_id + '.');
    }
    return { binding, read, run };
  });
  if (normalizedNow(now).getTime() < Date.parse(state.manifest.governance.labels_unsealed_at)) {
    throw benchmarkError('Benchmark labels are still sealed; scoring is not available yet.',
      'BENCHMARK_LABELS_SEALED');
  }
  const labelsRead = resolveBundleFile(
    state.bundleRoot,
    state.manifest.labels.file,
    MAX_BENCHMARK_LABEL_FILE_BYTES,
    'Benchmark label file'
  );
  const labels = parseLabels(labelsRead, state.manifest, state.cases);
  const metrics = scoreMetrics(
    state.cases,
    labels,
    candidate.by_case,
    state.manifest.task.positive_label,
    state.manifest.task.negative_label
  );
  const threshold = thresholdResult(metrics, state.manifest.thresholds);
  const baselineReports = baselines.map(({ binding, run }) => {
    const baselineMetrics = scoreMetrics(
      state.cases,
      labels,
      run.by_case,
      state.manifest.task.positive_label,
      state.manifest.task.negative_label
    );
    return {
      baseline_id: binding.baseline_id,
      run_sha256: run.file_sha256,
      predictions_sha256: run.predictions_sha256,
      system: run.system,
      predictions_frozen_at: run.predictions_frozen_at,
      metrics: baselineMetrics,
      comparison: pairedComparison(
        state.cases,
        labels,
        candidate.by_case,
        run.by_case,
        metrics.accuracy.value,
        baselineMetrics.accuracy.value
      )
    };
  });
  const cases = state.cases.map((item) => {
    const expected = labels.get(item.case_id);
    const candidateLabel = candidate.by_case.get(item.case_id).label;
    return {
      case_id: item.case_id,
      input_sha256: item.input_sha256,
      stratum: item.stratum,
      expected_label: expected,
      candidate_label: candidateLabel,
      candidate_correct: candidateLabel === expected,
      baselines: baselines.map(({ binding, run }) => {
        const observed = run.by_case.get(item.case_id).label;
        return {
          baseline_id: binding.baseline_id,
          label: observed,
          correct: observed === expected
        };
      })
    };
  });
  const report = {
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    report_kind: 'benchmark_score',
    sciencecode_version: VERSION,
    status: threshold.pass ? 'pass' : 'fail',
    benchmark: benchmarkIdentity(state),
    governance: state.manifest.governance,
    source_bindings: {
      manifest: { bytes: state.manifestRead.bytes, sha256: state.manifestRead.sha256 },
      cases: { file: state.manifest.cases.file, bytes: state.casesRead.bytes, sha256: state.casesRead.sha256 },
      labels: { file: state.manifest.labels.file, bytes: labelsRead.bytes, sha256: labelsRead.sha256 },
      candidate: { bytes: candidate.file_bytes, sha256: candidate.file_sha256 },
      baselines: baselines.map(({ binding, read }) => ({
        baseline_id: binding.baseline_id,
        file: binding.run_file,
        bytes: read.bytes,
        sha256: read.sha256
      }))
    },
    candidate: {
      run_id: candidate.run_id,
      run_sha256: candidate.file_sha256,
      predictions_sha256: candidate.predictions_sha256,
      system: candidate.system,
      predictions_frozen_at: candidate.predictions_frozen_at,
      label_access: candidate.label_access,
      method: candidate.method,
      metrics,
      strata: scoreStrata(state.cases, labels, candidate.by_case, state.manifest)
    },
    thresholds: {
      declared: state.manifest.thresholds,
      ...threshold
    },
    baselines: baselineReports,
    cases,
    confidence_intervals: {
      level: CONFIDENCE_LEVEL,
      method: 'wilson_score',
      scope: 'Binomial intervals conditional on this fixed held-out corpus.'
    },
    limitations: [
      'File separation, hashes, and declared timestamps make the workflow reviewable but do not independently prove creator independence, expert qualifications, or that labels were unseen before predictions were frozen.',
      'Wilson intervals quantify binomial uncertainty conditional on this fixed corpus; they do not prove corpus representativeness, transportability, or domain validity.',
      'Expert labels are benchmark ground truth for scoring, not proof that every label or underlying scientific statement is true.',
      'External benchmark thresholds and results extend but never replace, waive, or lower the built-in ScienceCode release evaluation.'
    ]
  };
  return { ...report, fingerprint_sha256: sha256Json(report) };
}

function formattedInterval(metric) {
  if (!metric || metric.value === null) return 'unavailable';
  const interval = metric.confidence_interval;
  return metric.value.toFixed(6) + (interval
    ? ' (95% Wilson [' + interval.lower.toFixed(6) + ', ' + interval.upper.toFixed(6) + '])'
    : '');
}

export function formatScienceCodeBenchmark(report) {
  if (report.report_kind === 'benchmark_inspection') {
    return [
      'ScienceCode governed benchmark: INPUTS INSPECTED WITHOUT LABELS',
      report.benchmark.benchmark_id + ' ' + report.benchmark.benchmark_version +
        ' | ' + report.cases.count + ' held-out cases',
      'Labels: sealed binding only; content not opened',
      'Baselines: ' + report.sealed_bindings.baselines.length + ' sealed binding(s); content not opened',
      '',
      'Fingerprint: ' + report.fingerprint_sha256,
      '',
      'Scope: structural inspection and hash binding, not proof of independent or blinded conduct.'
    ].join('\n');
  }
  const metrics = report.candidate.metrics;
  const lines = [
    'ScienceCode governed benchmark: ' + report.status.toUpperCase(),
    report.benchmark.benchmark_id + ' ' + report.benchmark.benchmark_version +
      ' | ' + metrics.correct + '/' + metrics.cases + ' correct',
    '',
    'Accuracy: ' + formattedInterval(metrics.accuracy),
    'Precision: ' + formattedInterval(metrics.precision),
    'Recall: ' + formattedInterval(metrics.recall),
    'Abstention rate: ' + formattedInterval(metrics.abstention_rate)
  ];
  for (const baseline of report.baselines) {
    lines.push(
      'Baseline ' + baseline.baseline_id + ': accuracy ' +
      formattedInterval(baseline.metrics.accuracy) +
      ' | candidate delta ' + baseline.comparison.accuracy_delta.toFixed(6)
    );
  }
  const failures = report.thresholds.checks.filter((item) => !item.pass);
  if (failures.length) {
    lines.push('', 'Failed thresholds:');
    for (const item of failures) {
      lines.push('- ' + item.metric + ' ' + item.operator + ' ' + item.threshold +
        ' (observed ' + (item.observed ?? 'unavailable') + ')');
    }
  }
  lines.push(
    '',
    'Fingerprint: ' + report.fingerprint_sha256,
    '',
    'Scope: governed held-out corpus scoring; governance claims and scientific validity require external review.'
  );
  return lines.join('\n');
}
