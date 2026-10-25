import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import {
  resolveCadArtifact,
  verifyCadBuild,
  verifyCadSimulation,
  verifyCadSlice
} from './cad.js';
import { getChatManifest } from './chats.js';
import { getEvidenceManifest, resolveEvidenceSourceFile, verifyEvidence } from './evidence.js';
import { getExperimentManifest, resolveExperimentDirectory, verifyExperiment } from './experiments.js';
import { sha256Buffer, sha256File, sha256Json, sha256Text } from './hash.js';
import { resolveKernelArtifact, verifyKernelCell } from './kernels.js';
import { scanSecrets } from './security.js';
import { getSimulationManifest, resolveSimulationDirectory, verifySimulation } from './simulations.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  portablePath,
  readJson,
  resolveInsideRoot,
  writeJsonExclusive
} from './storage.js';

export const ARTIFACT_REVISION_SCHEMA_VERSION = 1;
export const REVISION_DECISION_SCHEMA_VERSION = 1;
export const MAX_ARTIFACT_REVISION_BYTES = 8 * 1024 * 1024;
export const MAX_ARTIFACT_REVISIONS = 10_000;
export const MAX_ARTIFACT_REVISION_CHAIN = 256;

const REVISION_ID_PATTERN = /^revision-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DECISIONS = new Set(['accepted', 'rejected']);
const TEXT_EXTENSIONS = new Set([
  '.csv', '.gcode', '.json', '.log', '.md', '.mol', '.obj', '.pdb', '.ply', '.py', '.r',
  '.rst', '.scad', '.sdf', '.ts', '.tsv', '.txt', '.xdl', '.xml', '.xyz', '.yaml', '.yml'
]);
const LOCK_TIMEOUT_MS = 5_000;

function revisionId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'revision-' + stamp + '-' + crypto.randomBytes(4).toString('hex');
}

function decisionId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'decision-' + stamp + '-' + crypto.randomBytes(3).toString('hex');
}

function revisionsRoot(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'revisions');
}

function normalizeRevisionId(value) {
  const id = String(value ?? '');
  if (!REVISION_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw Object.assign(new Error('Invalid artifact revision ID: ' + id), {
      code: 'INVALID_REVISION_ID'
    });
  }
  return id;
}

function validateChat(cwd, value) {
  const chatId = String(value ?? '');
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw Object.assign(new Error('Invalid chat ID: ' + chatId), { code: 'INVALID_CHAT_ID' });
  }
  try {
    getChatManifest(cwd, chatId);
  } catch (error) {
    throw Object.assign(new Error('Chat not found: ' + chatId), {
      code: error.code === 'INVALID_CHAT_ID' ? error.code : 'CHAT_NOT_FOUND'
    });
  }
  return chatId;
}

function boundedText(value, name, limit) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).replace(/\r\n/g, '\n').trim();
  if (text.length > limit) {
    throw Object.assign(new Error(name + ' must be ' + limit + ' characters or fewer.'), {
      code: 'INVALID_REVISION'
    });
  }
  const findings = scanSecrets(text);
  if (findings.length) {
    throw Object.assign(new Error('Potential secret detected in ' + name + '; refusing to persist it.'), {
      code: 'SECRET_DETECTED', findings
    });
  }
  return text;
}

function safeArtifactName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 240 || name === '.' || name === '..' ||
      name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw Object.assign(new Error('Revision artifact name must be a safe file name of 240 characters or fewer.'), {
      code: 'INVALID_REVISION'
    });
  }
  return name;
}

function mediaTypeForName(name) {
  const extension = path.extname(name).toLowerCase();
  const values = new Map([
    ['.csv', 'text/csv; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
    ['.gcode', 'text/x-gcode; charset=utf-8'],
    ['.md', 'text/markdown; charset=utf-8'], ['.py', 'text/x-python; charset=utf-8'],
    ['.scad', 'text/x-openscad; charset=utf-8'],
    ['.stl', 'model/stl'], ['.3mf', 'model/3mf'],
    ['.tsv', 'text/tab-separated-values; charset=utf-8'], ['.txt', 'text/plain; charset=utf-8'],
    ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ]);
  return values.get(extension) ?? (TEXT_EXTENSIONS.has(extension)
    ? 'text/plain; charset=utf-8'
    : 'application/octet-stream');
}

function normalizedContent(content, name) {
  let buffer;
  let encoding;
  if (typeof content === 'string') {
    buffer = Buffer.from(content, 'utf8');
    encoding = 'utf8';
  } else if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    buffer = Buffer.from(content);
    encoding = 'binary';
  } else {
    throw Object.assign(new Error('Revision content must be text or bytes.'), {
      code: 'INVALID_REVISION'
    });
  }
  if (buffer.length > MAX_ARTIFACT_REVISION_BYTES) {
    throw Object.assign(new Error('Revision artifacts are limited to ' + MAX_ARTIFACT_REVISION_BYTES + ' bytes.'), {
      code: 'REVISION_TOO_LARGE'
    });
  }
  if (encoding === 'utf8' || TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    const findings = scanSecrets(buffer.toString('utf8'));
    if (findings.length) {
      throw Object.assign(new Error('Potential secret detected in revision content; refusing to persist it.'), {
        code: 'SECRET_DETECTED', findings
      });
    }
  }
  return { buffer, encoding };
}

