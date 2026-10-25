import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LITERATURE_PARSER_NAME,
  LITERATURE_PARSER_VERSION,
  LITERATURE_SOURCES,
  fetchLiteratureRecord,
  getLiteratureRecord,
  importLiteratureResponse,
  ingestLiteratureResponse,
  listLiteratureRecords,
  literatureRequestUrl,
  normalizeLiteratureIdentifier,
  normalizeLiteratureSource,
  parseLiteratureResponse,
  verifyLiteratureRecord
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-literature-'));
}

function crossrefBody(doi = '10.1000/example.2026') {
  return {
    status: 'ok',
    message: {
      DOI: doi.toUpperCase(),
      title: ['A reproducibility-first workbench'],
      author: [
        { given: 'Ada', family: 'Lovelace' },
        { given: 'Grace', family: 'Hopper' }
      ],
      issued: { 'date-parts': [[2026, 3, 4]] },
      'container-title': ['Journal of Deterministic Software'],
      publisher: 'Example Press',
      type: 'journal-article'
    }
  };
}

function openalexBody() {
  return {
    id: 'https://openalex.org/W123456789',
    doi: 'https://doi.org/10.1000/example.2026',
    display_name: 'A reproducibility-first workbench',
    publication_year: 2026,
    type: 'article',
    authorships: [{ author: { display_name: 'Ada Lovelace' } }],
    primary_location: {
      source: {
        display_name: 'Journal of Deterministic Software',
        host_organization_name: 'Example Press'
      }
    }
  };
}

function pubmedBody(pmid = '12345678') {
  return {
    header: { type: 'esummary' },
    result: {
      uids: [pmid],
      [pmid]: {
        uid: pmid,
        title: 'A reproducibility-first workbench.',
        authors: [{ name: 'Lovelace A' }, { name: 'Hopper G' }],
        pubdate: '2026 Mar 4',
        fulljournalname: 'Journal of Deterministic Software',
        pubtype: ['Journal Article'],
        articleids: [{ idtype: 'doi', value: '10.1000/EXAMPLE.2026' }]
      }
    }
  };
}

function invoke(argv, cwd) {
  let out = '';
  let err = '';
  const code = runCli({
    argv,
    cwd,
    root: packageRoot,
    env: process.env,
    stdout: { write(chunk) { out += String(chunk); } },
    stderr: { write(chunk) { err += String(chunk); } }
  });
  return { code, stdout: out, stderr: err };
}

test('identifiers, sources, and request URLs normalize deterministically', () => {
  assert.deepEqual([...LITERATURE_SOURCES], ['crossref', 'pubmed', 'openalex']);
  assert.equal(normalizeLiteratureSource('CrossRef'), 'crossref');
  assert.equal(
    normalizeLiteratureIdentifier('crossref', 'https://doi.org/10.1000/example.2026'),
    '10.1000/example.2026'
  );
  assert.equal(normalizeLiteratureIdentifier('pubmed', '12345678'), '12345678');
  assert.throws(() => normalizeLiteratureSource('scholar'), /source/);
  assert.throws(() => normalizeLiteratureIdentifier('pubmed', 'abc'), /PMID/);
  assert.throws(() => normalizeLiteratureIdentifier('crossref', 'not-a-doi'), /DOI/);
  assert.equal(
    literatureRequestUrl('crossref', '10.1000/example.2026'),
    'https://api.crossref.org/works/10.1000%2Fexample.2026'
  );
  assert.ok(literatureRequestUrl('pubmed', '12345678').includes('esummary.fcgi'));
  assert.ok(literatureRequestUrl('openalex', '10.1000/x.1').startsWith(
    'https://api.openalex.org/works/doi:'));
});

test('all three adapters parse to a bounded normalized bibliography', () => {
  const crossref = parseLiteratureResponse(
    'crossref', Buffer.from(JSON.stringify(crossrefBody())), '10.1000/example.2026');
  assert.equal(crossref.bibliography.doi, '10.1000/example.2026');
  assert.equal(crossref.bibliography.title, 'A reproducibility-first workbench');
  assert.deepEqual(crossref.bibliography.authors, ['Ada Lovelace', 'Grace Hopper']);
  assert.equal(crossref.bibliography.year, 2026);
  assert.deepEqual(crossref.parser,
    { name: LITERATURE_PARSER_NAME, version: LITERATURE_PARSER_VERSION });

  const openalex = parseLiteratureResponse(
    'openalex', Buffer.from(JSON.stringify(openalexBody())), '10.1000/example.2026');
  assert.equal(openalex.bibliography.doi, '10.1000/example.2026');
  assert.equal(openalex.bibliography.openalex_id, 'https://openalex.org/W123456789');
  assert.equal(openalex.bibliography.year, 2026);

  const pubmed = parseLiteratureResponse(
    'pubmed', Buffer.from(JSON.stringify(pubmedBody())), '12345678');
  assert.equal(pubmed.bibliography.pmid, '12345678');
  assert.equal(pubmed.bibliography.doi, '10.1000/example.2026');
  assert.equal(pubmed.bibliography.year, 2026);
  assert.equal(pubmed.bibliography.container_title, 'Journal of Deterministic Software');

  assert.throws(() => parseLiteratureResponse(
    'pubmed', Buffer.from(JSON.stringify(pubmedBody())), '999'), /no entry/);
  assert.throws(() => parseLiteratureResponse(
    'crossref', Buffer.from('not json'), '10.1000/x.1'), /valid JSON/);
});

