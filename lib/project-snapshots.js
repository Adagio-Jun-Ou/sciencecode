import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { sha256File, sha256Json } from './hash.js';
import { redactText } from './security.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  snapshot,
  validateSnapshotContents,
  verifySnapshot
} from './snapshot.js';
import {
  INTERNAL_DIR,
  isPathInside,
  relativePortable,
  writeTextExclusive
} from './storage.js';

export const PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_SNAPSHOT_FILES = 100_000;
export const MAX_PROJECT_SNAPSHOT_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES = 32 * 1024 * 1024;
export const MAX_PROJECT_SNAPSHOT_FINDINGS = 128;
export const MAX_PROJECT_SNAPSHOT_FINDING_BYTES = 12 * 1024;
export const MAX_LISTED_PROJECT_SNAPSHOTS = 256;
export const MAX_PROJECT_SNAPSHOT_RECORDS = 1_024;

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DRIFT_CATEGORIES = new Map([
  ['unexpected', 'added'],
  ['missing', 'missing'],
  ['hash_mismatch', 'modified'],
  ['size_mismatch', 'modified'],
  ['type_mismatch', 'modified'],
  ['unreadable', 'unreadable']
]);

function snapshotError(message, code, status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

function assertProject(cwd) {
  const project = path.resolve(cwd);
  const stat = fs.statSync(project, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    throw snapshotError(
      'Project directory does not exist: ' + project,
      'PROJECT_NOT_FOUND',
      404
    );
  }
  return project;
}

function checkedDirectoryEntry(value, label) {
  const stat = fs.lstatSync(value, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw snapshotError(
      label + ' is not a safe directory.',
      'INVALID_PROJECT_SNAPSHOT_STORE'
    );
  }
  return stat;
}

function snapshotDirectory(cwd, { create = false } = {}) {
  const project = assertProject(cwd);
  const internal = path.join(project, INTERNAL_DIR);
  let internalStat = checkedDirectoryEntry(internal, 'ScienceCode metadata directory');
  if (!internalStat && create) {
    fs.mkdirSync(internal, { mode: 0o700 });
    internalStat = checkedDirectoryEntry(internal, 'ScienceCode metadata directory');
  }
  if (!internalStat) return { project, directory: path.join(internal, 'snapshots') };

  const auditDirectory = path.join(internal, 'audit');
  const auditStat = checkedDirectoryEntry(auditDirectory, 'Project audit store');

  const directory = path.join(internal, 'snapshots');
  let directoryStat = checkedDirectoryEntry(directory, 'Project snapshot store');
  if (!directoryStat && create) {
    fs.mkdirSync(directory, { mode: 0o700 });
    directoryStat = checkedDirectoryEntry(directory, 'Project snapshot store');
  }
  if (directoryStat) {
    const projectReal = fs.realpathSync(project);
    const directoryReal = fs.realpathSync(directory);
    if (!isPathInside(projectReal, directoryReal)) {
      throw snapshotError(
        'Project snapshot store resolves outside the project root.',
        'INVALID_PROJECT_SNAPSHOT_STORE'
      );
    }
    if (auditStat &&
        !isPathInside(projectReal, fs.realpathSync(auditDirectory))) {
      throw snapshotError(
        'Project audit store resolves outside the project root.',
        'INVALID_PROJECT_SNAPSHOT_STORE'
      );
    }
  }
  return { project, directory };
}

export function normalizeProjectSnapshotId(value) {
  const id = String(value ?? '');
  if (!SNAPSHOT_ID_PATTERN.test(id)) {
    throw snapshotError('Invalid project snapshot ID.', 'INVALID_PROJECT_SNAPSHOT_ID');
  }
  return id;
}

export function makeProjectSnapshotId(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('Project snapshot time must be a valid Date.');
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'snapshot-' + stamp + '-' + crypto.randomBytes(3).toString('hex');
}

function finalName(id) {
  return normalizeProjectSnapshotId(id) + '.json';
}

function pendingName(id) {
  return '.pending-' + normalizeProjectSnapshotId(id) + '.json';
}

function checkedFile(file, id, { required = true } = {}) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) {
    if (!required) return null;
    throw snapshotError(
      'Project snapshot not found: ' + id,
      'PROJECT_SNAPSHOT_NOT_FOUND',
      404
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw snapshotError(
      'Project snapshot is not a safe regular file: ' + id,
      'INVALID_PROJECT_SNAPSHOT_FILE'
    );
  }
  return stat;
}