function decodeSegments(pathname, prefix, minimum) {
  const encoded = pathname.slice(prefix.length).split('/');
  if (encoded.length < minimum || encoded.some((part) => !part)) {
    throw Object.assign(new Error('Malformed revision source URL.'), { code: 'INVALID_REVISION_SOURCE' });
  }
  try {
    const values = encoded.map((part) => decodeURIComponent(part));
    if (values.some((part) => !part || part === '.' || part === '..' || part.includes('/') ||
        part.includes('\\') || part.includes('\0'))) {
      throw new Error('unsafe path segment');
    }
    return values;
  } catch (error) {
    throw Object.assign(new Error('Malformed revision source URL: ' + error.message), {
      code: 'INVALID_REVISION_SOURCE'
    });
  }
}

function encodedPath(parts) {
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

function regularFileInside(root, relative, code) {
  const file = resolveInsideRoot(root, relative);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error('Revision source artifact is unavailable.'), { code });
  }
  const rootReal = fs.realpathSync(root);
  const fileReal = fs.realpathSync(file);
  if (!isPathInside(rootReal, fileReal) || !fs.statSync(fileReal).isFile()) {
    throw Object.assign(new Error('Revision source artifact escapes its immutable record.'), { code });
  }
  return fileReal;
}

function verifiedSource(file, descriptor, values) {
  const actualSha256 = sha256File(file);
  const actualBytes = fs.statSync(file).size;
  if (!descriptor || descriptor.sha256 !== actualSha256 ||
      (descriptor.bytes !== undefined && descriptor.bytes !== actualBytes)) {
    throw Object.assign(new Error('Revision source artifact failed integrity verification.'), {
      code: 'REVISION_SOURCE_INVALID'
    });
  }
  return {
    ...values,
    file,
    sha256: actualSha256,
    bytes: actualBytes,
    media_type: descriptor.media_type ?? mediaTypeForName(values.name)
  };
}

function resolveSimulationSource(project, pathname) {
  const [simulationId, ...parts] = decodeSegments(pathname, '/artifact/', 2);
  const relative = parts.join('/');
  const verification = verifySimulation(project, simulationId);
  if (!verification.ok) {
    throw Object.assign(new Error('Revision source simulation failed verification.'), {
      code: 'REVISION_SOURCE_INVALID'
    });
  }
  const manifest = verification.manifest ?? getSimulationManifest(project, simulationId);
  const descriptor = manifest.artifacts?.['artifacts/' + portablePath(relative)];
  const root = path.join(resolveSimulationDirectory(project, simulationId), 'artifacts');
  const file = regularFileInside(root, relative, 'REVISION_SOURCE_NOT_FOUND');
  return verifiedSource(file, descriptor, {
    kind: 'simulation', record_id: simulationId, name: portablePath(relative),
    url: '/artifact/' + encodeURIComponent(simulationId) + '/' + encodedPath(parts),
    record_sha256: verification.manifest_sha256 ?? null
  });
}

function resolveExperimentSource(project, pathname) {
  const [experimentId, ...parts] = decodeSegments(pathname, '/experiment-artifact/', 2);
  const relative = parts.join('/');
  const verification = verifyExperiment(project, experimentId);
  if (!verification.ok) {
    throw Object.assign(new Error('Revision source experiment failed verification.'), {
      code: 'REVISION_SOURCE_INVALID'
    });
  }
  const manifest = verification.manifest ?? getExperimentManifest(project, experimentId);
  const descriptor = manifest.artifacts?.[portablePath(relative)];
  const root = resolveExperimentDirectory(project, experimentId);
  const file = regularFileInside(root, relative, 'REVISION_SOURCE_NOT_FOUND');
  return verifiedSource(file, descriptor, {
    kind: 'experiment', record_id: experimentId, name: portablePath(relative),
    url: '/experiment-artifact/' + encodeURIComponent(experimentId) + '/' + encodedPath(parts),
    record_sha256: verification.manifest_sha256 ?? null
  });
}

