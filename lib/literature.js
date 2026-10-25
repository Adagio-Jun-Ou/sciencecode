import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { VERSION } from './constants.js';
import { sha256Buffer, sha256File, sha256Json } from './hash.js';
import { scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  resolveInsideRoot,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

export const LITERATURE_SCHEMA_VERSION = 1;
export const LITERATURE_PARSER_NAME = 'sciencecode-literature-parser';
export const LITERATURE_PARSER_VERSION = 1;
export const LITERATURE_SOURCES = Object.freeze(['crossref', 'pubmed', 'openalex']);
export const MAX_LITERATURE_RECORDS = 10_000;
export const MAX_LITERATURE_RESPONSE_BYTES = 4 * 1024 * 1024;
export const LITERATURE_FETCH_TIMEOUT_MS = 30_000;
export const MAX_LITERATURE_AUTHORS = 128;

const LITERATURE_ID_PATTERN = /^literature-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const DOI_PATTERN = /^10\.[0-9]{4,9}\/[-._;()/:A-Za-z0-9]{1,200}$/;
const PMID_PATTERN = /^[1-9][0-9]{0,11}$/;

function literatureError(message, code = 'INVALID_LITERATURE_REQUEST') {
  return Object.assign(new Error(message), { code });
}

function boundedString(value, limit) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) : text;
}

function boundedYear(value) {
  const year = Number(value);
  return Number.isSafeInteger(year) && year >= 1400 && year <= 2200 ? year : null;
}

export function normalizeLiteratureSource(value) {
  const source = String(value ?? '').toLowerCase();
  if (!LITERATURE_SOURCES.includes(source)) {
    throw literatureError('Literature source must be one of: ' + LITERATURE_SOURCES.join(', '),
      'INVALID_LITERATURE_SOURCE');
  }
  return source;
}

export function normalizeLiteratureIdentifier(source, value) {
  const identifier = String(value ?? '').trim();
  if (source === 'pubmed') {
    if (!PMID_PATTERN.test(identifier)) {
      throw literatureError('PubMed requires a numeric PMID.', 'INVALID_LITERATURE_IDENTIFIER');
    }
    return identifier;
  }
  const doi = identifier
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '');
  if (!DOI_PATTERN.test(doi)) {
    throw literatureError(source + ' requires a valid DOI.', 'INVALID_LITERATURE_IDENTIFIER');
  }
  return doi;
}

export function literatureRequestUrl(source, identifier) {
  if (source === 'crossref') {
    return 'https://api.crossref.org/works/' + encodeURIComponent(identifier);
  }
  if (source === 'openalex') {
    return 'https://api.openalex.org/works/doi:' + encodeURIComponent(identifier);
  }
  return 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' +
    encodeURIComponent(identifier);
}

function parseCrossref(body, identifier) {
  const message = body?.message;
  if (!message || typeof message !== 'object') {
    throw literatureError('Crossref response has no message object.', 'LITERATURE_PARSE_FAILED');
  }
  const doi = boundedString(message.DOI, 300)?.toLowerCase() ?? identifier.toLowerCase();
  return {
    doi,
    title: boundedString(Array.isArray(message.title) ? message.title[0] : message.title, 1_000),
    authors: (Array.isArray(message.author) ? message.author : [])
      .slice(0, MAX_LITERATURE_AUTHORS)
      .map((author) => boundedString(
        [author?.given, author?.family].filter(Boolean).join(' ') || author?.name,
        200
      ))
      .filter(Boolean),
    year: boundedYear(message.issued?.['date-parts']?.[0]?.[0]),
    container_title: boundedString(
      Array.isArray(message['container-title']) ? message['container-title'][0]
        : message['container-title'],
      500
    ),
    publisher: boundedString(message.publisher, 500),
    type: boundedString(message.type, 100)
  };
}

