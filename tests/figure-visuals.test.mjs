import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeFigureVisual,
  createFigureVisual,
  getFigureVisual,
  listFigureVisuals,
  MAX_FIGURE_VISUALS,
  normalizeFigureVisualProfile,
  resolveFigureVisualArtifact,
  verifyFigureVisual
} from '../lib/figure-visuals.js';
import {
  buildFigureSemanticSidecar,
  createFigureRegistration,
  verifyFigureRegistration
} from '../lib/figure-registrations.js';
import { runCli } from '../lib/cli.js';
import { encodeRgbaPng } from '../lib/png.js';
import { runSimulation } from '../lib/simulations.js';

const WIDTH = 128;
const HEIGHT = 96;
const LEFT = 20;
const TOP = 10;
const RIGHT = 117;
const BOTTOM = 85;
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const RED = [220, 30, 40, 255];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function invoke(argv, cwd) {
  let stdout = '';
  let stderr = '';
  const code = runCli({
    argv,
    cwd,
    root: packageRoot,
    env: process.env,
    stdout: { write(value) { stdout += String(value); } },
    stderr: { write(value) { stderr += String(value); } }
  });
  return { code, stdout, stderr };
}

function semanticContract(chartType = 'line_scatter') {
  return {
    chart_type: chartType,
    title: 'Measured response',
    x_axis: {
      column: 'x',
      label: 'Time',
      source_unit: { symbol: 's' },
      display_unit: { symbol: 's' },
      scale: 'linear'
    },
    y_axis: {
      label: 'Response',
      display_unit: { symbol: '1' },
      scale: 'linear'
    },
    series: [{
      id: 'response',
      column: 'y',
      label: 'Response',
      source_unit: { symbol: '1' }
    }],
    missing_value_policy: 'error',
    row_order: 'x_ascending',
    duplicate_x_policy: 'error',
    sampling: { method: 'all' },
    aggregation: 'none'
  };
}

function source() {
  return Buffer.from('x,y\n0,0\n5,5\n10,10\n');
}

function profile(chartType = 'line_scatter') {
  return {
    schema_version: 1,
    plot_area: {
      left: LEFT / (WIDTH - 1),
      top: TOP / (HEIGHT - 1),
      right: RIGHT / (WIDTH - 1),
      bottom: BOTTOM / (HEIGHT - 1)
    },
    x_domain: { minimum: 0, maximum: 10 },
    y_domain: { minimum: 0, maximum: 10 },
    background_color: { red: 255, green: 255, blue: 255 },
    axis_color: { red: 0, green: 0, blue: 0 },
    axis_width_pixels: 3,
    series: [{
      id: 'response',
      color: { red: 220, green: 30, blue: 40 },
      line_width_pixels: chartType === 'scatter' ? 0 : 3,
      marker_radius_pixels: chartType === 'line' ? 0 : 3
    }],
    color_tolerance: 0,
    position_tolerance_pixels: 1,
    minimum_axis_coverage: 0.95,
    minimum_series_coverage: 0.95,
    maximum_unexpected_series_fraction: 0.02,
    minimum_background_fraction: 0.99
  };
}

function pixelBuffer() {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    rgba.set(WHITE, pixel * 4);
  }
  return rgba;
}

function setPixel(rgba, x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  rgba.set(color, (y * WIDTH + x) * 4);
}

function disk(rgba, x, y, radius, color) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(rgba, x + dx, y + dy, color);
      }
    }
  }
}

function line(rgba, from, to, width, color) {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx - dy;
  while (true) {
    disk(rgba, x, y, Math.floor(width / 2), color);
    if (x === to.x && y === to.y) break;
    const twice = error * 2;
    if (twice > -dy) {
      error -= dy;
      x += stepX;
    }
    if (twice < dx) {
      error += dx;
      y += stepY;
    }
  }
}

