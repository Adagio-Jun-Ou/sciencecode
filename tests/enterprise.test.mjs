import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendAudit,
  parseOpenCodeEvents,
  redactText,
  scanSecrets,
  summarizeOpenCodeEvents,
  verifyAudit
} from '../lib/core.js';
import { createAuditCache, withAuditCache } from '../lib/audit.js';

function temporaryProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-enterprise-'));
}

test('secret scanner detects common credential forms', () => {
  const samples = [
    'token=supersecretvalue123',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'AKIAABCDEFGHIJKLMNOP',
    'postgres://user:password@example.test/database',
    '-----BEGIN PRIVATE KEY-----'
  ];
  for (const sample of samples) assert.ok(scanSecrets(sample).length, sample);
  assert.deepEqual(scanSecrets('estimate the token count and keep the analysis secret-free'), []);
});

test('redactor removes credentials while preserving JSON syntax', () => {
  const source = JSON.stringify({
    token: 'supersecretvalue123',
    nested: { password: 'hunter2' },
    safe: 'keep'
  });
  const redacted = redactText(source);
  assert.deepEqual(JSON.parse(redacted), {
    token: '[REDACTED]',
    nested: { password: '[REDACTED]' },
    safe: 'keep'
  });
  assert.equal(redactText('Bearer abcdefghijklmnopqrstuvwxyz'), 'Bearer [REDACTED]');
});

test('audit log is sequenced, hash chained, and anchored by a mutable head', () => {
  const directory = temporaryProject();
  const first = appendAudit(directory, { type: 'a' });
  const second = appendAudit(directory, { type: 'b' });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(second.prev_hash, first.hash);
  const result = verifyAudit(directory);
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.head.hash, second.hash);
});

test('audit verification detects record tampering', () => {
  const directory = temporaryProject();
  appendAudit(directory, { type: 'a' });
  appendAudit(directory, { type: 'b' });
  const file = path.join(directory, '.sciencecode', 'audit', 'events.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"type":"a"', '"type":"x"'));
  const result = verifyAudit(directory);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.issue === 'hash_mismatch'));
});

test('audit head detects truncation of an otherwise valid chain', () => {
  const directory = temporaryProject();
  appendAudit(directory, { type: 'a' });
  appendAudit(directory, { type: 'b' });
  const file = path.join(directory, '.sciencecode', 'audit', 'events.jsonl');
  const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0];
  fs.writeFileSync(file, `${firstLine}\n`);
  const result = verifyAudit(directory);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.issue === 'head_count_mismatch'));
  assert.ok(result.errors.some((error) => error.issue === 'head_hash_mismatch'));
});

test('audit verification is read-only for an uninitialized project', () => {
  const directory = temporaryProject();
  assert.deepEqual(verifyAudit(directory), { ok: true, count: 0, head: null, errors: [] });
  assert.equal(fs.existsSync(path.join(directory, '.sciencecode')), false);
});

test('audit cache reuses an unchanged chain and invalidates append and tamper changes', () => {
  const directory = temporaryProject();
  appendAudit(directory, { type: 'a' });
  const cache = createAuditCache({ maxProjects: 1 });
  const first = withAuditCache(cache, () => verifyAudit(directory));
  const reused = withAuditCache(cache, () => verifyAudit(directory));
  assert.equal(first.ok, true);
  assert.strictEqual(reused, first);
  assert.equal(cache.stats.verification_hits, 1);

  appendAudit(directory, { type: 'b' });
  const appended = withAuditCache(cache, () => verifyAudit(directory));
  assert.equal(appended.ok, true);
  assert.equal(appended.count, 2);

  const events = path.join(directory, '.sciencecode', 'audit', 'events.jsonl');
  const before = fs.statSync(events);
  const source = fs.readFileSync(events, 'utf8');
  fs.writeFileSync(events, source.replace('"type":"b"', '"type":"c"'));
  fs.utimesSync(events, before.atime, before.mtime);
  const tampered = withAuditCache(cache, () => verifyAudit(directory));
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.issue === 'hash_mismatch'));
});

test('OpenCode JSON event parsing captures types, sessions, and invalid lines', () => {
  const input = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_1', part: {} }),
    JSON.stringify({ type: 'text', sessionID: 'ses_1', part: { text: 'result' } }),
    'not json'
  ].join('\n');
  const parsed = parseOpenCodeEvents(input);
  assert.equal(parsed.events.length, 2);
  assert.deepEqual(parsed.invalid, [{ line: 3, issue: 'invalid_json' }]);
  assert.deepEqual(summarizeOpenCodeEvents(input), {
    count: 2,
    invalid_lines: [{ line: 3, issue: 'invalid_json' }],
    types: { step_start: 1, text: 1 },
    session_ids: ['ses_1']
  });
});
