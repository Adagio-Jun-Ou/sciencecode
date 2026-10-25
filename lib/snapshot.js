import fs from 'node:fs';
import path from 'node:path';
import { sha256File, sha256Text } from './hash.js';
import { INTERNAL_DIR, portablePath, resolvePortableSnapshotPath } from './storage.js';

export const SNAPSHOT_SCHEMA_VERSION = 2;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function positiveLimit(value, name) {
  if (value === undefined || value === null || value === Infinity) return Infinity;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw Object.assign(new TypeError(name + ' must be a positive integer.'), {
      code: 'INVALID_SNAPSHOT_LIMIT'
    });
  }
  return value;
}

function shouldSkip(relative) {
  const parts = portablePath(relative).split('/');
  return parts[0] === INTERNAL_DIR || parts.includes('.git') || parts.includes('node_modules');
}

function assertDirectory(root) {
  const resolved = path.resolve(root);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw Object.assign(new Error(`Project directory does not exist: ${resolved}`), { code: 'PROJECT_NOT_FOUND' });
  }
  if (!stat.isDirectory()) {
    throw Object.assign(new Error(`Project path is not a directory: ${resolved}`), { code: 'PROJECT_NOT_DIRECTORY' });
  }
  return resolved;
}

export function listFileEntries(root, options = {}) {
  const base = assertDirectory(root);
  const maxFiles = positiveLimit(options.maxFiles, 'Snapshot file limit');
  const entries = [];

  function walk(directory) {
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(base, absolute);
      if (shouldSkip(relative)) continue;
      if (child.isDirectory()) {
        walk(absolute);
      } else if (child.isFile()) {
        entries.push({ path: portablePath(relative), type: 'file', absolute });
      } else if (child.isSymbolicLink()) {
        entries.push({ path: portablePath(relative), type: 'symlink', absolute });
      }
      if (entries.length > maxFiles) {
        throw Object.assign(
          new Error('Project exceeds the ' + maxFiles + '-entry snapshot limit.'),
          { code: 'SNAPSHOT_FILE_LIMIT', maximum: maxFiles }
        );
      }
    }
  }

  walk(base);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function listFiles(root, options = {}) {
  return listFileEntries(root, options).map((entry) => entry.path);
}

export function snapshot(root, options = {}) {
  const maxTotalBytes = positiveLimit(
    options.maxTotalBytes,
    'Snapshot total-byte limit'
  );
  const files = {};
  let totalBytes = 0;
  for (const entry of listFileEntries(root, options)) {
    if (entry.type === 'symlink') {
      const target = fs.readlinkSync(entry.absolute);
      const bytes = Buffer.byteLength(target);
      totalBytes += bytes;
      if (totalBytes > maxTotalBytes) {
        throw Object.assign(
          new Error('Project exceeds the ' + maxTotalBytes + '-byte snapshot limit.'),
          { code: 'SNAPSHOT_BYTE_LIMIT', maximum: maxTotalBytes }
        );
      }
      files[entry.path] = {
        type: 'symlink',
        sha256: sha256Text(target),
        bytes,
        target
      };
      continue;
    }
    const bytes = fs.statSync(entry.absolute).size;
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      throw Object.assign(
        new Error('Project exceeds the ' + maxTotalBytes + '-byte snapshot limit.'),
        { code: 'SNAPSHOT_BYTE_LIMIT', maximum: maxTotalBytes }
      );
    }
    files[entry.path] = {
      type: 'file',
      sha256: sha256File(entry.absolute),
      bytes
    };
  }
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    algorithm: 'sha256',
    created_at: new Date().toISOString(),
    files
  };
}

function sameFile(left, right) {
  return (
    (left.type ?? 'file') === (right.type ?? 'file') &&
    left.sha256 === right.sha256 &&
    (left.bytes === undefined || right.bytes === undefined || left.bytes === right.bytes)
  );
}

export function diffSnapshots(before, after) {
  const previous = before?.files ?? {};
  const current = after?.files ?? {};
  const added = [];
  const modified = [];
  const missing = [];
  for (const file of Object.keys(current)) {
    if (!previous[file]) added.push(file);
    else if (!sameFile(previous[file], current[file])) modified.push(file);
  }
  for (const file of Object.keys(previous)) {
    if (!current[file]) missing.push(file);
  }
  return {
    added: added.sort(),
    modified: modified.sort(),
    missing: missing.sort()
  };
}