test('ingest freezes exact bytes, verification replays the parse, tampering is detected', () => {
  const directory = project();
  const response = Buffer.from(JSON.stringify(crossrefBody()));
  const created = ingestLiteratureResponse({
    cwd: directory,
    source: 'crossref',
    identifier: '10.1000/example.2026',
    response,
    request: { transport: 'file' }
  });
  const id = created.manifest.literature_id;
  assert.equal(created.manifest.request.transport, 'file');
  assert.equal(created.manifest.response.bytes, response.length);

  const verification = verifyLiteratureRecord(directory, id);
  assert.equal(verification.ok, true);
  assert.equal(listLiteratureRecords(directory)[0].verified, true);
  assert.equal(getLiteratureRecord(directory, id).record.bibliography.year, 2026);

  const recordFile = path.join(directory, '.sciencecode', 'literature', id, 'record.json');
  const tamperedRecord = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  tamperedRecord.bibliography.year = 1999;
  fs.writeFileSync(recordFile, JSON.stringify(tamperedRecord));
  const tampered = verifyLiteratureRecord(directory, id);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) =>
    error.file === 'record.json' && error.issue === 'hash_mismatch'));
});

test('import ingests a saved response file without network access', () => {
  const directory = project();
  fs.writeFileSync(path.join(directory, 'saved.json'), JSON.stringify(pubmedBody()));
  const created = importLiteratureResponse({
    cwd: directory,
    source: 'pubmed',
    identifier: '12345678',
    file: 'saved.json'
  });
  assert.equal(created.manifest.request.transport, 'file');
  assert.equal(created.record.bibliography.pmid, '12345678');
  assert.equal(verifyLiteratureRecord(directory, created.manifest.literature_id).ok, true);
});

test('fetch uses the injected transport and refuses failed responses', async () => {
  const directory = project();
  const body = JSON.stringify(openalexBody());
  const okFetch = async (url) => {
    assert.ok(url.startsWith('https://api.openalex.org/works/doi:'));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer
    };
  };
  const created = await fetchLiteratureRecord({
    cwd: directory,
    source: 'openalex',
    identifier: '10.1000/example.2026',
    fetchImpl: okFetch
  });
  assert.equal(created.manifest.request.transport, 'https');
  assert.equal(created.manifest.request.http_status, 200);
  assert.equal(verifyLiteratureRecord(directory, created.manifest.literature_id).ok, true);

  await assert.rejects(fetchLiteratureRecord({
    cwd: directory,
    source: 'crossref',
    identifier: '10.1000/missing.1',
    fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
  }), (error) => error.code === 'LITERATURE_FETCH_FAILED' && error.http_status === 404);
});

test('the literature CLI imports, lists, shows, and verifies records', () => {
  const directory = project();
  fs.writeFileSync(path.join(directory, 'saved.json'), JSON.stringify(crossrefBody()));
  const imported = invoke([
    'literature', 'import', '--source', 'crossref', '--id', '10.1000/example.2026', 'saved.json'
  ], directory);
  assert.equal(imported.code, 0);
  assert.match(imported.stdout, /Frozen literature record literature-/);
  const id = imported.stdout.match(/literature-[A-Za-z0-9.-]+/)[0];

  const listed = invoke(['literature', 'list'], directory);
  assert.equal(listed.code, 0);
  assert.match(listed.stdout, /crossref/);

  const shown = invoke(['literature', 'show', id], directory);
  assert.equal(shown.code, 0);
  assert.match(shown.stdout, /reproducibility-first workbench/);

  const verified = invoke(['literature', 'verify', id], directory);
  assert.equal(verified.code, 0);

  const usage = invoke(['literature', 'help'], directory);
  assert.match(usage.stdout, /single explicit HTTPS GET/);
  const bad = invoke(['literature', 'import', '--source', 'crossref', 'saved.json'], directory);
  assert.equal(bad.code, 2);
});
