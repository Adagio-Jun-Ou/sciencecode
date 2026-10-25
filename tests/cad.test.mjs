import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeAsciiStl,
  analyzeGcode,
  buildCadProject,
  createCadProject,
  createCadProjectFromSpecFile,
  getCadProject,
  initializeCadProject,
  readCadFile,
  resolveRevisionSourceArtifact,
  simulateCadBuild,
  sliceCadBuild,
  verifyCadBuild,
  verifyCadSimulation,
  verifyCadSlice,
  writeCadFile
} from '../lib/core.js';

function workspace(name = 'sciencecode-cad-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function asciiCube(size = 10) {
  const v = (x, y, z) => [x * size, y * size, z * size];
  const triangles = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)], [v(0, 0, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 1, 1), v(0, 1, 1)], [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1)], [v(0, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(1, 1, 1), v(1, 1, 0)], [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1)], [v(0, 0, 0), v(0, 1, 1), v(0, 1, 0)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1)], [v(1, 0, 0), v(1, 1, 1), v(1, 0, 1)]
  ];
  return ['solid cube', ...triangles.flatMap((triangle) => [
    '  facet normal 0 0 0', '    outer loop',
    ...triangle.map((point) => '      vertex ' + point.join(' ')),
    '    endloop', '  endfacet'
  ]), 'endsolid cube', ''].join('\n');
}

const fakeToolchain = {
  openscad: { available: true, path: process.execPath, version: 'OpenSCAD test' },
  slicer: { available: true, engine: 'PrusaSlicer', path: process.execPath, version: 'PrusaSlicer test' },
  policies: { printer_transmission: 'disabled', slicer_post_process: 'disabled' }
};

const fakeMultiEngineToolchain = {
  ...fakeToolchain,
  cadquery: {
    available: true,
    path: process.execPath,
    adapter: path.join(path.sep, 'sciencecode', 'cadquery_adapter.py'),
    version: '2.8.0-test',
    ocp_version: '7.9-test',
    runtime_manifest_sha256: 'a'.repeat(64),
    runtime_home: path.resolve(os.tmpdir())
  }
};

function cadQueryRunner(command, args) {
  assert.equal(command, process.execPath);
  if (args.includes('--export-gcode')) return cadRunner(command, args);
  const stl = args[args.indexOf('--stl') + 1];
  const step = args[args.indexOf('--step') + 1];
  const parameters = args[args.indexOf('--parameters-file') + 1];
  assert.deepEqual(JSON.parse(fs.readFileSync(parameters, 'utf8')), {
    base_height_mm: 4, base_length_mm: 56, base_width_mm: 34
  });
  fs.writeFileSync(stl, asciiCube());
  fs.writeFileSync(step, 'ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n');
  return {
    status: 0, signal: null, stderr: '',
    stdout: 'SCIENCECODE_CADQUERY_RESULT_JSON=' + JSON.stringify({
      ok: true, python: '3.11.9', cadquery_version: '2.8.0-test',
      cadquery_ocp_version: '7.9-test', object_type: 'Assembly', object_count: 2,
      shape_valid: true, solid_count: 2, face_count: 12,
      volume_mm3: 1000, area_mm2: 600,
      local_modules: ['parts.base:parts/base.py', 'parts.bracket:parts/bracket.py'],
      outputs: { stl: 'assembly.stl', step: 'assembly.step' }
    }) + '\n'
  };
}

function cadRunner(command, args) {
  assert.equal(command, process.execPath);
  if (args.includes('--export-gcode')) {
    const output = args[args.indexOf('--output') + 1];
    const physical = args.includes('--load');
    fs.writeFileSync(output, physical
      ? ';LAYER_CHANGE\nG90\nM104 S205\nG28\nG1 X10 Y10 Z0.2 E0.5\n'
      : '; generated preview\n;LAYER_CHANGE\n;Z:0.2\n; gcode_flavor = no-extrusion\nG21\nG90\nM107\nG1 X1 Y2 Z0.2\nG1 X8 Y9\n');
    return { status: 0, signal: null, stdout: 'Slicing result exported\n', stderr: '' };
  }
  const output = args[args.indexOf('-o') + 1];
  const summary = args[args.indexOf('--summary-file') + 1];
  fs.writeFileSync(output, asciiCube());
  fs.writeFileSync(summary, JSON.stringify({
    geometry: { bounding_box: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] }, facets: 12, simple: true }
  }));
  return { status: 0, signal: null, stdout: '', stderr: 'Geometries in cache: 1\n' };
}

