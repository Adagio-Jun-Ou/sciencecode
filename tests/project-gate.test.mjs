import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_PROJECT_GATE_ISSUES,
  MAX_PROJECT_GATE_ISSUE_BYTES,
  appendAudit,
  buildProjectGateReport,
  normalizeProjectGatePolicy,
  projectGateReportFromVerification
} from '../lib/core.js';

test('project gate policy accepts exact booleans and rejects ambiguous or unknown fields', () => {
  const normalized = normalizeProjectGatePolicy({
    allow_failed_runs: true,
    allowFailedSimulations: true
  });
  assert.equal(normalized.request.allow_failed_runs, true);
  assert.equal(normalized.request.allow_failed_simulations, true);
  assert.equal(normalized.options.allowFailedRuns, true);
  assert.equal(normalized.options.allowFailedSimulations, true);
  assert.equal(normalized.request.allow_failed_inferences, false);

  for (const value of [null, [], 'strict']) {
    assert.throws(
      () => normalizeProjectGatePolicy(value),
      (error) => error.code === 'INVALID_PROJECT_GATE_REQUEST'
    );
  }
  assert.throws(
    () => normalizeProjectGatePolicy({ allow_failed_runs: 'yes' }),
    (error) => error.code === 'INVALID_PROJECT_GATE_REQUEST'
  );
  assert.throws(
    () => normalizeProjectGatePolicy({ surprise: false }),
    (error) => error.code === 'INVALID_PROJECT_GATE_REQUEST'
  );
  assert.throws(
    () => normalizeProjectGatePolicy({
      allow_failed_runs: true,
      allowFailedRuns: true
    }),
    (error) => error.code === 'INVALID_PROJECT_GATE_REQUEST'
  );
});

test('project gate projection separates non-waivable integrity from outcome policy', () => {
  const auditHash = 'a'.repeat(64);
  const lineageHash = 'b'.repeat(64);
  const verification = {
    ok: false,
    audit: { ok: true, count: 4, head: { hash: auditHash }, errors: [] },
    lineage: {
      integrity: { ok: true, graph_sha256: lineageHash },
      summary: { nodes: 3, edges: 2 },
      findings: []
    },
    counts: { runs: 2, failed_runs: 1, failed_simulations: 3 },
    errors: [
      { issue: 'run_invalid', run_id: 'run-1', errors: [{ issue: 'hash_mismatch' }] },
      { issue: 'failed_runs', runs: [{ run_id: 'run-2', status: 'failed' }] }
    ]
  };
  const report = projectGateReportFromVerification(verification, {}, {
    now: new Date('2026-08-11T12:00:00.000Z')
  });
  assert.equal(report.ok, false);
  assert.equal(report.summary.blockers, 2);
  assert.equal(report.summary.integrity_blockers, 1);
  assert.equal(report.summary.outcome_blockers, 1);
  assert.equal(report.summary.accepted_failed_outcomes, 0);
  assert.deepEqual(report.issues.map((issue) => issue.category), ['integrity', 'outcome']);
  assert.equal(report.anchors.audit_head_hash, auditHash);
  assert.equal(report.anchors.lineage_graph_sha256, lineageHash);

  const accepted = projectGateReportFromVerification({
    ...verification,
    ok: true,
    errors: []
  }, { allow_failed_runs: true, allow_failed_simulations: true }, {
    now: new Date('2026-08-11T12:05:00.000Z')
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.summary.blockers, 0);
  assert.equal(accepted.summary.accepted_failed_outcomes, 4);

  const inconsistent = projectGateReportFromVerification({
    ok: true,
    audit: { ok: false, count: 0, head: null, errors: [] },
    lineage: { integrity: { ok: true, graph_sha256: lineageHash }, summary: {}, findings: [] },
    counts: {},
    errors: []
  });
  assert.equal(inconsistent.ok, false);
  assert.equal(inconsistent.summary.integrity_blockers, 1);
  assert.equal(inconsistent.issues[0].issue, 'project_verification_inconsistent');
});

test('project gate response redacts secrets, bounds diagnostics, and fingerprints deterministically', () => {
  const errors = Array.from({ length: MAX_PROJECT_GATE_ISSUES + 9 }, (_, index) => ({
    issue: index % 2 ? 'failed_runs' : 'record_invalid',
    run_id: 'run-' + index,
    token: 'supersecretvalue123',
    diagnostic: '\u03bb'.repeat(MAX_PROJECT_GATE_ISSUE_BYTES)
  }));
  const verification = {
    ok: false,
    audit: { ok: false, count: 1, head: null, errors: [{}] },
    lineage: null,
    counts: { failed_runs: 68 },
    errors
  };
  const first = projectGateReportFromVerification(verification, {}, {
    now: new Date('2026-08-11T12:00:00.000Z')
  });
  const second = projectGateReportFromVerification(verification, {}, {
    now: new Date('2026-08-11T12:01:00.000Z')
  });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.generated_at, second.generated_at);
  assert.equal(first.issues.length, MAX_PROJECT_GATE_ISSUES);
  assert.equal(first.summary.omitted_issues, 9);
  assert.equal(first.summary.truncated, true);
  assert.equal(first.issues[0].detail_truncated, true);
  assert.ok(Buffer.byteLength(first.issues[0].details.preview) <=
    MAX_PROJECT_GATE_ISSUE_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(first.issues[0].details)) <=
    MAX_PROJECT_GATE_ISSUE_BYTES);
  const serialized = JSON.stringify(first);
  assert.ok(Buffer.byteLength(serialized) < 4 * 1024 * 1024);
  assert.doesNotMatch(serialized, /supersecretvalue123/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('real project gate is read-only, anchors the audit head, and fails closed on verifier errors', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-project-gate-'));
  const event = appendAudit(directory, { type: 'gate.fixture' });
  const before = fs.readFileSync(
    path.join(directory, '.sciencecode', 'audit', 'events.jsonl'),
    'utf8'
  );
  const report = buildProjectGateReport(directory);
  assert.equal(report.ok, true);
  assert.equal(report.anchors.audit_head_hash, event.hash);
  assert.equal(report.audit.head_hash, event.hash);
  assert.equal(fs.readFileSync(
    path.join(directory, '.sciencecode', 'audit', 'events.jsonl'),
    'utf8'
  ), before);

  const failed = buildProjectGateReport(directory, {}, {
    verify() {
      throw Object.assign(new Error('token=supersecretvalue123'), { code: 'BROKEN' });
    },
    now: new Date('2026-08-11T12:00:00.000Z')
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.summary.integrity_blockers, 1);
  assert.equal(failed.issues[0].issue, 'project_verification_failed');
  assert.doesNotMatch(JSON.stringify(failed), /supersecretvalue123/);
});
