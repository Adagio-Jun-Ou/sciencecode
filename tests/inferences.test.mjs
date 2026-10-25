import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendAudit,
  buildLabState,
  createChatSession,
  listInferences,
  listInteractions,
  npuRuntimePaths,
  runInference,
  runInferenceAsync,
  safeInit,
  sha256File,
  startLab,
  verifyInference,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PREFIX = 'SCIENCECODE_RESULT_JSON=';

function hardware() {
  return {
    available: true,
    backend: 'windows-ml',
    devices: [{
      index: 0,
      name: 'NPU Compute Accelerator Device',
      manufacturer: 'AMD',
      status: 'OK',
      service: 'IpuMcdmDriver',
      device_id: 'PCI\\VEN_1022&DEV_17F0',
      driver_version: '32.0.20102.3930'
    }],
    execution_provider: {
      name: 'VitisAIExecutionProvider',
      package_present: true,
      packages: [{ name: 'Microsoft.WinML.AMD.NPU.EP.2', version: '0.0.68.0' }]
    },
    error: null
  };
}

function runtime(home) {
  const paths = npuRuntimePaths({ scienceCodeHome: home, platform: 'win32' });
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, '');
  const manifest = {
    schema_version: 2,
    profile: 'npu',
    execution_provider: 'VitisAIExecutionProvider',
    packages: ['onnxruntime-windowsml==1.25.2.202605110140']
  };
  fs.writeFileSync(paths.manifest, JSON.stringify(manifest));
  return {
    installed: true,
    healthy: true,
    profile: 'npu',
    paths,
    manifest,
    probe: {
      ok: true,
      python: '3.11.9',
      onnxruntime_version: '1.25.2',
      registered_providers: ['CPUExecutionProvider', 'VitisAIExecutionProvider']
    },
    error: null
  };
}

function successfulRunner(command, args) {
  const outputIndex = args.indexOf('--output-dir');
  assert.notEqual(outputIndex, -1);
  const output = args[outputIndex + 1];
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'output-000.npy'), Buffer.from('npy-fixture'));
  fs.writeFileSync(path.join(output, 'outputs.json'), JSON.stringify({
    schema_version: 1,
    outputs: [{ name: 'score', dtype: 'float32', shape: [1], preview: [0.75] }]
  }));
  const profile = 'onnxruntime-profile.json';
  fs.writeFileSync(path.join(output, profile), JSON.stringify([{
    cat: 'Node',
    args: { provider: 'VitisAIExecutionProvider' }
  }]));
  const result = {
    schema_version: 1,
    ok: true,
    device_request: 'npu',
    selection_policy: 'prefer_npu',
    fallback_allowed: false,
    fallback_detected: false,
    provider_claim: 'verified_profiled_provider_execution',
    provider_attribution_method: 'onnxruntime_profile_provider_event',
    provider_profile_event_counts: { VitisAIExecutionProvider: 1 },
    npu_profile_event_count: 1,
    active_providers: ['VitisAIExecutionProvider', 'CPUExecutionProvider'],
    session_creation_ms: 125,
    warmup_iterations: 1,
    iterations: 3,
    latency_ms: { minimum: 0.8, maximum: 1.2, mean: 1, median: 1 },
    model_inputs: [{ name: 'input', type: 'tensor(float)', shape: [1, 2] }],
    model_outputs: [{ name: 'score', type: 'tensor(float)', shape: [1] }],
    outputs: [{
      name: 'score',
      file: 'output-000.npy',
      dtype: 'float32',
      shape: [1],
      elements: 1,
      preview: [0.75]
    }],
    profile_file: profile,
    runtime: {
      ok: true,
      registered_providers: ['CPUExecutionProvider', 'VitisAIExecutionProvider']
    },
    error: null
  };
  return {
    status: 0,
    stdout: 'provider log\n' + RESULT_PREFIX + JSON.stringify(result) + '\n',
    stderr: ''
  };
}

