import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const fileHashCacheStorage = new AsyncLocalStorage();

function fileIdentity(stat) {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs
  ].join(':');
}

function hashOpenFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (fileIdentity(before) !== fileIdentity(after)) {
      throw Object.assign(
        new Error('File changed while its SHA-256 digest was being calculated: ' + file),
        { code: 'FILE_CHANGED_DURING_HASH' }
      );
    }
    return { digest: hash.digest('hex'), identity: fileIdentity(after) };
  } finally {
    fs.closeSync(descriptor);
  }
}

async function hashOpenFileAsync(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = await fs.promises.open(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const before = await descriptor.stat({ bigint: true });
    let position = 0;
    while (true) {
      const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await descriptor.stat({ bigint: true });
    if (fileIdentity(before) !== fileIdentity(after)) return null;
    return { digest: hash.digest('hex'), identity: fileIdentity(after) };
  } finally {
    await descriptor.close();
  }
}

function rememberFileHash(scope, resolved, calculated) {
  scope.entries.delete(resolved);
  scope.entries.set(resolved, calculated);
  while (scope.entries.size > scope.maxEntries) {
    scope.entries.delete(scope.entries.keys().next().value);
  }
  scope.stats.entries = scope.entries.size;
}

export function createFileHashCache({ maxEntries = 8_192 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('File hash cache maxEntries must be a positive integer.');
  }
  return {
    entries: new Map(),
    maxEntries,
    stats: {
      hits: 0,
      misses: 0,
      entries: 0,
      preloaded: 0,
      preload_hits: 0,
      preload_errors: 0
    }
  };
}

export function withFileHashCache(cacheOrCallback, maybeCallback) {
  const active = fileHashCacheStorage.getStore();
  const callback = typeof cacheOrCallback === 'function'
    ? cacheOrCallback
    : maybeCallback;
  if (typeof callback !== 'function') {
    throw new TypeError('File hash cache callback must be a function.');
  }
  const scope = typeof cacheOrCallback === 'function'
    ? active ?? createFileHashCache()
    : cacheOrCallback;
  if (!scope?.entries || !scope?.stats || !Number.isInteger(scope.maxEntries)) {
    throw new TypeError('Invalid file hash cache.');
  }
  if (active === scope) return callback(scope.stats);
  return fileHashCacheStorage.run(scope, () => callback(scope.stats));
}

export async function preloadFileHashCache(cache, files, { concurrency = 12 } = {}) {
  if (!cache?.entries || !cache?.stats || !Number.isInteger(cache.maxEntries)) {
    throw new TypeError('Invalid file hash cache.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new TypeError('File hash preload concurrency must be an integer from 1 through 64.');
  }
  const queue = [...new Set(files.map((file) => path.resolve(file)))];
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const resolved = queue[cursor];
      cursor += 1;
      try {
        const identity = fileIdentity(fs.statSync(resolved, { bigint: true }));
        const cached = cache.entries.get(resolved);
        if (cached?.identity === identity) {
          rememberFileHash(cache, resolved, cached);
          cache.stats.preload_hits += 1;
          continue;
        }
        const calculated = await hashOpenFileAsync(resolved);
        if (!calculated) {
          cache.stats.preload_errors += 1;
          continue;
        }
        rememberFileHash(cache, resolved, calculated);
        cache.stats.preloaded += 1;
      } catch {
        cache.stats.preload_errors += 1;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker()
  ));
  return cache.stats;
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  const scope = fileHashCacheStorage.getStore();
  if (!scope) return hashOpenFile(file).digest;

  const resolved = path.resolve(file);
  const currentIdentity = fileIdentity(fs.statSync(resolved, { bigint: true }));
  const cached = scope.entries.get(resolved);
  if (cached?.identity === currentIdentity) {
    scope.entries.delete(resolved);
    scope.entries.set(resolved, cached);
    scope.stats.hits += 1;
    return cached.digest;
  }

  const calculated = hashOpenFile(resolved);
  rememberFileHash(scope, resolved, calculated);
  scope.stats.misses += 1;
  return calculated.digest;
}

export function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}