function chartPng({
  misleading = false,
  omitHorizontalAxis = false,
  axisWidth = 3,
  lineWidth = 3,
  markerRadius = 3
} = {}) {
  const rgba = pixelBuffer();
  if (!omitHorizontalAxis) {
    line(rgba, { x: LEFT, y: BOTTOM }, { x: RIGHT, y: BOTTOM }, axisWidth, BLACK);
  }
  line(rgba, { x: LEFT, y: TOP }, { x: LEFT, y: BOTTOM }, axisWidth, BLACK);
  const points = misleading
    ? [
        { x: LEFT, y: TOP },
        { x: Math.round((LEFT + RIGHT) / 2), y: TOP },
        { x: RIGHT, y: TOP }
      ]
    : [
        { x: LEFT, y: BOTTOM },
        { x: Math.round((LEFT + RIGHT) / 2), y: Math.round((TOP + BOTTOM) / 2) },
        { x: RIGHT, y: TOP }
      ];
  for (let index = 1; index < points.length; index += 1) {
    line(rgba, points[index - 1], points[index], lineWidth, RED);
  }
  for (const point of points) disk(rgba, point.x, point.y, markerRadius, RED);
  return encodeRgbaPng({ width: WIDTH, height: HEIGHT, rgba });
}

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: [] },
    probe: {
      python: '3.11.9',
      torch: { version: '2.12.0', cuda_available: false }
    }
  };
}

function artifactSelector(simulation, name) {
  const artifact = simulation.manifest.artifacts['artifacts/' + name];
  return {
    kind: 'simulation',
    record_id: simulation.manifest.simulation_id,
    name,
    url: '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) +
      '/' + encodeURIComponent(name),
    sha256: artifact.sha256
  };
}

function semanticRegistration(directory, {
  figure = chartPng(),
  mutateSidecar = (value) => value
} = {}) {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("visual figure")\n');
  const csv = source();
  const contract = semanticContract();
  const simulation = runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: runtime(),
    gpuProbe: () => ({
      available: false,
      backend: 'nvidia',
      devices: [],
      error: 'test'
    }),
    runner: (_command, args) => {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        device: { selected: 'cpu' },
        seed: 0
      }));
      fs.writeFileSync(path.join(output, 'figure.png'), figure);
      fs.writeFileSync(path.join(output, 'data.csv'), csv);
      const sidecar = mutateSidecar(buildFigureSemanticSidecar({
        figure,
        source: csv,
        sourceName: 'data.csv',
        contract
      }));
      fs.writeFileSync(
        path.join(output, 'figure.semantic.json'),
        JSON.stringify(sidecar)
      );
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
  const registration = createFigureRegistration({
    cwd: directory,
    figure: artifactSelector(simulation, 'figure.png'),
    source: artifactSelector(simulation, 'data.csv'),
    sidecar: artifactSelector(simulation, 'figure.semantic.json'),
    contract,
    name: 'Measured response semantics'
  });
  return { simulation, registration };
}

test('visual figure analysis verifies decoded axes and projected line/scatter marks', () => {
  const report = analyzeFigureVisual({
    figure: chartPng(),
    source: source(),
    sourceName: 'data.csv',
    contract: semanticContract(),
    profile: profile()
  });
  assert.equal(report.status, 'pass', JSON.stringify(report.checks));
  assert.equal(report.visual_status, 'conforming');
  assert.equal(report.summary.failed_checks, 0);
  assert.equal(report.series[0].line.coverage, 1);
  assert.equal(report.series[0].markers.coverage, 1);
  assert.equal(report.series[0].unexpected_color_pixels, 0);
  assert.ok(report.axes.horizontal.coverage >= 0.95);
  assert.ok(report.axes.vertical.coverage >= 0.95);
  assert.equal(report.background.matching_fraction, 1);
});