function resolveKernelSource(project, pathname) {
  const [language, cellId, ...parts] = decodeSegments(pathname, '/kernel-artifact/', 3);
  const relative = parts.join('/');
  const artifact = resolveKernelArtifact(project, language, cellId, relative);
  const verification = verifyKernelCell(project, language, cellId);
  return verifiedSource(artifact.file, artifact.descriptor, {
    kind: 'kernel', record_id: verification.manifest.kernel_id, name: portablePath(relative),
    url: '/kernel-artifact/' + encodeURIComponent(language) + '/' +
      encodeURIComponent(cellId) + '/' + encodedPath(parts),
    record_sha256: verification.manifest_sha256 ?? null,
    language, cell_id: cellId
  });
}

function resolveEvidenceSource(project, pathname) {
  const [evidenceId] = decodeSegments(pathname, '/evidence-source/', 1);
  const verification = verifyEvidence(project, evidenceId);
  if (!verification.ok) {
    throw Object.assign(new Error('Revision source evidence failed verification.'), {
      code: 'REVISION_SOURCE_INVALID'
    });
  }
  const manifest = verification.manifest ?? getEvidenceManifest(project, evidenceId);
  const source = resolveEvidenceSourceFile(project, evidenceId);
  return verifiedSource(source.file, manifest.source, {
    kind: 'evidence', record_id: evidenceId,
    name: manifest.source.original_name ?? manifest.source.file,
    url: '/evidence-source/' + encodeURIComponent(evidenceId),
    record_sha256: verification.manifest_sha256 ?? null
  });
}

function resolveCadSource(project, pathname) {
  const [kind, id, ...parts] = decodeSegments(
    pathname,
    '/api/cad/artifacts/',
    3
  );
  const verifiers = {
    build: verifyCadBuild,
    simulation: verifyCadSimulation,
    slice: verifyCadSlice
  };
  const verify = verifiers[kind];
  if (!verify) {
    throw Object.assign(new Error('Unsupported CAD revision source kind: ' + kind), {
      code: 'INVALID_REVISION_SOURCE'
    });
  }
  const verification = verify(project, id);
  if (!verification.ok) {
    throw Object.assign(new Error('Revision source CAD record failed verification.'), {
      code: 'REVISION_SOURCE_INVALID',
      errors: verification.errors
    });
  }
  const relative = portablePath(parts.join('/'));
  const descriptor = verification.manifest?.artifacts?.[relative];
  if (!descriptor) {
    throw Object.assign(new Error('Revision source CAD artifact is not declared.'), {
      code: 'REVISION_SOURCE_NOT_FOUND'
    });
  }
  const file = resolveCadArtifact(project, { kind, id, file: relative });
  return verifiedSource(file, descriptor, {
    kind: 'cad-' + kind,
    record_id: id,
    name: relative,
    url: '/api/cad/artifacts/' + encodeURIComponent(kind) + '/' +
      encodeURIComponent(id) + '/' + encodedPath(parts),
    record_sha256: verification.manifest_sha256 ?? null
  });
}

export function resolveRevisionSourceArtifact(cwd, source) {
  const project = path.resolve(cwd);
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      typeof source.url !== 'string' || !source.url.startsWith('/')) {
    throw Object.assign(new Error('A manifest-bound artifact URL is required for a revision.'), {
      code: 'INVALID_REVISION_SOURCE'
    });
  }
  let parsed;
  try {
    parsed = new URL(source.url, 'http://sciencecode.local');
  } catch (error) {
    throw Object.assign(new Error('Invalid revision source URL: ' + error.message), {
      code: 'INVALID_REVISION_SOURCE'
    });
  }
  if (parsed.origin !== 'http://sciencecode.local' || parsed.search || parsed.hash) {
    throw Object.assign(new Error('Revision source URL must be a local artifact path without query or fragment.'), {
      code: 'INVALID_REVISION_SOURCE'
    });
  }
  let resolved;
  if (parsed.pathname.startsWith('/artifact/')) resolved = resolveSimulationSource(project, parsed.pathname);
  else if (parsed.pathname.startsWith('/experiment-artifact/')) resolved = resolveExperimentSource(project, parsed.pathname);
  else if (parsed.pathname.startsWith('/kernel-artifact/')) resolved = resolveKernelSource(project, parsed.pathname);
  else if (parsed.pathname.startsWith('/evidence-source/')) resolved = resolveEvidenceSource(project, parsed.pathname);
  else if (parsed.pathname.startsWith('/api/cad/artifacts/')) {
    resolved = resolveCadSource(project, parsed.pathname);
  }
  else {
    throw Object.assign(new Error('Unsupported revision source URL: ' + parsed.pathname), {
      code: 'INVALID_REVISION_SOURCE'
    });
  }
  if (source.url !== resolved.url) {
    throw Object.assign(new Error('Revision source URL is not the canonical manifest-bound artifact route.'), {
      code: 'REVISION_SOURCE_MISMATCH'
    });
  }
  for (const key of ['kind', 'record_id', 'name']) {
    if (source[key] !== undefined && source[key] !== null && String(source[key]) !== String(resolved[key])) {
      throw Object.assign(new Error('Revision source ' + key + ' does not match the verified artifact.'), {
        code: 'REVISION_SOURCE_MISMATCH'
      });
    }
  }
  if (source.sha256 && source.sha256 !== resolved.sha256) {
    throw Object.assign(new Error('Revision source digest does not match the verified artifact.'), {
      code: 'REVISION_SOURCE_MISMATCH'
    });
  }
  return resolved;
}