export function resolveProjectSnapshotFile(cwd, value) {
  const id = normalizeProjectSnapshotId(value);
  const { project, directory } = snapshotDirectory(cwd);
  const file = path.join(directory, finalName(id));
  const stat = checkedFile(file, id);
  const projectReal = fs.realpathSync(project);
  const fileReal = fs.realpathSync(file);
  if (!isPathInside(projectReal, fileReal)) {
    throw snapshotError(
      'Project snapshot resolves outside the project root.',
      'INVALID_PROJECT_SNAPSHOT_FILE'
    );
  }
  return { project, directory, file, stat, snapshot_id: id };
}

function registryEntries(cwd) {
  const { project, directory } = snapshotDirectory(cwd);
  const directoryStat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!directoryStat) return { project, directory, entries: [], issues: [] };
  const entries = [];
  const issues = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -5);
    if (!SNAPSHOT_ID_PATTERN.test(id)) {
      issues.push({ file: entry.name, issue: 'invalid_snapshot_filename' });
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      issues.push({ snapshot_id: id, issue: 'invalid_snapshot_file' });
      continue;
    }
    entries.push({ snapshot_id: id, file: path.join(directory, entry.name) });
  }
  entries.sort((left, right) => right.snapshot_id.localeCompare(left.snapshot_id));
  issues.sort((left, right) =>
    String(left.file ?? left.snapshot_id ?? '').localeCompare(
      String(right.file ?? right.snapshot_id ?? '')
    )
  );
  return { project, directory, entries, issues };
}

function auditBindings(project, entries) {
  const byFile = new Map(entries.map((entry) => [
    relativePortable(project, entry.file),
    []
  ]));
  try {
    for (const event of readAuditRecords(project)) {
      if (event?.type !== 'snapshot.created' || !byFile.has(event.file)) continue;
      byFile.get(event.file).push(event);
    }
    return { byFile, error: null };
  } catch (error) {
    return { byFile, error };
  }
}

function prefixMetadata(file, stat) {
  const length = Math.min(stat.size, 16 * 1024);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(file, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const prefix = buffer.toString('utf8');
  const schema = prefix.match(/"schema_version"\s*:\s*(\d+)/);
  const algorithm = prefix.match(/"algorithm"\s*:\s*"([^"]{0,32})"/);
  const created = prefix.match(/"created_at"\s*:\s*"([^"]{0,80})"/);
  return {
    snapshot_schema_version: schema ? Number(schema[1]) : null,
    algorithm: algorithm?.[1] ?? null,
    created_at: created?.[1] ?? null
  };
}

export function countProjectSnapshots(cwd) {
  const registry = registryEntries(cwd);
  return {
    count: registry.entries.length,
    registry_issues: registry.issues.length
  };
}

