import { sha256Json } from './hash.js';
import { verifyProject } from './project.js';
import { redactText } from './security.js';

export const PROJECT_GATE_SCHEMA_VERSION = 1;
export const MAX_PROJECT_GATE_ISSUES = 128;
export const MAX_PROJECT_GATE_ISSUE_BYTES = 12 * 1024;

export const PROJECT_GATE_POLICIES = Object.freeze([
  Object.freeze({ request: 'allow_failed_runs', option: 'allowFailedRuns', count: 'failed_runs' }),
  Object.freeze({ request: 'allow_failed_simulations', option: 'allowFailedSimulations', count: 'failed_simulations' }),
  Object.freeze({ request: 'allow_failed_cad_builds', option: 'allowFailedCadBuilds', count: 'failed_cad_builds' }),
  Object.freeze({ request: 'allow_failed_cad_slices', option: 'allowFailedCadSlices', count: 'failed_cad_slices' }),
  Object.freeze({ request: 'allow_failed_inferences', option: 'allowFailedInferences', count: 'failed_inferences' }),
  Object.freeze({ request: 'allow_failed_experiments', option: 'allowFailedExperiments', count: 'failed_experiments' }),
  Object.freeze({ request: 'allow_failed_kernel_cells', option: 'allowFailedKernelCells', count: 'failed_kernel_cells' }),
  Object.freeze({ request: 'allow_failed_campaign_tasks', option: 'allowFailedCampaignTasks', count: 'failed_campaign_tasks' })
]);

const OUTCOME_ISSUES = new Set(PROJECT_GATE_POLICIES.map((entry) => entry.count));
const RECORD_ID_KEYS = [
  'run_id', 'chat_id', 'campaign_id', 'task_id', 'procedure_id',
  'procedure_assessment_id', 'procedure_decision_id', 'preregistration_id',
  'simulation_id', 'build_id', 'slice_id', 'inference_id', 'experiment_id',
  'evidence_id', 'retrieval_id', 'kernel_id', 'cell_id', 'revision_id',
  'figure_comparison_id', 'review_id', 'analysis_contract_id',
  'analysis_assessment_id', 'literature_id', 'snapshot_id', 'node_id', 'target_id'
];

function projectGateError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_PROJECT_GATE_REQUEST' });
}

export function normalizeProjectGatePolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw projectGateError('Project gate policy must be an object.');
  }
  const allowed = new Set(PROJECT_GATE_POLICIES.flatMap(
    (entry) => [entry.request, entry.option]
  ));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw projectGateError('Unknown project gate policy field: ' + unknown[0]);
  }
  const options = {};
  const request = {};
  for (const entry of PROJECT_GATE_POLICIES) {
    if (Object.hasOwn(value, entry.request) && Object.hasOwn(value, entry.option)) {
      throw projectGateError(
        'Project gate policy must not supply both ' + entry.request +
        ' and ' + entry.option + '.'
      );
    }
    const supplied = Object.hasOwn(value, entry.request)
      ? value[entry.request]
      : value[entry.option];
    if (supplied !== undefined && typeof supplied !== 'boolean') {
      throw projectGateError(entry.request + ' must be a boolean.');
    }
    const enabled = supplied === true;
    options[entry.option] = enabled;
    request[entry.request] = enabled;
  }
  return { options, request };
}

function safeJsonValue(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return JSON.parse(redactText(serialized));
  } catch {
    return { preview: redactText(String(value)).slice(0, 2_000) };
  }
}

function safeSha256Json(value) {
  try {
    return sha256Json(value);
  } catch {
    return sha256Json(safeJsonValue(value));
  }
}

function issueCode(error) {
  return redactText(
    String(error?.issue ?? error?.code ?? 'verification_failed')
  ).slice(0, 240);
}

function digestAnchor(value) {
  const digest = String(value ?? '');
  return /^[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : null;
}

function boundedIssueDetails(issue, record, serialized) {
  const source = redactText(serialized);
  let low = 0;
  let high = source.length;
  let best = { issue, ...record, preview: '' };
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = {
      issue,
      ...record,
      preview: source.slice(0, middle)
    };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <=
        MAX_PROJECT_GATE_ISSUE_BYTES) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  best.preview = best.preview.trimEnd();
  return best;
}

function recordIdentity(error) {
  const record = {};
  for (const key of RECORD_ID_KEYS) {
    if (error?.[key] !== undefined && error[key] !== null) {
      record[key] = redactText(String(error[key])).slice(0, 240);
    }
  }
  return record;
}

function issueTitle(issue) {
  return String(issue ?? 'verification_failed')
    .replaceAll('_', ' ')
    .replace(/^./, (value) => value.toUpperCase());
}

