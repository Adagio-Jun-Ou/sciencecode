import fs from 'node:fs';
import path from 'node:path';

export const INTERNAL_DIR = '.sciencecode';

export function portablePath(value) {
  return String(value).split(path.sep).join('/');
}

export function relativePortable(root, value) {
  return portablePath(path.relative(path.resolve(root), path.resolve(value)));
}

export function isPathInside(root, value) {
  const base = path.resolve(root);
  const target = path.resolve(value);
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveInsideRoot(root, value, { allowRoot = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw Object.assign(new Error('A non-empty, valid path is required.'), { code: 'INVALID_PATH' });
  }
  const base = path.resolve(root);
  const target = path.resolve(base, value);
  if (!isPathInside(base, target) || (!allowRoot && target === base)) {
    throw Object.assign(new Error(`Path escapes the project root: ${value}`), { code: 'PATH_OUTSIDE_ROOT' });
  }
  return target;
}

export function resolvePortableSnapshotPath(root, value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw Object.assign(new Error('Snapshot contains an invalid path.'), { code: 'INVALID_SNAPSHOT_PATH' });
  }
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw Object.assign(new Error(`Snapshot path must be relative: ${value}`), { code: 'INVALID_SNAPSHOT_PATH' });
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error(`Snapshot path contains unsafe segments: ${value}`), { code: 'INVALID_SNAPSHOT_PATH' });
  }
  const target = path.resolve(root, ...parts);
  if (!isPathInside(root, target)) {
    throw Object.assign(new Error(`Snapshot path escapes the project root: ${value}`), { code: 'INVALID_SNAPSHOT_PATH' });
  }
  return target;
}

export function ensureScienceDir(cwd) {
  const base = path.join(path.resolve(cwd), INTERNAL_DIR);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  for (const name of [
    'runs', 'simulations', 'inferences', 'experiments', 'chats', 'interactions', 'evidence',
    'retrievals', 'kernels', 'snapshots', 'audit', 'preregistrations', 'revisions',
    'procedures', 'procedure-assessments', 'procedure-decisions', 'campaigns',
    'figure-comparisons', 'figure-registrations', 'figure-visuals',
    'cad-projects', 'cad-revisions', 'cad-builds', 'cad-simulations', 'cad-slices'
  ]) {
    fs.mkdirSync(path.join(base, name), { recursive: true, mode: 0o700 });
  }
  return base;
}

export function writeTextExclusive(file, content, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'wx', options.mode ?? 0o600);
  try {
    fs.writeFileSync(fd, content, options.encoding ?? 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function writeJsonExclusive(file, value, options = {}) {
  writeTextExclusive(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function writeJson(file, value, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: options.mode ?? 0o600
  });
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function safeInit(cwd) {
  const base = ensureScienceDir(cwd);
  const created = [];
  const skipped = [];
  const files = {
    [path.join(base, 'README.md')]: '# .sciencecode\n\nScienceCode metadata and append-only provenance records. Preserve this directory when sharing or archiving the research project.\n',
    [path.join(base, 'POLICY.md')]: '# Preservation policy\n\n- Never delete archived or legacy work.\n- Prefer additive, versioned outputs.\n- Never overwrite existing research artifacts during initialization.\n- Record provenance and verification material under .sciencecode/.\n'
  };
  for (const [file, content] of Object.entries(files)) {
    const relative = relativePortable(cwd, file);
    if (fs.existsSync(file)) {
      skipped.push(relative);
      continue;
    }
    writeTextExclusive(file, content);
    created.push(relative);
  }
  return { created, skipped };
}