export function listProjectSnapshots(cwd, options = {}) {
  const limit = options.limit ?? MAX_LISTED_PROJECT_SNAPSHOTS;
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_PROJECT_SNAPSHOT_RECORDS) {
    throw snapshotError(
      'Project snapshot list limit must be from 1 through ' +
        MAX_PROJECT_SNAPSHOT_RECORDS + '.',
      'INVALID_PROJECT_SNAPSHOT_REQUEST'
    );
  }
  const registry = registryEntries(cwd);
  const bindings = auditBindings(registry.project, registry.entries);
  const selected = registry.entries.slice(0, limit);
  const snapshots = selected.map((entry) => {
    const stat = fs.statSync(entry.file);
    const file = relativePortable(registry.project, entry.file);
    const events = bindings.byFile.get(file) ?? [];
    const event = events.at(-1) ?? null;
    let metadata = {
      snapshot_schema_version: null,
      algorithm: null,
      created_at: null
    };
    try {
      metadata = prefixMetadata(entry.file, stat);
    } catch {
      // The exact verifier reports read failures; listing remains bounded.
    }
    return {
      snapshot_id: entry.snapshot_id,
      file,
      created_at: metadata.created_at ?? event?.ts ?? stat.mtime.toISOString(),
      snapshot_schema_version: metadata.snapshot_schema_version,
      algorithm: metadata.algorithm,
      manifest_bytes: stat.size,
      file_count: Number.isSafeInteger(event?.file_count) ? event.file_count : null,
      total_bytes: Number.isSafeInteger(event?.total_bytes) ? event.total_bytes : null,
      snapshot_sha256: SHA256_PATTERN.test(String(event?.snapshot_sha256 ?? ''))
        ? event.snapshot_sha256.toLowerCase()
        : null,
      audit_binding_count: events.length,
      status: events.length === 1 ? 'recorded' : events.length ? 'ambiguous' : 'unbound',
      download_url: '/project-snapshot/' + encodeURIComponent(entry.snapshot_id)
    };
  });
  const issues = [...registry.issues];
  if (bindings.error) {
    issues.push({
      issue: 'snapshot_audit_unavailable',
      detail: redactText(bindings.error.message)
    });
  }
  return {
    snapshots,
    summary: {
      total: registry.entries.length,
      returned: snapshots.length,
      omitted: Math.max(0, registry.entries.length - snapshots.length),
      registry_issues: issues.length,
      bounded: registry.entries.length > snapshots.length
    },
    issues
  };
}

function readSnapshotValue(file, stat) {
  if (stat.size > MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES) {
    throw snapshotError(
      'Project snapshot manifest exceeds the ' +
        MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES + '-byte limit.',
      'PROJECT_SNAPSHOT_MANIFEST_TOO_LARGE',
      413,
      { maximum: MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES, actual: stat.size }
    );
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw snapshotError(
      'Project snapshot contains invalid JSON.',
      'INVALID_PROJECT_SNAPSHOT_JSON',
      400,
      { detail: redactText(error.message) }
    );
  }
  return value;
}

function summarizeValue(value, manifestBytes) {
  const metadata = Object.values(value?.files ?? {});
  let totalBytes = 0;
  let totalBytesKnown = true;
  for (const item of metadata) {
    if (!Number.isSafeInteger(item?.bytes) || item.bytes < 0 ||
        totalBytes > Number.MAX_SAFE_INTEGER - item.bytes) {
      totalBytesKnown = false;
      break;
    }
    totalBytes += item.bytes;
  }
  return {
    snapshot_schema_version: value?.schema_version ?? null,
    algorithm: value?.algorithm ?? null,
    created_at: typeof value?.created_at === 'string' ? value.created_at : null,
    file_count: metadata.length,
    total_bytes: totalBytesKnown ? totalBytes : null,
    manifest_bytes: manifestBytes
  };
}

