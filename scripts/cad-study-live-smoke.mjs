import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLineageGraph,
  computeStatus,
  createChatSession,
  interactionAwarePrompt,
  listCadBuilds,
  resolveScienceCodeHome,
  startLab,
  verifyCadBuild,
  verifyExperiment,
  verifyProject,
  verifySimulation
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    project: null,
    buildId: null,
    device: 'cpu',
    timeoutSeconds: 300,
    home: null,
    minimumFreeGpuMib: 2_048
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--') && !options.project) {
      options.project = path.resolve(value);
    } else if (value === '--build') {
      options.buildId = argv[++index] ?? null;
    } else if (value === '--device') {
      options.device = argv[++index] ?? null;
    } else if (value === '--timeout') {
      options.timeoutSeconds = Number(argv[++index]);
    } else if (value === '--home') {
      options.home = path.resolve(argv[++index] ?? '');
    } else if (value === '--minimum-free-gpu-mib') {
      options.minimumFreeGpuMib = Number(argv[++index]);
    } else {
      throw new Error('Unknown CAD study smoke option: ' + value);
    }
  }
  if (!options.project) {
    throw new Error(
      'Usage: npm run smoke:cad-study -- PROJECT [--build ID] ' +
      '[--device cpu|cuda|cuda:N] [--home DIRECTORY]'
    );
  }
  if (!/^(?:cpu|cuda(?::\d+)?)$/.test(String(options.device ?? ''))) {
    throw new Error('--device must be cpu, cuda, or cuda:N.');
  }
  if (!Number.isSafeInteger(options.timeoutSeconds) ||
      options.timeoutSeconds < 1 || options.timeoutSeconds > 86_400) {
    throw new Error('--timeout must be an integer from 1 through 86400 seconds.');
  }
  if (!Number.isSafeInteger(options.minimumFreeGpuMib) ||
      options.minimumFreeGpuMib < 256 || options.minimumFreeGpuMib > 16_384) {
    throw new Error('--minimum-free-gpu-mib must be from 256 through 16384.');
  }
  return options;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}

async function waitForJob(baseUrl, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      baseUrl + '/api/jobs/' + encodeURIComponent(jobId),
      { cache: 'no-store' }
    );
    assertion(response.ok, 'CAD study polling failed with status ' + response.status);
    const job = await response.json();
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('CAD study did not finish before the smoke timeout.');
}

const options = parseArguments(process.argv.slice(2));
assertion(
  fs.statSync(options.project, { throwIfNoEntry: false })?.isDirectory(),
  'CAD study smoke project does not exist: ' + options.project
);
const environment = {
  ...process.env,
  ...(options.home ? { SCIENCECODE_HOME: options.home } : {})
};
const scienceCodeHome = options.home ?? resolveScienceCodeHome(environment);
const compute = computeStatus({ env: environment, refresh: true });
assertion(compute.runtime?.healthy, 'ScienceCode GPU/science runtime is not healthy.');
assertion(compute.runtimes?.cad?.healthy, 'ScienceCode CAD runtime is not healthy.');
assertion(compute.runtimes?.npu?.healthy, 'ScienceCode NPU runtime is not healthy.');
if (options.device.startsWith('cuda')) {
  const requestedIndex = options.device.includes(':')
    ? Number(options.device.split(':')[1])
    : 0;
  const gpu = compute.gpu?.devices?.find((item) =>
    Number(item.index) === requestedIndex) ?? null;
  assertion(gpu, 'CUDA was requested but the selected NVIDIA GPU is unavailable.');
  assertion(
    Number(gpu.memory_free_mib) >= options.minimumFreeGpuMib,
    'CUDA study refused: only ' + String(gpu.memory_free_mib) +
      ' MiB is free; at least ' + String(options.minimumFreeGpuMib) +
      ' MiB is required.'
  );
}

const builds = listCadBuilds(options.project);
const buildId = options.buildId ??
  builds.find((candidate) =>
    candidate.status === 'completed' &&
    verifyCadBuild(options.project, candidate.build_id).ok
  )?.build_id;
assertion(buildId, 'No completed verified CAD build is available.');
const build = verifyCadBuild(options.project, buildId);
assertion(build.ok && build.manifest.status === 'completed',
  'Selected CAD build is not completed and verified.');

