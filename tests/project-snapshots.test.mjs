import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendAudit,
  buildProjectGateReport,
  captureProjectSnapshotPending,
  commitProjectSnapshotPending,
  listProjectSnapshots,
  resolveProjectSnapshotFile,
  snapshot,
  validateSnapshotContents,
  verifyProject,
  verifyProjectSnapshot,
  verifyProjectSnapshotRecord
} from '../lib/core.js';

function temporaryProject(prefix = 'sciencecode-project-snapshot-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('managed project snapshots capture, commit, list, download metadata, and verify exactly', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'data.txt'), 'reproducible\n');
  const id = 'snapshot-fixture-1';

  const capture = captureProjectSnapshotPending(directory, id);
  assert.equal(capture.operation, 'capture');
  assert.equal(capture.report.operation, 'create');
  assert.equal(capture.report.workspace.ok, true);
  assert.equal(
    fs.existsSync(path.join(directory, '.sciencecode', 'snapshots', id + '.json')),
    false
  );
  assert.equal(
    fs.existsSync(path.join(directory, '.sciencecode', 'snapshots', capture.pending_file)),
    true
  );

  const created = commitProjectSnapshotPending(directory, capture);
  assert.equal(created.ok, true);
  assert.equal(created.record_integrity.ok, true);
  assert.equal(created.snapshot.file_count, 1);
  assert.match(created.anchors.snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.match(created.anchors.audit_event_hash, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(directory, created.snapshot.file)), true);

  const listing = listProjectSnapshots(directory);
  assert.equal(listing.summary.total, 1);
  assert.equal(listing.snapshots[0].snapshot_id, id);
  assert.equal(listing.snapshots[0].status, 'recorded');
  assert.equal(listing.snapshots[0].file_count, 1);
  assert.equal(listing.snapshots[0].download_url, '/project-snapshot/' + id);

  const record = verifyProjectSnapshotRecord(directory, id);
  assert.equal(record.ok, true);
  assert.equal(record.audit.binding_count, 1);
  const verified = verifyProjectSnapshot(directory, id, { strict: true });
  assert.equal(verified.ok, true);
  assert.equal(verified.summary.blockers, 0);
  assert.equal(
    verifyProjectSnapshot(directory, id, { strict: true }).fingerprint,
    verified.fingerprint,
    'verification fingerprints exclude wall-clock generation time'
  );
  assert.equal(verifyProject(directory).ok, true);
});

test('snapshot reports classify strict project drift without weakening record integrity', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'modified.txt'), 'before');
  fs.writeFileSync(path.join(directory, 'missing.txt'), 'before');
  const id = 'snapshot-drift-1';
  commitProjectSnapshotPending(
    directory,
    captureProjectSnapshotPending(directory, id)
  );

  fs.writeFileSync(path.join(directory, 'modified.txt'), 'after');
  fs.unlinkSync(path.join(directory, 'missing.txt'));
  fs.writeFileSync(path.join(directory, 'added.txt'), 'after');

  const relaxed = verifyProjectSnapshot(directory, id, { strict: false });
  assert.equal(relaxed.ok, false);
  assert.equal(relaxed.record_integrity.ok, true);
  assert.equal(relaxed.summary.modified, 1);
  assert.equal(relaxed.summary.missing, 1);
  assert.equal(relaxed.summary.added, 0);

  const strict = verifyProjectSnapshot(directory, id, { strict: true });
  assert.equal(strict.ok, false);
  assert.equal(strict.summary.modified, 1);
  assert.equal(strict.summary.missing, 1);
  assert.equal(strict.summary.added, 1);
  assert.deepEqual(
    new Set(strict.findings.map((finding) => finding.category)),
    new Set(['modified', 'missing', 'added'])
  );
  assert.equal(
    verifyProject(directory).ok,
    true,
    'whole-project integrity verifies the immutable snapshot record, not expected later drift'
  );
});

test('snapshot record tampering becomes a non-waivable whole-project integrity failure', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'data.txt'), 'before');
  const id = 'snapshot-tamper-1';
  const created = commitProjectSnapshotPending(
    directory,
    captureProjectSnapshotPending(directory, id)
  );
  const file = path.join(directory, created.snapshot.file);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.files['data.txt'].sha256 = '0'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

  const record = verifyProjectSnapshotRecord(directory, id);
  assert.equal(record.ok, false);
  assert.ok(record.errors.some((error) =>
    error.issue === 'snapshot_audit_digest_mismatch'));
  const project = verifyProject(directory, {
    allowFailedRuns: true,
    allowFailedSimulations: true,
    allowFailedCadBuilds: true,
    allowFailedCadSlices: true,
    allowFailedInferences: true,
    allowFailedExperiments: true,
    allowFailedKernelCells: true,
    allowFailedCampaignTasks: true
  });
  assert.equal(project.ok, false);
  assert.ok(project.errors.some((error) =>
    error.issue === 'project_snapshot_invalid' && error.snapshot_id === id));
  const gate = buildProjectGateReport(directory, {
    allow_failed_runs: true,
    allow_failed_simulations: true,
    allow_failed_cad_builds: true,
    allow_failed_cad_slices: true,
    allow_failed_inferences: true,
    allow_failed_experiments: true,
    allow_failed_kernel_cells: true,
    allow_failed_campaign_tasks: true
  });
  assert.equal(gate.ok, false);
  assert.ok(gate.issues.some((issue) =>
    issue.category === 'integrity' && issue.record.snapshot_id === id));
});

