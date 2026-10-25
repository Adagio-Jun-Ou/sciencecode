import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLineageGraph,
  computeStatus,
  createChatSession,
  initializeSimulationTemplate,
  listCadBuilds,
  resolveScienceCodeHome,
  startLab,
  verifyCadBuild,
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
    script: 'simulations/cad-mesh-validation.py',
    device: 'cpu',
    seed: 17,
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
    } else if (value === '--script') {
      options.script = argv[++index] ?? null;
    } else if (value === '--device') {
      options.device = argv[++index] ?? null;
    } else if (value === '--seed') {
      options.seed = Number(argv[++index]);
    } else if (value === '--timeout') {
      options.timeoutSeconds = Number(argv[++index]);
    } else if (value === '--home') {
      options.home = path.resolve(argv[++index] ?? '');
    } else if (value === '--minimum-free-gpu-mib') {
      options.minimumFreeGpuMib = Number(argv[++index]);
    } else {
      throw new Error('Unknown CAD model smoke option: ' + value);
    }
  }
  if (!options.project) {
    throw new Error(
      'Usage: npm run smoke:cad-model -- PROJECT [--build ID] [--script FILE] ' +
      '[--device cpu|cuda|cuda:N] [--home DIRECTORY]'
    );
  }
  if (!/^(?:cpu|cuda(?::\d+)?)$/.test(String(options.device ?? ''))) {
    throw new Error('--device must be cpu, cuda, or cuda:N.');
  }
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 ||
      options.seed > 0xffffffff) {
    throw new Error('--seed must be an integer from 0 through 4294967295.');
  }
  if (!Number.isSafeInteger(options.timeoutSeconds) ||
      options.timeoutSeconds < 1 || options.timeoutSeconds > 86_400) {
    throw new Error('--timeout must be an integer from 1 through 86400 seconds.');
  }
  if (!Number.isFinite(options.minimumFreeGpuMib) ||
      options.minimumFreeGpuMib < 0) {
    throw new Error('--minimum-free-gpu-mib must be a non-negative number.');
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
    assertion(response.ok, 'CAD model job polling failed with status ' + response.status);
    const job = await response.json();
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('CAD model job did not finish before the smoke timeout.');
}

const options = parseArguments(process.argv.slice(2));
assertion(
  fs.statSync(options.project, { throwIfNoEntry: false })?.isDirectory(),
  'CAD model smoke project directory does not exist: ' + options.project
);
const environment = {
  ...process.env,
  ...(options.home ? { SCIENCECODE_HOME: options.home } : {})
};
const scienceCodeHome = options.home ?? resolveScienceCodeHome(environment);
const compute = computeStatus({ env: environment, refresh: true });
assertion(compute.runtime?.healthy, 'ScienceCode compute runtime is not healthy.');
if (options.device.startsWith('cuda')) {
  const gpu = compute.gpu?.devices?.[0] ?? null;
  assertion(gpu, 'CUDA was requested but no NVIDIA GPU was detected.');
  assertion(
    Number(gpu.memory_free_mib) >= options.minimumFreeGpuMib,
    'CUDA smoke refused: only ' + String(gpu.memory_free_mib) +
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
assertion(build.ok, 'Selected CAD build failed integrity verification.');
assertion(build.manifest.status === 'completed',
  'Selected CAD build is not completed.');

const scriptFile = path.resolve(options.project, options.script);
if (!fs.statSync(scriptFile, { throwIfNoEntry: false })?.isFile()) {
  assertion(
    options.script.replace(/\\/g, '/') ===
      'simulations/cad-mesh-validation.py',
    'Model script does not exist: ' + options.script
  );
  initializeSimulationTemplate(options.project, 'cad-mesh-validation', {
    packageRoot,
    target: options.script
  });
}

const chat = createChatSession({
  cwd: options.project,
  title: 'CAD model live smoke',
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
  const response = await fetch(
    ready.url + '/api/cad/builds/' + encodeURIComponent(buildId) + '/models',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ready.url
      },
      body: JSON.stringify({
        script: options.script,
        device: options.device,
        seed: options.seed,
        parameters: {
          density_g_cm3: 1.24,
          precision: 'float64'
        },
        script_args: [],
        inputs: [],
        timeout_seconds: options.timeoutSeconds,
        chat_id: chat.manifest.chat_id,
        note: 'Real CAD-linked model smoke through the interactive Lab API.'
      })
    }
  );
  const launchedJob = await response.json();
  assertion(response.status === 202,
    'CAD model launch failed: ' + JSON.stringify(launchedJob));
  const job = await waitForJob(
    ready.url,
    launchedJob.job_id,
    (options.timeoutSeconds + 30) * 1_000
  );
  assertion(job.status === 'completed',
    'CAD model job failed: ' + JSON.stringify(job.error ?? job.result));
  assertion(job.simulation_id, 'CAD model job did not return a simulation ID.');
  const detailResponse = await fetch(
    ready.url + '/api/simulations/' + encodeURIComponent(job.simulation_id),
    { cache: 'no-store' }
  );
  assertion(detailResponse.ok,
    'Recorded model detail failed with status ' + detailResponse.status);
  const detail = await detailResponse.json();
  const state = await (await fetch(ready.url + '/api/state')).json();
  const lineage = buildLineageGraph(options.project);
  const verification = verifySimulation(options.project, job.simulation_id);
  const projectGate = verifyProject(options.project);
  assertion(verification.ok, 'Recorded CAD model failed verification.');
  assertion(lineage.edges.some((edge) =>
    edge.source === 'cad-build:' + buildId &&
    edge.target === 'simulation:' + job.simulation_id &&
    edge.relation === 'modeled_by'
  ), 'CAD build-to-model lineage edge is missing.');
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
    simulation_id: job.simulation_id,
    device_request: options.device,
    selected_device: detail.manifest?.context?.device?.selected ?? null,
    cad_parent: detail.manifest?.cad_parent ?? null,
    summary: detail.summary ?? null,
    artifacts: detail.manifest?.artifacts ?? {},
    verified: verification.ok,
    modeled_by_edges: lineage.edges.filter((edge) =>
      edge.source === 'cad-build:' + buildId &&
      edge.relation === 'modeled_by'
    ).length,
    lab_simulation_count: state.counts.simulations,
    gate: {
      ok: projectGate.ok,
      counts: projectGate.counts
    }
  }, null, 2) + '\n');
} catch (error) {
  await closeServer(launched?.server);
  process.stderr.write('ScienceCode CAD model live smoke failed: ' +
    error.stack + '\n');
  process.exitCode = 1;
}