export function resolveArtifactRevisionDirectory(cwd, value) {
  const id = normalizeRevisionId(value);
  return path.join(revisionsRoot(cwd), id);
}

function revisionFiles(cwd, value) {
  const directory = resolveArtifactRevisionDirectory(cwd, value);
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    decisions: path.join(directory, 'decisions.jsonl'),
    lock: path.join(directory, 'decisions.lock')
  };
}

function writeBufferExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function revisionDirectories(cwd) {
  const root = revisionsRoot(cwd);
  const ids = new Set();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (REVISION_ID_PATTERN.test(entry.name)) ids.add(entry.name);
    }
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if ((record.type === 'artifact_revision.created' ||
           record.type === 'artifact_revision.decided') &&
          REVISION_ID_PATTERN.test(String(record.revision_id ?? ''))) {
        ids.add(record.revision_id);
      }
    }
  } catch {
    // Project-level audit verification reports malformed logs. On a readable
    // log, audit IDs keep deleted or link-replaced revision records visible.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

function safeRemoveStaging(root, staging) {
  if (!isPathInside(root, staging) || path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith('.staging-revision-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function normalizedMediaType(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return mediaTypeForName(name);
  }
  const mediaType = String(value).trim().toLowerCase();
  if (mediaType.length > 160 || !/^[a-z0-9][a-z0-9!#$&^_.+\/-]*(?:;\s*charset=[a-z0-9._-]+)?$/.test(mediaType)) {
    throw Object.assign(new Error('Revision media type is invalid.'), { code: 'INVALID_REVISION' });
  }
  return mediaType;
}

function publicSource(source) {
  const { file: _file, ...value } = source;
  return value;
}

export function getArtifactRevisionManifest(cwd, value) {
  const id = normalizeRevisionId(value);
  const files = revisionFiles(cwd, id);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink() ||
      !fs.statSync(files.manifest, { throwIfNoEntry: false })?.isFile()) {
    throw Object.assign(new Error('Artifact revision not found: ' + id), {
      code: 'REVISION_NOT_FOUND'
    });
  }
  return readJson(files.manifest);
}

function rawRevisionArtifact(cwd, value) {
  const id = normalizeRevisionId(value);
  const files = revisionFiles(cwd, id);
  const manifest = getArtifactRevisionManifest(cwd, id);
  const artifact = manifest.artifact;
  if (!artifact || typeof artifact.file !== 'string' ||
      !artifact.file.startsWith('artifact/') || artifact.file.split('/').length !== 2) {
    throw Object.assign(new Error('Artifact revision has an invalid artifact path.'), {
      code: 'REVISION_INVALID'
    });
  }
  const file = resolveInsideRoot(files.directory, artifact.file);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error('Artifact revision file is unavailable.'), {
      code: 'REVISION_ARTIFACT_NOT_FOUND'
    });
  }
  const directoryReal = fs.realpathSync(files.directory);
  const fileReal = fs.realpathSync(file);
  if (!isPathInside(directoryReal, fileReal) || !fs.statSync(fileReal).isFile()) {
    throw Object.assign(new Error('Artifact revision file escapes its record.'), {
      code: 'REVISION_ARTIFACT_NOT_FOUND'
    });
  }
  return { revision_id: id, files, manifest, file: fileReal, descriptor: artifact };
}

export function resolveArtifactRevision(cwd, value) {
  const artifact = rawRevisionArtifact(cwd, value);
  const verification = verifyArtifactRevision(cwd, artifact.revision_id);
  if (!verification.ok) {
    throw Object.assign(new Error('Artifact revision failed integrity verification.'), {
      code: 'REVISION_INVALID', verification
    });
  }
  return { ...artifact, verification };
}