function parseOpenAlex(body, identifier) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw literatureError('OpenAlex response is not a work object.', 'LITERATURE_PARSE_FAILED');
  }
  const doi = boundedString(body.doi, 400)
    ?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    ?.toLowerCase() ?? identifier.toLowerCase();
  return {
    doi,
    openalex_id: boundedString(body.id, 300),
    title: boundedString(body.display_name ?? body.title, 1_000),
    authors: (Array.isArray(body.authorships) ? body.authorships : [])
      .slice(0, MAX_LITERATURE_AUTHORS)
      .map((entry) => boundedString(entry?.author?.display_name, 200))
      .filter(Boolean),
    year: boundedYear(body.publication_year),
    container_title: boundedString(body.primary_location?.source?.display_name, 500),
    publisher: boundedString(body.primary_location?.source?.host_organization_name, 500),
    type: boundedString(body.type, 100)
  };
}

function parsePubmed(body, identifier) {
  const entry = body?.result?.[identifier];
  if (!entry || typeof entry !== 'object') {
    throw literatureError('PubMed esummary response has no entry for PMID ' + identifier + '.',
      'LITERATURE_PARSE_FAILED');
  }
  const doiEntry = (Array.isArray(entry.articleids) ? entry.articleids : [])
    .find((item) => item?.idtype === 'doi');
  const pubdateYear = boundedString(entry.pubdate, 100)?.match(/\b(1[4-9][0-9]{2}|20[0-9]{2}|21[0-9]{2})\b/);
  return {
    pmid: identifier,
    doi: boundedString(doiEntry?.value, 300)?.toLowerCase() ?? null,
    title: boundedString(entry.title, 1_000),
    authors: (Array.isArray(entry.authors) ? entry.authors : [])
      .slice(0, MAX_LITERATURE_AUTHORS)
      .map((author) => boundedString(author?.name, 200))
      .filter(Boolean),
    year: pubdateYear ? boundedYear(pubdateYear[1]) : null,
    container_title: boundedString(entry.fulljournalname ?? entry.source, 500),
    publisher: null,
    type: boundedString(Array.isArray(entry.pubtype) ? entry.pubtype[0] : entry.pubtype, 100)
  };
}

export function parseLiteratureResponse(source, buffer, identifier) {
  const normalizedSource = normalizeLiteratureSource(source);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 ||
      buffer.length > MAX_LITERATURE_RESPONSE_BYTES) {
    throw literatureError('Literature response must be a non-empty buffer of at most ' +
      MAX_LITERATURE_RESPONSE_BYTES + ' bytes.', 'LITERATURE_RESPONSE_TOO_LARGE');
  }
  let body;
  try {
    body = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw literatureError('Literature response is not valid JSON: ' + error.message,
      'LITERATURE_PARSE_FAILED');
  }
  const parsed = normalizedSource === 'crossref'
    ? parseCrossref(body, identifier)
    : normalizedSource === 'openalex'
      ? parseOpenAlex(body, identifier)
      : parsePubmed(body, identifier);
  if (!parsed.title) {
    throw literatureError('Literature response contains no usable title.',
      'LITERATURE_PARSE_FAILED');
  }
  return {
    schema_version: LITERATURE_SCHEMA_VERSION,
    source: normalizedSource,
    identifier,
    parser: { name: LITERATURE_PARSER_NAME, version: LITERATURE_PARSER_VERSION },
    bibliography: parsed
  };
}

export function makeLiteratureId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'literature-' + stamp + '-' + crypto.randomBytes(4).toString('hex');
}

function normalizeLiteratureId(value) {
  const id = String(value ?? '');
  if (!LITERATURE_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw literatureError('Invalid literature record ID: ' + id, 'INVALID_LITERATURE_ID');
  }
  return id;
}

function literatureRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  const metadata = path.join(project, INTERNAL_DIR);
  const root = path.join(metadata, 'literature');
  if (fs.existsSync(metadata)) {
    const metadataStat = fs.lstatSync(metadata);
    if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() ||
        !isPathInside(fs.realpathSync(project), fs.realpathSync(metadata))) {
      throw literatureError('ScienceCode metadata storage escapes the project.',
        'INVALID_LITERATURE_PATH');
    }
  }
  if (create) {
    ensureScienceDir(project);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  if (fs.existsSync(root)) {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        !isPathInside(fs.realpathSync(metadata), fs.realpathSync(root))) {
      throw literatureError('Literature storage escapes the project metadata root.',
        'INVALID_LITERATURE_PATH');
    }
    return fs.realpathSync(root);
  }
  return root;
}