function projectFixture() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-inference-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-inference-home-'));
  safeInit(project);
  fs.writeFileSync(path.join(project, 'model.onnx'), Buffer.from('synthetic-onnx-model'));
  fs.writeFileSync(path.join(project, 'input.json'), JSON.stringify({
    inputs: { input: [[1, 2]] }
  }));
  return { project, home };
}

test('recorded NPU inference archives exact inputs and verifies provider attribution', () => {
  const { project, home } = projectFixture();
  const npuRuntime = runtime(home);
  npuRuntime.provider_library = 'C:\\Program Files\\WindowsApps\\' +
    'Microsoft.WinML.AMD.NPU.EP.2_0.0.68.0_x64__8wekyb3d8bbwe\\' +
    'ExecutionProvider\\onnxruntime_vitisai_ep.dll';
  const result = runInference({
    cwd: project,
    packageRoot,
    model: 'model.onnx',
    input: 'input.json',
    device: 'npu',
    env: { SCIENCECODE_HOME: home },
    scienceCodeHome: home,
    runtime: npuRuntime,
    npuProbe: hardware,
    runner(command, args) {
      assert.equal(command, npuRuntime.paths.python);
      assert.equal(args.includes('--allow-provider-download'), false);
      assert.equal(
        args[args.indexOf('--provider-library') + 1],
        npuRuntime.provider_library
      );
      return successfulRunner(command, args);
    }
  });
  assert.equal(result.manifest.status, 'completed');
  assert.equal(result.manifest.provider_verification.npu_executed, true);
  assert.equal(
    result.manifest.provider_verification.profile_event_counts.VitisAIExecutionProvider,
    1
  );
  assert.equal(
    result.manifest.provider_verification.attribution_method,
    'onnxruntime_profile_provider_event'
  );
  assert.equal(result.manifest.provider_verification.fallback_detected, false);
  assert.equal(verifyInference(project, result.manifest.inference_id).ok, true);
  assert.equal(listInferences(project)[0].npu_executed, true);
  assert.equal(verifyProject(project).ok, true);

  const state = buildLabState({
    cwd: project,
    env: { SCIENCECODE_HOME: home },
    computeProvider: () => ({
      ok: true,
      gpu: { available: false, devices: [] },
      npu: hardware(),
      runtime: { healthy: false },
      runtimes: { gpu: { healthy: false }, npu: npuRuntime },
      capabilities: {
        npu_onnx_inference: {
          ready: true,
          execution_provider: 'VitisAIExecutionProvider'
        }
      }
    }),
    kernelProvider: { list: () => [] }
  });
  assert.equal(state.counts.inferences, 1);
  assert.equal(state.counts.npu_verified_inferences, 1);
  assert.equal(state.inferences[0].provider_verification.npu_executed, true);
  assert.ok(state.inferences[0].artifacts.some((artifact) =>
    artifact.url.includes('/inference-artifact/')));

  const outputFile = path.join(result.runDirectory, 'artifacts', 'output-000.npy');
  fs.appendFileSync(outputFile, 'tamper');
  const tampered = verifyInference(project, result.manifest.inference_id);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) =>
    error.file === 'artifacts/output-000.npy' && error.issue === 'hash_mismatch'));
});

test('asynchronous inference emits bounded lifecycle events and preserves the same verified record', async () => {
  const { project, home } = projectFixture();
  const npuRuntime = runtime(home);
  const events = [];
  const result = await runInferenceAsync({
    cwd: project,
    packageRoot,
    model: 'model.onnx',
    input: 'input.json',
    device: 'npu',
    env: { SCIENCECODE_HOME: home },
    scienceCodeHome: home,
    runtime: npuRuntime,
    npuProbe: hardware,
    async runner(command, args, options) {
      assert.equal(command, npuRuntime.paths.python);
      assert.ok(options.signal instanceof AbortSignal);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return successfulRunner(command, args);
    },
    signal: new AbortController().signal,
    onEvent(event) {
      events.push(event);
    }
  });
  assert.equal(result.manifest.status, 'completed');
  assert.equal(result.manifest_sha256.length, 64);
  assert.deepEqual(events.map((event) => event.type), [
    'inference.started',
    'inference.executing',
    'inference.finished'
  ]);
  assert.ok(events.every((event) =>
    event.inference_id === result.manifest.inference_id &&
    !('stdout' in event) &&
    !('stderr' in event)
  ));
  assert.equal(verifyInference(project, result.manifest.inference_id).ok, true);
});

