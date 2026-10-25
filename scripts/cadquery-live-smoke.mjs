import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCadProject,
  createChatSession,
  createCadProject,
  detectCadToolchain,
  initializeCadProject,
  simulateCadBuild,
  sliceCadBuild,
  startLab,
  verifyProject
} from '../lib/core.js';

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

const cwd = path.resolve(process.argv[2] ?? process.cwd());
if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('CadQuery live-smoke project directory does not exist: ' + cwd);
}
const toolchain = detectCadToolchain();
assertion(toolchain.cadquery.available,
  'CadQuery runtime is unavailable; run sciencecode compute setup --profile cad.');
assertion(toolchain.slicer.available, 'PrusaSlicer console is not available.');
const suffix = Date.now().toString(36);
const cadProjectId = 'cad-cq-smoke-' + suffix;
const created = initializeCadProject({
  cwd, name: 'ScienceCode CadQuery live smoke', cadProjectId, engine: 'cadquery'
});
const first = buildCadProject({
  cwd, cadProjectId, timeoutMs: 300_000, toolchain
});
const second = buildCadProject({
  cwd, cadProjectId, timeoutMs: 300_000, toolchain
});
for (const build of [first, second]) {
  assertion(build.manifest.status === 'completed',
    'CadQuery build failed: ' + JSON.stringify(build.manifest.failure));
  assertion(build.verification.ok, 'CadQuery build integrity verification failed.');
  assertion(build.manifest.source_snapshot_integrity?.ok === true,
    'CadQuery changed its immutable source snapshot.');
  assertion(build.manifest.cadquery_report?.shape_valid === true,
    'CadQuery did not report a valid OpenCascade shape.');
  assertion(build.manifest.cadquery_report?.solid_count >= 2,
    'CadQuery starter assembly did not preserve multiple solids.');
  assertion(!Object.keys(build.manifest.artifacts).some((name) =>
    name.includes('__pycache__') || name.endsWith('.pyc')),
  'Python bytecode leaked into the immutable source snapshot.');
}
const firstStl = first.manifest.artifacts['assembly.stl'];
const secondStl = second.manifest.artifacts['assembly.stl'];
const firstStep = first.manifest.artifacts['assembly.step'];
const secondStep = second.manifest.artifacts['assembly.step'];
assertion(firstStl?.sha256 === secondStl?.sha256, 'Repeated STL export was not reproducible.');
assertion(firstStep?.sha256 === secondStep?.sha256, 'Repeated STEP export was not reproducible.');
const stepPath = path.join(second.directory, 'assembly.step');
assertion(fs.readFileSync(stepPath, 'utf8').includes("'1970-01-01T00:00:00'"),
  'STEP header timestamp was not canonicalized.');

const importedProjectId = 'cad-cq-import-smoke-' + suffix;
const importedOffsetMm = 5;
const importedSource = [
  'import cadquery as cq',
  'from pathlib import Path',
  '',
  'def build(parameters):',
  '    source = Path(SCIENCECODE_SOURCE_ROOT) / "assets" / "input.step"',
  '    model = cq.importers.importStep(str(source))',
  '    return model.translate((float(parameters.get("offset_x_mm", 5)), 0, 0))',
  ''
].join('\n');
createCadProject({
  cwd,
  spec: {
    cad_project_id: importedProjectId,
    name: 'ScienceCode declared STEP manipulation smoke',
    engine: 'cadquery',
    entry: 'assembly.py',
    files: ['assembly.py', 'assets/input.step'],
    parts: [{ id: 'imported-assembly', source: 'assets/input.step' }],
    parameters: { offset_x_mm: importedOffsetMm },
    build_volume_mm: [250, 210, 220]
  },
  files: {
    'assembly.py': importedSource,
    'assets/input.step': fs.readFileSync(stepPath)
  }
});
const importedBuild = buildCadProject({
  cwd, cadProjectId: importedProjectId, timeoutMs: 300_000, toolchain
});
assertion(importedBuild.manifest.status === 'completed',
  'Declared STEP import/manipulation build failed: ' +
    JSON.stringify(importedBuild.manifest.failure));
assertion(importedBuild.verification.ok,
  'Declared STEP import/manipulation build did not verify.');
const importedStepSource = importedBuild.manifest.source_files.find((item) =>
  item.path === 'assets/input.step');
assertion(importedStepSource?.sha256 === secondStep.sha256,
  'Imported STEP asset was not bound to the exact parent export hash.');
assertion(importedBuild.manifest.cadquery_report?.solid_count >= 2,
  'STEP round trip did not preserve the assembly solids.');
const originalMinX = second.manifest.mesh.geometry.bounding_box.min[0];
const importedMinX = importedBuild.manifest.mesh.geometry.bounding_box.min[0];
assertion(Math.abs(importedMinX - (originalMinX + importedOffsetMm)) < 0.001,
  'CadQuery did not apply the requested STEP translation.');

const simulation = simulateCadBuild({ cwd, buildId: second.manifest.build_id });
assertion(simulation.verification.ok, 'CadQuery geometry screen did not verify.');
const slice = sliceCadBuild({
  cwd, buildId: second.manifest.build_id, mode: 'preview',
  settings: {
    layer_height_mm: 0.2, nozzle_diameter_mm: 0.4,
    filament_diameter_mm: 1.75, infill_percent: 15, threads: 2
  },
  timeoutMs: 300_000, toolchain
});
assertion(slice.manifest.status === 'completed_preview',
  'Safe slice failed: ' + JSON.stringify(slice.manifest.failure));