function snapshotRecordInspection(cwd, value) {
  const resolved = resolveProjectSnapshotFile(cwd, value);
  const errors = [];
  let snapshotValue = null;
  let snapshotSha256 = null;
  try {
    snapshotValue = readSnapshotValue(resolved.file, resolved.stat);
    errors.push(...validateSnapshotContents(resolved.project, snapshotValue, {
      maxFiles: MAX_PROJECT_SNAPSHOT_FILES
    }));
    snapshotSha256 = sha256File(resolved.file);
  } catch (error) {
    errors.push({
      issue: error.code ?? 'snapshot_read_failed',
      detail: redactText(error.message)
    });
  }

  const relative = relativePortable(resolved.project, resolved.file);
  let records = [];
  let audit = null;
  try {
    records = readAuditRecords(resolved.project).filter((event) =>
      event?.type === 'snapshot.created' && event.file === relative
    );
    audit = verifyAudit(resolved.project);
  } catch (error) {
    errors.push({
      issue: error.code ?? 'snapshot_audit_unavailable',
      detail: redactText(error.message)
    });
  }
  if (records.length === 0) {
    errors.push({ issue: 'snapshot_audit_binding_missing', file: relative });
  } else if (records.length !== 1) {
    errors.push({
      issue: 'snapshot_audit_binding_ambiguous',
      file: relative,
      actual: records.length
    });
  }
  const event = records.length === 1 ? records[0] : null;
  if (event && snapshotSha256 && event.snapshot_sha256 !== snapshotSha256) {
    errors.push({
      issue: 'snapshot_audit_digest_mismatch',
      expected: event.snapshot_sha256 ?? null,
      actual: snapshotSha256
    });
  }
  if (event?.snapshot_id !== undefined && event.snapshot_id !== resolved.snapshot_id) {
    errors.push({
      issue: 'snapshot_audit_id_mismatch',
      expected: resolved.snapshot_id,
      actual: event.snapshot_id ?? null
    });
  }
  const valueSummary = summarizeValue(snapshotValue, resolved.stat.size);
  if (event && Number.isSafeInteger(event.file_count) &&
      event.file_count !== valueSummary.file_count) {
    errors.push({
      issue: 'snapshot_audit_file_count_mismatch',
      expected: event.file_count,
      actual: valueSummary.file_count
    });
  }
  if (event && Number.isSafeInteger(event.total_bytes) &&
      event.total_bytes !== valueSummary.total_bytes) {
    errors.push({
      issue: 'snapshot_audit_total_bytes_mismatch',
      expected: event.total_bytes,
      actual: valueSummary.total_bytes
    });
  }
  if (event && Number.isSafeInteger(event.snapshot_schema_version) &&
      event.snapshot_schema_version !== valueSummary.snapshot_schema_version) {
    errors.push({
      issue: 'snapshot_audit_schema_mismatch',
      expected: event.snapshot_schema_version,
      actual: valueSummary.snapshot_schema_version
    });
  }
  if (audit && !audit.ok) {
    errors.push({
      issue: 'snapshot_audit_invalid',
      actual: Array.isArray(audit.errors) ? audit.errors.length : 1
    });
  }
  errors.sort((left, right) =>
    String(left.file ?? '').localeCompare(String(right.file ?? '')) ||
    String(left.issue ?? '').localeCompare(String(right.issue ?? ''))
  );
  return {
    ok: errors.length === 0,
    snapshot_id: resolved.snapshot_id,
    file: relative,
    snapshot_sha256: snapshotSha256,
    snapshot: valueSummary,
    audit: {
      ok: audit?.ok === true,
      binding_count: records.length,
      event_sequence: Number.isSafeInteger(event?.sequence) ? event.sequence : null,
      event_hash: SHA256_PATTERN.test(String(event?.hash ?? ''))
        ? event.hash.toLowerCase()
        : null,
      head_hash: SHA256_PATTERN.test(String(audit?.head?.hash ?? ''))
        ? audit.head.hash.toLowerCase()
        : null
    },
    errors,
    value: snapshotValue
  };
}

export function verifyProjectSnapshotRecord(cwd, value) {
  try {
    const inspected = snapshotRecordInspection(cwd, value);
    const { value: _ignored, ...result } = inspected;
    return result;
  } catch (error) {
    return {
      ok: false,
      snapshot_id: String(value ?? ''),
      file: null,
      snapshot_sha256: null,
      snapshot: null,
      audit: null,
      errors: [{
        issue: error.code ?? 'snapshot_record_failed',
        detail: redactText(error.message)
      }]
    };
  }
}

