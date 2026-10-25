import fs from 'node:fs';
import path from 'node:path';
import { readAuditRecords, verifyAudit, appendAudit } from './audit.js';
import { sha256Buffer, sha256File } from './hash.js';
import { makeRunId } from './runs.js';
import { scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  relativePortable,
  resolveInsideRoot,
  writeJsonExclusive
} from './storage.js';

export const PREREGISTRATION_SCHEMA_VERSION = 2;
export const MAX_PREREGISTRATION_BYTES = 256 * 1024;
export const MAX_PREREGISTRATION_NAME_CHARS = 200;
export const PREREGISTRATION_REQUIRED_SECTIONS = Object.freeze([
  'Research question',
  'Hypotheses',
  'Design and population',
  'Primary outcomes',
  'Sample size and stopping rule',
  'Inclusion, exclusion, and missing data',
  'Analysis and decision rules',
  'Multiplicity and sensitivity analyses',
  'Deviations, risks, and limitations'
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INLINE_PLACEHOLDER_PATTERN = /\[REPLACE:[^\]]*\]/gi;

function preregistrationError(message, code = 'INVALID_PREREGISTRATION') {
  return Object.assign(new Error(message), { code });
}

function registryDirectory(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'preregistrations');
}

function checkedRegistryDirectory(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw preregistrationError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  const projectReal = fs.realpathSync(project);
  const metadataDirectory = path.join(project, INTERNAL_DIR);
  const checkDirectory = (directory, label, parentReal) => {
    const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!entry) return false;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw preregistrationError(
        label + ' is not a safe project directory.',
        'PREREGISTRATION_STORAGE_UNSAFE'
      );
    }
    const real = fs.realpathSync(directory);
    if (!isPathInside(parentReal, real)) {
      throw preregistrationError(
        label + ' escapes the project through a filesystem link.',
        'PREREGISTRATION_STORAGE_UNSAFE'
      );
    }
    return true;
  };
  checkDirectory(metadataDirectory, 'ScienceCode metadata storage', projectReal);
  const directory = registryDirectory(project);
  checkDirectory(directory, 'Preregistration storage', projectReal);
  if (create) {
    ensureScienceDir(project);
    checkDirectory(metadataDirectory, 'ScienceCode metadata storage', projectReal);
    checkDirectory(directory, 'Preregistration storage', projectReal);
  }
  return directory;
}

function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return slug || 'study';
}

function resolveRecord(cwd, id) {
  if (!ID_PATTERN.test(String(id ?? '')) || id === '.' || id === '..') {
    throw Object.assign(new Error(`Invalid preregistration ID: ${id ?? ''}`), { code: 'INVALID_PREREGISTRATION_ID' });
  }
  const directory = checkedRegistryDirectory(cwd);
  const file = path.join(directory, `${id}.json`);
  const entry = fs.lstatSync(file, { throwIfNoEntry: false });
  if (entry) {
    const directoryReal = fs.realpathSync(directory);
    if (entry.isSymbolicLink() || !entry.isFile() ||
        !isPathInside(directoryReal, fs.realpathSync(file))) {
      throw preregistrationError(
        'Preregistration record is not a safe regular file.',
        'PREREGISTRATION_STORAGE_UNSAFE'
      );
    }
  }
  return file;
}

