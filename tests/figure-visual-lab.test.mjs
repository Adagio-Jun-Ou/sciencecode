import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFigureSemanticSidecar,
  buildLineageGraph,
  createChatSession,
  createFigureRegistration,
  encodeRgbaPng,
  listInteractions,
  runSimulation,
  startLab,
  verifyProject
} from '../lib/core.js';

const WIDTH = 128;
const HEIGHT = 96;
const LEFT = 20;
const TOP = 10;
const RIGHT = 117;
const BOTTOM = 85;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function contract() {
  return {
    chart_type: 'line_scatter',
    title: 'Lab decoded-pixel figure',
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

function profile() {
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
      line_width_pixels: 3,
      marker_radius_pixels: 3
    }],
    color_tolerance: 0,
    position_tolerance_pixels: 1,
    minimum_axis_coverage: 0.95,
    minimum_series_coverage: 0.95,
    maximum_unexpected_series_fraction: 0.02,
    minimum_background_fraction: 0.99
  };
}

function pixels() {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    rgba.set(color, (y * WIDTH + x) * 4);
  };
  const disk = (x, y, radius, color) => {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) set(x + dx, y + dy, color);
      }
    }
  };
  const line = (from, to, width, color) => {
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const stepX = from.x < to.x ? 1 : -1;
    const stepY = from.y < to.y ? 1 : -1;
    let error = dx - dy;
    while (true) {
      disk(x, y, Math.floor(width / 2), color);
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
  };
  const black = [0, 0, 0, 255];
  const red = [220, 30, 40, 255];
  line({ x: LEFT, y: BOTTOM }, { x: RIGHT, y: BOTTOM }, 3, black);
  line({ x: LEFT, y: TOP }, { x: LEFT, y: BOTTOM }, 3, black);
  const points = [
    { x: LEFT, y: BOTTOM },
    { x: Math.round((LEFT + RIGHT) / 2), y: Math.round((TOP + BOTTOM) / 2) },
    { x: RIGHT, y: TOP }
  ];
  for (let index = 1; index < points.length; index += 1) {
    line(points[index - 1], points[index], 3, red);
  }
  for (const point of points) disk(point.x, point.y, 3, red);
  return encodeRgbaPng({ width: WIDTH, height: HEIGHT, rgba });
}

function selector(simulation, name) {
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

function semanticRegistration(directory, chatId) {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("pixel lab")\n');
  const figure = pixels();
  const source = Buffer.from('x,y\n0,0\n5,5\n10,10\n');
  const simulation = runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: runtime(),
    gpuProbe: () => ({
      available: false, backend: 'nvidia', devices: [], error: 'test'
    }),
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed', device: { selected: 'cpu' }, seed: 0
      }));
      fs.writeFileSync(path.join(output, 'figure.png'), figure);
      fs.writeFileSync(path.join(output, 'data.csv'), source);
      fs.writeFileSync(path.join(output, 'figure.semantic.json'), JSON.stringify(
        buildFigureSemanticSidecar({
          figure,
          source,
          sourceName: 'data.csv',
          contract: contract()
        })
      ));
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
  return createFigureRegistration({
    cwd: directory,
    chatId,
    figure: selector(simulation, 'figure.png'),
    source: selector(simulation, 'data.csv'),
    sidecar: selector(simulation, 'figure.semantic.json'),
    contract: contract(),
    name: 'Lab decoded-pixel semantics'
  });
}

test('Lab records, serves, summarizes, and shares decoded-pixel figure validation',
  async (context) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sciencecode-figure-visual-lab-')
    );
    const chat = createChatSession({
      cwd: directory,
      title: 'Lab decoded-pixel figure',
      agent: 'scientist'
    });
    const registration = semanticRegistration(directory, chat.manifest.chat_id);
    const launched = startLab({
      cwd: directory,
      packageRoot,
      port: 0,
      computeProvider: () => ({
        ok: true,
        gpu: { available: false, devices: [], error: null },
        npu: { available: false, devices: [], error: null },
        runtime: runtime(),
        runtimes: { gpu: runtime(), npu: { healthy: false } },
        capabilities: {}
      })
    });
    const details = await launched.ready;
    context.after(() => new Promise((resolve) => launched.server.close(resolve)));
    const mutate = (url, body, origin = details.url) => fetch(details.url + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body)
    });
    const request = {
      schema_version: 1,
      chat_id: chat.manifest.chat_id,
      name: 'Lab visual validation',
      note: 'Require expected line, markers, axes, and background.',
      figure_registration_id: registration.figure_registration_id,
      profile: profile()
    };

    assert.equal((await mutate(
      '/api/figure-visuals',
      request,
      'https://untrusted.example'
    )).status, 403);
    assert.equal((await mutate('/api/figure-visuals', {
      ...request,
      misspelled_profile: true
    })).status, 400);

    const createdResponse = await mutate('/api/figure-visuals', request);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.visual.report.status, 'pass');
    assert.equal(created.visual.report.visual_status, 'conforming');
    assert.equal(created.visual.report.summary.failed_checks, 0);
    assert.equal(created.interaction.action, 'visual.created');
    const id = created.visual.figure_visual_id;

    const listed = await fetch(details.url + '/api/figure-visuals?registration=' +
      encodeURIComponent(registration.figure_registration_id) + '&status=pass');
    assert.equal(listed.status, 200);
    const listPayload = await listed.json();
    assert.equal(listPayload.summary.conforming, 1);
    assert.equal(listPayload.figure_visuals[0].figure_visual_id, id);
    assert.equal((await fetch(details.url +
      '/api/figure-visuals?status=maybe')).status, 400);
    assert.equal((await fetch(details.url +
      '/api/figure-visuals/malformed')).status, 400);
    assert.equal((await fetch(details.url +
      '/api/figure-visuals/figure-visual-20260811T000000Z-deadbeef')).status, 404);

    const detail = await fetch(details.url + '/api/figure-visuals/' +
      encodeURIComponent(id));
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).verification.ok, true);
    const report = await fetch(details.url + '/figure-visual-artifact/' +
      encodeURIComponent(id) + '/report.json');
    assert.equal(report.status, 200);
    assert.equal((await report.json()).visual_status, 'conforming');
    assert.equal((await fetch(details.url + '/figure-visual-artifact/' +
      encodeURIComponent(id) + '/undeclared.json')).status, 404);

    const state = await (await fetch(details.url + '/api/state?refresh=1')).json();
    assert.equal(state.counts.figure_visuals, 1);
    assert.equal(state.counts.conforming_figure_visuals, 1);
    assert.equal(state.figure_visuals[0].figure_visual_id, id);
    const harness = await (await fetch(details.url + '/api/chats/' +
      encodeURIComponent(chat.manifest.chat_id) + '/harness')).json();
    assert.equal(harness.board.figure_visuals.length, 1);
    assert.equal(harness.board.validation.conforming_figure_visuals, 1);
    assert.equal(listInteractions(directory, chat.manifest.chat_id).length, 1);
    const lineage = buildLineageGraph(directory);
    assert.ok(lineage.nodes.some((node) =>
      node.type === 'figure-visual' && node.record_id === id
    ));
    assert.ok(lineage.edges.some((edge) =>
      edge.relation === 'visually_validated_by' &&
      edge.target.includes(encodeURIComponent(id))
    ));
    assert.equal(verifyProject(directory).ok, true);

    const appSource = await (await fetch(details.url + '/app.js')).text();
    assert.match(appSource, /figure_visuals/);
    assert.match(appSource, /\/api\/figure-visuals/);
    assert.match(appSource, /Validate drawn pixels/);
    assert.match(appSource, /does not OCR titles/);
  });