test('bounded STL and G-code analyzers report topology, geometry, and physical command indicators', () => {
  const mesh = analyzeAsciiStl(asciiCube());
  assert.equal(mesh.triangles, 12);
  assert.equal(mesh.topology.watertight, true);
  assert.equal(mesh.geometry.volume_mm3, 1000);
  assert.deepEqual(mesh.geometry.bounding_box.size, [10, 10, 10]);

  const preview = analyzeGcode(';LAYER_CHANGE\nG90\nG1 X4 Y5 Z0.2\n');
  assert.equal(preview.preview_only_invariants.pass, true);
  const relative = analyzeGcode('G90\nG1 X10 Y20\nG91\nG1 X5 Y-2\nG1 Z1\n');
  assert.deepEqual(relative.coordinate_bounds_mm, {
    min: [10, 18, 1],
    max: [15, 20, 1],
    size: [5, 2, 0]
  });
  const physical = analyzeGcode('M104 S200\nG28\nG1 X2 E0.5\n');
  assert.equal(physical.preview_only_invariants.pass, false);
  assert.equal(physical.physical_command_indicators.heater_commands, 1);
  assert.equal(physical.physical_command_indicators.homing_or_leveling_commands, 1);
  assert.equal(physical.positive_extrusion_moves, 1);
});

test('a manifest imports an arbitrary bounded multi-file SCAD and CAD environment', () => {
  const directory = workspace();
  const sourceRoot = path.join(directory, 'design');
  fs.mkdirSync(path.join(sourceRoot, 'parts'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'assets'), { recursive: true });
  const assembly = [
    'use <parts/plate.scad>',
    'use <parts/rib.scad>',
    'plate();',
    'translate([12, 0, 2]) rib();',
    'translate([30, 0, 0]) import("assets/seed.stl");',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(sourceRoot, 'assembly.scad'), assembly);
  fs.writeFileSync(
    path.join(sourceRoot, 'parts', 'plate.scad'),
    'module plate() { cube([20, 30, 4], center=true); }\n'
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'parts', 'rib.scad'),
    'module rib() { cube([4, 24, 18], center=true); }\n'
  );
  fs.writeFileSync(path.join(sourceRoot, 'assets', 'seed.stl'), asciiCube(2));
  fs.writeFileSync(path.join(sourceRoot, 'project.json'), JSON.stringify({
    cad_project_id: 'cad-imported-assembly',
    name: 'Imported assembly',
    entry: 'assembly.scad',
    files: [
      'assembly.scad',
      'parts/plate.scad',
      'parts/rib.scad',
      'assets/seed.stl'
    ],
    parts: [
      { id: 'plate', source: 'parts/plate.scad', module: 'plate' },
      { id: 'rib', source: 'parts/rib.scad', module: 'rib' }
    ]
  }, null, 2));

  const created = createCadProjectFromSpecFile({
    cwd: directory,
    specPath: 'design/project.json'
  });
  assert.equal(created.descriptor.files.length, 4);
  assert.equal(created.imported_from, 'design/project.json');
  assert.deepEqual(created.references.map((item) => item.kind).sort(), [
    'import',
    'use',
    'use'
  ]);
  fs.writeFileSync(path.join(sourceRoot, 'assembly.scad'), 'cube(999);\n');
  assert.equal(
    readCadFile({
      cwd: directory,
      cadProjectId: 'cad-imported-assembly',
      file: 'assembly.scad'
    }).content,
    assembly
  );
});

