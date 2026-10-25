import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatSession,
  listInteractions,
  runExperimentAsync,
  runSimulationAsync,
  startLab,
  verifyExperiment,
  verifyProject,
  verifySimulation
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: ['numpy==2.3.5'] },
    probe: {
      python: '3.11.9',
      torch: { version: 'test', cuda_runtime: null, cuda_available: false }
    }
  };
}

function hardware() {
  return { available: false, backend: null, executable: null, devices: [], error: null };
}

function computeState(gpuRuntime) {
  return {
    ok: true,
    gpu: hardware(),
    npu: { available: false, devices: [], error: null },
    runtime: gpuRuntime,
    runtimes: { gpu: gpuRuntime, npu: null, cad: null },
    capabilities: {
      gpu_simulation: { ready: true },
      npu_onnx_inference: { ready: false }
    }
  };
}

async function waitForJob(baseUrl, jobId, statuses) {
  let job;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(baseUrl + '/api/jobs/' + encodeURIComponent(jobId));
    assert.equal(response.status, 200);
    job = await response.json();
    if (statuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('compute job did not reach ' + statuses.join(' or ') + ': ' + job?.status);
}

test('Lab launches, serializes, completes, cancels, and shares standalone scientific compute', async (context) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-compute-lab-'));
  fs.writeFileSync(path.join(project, 'model.py'), 'print("compute lab")\n');
  fs.writeFileSync(path.join(project, 'input.csv'), 'value\n1\n');
  const chat = createChatSession({ cwd: project, title: 'Compute review' });
  const gpuRuntime = runtime();
  let releaseSimulation;
  const simulationGate = new Promise((resolve) => { releaseSimulation = resolve; });
  const simulationProvider = {
    run(options) {
      return runSimulationAsync({
        ...options,
        runtime: gpuRuntime,
        gpuProbe: hardware,
        async runner(command, args) {
          assert.equal(command, process.execPath);
          const output = args[args.indexOf('--output-dir') + 1];
          fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
            status: 'completed',
            seed: Number(args[args.indexOf('--seed') + 1]),
            device: { selected: 'cpu', name: 'Test CPU' }
          }));
          fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
            model: 'Lab standalone simulation',
            final_statistics: { estimate: 1.5 }
          }));
          await simulationGate;
          return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
        }
      });
    }
  };
  const experimentProvider = {
    run(options) {
      return runExperimentAsync({
        ...options,
        runtime: gpuRuntime,
        gpuProbe: hardware,
        async runner(command, args, childOptions) {
          assert.equal(command, process.execPath);
          const output = args[args.indexOf('--output-dir') + 1];
          fs.writeFileSync(path.join(output, 'partial.csv'), 'step,value\n1,0.25\n');
          if (!childOptions.signal.aborted) {
            await new Promise((resolve) =>
              childOptions.signal.addEventListener('abort', resolve, { once: true }));
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
    }
  };
  const launched = startLab({
    cwd: project,
    packageRoot,
    port: 0,
    computeProvider: () => computeState(gpuRuntime),
    simulationProvider,
    experimentProvider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const computeAsset = await fetch(details.url + '/compute.js');
  assert.equal(computeAsset.status, 200);
  assert.match(computeAsset.headers.get('content-type') ?? '', /javascript/);
  assert.match(await computeAsset.text(), /renderScientificComputeWorkspace/);
  const mutate = (pathname, body, origin = details.url) => fetch(details.url + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Prefer: 'respond-async'
    },
    body: JSON.stringify(body)
  });
  const simulationRequest = {
    script: 'model.py',
    seed: 7,
    device: 'cpu',
    timeout_seconds: 60,
    parameters: { alpha: 1.5 },
    script_arguments: ['--mode', 'baseline'],
    inputs: ['input.csv'],
    chat_id: chat.manifest.chat_id,
    note: 'Compare this result with the planned experiment.'
  };

  const crossOrigin = await mutate(
    '/api/simulations', simulationRequest, 'https://untrusted.example'
  );
  assert.equal(crossOrigin.status, 403);
  const unknown = await mutate('/api/simulations', {
    ...simulationRequest,
    shell_command: 'arbitrary'
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'INVALID_SIMULATION_REQUEST');
  const invalidMatrix = await mutate('/api/experiments', {
    script: 'model.py',
    seeds: Array.from({ length: 65 }, (_, index) => index)
  });
  assert.equal(invalidMatrix.status, 400);
  assert.equal((await invalidMatrix.json()).error.code, 'INVALID_EXPERIMENT_REQUEST');

  const simulationLaunchResponse = await mutate('/api/simulations', simulationRequest);
  assert.equal(simulationLaunchResponse.status, 202);
  const simulationLaunch = await simulationLaunchResponse.json();
  assert.equal(simulationLaunch.kind, 'simulation');
  assert.deepEqual(simulationLaunch.request.parameter_names, ['alpha']);
  assert.equal('parameters' in simulationLaunch.request, false);
  assert.equal('note' in simulationLaunch.request, false);
  const simulationRunning = await waitForJob(
    details.url, simulationLaunch.job_id, ['running']
  );
  assert.ok(simulationRunning.simulation_id);
  const activeState = await (await fetch(details.url + '/api/state')).json();
  assert.equal(activeState.simulation_jobs.length, 1);
  assert.equal(activeState.simulation_jobs[0].job_id, simulationLaunch.job_id);

  const competing = await mutate('/api/experiments', {
    script: 'model.py',
    seeds: [1, 2]
  });
  assert.equal(competing.status, 409);
  assert.equal((await competing.json()).error.code, 'COMPUTE_JOB_BUSY');

  releaseSimulation();
  const simulationCompleted = await waitForJob(
    details.url, simulationLaunch.job_id, ['completed']
  );
  assert.equal(simulationCompleted.result.verification.ok, true);
  assert.ok(simulationCompleted.interaction_id);
  const simulationDetail = await (await fetch(
    details.url + '/api/simulations/' +
      encodeURIComponent(simulationCompleted.simulation_id)
  )).json();
  assert.equal(simulationDetail.manifest.status, 'completed');
  assert.equal(simulationDetail.verification.ok, true);
  assert.equal(verifySimulation(project, simulationCompleted.simulation_id).ok, true);

  const experimentRequest = {
    script: 'model.py',
    name: 'Lab matrix',
    hypothesis: 'The rate changes the recorded response.',
    seeds: [1, 2],
    device: 'cpu',
    timeout_seconds: 60,
    parameters: { baseline: true },
    variations: { rate: [0.1, 0.2] },
    script_arguments: [],
    inputs: ['input.csv'],
    chat_id: chat.manifest.chat_id,
    note: 'Retain every attempted branch and review the cancellation.'
  };
  const experimentLaunchResponse = await mutate('/api/experiments', experimentRequest);
  assert.equal(experimentLaunchResponse.status, 202);
  const experimentLaunch = await experimentLaunchResponse.json();
  assert.equal(experimentLaunch.kind, 'experiment');
  assert.equal(experimentLaunch.request.branch_count, 4);
  assert.deepEqual(experimentLaunch.request.variation_sizes, { rate: 2 });
  const experimentRunning = await waitForJob(
    details.url, experimentLaunch.job_id, ['running']
  );
  assert.ok(experimentRunning.experiment_id);
  const experimentState = await (await fetch(details.url + '/api/state')).json();
  assert.equal(experimentState.experiment_jobs.length, 1);

  const mismatchedCancel = await mutate(
    '/api/jobs/' + encodeURIComponent(experimentLaunch.job_id) + '/cancel',
    { kind: 'simulation', chat_id: chat.manifest.chat_id }
  );
  assert.equal(mismatchedCancel.status, 409);
  assert.equal((await mismatchedCancel.json()).error.code, 'JOB_BINDING_MISMATCH');
  const cancelResponse = await mutate(
    '/api/jobs/' + encodeURIComponent(experimentLaunch.job_id) + '/cancel',
    { kind: 'experiment', chat_id: chat.manifest.chat_id }
  );
  assert.equal(cancelResponse.status, 202);
  assert.equal((await cancelResponse.json()).status, 'cancelling');
  const experimentCancelled = await waitForJob(
    details.url, experimentLaunch.job_id, ['cancelled']
  );
  assert.ok(experimentCancelled.cancellation_interaction_id);
  assert.equal(experimentCancelled.result.verification.ok, true);
  const experimentDetail = await (await fetch(
    details.url + '/api/experiments/' +
      encodeURIComponent(experimentCancelled.experiment_id)
  )).json();
  assert.equal(experimentDetail.manifest.status, 'cancelled');
  assert.equal(experimentDetail.verification.ok, true);
  assert.deepEqual(experimentDetail.results.results.map((branch) => branch.status), [
    'cancelled', 'not_run', 'not_run', 'not_run'
  ]);
  assert.equal(verifyExperiment(project, experimentCancelled.experiment_id).ok, true);

  const interactions = listInteractions(project, chat.manifest.chat_id);
  assert.ok(interactions.some((interaction) =>
    interaction.surface === 'simulation' && interaction.action === 'run.completed'
  ));
  assert.ok(interactions.some((interaction) =>
    interaction.surface === 'experiment' && interaction.action === 'run.cancel_requested'
  ));
  const gate = verifyProject(project);
  assert.equal(gate.counts.cancelled_experiments, 1);
  assert.equal(gate.counts.cancelled_simulations, 1);
  const finalState = await (await fetch(details.url + '/api/state')).json();
  assert.equal(finalState.simulation_jobs.length, 0);
  assert.equal(finalState.experiment_jobs.length, 0);
  assert.equal(finalState.harness.running_jobs, 0);
});
