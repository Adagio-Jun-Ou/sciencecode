import fs from 'node:fs';
import path from 'node:path';
import {
  buildCadProject,
  detectCadToolchain,
  initializeCadProject,
  simulateCadBuild,
  sliceCadBuild,
  verifyProject
} from '../lib/core.js';

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

const cwd = path.resolve(process.argv[2] ?? process.cwd());
if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('CAD live-smoke project directory does not exist: ' + cwd);
}

const toolchain = detectCadToolchain();
assertion(toolchain.openscad.available, 'OpenSCAD is not available.');
assertion(toolchain.slicer.available, 'PrusaSlicer console is not available.');

const created = initializeCadProject({
  cwd,
  name: 'ScienceCode live CAD smoke',
  cadProjectId: 'cad-live-smoke'
});
const build = buildCadProject({
  cwd,
  cadProjectId: created.descriptor.cad_project_id,
  timeoutMs: 300_000,
  toolchain
});
assertion(build.manifest.status === 'completed',
  'OpenSCAD build failed: ' + JSON.stringify(build.manifest.failure));
assertion(build.verification.ok, 'OpenSCAD build integrity verification failed.');

const simulation = simulateCadBuild({
  cwd,
  buildId: build.manifest.build_id
});
assertion(simulation.verification.ok, 'CAD geometry-screen integrity verification failed.');

const slice = sliceCadBuild({
  cwd,
  buildId: build.manifest.build_id,
  mode: 'preview',
  settings: {
    layer_height_mm: 0.2,
    nozzle_diameter_mm: 0.4,
    filament_diameter_mm: 1.75,
    infill_percent: 15,
    threads: 2
  },
  timeoutMs: 300_000,
  toolchain
});
assertion(slice.manifest.status === 'completed_preview',
  'Safe PrusaSlicer preview failed: ' + JSON.stringify(slice.manifest.failure));
assertion(slice.manifest.analysis?.preview_only_invariants?.pass === true,
  'Safe preview invariants did not pass.');
assertion(slice.verification.ok, 'Slice integrity verification failed.');

const project = verifyProject(cwd);
assertion(project.ok, 'Whole-project integrity gate failed: ' + JSON.stringify(project.errors));

process.stdout.write(JSON.stringify({
  ok: true,
  project: cwd,
  toolchain,
  cad_project_id: created.descriptor.cad_project_id,
  build: {
    build_id: build.manifest.build_id,
    status: build.manifest.status,
    triangles: build.manifest.mesh.triangles,
    topology: build.manifest.mesh.topology,
    bounding_box_mm: build.manifest.mesh.geometry.bounding_box,
    volume_mm3: build.manifest.mesh.geometry.volume_mm3,
    verified: build.verification.ok
  },
  simulation: {
    simulation_id: simulation.manifest.simulation_id,
    verdict: simulation.manifest.status,
    outputs: simulation.manifest.report.outputs,
    verified: simulation.verification.ok
  },
  slice: {
    slice_id: slice.manifest.slice_id,
    status: slice.manifest.status,
    layers: slice.manifest.analysis.layers,
    motion_moves: slice.manifest.analysis.motion_moves,
    positive_extrusion_moves: slice.manifest.analysis.positive_extrusion_moves,
    physical_command_indicators:
      slice.manifest.analysis.physical_command_indicators,
    preview_only_invariants: slice.manifest.analysis.preview_only_invariants,
    bytes: slice.manifest.artifacts['preview.gcode']?.bytes ?? null,
    verified: slice.verification.ok
  },
  gate: {
    ok: project.ok,
    counts: project.counts
  }
}, null, 2) + '\n');
