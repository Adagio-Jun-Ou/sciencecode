import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatSession,
  encodeRgbaPng,
  interactionAwarePrompt,
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
    manifest: { schema_version: 1, packages: ['numpy==2.3.5'] },
    probe: {
      python: '3.11.9',
      torch: { version: '2.12.0', cuda_available: false }
    }
  };
}

function png(red) {
  return encodeRgbaPng({
    width: 2,
    height: 2,
    rgba: Buffer.from([
      red, 0, 0, 255,
      30, 40, 50, 255,
      60, 70, 80, 255,
      90, 100, 110, 255
    ])
  });
}

function recordedFigure(directory, value) {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("lab figure")\n');
  return runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: runtime(),
    gpuProbe: () => ({ available: false, backend: 'nvidia', devices: [], error: 'test' }),
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed', device: { selected: 'cpu' }, seed: 0
      }));
      fs.writeFileSync(path.join(output, 'figure.png'), value);
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
}

function sourceFor(simulation) {
  return {
    kind: 'simulation',
    record_id: simulation.manifest.simulation_id,
    name: 'figure.png',
    url: '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) + '/figure.png',
    sha256: simulation.manifest.artifacts['artifacts/figure.png'].sha256
  };
}

test('Lab creates, serves, visualizes, and shares verified figure comparisons', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-figure-lab-'));
  const chat = createChatSession({ cwd: directory, title: 'Figure rerun', agent: 'scientist' });
  const baseline = recordedFigure(directory, png(0));
  const candidate = recordedFigure(directory, png(4));
  const baselineSource = sourceFor(baseline);
  const candidateSource = sourceFor(candidate);

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
    chat_id: chat.manifest.chat_id,
    baseline: baselineSource,
    candidate: candidateSource,
    name: 'Lab pixel rerun',
    note: 'Expected an exact rerun.',
    pixel_tolerance: 1,
    maximum_changed_fraction: 0,
    minimum_structural_similarity: 1
  };

  const crossOrigin = await mutate('/api/figure-comparisons', request,
    'https://untrusted.example');
  assert.equal(crossOrigin.status, 403);

  const sameSource = await mutate('/api/figure-comparisons', {
    ...request,
    candidate: baselineSource
  });
  assert.equal(sameSource.status, 400);

  const createdResponse = await mutate('/api/figure-comparisons', request);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.comparison.report.status, 'fail');
  assert.equal(created.comparison.report.reproduction_status, 'different');
  assert.equal(created.comparison.report.metrics.tolerance_exceeding_pixels, 1);
  assert.ok(created.comparison.report.metrics.structural_similarity
    .mean_structural_similarity < 1);
  assert.equal(
    created.comparison.report.summary.structural_similarity_rule_pass,
    false
  );
  assert.equal(created.comparison.verification.ok, true);
  assert.equal(created.interaction.action, 'comparison.created');
  const comparisonId = created.comparison.figure_comparison_id;

  const listResponse = await fetch(details.url + '/api/figure-comparisons?chat=' +
    encodeURIComponent(chat.manifest.chat_id));
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.summary.count, 1);
  assert.equal(listed.summary.different, 1);
  assert.equal(listed.summary.structural_checked, 1);
  assert.equal(listed.summary.structural_passing, 0);
  assert.equal(listed.figure_comparisons[0].verified, true);

  const detailResponse = await fetch(details.url + '/api/figure-comparisons/' +
    encodeURIComponent(comparisonId));
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.verification.ok, true);
  assert.ok(detail.artifacts['baseline.png'].url);
  assert.ok(detail.artifacts['candidate.png'].url);
  assert.ok(detail.artifacts['pixel-difference.png'].url);

  for (const name of ['baseline.png', 'candidate.png', 'pixel-difference.png', 'report.json']) {
    const artifact = await fetch(details.url + detail.artifacts[name].url);
    assert.equal(artifact.status, 200, name);
    assert.ok((await artifact.arrayBuffer()).byteLength > 0, name);
  }
  const unrecorded = await fetch(details.url + '/figure-comparison-artifact/' +
    encodeURIComponent(comparisonId) + '/unrecorded.png');
  assert.equal(unrecorded.status, 404);

  const inspectedResponse = await mutate('/api/chats/' +
    encodeURIComponent(chat.manifest.chat_id) + '/interactions', {
    surface: 'figure',
    action: 'comparison.inspected',
    artifact: {
      kind: 'figure-comparison',
      record_id: comparisonId,
      name: 'Lab pixel rerun',
      url: '/api/figure-comparisons/' + encodeURIComponent(comparisonId)
    },
    payload: {
      figure_comparison_id: comparisonId,
      status: detail.report.status,
      reproduction_status: detail.report.reproduction_status,
      baseline_sha256: detail.manifest.baseline.sha256,
      candidate_sha256: detail.manifest.candidate.sha256,
      settings: detail.report.settings,
      dimensions: detail.report.dimensions,
      metrics: detail.report.metrics,
      selected_region: { x: 0, y: 0, width: 1, height: 1 },
      view_mode: 'difference',
      blend: 0.5,
      difference_gain: 6,
      note: 'The changed pixel is confined to the upper-left corner.'
    }
  });
  assert.equal(inspectedResponse.status, 201);
  assert.equal(listInteractions(directory, chat.manifest.chat_id).length, 2);
  const aiContext = interactionAwarePrompt({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    message: 'Interpret my comparison inspection.'
  });
  assert.match(aiContext.prompt, /user inspected pixel region 0,0,1,1/);
  assert.match(aiContext.prompt, /upper-left corner/);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.figure_comparisons, 1);
  assert.equal(state.counts.verified_figure_comparisons, 1);
  assert.equal(state.counts.figure_comparisons_needing_attention, 1);
  assert.equal(state.counts.structural_figure_comparisons, 1);
  assert.equal(state.counts.structural_figure_comparisons_passing, 0);
  const harness = await (await fetch(details.url + '/api/chats/' +
    encodeURIComponent(chat.manifest.chat_id) + '/harness')).json();
  assert.equal(harness.board.figure_comparisons.length, 1);
  assert.equal(harness.board.validation.figure_comparisons_needing_attention, 1);
  assert.equal(harness.board.validation.structural_figure_comparisons, 1);
  assert.equal(
    harness.board.validation.structural_figure_comparisons_passing,
    0
  );
  const lineage = await (await fetch(details.url + '/api/lineage?chat=' +
    encodeURIComponent(chat.manifest.chat_id))).json();
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'figure-comparison' && node.record_id === comparisonId
  ));

  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.figure_comparisons, 1);

  const appSource = await (await fetch(details.url + '/app.js')).text();
  assert.match(appSource, /appendFigureComparisonStudio/);
  assert.match(appSource, /renderFigureComparisonResult/);
  assert.match(appSource, /comparison\.inspected/);
  assert.match(appSource, /MIN BLOCK SSIM/);
  assert.match(appSource, /Block luminance SSIM/);
  const styles = await (await fetch(details.url + '/styles.css')).text();
  assert.match(styles, /\.figure-comparison-viewer/);
  assert.match(styles, /\.comparison-region/);
});