test('multi-file CAD projects support conflict-safe edits and immutable render/simulation records', () => {
  const directory = workspace();
  const created = createCadProject({ cwd: directory });
  const id = created.descriptor.cad_project_id;
  assert.equal(created.files.length, 3);
  assert.equal(created.references.length, 2);
  assert.equal(getCadProject(directory, id).descriptor.parts.length, 2);

  const source = readCadFile({ cwd: directory, cadProjectId: id, file: 'parts/base.scad' });
  const edited = writeCadFile({
    cwd: directory,
    cadProjectId: id,
    file: 'parts/base.scad',
    expectedSha256: source.sha256,
    content: source.content.replace('length=56', 'length=60'),
    actor: 'test-user'
  });
  assert.equal(edited.changed, true);
  assert.match(edited.content, /length=60/);
  assert.throws(() => writeCadFile({
    cwd: directory, cadProjectId: id, file: 'parts/base.scad',
    expectedSha256: source.sha256, content: edited.content + '\n// stale edit\n'
  }), { code: 'CAD_EDIT_CONFLICT' });

  const build = buildCadProject({ cwd: directory, cadProjectId: id, runner: cadRunner, toolchain: fakeToolchain });
  assert.equal(build.manifest.status, 'completed');
  assert.equal(build.manifest.mesh.topology.watertight, true);
  assert.equal(build.verification.ok, true);

  fs.appendFileSync(path.join(directory, 'cad', id, 'assembly.scad'), '\n// later working-tree edit\n');
  assert.equal(verifyCadBuild(directory, build.manifest.build_id).ok, true);

  const simulation = simulateCadBuild({ cwd: directory, buildId: build.manifest.build_id });
  assert.equal(simulation.manifest.report.outputs.estimated_mass_g, 1.24);
  assert.equal(simulation.manifest.report.outputs.build_volume_dimension_fit, true);
  assert.equal(verifyCadSimulation(directory, simulation.manifest.simulation_id).ok, true);
  const meshSource = resolveRevisionSourceArtifact(directory, {
    url: '/api/cad/artifacts/build/' + encodeURIComponent(build.manifest.build_id) +
      '/assembly.stl',
    kind: 'cad-build',
    record_id: build.manifest.build_id,
    name: 'assembly.stl'
  });
  assert.equal(meshSource.sha256, build.manifest.artifacts['assembly.stl'].sha256);

  fs.appendFileSync(path.join(build.directory, 'assembly.stl'), 'tampered\n');
  assert.equal(verifyCadBuild(directory, build.manifest.build_id).ok, false);
});

test('CadQuery projects support multi-file Python edits, immutable STL plus STEP builds, screens, and slices', () => {
  const directory = workspace('sciencecode-cadquery-');
  const created = initializeCadProject({
    cwd: directory, name: 'CadQuery assembly', cadProjectId: 'cad-cadquery-assembly',
    engine: 'cadquery'
  });
  assert.equal(created.descriptor.engine, 'cadquery');
  assert.equal(created.descriptor.entry, 'assembly.py');
  assert.equal(created.descriptor.files.length, 4);
  assert.equal(created.descriptor.execution_policy.os_sandbox,
    'not_provided_process_runs_with_user_permissions');
  const source = readCadFile({
    cwd: directory, cadProjectId: created.descriptor.cad_project_id, file: 'parts/base.py'
  });
  assert.equal(source.editable, true);
  const edited = writeCadFile({
    cwd: directory, cadProjectId: created.descriptor.cad_project_id, file: 'parts/base.py',
    expectedSha256: source.sha256,
    content: source.content.replace('length=56', 'length=64'),
    actor: 'cadquery-test'
  });
  assert.equal(edited.changed, true);
  assert.ok(edited.revision.artifacts['before.py']);
  assert.ok(edited.revision.artifacts['after.py']);

  const build = buildCadProject({
    cwd: directory, cadProjectId: created.descriptor.cad_project_id,
    runner: cadQueryRunner, toolchain: fakeMultiEngineToolchain
  });
  assert.equal(build.manifest.status, 'completed');
  assert.equal(build.manifest.engine, 'cadquery');
  assert.equal(build.manifest.interchange_artifact, 'assembly.step');
  assert.equal(build.manifest.cadquery_report.shape_valid, true);
  assert.equal(build.manifest.artifacts['assembly.step'].bytes > 0, true);
  assert.equal(build.verification.ok, true);

  const screen = simulateCadBuild({ cwd: directory, buildId: build.manifest.build_id });
  assert.equal(screen.verification.ok, true);
  const slice = sliceCadBuild({
    cwd: directory, buildId: build.manifest.build_id,
    runner: cadQueryRunner, toolchain: fakeMultiEngineToolchain
  });
  assert.equal(slice.manifest.status, 'completed_preview');
  assert.equal(slice.verification.ok, true);
  const mutated = buildCadProject({
    cwd: directory, cadProjectId: created.descriptor.cad_project_id,
    toolchain: fakeMultiEngineToolchain,
    runner(command, args, options) {
      const result = cadQueryRunner(command, args);
      fs.writeFileSync(path.join(options.cwd, 'engine-generated.py'), 'unexpected = True\n');
      return result;
    }
  });
  assert.equal(mutated.manifest.status, 'failed');
  assert.equal(mutated.manifest.failure.code, 'CAD_SOURCE_SNAPSHOT_MUTATED');
  assert.equal(mutated.manifest.source_snapshot_integrity.ok, false);
  assert.equal(mutated.verification.ok, true);
  assert.throws(() => createCadProject({
    cwd: workspace(),
    spec: { name: 'Mismatch', engine: 'cadquery', entry: 'assembly.scad', files: ['assembly.scad'] },
    files: { 'assembly.scad': 'cube(1);\n' }
  }), { code: 'INVALID_CAD_ENTRY' });
});

