import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultProcedureSpec,
  procedureDraftModel
} from '../lab/procedure.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Procedure Studio template is editable, source-aware, and hardware-disabled', () => {
  const spec = defaultProcedureSpec('evidence-fixture');
  assert.equal(spec.source_evidence_ids[0], 'evidence-fixture');
  assert.equal(spec.domain, 'drug_discovery');
  assert.equal(spec.physical_execution_policy, 'external_human_control_only');
  assert.deepEqual(spec.automation_targets, ['xdl_2_0', 'opentrons_python']);
  assert.ok(spec.steps.length >= 2);
  assert.ok(spec.controls.some((item) => item.type === 'positive'));
  assert.ok(spec.controls.some((item) => item.type === 'vehicle'));
  assert.ok(spec.hazards.every((item) => item.controls.length > 0));

  const model = procedureDraftModel(spec);
  assert.equal(model.valid, true);
  assert.equal(model.physical_execution_enabled, false);
  assert.equal(model.counts.steps, spec.steps.length);
  assert.deepEqual(model.steps[1].dependencies, ['prepare']);
});

test('Procedure Studio live draft model surfaces policy and dependency errors', () => {
  const spec = defaultProcedureSpec();
  spec.physical_execution_policy = 'machine_authorized';
  spec.steps[1].depends_on = ['missing-step'];
  const model = procedureDraftModel(spec);
  assert.equal(model.valid, false);
  assert.ok(model.issues.some((item) =>
    item.includes('external_human_control_only')
  ));
  assert.ok(model.issues.some((item) => item.includes('unknown dependencies')));
  assert.equal(model.counts.sources, 0);
});

test('Procedure Studio draft model stays renderable for non-object JSON', () => {
  const model = procedureDraftModel([]);
  assert.equal(model.valid, false);
  assert.equal(model.counts.steps, 0);
  assert.equal(model.physical_execution_enabled, false);
  assert.match(model.issues.join(' '), /JSON object/i);
});

test('Lab exposes interactive procedure navigation, editors, inspectors, and AI handoff', () => {
  const html = fs.readFileSync(path.join(root, 'lab', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'lab', 'styles.css'), 'utf8');
  assert.match(html, /data-view="procedures"/);
  assert.match(html, /id="procedure-count"/);
  assert.match(app, /function renderProcedureWorkspace\(/);
  assert.match(app, /function renderProcedurePlanBuilder\(/);
  assert.match(app, /function showProcedureDetail\(/);
  assert.match(app, /function showProcedureAssessmentDetail\(/);
  assert.match(app, /function showProcedureDecisionDetail\(/);
  assert.match(app, /Share selected step with AI/);
  assert.match(app, /Share dry-run focus with AI/);
  assert.match(app, /physical_execution_enabled: false/);
  assert.match(css, /\.procedure-step-studio/);
  assert.match(css, /\.procedure-draft-graph/);
  assert.match(css, /\.procedure-gate-row/);
});
