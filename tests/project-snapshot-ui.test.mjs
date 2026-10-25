import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  snapshotFindingView,
  snapshotReportViewModel
} from '../lab/reproducibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Reproducibility view models preserve exact drift and integrity categories', () => {
  assert.deepEqual(snapshotReportViewModel({
    ok: false,
    summary: {
      blockers: 6,
      integrity_blockers: 2,
      added: 1,
      modified: 1,
      missing: 1,
      unreadable: 1,
      omitted_findings: 3,
      truncated: true
    }
  }), {
    ok: false,
    blockers: 6,
    integrity: 2,
    added: 1,
    modified: 1,
    missing: 1,
    unreadable: 1,
    omitted: 3,
    truncated: true,
    status: 'drift'
  });
  const modified = snapshotFindingView({
    category: 'modified',
    file: 'results/data.csv',
    issue: 'hash_mismatch',
    detail_sha256: 'a'.repeat(64),
    details: { expected: 'a', actual: 'b' }
  });
  assert.equal(modified.categoryLabel, 'Modified file');
  assert.equal(modified.title, 'results/data.csv');
  assert.match(modified.details, /expected/);
  assert.equal(snapshotFindingView({ details: { large: true } }, {
    includeDetails: false
  }).details, null);
  assert.equal(snapshotFindingView({ category: 'unknown' }).category, 'integrity');
});

test('Reproducibility source includes accessible capture, strict verification, download, cancellation, and bounded disclosures', () => {
  const html = fs.readFileSync(path.join(root, 'lab', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
  const module = fs.readFileSync(path.join(root, 'lab', 'reproducibility.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'lab', 'styles.css'), 'utf8');

  assert.match(html, /data-view="reproducibility"/);
  assert.match(html, /id="snapshot-count"/);
  assert.match(app, /renderReproducibilityWorkspace/);
  assert.match(app, /project_snapshot_job/);
  assert.match(module, /create\('form', 'snapshot-controls'\)/);
  assert.match(module, /strict\.type = 'checkbox'/);
  assert.match(module, /aria-live', 'polite'/);
  assert.match(module, /aria-busy/);
  assert.match(module, /Capture current baseline/);
  assert.match(module, /Verify baseline/);
  assert.match(module, /Download exact JSON/);
  assert.match(module, /Cancel snapshot operation/);
  assert.match(module, /kind: 'snapshot'/);
  assert.match(module, /snapshot_id: currentJob\.snapshot_id/);
  assert.match(module, /operation: currentJob\.operation/);
  assert.match(module, /includeDetails: false/);
  assert.match(module, /addEventListener\('toggle'/);
  assert.match(module, /Exact bounded snapshot report/);
  assert.match(module, /omitted_findings/);
  assert.match(styles, /\.reproducibility-workspace\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.snapshot-overview,[\s\S]*\.snapshot-list/);
  assert.match(styles, /\.snapshot-finding\.integrity/);
  assert.match(styles, /\.snapshot-finding\.added/);
  assert.match(styles, /\.snapshot-finding\.modified/);
  assert.match(styles, /\.snapshot-finding\.missing/);
});
