import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCadProject,
  buildExperimentBranches,
  buildLineageGraph,
  createCadProject,
  getExperimentManifest,
  getSimulationManifest,
  listExperiments,
  parseExperimentSeeds,
  parseExperimentVariation,
  readAuditRecords,
  runExperiment,
  runExperimentAsync,
  verifyExperiment,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: {
      schema_version: 1,
      packages: ['torch==2.12.0+cu130', 'numpy==2.3.5']
    },
    probe: {
      python: '3.11.9',
      torch: {
        version: '2.12.0+cu130',
        cuda_runtime: '13.0',
        cuda_available: true
      }
    }
  };
}

function gpu() {
  return {
    available: true,
    backend: 'nvidia',
    executable: 'nvidia-smi',
    devices: [{
      index: 0,
      name: 'NVIDIA GeForce RTX 4090',
      uuid: 'GPU-test',
      memory_total_mib: 16311,
      memory_free_mib: 15000,
      driver_version: '610.47',
      compute_capability: '12.0'
    }],
    error: null
  };
}

function triangleStl() {
  return [
    'solid triangle',
    ' facet normal 0 0 1',
    '  outer loop',
    '   vertex 0 0 0',
    '   vertex 20 0 0',
    '   vertex 0 20 0',
    '  endloop',
    ' endfacet',
    'endsolid triangle',
    ''
  ].join('\n');
}

test('experiment matrix records, reviews, links, verifies, and detects tampering', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-experiment-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("experiment")\n');
  const result = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    name: 'Dose response',
    hypothesis: 'Increasing alpha changes the synthetic estimate.',
    seeds: [2, 1],
    device: 'cuda',
    timeoutMs: 10_000,
    parameters: { steps: 5 },
    variations: { alpha: [0.1, 0.2] },
    runtime: runtime(),
    gpuProbe: gpu,
    runner(command, args, options) {
      const output = args[args.indexOf('--output-dir') + 1];
      const seed = Number(args[args.indexOf('--seed') + 1]);
      const parameters = JSON.parse(args[args.indexOf('--parameters-json') + 1]);
      assert.match(options.env.SCIENCECODE_EXPERIMENT_ID, /^[A-Za-z0-9._-]+$/);
      assert.match(options.env.SCIENCECODE_EXPERIMENT_BRANCH_INDEX, /^\d+$/);
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        seed,
        device: {
          selected: 'cuda:0',
          name: 'NVIDIA GeForce RTX 4090',
          peak_memory_bytes: 1048576
        }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        model: 'Synthetic matrix',
        final_statistics: {
          estimate: seed + parameters.alpha,
          finite: 1
        }
      }));
      fs.writeFileSync(path.join(output, 'result.csv'), 'estimate\n' + (seed + parameters.alpha) + '\n');
      return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
    }
  });

  assert.equal(result.manifest.status, 'completed');
  assert.deepEqual(result.manifest.counts, {
    planned: 4,
    executed: 4,
    completed: 4,
    verified: 4
  });
  assert.equal(result.review.verdict, 'pass');
  assert.equal(result.review.numeric_aggregates.estimate.count, 4);
  assert.equal(result.results[0].seed, 1);
  assert.equal(result.results[0].parameters.alpha, 0.1);
  assert.equal(result.results[3].seed, 2);
  assert.equal(result.results[3].parameters.alpha, 0.2);

  const experimentId = result.manifest.experiment_id;
  assert.equal(listExperiments(directory)[0].experiment_id, experimentId);
  assert.equal(getExperimentManifest(directory, experimentId).review.verdict, 'pass');
  assert.equal(verifyExperiment(directory, experimentId).ok, true);
  assert.equal(verifyProject(directory).ok, true);
  for (const link of result.manifest.simulations) {
    const simulation = getSimulationManifest(directory, link.simulation_id);
    assert.equal(simulation.experiment.experiment_id, experimentId);
    assert.equal(simulation.experiment.branch_index, link.branch_index);
    assert.equal(simulation.seed, link.seed);
  }
  assert.deepEqual(readAuditRecords(directory).map((record) => record.type), [
    'experiment.started',
    'simulation.started',
    'simulation.finished',
    'simulation.started',
    'simulation.finished',
    'simulation.started',
    'simulation.finished',
    'simulation.started',
    'simulation.finished',
    'experiment.finished'
  ]);

  fs.appendFileSync(path.join(result.experimentDirectory, 'review.json'), '\n');
  const verification = verifyExperiment(directory, experimentId);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) =>
    error.file === 'review.json' && error.issue === 'hash_mismatch'
  ));
});

test('experiment sources reject project junction or symlink escapes before creating records', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-experiment-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-experiment-outside-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("inside")\n');
  fs.writeFileSync(path.join(directory, 'input.csv'), 'x\n1\n');
  fs.writeFileSync(path.join(outside, 'outside.py'), 'print("outside")\n');
  fs.writeFileSync(path.join(outside, 'outside.csv'), 'x\n2\n');
  try {
    fs.symlinkSync(
      outside,
      path.join(directory, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Filesystem links are unavailable in this environment.');
      return;
    }
    throw error;
  }

  assert.throws(() => runExperiment({
    cwd: directory,
    packageRoot,
    script: 'linked-outside/outside.py',
    runtime: runtime()
  }), (error) => error.code === 'PATH_OUTSIDE_ROOT');
  assert.throws(() => runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    inputs: ['linked-outside/outside.csv'],
    runtime: runtime()
  }), (error) => error.code === 'PATH_OUTSIDE_ROOT');
  assert.equal(listExperiments(directory).length, 0);
});