test('visual figure analysis catches a self-consistent sidecar beside misleading pixels', () => {
  const report = analyzeFigureVisual({
    figure: chartPng({ misleading: true }),
    source: source(),
    sourceName: 'data.csv',
    contract: semanticContract(),
    profile: profile()
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.visual_status, 'nonconforming');
  assert.ok(report.series[0].line.coverage < 0.95);
  assert.ok(report.series[0].unexpected_color_fraction > 0.02);
  assert.ok(report.checks.some((item) =>
    item.name === 'series_response_line_coverage' && item.status === 'fail'
  ));
});

test('visual profiles and missing axes fail closed', () => {
  const missingAxis = analyzeFigureVisual({
    figure: chartPng({ omitHorizontalAxis: true }),
    source: source(),
    sourceName: 'data.csv',
    contract: semanticContract(),
    profile: profile()
  });
  assert.equal(missingAxis.status, 'fail');
  assert.ok(missingAxis.axes.horizontal.coverage < 0.98);

  const undersized = analyzeFigureVisual({
    figure: chartPng({ axisWidth: 1, lineWidth: 1, markerRadius: 1 }),
    source: source(),
    sourceName: 'data.csv',
    contract: semanticContract(),
    profile: profile()
  });
  assert.equal(undersized.status, 'fail');
  assert.ok(undersized.checks.some((item) =>
    item.name.endsWith('_pixel_support') && item.status === 'fail'
  ));

  const context = {
    contract: semanticContract(),
    width: WIDTH,
    height: HEIGHT,
    points: [
      { source_row: 2, x: 0, y: [0] },
      { source_row: 3, x: 5, y: [5] },
      { source_row: 4, x: 10, y: [10] }
    ]
  };
  assert.throws(() => normalizeFigureVisualProfile({
    ...profile(),
    typo: true
  }, context), { code: 'INVALID_FIGURE_VISUAL_PROFILE' });
  assert.throws(() => normalizeFigureVisualProfile({
    ...profile(),
    x_domain: { minimum: 1, maximum: 10 }
  }, context), /contain every plotted converted value/);
  assert.throws(() => normalizeFigureVisualProfile({
    ...profile(),
    series: [{
      ...profile().series[0],
      color: { red: 0, green: 0, blue: 0 }
    }]
  }, context), /not separable/);
  assert.throws(() => normalizeFigureVisualProfile({
    ...profile('line'),
    series: [{
      ...profile('line').series[0],
      marker_radius_pixels: 2
    }]
  }, { ...context, contract: semanticContract('line') }), /must match chart_type/);
});

test('visual projection applies declared log10 scales before checking pixels', () => {
  const rgba = pixelBuffer();
  line(rgba, { x: LEFT, y: BOTTOM }, { x: RIGHT, y: BOTTOM }, 3, BLACK);
  line(rgba, { x: LEFT, y: TOP }, { x: LEFT, y: BOTTOM }, 3, BLACK);
  for (const point of [
    { x: LEFT, y: BOTTOM },
    { x: Math.round((LEFT + RIGHT) / 2), y: TOP },
    { x: RIGHT, y: Math.round((TOP + BOTTOM) / 2) }
  ]) disk(rgba, point.x, point.y, 3, RED);
  const figure = encodeRgbaPng({ width: WIDTH, height: HEIGHT, rgba });
  const logContract = semanticContract('scatter');
  logContract.x_axis.scale = 'log10';
  logContract.y_axis.scale = 'log10';
  const logProfile = {
    ...profile('scatter'),
    x_domain: { minimum: 1, maximum: 100 },
    y_domain: { minimum: 1, maximum: 100 }
  };
  const input = Buffer.from('x,y\n1,1\n10,100\n100,10\n');
  const logReport = analyzeFigureVisual({
    figure,
    source: input,
    sourceName: 'data.csv',
    contract: logContract,
    profile: logProfile
  });
  assert.equal(logReport.status, 'pass', JSON.stringify(logReport.checks));
  assert.equal(logReport.semantic.x_scale, 'log10');
  assert.equal(logReport.series[0].markers.pixel_coverage, 1);

  const linearContract = structuredClone(logContract);
  linearContract.x_axis.scale = 'linear';
  linearContract.y_axis.scale = 'linear';
  const linearReport = analyzeFigureVisual({
    figure,
    source: input,
    sourceName: 'data.csv',
    contract: linearContract,
    profile: logProfile
  });
  assert.equal(linearReport.status, 'fail');
  assert.ok(linearReport.checks.some((item) =>
    item.name === 'series_response_marker_coverage' && item.status === 'fail'
  ));
});

test('immutable visual records bind a matched semantic parent and detect report tampering', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-figure-visual-'));
  const { registration } = semanticRegistration(directory);
  assert.equal(verifyFigureRegistration(
    directory,
    registration.figure_registration_id
  ).ok, true);
  const visual = createFigureVisual({
    cwd: directory,
    figureRegistrationId: registration.figure_registration_id,
    profile: profile(),
    name: 'Measured response visual validation'
  });
  assert.equal(visual.report.status, 'pass');
  assert.equal(visual.verification.ok, true);
  assert.equal(visual.manifest.figure_registration.figure_registration_id,
    registration.figure_registration_id);
  assert.equal(listFigureVisuals(directory).length, 1);
  assert.equal(getFigureVisual(directory, visual.figure_visual_id).report.visual_status,
    'conforming');
  const reportFile = resolveFigureVisualArtifact(
    directory,
    visual.figure_visual_id,
    'report.json'
  ).file;
  fs.appendFileSync(reportFile, '\n');
  const tampered = verifyFigureVisual(directory, visual.figure_visual_id);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((item) =>
    item.file === 'report.json' && item.issue === 'hash_mismatch'
  ));
  fs.writeFileSync(reportFile, 'null\n');
  const malformed = verifyFigureVisual(directory, visual.figure_visual_id);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors[0].issue, 'invalid_record_structure');
});