function writeBufferExclusive(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function normalizeName(value, fallback = 'study') {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
  if (name.length > MAX_PREREGISTRATION_NAME_CHARS) {
    throw preregistrationError(
      'Preregistration name is limited to ' + MAX_PREREGISTRATION_NAME_CHARS + ' characters.',
      'INVALID_PREREGISTRATION_NAME'
    );
  }
  const findings = scanSecrets(name);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in preregistration name.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return name;
}

function normalizedHeading(value) {
  return String(value ?? '')
    .replace(/#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function inspectPreregistrationContent(value) {
  const content = typeof value === 'string' ? value : '';
  const bytes = Buffer.byteLength(content);
  const lines = content.split(/\r?\n/);
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const match = lines[index].match(/^ {0,3}#{2,6}[ \t]+(.+?)[ \t]*$/);
    if (match) headings.push({ index, name: normalizedHeading(match[1]) });
  }
  const required = PREREGISTRATION_REQUIRED_SECTIONS.map(normalizedHeading);
  const missingSections = [];
  const emptySections = [];
  const duplicateSections = [];
  for (const section of required) {
    const matches = headings.filter((heading) => heading.name === section);
    if (!matches.length) {
      missingSections.push(PREREGISTRATION_REQUIRED_SECTIONS[required.indexOf(section)]);
      continue;
    }
    if (matches.length > 1) {
      duplicateSections.push(PREREGISTRATION_REQUIRED_SECTIONS[required.indexOf(section)]);
    }
    const heading = matches[0];
    const next = headings.find((candidate) => candidate.index > heading.index);
    const body = lines.slice(heading.index + 1, next?.index ?? lines.length)
      .join('\n').trim();
    if (!body) emptySections.push(PREREGISTRATION_REQUIRED_SECTIONS[required.indexOf(section)]);
  }
  const placeholders = content.match(INLINE_PLACEHOLDER_PATTERN) ?? [];
  return {
    bytes,
    maximum_bytes: MAX_PREREGISTRATION_BYTES,
    required_sections: [...PREREGISTRATION_REQUIRED_SECTIONS],
    missing_sections: missingSections,
    empty_sections: emptySections,
    duplicate_sections: duplicateSections,
    placeholder_count: placeholders.length,
    valid: bytes > 0 && bytes <= MAX_PREREGISTRATION_BYTES &&
      missingSections.length === 0 && emptySections.length === 0 &&
      duplicateSections.length === 0 && placeholders.length === 0
  };
}

function createFrozenRecord(project, content, {
  name,
  extension,
  schemaVersion,
  sourceFile,
  source
}) {
  const id = `${makeRunId()}-${slugify(name)}`;
  const registry = checkedRegistryDirectory(project, { create: true });
  const safeExtension = /^\.[A-Za-z0-9]{1,15}$/.test(extension) ? extension : '';
  const frozenName = `${id}.frozen${safeExtension}`;
  const frozenFile = path.join(registry, frozenName);
  const recordFile = path.join(registry, `${id}.json`);
  writeBufferExclusive(frozenFile, content);
  const record = {
    schema_version: schemaVersion,
    preregistration_id: id,
    name,
    created_at: new Date().toISOString(),
    ...(sourceFile ? { source_file: sourceFile } : {}),
    ...(source ? { source } : {}),
    source_sha256: sha256Buffer(content),
    bytes: content.length,
    frozen_file: frozenName,
    frozen_sha256: sha256File(frozenFile),
    status: 'frozen'
  };
  writeJsonExclusive(recordFile, record);
  const recordHash = sha256File(recordFile);
  appendAudit(project, {
    type: 'preregistration.frozen',
    preregistration_id: id,
    record_sha256: recordHash,
    source_sha256: record.source_sha256,
    schema_version: schemaVersion,
    source_kind: source?.kind ?? 'project_file'
  });
  return { ...record, record_sha256: recordHash };
}

export function freezePreregistration(cwd, sourceFile, options = {}) {
  const project = path.resolve(cwd);
  const source = resolveInsideRoot(project, sourceFile);
  const sourceRelative = relativePortable(project, source);
  if (sourceRelative === INTERNAL_DIR || sourceRelative.startsWith(`${INTERNAL_DIR}/`)) {
    throw Object.assign(new Error('A preregistration source must be a research-project file, not ScienceCode metadata.'), {
      code: 'INVALID_PREREGISTRATION_SOURCE'
    });
  }
  const stat = fs.statSync(source, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw Object.assign(new Error(`Preregistration source is not a file: ${sourceFile}`), {
      code: 'PREREGISTRATION_SOURCE_NOT_FOUND'
    });
  }
  const projectReal = fs.realpathSync(project);
  const sourceReal = fs.realpathSync(source);
  if (!isPathInside(projectReal, sourceReal)) {
    throw preregistrationError(
      'Preregistration source resolves outside the project root.',
      'PATH_OUTSIDE_ROOT'
    );
  }
  const metadataRoot = path.join(projectReal, INTERNAL_DIR);
  if (isPathInside(metadataRoot, sourceReal)) {
    throw preregistrationError(
      'A preregistration source must be a research-project file, not ScienceCode metadata.',
      'INVALID_PREREGISTRATION_SOURCE'
    );
  }
  if (fs.statSync(sourceReal).size > MAX_PREREGISTRATION_BYTES) {
    throw preregistrationError(
      'Preregistration source exceeds the ' + MAX_PREREGISTRATION_BYTES + '-byte limit.',
      'PREREGISTRATION_TOO_LARGE'
    );
  }
  const content = fs.readFileSync(sourceReal);
  const findings = scanSecrets(content.toString('utf8'));
  if (findings.length) {
    throw Object.assign(
      new Error(`Potential secret detected in preregistration (${findings.map((finding) => finding.rule).join(', ')}).`),
      { code: 'SECRET_DETECTED', findings }
    );
  }

  const name = normalizeName(
    options.name,
    path.basename(source, path.extname(source)) || 'study'
  );
  return createFrozenRecord(project, content, {
    name,
    extension: path.extname(source).slice(0, 16),
    schemaVersion: 1,
    sourceFile: sourceRelative,
    source: null
  });
}

export function freezePreregistrationContent(cwd, content, options = {}) {
  const project = path.resolve(cwd);
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw preregistrationError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw preregistrationError(
      'Authored preregistration content must be non-empty Markdown.',
      'INVALID_PREREGISTRATION_CONTENT'
    );
  }
  const inspection = inspectPreregistrationContent(content);
  if (!inspection.valid) {
    let message = 'Authored preregistration content is incomplete.';
    if (inspection.bytes > inspection.maximum_bytes) {
      message = 'Authored preregistration exceeds the ' +
        inspection.maximum_bytes + '-byte limit.';
    } else if (inspection.missing_sections.length) {
      message = 'Authored preregistration is missing required section: ' +
        inspection.missing_sections[0] + '.';
    } else if (inspection.empty_sections.length) {
      message = 'Authored preregistration section is empty: ' +
        inspection.empty_sections[0] + '.';
    } else if (inspection.duplicate_sections.length) {
      message = 'Authored preregistration repeats required section: ' +
        inspection.duplicate_sections[0] + '.';
    } else if (inspection.placeholder_count) {
      message = 'Replace every [REPLACE: ...] placeholder before freezing.';
    }
    throw Object.assign(
      preregistrationError(message, inspection.bytes > inspection.maximum_bytes
        ? 'PREREGISTRATION_TOO_LARGE'
        : 'INVALID_PREREGISTRATION_CONTENT'),
      { inspection }
    );
  }
  const findings = scanSecrets(content);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in authored preregistration.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const name = normalizeName(options.name, 'study preregistration');
  return createFrozenRecord(project, Buffer.from(content, 'utf8'), {
    name,
    extension: '.md',
    schemaVersion: PREREGISTRATION_SCHEMA_VERSION,
    sourceFile: null,
    source: {
      kind: 'inline',
      format: 'markdown',
      media_type: 'text/markdown; charset=utf-8',
      validation_engine: 'sciencecode-preregistration-sections-v1',
      required_sections: [...PREREGISTRATION_REQUIRED_SECTIONS]
    }
  });
}

export function getPreregistration(cwd, id) {
  const file = resolveRecord(cwd, id);
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`Preregistration not found: ${id}`), { code: 'PREREGISTRATION_NOT_FOUND' });
  }
  return readJson(file);
}