test('CAD parameter study binds every branch to one verified mesh and aggregates nested thermal outcomes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-study-'));
  fs.writeFileSync(path.join(directory, 'thermal.py'), 'print("thermal study")\n');
  const project = createCadProject({ cwd: directory });
  const build = buildCadProject({
    cwd: directory,
    cadProjectId: project.descriptor.cad_project_id,
    toolchain: {
      openscad: { available: true, path: process.execPath, version: 'OpenSCAD test' },
      slicer: { available: true, engine: 'PrusaSlicer', path: process.execPath, version: 'PrusaSlicer test' },
      policies: { printer_transmission: 'disabled', slicer_post_process: 'disabled' }
    },
    runner(command, args) {
      const output = args[args.indexOf('-o') + 1];
      const summary = args[args.indexOf('--summary-file') + 1];
      fs.writeFileSync(output, triangleStl());
      fs.writeFileSync(summary, JSON.stringify({
        geometry: {
          bounding_box: { min: [0, 0, 0], max: [20, 20, 0], size: [20, 20, 0] },
          facets: 1,
          simple: false
        }
      }));
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
  const result = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'thermal.py',
    name: 'Verified mesh thermal sensitivity',
    hypothesis: 'The normalized surface diffusivity changes the final mean.',
    seeds: [23],
    device: 'cpu',
    parameters: { steps: 20 },
    variations: { thermal_diffusivity_mm2_s: [0.05, 0.1, 0.2] },
    cadBuildId: build.manifest.build_id,
    runtime: runtime(),
    gpuProbe: gpu,
    runner(command, args, options) {
      assert.equal(options.env.SCIENCECODE_CAD_BUILD_ID, build.manifest.build_id);
      assert.equal(options.env.SCIENCECODE_CAD_PROJECT_ID,
        project.descriptor.cad_project_id);
      assert.equal(fs.existsSync(options.env.SCIENCECODE_CAD_MESH_PATH), true);
      const output = args[args.indexOf('--output-dir') + 1];
      const parameters = JSON.parse(args[args.indexOf('--parameters-json') + 1]);
      const finalMean = 20 + parameters.thermal_diffusivity_mm2_s * 10;
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        seed: 23,
        device: { selected: 'cpu', name: 'CPU' }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        classification: 'surface_graph_heat_diffusion_not_volumetric_fea',
        final: { minimum_c: 20, mean_c: finalMean, maximum_c: 80 },
        integration: { last_maximum_delta_c: 0.001 }
      }));
      return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
    }
  });

  assert.equal(result.manifest.status, 'completed');
  assert.equal(result.manifest.cad_parent.build_id, build.manifest.build_id);
  assert.equal(result.manifest.counts.verified, 3);
  assert.equal(result.review.numeric_aggregates.final_mean_c.count, 3);
  assert.equal(result.review.numeric_aggregates.final_minimum_c.min, 20);
  assert.equal(result.review.numeric_aggregates.final_maximum_c.max, 80);
  for (const link of result.manifest.simulations) {
    const simulation = getSimulationManifest(directory, link.simulation_id);
    assert.deepEqual(simulation.cad_parent, result.manifest.cad_parent);
  }
  assert.equal(verifyExperiment(directory, result.manifest.experiment_id).ok, true);
  const finish = readAuditRecords(directory).findLast((record) =>
    record.type === 'experiment.finished');
  assert.equal(finish.cad_build_id, build.manifest.build_id);
  const lineage = buildLineageGraph(directory);
  assert.ok(lineage.edges.some((edge) =>
    edge.source === 'cad-build:' + build.manifest.build_id &&
    edge.target === 'experiment:' + result.manifest.experiment_id &&
    edge.relation === 'modeled_by' && edge.metadata?.study === true
  ));

  fs.appendFileSync(path.join(build.directory, 'assembly.stl'), 'tampered\n');
  const invalid = verifyExperiment(directory, result.manifest.experiment_id);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) =>
    ['cad_parent_invalid', 'simulation_invalid'].includes(error.issue)
  ));
});