function safeJson(value) {
  try {
    return JSON.parse(redactText(JSON.stringify(value)));
  } catch {
    return { preview: redactText(String(value)).slice(0, 2_000) };
  }
}

function boundedFinding(error, index, source) {
  const safe = safeJson(error);
  const serialized = JSON.stringify(safe);
  const issue = redactText(String(error?.issue ?? 'snapshot_verification_failed'))
    .slice(0, 160);
  const file = error?.file === undefined
    ? null
    : redactText(String(error.file)).slice(0, 512);
  const category = source === 'record'
    ? 'integrity'
    : DRIFT_CATEGORIES.get(issue) ?? 'integrity';
  const base = {
    index: index + 1,
    issue,
    category,
    file,
    detail_sha256: sha256Json(safe),
    detail_truncated: Buffer.byteLength(serialized, 'utf8') >
      MAX_PROJECT_SNAPSHOT_FINDING_BYTES
  };
  if (!base.detail_truncated) return { ...base, details: safe };
  let low = 0;
  let high = serialized.length;
  let preview = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = { ...base, details: { preview: serialized.slice(0, middle) } };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <=
        MAX_PROJECT_SNAPSHOT_FINDING_BYTES) {
      preview = serialized.slice(0, middle);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { ...base, details: { preview: preview.trimEnd() } };
}

function findingCounts(errors) {
  const counts = {
    integrity: 0,
    added: 0,
    modified: 0,
    missing: 0,
    unreadable: 0
  };
  for (const error of errors) {
    const category = error.source === 'record'
      ? 'integrity'
      : DRIFT_CATEGORIES.get(String(error.value?.issue ?? '')) ?? 'integrity';
    counts[category] += 1;
  }
  return counts;
}

function reportFingerprint(report) {
  const {
    fingerprint: _ignoredFingerprint,
    generated_at: _ignoredGeneratedAt,
    ...body
  } = report;
  return sha256Json(body);
}

function buildProjectSnapshotReport({
  operation,
  snapshotId,
  strict,
  record,
  workspace,
  generatedAt = new Date().toISOString()
}) {
  const combined = [
    ...(record?.errors ?? []).map((value) => ({ source: 'record', value })),
    ...(workspace?.errors ?? []).map((value) => ({ source: 'workspace', value }))
  ];
  const counts = findingCounts(combined);
  const retained = combined.slice(0, MAX_PROJECT_SNAPSHOT_FINDINGS);
  const findings = retained.map((entry, index) =>
    boundedFinding(entry.value, index, entry.source)
  );
  const summary = {
    blockers: combined.length,
    integrity_blockers: counts.integrity,
    added: counts.added,
    modified: counts.modified,
    missing: counts.missing,
    unreadable: counts.unreadable,
    returned_findings: findings.length,
    omitted_findings: Math.max(0, combined.length - findings.length),
    truncated: combined.length > findings.length ||
      findings.some((finding) => finding.detail_truncated)
  };
  const report = {
    schema_version: PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION,
    operation,
    generated_at: generatedAt,
    ok: record?.ok === true && workspace?.ok === true,
    snapshot: {
      snapshot_id: snapshotId,
      file: record?.file ?? null,
      ...(record?.snapshot ?? {}),
      snapshot_sha256: record?.snapshot_sha256 ?? null,
      download_url: record?.file
        ? '/project-snapshot/' + encodeURIComponent(snapshotId)
        : null
    },
    strict: Boolean(strict),
    record_integrity: {
      ok: record?.ok === true,
      audit_binding_count: record?.audit?.binding_count ?? 0
    },
    workspace: {
      ok: workspace?.ok === true,
      strict: Boolean(strict)
    },
    summary,
    anchors: {
      snapshot_sha256: record?.snapshot_sha256 ?? null,
      audit_event_hash: record?.audit?.event_hash ?? null,
      audit_head_hash: record?.audit?.head_hash ?? null
    },
    findings
  };
  report.fingerprint = reportFingerprint(report);
  return report;
}

