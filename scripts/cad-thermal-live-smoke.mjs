import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLineageGraph,
  computeStatus,
  createChatSession,
  interactionAwarePrompt,
  listCadBuilds,
  listInteractions,
  resolveScienceCodeHome,
  startLab,
  verifyCadBuild,
  verifyProject,
  verifySimulation
} from '../lib/core.js';
import { parseThreeD } from '../lab/geometry.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    project: null,
    buildId: null,
    device: 'cpu',
    seed: 23,
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
    } else if (value === '--seed') {
      options.seed = Number(argv[++index]);
    } else if (value === '--timeout') {
      options.timeoutSeconds = Number(argv[++index]);
    } else if (value === '--home') {
      options.home = path.resolve(argv[++index] ?? '');
    } else if (value === '--minimum-free-gpu-mib') {
      options.minimumFreeGpuMib = Number(argv[++index]);
    } else {
      throw new Error('Unknown CAD thermal smoke option: ' + value);
    }
  }
  if (!options.project) {
    throw new Error(
      'Usage: npm run smoke:cad-thermal -- PROJECT [--build ID] ' +
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
    throw new Error('--minimum-free-gpu-mib must be non-negative.');
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
    assertion(response.ok, 'Thermal model polling failed with status ' + response.status);
    const job = await response.json();
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('CAD thermal model did not finish before the smoke timeout.');
}

const options = parseArguments(process.argv.slice(2));
assertion(
  fs.statSync(options.project, { throwIfNoEntry: false })?.isDirectory(),
  'CAD thermal smoke project does not exist: ' + options.project
);
const environment = {
  ...process.env,
  ...(options.home ? { SCIENCECODE_HOME: options.home } : {})
};
const scienceCodeHome = options.home ?? resolveScienceCodeHome(environment);
const compute = computeStatus({ env: environment, refresh: true });
assertion(compute.runtime?.healthy, 'ScienceCode compute runtime is not healthy.');
if (options.device.startsWith('cuda')) {
  const requestedIndex = options.device.includes(':')
    ? Number(options.device.split(':')[1])
    : 0;
  const gpu = compute.gpu?.devices?.find((item) =>
    Number(item.index) === requestedIndex) ?? null;
  assertion(gpu, 'CUDA was requested but the selected NVIDIA GPU is unavailable.');
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

const chat = createChatSession({
  cwd: options.project,
  title: 'CAD surface thermal live smoke',
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
      note: 'Install or verify the exact packaged surface thermal model.'
    }
  );
  const template = await templateResponse.json();
  assertion(
    [200, 201].includes(templateResponse.status),
    'Thermal template install failed: ' + JSON.stringify(template)
  );
  assertion(template.template.file === 'simulations/cad-surface-heat.py',
    'Thermal template was installed at an unexpected path.');

  const modelResponse = await mutate(
    '/api/cad/builds/' + encodeURIComponent(buildId) + '/models',
    {
      script: template.template.file,
      device: options.device,
      seed: options.seed,
      parameters: {
        initial_temperature_c: 20,
        hot_temperature_c: 80,
        cold_temperature_c: 20,
        hot_face: 'x_min',
        cold_face: 'x_max',
        thermal_diffusivity_mm2_s: 0.1,
        duration_s: 10,
        steps: 200,
        face_band_fraction: 0.02,
        precision: 'float64',
        history_frames: 50
      },
      script_args: [],
      inputs: [],
      minimum_free_gpu_mib: options.minimumFreeGpuMib,
      timeout_seconds: options.timeoutSeconds,
      chat_id: chat.manifest.chat_id,
      note: 'Real bounded surface-thermal smoke against this immutable mesh.'
    }
  );
  const launchedJob = await modelResponse.json();
  assertion(modelResponse.status === 202,
    'Thermal model launch failed: ' + JSON.stringify(launchedJob));
  const job = await waitForJob(
    ready.url,
    launchedJob.job_id,
    (options.timeoutSeconds + 30) * 1_000
  );
  assertion(job.status === 'completed',
    'Thermal model job failed: ' + JSON.stringify(job.error ?? job.result));
  assertion(job.simulation_id, 'Thermal model job returned no simulation ID.');

  const detailResponse = await fetch(
    ready.url + '/api/simulations/' + encodeURIComponent(job.simulation_id),
    { cache: 'no-store' }
  );
  assertion(detailResponse.ok,
    'Thermal simulation detail failed with status ' + detailResponse.status);
  const detail = await detailResponse.json();
  const summary = detail.summary;
  assertion(
    summary?.classification ===
      'surface_graph_heat_diffusion_not_volumetric_fea',
    'Thermal summary classification is missing or unsafe.'
  );
  assertion(summary.mesh_sha256 === build.manifest.artifacts['assembly.stl'].sha256,
    'Thermal summary is not bound to the selected immutable mesh.');
  assertion([
    summary.checks.finite,
    summary.checks.hot_boundary_pinned,
    summary.checks.cold_boundary_pinned,
    summary.checks.maximum_principle
  ].every((value) => value === true),
    'Thermal validation checks did not all pass.');
  assertion(summary.integration.diffusion_number_lambda <= 0.45,
    'Thermal explicit step exceeded its stability limit.');

  const artifactUrl = ready.url + '/artifact/' +
    encodeURIComponent(job.simulation_id) + '/temperature-field.ply';
  const fieldResponse = await fetch(artifactUrl, { cache: 'no-store' });
  assertion(fieldResponse.ok,
    'Temperature PLY request failed with status ' + fieldResponse.status);
  const fieldText = await fieldResponse.text();
  const geometry = parseThreeD(fieldText, 'ply');
  assertion(geometry.vertices.length === summary.mesh.vertices,
    'Interactive PLY vertex count does not match the solver summary.');
  assertion(geometry.faces.length === summary.mesh.triangles,
    'Interactive PLY triangle count does not match the solver summary.');
  assertion(geometry.scalar?.name === 'temperature_c',
    'Interactive PLY did not expose temperature_c.');
  assertion(geometry.scalar.minimum >= summary.final.minimum_c - 1e-8,
    'Interactive PLY minimum is outside the recorded summary.');
  assertion(geometry.scalar.maximum <= summary.final.maximum_c + 1e-8,
    'Interactive PLY maximum is outside the recorded summary.');

  const selectedIndex = geometry.vertices.reduce((best, vertex, index) =>
    vertex.scalar > geometry.vertices[best].scalar ? index : best, 0);
  const selected = geometry.vertices[selectedIndex];
  const interactionResponse = await mutate(
    '/api/chats/' + encodeURIComponent(chat.manifest.chat_id) + '/interactions',
    {
      surface: 'three-d',
      action: 'point.selected',
      artifact: {
        kind: 'simulation',
        record_id: job.simulation_id,
        name: 'temperature-field.ply',
        url: '/artifact/' + encodeURIComponent(job.simulation_id) +
          '/temperature-field.ply'
      },
      payload: {
        format: 'ply',
        view: { yaw: -0.55, pitch: 0.35, zoom: 1.15 },
        selection: {
          index: selectedIndex,
          element: selected.element,
          x: selected.x,
          y: selected.y,
          z: selected.z,
          scalar_name: 'temperature_c',
          scalar_value: selected.scalar,
          scalar_unit: '°C'
        },
        geometry: {
          vertices: geometry.vertices.length,
          edges: geometry.edges.length,
          triangles: geometry.faces.length
        },
        field: geometry.scalar
      }
    }
  );
  assertion(interactionResponse.status === 201,
    'Scalar selection interaction failed with status ' + interactionResponse.status);
  const prompt = interactionAwarePrompt({
    cwd: options.project,
    chatId: chat.manifest.chat_id,
    message: 'Interpret the temperature I selected.'
  }).prompt;
  assertion(prompt.includes('scalar field temperature_c range'),
    'The next AI turn did not receive the scalar-field range.');
  assertion(prompt.includes('temperature_c=' + String(selected.scalar)),
    'The next AI turn did not receive the selected temperature.');

  const state = await (await fetch(ready.url + '/api/state')).json();
  const verification = verifySimulation(options.project, job.simulation_id);
  const lineage = buildLineageGraph(options.project);
  const projectGate = verifyProject(options.project);
  assertion(verification.ok, 'Recorded thermal simulation failed verification.');
  assertion(lineage.edges.some((edge) =>
    edge.source === 'cad-build:' + buildId &&
    edge.target === 'simulation:' + job.simulation_id &&
    edge.relation === 'modeled_by'
  ), 'CAD build-to-thermal-model lineage edge is missing.');
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
    classification: summary.classification,
    mesh_sha256: summary.mesh_sha256,
    scalar_field: geometry.scalar,
    selected_temperature_c: selected.scalar,
    checks: summary.checks,
    artifacts: Object.keys(detail.manifest?.artifacts ?? {})
      .filter((name) => name.startsWith('artifacts/')),
    interactions: listInteractions(
      options.project, chat.manifest.chat_id
    ).map((record) => record.action),
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
  process.stderr.write('ScienceCode CAD thermal live smoke failed: ' +
    error.stack + '\n');
  process.exitCode = 1;
}