export function createArtifactRevision({
  cwd,
  chatId,
  source,
  content,
  name,
  mediaType,
  note,
  previousRevisionId,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  const normalizedChatId = validateChat(project, chatId);
  const resolvedSource = resolveRevisionSourceArtifact(project, source);
  const artifactName = safeArtifactName(name ?? path.basename(resolvedSource.name));
  const normalizedNote = boundedText(note, 'Revision note', 2_000);
  const normalized = normalizedContent(content, artifactName);
  const normalizedType = normalizedMediaType(mediaType, artifactName);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw Object.assign(new Error('Revision timestamp is invalid.'), { code: 'INVALID_REVISION' });
  }

  let previous = null;
  if (previousRevisionId !== undefined && previousRevisionId !== null && previousRevisionId !== '') {
    const previousId = normalizeRevisionId(previousRevisionId);
    const verification = verifyArtifactRevision(project, previousId);
    if (!verification.ok) {
      throw Object.assign(new Error('Previous artifact revision failed integrity verification.'), {
        code: 'REVISION_PREVIOUS_INVALID', verification
      });
    }
    if (verification.manifest.source?.url !== resolvedSource.url) {
      throw Object.assign(new Error('Previous revision belongs to a different source artifact.'), {
        code: 'REVISION_SOURCE_MISMATCH'
      });
    }
    if ((verification.chain_depth ?? 1) >= MAX_ARTIFACT_REVISION_CHAIN) {
      throw Object.assign(new Error('Artifact revision chain exceeds the safe depth limit.'), {
        code: 'REVISION_CHAIN_TOO_DEEP'
      });
    }
    previous = {
      revision_id: previousId,
      manifest_sha256: verification.manifest_sha256,
      artifact_sha256: verification.manifest.artifact.sha256
    };
  }

  if (revisionDirectories(project).length >= MAX_ARTIFACT_REVISIONS) {
    throw Object.assign(new Error('Artifact revision limit reached for this project.'), {
      code: 'REVISION_LIMIT'
    });
  }
  const root = path.join(ensureScienceDir(project), 'revisions');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = revisionId(now);
  const finalDirectory = resolveArtifactRevisionDirectory(project, id);
  const staging = path.join(root, '.staging-' + id + '-' + crypto.randomBytes(3).toString('hex'));
  if (fs.existsSync(finalDirectory)) {
    throw Object.assign(new Error('Artifact revision already exists: ' + id), { code: 'REVISION_EXISTS' });
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    const artifactRelative = 'artifact/' + artifactName;
    const artifactFile = path.join(staging, 'artifact', artifactName);
    writeBufferExclusive(artifactFile, normalized.buffer);
    const manifest = {
      schema_version: ARTIFACT_REVISION_SCHEMA_VERSION,
      revision_id: id,
      created_at: now.toISOString(),
      created_by: 'user',
      chat_id: normalizedChatId,
      source: publicSource(resolvedSource),
      previous_revision: previous,
      artifact: {
        name: artifactName,
        file: artifactRelative,
        media_type: normalizedType,
        encoding: normalized.encoding,
        bytes: normalized.buffer.length,
        sha256: sha256Buffer(normalized.buffer)
      },
      note: normalizedNote,
      initial_status: 'proposed',
      preservation_policy: 'immutable source and revision bytes; review decisions append separately'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'artifact_revision.created',
      revision_id: id,
      chat_id: normalizedChatId,
      source_sha256: resolvedSource.sha256,
      artifact_sha256: manifest.artifact.sha256,
      manifest_sha256: manifestSha256
    });
    return {
      ...manifest,
      manifest_sha256: manifestSha256,
      status: 'proposed',
      decisions: [],
      url: '/revision-artifact/' + encodeURIComponent(id)
    };
  } catch (error) {
    if (fs.existsSync(staging)) safeRemoveStaging(root, staging);
    throw error;
  }
}

function readDecisionRecords(cwd, value) {
  const id = normalizeRevisionId(value);
  const file = revisionFiles(cwd, id).decisions;
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 8 * 1024 * 1024) {
    throw Object.assign(new Error('Revision decision log exceeds the safe read limit.'), {
      code: 'REVISION_DECISIONS_TOO_LARGE'
    });
  }
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw Object.assign(new Error('Invalid revision decision at line ' + (index + 1) + ': ' + error.message), {
          code: 'INVALID_REVISION_DECISION'
        });
      }
    });
}