test('capture reports a pre-existing audit failure as an explicit integrity blocker', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'data.txt'), 'baseline');
  appendAudit(directory, { type: 'fixture.original' });
  const auditFile = path.join(directory, '.sciencecode', 'audit', 'events.jsonl');
  fs.writeFileSync(
    auditFile,
    fs.readFileSync(auditFile, 'utf8').replace('fixture.original', 'fixture.tampered')
  );
  const report = commitProjectSnapshotPending(
    directory,
    captureProjectSnapshotPending(directory, 'snapshot-invalid-audit-1')
  );
  assert.equal(report.ok, false);
  assert.equal(report.record_integrity.ok, false);
  assert.ok(report.summary.integrity_blockers > 0);
  assert.ok(report.summary.blockers > 0);
  assert.ok(report.findings.some((finding) =>
    finding.category === 'integrity' && finding.issue === 'snapshot_audit_invalid'));
});

test('snapshot capture bounds and structural validation fail closed', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'one.txt'), '1');
  fs.writeFileSync(path.join(directory, 'two.txt'), '2');
  assert.throws(
    () => snapshot(directory, { maxFiles: 1 }),
    { code: 'SNAPSHOT_FILE_LIMIT' }
  );
  const invalid = {
    schema_version: 99,
    algorithm: 'sha256',
    created_at: 'not-a-time',
    files: {
      '../outside.txt': { type: 'file', sha256: '0'.repeat(64), bytes: 1 },
      'one.txt': { type: 'file', sha256: 'not-a-digest', bytes: 1 }
    }
  };
  const errors = validateSnapshotContents(directory, invalid);
  assert.ok(errors.some((error) => error.issue === 'unsupported_schema'));
  assert.ok(errors.some((error) => error.issue === 'invalid_created_at'));
  assert.ok(errors.some((error) => error.issue === 'invalid_path'));
  assert.ok(errors.some((error) => error.issue === 'invalid_digest'));
});

test('bounded snapshot findings redact secret-shaped project paths', () => {
  const directory = temporaryProject();
  const secret = 'sk-1234567890abcdefghijkl';
  fs.writeFileSync(path.join(directory, secret + '.txt'), 'sensitive name');
  const id = 'snapshot-redaction-1';
  commitProjectSnapshotPending(
    directory,
    captureProjectSnapshotPending(directory, id)
  );
  fs.unlinkSync(path.join(directory, secret + '.txt'));

  const report = verifyProjectSnapshot(directory, id, { strict: true });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(secret), false);
  assert.match(serialized, /REDACTED TOKEN/);
  assert.ok(report.findings.every((finding) =>
    Buffer.byteLength(JSON.stringify(finding), 'utf8') <= 12 * 1024));
});

test('managed snapshot stores and files reject filesystem-link escapes', (context) => {
  const storageProject = temporaryProject();
  const outsideStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-snapshot-store-'));
  fs.mkdirSync(path.join(storageProject, '.sciencecode'));
  try {
    fs.symlinkSync(
      outsideStore,
      path.join(storageProject, '.sciencecode', 'snapshots'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Filesystem links are unavailable in this environment.');
      return;
    }
    throw error;
  }
  assert.throws(
    () => captureProjectSnapshotPending(storageProject, 'snapshot-link-store-1'),
    { code: 'INVALID_PROJECT_SNAPSHOT_STORE' }
  );
  assert.deepEqual(fs.readdirSync(outsideStore), []);

  const auditProject = temporaryProject();
  const outsideAudit = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-snapshot-audit-'));
  fs.mkdirSync(path.join(auditProject, '.sciencecode'));
  fs.symlinkSync(
    outsideAudit,
    path.join(auditProject, '.sciencecode', 'audit'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => captureProjectSnapshotPending(auditProject, 'snapshot-link-audit-1'),
    { code: 'INVALID_PROJECT_SNAPSHOT_STORE' }
  );
  assert.deepEqual(fs.readdirSync(outsideAudit), []);

  const fileProject = temporaryProject();
  fs.writeFileSync(path.join(fileProject, 'data.txt'), 'baseline');
  const id = 'snapshot-link-file-1';
  const created = commitProjectSnapshotPending(
    fileProject,
    captureProjectSnapshotPending(fileProject, id)
  );
  const manifest = path.join(fileProject, created.snapshot.file);
  const outsideFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-snapshot-file-')),
    'outside.json'
  );
  fs.writeFileSync(outsideFile, '{"exposed":true}\n');
  fs.unlinkSync(manifest);
  try {
    fs.symlinkSync(outsideFile, manifest, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
    throw error;
  }
  assert.throws(
    () => resolveProjectSnapshotFile(fileProject, id),
    { code: 'INVALID_PROJECT_SNAPSHOT_FILE' }
  );
  const verification = verifyProjectSnapshotRecord(fileProject, id);
  assert.equal(verification.ok, false);
  assert.equal(verification.errors[0].issue, 'INVALID_PROJECT_SNAPSHOT_FILE');
});
