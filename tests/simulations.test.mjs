import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCadProject,
  buildLineageGraph,
  createCadProject,
  initializeSimulationTemplate,
  listSimulations,
  parseSimulationParameter,
  readAuditRecords,
  runSimulation,
  runSimulationAsync,
  verifyProject,
  verifySimulation
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeRuntime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: {
      schema_version: 1,
      packages: ['torch==2.12.0', 'numpy==2.3.5']
    },
    probe: {
      python: '3.11.9',
      torch: {
        version: '2.12.0',
        cuda_runtime: '13.0',
        cuda_available: true
      }
    }
  };
}

function fakeGpu() {
  return {
    available: true,
    backend: 'nvidia',
    executable: 'nvidia-smi',
    devices: [{
      index: 0,
      name: 'NVIDIA GeForce RTX 4090',
      uuid: 'GPU-test',
      memory_total_mib: 16311,
      memory_free_mib: 12000,
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

test('recorded simulation archives source, runtime, outputs, GPU metadata, and audit links', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-simulation-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("simulating")\n');
  fs.writeFileSync(path.join(directory, 'input.csv'), 'x\n1\n');
  const result = runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    seed: 42,
    device: 'cuda',
    timeoutMs: 10_000,
    parameters: { particles: 1000, label: 'baseline' },
    inputs: ['input.csv'],
    scriptArgs: ['--replicate', 'A&B'],
    runtime: fakeRuntime(),
    gpuProbe: fakeGpu,
    runner(command, args, options) {
      assert.equal(command, process.execPath);
      assert.equal(options.env.PYTHONHASHSEED, '42');
      assert.equal(options.env.CUBLAS_WORKSPACE_CONFIG, ':4096:8');
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        device: { selected: 'cuda:0', name: 'NVIDIA GeForce RTX 4090' },
        seed: 42
      }));
      fs.writeFileSync(path.join(output, 'results.csv'), 'estimate\n0.125\n');
      return { status: 0, stdout: '{"estimate":0.125}\n', stderr: '', signal: null };
    }
  });

  assert.equal(result.manifest.status, 'completed');
  assert.equal(result.manifest.context.device.selected, 'cuda:0');
  assert.equal(result.manifest.seed, 42);
  assert.equal(result.manifest.inputs[0].path, 'input.csv');
  assert.ok(result.manifest.artifacts['artifacts/results.csv']);
  assert.ok(result.manifest.artifacts['artifacts/simulation-context.json']);
  assert.equal(verifySimulation(directory, result.manifest.simulation_id).ok, true);
  assert.equal(verifyProject(directory).ok, true);
  assert.deepEqual(readAuditRecords(directory).map((record) => record.type), [
    'simulation.started',
    'simulation.finished'
  ]);
  assert.deepEqual(listSimulations(directory).map((item) => item.device), ['cuda:0']);

  fs.appendFileSync(path.join(result.runDirectory, 'artifacts', 'results.csv'), 'tampered\n');
  const verification = verifySimulation(directory, result.manifest.simulation_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) =>
    error.file === 'artifacts/results.csv' && error.issue === 'hash_mismatch'
  ));
});

test('simulation sources reject project junction or symlink escapes before creating records', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-simulation-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-simulation-outside-'));
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

  assert.throws(() => runSimulation({
    cwd: directory,
    packageRoot,
    script: 'linked-outside/outside.py',
    runtime: fakeRuntime()
  }), (error) => error.code === 'PATH_OUTSIDE_ROOT');
  assert.throws(() => runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    inputs: ['linked-outside/outside.csv'],
    runtime: fakeRuntime()
  }), (error) => error.code === 'PATH_OUTSIDE_ROOT');
  assert.equal(listSimulations(directory).length, 0);
});

test('recorded CPU/GPU models bind to a verified immutable CAD mesh parent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-model-'));
  fs.writeFileSync(path.join(directory, 'cad-model.py'), 'print("cad model")\n');
  const project = createCadProject({ cwd: directory });
  const toolchain = {
    openscad: { available: true, path: process.execPath, version: 'OpenSCAD test' },
    slicer: { available: true, engine: 'PrusaSlicer', path: process.execPath, version: 'PrusaSlicer test' },
    policies: { printer_transmission: 'disabled', slicer_post_process: 'disabled' }
  };
  const build = buildCadProject({
    cwd: directory,
    cadProjectId: project.descriptor.cad_project_id,
    toolchain,
    runner(command, args) {
      const output = args[args.indexOf('-o') + 1];
      const summary = args[args.indexOf('--summary-file') + 1];
      fs.writeFileSync(output, triangleStl());
      fs.writeFileSync(summary, JSON.stringify({
        geometry: {
          bounding_box: {
            min: [0, 0, 0],
            max: [20, 20, 0],
            size: [20, 20, 0]
          },
          facets: 1,
          simple: false
        }
      }));
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
  const modeled = runSimulation({
    cwd: directory,
    packageRoot,
    script: 'cad-model.py',
    seed: 7,
    device: 'cuda',
    cadBuildId: build.manifest.build_id,
    runtime: fakeRuntime(),
    gpuProbe: fakeGpu,
    runner(command, args, options) {
      assert.equal(options.env.SCIENCECODE_CAD_BUILD_ID, build.manifest.build_id);
      assert.equal(
        fs.existsSync(options.env.SCIENCECODE_CAD_MESH_PATH),
        true
      );
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        device: { selected: 'cuda:0', name: 'NVIDIA GeForce RTX 4090' },
        seed: 7
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        model: 'CAD-linked test'
      }));
      return { status: 0, stdout: '{"status":"completed"}\n', stderr: '', signal: null };
    }
  });

  assert.equal(modeled.manifest.cad_parent.build_id, build.manifest.build_id);
  assert.equal(modeled.manifest.cad_parent.cad_project_id, project.descriptor.cad_project_id);
  assert.ok(modeled.manifest.inputs.some((input) =>
    input.path === modeled.manifest.cad_parent.mesh_path &&
    input.sha256 === modeled.manifest.cad_parent.mesh_sha256
  ));
  assert.equal(verifySimulation(directory, modeled.manifest.simulation_id).ok, true);
  const lineage = buildLineageGraph(directory);
  assert.ok(lineage.edges.some((edge) =>
    edge.relation === 'modeled_by' &&
    edge.source === 'cad-build:' + build.manifest.build_id &&
    edge.target === 'simulation:' + modeled.manifest.simulation_id
  ));

  fs.appendFileSync(path.join(build.directory, 'assembly.stl'), 'tampered\n');
  const invalid = verifySimulation(directory, modeled.manifest.simulation_id);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) =>
    ['input_drift', 'cad_parent_invalid', 'cad_parent_mesh_invalid'].includes(error.issue)
  ));
});

