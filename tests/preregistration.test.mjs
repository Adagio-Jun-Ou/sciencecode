import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_PREREGISTRATION_BYTES,
  PREREGISTRATION_REQUIRED_SECTIONS,
  freezePreregistration,
  freezePreregistrationContent,
  inspectPreregistrationContent,
  listPreregistrations,
  resolvePreregistrationArtifact,
  verifyPreregistration,
  verifyProject
} from '../lib/core.js';

function temporaryProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-preregister-'));
}

function authoredProtocol(overrides = {}) {
  const values = {
    question: 'Does treatment A improve the prespecified day-30 response?',
    hypotheses: 'H1: treatment A increases the day-30 response relative to control.',
    design: 'Randomized, blinded, parallel comparison in the defined study population.',
    outcomes: 'Primary: day-30 response measured in percentage points.',
    sample: 'Analyze 120 participants; stop only after the fixed sample is complete.',
    eligibility: 'Apply criteria before allocation; use the prespecified missing-data rule.',
    analysis: 'Compare the arithmetic means and pass only when the frozen threshold is met.',
    multiplicity: 'One primary outcome; report the prespecified robustness analysis separately.',
    limitations: 'Record every deviation and retain known measurement and generalizability limits.',
    ...overrides
  };
  return `# Day-30 study preregistration

## Research question
${values.question}

## Hypotheses
${values.hypotheses}

## Design and population
${values.design}

## Primary outcomes
${values.outcomes}

## Sample size and stopping rule
${values.sample}

## Inclusion, exclusion, and missing data
${values.eligibility}

## Analysis and decision rules
${values.analysis}

## Multiplicity and sensitivity analyses
${values.multiplicity}

## Deviations, risks, and limitations
${values.limitations}
`;
}

test('preregistration freezes an immutable copy and reports later source drift', () => {
  const directory = temporaryProject();
  const source = path.join(directory, 'protocol.md');
  fs.writeFileSync(source, '# Protocol\n\nPrimary outcome: response at day 30.\n');
  const frozen = freezePreregistration(directory, 'protocol.md', { name: 'Day 30 study' });
  assert.match(frozen.preregistration_id, /day-30-study$/);
  assert.equal(listPreregistrations(directory).length, 1);

  let verification = verifyPreregistration(directory, frozen.preregistration_id);
  assert.equal(verification.ok, true);
  assert.equal(verification.source_status, 'unchanged');

  fs.appendFileSync(source, '\nExploratory secondary outcome added later.\n');
  verification = verifyPreregistration(directory, frozen.preregistration_id);
  assert.equal(verification.ok, true);
  assert.equal(verification.source_status, 'modified');
  assert.equal(verifyProject(directory).ok, true);
});

test('preregistration verification detects a changed frozen artifact', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'protocol.md'), '# Protocol\n');
  const frozen = freezePreregistration(directory, 'protocol.md');
  const frozenFile = path.join(
    directory,
    '.sciencecode',
    'preregistrations',
    frozen.frozen_file
  );
  fs.appendFileSync(frozenFile, 'tampered');
  const verification = verifyPreregistration(directory, frozen.preregistration_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.issue === 'hash_mismatch'));
  assert.equal(verifyProject(directory).ok, false);
});

test('preregistration secret preflight runs before metadata creation', () => {
  const directory = temporaryProject();
  fs.writeFileSync(path.join(directory, 'protocol.md'), 'token=supersecretvalue123\n');
  assert.throws(
    () => freezePreregistration(directory, 'protocol.md'),
    { code: 'SECRET_DETECTED' }
  );
  assert.equal(fs.existsSync(path.join(directory, '.sciencecode')), false);
});

test('inline-authored preregistrations are structurally complete, immutable, and replayable', () => {
  const directory = temporaryProject();
  const content = authoredProtocol();
  const inspection = inspectPreregistrationContent(content);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.missing_sections.length, 0);
  assert.equal(inspection.placeholder_count, 0);

  const frozen = freezePreregistrationContent(directory, content, {
    name: 'Day 30 authored study'
  });
  assert.equal(frozen.schema_version, 2);
  assert.equal(frozen.source.kind, 'inline');
  assert.equal(frozen.source.format, 'markdown');
  assert.equal(fs.readFileSync(
    resolvePreregistrationArtifact(directory, frozen.preregistration_id),
    'utf8'
  ), content);
  const verification = verifyPreregistration(directory, frozen.preregistration_id);
  assert.equal(verification.ok, true);
  assert.equal(verification.source_status, 'authored_inline');
  assert.equal(listPreregistrations(directory)[0].source_kind, 'inline');
  assert.equal(verifyProject(directory).ok, true);
});