function sleepSync(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function withDecisionLock(cwd, value, callback) {
  const files = revisionFiles(cwd, value);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(files.lock, 'wx', 0o600);
      fs.writeFileSync(descriptor, process.pid + ' ' + new Date().toISOString() + '\n');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('Revision decisions are locked by another process.'), {
          code: 'REVISION_LOCKED'
        });
      }
      sleepSync(25);
    }
  }
  try {
    return callback(files);
  } finally {
    try { fs.closeSync(descriptor); } finally {
      try { fs.unlinkSync(files.lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

export function decideArtifactRevision({ cwd, revisionId: value, chatId, decision, note, now = new Date() }) {
  const project = path.resolve(cwd);
  const id = normalizeRevisionId(value);
  validateChat(project, chatId);
  const verification = verifyArtifactRevision(project, id);
  if (!verification.ok) {
    throw Object.assign(new Error('Cannot decide an invalid artifact revision.'), {
      code: 'REVISION_INVALID', verification
    });
  }
  const normalizedDecision = String(decision ?? '').toLowerCase();
  if (!DECISIONS.has(normalizedDecision)) {
    throw Object.assign(new Error('Revision decision must be accepted or rejected.'), {
      code: 'INVALID_REVISION_DECISION'
    });
  }
  const normalizedNote = boundedText(note, 'Revision decision note', 2_000);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw Object.assign(new Error('Revision decision timestamp is invalid.'), {
      code: 'INVALID_REVISION_DECISION'
    });
  }
  const record = withDecisionLock(project, id, (files) => {
    const records = readDecisionRecords(project, id);
    const previous = records.at(-1) ?? null;
    const body = {
      schema_version: REVISION_DECISION_SCHEMA_VERSION,
      decision_id: decisionId(now),
      revision_id: id,
      chat_id: String(chatId),
      ts: now.toISOString(),
      decision: normalizedDecision,
      note: normalizedNote,
      previous_hash: previous?.hash ?? null
    };
    const next = { ...body, hash: sha256Json(body) };
    const descriptor = fs.openSync(files.decisions, 'a', 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(next) + '\n', 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return next;
  });
  appendAudit(project, {
    type: 'artifact_revision.decided',
    revision_id: id,
    decision_id: record.decision_id,
    chat_id: record.chat_id,
    decision: record.decision,
    decision_hash: record.hash
  });
  return record;
}

function verifyArtifactRevisionInternal(cwd, value, ancestors) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeRevisionId(value);
  } catch (error) {
    return {
      ok: false,
      revision_id: String(value ?? ''),
      status: 'invalid',
      manifest: null,
      manifest_sha256: null,
      decisions: [],
      errors: [{ issue: error.code ?? 'revision_error', detail: error.message }]
    };
  }
  if (ancestors.has(id)) {
    return {
      ok: false, revision_id: id, status: 'invalid', manifest: null,
      manifest_sha256: null, decisions: [], errors: [{ issue: 'revision_cycle' }]
    };
  }
  if (ancestors.size >= MAX_ARTIFACT_REVISION_CHAIN) {
    return {
      ok: false, revision_id: id, status: 'invalid', manifest: null,
      manifest_sha256: null, decisions: [], errors: [{ issue: 'revision_chain_too_deep' }]
    };
  }
  const seen = new Set(ancestors);
  seen.add(id);
  const errors = [];
  let manifest = null;
  let manifestSha256 = null;
  let decisions = [];
  try {
    const files = revisionFiles(project, id);
    const directoryStat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
    if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
      throw Object.assign(new Error('Artifact revision directory is unavailable.'), {
        code: 'REVISION_NOT_FOUND'
      });
    }
    manifest = getArtifactRevisionManifest(project, id);
    manifestSha256 = sha256File(files.manifest);
  } catch (error) {
    return {
      ok: false, revision_id: id, status: 'invalid', manifest: null,
      manifest_sha256: null, decisions: [],
      errors: [{ issue: error.code ?? 'revision_error', detail: error.message }]
    };
  }

  if (manifest.schema_version !== ARTIFACT_REVISION_SCHEMA_VERSION) {
    errors.push({ issue: 'unsupported_schema', actual: manifest.schema_version ?? null });
  }
  if (manifest.revision_id !== id) {
    errors.push({ issue: 'revision_id_mismatch', expected: id, actual: manifest.revision_id ?? null });
  }
  if (manifest.initial_status !== 'proposed') {
    errors.push({ issue: 'invalid_initial_status', actual: manifest.initial_status ?? null });
  }
  try { validateChat(project, manifest.chat_id); } catch (error) {
    errors.push({ issue: 'revision_chat_invalid', detail: error.message });
  }

  let artifact = null;
  try {
    artifact = rawRevisionArtifact(project, id);
    const actualSha256 = sha256File(artifact.file);
    const actualBytes = fs.statSync(artifact.file).size;
    if (manifest.artifact?.sha256 !== actualSha256) {
      errors.push({ file: manifest.artifact?.file ?? null, issue: 'hash_mismatch',
        expected: manifest.artifact?.sha256 ?? null, actual: actualSha256 });
    }
    if (manifest.artifact?.bytes !== actualBytes) {
      errors.push({ file: manifest.artifact?.file ?? null, issue: 'size_mismatch',
        expected: manifest.artifact?.bytes ?? null, actual: actualBytes });
    }
    try {
      if (safeArtifactName(manifest.artifact?.name) !== path.basename(manifest.artifact.file)) {
        errors.push({ issue: 'artifact_name_mismatch' });
      }
    } catch (error) {
      errors.push({ issue: 'invalid_artifact_name', detail: error.message });
    }
  } catch (error) {
    errors.push({ issue: error.code ?? 'revision_artifact_error', detail: error.message });
  }

  try {
    const source = resolveRevisionSourceArtifact(project, manifest.source);
    for (const key of ['kind', 'record_id', 'name', 'url', 'sha256', 'bytes', 'record_sha256']) {
      if ((manifest.source?.[key] ?? null) !== (source[key] ?? null)) {
        errors.push({ issue: 'source_' + key + '_mismatch',
          expected: manifest.source?.[key] ?? null, actual: source[key] ?? null });
      }
    }
  } catch (error) {
    errors.push({ issue: error.code ?? 'revision_source_error', detail: error.message });
  }

  const previous = manifest.previous_revision;
  let previousChainDepth = 0;
  if (previous !== null && previous !== undefined) {
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
      errors.push({ issue: 'invalid_previous_revision' });
    } else {
      const previousVerification = verifyArtifactRevisionInternal(
        project, previous.revision_id, seen
      );
      if (!previousVerification.ok) {
        errors.push({ issue: 'previous_revision_invalid',
          revision_id: previous.revision_id ?? null, errors: previousVerification.errors });
      } else {
        previousChainDepth = previousVerification.chain_depth ?? 1;
        if (previousVerification.manifest.source?.url !== manifest.source?.url) {
          errors.push({ issue: 'previous_revision_source_mismatch' });
        }
        if (previous.manifest_sha256 !== previousVerification.manifest_sha256) {
          errors.push({ issue: 'previous_manifest_hash_mismatch',
            expected: previous.manifest_sha256 ?? null,
            actual: previousVerification.manifest_sha256 });
        }
        if (previous.artifact_sha256 !== previousVerification.manifest.artifact?.sha256) {
          errors.push({ issue: 'previous_artifact_hash_mismatch',
            expected: previous.artifact_sha256 ?? null,
            actual: previousVerification.manifest.artifact?.sha256 ?? null });
        }
      }
    }
  }

  try {
    decisions = readDecisionRecords(project, id);
    if (decisions.length > MAX_ARTIFACT_REVISIONS) {
      errors.push({ issue: 'decision_limit' });
    }
  } catch (error) {
    errors.push({ issue: error.code ?? 'revision_decision_error', detail: error.message });
    decisions = [];
  }
  let previousHash = null;
  const decisionIds = new Set();
  for (let index = 0; index < decisions.length; index += 1) {
    const record = decisions[index];
    const line = index + 1;
    if (record.schema_version !== REVISION_DECISION_SCHEMA_VERSION) {
      errors.push({ line, issue: 'decision_unsupported_schema' });
    }
    if (record.revision_id !== id) errors.push({ line, issue: 'decision_revision_mismatch' });
    if (!DECISIONS.has(record.decision)) errors.push({ line, issue: 'invalid_decision' });
    if (record.previous_hash !== previousHash) {
      errors.push({ line, issue: 'decision_chain_break', expected: previousHash,
        actual: record.previous_hash ?? null });
    }
    if (!record.decision_id || decisionIds.has(record.decision_id)) {
      errors.push({ line, issue: record.decision_id ? 'duplicate_decision_id' : 'missing_decision_id' });
    }
    decisionIds.add(record.decision_id);
    const { hash, ...unsigned } = record;
    const actual = sha256Json(unsigned);
    if (hash !== actual) {
      errors.push({ line, issue: 'decision_hash_mismatch', expected: hash ?? null, actual });
    }
    try { validateChat(project, record.chat_id); } catch (error) {
      errors.push({ line, issue: 'decision_chat_invalid', detail: error.message });
    }
    previousHash = hash ?? null;
  }

  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const auditRecords = readAuditRecords(project);
    const created = auditRecords.filter((entry) =>
      entry.type === 'artifact_revision.created' && entry.revision_id === id
    );
    if (created.length !== 1) {
      errors.push({ issue: created.length ? 'duplicate_creation_audit_event' : 'missing_creation_audit_event' });
    } else {
      const event = created[0];
      if (event.manifest_sha256 !== manifestSha256) {
        errors.push({ issue: 'audit_manifest_mismatch', expected: event.manifest_sha256 ?? null,
          actual: manifestSha256 });
      }
      if (event.artifact_sha256 !== manifest.artifact?.sha256 ||
          event.source_sha256 !== manifest.source?.sha256 || event.chat_id !== manifest.chat_id) {
        errors.push({ issue: 'audit_creation_metadata_mismatch' });
      }
    }
    const decisionEvents = auditRecords.filter((entry) =>
      entry.type === 'artifact_revision.decided' && entry.revision_id === id
    );
    if (decisionEvents.length !== decisions.length) {
      errors.push({ issue: 'decision_audit_count_mismatch',
        expected: decisions.length, actual: decisionEvents.length });
    }
    for (const record of decisions) {
      const event = decisionEvents.find((entry) => entry.decision_id === record.decision_id);
      if (!event || event.decision_hash !== record.hash || event.decision !== record.decision ||
          event.chat_id !== record.chat_id) {
        errors.push({ decision_id: record.decision_id, issue: 'decision_audit_link_mismatch' });
      }
    }
  }

  const status = decisions.at(-1)?.decision ?? 'proposed';
  return {
    ok: errors.length === 0,
    revision_id: id,
    status,
    manifest,
    manifest_sha256: manifestSha256,
    artifact: artifact ? {
      file: artifact.file,
      url: '/revision-artifact/' + encodeURIComponent(id),
      descriptor: artifact.descriptor
    } : null,
    decisions,
    decision_head_hash: decisions.at(-1)?.hash ?? null,
    chain_depth: previousChainDepth + 1,
    errors
  };
}