const chat = createChatSession({
  cwd: options.project,
  title: 'CAD comparative study live smoke',
  agent: 'cad-engineer'
});
let launched = null;
try {
  launched = startLab({
    cwd: options.project,
    packageRoot,
    env: environment,
    port: 0,
    computeProvider: () => compute
  });
  const ready = await launched.ready;
  const mutate = (pathname, body) => fetch(ready.url + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ready.url
    },
    body: JSON.stringify(body)
  });

  const templateResponse = await mutate(
    '/api/simulation-templates/cad-surface-heat',
    {
      chat_id: chat.manifest.chat_id,
      note: 'Install or verify the exact packaged CAD surface model for a study.'
    }
  );
  const template = await templateResponse.json();
  assertion([200, 201].includes(templateResponse.status),
    'CAD study template install failed: ' + JSON.stringify(template));

  const fixedParameters = {
    initial_temperature_c: 20,
    hot_temperature_c: 80,
    cold_temperature_c: 20,
    hot_face: 'x_min',
    cold_face: 'x_max',
    duration_s: 10,
    steps: 200,
    face_band_fraction: 0.02,
    precision: 'float64',
    history_frames: 50
  };
  const variations = {
    thermal_diffusivity_mm2_s: [0.05, 0.1, 0.2]
  };
  const studyResponse = await mutate(
    '/api/cad/builds/' + encodeURIComponent(buildId) + '/studies',
    {
      script: template.template.file,
      device: options.device,
      seeds: [23],
      parameters: fixedParameters,
      variations,
      script_args: [],
      inputs: [],
      name: 'Live CAD surface thermal sensitivity',
      hypothesis:
        'Changing normalized surface diffusivity changes the final mean field while fixed boundary extrema remain pinned.',
      minimum_free_gpu_mib: options.minimumFreeGpuMib,
      timeout_seconds: options.timeoutSeconds,
      chat_id: chat.manifest.chat_id,
      note: 'Run three bounded thermal branches against the exact verified mesh.'
    }
  );
  const launch = await studyResponse.json();
  assertion(studyResponse.status === 202,
    'CAD study launch failed: ' + JSON.stringify(launch));
  assertion(launch.operation === 'study' && launch.request.branch_count === 3 &&
    launch.can_cancel === true,
  'CAD study launch did not expose its planned branch count and stop contract.');
  const job = await waitForJob(
    ready.url,
    launch.job_id,
    (options.timeoutSeconds * 3 + 90) * 1_000
  );
  assertion(job.status === 'completed',
    'CAD study failed: ' + JSON.stringify(job.error ?? job.result));
  assertion(job.experiment_id, 'CAD study returned no experiment ID.');

  const detailResponse = await fetch(
    ready.url + '/api/experiments/' + encodeURIComponent(job.experiment_id),
    { cache: 'no-store' }
  );
  assertion(detailResponse.ok,
    'CAD study detail failed with status ' + detailResponse.status);
  const detail = await detailResponse.json();
  const manifest = detail.manifest;
  const results = detail.results?.results ?? [];
  assertion(manifest.cad_parent?.build_id === buildId,
    'CAD study is not bound to the selected immutable build.');
  assertion(manifest.counts?.planned === 3 && manifest.counts?.completed === 3 &&
    manifest.counts?.verified === 3,
  'CAD study branch counts are incomplete.');
  assertion(detail.review?.verdict === 'pass',
    'Deterministic CAD study reviewer did not pass.');
  assertion(detail.review?.numeric_aggregates?.final_mean_c?.count === 3,
    'CAD study did not aggregate all final mean values.');
  assertion(results.every((result) =>
    result.verified === true &&
    result.summary?.classification ===
      'surface_graph_heat_diffusion_not_volumetric_fea' &&
    result.summary?.checks?.finite === true &&
    result.summary?.checks?.hot_boundary_pinned === true &&
    result.summary?.checks?.cold_boundary_pinned === true &&
    result.summary?.checks?.maximum_principle === true &&
    Number.isFinite(result.final_statistics?.final_mean_c)
  ), 'One or more CAD thermal study branches failed model checks.');
  for (const result of results) {
    assertion(verifySimulation(options.project, result.simulation_id).ok,
      'CAD study child simulation failed verification: ' + result.simulation_id);
  }

  const shareResponse = await mutate(
    '/api/chats/' + encodeURIComponent(chat.manifest.chat_id) + '/interactions',
    {
      surface: 'cad',
      action: 'study.compared',
      artifact: {
        kind: 'experiment',
        record_id: job.experiment_id,
        name: manifest.name,
        url: '/api/experiments/' + encodeURIComponent(job.experiment_id)
      },
      payload: {
        cad_project_id: build.manifest.cad_project_id,
        build_id: buildId,
        experiment_id: job.experiment_id,
        status: manifest.status,
        planned_branches: manifest.counts.planned,
        completed_branches: manifest.counts.completed,
        verified_branches: manifest.counts.verified,
        review_verdict: detail.review.verdict,
        parameters_compared: Object.keys(variations),
        numeric_aggregates: detail.review.numeric_aggregates
      }
    }
  );
  assertion(shareResponse.status === 201,
    'CAD study AI-sharing interaction failed with status ' + shareResponse.status);
  const prompt = interactionAwarePrompt({
    cwd: options.project,
    chatId: chat.manifest.chat_id,
    message: 'Interpret the CAD parameter sensitivity I shared.'
  }).prompt;
  assertion(prompt.includes('comparative study ' + job.experiment_id),
    'The next AI turn did not receive the selected CAD study.');
  assertion(prompt.includes('3/3 branches, 3 verified, reviewer pass'),
    'The next AI turn did not receive verified CAD study branch counts.');
  assertion(prompt.includes('final_mean_c'),
    'The next AI turn did not receive CAD study aggregates.');

  const state = await (await fetch(ready.url + '/api/state')).json();
  const harness = await (await fetch(
    ready.url + '/api/chats/' + encodeURIComponent(chat.manifest.chat_id) +
      '/harness',
    { cache: 'no-store' }
  )).json();
  const verification = verifyExperiment(options.project, job.experiment_id);
  const lineage = buildLineageGraph(options.project);
  const projectGate = verifyProject(options.project);
  assertion(verification.ok, 'Recorded CAD study failed verification.');
  assertion(lineage.edges.some((edge) =>
    edge.source === 'cad-build:' + buildId &&
    edge.target === 'experiment:' + job.experiment_id &&
    edge.relation === 'modeled_by' &&
    edge.metadata?.study === true
  ), 'Direct CAD build-to-study lineage edge is missing.');
  assertion(harness.board?.cad?.parameter_studies?.some((record) =>
    record.experiment_id === job.experiment_id),
  'Harness design board did not expose the CAD parameter study.');
  assertion(harness.board?.validation?.verified_cad_parameter_studies >= 1,
    'Harness validation did not count the verified CAD study.');
  assertion(state.experiments?.some((record) =>
    record.experiment_id === job.experiment_id &&
    record.cad_parent?.build_id === buildId),
  'Lab state did not expose the CAD study parent.');
  assertion(projectGate.ok,
    'Whole-project gate failed: ' + JSON.stringify(projectGate.errors));

  await closeServer(launched.server);
  launched = null;
  process.stdout.write(JSON.stringify({
    ok: true,
    project: options.project,
    sciencecode_home: scienceCodeHome,
    lab_server_closed: true,
    build_id: buildId,
    experiment_id: job.experiment_id,
    device_request: options.device,
    branch_counts: manifest.counts,
    review_verdict: detail.review.verdict,
    numeric_aggregates: detail.review.numeric_aggregates,
    gpu: compute.gpu?.devices?.[0] ?? null,
    npu_ready: compute.capabilities?.npu_onnx_inference?.ready === true,
    cad_runtime_ready: compute.capabilities?.cadquery_parametric_cad?.ready === true,
    lineage_edge: true,
    ai_context: true,
    gate: {
      ok: projectGate.ok,
      counts: projectGate.counts
    }
  }, null, 2) + '\n');
} catch (error) {
  await closeServer(launched?.server);
  process.stderr.write('ScienceCode CAD study live smoke failed: ' +
    error.stack + '\n');
  process.exitCode = 1;
}