test('inline authoring rejects incomplete, placeholder, secret, and oversized content before state', () => {
  const incomplete = temporaryProject();
  assert.throws(
    () => freezePreregistrationContent(incomplete, '# Study\n\nNo structured sections.\n'),
    { code: 'INVALID_PREREGISTRATION_CONTENT' }
  );
  assert.equal(fs.existsSync(path.join(incomplete, '.sciencecode')), false);

  const fencedHeadings = inspectPreregistrationContent(
    '```markdown\n' + authoredProtocol() + '```\n'
  );
  assert.equal(fencedHeadings.valid, false);
  assert.deepEqual(
    fencedHeadings.missing_sections,
    [...PREREGISTRATION_REQUIRED_SECTIONS]
  );

  const placeholder = temporaryProject();
  assert.throws(
    () => freezePreregistrationContent(placeholder, authoredProtocol({
      question: '[REPLACE: state the research question]'
    })),
    { code: 'INVALID_PREREGISTRATION_CONTENT' }
  );
  assert.equal(fs.existsSync(path.join(placeholder, '.sciencecode')), false);

  const secret = temporaryProject();
  assert.throws(
    () => freezePreregistrationContent(secret, authoredProtocol({
      limitations: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'
    })),
    { code: 'SECRET_DETECTED' }
  );
  assert.equal(fs.existsSync(path.join(secret, '.sciencecode')), false);

  const secretName = temporaryProject();
  assert.throws(
    () => freezePreregistrationContent(secretName, authoredProtocol(), {
      name: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'
    }),
    { code: 'SECRET_DETECTED' }
  );
  assert.equal(fs.existsSync(path.join(secretName, '.sciencecode')), false);

  const oversized = temporaryProject();
  assert.throws(
    () => freezePreregistrationContent(oversized, authoredProtocol({
      limitations: 'x'.repeat(MAX_PREREGISTRATION_BYTES)
    })),
    { code: 'PREREGISTRATION_TOO_LARGE' }
  );
  assert.equal(fs.existsSync(path.join(oversized, '.sciencecode')), false);
});

test('preregistration creation rejects source and storage junction escapes', (context) => {
  const sourceProject = temporaryProject();
  const outsideSource = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-preregister-outside-'));
  fs.writeFileSync(path.join(outsideSource, 'protocol.md'), authoredProtocol());
  try {
    fs.symlinkSync(
      outsideSource,
      path.join(sourceProject, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Filesystem links are unavailable in this environment.');
      return;
    }
    throw error;
  }
  assert.throws(
    () => freezePreregistration(sourceProject, 'linked-outside/protocol.md'),
    { code: 'PATH_OUTSIDE_ROOT' }
  );

  const storageProject = temporaryProject();
  const outsideStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-preregister-store-'));
  fs.mkdirSync(path.join(storageProject, '.sciencecode'), { recursive: true });
  fs.symlinkSync(
    outsideStorage,
    path.join(storageProject, '.sciencecode', 'preregistrations'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => freezePreregistrationContent(storageProject, authoredProtocol()),
    { code: 'PREREGISTRATION_STORAGE_UNSAFE' }
  );
  assert.deepEqual(fs.readdirSync(outsideStorage), []);
  assert.deepEqual(
    fs.readdirSync(path.join(storageProject, '.sciencecode')),
    ['preregistrations']
  );

  const metadataProject = temporaryProject();
  const outsideMetadata = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-preregister-metadata-')
  );
  fs.symlinkSync(
    outsideMetadata,
    path.join(metadataProject, '.sciencecode'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => freezePreregistrationContent(metadataProject, authoredProtocol()),
    { code: 'PREREGISTRATION_STORAGE_UNSAFE' }
  );
  assert.deepEqual(fs.readdirSync(outsideMetadata), []);

  const recordProject = temporaryProject();
  const record = freezePreregistrationContent(recordProject, authoredProtocol(), {
    name: 'Record link safety'
  });
  const outsideRecord = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-preregister-record-')),
    'outside.json'
  );
  fs.writeFileSync(outsideRecord, JSON.stringify({ exposed: 'must not be read' }));
  const recordFile = path.join(
    recordProject, '.sciencecode', 'preregistrations',
    record.preregistration_id + '.json'
  );
  fs.rmSync(recordFile);
  try {
    fs.symlinkSync(outsideRecord, recordFile, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
    throw error;
  }
  const linkedRecordVerification = verifyPreregistration(
    recordProject, record.preregistration_id
  );
  assert.equal(linkedRecordVerification.ok, false);
  assert.equal(linkedRecordVerification.errors[0].issue,
    'PREREGISTRATION_STORAGE_UNSAFE');
  assert.throws(
    () => resolvePreregistrationArtifact(recordProject, record.preregistration_id),
    { code: 'PREREGISTRATION_INVALID' }
  );
});