export function listPreregistrations(cwd) {
  const directory = checkedRegistryDirectory(cwd);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const id = entry.name.slice(0, -'.json'.length);
      try {
        const record = getPreregistration(cwd, id);
        return {
          preregistration_id: id,
          name: record.name ?? null,
          created_at: record.created_at ?? null,
          source_file: record.source_file ?? null,
          source_kind: record.source?.kind ?? 'project_file',
          schema_version: record.schema_version ?? null,
          bytes: record.bytes ?? null,
          status: record.status ?? 'unknown'
        };
      } catch (error) {
        return { preregistration_id: id, status: 'invalid', error: error.message };
      }
    })
    .sort((left, right) => right.preregistration_id.localeCompare(left.preregistration_id));
}

export function verifyPreregistration(cwd, id) {
  const project = path.resolve(cwd);
  const errors = [];
  let record;
  let recordFile;
  try {
    recordFile = resolveRecord(project, id);
    record = getPreregistration(project, id);
  } catch (error) {
    return { ok: false, preregistration_id: id, errors: [{ issue: error.code ?? 'record_error', detail: error.message }] };
  }
  const recordHash = sha256File(recordFile);
  if (![1, PREREGISTRATION_SCHEMA_VERSION].includes(record.schema_version)) {
    errors.push({
      file: path.basename(recordFile),
      issue: 'unsupported_schema',
      actual: record.schema_version ?? null
    });
  }
  if (record.preregistration_id !== id) {
    errors.push({
      file: path.basename(recordFile),
      issue: 'preregistration_id_mismatch',
      expected: id,
      actual: record.preregistration_id ?? null
    });
  }
  if (record.status !== 'frozen') {
    errors.push({ file: path.basename(recordFile), issue: 'invalid_status' });
  }
  if (!SHA256_PATTERN.test(String(record.source_sha256 ?? '')) ||
      !SHA256_PATTERN.test(String(record.frozen_sha256 ?? ''))) {
    errors.push({ file: path.basename(recordFile), issue: 'invalid_digest' });
  } else if (record.source_sha256 !== record.frozen_sha256) {
    errors.push({ file: path.basename(recordFile), issue: 'source_frozen_digest_mismatch' });
  }
  let frozenFile;
  if (path.basename(record.frozen_file ?? '') !== record.frozen_file) {
    errors.push({ file: record.frozen_file ?? null, issue: 'invalid_frozen_path' });
  } else {
    try {
      frozenFile = resolveInsideRoot(checkedRegistryDirectory(project), record.frozen_file);
    } catch (error) {
      errors.push({ file: record.frozen_file ?? null, issue: 'invalid_frozen_path', detail: error.message });
    }
  }
  if (frozenFile && !fs.existsSync(frozenFile)) {
    errors.push({ file: record.frozen_file, issue: 'missing' });
  } else if (frozenFile) {
    const registryReal = fs.realpathSync(checkedRegistryDirectory(project));
    const frozenReal = fs.realpathSync(frozenFile);
    if (!isPathInside(registryReal, frozenReal) || !fs.statSync(frozenReal).isFile()) {
      errors.push({ file: record.frozen_file, issue: 'filesystem_link_escape' });
    } else {
      const frozenBytes = fs.statSync(frozenReal).size;
      const actual = sha256File(frozenReal);
      if (actual !== record.frozen_sha256) {
        errors.push({ file: record.frozen_file, issue: 'hash_mismatch', expected: record.frozen_sha256, actual });
      }
      if (record.bytes !== undefined && frozenBytes !== record.bytes) {
        errors.push({ file: record.frozen_file, issue: 'size_mismatch', expected: record.bytes, actual: frozenBytes });
      }
      if (record.schema_version === PREREGISTRATION_SCHEMA_VERSION) {
        if (record.source?.kind !== 'inline' || record.source?.format !== 'markdown' ||
            record.source?.validation_engine !== 'sciencecode-preregistration-sections-v1' ||
            JSON.stringify(record.source?.required_sections) !==
              JSON.stringify(PREREGISTRATION_REQUIRED_SECTIONS)) {
          errors.push({ file: path.basename(recordFile), issue: 'invalid_inline_source_contract' });
        }
        const inspection = frozenBytes <= MAX_PREREGISTRATION_BYTES
          ? inspectPreregistrationContent(fs.readFileSync(frozenReal, 'utf8'))
          : null;
        if (!inspection?.valid) {
          errors.push({
            file: record.frozen_file,
            issue: 'inline_content_invalid',
            inspection
          });
        }
      }
    }
  }

  let sourceStatus = record.schema_version === PREREGISTRATION_SCHEMA_VERSION
    ? 'authored_inline'
    : 'missing';
  if (record.schema_version === 1) {
    try {
      const source = resolveInsideRoot(project, record.source_file);
      if (fs.existsSync(source)) {
        const projectReal = fs.realpathSync(project);
        const sourceReal = fs.realpathSync(source);
        sourceStatus = isPathInside(projectReal, sourceReal)
          ? sha256File(sourceReal) === record.source_sha256 ? 'unchanged' : 'modified'
          : 'invalid';
      }
    } catch {
      sourceStatus = 'invalid';
    }
  }

  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const event = readAuditRecords(project).findLast(
      (entry) => entry.type === 'preregistration.frozen' && entry.preregistration_id === id
    );
    if (!event) errors.push({ issue: 'missing_audit_event' });
    else if (event.record_sha256 !== recordHash) {
      errors.push({ issue: 'audit_record_mismatch', expected: event.record_sha256 ?? null, actual: recordHash });
    } else if (event.source_sha256 !== record.source_sha256) {
      errors.push({
        issue: 'audit_source_mismatch',
        expected: event.source_sha256 ?? null,
        actual: record.source_sha256 ?? null
      });
    }
  }
  return {
    ok: errors.length === 0,
    preregistration_id: id,
    record_sha256: recordHash,
    source_status: sourceStatus,
    record,
    errors
  };
}