export function resolveLiteratureDirectory(cwd, value) {
  return path.join(literatureRoot(cwd), normalizeLiteratureId(value));
}

function literatureFiles(cwd, value) {
  const directory = resolveLiteratureDirectory(cwd, value);
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    response: path.join(directory, 'response.json'),
    record: path.join(directory, 'record.json')
  };
}

function safeLiteratureFiles(cwd, value) {
  const files = literatureFiles(cwd, value);
  const root = literatureRoot(cwd);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw literatureError('Literature record not found: ' + normalizeLiteratureId(value),
      'LITERATURE_NOT_FOUND');
  }
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(root, directoryReal)) {
    throw literatureError('Literature record escapes its storage root.',
      'INVALID_LITERATURE_PATH');
  }
  return { ...files, directory: directoryReal };
}

function safeRegularFile(file, directory) {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return Boolean(stat?.isFile() && !stat.isSymbolicLink() &&
      isPathInside(directory, fs.realpathSync(file)));
  } catch {
    return false;
  }
}

function literatureIds(cwd) {
  const ids = new Set();
  try {
    const root = literatureRoot(cwd);
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (LITERATURE_ID_PATTERN.test(entry.name)) ids.add(entry.name);
      }
    }
  } catch {
    // Audit discovery below still exposes previously created records.
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'literature.ingested' &&
          LITERATURE_ID_PATTERN.test(String(record.literature_id ?? ''))) {
        ids.add(record.literature_id);
      }
    }
  } catch {
    // Project verification reports an unreadable audit log separately.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
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

export function ingestLiteratureResponse({
  cwd,
  source,
  identifier,
  response,
  request,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw literatureError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw literatureError('Literature record timestamp is invalid.');
  }
  const normalizedSource = normalizeLiteratureSource(source);
  const normalizedIdentifier = normalizeLiteratureIdentifier(normalizedSource, identifier);
  const record = parseLiteratureResponse(normalizedSource, response, normalizedIdentifier);
  const findings = scanSecrets(response.toString('utf8'));
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in literature response; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const retrievedAt = String(request?.retrieved_at ?? now.toISOString());
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(retrievedAt) ||
      !Number.isFinite(Date.parse(retrievedAt))) {
    throw literatureError('Literature retrieval timestamp must be a bounded ISO-8601 UTC time.');
  }
  const httpStatus = request?.http_status ?? null;
  if (httpStatus !== null &&
      (!Number.isSafeInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    throw literatureError('Literature HTTP status must be an integer from 100 through 599.');
  }
  const normalizedRequest = {
    url: String(request?.url ?? literatureRequestUrl(normalizedSource, normalizedIdentifier)),
    method: 'GET',
    retrieved_at: retrievedAt,
    http_status: httpStatus,
    transport: request?.transport === 'file' ? 'file' : 'https'
  };
  if (normalizedRequest.url.length > 2_000 ||
      !/^https:\/\//.test(normalizedRequest.url)) {
    throw literatureError('Literature request URL must be a bounded https URL.');
  }
  if (literatureIds(project).length >= MAX_LITERATURE_RECORDS) {
    throw literatureError('Literature record limit reached for this project.',
      'LITERATURE_LIMIT');
  }
  const root = literatureRoot(project, { create: true });
  const id = makeLiteratureId(now);
  const finalDirectory = path.join(root, id);
  if (fs.existsSync(finalDirectory)) {
    throw literatureError('Literature record already exists: ' + id, 'LITERATURE_EXISTS');
  }
  const staging = path.join(root, '.staging-literature-' + crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    writeBufferExclusive(path.join(staging, 'response.json'), response);
    writeJsonExclusive(path.join(staging, 'record.json'), record);
    const recordFile = path.join(staging, 'record.json');
    const manifest = {
      schema_version: LITERATURE_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      literature_id: id,
      created_at: now.toISOString(),
      source: normalizedSource,
      identifier: normalizedIdentifier,
      request: normalizedRequest,
      parser: { name: LITERATURE_PARSER_NAME, version: LITERATURE_PARSER_VERSION },
      response: {
        file: 'response.json',
        sha256: sha256Buffer(response),
        bytes: response.length
      },
      record: {
        file: 'record.json',
        sha256: sha256File(recordFile),
        bytes: fs.statSync(recordFile).size
      },
      bibliography: record.bibliography,
      interpretation: 'A frozen third-party metadata snapshot at retrieval time; it does not establish the accuracy of the source registry.',
      preservation_policy: 'immutable raw response, parsed record, and manifest; refreshes are new literature records'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(path.join(staging, 'manifest.json')) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'literature.ingested',
      literature_id: id,
      source: normalizedSource,
      identifier: normalizedIdentifier,
      transport: normalizedRequest.transport,
      manifest_sha256: manifestSha256,
      response_sha256: manifest.response.sha256,
      record_sha256: manifest.record.sha256
    });
    return { manifest, record, manifest_sha256: manifestSha256, directory: finalDirectory };
  } catch (error) {
    if (isPathInside(root, staging) &&
        path.basename(staging).startsWith('.staging-literature-')) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function fetchLiteratureRecord({
  cwd,
  source,
  identifier,
  timeoutMs = LITERATURE_FETCH_TIMEOUT_MS,
  now = new Date(),
  fetchImpl = globalThis.fetch
}) {
  const normalizedSource = normalizeLiteratureSource(source);
  const normalizedIdentifier = normalizeLiteratureIdentifier(normalizedSource, identifier);
  if (typeof fetchImpl !== 'function') {
    throw literatureError('No fetch implementation is available.', 'LITERATURE_FETCH_FAILED');
  }
  const url = literatureRequestUrl(normalizedSource, normalizedIdentifier);
  const controller = new AbortController();
  // The timer stays armed until the body finishes streaming, so a server that
  // sends headers and then dribbles bytes cannot hang the fetch forever.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchLiteratureBody({
      cwd, url, controller, fetchImpl,
      source: normalizedSource, identifier: normalizedIdentifier, now
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiteratureBody({ cwd, url, controller, fetchImpl, source, identifier, now }) {
  let httpResponse;
  try {
    httpResponse = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'sciencecode/' + VERSION +
          ' (reproducibility-first research workbench; mailto:unconfigured@sciencecode.invalid)'
      }
    });
  } catch (error) {
    throw Object.assign(
      new Error('Literature fetch failed for ' + url + ': ' + (error?.message ?? error)),
      { code: 'LITERATURE_FETCH_FAILED' }
    );
  }
  if (!httpResponse.ok) {
    throw Object.assign(
      new Error('Literature fetch returned HTTP ' + httpResponse.status + ' for ' + url),
      { code: 'LITERATURE_FETCH_FAILED', http_status: httpResponse.status }
    );
  }
  const declaredLength = Number(httpResponse.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LITERATURE_RESPONSE_BYTES) {
    throw Object.assign(
      new Error('Literature response declares ' + declaredLength + ' bytes, above the ' +
        MAX_LITERATURE_RESPONSE_BYTES + '-byte limit.'),
      { code: 'LITERATURE_RESPONSE_TOO_LARGE' }
    );
  }
  let bytes;
  if (httpResponse.body?.getReader) {
    const reader = httpResponse.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_LITERATURE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw Object.assign(
          new Error('Literature response exceeded the ' +
            MAX_LITERATURE_RESPONSE_BYTES + '-byte limit while streaming.'),
          { code: 'LITERATURE_RESPONSE_TOO_LARGE' }
        );
      }
      chunks.push(Buffer.from(value));
    }
    bytes = Buffer.concat(chunks);
  } else {
    bytes = Buffer.from(await httpResponse.arrayBuffer());
    if (bytes.length > MAX_LITERATURE_RESPONSE_BYTES) {
      throw Object.assign(
        new Error('Literature response exceeded the ' +
          MAX_LITERATURE_RESPONSE_BYTES + '-byte limit.'),
        { code: 'LITERATURE_RESPONSE_TOO_LARGE' }
      );
    }
  }
  return ingestLiteratureResponse({
    cwd,
    source,
    identifier,
    response: bytes,
    request: {
      url,
      retrieved_at: now.toISOString(),
      http_status: httpResponse.status,
      transport: 'https'
    },
    now
  });
}