export function verifyArtifactRevision(cwd, value) {
  return verifyArtifactRevisionInternal(cwd, value, new Set());
}

export function listRevisionDecisions(cwd, value) {
  getArtifactRevisionManifest(cwd, value);
  return readDecisionRecords(cwd, value);
}

export function getArtifactRevision(cwd, value) {
  const id = normalizeRevisionId(value);
  const verification = verifyArtifactRevision(cwd, id);
  if (!verification.manifest) {
    throw Object.assign(new Error('Artifact revision not found: ' + id), {
      code: 'REVISION_NOT_FOUND'
    });
  }
  return {
    manifest: verification.manifest,
    manifest_sha256: verification.manifest_sha256,
    status: verification.status,
    decisions: verification.decisions,
    url: '/revision-artifact/' + encodeURIComponent(id),
    verification
  };
}

export function listArtifactRevisions(cwd, { sourceUrl, chatId } = {}) {
  const project = path.resolve(cwd);
  return revisionDirectories(project).map((id) => {
    const verification = verifyArtifactRevision(project, id);
    const manifest = verification.manifest;
    if (!manifest) return { revision_id: id, status: 'invalid', verified: false,
      errors: verification.errors };
    return {
      revision_id: id,
      created_at: manifest.created_at ?? null,
      chat_id: manifest.chat_id ?? null,
      name: manifest.artifact?.name ?? null,
      bytes: manifest.artifact?.bytes ?? null,
      artifact_sha256: manifest.artifact?.sha256 ?? null,
      manifest_sha256: verification.manifest_sha256,
      source: manifest.source ?? null,
      previous_revision_id: manifest.previous_revision?.revision_id ?? null,
      status: verification.status,
      decision_count: verification.decisions.length,
      latest_decision: verification.decisions.at(-1) ?? null,
      note: manifest.note ?? null,
      url: '/revision-artifact/' + encodeURIComponent(id),
      verified: verification.ok,
      errors: verification.errors
    };
  }).filter((record) =>
    (!sourceUrl || record.source?.url === sourceUrl) &&
    (!chatId || record.chat_id === chatId || record.latest_decision?.chat_id === chatId)
  );
}

