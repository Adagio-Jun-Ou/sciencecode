import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffSnapshots,
  listFiles,
  resolvePortableSnapshotPath,
  safeInit,
  sha256Buffer,
  sha256File,
  snapshot,
  verifySnapshot,
  writeJsonExclusive
} from '../lib/core.js';
import {
  createFileHashCache,
  preloadFileHashCache,
  withFileHashCache
} from '../lib/hash.js';

function temporaryProject(prefix = 'sciencecode-core-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('safeInit is additive and returns portable paths', () => {
  const directory = temporaryProject();
  fs.mkdirSync(path.join(directory, '.sciencecode'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.sciencecode', 'POLICY.md'), 'KEEP ME');
  const result = safeInit(directory);
  assert.equal(fs.readFileSync(path.join(directory, '.sciencecode', 'POLICY.md'), 'utf8'), 'KEEP ME');
  assert.ok(result.skipped.includes('.sciencecode/POLICY.md'));
  assert.ok(result.created.includes('.sciencecode/README.md'));
});

test('file hashing streams data across the 8 MiB inference-model chunk boundary', () => {
  const directory = temporaryProject('sciencecode-hash-');
  const file = path.join(directory, 'multi-chunk.onnx');
  const value = Buffer.alloc(8 * 1024 * 1024 + 257, 0x5a);
  value[0] = 0x08;
  value[8 * 1024 * 1024 - 1] = 0x7f;
  value[8 * 1024 * 1024] = 0x11;
  value[value.length - 1] = 0xa5;
  fs.writeFileSync(file, value);
  assert.equal(sha256File(file), sha256Buffer(value));
});

test('bounded file hash caches preload concurrently and invalidate same-size mutations', async () => {
  const directory = temporaryProject('sciencecode-hash-cache-');
  const files = ['a.txt', 'b.txt', 'c.txt'].map((name, index) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, String(index).repeat(32));
    return file;
  });
  const cache = createFileHashCache({ maxEntries: 2 });
  await preloadFileHashCache(cache, files, { concurrency: 2 });
  assert.equal(cache.stats.entries, 2);
  assert.equal(cache.stats.preloaded, 3);

  const file = files.at(-1);
  const before = fs.statSync(file);
  const first = withFileHashCache(cache, () => sha256File(file));
  assert.equal(cache.stats.hits, 1);
  fs.writeFileSync(file, 'x'.repeat(32));
  fs.utimesSync(file, before.atime, before.mtime);
  const second = withFileHashCache(cache, () => sha256File(file));
  assert.notEqual(second, first);
  assert.equal(cache.stats.misses, 1);
});

test('snapshot excludes implementation metadata and generated dependency trees', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'data.txt'), 'research data');
  fs.mkdirSync(path.join(directory, '.sciencecode', 'audit'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.sciencecode', 'audit', 'events.jsonl'), '{}');
  fs.mkdirSync(path.join(directory, 'node_modules', 'package'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'node_modules', 'package', 'index.js'), 'generated');
  assert.deepEqual(listFiles(directory), ['data.txt']);
  const value = snapshot(directory);
  assert.equal(value.schema_version, 2);
  assert.deepEqual(Object.keys(value.files), ['data.txt']);
});

test('snapshot verification detects mutation and strict mode detects additions', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'data.txt'), 'a');
  const value = snapshot(directory);
  assert.equal(verifySnapshot(directory, value).ok, true);
  fs.writeFileSync(path.join(directory, 'extra.txt'), 'new');
  assert.equal(verifySnapshot(directory, value).ok, true);
  const strict = verifySnapshot(directory, value, { strict: true });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.errors, [{ file: 'extra.txt', issue: 'unexpected' }]);
  fs.writeFileSync(path.join(directory, 'data.txt'), 'b');
  assert.ok(verifySnapshot(directory, value).errors.some((error) => error.issue === 'hash_mismatch'));
});

test('snapshot verification rejects traversal before reading outside the project', () => {
  const directory = temporaryProject();
  const value = {
    schema_version: 2,
    algorithm: 'sha256',
    files: {
      '../outside.txt': { type: 'file', sha256: '0'.repeat(64), bytes: 1 }
    }
  };
  const result = verifySnapshot(directory, value);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].issue, 'invalid_path');
  assert.throws(() => resolvePortableSnapshotPath(directory, '../outside.txt'), { code: 'INVALID_SNAPSHOT_PATH' });
});

test('snapshot validation reports unsupported algorithms and malformed metadata', () => {
  const directory = temporaryProject();
  assert.deepEqual(
    verifySnapshot(directory, { algorithm: 'md5', files: {} }).errors,
    [{ issue: 'unsupported_algorithm', expected: 'sha256', actual: 'md5' }]
  );
  fs.writeFileSync(path.join(directory, 'a.txt'), 'a');
  const result = verifySnapshot(directory, { algorithm: 'sha256', files: { 'a.txt': null } });
  assert.deepEqual(result.errors, [{ file: 'a.txt', issue: 'invalid_metadata' }]);
});

test('diffSnapshots classifies added, modified, and missing files', () => {
  const before = { files: { a: { sha256: '1' }, b: { sha256: '2' } } };
  const after = { files: { a: { sha256: '3' }, c: { sha256: '4' } } };
  assert.deepEqual(diffSnapshots(before, after), {
    added: ['c'],
    modified: ['a'],
    missing: ['b']
  });
});

test('exclusive JSON writes refuse to overwrite an existing artifact', () => {
  const directory = temporaryProject();
  const file = path.join(directory, 'record.json');
  writeJsonExclusive(file, { first: true });
  assert.throws(() => writeJsonExclusive(file, { second: true }), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { first: true });
});