test('experiment parsing is typed, deterministic, bounded, and secret preflight is fail-closed', () => {
  assert.deepEqual(parseExperimentSeeds('7,1,9'), [7, 1, 9]);
  assert.deepEqual(parseExperimentVariation('alpha=[0.1,0.2]'), ['alpha', [0.1, 0.2]]);
  assert.deepEqual(
    buildExperimentBranches({
      seeds: [9, 1],
      parameters: { fixed: true },
      variations: { beta: [2, 3], alpha: ['a', 'b'] }
    }).map((branch) => [branch.seed, branch.parameters.alpha, branch.parameters.beta]),
    [
      [1, 'a', 2],
      [1, 'a', 3],
      [1, 'b', 2],
      [1, 'b', 3],
      [9, 'a', 2],
      [9, 'a', 3],
      [9, 'b', 2],
      [9, 'b', 3]
    ]
  );
  assert.throws(() => parseExperimentSeeds('1,1'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseExperimentVariation('alpha=0.1'), { code: 'INVALID_ARGUMENT' });
  assert.throws(
    () => buildExperimentBranches({
      seeds: Array.from({ length: 9 }, (_, index) => index),
      variations: { alpha: Array.from({ length: 8 }, (_, index) => index) }
    }),
    { code: 'EXPERIMENT_TOO_LARGE' }
  );

  const unsafe = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-experiment-secret-'));
  fs.writeFileSync(path.join(unsafe, 'model.py'), 'print("safe")\n');
  assert.throws(
    () => runExperiment({
      cwd: unsafe,
      packageRoot,
      script: 'model.py',
      hypothesis: 'Use token=supersecretvalue123',
      runtime: runtime(),
      gpuProbe: gpu
    }),
    { code: 'SECRET_DETECTED' }
  );
  assert.equal(fs.existsSync(path.join(unsafe, '.sciencecode')), false);
});

test('asynchronous experiment cancellation preserves completed planning and partial branch evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-experiment-cancel-'));
  fs.writeFileSync(path.join(directory, 'slow-matrix.py'), 'print("slow matrix")\n');
  const controller = new AbortController();
  const branchEvents = [];
  let started = null;
  const result = await runExperimentAsync({
    cwd: directory,
    packageRoot,
    script: 'slow-matrix.py',
    name: 'Interruptible matrix',
    hypothesis: 'Partial branches remain evidence but cannot satisfy the matrix.',
    seeds: [1, 2, 3],
    device: 'cpu',
    timeoutMs: 10_000,
    runtime: runtime(),
    gpuProbe: gpu,
    signal: controller.signal,
    onStarted(value) {
      started = value;
    },
    onBranchStarted(value) {
      branchEvents.push(['started', value.branch_index]);
    },
    onBranchFinished(value) {
      branchEvents.push(['finished', value.branch_index, value.status]);
    },
    onSimulationStarted() {
      setImmediate(() => controller.abort('experiment_user_requested'));
    },
    async runner(command, args, options) {
      assert.equal(command, process.execPath);
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'partial.csv'), 'step,value\n1,0.5\n');
      if (!options.signal.aborted) {
        await new Promise((resolve) =>
          options.signal.addEventListener('abort', resolve, { once: true }));
      }
      return {
        status: null,
        signal: null,
        stdout: 'partial branch\n',
        stderr: '',
        error: Object.assign(new Error('Command cancelled.'), {
          name: 'AbortError',
          code: 'ABORT_ERR'
        }),
        aborted: true
      };
    }
  });

  assert.ok(started.experiment_id);
  assert.equal(result.manifest.experiment_id, started.experiment_id);
  assert.equal(result.manifest.status, 'cancelled');
  assert.equal(result.manifest.cancellation.reason, 'experiment_user_requested');
  assert.equal(result.manifest.cancellation.partial_branches_preserved, true);
  assert.deepEqual(result.results.map((branch) => branch.status), [
    'cancelled', 'not_run', 'not_run'
  ]);
  assert.equal(result.manifest.counts.planned, 3);
  assert.equal(result.manifest.counts.executed, 1);
  assert.equal(result.manifest.counts.completed, 0);
  assert.equal(result.manifest.counts.verified, 1);
  assert.deepEqual(branchEvents, [
    ['started', 0],
    ['finished', 0, 'cancelled'],
    ['finished', 1, 'not_run'],
    ['finished', 2, 'not_run']
  ]);
  assert.equal(verifyExperiment(directory, result.manifest.experiment_id).ok, true);
  const gated = verifyProject(directory);
  assert.equal(gated.ok, false);
  assert.equal(gated.counts.cancelled_experiments, 1);
  assert.equal(gated.counts.cancelled_simulations, 1);
  assert.equal(verifyProject(directory, {
    allowFailedSimulations: true,
    allowFailedExperiments: true
  }).ok, true);
});

test('failed experiment outcomes remain integrity-verifiable and are controlled by gate policy', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-experiment-failed-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("expected failure")\n');
  const result = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: runtime(),
    gpuProbe: gpu,
    runner(command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'failed',
        device: { selected: 'cuda:0', name: 'NVIDIA GeForce RTX 4090' }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        final_statistics: { partial_estimate: 0.5 }
      }));
      return { status: 1, stdout: '', stderr: 'expected numerical failure\n', signal: null };
    }
  });

  assert.equal(result.manifest.status, 'failed');
  assert.equal(result.review.verdict, 'fail');
  assert.equal(verifyExperiment(directory, result.manifest.experiment_id).ok, true);
  assert.equal(verifyProject(directory).ok, false);
  assert.equal(verifyProject(directory, {
    allowFailedSimulations: true,
    allowFailedExperiments: true
  }).ok, true);
});
