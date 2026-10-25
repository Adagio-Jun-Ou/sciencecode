import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  experimentBranchCount,
  parseExperimentSeedList,
  parseScientificJsonObject
} from '../lab/compute.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
const compute = fs.readFileSync(path.join(root, 'lab', 'compute.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'lab', 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'lib', 'lab.js'), 'utf8');

test('compute form parsers keep typed JSON and bounded matrix counts deterministic', () => {
  assert.deepEqual(parseScientificJsonObject('{"alpha":0.1,"enabled":true}'), {
    alpha: 0.1,
    enabled: true
  });
  assert.deepEqual(parseScientificJsonObject(''), {});
  assert.throws(() => parseScientificJsonObject('[1,2]'), /JSON object/);
  assert.throws(() => parseScientificJsonObject('{"bad name":1}'), /safe named/);
  assert.deepEqual(parseExperimentSeedList('7, 2, 11'), [7, 2, 11]);
  assert.throws(() => parseExperimentSeedList('1,1'), /unique/);
  assert.equal(experimentBranchCount([1, 2], {
    alpha: [0.1, 0.2],
    mode: ['a', 'b']
  }), 8);
  assert.throws(() => experimentBranchCount(
    Array.from({ length: 9 }, (_, index) => index),
    { alpha: Array.from({ length: 8 }, (_, index) => index) }
  ), /64 runs/);
});

test('simulation and experiment archives expose accessible responsive authoring contracts', () => {
  assert.match(app, /from '\/compute\.js'/);
  assert.match(app, /kind: 'simulation'/);
  assert.match(app, /kind: 'experiment'/);
  assert.match(app, /resumeScientificComputeJob/);
  assert.match(compute, /aria-label', experiment/);
  assert.match(compute, /workspace\.setAttribute\('aria-busy'/);
  assert.match(compute, /status\.setAttribute\('role', 'status'\)/);
  assert.match(compute, /status\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(compute, /Run recorded simulation/);
  assert.match(compute, /Run recorded experiment/);
  assert.match(compute, /Install exact template/);
  assert.match(compute, /Prospective analysis contract/);
  assert.match(compute, /Verified CAD parent/);
  assert.match(compute, /Declared input paths \/ one per line/);
  assert.match(compute, /Share the immutable outcome/);
  assert.match(compute, /note\.disabled = !selectedChat \|\| !share\.checked/);
  assert.match(compute, /note: ui\.share\.checked \? ui\.note\.value\.trim\(\) \|\| null : null/);
  assert.match(compute, /job\.kind === ui\.kind/);
  assert.match(compute, /\/api\/simulation-templates\//);
  assert.match(compute, /\/api\/jobs\/.*\/cancel/);
  assert.match(server, /'compute\.js'/);
  assert.match(server, /url\.pathname === '\/api\/simulations'/);
  assert.match(server, /url\.pathname === '\/api\/experiments'/);
  assert.match(styles, /\.compute-launcher/);
  assert.match(styles, /\.compute-template-band/);
  assert.match(styles, /\.compute-matrix-status/);
  const mobileStart = styles.indexOf('@media (max-width: 680px)');
  assert.ok(mobileStart >= 0);
  assert.match(styles.slice(mobileStart),
    /\.compute-template-band \{\s*grid-column: auto;\s*grid-template-columns: 1fr;/s);
});
