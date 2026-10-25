import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeSimulationTemplate } from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = [
  'orbital-mechanics', 'chemical-kinetics', 'epidemic-seir',
  'molecular-dynamics', 'signal-analysis', 'dose-response'
];

function pythonWithScience() {
  for (const candidate of ['python', 'python3']) {
    const probe = spawnSync(candidate, ['-c', 'import numpy, scipy, matplotlib'], {
      encoding: 'utf8', windowsHide: true, timeout: 60_000
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

test('science simulation templates initialize with audited hashes and honest scope statements', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-science-templates-'));
  for (const name of TEMPLATES) {
    const initialized = initializeSimulationTemplate(directory, name, { packageRoot });
    assert.equal(initialized.created, true);
    const text = fs.readFileSync(initialized.file, 'utf8');
    assert.match(text,
      /solve_ivp|velocity Verlet|scipy import signal|from scipy import signal|least_squares/);
    assert.match(text, /final_statistics/);
    assert.match(text, /interpretation/);
    assert.match(text,
      /not modeled or claimed|not epidemiological realism|not physical realism|not chemical realism|not material or chemical realism|no claim about any real measurement|neither an affinity nor a dose/);
  }
});

test('science templates execute deterministically with tight fidelity diagnostics', (context) => {
  const python = pythonWithScience();
  if (!python) {
    context.skip('no local Python with numpy/scipy/matplotlib');
    return;
  }
  const thresholds = {
    'orbital-mechanics': { energy_drift: 1e-9, angular_momentum_drift: 1e-9 },
    'chemical-kinetics': { mass_conservation_drift: 1e-10, solver_disagreement: 1e-4 },
    'epidemic-seir': { population_drift: 1e-10, solver_disagreement: 1e-6 },
    'molecular-dynamics': {
      energy_drift: 1e-3, momentum_drift: 1e-10, time_reversal_error: 1e-6
    },
    'signal-analysis': {
      welch_frequency_error: 0.5, parseval_residual: 0.05
    },
    // Two structurally unrelated optimizers must land on the same potency, and
    // the estimator must recover the curve that generated the data.
    'dose-response': {
      solver_disagreement_log10: 1e-6, recovery_error_log10: 0.1
    }
  };
  const units = { welch_frequency_error: 'Hz' };
  for (const name of TEMPLATES) {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-science-run-'));
    const summaries = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const directory = path.join(output, 'run-' + repeat);
      fs.mkdirSync(directory);
      const run = spawnSync(python, [
        path.join(packageRoot, 'templates', 'simulations', name + '.py')
      ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 240_000,
        env: {
          ...process.env,
          SCIENCECODE_OUTPUT_DIR: directory,
          SCIENCECODE_SEED: '7',
          SCIENCECODE_PARAMETERS_JSON: '{}',
          MPLBACKEND: 'Agg'
        }
      });
      assert.equal(run.status, 0, name + ' failed: ' + run.stderr);
      summaries.push(JSON.parse(
        fs.readFileSync(path.join(directory, 'summary.json'), 'utf8')));
    }
    assert.deepEqual(summaries[0].final_statistics, summaries[1].final_statistics,
      name + ' final statistics must replay identically');
    for (const [statistic, bound] of Object.entries(thresholds[name])) {
      const observed = summaries[0].final_statistics[statistic];
      assert.equal(observed.unit, units[statistic] ?? '1');
      assert.ok(observed.value < bound,
        name + ' ' + statistic + '=' + observed.value + ' exceeds ' + bound);
    }
  }
});
