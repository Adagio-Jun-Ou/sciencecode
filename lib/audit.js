import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sha256Json } from './hash.js';
import { ensureScienceDir, INTERNAL_DIR, readJson, writeJson } from './storage.js';

export const AUDIT_SCHEMA_VERSION = 2;
const GENESIS_HASH = 'GENESIS';
const LOCK_TIMEOUT_MS = 5_000;
const auditCacheStorage = new AsyncLocalStorage();

function fileIdentity(file) {
  const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
  if (!stat) return 'missing';
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

function auditIdentity(paths, includeHead = false) {
  const events = fileIdentity(paths.events);
  return includeHead ? events + '|' + fileIdentity(paths.head) : events;
}

export function createAuditCache({ maxProjects = 8 } = {}) {
  if (!Number.isInteger(maxProjects) || maxProjects < 1) {
    throw new TypeError('Audit cache maxProjects must be a positive integer.');
  }
  return {
    lines: new Map(),
    records: new Map(),
    verifications: new Map(),
    maxProjects,
    stats: {
      line_hits: 0,
      record_hits: 0,
      verification_hits: 0
    }
  };
}

export function withAuditCache(cacheOrCallback, maybeCallback) {
  const active = auditCacheStorage.getStore();
  const callback = typeof cacheOrCallback === 'function'
    ? cacheOrCallback
    : maybeCallback;
  if (typeof callback !== 'function') {
    throw new TypeError('Audit cache callback must be a function.');
  }
  const scope = typeof cacheOrCallback === 'function'
    ? active ?? createAuditCache()
    : cacheOrCallback;
  if (!scope?.lines || !scope?.records || !scope?.verifications ||
      !Number.isInteger(scope.maxProjects)) {
    throw new TypeError('Invalid audit cache.');
  }
  if (active === scope) return callback(scope.stats);
  return auditCacheStorage.run(scope, () => callback(scope.stats));
}

function remember(cache, key, value, maxEntries) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}

function invalidateAuditCache(cwd) {
  const scope = auditCacheStorage.getStore();
  if (!scope) return;
  const key = path.resolve(cwd);
  scope.lines.delete(key);
  scope.records.delete(key);
  scope.verifications.delete(key);
}

function auditPaths(cwd) {
  const directory = path.join(path.resolve(cwd), INTERNAL_DIR, 'audit');
  return {
    directory,
    events: path.join(directory, 'events.jsonl'),
    head: path.join(directory, 'head.json'),
    lock: path.join(directory, 'events.lock')
  };
}

function sleepSync(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function withAuditLock(cwd, callback) {
  ensureScienceDir(cwd);
  const paths = auditPaths(cwd);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(paths.lock, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${process.pid} ${new Date().toISOString()}\n`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(
          new Error(`Audit log is locked by another process: ${paths.lock}`),
          { code: 'AUDIT_LOCKED' }
        );
      }
      sleepSync(25);
    }
  }
  try {
    return callback(paths);
  } finally {
    try {
      fs.closeSync(descriptor);
    } finally {
      try {
        fs.unlinkSync(paths.lock);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

function rawAuditLines(cwd, paths = auditPaths(cwd)) {
  const scope = auditCacheStorage.getStore();
  const key = path.resolve(cwd);
  const identity = auditIdentity(paths);
  const cached = scope?.lines.get(key);
  if (cached?.identity === identity) {
    scope.stats.line_hits += 1;
    return cached.lines;
  }
  const lines = identity === 'missing'
    ? []
    : fs.readFileSync(paths.events, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  if (scope) remember(scope.lines, key, { identity, lines }, scope.maxProjects);
  return lines;
}

export function readAuditRecords(cwd) {
  const paths = auditPaths(cwd);
  const scope = auditCacheStorage.getStore();
  const key = path.resolve(cwd);
  const identity = auditIdentity(paths);
  const cached = scope?.records.get(key);
  if (cached?.identity === identity) {
    scope.stats.record_hits += 1;
    return cached.records;
  }
  const records = rawAuditLines(cwd, paths).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw Object.assign(new Error(`Invalid audit JSON at line ${index + 1}: ${error.message}`), {
        code: 'INVALID_AUDIT_LOG',
        line: index + 1
      });
    }
  });
  if (scope) remember(scope.records, key, { identity, records }, scope.maxProjects);
  return records;
}

export function appendAudit(cwd, event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
    throw Object.assign(new Error('Audit event must be an object with a type.'), { code: 'INVALID_AUDIT_EVENT' });
  }
  return withAuditLock(cwd, (paths) => {
    const records = readAuditRecords(cwd);
    const previous = records.at(-1);
    const {
      hash: _ignoredHash,
      prev_hash: _ignoredPrevious,
      sequence: _ignoredSequence,
      schema_version: _ignoredSchema,
      ts: _ignoredTimestamp,
      ...payload
    } = event;
    const body = {
      schema_version: AUDIT_SCHEMA_VERSION,
      sequence: records.length + 1,
      ts: new Date().toISOString(),
      ...payload,
      prev_hash: previous?.hash ?? GENESIS_HASH
    };
    const record = { ...body, hash: sha256Json(body) };
    const descriptor = fs.openSync(paths.events, 'a', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    writeJson(paths.head, {
      schema_version: AUDIT_SCHEMA_VERSION,
      count: record.sequence,
      hash: record.hash,
      updated_at: record.ts
    });
    invalidateAuditCache(cwd);
    return record;
  });
}

export function verifyAudit(cwd) {
  const paths = auditPaths(cwd);
  const scope = auditCacheStorage.getStore();
  const key = path.resolve(cwd);
  const identity = auditIdentity(paths, true);
  const cached = scope?.verifications.get(key);
  if (cached?.identity === identity) {
    scope.stats.verification_hits += 1;
    return cached.verification;
  }
  const lines = rawAuditLines(cwd, paths);
  const errors = [];
  let previous = GENESIS_HASH;
  let lastHash = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      errors.push({ line: lineNumber, issue: 'invalid_json' });
      return;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push({ line: lineNumber, issue: 'invalid_record' });
      return;
    }
    const { hash, ...body } = record;
    if (record.prev_hash !== previous) {
      errors.push({ line: lineNumber, issue: 'chain_break', expected: previous, actual: record.prev_hash ?? null });
    }
    if (record.sequence !== undefined && record.sequence !== lineNumber) {
      errors.push({ line: lineNumber, issue: 'sequence_mismatch', expected: lineNumber, actual: record.sequence });
    }
    const calculated = sha256Json(body);
    if (hash !== calculated) {
      errors.push({ line: lineNumber, issue: 'hash_mismatch', expected: calculated, actual: hash ?? null });
    }
    if (typeof hash !== 'string') {
      errors.push({ line: lineNumber, issue: 'missing_hash' });
    } else {
      previous = hash;
      lastHash = hash;
    }
  });

  let head = null;
  if (fs.existsSync(paths.head)) {
    try {
      head = readJson(paths.head);
      if (head.count !== lines.length) {
        errors.push({ issue: 'head_count_mismatch', expected: lines.length, actual: head.count ?? null });
      }
      if ((head.hash ?? null) !== lastHash) {
        errors.push({ issue: 'head_hash_mismatch', expected: lastHash, actual: head.hash ?? null });
      }
    } catch {
      errors.push({ issue: 'invalid_head' });
    }
  } else if (lines.length) {
    errors.push({ issue: 'missing_head' });
  }

  const verification = {
    ok: errors.length === 0,
    count: lines.length,
    head,
    errors
  };
  if (scope) {
    remember(scope.verifications, key, { identity, verification }, scope.maxProjects);
  }
  return verification;
}