test('asynchronous inference cancellation archives partial artifacts and fails the default outcome gate', async () => {
  const { project, home } = projectFixture();
  const npuRuntime = runtime(home);
  const controller = new AbortController();
  const events = [];
  const pending = runInferenceAsync({
    cwd: project,
    packageRoot,
    smoke: true,
    device: 'npu',
    env: { SCIENCECODE_HOME: home },
    scienceCodeHome: home,
    runtime: npuRuntime,
    npuProbe: hardware,
    async runner(command, args, options) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'partial-output.txt'), 'incomplete\n');
      await new Promise((resolve) => {
        if (options.signal.aborted) return resolve();
        options.signal.addEventListener('abort', resolve, { once: true });
      });
      return {
        status: null,
        signal: 'SIGTERM',
        stdout: 'partial worker output\n',
        stderr: '',
        error: Object.assign(new Error('Command cancelled.'), {
          name: 'AbortError',
          code: 'ABORT_ERR'
        }),
        aborted: true
      };
    },
    signal: controller.signal,
    onEvent(event) {
      events.push(event);
    }
  });
  controller.abort('test_user_requested');
  const result = await pending;
  assert.equal(result.manifest.status, 'cancelled');
  assert.equal(result.manifest.exit_code, null);
  assert.equal(result.manifest.cancellation.reason, 'test_user_requested');
  assert.equal(result.manifest.provider_verification.npu_executed, false);
  assert.equal(result.manifest.artifacts['artifacts/partial-output.txt'].bytes, 11);
  assert.equal(events.at(-1).type, 'inference.finished');
  assert.equal(events.at(-1).status, 'cancelled');
  assert.equal(verifyInference(project, result.manifest.inference_id).ok, true);
  assert.equal(verifyProject(project).ok, false);
  assert.equal(verifyProject(project, { allowFailedInferences: true }).ok, true);
});