assertion(slice.manifest.analysis?.preview_only_invariants?.pass === true,
  'Safe preview invariants did not pass.');
assertion(slice.verification.ok, 'Safe slice integrity verification failed.');

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chat = createChatSession({
  cwd, title: 'CadQuery live smoke harness', agent: 'cad-engineer'
});
const launched = startLab({ cwd, packageRoot, port: 0 });
const details = await launched.ready;
let labResult = null;
try {
  const queuedResponse = await fetch(details.url + '/api/cad/projects/' +
    encodeURIComponent(cadProjectId) + '/builds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: details.url },
    body: JSON.stringify({ timeout_seconds: 300, note: 'CadQuery live Lab queue smoke.' })
  });
  assertion(queuedResponse.status === 202,
    'Lab did not queue the CadQuery build: HTTP ' + queuedResponse.status);
  let job = await queuedResponse.json();
  for (let attempt = 0; attempt < 600 && ['queued', 'running'].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const response = await fetch(details.url + '/api/jobs/' + encodeURIComponent(job.job_id));
    assertion(response.ok, 'Lab job polling failed: HTTP ' + response.status);
    job = await response.json();
  }
  assertion(job.status === 'completed',
    'Lab CadQuery build did not complete: ' + JSON.stringify(job.error));
  const stepResponse = await fetch(details.url + '/api/cad/artifacts/build/' +
    encodeURIComponent(job.build_id) + '/assembly.step');
  const stlResponse = await fetch(details.url + '/api/cad/artifacts/build/' +
    encodeURIComponent(job.build_id) + '/assembly.stl');
  assertion(stepResponse.ok && stlResponse.ok, 'Lab did not serve verified CAD artifacts.');
  const stepBuffer = Buffer.from(await stepResponse.arrayBuffer());
  const stlBuffer = Buffer.from(await stlResponse.arrayBuffer());
  const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
  assertion(digest(stepBuffer) === secondStep.sha256,
    'Lab-served STEP did not match the reproducible core build.');
  assertion(digest(stlBuffer) === secondStl.sha256,
    'Lab-served STL did not match the reproducible core build.');
  const projectResponse = await fetch(details.url + '/api/cad/projects/' +
    encodeURIComponent(cadProjectId));
  assertion(projectResponse.ok, 'Lab did not return the CadQuery project.');
  const project = await projectResponse.json();
  assertion(project.descriptor.engine === 'cadquery',
    'Lab project did not preserve the CadQuery engine contract.');
  const harnessResponse = await fetch(details.url + '/api/chats/' +
    encodeURIComponent(chat.manifest.chat_id) + '/harness');
  assertion(harnessResponse.ok, 'Lab did not expose the CadQuery AI harness.');
  const harness = await harnessResponse.json();
  assertion(harness.board.cad.builds.some((item) =>
    item.build_id === job.build_id && item.engine === 'cadquery'),
  'AI harness did not preserve the CadQuery engine on the Lab build.');
  assertion(harness.activity.some((item) =>
    item.build_id === job.build_id && item.title.startsWith('CadQuery build')),
  'AI harness did not show an engine-aware CadQuery build activity.');
  labResult = {
    job_id: job.job_id, build_id: job.build_id,
    step_bytes: stepBuffer.length, stl_bytes: stlBuffer.length,
    artifacts_verified: true, harness_visible: true
  };
} finally {
  await new Promise((resolve) => launched.server.close(resolve));
}
const gate = verifyProject(cwd);
assertion(gate.ok, 'Whole-project integrity gate failed: ' + JSON.stringify(gate.errors));

process.stdout.write(JSON.stringify({
  ok: true,
  project: cwd,
  runtime: {
    cadquery: toolchain.cadquery.version,
    ocp: toolchain.cadquery.ocp_version,
    manifest_sha256: toolchain.cadquery.runtime_manifest_sha256
  },
  cad_project_id: cadProjectId,
  reproducible: { stl_sha256: secondStl.sha256, step_sha256: secondStep.sha256 },
  step_round_trip: {
    cad_project_id: importedProjectId,
    build_id: importedBuild.manifest.build_id,
    input_step_sha256: importedStepSource.sha256,
    output_step_sha256: importedBuild.manifest.artifacts['assembly.step'].sha256,
    offset_x_mm: importedOffsetMm,
    bounding_box_mm: importedBuild.manifest.mesh.geometry.bounding_box,
    solids: importedBuild.manifest.cadquery_report.solid_count,
    verified: importedBuild.verification.ok
  },
  build: {
    first: first.manifest.build_id, second: second.manifest.build_id,
    triangles: second.manifest.mesh.triangles,
    solids: second.manifest.cadquery_report.solid_count,
    assembly_objects: second.manifest.cadquery_report.assembly_object_names,
    bounding_box_mm: second.manifest.mesh.geometry.bounding_box,
    volume_mm3: second.manifest.mesh.geometry.volume_mm3,
    source_snapshot_verified: second.manifest.source_snapshot_integrity.ok
  },
  simulation: {
    simulation_id: simulation.manifest.simulation_id,
    verdict: simulation.manifest.status,
    outputs: simulation.manifest.report.outputs
  },
  slice: {
    slice_id: slice.manifest.slice_id, status: slice.manifest.status,
    layers: slice.manifest.analysis.layers,
    positive_extrusion_moves: slice.manifest.analysis.positive_extrusion_moves,
    physical_command_indicators: slice.manifest.analysis.physical_command_indicators
  },
  lab: labResult,
  gate: { ok: gate.ok, counts: gate.counts }
}, null, 2) + '\n');