test('visual registry limits and metadata roots fail closed before writes', () => {
  const capped = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-visual-cap-')
  );
  const { registration } = semanticRegistration(capped);
  const root = path.join(capped, '.sciencecode', 'figure-visuals');
  fs.mkdirSync(root, { recursive: true });
  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = function boundedVisualRegistry(target, options) {
    if (path.resolve(String(target)) === path.resolve(root) &&
        options?.withFileTypes === true) {
      return Array.from({ length: MAX_FIGURE_VISUALS }, (_, index) => ({
        name: 'figure-visual-20260811T000000Z-' + index.toString(36),
        isDirectory() { return true; }
      }));
    }
    return originalReaddirSync.call(fs, target, options);
  };
  try {
    assert.throws(() => createFigureVisual({
      cwd: capped,
      figureRegistrationId: registration.figure_registration_id,
      profile: profile()
    }), { code: 'FIGURE_VISUAL_LIMIT' });
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  for (const mode of ['metadata', 'registry']) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sciencecode-figure-visual-link-')
    );
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sciencecode-figure-visual-outside-')
    );
    if (mode === 'registry') fs.mkdirSync(path.join(directory, '.sciencecode'));
    fs.symlinkSync(
      outside,
      mode === 'metadata'
        ? path.join(directory, '.sciencecode')
        : path.join(directory, '.sciencecode', 'figure-visuals'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.throws(() => listFigureVisuals(directory), {
      code: 'INVALID_FIGURE_VISUAL_PATH'
    });
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});

test('misleading pixels remain an integrity-valid negative visual record', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-visual-negative-')
  );
  const { registration } = semanticRegistration(directory, {
    figure: chartPng({ misleading: true })
  });
  assert.equal(registration.report.status, 'pass');
  const visual = createFigureVisual({
    cwd: directory,
    figureRegistrationId: registration.figure_registration_id,
    profile: profile(),
    name: 'Misleading plot visual validation'
  });
  assert.equal(visual.report.status, 'fail');
  assert.equal(visual.report.visual_status, 'nonconforming');
  assert.equal(visual.verification.ok, true);
  const listed = listFigureVisuals(directory, { status: 'fail' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].verified, true);
});

test('figure visual CLI registers, filters, shows, verifies, and rejects ambiguous options', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-visual-cli-')
  );
  const { registration } = semanticRegistration(directory);
  fs.writeFileSync(path.join(directory, 'visual.json'), JSON.stringify({
    schema_version: 1,
    name: 'CLI visual validation',
    figure_registration_id: registration.figure_registration_id,
    profile: profile()
  }));
  const created = invoke(['figure', 'visual', 'register', 'visual.json'], directory);
  assert.equal(created.code, 0, created.stderr);
  const visual = JSON.parse(created.stdout).visual;
  assert.equal(visual.report.status, 'pass');
  const id = visual.figure_visual_id;

  const listed = invoke([
    'figure', 'visual', 'list',
    '--registration', registration.figure_registration_id,
    '--status', 'pass',
    '--json'
  ], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).map((item) => item.figure_visual_id), [id]);
  assert.equal(invoke(['figure', 'visual', 'show', id], directory).code, 0);
  assert.equal(invoke(['figure', 'visual', 'verify', id], directory).code, 0);
  assert.equal(invoke([
    'figure', 'visual', 'list', '--status', 'pass', '--status', 'fail'
  ], directory).code, 2);
  assert.equal(invoke([
    'figure', 'visual', 'register', 'visual.json', '--chat', 'a', '--chat', 'b'
  ], directory).code, 2);
  assert.equal(invoke(['figure', 'visual', 'show', 'malformed'], directory).code, 2);
  assert.equal(invoke([
    'figure', 'visual', 'show', 'figure-visual-20260811T000000Z-deadbeef'
  ], directory).code, 1);
});