export function importLiteratureResponse({ cwd, source, identifier, file, now = new Date() }) {
  const project = path.resolve(cwd);
  const resolved = resolveInsideRoot(project, file);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_LITERATURE_RESPONSE_BYTES) {
    throw literatureError('Literature import requires a regular project file of at most ' +
      MAX_LITERATURE_RESPONSE_BYTES + ' bytes.', 'INVALID_LITERATURE_REQUEST');
  }
  const normalizedSource = normalizeLiteratureSource(source);
  const normalizedIdentifier = normalizeLiteratureIdentifier(normalizedSource, identifier);
  return ingestLiteratureResponse({
    cwd,
    source: normalizedSource,
    identifier: normalizedIdentifier,
    response: fs.readFileSync(resolved),
    request: {
      url: literatureRequestUrl(normalizedSource, normalizedIdentifier),
      retrieved_at: now.toISOString(),
      http_status: null,
      transport: 'file'
    },
    now
  });
}

export function getLiteratureManifest(cwd, value) {
  const id = normalizeLiteratureId(value);
  const files = safeLiteratureFiles(cwd, id);
  if (!safeRegularFile(files.manifest, files.directory)) {
    throw literatureError('Literature record not found: ' + id, 'LITERATURE_NOT_FOUND');
  }
  return readJson(files.manifest);
}

