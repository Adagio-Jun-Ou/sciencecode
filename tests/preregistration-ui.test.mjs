import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_PREREGISTRATION_BYTES,
  PREREGISTRATION_REQUIRED_SECTIONS,
  defaultPreregistrationDraft,
  inspectPreregistrationDraft
} from '../lab/preregistration.js';
import {
  MAX_PREREGISTRATION_BYTES as CORE_MAX_PREREGISTRATION_BYTES,
  PREREGISTRATION_REQUIRED_SECTIONS as CORE_PREREGISTRATION_REQUIRED_SECTIONS,
  inspectPreregistrationContent
} from '../lib/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function completeDraft() {
  return defaultPreregistrationDraft().replace(
    /\[REPLACE:[^\]]*\]/g,
    'Prespecified substantive content for this section.'
  );
}

test('preregistration draft inspection mirrors the bounded required-section contract', () => {
  assert.equal(MAX_PREREGISTRATION_BYTES, CORE_MAX_PREREGISTRATION_BYTES);
  assert.deepEqual(
    PREREGISTRATION_REQUIRED_SECTIONS,
    CORE_PREREGISTRATION_REQUIRED_SECTIONS
  );
  const template = defaultPreregistrationDraft();
  const initial = inspectPreregistrationDraft(template);
  assert.equal(initial.placeholder_count, PREREGISTRATION_REQUIRED_SECTIONS.length);
  assert.equal(initial.valid, false);
  assert.deepEqual(initial.missing_sections, []);
  assert.deepEqual(initial.empty_sections, []);

  const completed = inspectPreregistrationDraft(completeDraft());
  assert.equal(completed.valid, true);
  assert.equal(completed.maximum_bytes, MAX_PREREGISTRATION_BYTES);
  assert.deepEqual(completed.required_sections, PREREGISTRATION_REQUIRED_SECTIONS);
  assert.deepEqual(completed, inspectPreregistrationContent(completeDraft()));

  const missing = inspectPreregistrationDraft(
    completeDraft().replace(/## Research question[\s\S]*?(?=\n## Hypotheses)/, '')
  );
  assert.deepEqual(missing.missing_sections, ['Research question']);
  assert.equal(missing.valid, false);

  const duplicate = inspectPreregistrationDraft(
    completeDraft() + '\n## Hypotheses\nA second hypothesis section.\n'
  );
  assert.deepEqual(duplicate.duplicate_sections, ['Hypotheses']);
  assert.equal(duplicate.valid, false);

  const fenced = inspectPreregistrationDraft(
    '```markdown\n' + completeDraft() + '```\n'
  );
  assert.deepEqual(fenced.missing_sections, PREREGISTRATION_REQUIRED_SECTIONS);
  assert.equal(fenced.valid, false);

  const indentedCode = inspectPreregistrationDraft(
    completeDraft().replace(/^## /gm, '    ## ')
  );
  assert.deepEqual(indentedCode.missing_sections, PREREGISTRATION_REQUIRED_SECTIONS);
  assert.equal(indentedCode.valid, false);

  const oversized = inspectPreregistrationDraft('x'.repeat(MAX_PREREGISTRATION_BYTES + 1));
  assert.equal(oversized.bytes, MAX_PREREGISTRATION_BYTES + 1);
  assert.equal(oversized.valid, false);
});

test('Confirmatory Lab source exposes accessible, responsive, no-chat preregistration authoring', () => {
  const moduleSource = fs.readFileSync(path.join(root, 'lab', 'preregistration.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'lab', 'styles.css'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'lib', 'lab.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.match(moduleSource, /renderPreregistrationBuilder/);
  assert.match(moduleSource, /aria-labelledby/);
  assert.match(moduleSource, /aria-live/);
  assert.match(moduleSource, /aria-describedby/);
  assert.match(moduleSource, /spellcheck = true/);
  assert.match(moduleSource, /chat_id: share\.checked \? selectedChat : null/);
  assert.match(moduleSource, /form\.setAttribute\('aria-busy'/);
  assert.match(moduleSource, /UTF-8 bytes/);

  assert.match(appSource, /from '\/preregistration\.js'/);
  assert.match(appSource, /renderPreregistrationBuilder/);
  assert.match(appSource, /showPreregistrationDetail/);
  assert.match(appSource, /record\.verified/);
  assert.match(appSource, /chat_id: selectedChat \?\? null, spec/);
  assert.doesNotMatch(appSource,
    /Start or select a conversation before freezing an AI-visible contract/);
  assert.doesNotMatch(appSource,
    /Start or select a conversation before creating an AI-visible assessment/);

  assert.match(styles, /\.preregistration-builder\s*\{/);
  assert.match(styles, /grid-column:\s*1 \/ -1/);
  assert.match(styles, /\.preregistration-checklist\s*\{/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.preregistration-checklist/);
  assert.match(styles, /\.preregistration-source-text/);

  assert.match(server, /'preregistration\.js'/);
  assert.match(server, /MAX_PREREGISTRATION_JSON_BODY_BYTES/);
  assert.match(server, /resolvePreregistrationArtifact/);
  assert.match(packageJson.scripts.check, /node --check lab\/preregistration\.js/);
});