export function verifyProjectSnapshot(cwd, value, options = {}) {
  const strict = options.strict !== false;
  let record;
  try {
    record = snapshotRecordInspection(cwd, value);
  } catch (error) {
    record = {
      ok: false,
      snapshot_id: String(value ?? ''),
      file: null,
      snapshot_sha256: null,
      snapshot: null,
      audit: null,
      errors: [{
        issue: error.code ?? 'snapshot_record_failed',
        detail: redactText(error.message)
      }],
      value: null
    };
  }
  let workspace = { ok: false, strict, errors: [] };
  if (record.value) {
    try {
      workspace = verifySnapshot(path.resolve(cwd), record.value, {
        strict,
        maxFiles: MAX_PROJECT_SNAPSHOT_FILES
      });
    } catch (error) {
      workspace = {
        ok: false,
        strict,
        errors: [{
          issue: error.code ?? 'snapshot_verification_failed',
          detail: redactText(error.message)
        }]
      };
    }
  }
  return buildProjectSnapshotReport({
    operation: 'verify',
    snapshotId: record.snapshot_id,
    strict,
    record,
    workspace
  });
}

export function captureProjectSnapshotPending(cwd, value) {
  const id = normalizeProjectSnapshotId(value);
  const { project, directory } = snapshotDirectory(cwd, { create: true });
  const finalFile = path.join(directory, finalName(id));
  const pendingFile = path.join(directory, pendingName(id));
  if (fs.lstatSync(finalFile, { throwIfNoEntry: false }) ||
      fs.lstatSync(pendingFile, { throwIfNoEntry: false })) {
    throw snapshotError(
      'Project snapshot already exists: ' + id,
      'PROJECT_SNAPSHOT_EXISTS',
      409
    );
  }
  const valueObject = snapshot(project, {
    maxFiles: MAX_PROJECT_SNAPSHOT_FILES,
    maxTotalBytes: MAX_PROJECT_SNAPSHOT_TOTAL_BYTES
  });
  const serialized = JSON.stringify(valueObject, null, 2) + '\n';
  const manifestBytes = Buffer.byteLength(serialized, 'utf8');
  if (manifestBytes > MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES) {
    throw snapshotError(
      'Project snapshot manifest exceeds the ' +
        MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES + '-byte limit.',
      'PROJECT_SNAPSHOT_MANIFEST_TOO_LARGE',
      413
    );
  }
  writeTextExclusive(pendingFile, serialized);
  const snapshotSha256 = sha256File(pendingFile);
  const summary = summarizeValue(valueObject, manifestBytes);
  const workspace = verifySnapshot(project, valueObject, {
    strict: true,
    maxFiles: MAX_PROJECT_SNAPSHOT_FILES
  });
  const provisionalRecord = {
    ok: true,
    snapshot_id: id,
    file: null,
    snapshot_sha256: snapshotSha256,
    snapshot: summary,
    audit: null,
    errors: []
  };
  return {
    schema_version: PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION,
    operation: 'capture',
    snapshot_id: id,
    pending_file: pendingName(id),
    snapshot_sha256: snapshotSha256,
    report: buildProjectSnapshotReport({
      operation: 'create',
      snapshotId: id,
      strict: true,
      record: provisionalRecord,
      workspace
    })
  };
}

export function discardProjectSnapshotPending(cwd, value) {
  const id = normalizeProjectSnapshotId(value);
  const { directory } = snapshotDirectory(cwd);
  const file = path.join(directory, pendingName(id));
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw snapshotError(
      'Pending project snapshot is not a safe regular file.',
      'INVALID_PROJECT_SNAPSHOT_FILE'
    );
  }
  fs.unlinkSync(file);
  return true;
}