test('slicing defaults to a no-extrusion preview and walls off printer profiles and post-process hooks', () => {
  const directory = workspace();
  const project = createCadProject({ cwd: directory });
  const build = buildCadProject({ cwd: directory, cadProjectId: project.descriptor.cad_project_id, runner: cadRunner, toolchain: fakeToolchain });
  const slice = sliceCadBuild({ cwd: directory, buildId: build.manifest.build_id, runner: cadRunner, toolchain: fakeToolchain });
  assert.equal(slice.manifest.status, 'completed_preview');
  assert.equal(slice.manifest.analysis.preview_only_invariants.pass, true);
  assert.equal(slice.manifest.printer_transmission, 'disabled');
  assert.equal(verifyCadSlice(directory, slice.manifest.slice_id).ok, true);
  const gcodeSource = resolveRevisionSourceArtifact(directory, {
    url: '/api/cad/artifacts/slice/' + encodeURIComponent(slice.manifest.slice_id) +
      '/preview.gcode',
    kind: 'cad-slice',
    record_id: slice.manifest.slice_id,
    name: 'preview.gcode'
  });
  assert.equal(gcodeSource.media_type, 'text/x-gcode; charset=utf-8');

  fs.writeFileSync(path.join(directory, 'printer.ini'), 'layer_height = 0.2\npost_process = malicious.exe\n');
  assert.throws(() => sliceCadBuild({
    cwd: directory, buildId: build.manifest.build_id, mode: 'printer-profile',
    profilePath: 'printer.ini', runner: cadRunner, toolchain: fakeToolchain
  }), { code: 'PHYSICAL_RISK_ACK_REQUIRED' });
  assert.throws(() => sliceCadBuild({
    cwd: directory, buildId: build.manifest.build_id, mode: 'printer-profile',
    profilePath: 'printer.ini', acknowledgePhysicalRisk: true,
    runner: cadRunner, toolchain: fakeToolchain
  }), { code: 'SLICER_POST_PROCESS_DISABLED' });

  fs.writeFileSync(path.join(directory, 'printer.ini'), 'layer_height = 0.2\npost_process =\n');
  const physical = sliceCadBuild({
    cwd: directory, buildId: build.manifest.build_id, mode: 'printer-profile',
    profilePath: 'printer.ini', acknowledgePhysicalRisk: true,
    runner: cadRunner, toolchain: fakeToolchain
  });
  assert.equal(physical.manifest.status, 'completed_requires_physical_review');
  assert.equal(physical.manifest.analysis.preview_only_invariants.pass, false);
  assert.equal(physical.manifest.analysis.physical_command_indicators.heater_commands, 1);
});

test('CAD source preflight rejects undeclared, parent, and dynamic file references before tool execution', () => {
  const base = {
    name: 'Unsafe reference test', entry: 'assembly.scad', files: ['assembly.scad'], parts: []
  };
  assert.throws(() => createCadProject({
    cwd: workspace(), spec: base, files: { 'assembly.scad': 'include <../outside.scad>\ncube(1);\n' }
  }), { code: 'UNSAFE_CAD_REFERENCE' });
  assert.throws(() => createCadProject({
    cwd: workspace(), spec: base, files: { 'assembly.scad': 'import(file_name);\n' }
  }), { code: 'DYNAMIC_CAD_REFERENCE' });
  assert.throws(() => createCadProject({
    cwd: workspace(), spec: base, files: { 'assembly.scad': 'import("undeclared.stl");\n' }
  }), { code: 'UNDECLARED_CAD_REFERENCE' });
});