export function validateSnapshot(value, options = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ issue: 'invalid_snapshot', detail: 'Snapshot must be an object.' }];
  }
  if (value.schema_version !== undefined &&
      ![1, SNAPSHOT_SCHEMA_VERSION].includes(value.schema_version)) {
    errors.push({
      issue: 'unsupported_schema',
      expected: [1, SNAPSHOT_SCHEMA_VERSION],
      actual: value.schema_version ?? null
    });
  }
  if (value.algorithm !== 'sha256') {
    errors.push({ issue: 'unsupported_algorithm', expected: 'sha256', actual: value.algorithm ?? null });
  }
  if (value.created_at !== undefined &&
      (typeof value.created_at !== 'string' ||
        Number.isNaN(Date.parse(value.created_at)))) {
    errors.push({ issue: 'invalid_created_at', actual: value.created_at ?? null });
  }
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) {
    errors.push({ issue: 'invalid_files', detail: 'Snapshot files must be an object.' });
    return errors;
  }
  const maxFiles = positiveLimit(options.maxFiles, 'Snapshot file limit');
  const fileCount = Object.keys(value.files).length;
  if (fileCount > maxFiles) {
    errors.push({
      issue: 'snapshot_file_limit',
      maximum: maxFiles,
      actual: fileCount
    });
  }
  return errors;
}

function validatedSnapshotEntry(root, relative, metadata) {
  let absolute;
  try {
    absolute = resolvePortableSnapshotPath(root, relative);
  } catch (error) {
    return {
      error: { file: relative, issue: 'invalid_path', detail: error.message }
    };
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      typeof metadata.sha256 !== 'string') {
    return { error: { file: relative, issue: 'invalid_metadata' } };
  }
  const expectedType = metadata.type ?? 'file';
  if (!['file', 'symlink'].includes(expectedType)) {
    return {
      error: { file: relative, issue: 'invalid_type', actual: expectedType }
    };
  }
  if (!SHA256_PATTERN.test(metadata.sha256)) {
    return { error: { file: relative, issue: 'invalid_digest' } };
  }
  if (metadata.bytes !== undefined &&
      (!Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0)) {
    return { error: { file: relative, issue: 'invalid_size' } };
  }
  if (expectedType === 'symlink' && metadata.target !== undefined &&
      typeof metadata.target !== 'string') {
    return { error: { file: relative, issue: 'invalid_target' } };
  }
  return { absolute, expectedType };
}

export function validateSnapshotContents(root, value, options = {}) {
  const errors = validateSnapshot(value, options);
  if (!value?.files || typeof value.files !== 'object' ||
      Array.isArray(value.files)) return errors;
  for (const [relative, metadata] of Object.entries(value.files)) {
    const checked = validatedSnapshotEntry(root, relative, metadata);
    if (checked.error) errors.push(checked.error);
  }
  return errors.sort((left, right) =>
    String(left.file ?? '').localeCompare(String(right.file ?? '')) ||
    String(left.issue ?? '').localeCompare(String(right.issue ?? ''))
  );
}

export function verifySnapshot(root, value, options = {}) {
  const errors = validateSnapshot(value, options);
  if (errors.length) return { ok: false, strict: Boolean(options.strict), errors };

  const expectedPaths = new Set();
  for (const [relative, metadata] of Object.entries(value.files)) {
    const checked = validatedSnapshotEntry(root, relative, metadata);
    if (checked.error) {
      errors.push(checked.error);
      continue;
    }
    const { absolute, expectedType } = checked;
    expectedPaths.add(portablePath(relative.replace(/\\/g, '/')));
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      errors.push({ file: relative, issue: error.code === 'ENOENT' ? 'missing' : 'unreadable' });
      continue;
    }
    if (expectedType === 'symlink') {
      if (!stat.isSymbolicLink()) {
        errors.push({ file: relative, issue: 'type_mismatch', expected: 'symlink' });
        continue;
      }
      const target = fs.readlinkSync(absolute);
      const actual = sha256Text(target);
      if (actual !== metadata.sha256) {
        errors.push({ file: relative, issue: 'hash_mismatch', expected: metadata.sha256, actual });
      }
      continue;
    }
    if (expectedType !== 'file' || !stat.isFile()) {
      errors.push({ file: relative, issue: 'type_mismatch', expected: expectedType, actual: stat.isDirectory() ? 'directory' : 'other' });
      continue;
    }
    const actual = sha256File(absolute);
    if (actual !== metadata.sha256) {
      errors.push({ file: relative, issue: 'hash_mismatch', expected: metadata.sha256, actual });
    } else if (metadata.bytes !== undefined && stat.size !== metadata.bytes) {
      errors.push({ file: relative, issue: 'size_mismatch', expected: metadata.bytes, actual: stat.size });
    }
  }

  if (options.strict) {
    try {
      for (const entry of listFileEntries(root, options)) {
        if (!expectedPaths.has(entry.path)) errors.push({ file: entry.path, issue: 'unexpected' });
      }
    } catch (error) {
      errors.push({
        issue: error.code ?? 'snapshot_listing_failed',
        detail: error.message
      });
    }
  }
  errors.sort((left, right) => String(left.file ?? '').localeCompare(String(right.file ?? '')) || left.issue.localeCompare(right.issue));
  return { ok: errors.length === 0, strict: Boolean(options.strict), errors };
}