test('Lab launches, monitors, links, serializes, and cancels recorded NPU inference jobs', async (context) => {
  const { project, home } = projectFixture();
  const npuRuntime = runtime(home);
  const chat = createChatSession({
    cwd: project,
    title: 'NPU candidate scoring',
    agent: 'scientist'
  });
  let releaseSuccessfulWorker;
  const successfulWorkerGate = new Promise((resolve) => {
    releaseSuccessfulWorker = resolve;
  });
  let dispatches = 0;
  const inferenceProvider = {
    run(options) {
      const dispatch = ++dispatches;
      return runInferenceAsync({
        ...options,
        scienceCodeHome: home,
        runtime: npuRuntime,
        npuProbe: hardware,
        async runner(command, args, workerOptions) {
          if (dispatch === 1) {
            await successfulWorkerGate;
            return successfulRunner(command, args);
          }
          const output = args[args.indexOf('--output-dir') + 1];
          fs.writeFileSync(path.join(output, 'partial-output.txt'), 'cancelled partial output\n');
          await new Promise((resolve) => {
            if (workerOptions.signal.aborted) return resolve();
            workerOptions.signal.addEventListener('abort', resolve, { once: true });
          });
          return {
            status: null,
            signal: 'SIGTERM',
            stdout: 'partial worker output\n',
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
  const compute = {
    ok: true,
    gpu: { available: false, devices: [] },
    npu: hardware(),
    runtime: { healthy: false },
    runtimes: { gpu: { healthy: false }, npu: npuRuntime },
    capabilities: {
      npu_onnx_inference: {
        ready: true,
        execution_provider: 'VitisAIExecutionProvider'
      }
    }
  };
  const launched = startLab({
    cwd: project,
    packageRoot,
    env: { ...process.env, SCIENCECODE_HOME: home },
    port: 0,
    computeProvider: () => compute,
    inferenceProvider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const mutate = (pathname, body, origin = details.url) => fetch(details.url + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Prefer: 'respond-async'
    },
    body: JSON.stringify(body)
  });
  const readJob = async (jobId) => {
    const response = await fetch(details.url + '/api/jobs/' + encodeURIComponent(jobId));
    assert.equal(response.status, 200);
    return response.json();
  };
  const waitFor = async (jobId, statuses) => {
    let job;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      job = await readJob(jobId);
      if (statuses.includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('inference job did not reach ' + statuses.join(' or ') + ': ' + job?.status);
  };
  const request = {
    mode: 'run',
    model: 'model.onnx',
    input: 'input.json',
    device: 'npu',
    allow_fallback: false,
    warmup_iterations: 1,
    iterations: 3,
    timeout_seconds: 60,
    chat_id: chat.manifest.chat_id,
    note: 'Compare the verified NPU scores with the scientific acceptance criteria.'
  };

  const crossOrigin = await mutate('/api/inferences', request, 'https://untrusted.example');
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, 'UNTRUSTED_CHAT_ORIGIN');
  const unknownField = await mutate('/api/inferences', { ...request, command: 'arbitrary' });
  assert.equal(unknownField.status, 400);
  assert.equal((await unknownField.json()).error.code, 'INVALID_INFERENCE_REQUEST');
  const confusedField = await mutate('/api/inferences', {
    mode: 'smoke',
    device: 'npu',
    model: { path: 'model.onnx' }
  });
  assert.equal(confusedField.status, 400);
  assert.equal((await confusedField.json()).error.code, 'INVALID_INFERENCE_REQUEST');

  const launchResponse = await mutate('/api/inferences', request);
  assert.equal(launchResponse.status, 202);
  const launchedJob = await launchResponse.json();
  assert.equal(launchedJob.kind, 'inference');
  assert.equal(launchedJob.chat_id, chat.manifest.chat_id);
  assert.equal(launchedJob.response, null);
  assert.equal(launchedJob.request.device, 'npu');
  assert.equal('note' in launchedJob.request, false);
  const running = await waitFor(launchedJob.job_id, ['running']);
  assert.ok(running.inference_id);
  assert.ok(running.events.some((event) => event.type === 'inference.started'));
  const activeState = await (await fetch(details.url + '/api/state')).json();
  assert.equal(activeState.inference_jobs.length, 1);
  assert.equal(activeState.inference_jobs[0].job_id, launchedJob.job_id);

  const competing = await mutate('/api/inferences', {
    mode: 'smoke',
    device: 'npu',
    iterations: 1
  });
  assert.equal(competing.status, 409);
  assert.equal((await competing.json()).error.code, 'INFERENCE_BUSY');

  releaseSuccessfulWorker();
  const completed = await waitFor(launchedJob.job_id, ['completed']);
  assert.equal(completed.result.npu_executed, true);
  assert.equal(completed.result.fallback_detected, false);
  assert.equal(completed.result.manifest_sha256.length, 64);
  assert.ok(completed.interaction_id);
  assert.equal(completed.events.filter((event) =>
    event.type === 'inference.finished').length, 1);
  const completedDetail = await (await fetch(
    details.url + '/api/inferences/' + encodeURIComponent(completed.inference_id)
  )).json();
  assert.equal(completedDetail.manifest.status, 'completed');
  assert.equal(completedDetail.verification.ok, true);
  assert.equal(verifyProject(project).ok, true);
  const completedInteractions = listInteractions(project, chat.manifest.chat_id);
  assert.equal(completedInteractions.length, 1);
  assert.equal(completedInteractions[0].surface, 'inference');
  assert.equal(completedInteractions[0].action, 'run.completed');
  assert.equal(completedInteractions[0].artifact.record_id, completed.inference_id);

  const cancelLaunchResponse = await mutate('/api/inferences', {
    mode: 'smoke',
    device: 'npu',
    allow_fallback: false,
    iterations: 2,
    timeout_seconds: 60,
    chat_id: chat.manifest.chat_id
  });
  assert.equal(cancelLaunchResponse.status, 202);
  const cancelLaunch = await cancelLaunchResponse.json();
  const cancelRunning = await waitFor(cancelLaunch.job_id, ['running']);
  assert.ok(cancelRunning.inference_id);
  const cancelPath = '/api/jobs/' + encodeURIComponent(cancelLaunch.job_id) + '/cancel';
  const mismatchedCancel = await mutate(cancelPath, {
    kind: 'inference',
    chat_id: 'chat-wrong'
  });
  assert.equal(mismatchedCancel.status, 409);
  assert.equal((await mismatchedCancel.json()).error.code, 'JOB_BINDING_MISMATCH');
  const cancelResponse = await mutate(cancelPath, {
    kind: 'inference',
    chat_id: chat.manifest.chat_id
  });
  assert.equal(cancelResponse.status, 202);
  const cancelling = await cancelResponse.json();
  assert.equal(cancelling.status, 'cancelling');
  assert.ok(cancelling.cancellation_interaction_id);
  const cancelled = await waitFor(cancelLaunch.job_id, ['cancelled']);
  assert.equal(cancelled.result.status, 'cancelled');
  assert.equal(cancelled.result.npu_executed, false);
  assert.ok(cancelled.cancelled_at);
  assert.ok(cancelled.events.some((event) => event.type === 'inference.cancel_requested'));
  assert.ok(cancelled.events.some((event) =>
    event.type === 'inference.finished' && event.status === 'cancelled'
  ));
  const cancelledDetail = await (await fetch(
    details.url + '/api/inferences/' + encodeURIComponent(cancelled.inference_id)
  )).json();
  assert.equal(cancelledDetail.verification.ok, true);
  assert.equal(cancelledDetail.manifest.artifacts['artifacts/partial-output.txt'].bytes, 25);
  const interactions = listInteractions(project, chat.manifest.chat_id);
  assert.equal(interactions.length, 2);
  assert.ok(interactions.some((interaction) => interaction.action === 'run.cancel_requested'));
  const lineage = await (await fetch(
    details.url + '/api/lineage?chat=' + encodeURIComponent(chat.manifest.chat_id)
  )).json();
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'inference' && node.record_id === completed.inference_id
  ));
  assert.ok(lineage.edges.some((edge) => edge.relation === 'revised_as'));
  const gated = verifyProject(project);
  assert.equal(gated.ok, false);
  assert.equal(gated.counts.cancelled_inferences, 1);
  assert.ok(gated.errors.some((error) => error.issue === 'failed_inferences'));
  assert.equal(verifyProject(project, { allowFailedInferences: true }).ok, true);
  const finalState = await (await fetch(details.url + '/api/state')).json();
  assert.equal(finalState.counts.cancelled_inferences, 1);
  assert.equal(finalState.inference_jobs.length, 0);
  assert.equal(finalState.harness.running_jobs, 0);
});

test('inference sources reject project junction or symlink escapes before creating records', (context) => {
  const { project } = projectFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-inference-outside-'));
  fs.writeFileSync(path.join(outside, 'outside.onnx'), 'outside model');
  fs.writeFileSync(path.join(outside, 'outside.json'), '{"inputs":{"x":[1]}}');
  const link = path.join(project, 'linked-outside');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('filesystem links are unavailable in this environment');
      return;
    }
    throw error;
  }
  assert.throws(() => runInference({
    cwd: project,
    packageRoot,
    model: 'linked-outside/outside.onnx',
    input: 'input.json'
  }), (error) => error.code === 'PATH_OUTSIDE_ROOT');
  assert.throws(() => runInference({
    cwd: project,
    packageRoot,
    model: 'model.onnx',
    input: 'linked-outside/outside.json'
  }), (error) => error.code === 'PATH_OUTSIDE_ROOT');
  assert.equal(listInferences(project).length, 0);
});

test('schema-v1 NPU archives retain backward provider-attribution verification', () => {
  const { project } = projectFixture();
  const inferenceId = 'legacy-v1-inference';
  const directory = path.join(project, '.sciencecode', 'inferences', inferenceId);
  fs.mkdirSync(directory, { recursive: true });
  const manifest = {
    schema_version: 1,
    sciencecode_version: '0.15.0',
    inference_id: inferenceId,
    started_at: '2026-08-10T12:00:00.000Z',
    finished_at: '2026-08-10T12:00:01.000Z',
    status: 'completed',
    kind: 'hardware_smoke',
    device_request: 'npu',
    provider_verification: {
      requested: 'npu',
      required_provider: 'VitisAIExecutionProvider',
      npu_executed: true,
      node_counts: { VitisAIExecutionProvider: 2 },
      fallback_detected: false,
      claim: 'verified_node_execution'
    },
    artifacts: {}
  };
  const manifestFile = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const manifestHash = sha256File(manifestFile);
  fs.writeFileSync(path.join(directory, 'manifest.sha256'), manifestHash + '\n');
  appendAudit(project, {
    type: 'inference.finished',
    inference_id: inferenceId,
    status: 'completed',
    npu_executed: true,
    manifest_sha256: manifestHash
  });
  const verification = verifyInference(project, inferenceId);
  assert.equal(verification.ok, true);
  assert.equal(verification.manifest.schema_version, 1);
});

test('strict NPU request records and gates an unverified fallback', () => {
  const { project, home } = projectFixture();
  const npuRuntime = runtime(home);
  const result = runInference({
    cwd: project,
    packageRoot,
    model: 'model.onnx',
    input: 'input.json',
    device: 'npu',
    env: { SCIENCECODE_HOME: home },
    scienceCodeHome: home,
    runtime: npuRuntime,
    npuProbe: hardware,
    runner(command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'outputs.json'), JSON.stringify({ outputs: [] }));
      return {
        status: 3,
        stdout: RESULT_PREFIX + JSON.stringify({
          schema_version: 2,
          ok: false,
          device_request: 'npu',
          fallback_allowed: false,
          fallback_detected: true,
          provider_claim: 'verified_profiled_provider_execution',
          provider_attribution_method: 'onnxruntime_profile_provider_event',
          provider_profile_event_counts: { CPUExecutionProvider: 1 },
          npu_profile_event_count: 0,
          active_providers: ['CPUExecutionProvider'],
          outputs: [],
          error: 'npu_execution_not_verified'
        }) + '\n',
        stderr: ''
      };
    }
  });
  assert.equal(result.manifest.status, 'failed');
  assert.equal(result.manifest.provider_verification.npu_executed, false);
  assert.equal(result.manifest.provider_verification.fallback_detected, true);
  assert.equal(verifyInference(project, result.manifest.inference_id).ok, true);
  const blocked = verifyProject(project);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((error) => error.issue === 'failed_inferences'));
  assert.equal(verifyProject(project, { allowFailedInferences: true }).ok, true);
});

test('Lab assets expose dual accelerators and the inference workspace', () => {
  const index = fs.readFileSync(path.join(packageRoot, 'lab', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(packageRoot, 'lab', 'app.js'), 'utf8');
  assert.match(index, /data-view="inferences"/);
  assert.match(index, /id="inference-count"/);
  assert.match(app, /Dual-accelerator research stack/);
  assert.match(app, /VitisAIExecutionProvider/);
  assert.match(app, /showInferenceDetail/);
  assert.match(app, /fallback_detected/);
  assert.match(app, /renderInferenceLauncher/);
  assert.match(app, /Strict NPU \/ no silent fallback/);
  assert.match(app, /saveInteraction|AI-visible direction/);
  const styles = fs.readFileSync(path.join(packageRoot, 'lab', 'styles.css'), 'utf8');
  assert.match(styles, /\.inference-launcher/);
  assert.match(styles, /\.inference-events/);
});
