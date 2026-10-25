import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_GATE_POLICY_OPTIONS,
  projectGateIssueView,
  projectGateViewModel
} from '../lab/verification.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Verification Center view models preserve blocker categories and exact policy coverage', () => {
  assert.equal(PROJECT_GATE_POLICY_OPTIONS.length, 8);
  assert.deepEqual(new Set(PROJECT_GATE_POLICY_OPTIONS.map((option) => option.name)), new Set([
    'allow_failed_runs',
    'allow_failed_simulations',
    'allow_failed_cad_builds',
    'allow_failed_cad_slices',
    'allow_failed_inferences',
    'allow_failed_experiments',
    'allow_failed_kernel_cells',
    'allow_failed_campaign_tasks'
  ]));
  assert.deepEqual(projectGateViewModel({
    ok: false,
    summary: {
      blockers: 4,
      integrity_blockers: 3,
      outcome_blockers: 1,
      accepted_failed_outcomes: 2,
      returned_issues: 4,
      omitted_issues: 0,
      truncated: false
    }
  }), {
    ok: false,
    blockers: 4,
    integrity: 3,
    outcomes: 1,
    accepted: 2,
    returned: 4,
    omitted: 0,
    truncated: false,
    status: 'blocked'
  });
  const integrity = projectGateIssueView({
    title: 'Audit invalid',
    category: 'integrity',
    record: { run_id: 'run-1' },
    details: { issue: 'audit_invalid' }
  });
  assert.equal(integrity.categoryLabel, 'Integrity blocker');
  assert.match(integrity.identity, /run id run-1/);
  assert.match(integrity.details, /audit_invalid/);
  assert.equal(projectGateIssueView({ details: { large: true } }, {
    includeDetails: false
  }).details, null);
});

test('Verification Center source includes accessible policy, live status, cancellation, and bounded detail affordances', () => {
  const html = fs.readFileSync(path.join(root, 'lab', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
  const module = fs.readFileSync(path.join(root, 'lab', 'verification.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'lab', 'styles.css'), 'utf8');

  assert.match(html, /data-view="verification"/);
  assert.match(html, /id="verification-count"/);
  assert.match(app, /renderVerificationWorkspace/);
  assert.match(module, /create\('fieldset'\)/);
  assert.match(module, /create\('legend'/);
  assert.match(module, /aria-live', 'polite'/);
  assert.match(module, /aria-busy/);
  assert.match(module, /Cancel verification/);
  assert.match(module, /JSON\.stringify\(\{ kind: 'gate' \}\)/);
  assert.match(module, /Integrity is always enforced/);
  assert.match(module, /never waive integrity failures/);
  assert.match(module, /Exact bounded gate report/);
  assert.match(module, /detail_truncated/);
  assert.match(module, /includeDetails: false/);
  assert.match(module, /addEventListener\('toggle'/);
  assert.match(styles, /\.verification-workspace\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.verification-policy-grid/);
  assert.match(styles, /\.verification-issue\.integrity/);
  assert.match(styles, /\.verification-issue\.outcome/);
});