function projectedIssue(error, index) {
  const issue = issueCode(error);
  const safe = safeJsonValue(error);
  const serialized = JSON.stringify(safe);
  const oversized = Buffer.byteLength(serialized) > MAX_PROJECT_GATE_ISSUE_BYTES;
  const record = recordIdentity(error);
  return {
    index: index + 1,
    issue,
    title: issueTitle(issue),
    category: OUTCOME_ISSUES.has(issue) ? 'outcome' : 'integrity',
    record,
    detail_sha256: safeSha256Json(safe),
    detail_truncated: oversized,
    details: oversized
      ? boundedIssueDetails(issue, record, serialized)
      : safe
  };
}

function numericCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([name, item]) =>
    /^[a-z0-9_]{1,80}$/i.test(name) && Number.isSafeInteger(item) && item >= 0
  ));
}

function countValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function compactLineage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value.summary && typeof value.summary === 'object'
    ? value.summary
    : {};
  return {
    integrity: {
      ok: value.integrity?.ok === true,
      graph_sha256: digestAnchor(value.integrity?.graph_sha256)
    },
    summary: {
      nodes: countValue(summary.nodes),
      edges: countValue(summary.edges),
      verified_nodes: countValue(summary.verified_nodes),
      unverified_nodes: countValue(summary.unverified_nodes),
      findings: countValue(summary.findings),
      errors: countValue(summary.errors),
      warnings: countValue(summary.warnings),
      status: ['ready', 'review', 'invalid'].includes(summary.status)
        ? summary.status
        : 'invalid',
      by_type: numericCounts(summary.by_type),
      by_relation: numericCounts(summary.by_relation)
    },
    error_findings: Array.isArray(value.findings)
      ? value.findings.filter((finding) => finding?.severity === 'error').length
      : 0
  };
}

function failedVerification(error) {
  return {
    ok: false,
    audit: null,
    counts: {},
    lineage: null,
    errors: [{
      issue: 'project_verification_failed',
      error: {
        code: String(error?.code ?? 'PROJECT_VERIFICATION_FAILED'),
        message: redactText(error?.message ?? String(error))
      }
    }]
  };
}

export function projectGateReportFromVerification(
  verification,
  policy = {},
  { now = new Date() } = {}
) {
  const normalized = normalizeProjectGatePolicy(policy);
  const result = verification && typeof verification === 'object'
    ? verification
    : failedVerification(new Error('Project verification returned no result.'));
  let errors = Array.isArray(result.errors) ? result.errors : [];
  if (!errors.length && (
    result.ok !== true || result.audit?.ok !== true ||
    result.lineage?.integrity?.ok !== true
  )) {
    errors = [{
      issue: 'project_verification_inconsistent',
      verification_ok: result.ok === true,
      audit_ok: result.audit?.ok === true,
      lineage_ok: result.lineage?.integrity?.ok === true
    }];
  }
  const issues = errors.slice(0, MAX_PROJECT_GATE_ISSUES).map(projectedIssue);
  const counts = numericCounts(result.counts);
  const outcomeBlockers = errors.reduce(
    (total, error) => total + (OUTCOME_ISSUES.has(issueCode(error)) ? 1 : 0),
    0
  );
  const integrityBlockers = errors.length - outcomeBlockers;
  const acceptedFailedOutcomes = PROJECT_GATE_POLICIES.reduce(
    (total, entry) => total +
      (normalized.request[entry.request] ? (counts[entry.count] ?? 0) : 0),
    0
  );
  const anchors = {
    audit_head_hash: digestAnchor(result.audit?.head?.hash),
    lineage_graph_sha256: digestAnchor(result.lineage?.integrity?.graph_sha256)
  };
  const fingerprint = sha256Json({
    ok: result.ok === true,
    policy: normalized.request,
    counts,
    anchors,
    errors_sha256: safeSha256Json(errors)
  });
  return {
    schema_version: PROJECT_GATE_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    ok: result.ok === true && result.audit?.ok === true &&
      result.lineage?.integrity?.ok === true && errors.length === 0,
    fingerprint,
    policy: normalized.request,
    summary: {
      blockers: errors.length,
      integrity_blockers: integrityBlockers,
      outcome_blockers: outcomeBlockers,
      accepted_failed_outcomes: acceptedFailedOutcomes,
      returned_issues: issues.length,
      omitted_issues: Math.max(0, errors.length - issues.length),
      truncated: errors.length > issues.length ||
        issues.some((issue) => issue.detail_truncated)
    },
    anchors,
    audit: {
      ok: result.audit?.ok === true,
      count: countValue(result.audit?.count),
      head_hash: digestAnchor(result.audit?.head?.hash),
      errors: Array.isArray(result.audit?.errors) ? result.audit.errors.length : 0
    },
    lineage: compactLineage(result.lineage),
    counts,
    issues
  };
}

export function buildProjectGateReport(cwd, policy = {}, options = {}) {
  const normalized = normalizeProjectGatePolicy(policy);
  let verification;
  try {
    verification = (options.verify ?? verifyProject)(cwd, normalized.options);
  } catch (error) {
    verification = failedVerification(error);
  }
  return projectGateReportFromVerification(
    verification,
    normalized.request,
    { now: options.now ?? new Date() }
  );
}