export function resolvePreregistrationArtifact(cwd, id) {
  const project = path.resolve(cwd);
  const verification = verifyPreregistration(project, id);
  if (!verification.ok) {
    throw Object.assign(
      new Error('Preregistration failed integrity verification.'),
      { code: 'PREREGISTRATION_INVALID', verification }
    );
  }
  const directory = checkedRegistryDirectory(project);
  const file = resolveInsideRoot(directory, verification.record.frozen_file);
  const directoryReal = fs.realpathSync(directory);
  const fileReal = fs.realpathSync(file);
  if (!isPathInside(directoryReal, fileReal) || !fs.statSync(fileReal).isFile()) {
    throw preregistrationError(
      'Preregistration artifact is not a regular file.',
      'PREREGISTRATION_INVALID'
    );
  }
  return fileReal;
}

export function preregistrationInteractionArtifact(record) {
  return {
    kind: 'preregistration',
    record_id: record.preregistration_id,
    name: record.name,
    url: '/api/preregistrations/' + encodeURIComponent(record.preregistration_id)
  };
}

export function preregistrationInteractionPayload(record, verification, note = null) {
  return {
    schema_version: 1,
    preregistration_id: record.preregistration_id,
    name: record.name,
    status: record.status,
    record_sha256: verification.record_sha256,
    source_sha256: record.source_sha256,
    frozen_sha256: record.frozen_sha256,
    bytes: record.bytes,
    source_kind: record.source?.kind ?? 'project_file',
    required_sections: record.source?.required_sections ?? [],
    note
  };
}