export function revisionInteractionArtifact(revision) {
  const manifest = revision?.manifest ?? revision;
  const id = manifest?.revision_id ?? revision?.revision_id;
  if (!id) return null;
  return {
    kind: 'revision',
    record_id: id,
    name: manifest?.artifact?.name ?? revision?.name ?? id,
    url: '/revision-artifact/' + encodeURIComponent(id)
  };
}

export function revisionInteractionPayload(revision, values = {}) {
  const manifest = revision?.manifest ?? revision;
  const id = manifest?.revision_id ?? revision?.revision_id;
  return {
    revision_id: id,
    record_file: id ? '.sciencecode/revisions/' + id + '/manifest.json' : null,
    artifact_file: id && manifest?.artifact?.file
      ? '.sciencecode/revisions/' + id + '/' + manifest.artifact.file
      : null,
    status: values.status ?? revision?.status ?? 'proposed',
    source_url: manifest?.source?.url ?? revision?.source?.url ?? null,
    source_sha256: manifest?.source?.sha256 ?? revision?.source?.sha256 ?? null,
    artifact_sha256: manifest?.artifact?.sha256 ?? revision?.artifact_sha256 ?? null,
    previous_revision_id: manifest?.previous_revision?.revision_id ??
      revision?.previous_revision_id ?? null,
    note: values.note ?? null
  };
}
