import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFigureSemanticSidecar,
  createChatSession,
  encodeRgbaPng,
  listInteractions,
  runSimulation,
  startLab,
  verifyProject
} from '../lib/core.js';

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
    chart_type: 'line',
    title: 'Lab semantic figure',
    x_axis: {
      column: 'time_ms',
      label: 'Time',
      source_unit: { symbol: 'ms' },
      display_unit: { symbol: 's' },
      scale: 'linear'
    },
    y_axis: {
      label: 'Signal',
      display_unit: { symbol: 'ms' },
      scale: 'linear'
    },
    series: [{
      id: 'signal',
      column: 'signal_V',
      label: 'Signal',
      source_unit: { symbol: 's' }
    }],
    missing_value_policy: 'error',
    row_order: 'source',
    duplicate_x_policy: 'error',
    sampling: { method: 'all' },
    aggregation: 'none'
  };
}

function recordedBundle(directory) {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("lab semantics")\n');
  const figure = encodeRgbaPng({
    width: 1,
    height: 1,
    rgba: Buffer.from([12, 24, 36, 255])
  });
  const source = Buffer.from('time_ms,signal_V\n0,0.001\n1000,0.002\n');
  return runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: runtime(),
    gpuProbe: () => ({
      available: false, backend: 'nvidia', devices: [], error: 'test'
    }),
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      const sidecar = buildFigureSemanticSidecar({
        figure,
        source,
        sourceName: 'data.csv',
        contract: contract()
      });
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed', device: { selected: 'cpu' }, seed: 0
      }));
      fs.writeFileSync(path.join(output, 'figure.png'), figure);
      fs.writeFileSync(path.join(output, 'data.csv'), source);
      fs.writeFileSync(path.join(output, 'figure.semantic.json'),
        JSON.stringify(sidecar));
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
}

function selector(simulation, name) {
  return {
    kind: 'simulation',
    record_id: simulation.manifest.simulation_id,
    name,
    url: '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) +
      '/' + encodeURIComponent(name),
    sha256: simulation.manifest.artifacts['artifacts/' + name].sha256
  };
}

test('Lab registers, serves, summarizes, and shares semantic figure replay', async (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-registration-lab-')
  );
  const chat = createChatSession({
    cwd: directory,
    title: 'Lab semantic figure',
    agent: 'scientist'
  });
  const simulation = recordedBundle(directory);
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
    name: 'Lab registered signal',
    note: 'Require exact source and conversion replay.',
    figure: selector(simulation, 'figure.png'),
    source: selector(simulation, 'data.csv'),
    sidecar: selector(simulation, 'figure.semantic.json'),
    contract: contract()
  };

  const crossOrigin = await mutate(
    '/api/figure-registrations',
    request,
    'https://untrusted.example'
  );
  assert.equal(crossOrigin.status, 403);
  const unknown = await mutate('/api/figure-registrations', {
    ...request,
    misspelled_contract: true
  });
  assert.equal(unknown.status, 400);

  const createdResponse = await mutate('/api/figure-registrations', request);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.registration.report.status, 'pass');
  assert.equal(created.registration.report.summary.converted_axes, 2);
  assert.equal(created.interaction.action, 'registration.created');
  const id = created.registration.figure_registration_id;

  const listed = await fetch(details.url + '/api/figure-registrations?status=pass');
  assert.equal(listed.status, 200);
  const listPayload = await listed.json();
  assert.equal(listPayload.summary.matched, 1);
  assert.equal(listPayload.figure_registrations[0].figure_registration_id, id);
  assert.equal((await fetch(details.url +
    '/api/figure-registrations?status=maybe')).status, 400);

  const detail = await fetch(details.url + '/api/figure-registrations/' +
    encodeURIComponent(id));
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).verification.ok, true);
  const report = await fetch(details.url + '/figure-registration-artifact/' +
    encodeURIComponent(id) + '/report.json');
  assert.equal(report.status, 200);
  assert.equal((await report.json()).registration_status, 'matched');
  assert.equal((await fetch(details.url + '/figure-registration-artifact/' +
    encodeURIComponent(id) + '/undeclared.json')).status, 404);

  const state = await (await fetch(details.url + '/api/state?refresh=1')).json();
  assert.equal(state.counts.figure_registrations, 1);
  assert.equal(state.counts.matched_figure_registrations, 1);
  assert.equal(state.figure_registrations[0].figure_registration_id, id);
  const harness = await (await fetch(details.url + '/api/chats/' +
    encodeURIComponent(chat.manifest.chat_id) + '/harness')).json();
  assert.equal(harness.board.figure_registrations.length, 1);
  assert.equal(harness.board.validation.matched_figure_registrations, 1);
  assert.equal(listInteractions(directory, chat.manifest.chat_id).length, 1);
  assert.equal(verifyProject(directory).ok, true);

  const appSource = await (await fetch(details.url + '/app.js')).text();
  assert.match(appSource, /figure_registrations/);
  assert.match(appSource, /\/api\/figure-registrations/);
  assert.match(appSource, /Register semantics/);
});