test('simulation parameter parser preserves JSON types and rejects unsafe names', () => {
  assert.deepEqual(parseSimulationParameter('particles=1000'), ['particles', 1000]);
  assert.deepEqual(parseSimulationParameter('enabled=true'), ['enabled', true]);
  assert.deepEqual(parseSimulationParameter('label=control arm'), ['label', 'control arm']);
  assert.throws(() => parseSimulationParameter('__proto__=1'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseSimulationParameter('missing-separator'), { code: 'INVALID_ARGUMENT' });
});

test('asynchronous simulation cancellation preserves a complete verifiable partial record', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-simulation-cancel-'));
  fs.writeFileSync(path.join(directory, 'slow-model.py'), 'print("slow model")\n');
  const controller = new AbortController();
  let started = null;
  const result = await runSimulationAsync({
    cwd: directory,
    packageRoot,
    script: 'slow-model.py',
    seed: 19,
    device: 'cpu',
    timeoutMs: 10_000,
    parameters: { phase: 'cancel-test' },
    runtime: fakeRuntime(),
    gpuProbe: fakeGpu,
    signal: controller.signal,
    onStarted(value) {
      started = value;
      setImmediate(() => controller.abort('test_user_requested'));
    },
    async runner(command, args, options) {
      assert.equal(command, process.execPath);
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'partial-results.csv'), 'step,value\n1,0.25\n');
      options.onStdout?.('partial model output\n');
      if (!options.signal.aborted) {
        await new Promise((resolve) =>
          options.signal.addEventListener('abort', resolve, { once: true }));
      }
      return {
        status: null,
        signal: null,
        stdout: 'partial model output\n',
        stderr: '',
        error: Object.assign(new Error('Command cancelled.'), {
          name: 'AbortError',
          code: 'ABORT_ERR'
        }),
        aborted: true
      };
    }
  });

  assert.ok(started.simulation_id);
  assert.equal(result.manifest.simulation_id, started.simulation_id);
  assert.equal(result.manifest.status, 'cancelled');
  assert.equal(result.manifest.cancellation.reason, 'test_user_requested');
  assert.equal(result.manifest.cancellation.partial_artifacts_preserved, true);
  assert.ok(result.manifest.artifacts['artifacts/partial-results.csv']);
  assert.equal(verifySimulation(directory, result.manifest.simulation_id).ok, true);
  const gated = verifyProject(directory);
  assert.equal(gated.ok, false);
  assert.equal(gated.counts.cancelled_simulations, 1);
  assert.ok(gated.errors.some((error) => error.issue === 'failed_simulations'));
  assert.equal(verifyProject(directory, { allowFailedSimulations: true }).ok, true);
});

test('simulation templates are additive and secret source preflight is fail-closed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-simulation-init-'));
  const initialized = initializeSimulationTemplate(directory, 'reaction-diffusion', { packageRoot });
  assert.equal(fs.existsSync(initialized.file), true);
  const cadTemplate = initializeSimulationTemplate(directory, 'cad-mesh-validation', {
    packageRoot
  });
  assert.equal(fs.existsSync(cadTemplate.file), true);
  const thermalTemplate = initializeSimulationTemplate(directory, 'cad-surface-heat', {
    packageRoot
  });
  assert.equal(thermalTemplate.created, true);
  assert.match(fs.readFileSync(thermalTemplate.file, 'utf8'),
    /surface_graph_heat_diffusion_not_volumetric_fea/);
  const reusedThermal = initializeSimulationTemplate(
    directory, 'cad-surface-heat', { packageRoot, reuseExact: true }
  );
  assert.equal(reusedThermal.created, false);
  assert.equal(reusedThermal.sha256, thermalTemplate.sha256);
  fs.appendFileSync(thermalTemplate.file, '# user-owned change\n');
  assert.throws(
    () => initializeSimulationTemplate(
      directory, 'cad-surface-heat', { packageRoot, reuseExact: true }
    ),
    { code: 'EEXIST' }
  );
  assert.throws(
    () => initializeSimulationTemplate(directory, 'reaction-diffusion', { packageRoot }),
    { code: 'EEXIST' }
  );

  const unsafeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-simulation-secret-'));
  fs.writeFileSync(path.join(unsafeDirectory, 'unsafe.py'), 'token="supersecretvalue123"\n');
  assert.throws(
    () => runSimulation({
      cwd: unsafeDirectory,
      packageRoot,
      script: 'unsafe.py',
      runtime: fakeRuntime(),
      gpuProbe: fakeGpu
    }),
    { code: 'SECRET_DETECTED' }
  );
  assert.equal(fs.existsSync(path.join(unsafeDirectory, '.sciencecode')), false);
});