export function getLiteratureRecord(cwd, value) {
  const id = normalizeLiteratureId(value);
  const files = safeLiteratureFiles(cwd, id);
  const manifest = getLiteratureManifest(cwd, id);
  if (!safeRegularFile(files.record, files.directory)) {
    throw literatureError('Literature record is missing or unsafe: ' + id, 'LITERATURE_NOT_FOUND');
  }
  return { manifest, record: readJson(files.record) };
}

export function verifyLiteratureRecord(cwd, value) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeLiteratureId(value);
  } catch (error) {
    return {
      ok: false,
      literature_id: String(value ?? ''),
      errors: [{ issue: error.code ?? 'literature_error', detail: error.message }]
    };
  }
  let files;
  try {
    files = safeLiteratureFiles(project, id);
  } catch (error) {
    return {
      ok: false,
      literature_id: id,
      errors: [{
        issue: error.code === 'LITERATURE_NOT_FOUND'
          ? 'literature_missing'
          : error.code ?? 'invalid_literature_path',
        detail: error.message
      }]
    };
  }
  const errors = [];
  let manifest = null;
  let record = null;
  try {
    if (!safeRegularFile(files.manifest, files.directory)) throw new Error('missing or unsafe file');
    manifest = readJson(files.manifest);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (!safeRegularFile(files.record, files.directory)) throw new Error('missing or unsafe file');
    record = readJson(files.record);
  } catch (error) {
    errors.push({ file: 'record.json', issue: 'invalid_json', detail: error.message });
  }
  const manifestSha256 = safeRegularFile(files.manifest, files.directory)
    ? sha256File(files.manifest)
    : null;
  if (!safeRegularFile(files.digest, files.directory)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else if (fs.readFileSync(files.digest, 'utf8').trim() !== manifestSha256) {
    errors.push({ file: 'manifest.json', issue: 'hash_mismatch' });
  }
  let responseSha256 = null;
  if (!safeRegularFile(files.response, files.directory)) {
    errors.push({ file: 'response.json', issue: 'missing' });
  } else {
    responseSha256 = sha256File(files.response);
  }
  if (manifest) {
    if (manifest.schema_version !== LITERATURE_SCHEMA_VERSION) {
      errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
    }
    if (manifest.literature_id !== id) {
      errors.push({ file: 'manifest.json', issue: 'literature_id_mismatch' });
    }
    if (manifest.parser?.name !== LITERATURE_PARSER_NAME ||
        manifest.parser?.version !== LITERATURE_PARSER_VERSION) {
      errors.push({ file: 'manifest.json', issue: 'invalid_parser' });
    }
    if (responseSha256 && manifest.response?.sha256 !== responseSha256) {
      errors.push({ file: 'response.json', issue: 'hash_mismatch' });
    }
    if (responseSha256 &&
        manifest.response?.bytes !== fs.statSync(files.response).size) {
      errors.push({ file: 'response.json', issue: 'size_mismatch' });
    }
    if (safeRegularFile(files.record, files.directory)) {
      if (manifest.record?.sha256 !== sha256File(files.record)) {
        errors.push({ file: 'record.json', issue: 'hash_mismatch' });
      }
      if (manifest.record?.bytes !== fs.statSync(files.record).size) {
        errors.push({ file: 'record.json', issue: 'size_mismatch' });
      }
    }
    if (record && responseSha256 && manifest.response?.sha256 === responseSha256) {
      try {
        const replayed = parseLiteratureResponse(
          manifest.source,
          fs.readFileSync(files.response),
          manifest.identifier
        );
        if (sha256Json(replayed) !== sha256Json(record)) {
          errors.push({ file: 'record.json', issue: 'parse_replay_mismatch' });
        }
        if (sha256Json(manifest.bibliography) !== sha256Json(record.bibliography)) {
          errors.push({ file: 'manifest.json', issue: 'bibliography_mismatch' });
        }
      } catch (error) {
        errors.push({
          file: 'response.json',
          issue: error.code ?? 'parse_replay_failed',
          detail: error.message
        });
      }
    }
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else if (manifest) {
    const event = readAuditRecords(project).findLast((item) =>
      item.type === 'literature.ingested' && item.literature_id === id);
    if (!event) {
      errors.push({ issue: 'missing_audit_event' });
    } else if (event.manifest_sha256 !== manifestSha256 ||
        event.response_sha256 !== manifest.response?.sha256 ||
        event.record_sha256 !== manifest.record?.sha256) {
      errors.push({ issue: 'audit_literature_mismatch' });
    }
  }
  return {
    ok: errors.length === 0,
    literature_id: id,
    manifest,
    record,
    manifest_sha256: manifestSha256,
    response_sha256: responseSha256,
    errors
  };
}

export function literatureInteractionArtifact(value) {
  const manifest = value.manifest ?? value;
  return {
    kind: 'literature',
    record_id: manifest.literature_id,
    name: manifest.bibliography?.title ?? manifest.identifier ?? manifest.literature_id,
    url: '/api/literature/' + encodeURIComponent(manifest.literature_id)
  };
}

export function literatureInteractionPayload(value, note = null) {
  const manifest = value.manifest ?? value;
  const record = value.record ?? {};
  const bibliography = record.bibliography ?? manifest.bibliography ?? {};
  return {
    literature_id: manifest.literature_id,
    source: manifest.source,
    identifier: manifest.identifier,
    transport: manifest.request?.transport ?? null,
    retrieved_at: manifest.request?.retrieved_at ?? null,
    response_sha256: manifest.response?.sha256 ?? null,
    title: bibliography.title ?? null,
    authors: (bibliography.authors ?? []).slice(0, 12),
    year: bibliography.year ?? null,
    doi: bibliography.doi ?? null,
    container_title: bibliography.container_title ?? null,
    note,
    interpretation: 'frozen third-party registry metadata at retrieval time; not evidence of the work\'s content or correctness'
  };
}

export function listLiteratureRecords(cwd, { source } = {}) {
  return literatureIds(cwd).map((id) => {
    const verification = verifyLiteratureRecord(cwd, id);
    const manifest = verification.manifest;
    return {
      literature_id: id,
      source: manifest?.source ?? null,
      identifier: manifest?.identifier ?? null,
      title: manifest?.bibliography?.title ?? null,
      year: manifest?.bibliography?.year ?? null,
      doi: manifest?.bibliography?.doi ?? null,
      transport: manifest?.request?.transport ?? null,
      retrieved_at: manifest?.request?.retrieved_at ?? null,
      created_at: manifest?.created_at ?? null,
      verified: verification.ok,
      errors: verification.errors,
      url: '/api/literature/' + encodeURIComponent(id)
    };
  // Unverifiable records have a null source, so a source filter keeps them
  // visible rather than hiding exactly the records that need attention.
  }).filter((item) => !source || item.source === source || !item.verified)
    .sort((left, right) =>
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) ||
      right.literature_id.localeCompare(left.literature_id));
}