export function commitProjectSnapshotPending(cwd, capture) {
  if (!capture || capture.schema_version !== PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION ||
      capture.operation !== 'capture') {
    throw snapshotError(
      'Snapshot worker returned an invalid capture.',
      'PROJECT_SNAPSHOT_WORKER_FAILED',
      500
    );
  }
  const id = normalizeProjectSnapshotId(capture.snapshot_id);
  if (capture.pending_file !== pendingName(id) ||
      !SHA256_PATTERN.test(String(capture.snapshot_sha256 ?? '')) ||
      capture.report?.snapshot?.snapshot_id !== id) {
    throw snapshotError(
      'Snapshot worker capture binding is invalid.',
      'PROJECT_SNAPSHOT_WORKER_FAILED',
      500
    );
  }
  const { project, directory } = snapshotDirectory(cwd, { create: true });
  const source = path.join(directory, pendingName(id));
  const target = path.join(directory, finalName(id));
  const stat = checkedFile(source, id);
  if (stat.size > MAX_PROJECT_SNAPSHOT_MANIFEST_BYTES ||
      sha256File(source) !== capture.snapshot_sha256) {
    throw snapshotError(
      'Pending project snapshot failed its commit digest check.',
      'PROJECT_SNAPSHOT_COMMIT_MISMATCH',
      500
    );
  }
  if (fs.lstatSync(target, { throwIfNoEntry: false })) {
    throw snapshotError(
      'Project snapshot already exists: ' + id,
      'PROJECT_SNAPSHOT_EXISTS',
      409
    );
  }
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(source);
  appendAudit(project, {
    type: 'snapshot.created',
    snapshot_id: id,
    file: relativePortable(project, target),
    snapshot_sha256: capture.snapshot_sha256,
    snapshot_schema_version: capture.report.snapshot.snapshot_schema_version,
    file_count: capture.report.snapshot.file_count,
    total_bytes: capture.report.snapshot.total_bytes
  });
  const record = verifyProjectSnapshotRecord(project, id);
  const recordErrors = Array.isArray(record.errors) ? record.errors : [];
  const existingFindings = [...(capture.report.findings ?? [])];
  const available = Math.max(
    0,
    MAX_PROJECT_SNAPSHOT_FINDINGS - existingFindings.length
  );
  const addedFindings = recordErrors.slice(0, available).map((error, index) =>
    boundedFinding(error, existingFindings.length + index, 'record')
  );
  const report = {
    ...capture.report,
    snapshot: {
      ...capture.report.snapshot,
      ...(record.snapshot ?? {}),
      file: record.file ?? relativePortable(project, target),
      snapshot_sha256: record.snapshot_sha256 ?? capture.snapshot_sha256,
      download_url: '/project-snapshot/' + encodeURIComponent(id)
    },
    record_integrity: {
      ok: record.ok === true,
      audit_binding_count: record.audit?.binding_count ?? 0
    },
    summary: {
      ...capture.report.summary,
      blockers: capture.report.summary.blockers + recordErrors.length,
      integrity_blockers: capture.report.summary.integrity_blockers +
        recordErrors.length,
      returned_findings: existingFindings.length + addedFindings.length,
      omitted_findings: capture.report.summary.omitted_findings +
        Math.max(0, recordErrors.length - addedFindings.length),
      truncated: capture.report.summary.truncated ||
        recordErrors.length > addedFindings.length ||
        addedFindings.some((finding) => finding.detail_truncated)
    },
    anchors: {
      snapshot_sha256: record.snapshot_sha256 ?? capture.snapshot_sha256,
      audit_event_hash: record.audit?.event_hash ?? null,
      audit_head_hash: record.audit?.head_hash ?? null
    },
    findings: [...existingFindings, ...addedFindings]
  };
  report.ok = report.workspace.ok === true && record.ok === true;
  report.fingerprint = reportFingerprint(report);
  return report;
}
