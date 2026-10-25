import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatSession, getChatSession } from '../lib/chats.js';
import { runCli } from '../lib/cli.js';
import {
  analyzeFigureComparison,
  createFigureComparison,
  figureComparisonInteractionArtifact,
  figureComparisonInteractionPayload,
  listFigureComparisons,
  normalizeFigureComparisonSettings,
  resolveFigureComparisonArtifact,
  verifyFigureComparison
} from '../lib/figure-comparisons.js';
import { buildHarnessView } from '../lib/harness.js';
import { interactionAwarePrompt, recordInteraction } from '../lib/interactions.js';
import { buildLineageGraph } from '../lib/lineage.js';
import { decodePng, encodeRgbaPng } from '../lib/png.js';
import { verifyProject } from '../lib/project.js';
import { runSimulation } from '../lib/simulations.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeRuntime() {
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

function figure(width, height, values) {
  return encodeRgbaPng({
    width,
    height,
    rgba: Buffer.from(values)
  });
}

function solidFigure(width, height, value) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return figure(width, height, rgba);
}

function recordedFigure(directory, png) {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("figure")\n');
  return runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: fakeRuntime(),
    gpuProbe: () => ({
      available: false,
      backend: 'nvidia',
      devices: [],
      error: 'test'
    }),
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(
        path.join(output, 'simulation-context.json'),
        JSON.stringify({
          status: 'completed',
          device: { selected: 'cpu' },
          seed: 0
        })
      );
      fs.writeFileSync(path.join(output, 'figure.png'), png);
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
}

function sourceFor(simulation) {
  return {
    kind: 'simulation',
    record_id: simulation.manifest.simulation_id,
    name: 'figure.png',
    url: '/artifact/' +
      encodeURIComponent(simulation.manifest.simulation_id) + '/figure.png',
    sha256: simulation.manifest.artifacts['artifacts/figure.png'].sha256
  };
}

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

test('bounded PNG codec round-trips RGBA pixels and rejects corruption', () => {
  const pixels = Buffer.from([
    0, 20, 40, 255,
    60, 80, 100, 128,
    120, 140, 160, 64,
    180, 200, 220, 0
  ]);
  const encoded = encodeRgbaPng({ width: 2, height: 2, rgba: pixels });
  const decoded = decodePng(encoded);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(decoded.rgba, pixels);

  const corrupted = Buffer.from(encoded);
  corrupted[corrupted.length - 5] ^= 1;
  assert.throws(() => decodePng(corrupted), {
    code: 'PNG_CRC_MISMATCH'
  });
});

test('block luminance structural similarity is frozen, optional, and versioned', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-structural-')
  );
  const black = recordedFigure(directory, solidFigure(8, 8, 0));
  const exactRerun = recordedFigure(directory, solidFigure(8, 8, 0));
  const white = recordedFigure(directory, solidFigure(8, 8, 255));

  const exact = createFigureComparison({
    cwd: directory,
    baseline: sourceFor(black),
    candidate: sourceFor(exactRerun),
    pixelTolerance: 255,
    maximumChangedFraction: 0,
    minimumStructuralSimilarity: 1
  });
  assert.equal(exact.manifest.schema_version, 2);
  assert.equal(exact.report.engine_version, 2);
  assert.equal(exact.report.status, 'pass');
  assert.equal(
    exact.report.metrics.structural_similarity.mean_structural_similarity,
    1
  );
  assert.equal(exact.report.summary.structural_similarity_rule_pass, true);

  const strict = createFigureComparison({
    cwd: directory,
    baseline: sourceFor(black),
    candidate: sourceFor(white),
    pixelTolerance: 255,
    maximumChangedFraction: 0,
    minimumStructuralSimilarity: 1
  });
  assert.equal(strict.report.summary.pixel_rule_pass, true);
  assert.equal(strict.report.summary.structural_similarity_rule_pass, false);
  assert.deepEqual(strict.report.summary.failed_rules, [
    'structural_similarity'
  ]);
  assert.equal(strict.report.status, 'fail');
  assert.equal(strict.report.reproduction_status, 'different');
  assert.ok(
    strict.report.metrics.structural_similarity.mean_structural_similarity < 1
  );
  assert.deepEqual(
    strict.report.metrics.structural_similarity.worst_block,
    {
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      structural_similarity:
        strict.report.metrics.structural_similarity
          .mean_structural_similarity
    }
  );
  assert.equal(verifyFigureComparison(
    directory,
    strict.figure_comparison_id
  ).ok, true);

  const relaxed = createFigureComparison({
    cwd: directory,
    baseline: sourceFor(black),
    candidate: sourceFor(white),
    pixelTolerance: 255,
    maximumChangedFraction: 0,
    minimumStructuralSimilarity: 0
  });
  assert.equal(relaxed.report.status, 'pass');
  assert.equal(relaxed.report.reproduction_status, 'within_tolerance');
  assert.equal(relaxed.report.summary.structural_similarity_rule_pass, true);

  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.structural_figure_comparisons, 3);
  assert.equal(gate.counts.structural_figure_comparisons_passing, 2);
  assert.throws(() => createFigureComparison({
    cwd: directory,
    baseline: sourceFor(black),
    candidate: sourceFor(white),
    minimumStructuralSimilarity: 1.01
  }), /Minimum structural similarity/);

  const baselineImage = decodePng(solidFigure(1, 1, 0));
  const candidateImage = decodePng(solidFigure(1, 1, 255));
  const legacy = analyzeFigureComparison({
    baseline: baselineImage,
    candidate: candidateImage,
    baselineTarget: { url: '/legacy-a.png', sha256: 'a', bytes: 1 },
    candidateTarget: { url: '/legacy-b.png', sha256: 'b', bytes: 1 },
    settings: normalizeFigureComparisonSettings({
      engineVersion: 1,
      pixelTolerance: 0,
      maximumChangedFraction: 0
    })
  });
  assert.equal(legacy.schema_version, 1);
  assert.equal(legacy.engine_version, 1);
  assert.equal(legacy.engine, 'sciencecode-bounded-png-pixel-comparison');
  assert.equal(legacy.metrics.structural_similarity, undefined);
  assert.equal(legacy.summary.failed_rules, undefined);
  assert.equal(legacy.settings.minimum_structural_similarity, undefined);

  const transparentBaseline = Buffer.alloc(9 * 9 * 4);
  const transparentCandidate = Buffer.alloc(9 * 9 * 4);
  for (let offset = 0; offset < transparentCandidate.length; offset += 4) {
    transparentCandidate[offset] = 255;
  }
  const matte = analyzeFigureComparison({
    baseline: decodePng(figure(9, 9, transparentBaseline)),
    candidate: decodePng(figure(9, 9, transparentCandidate)),
    baselineTarget: { url: '/matte-a.png', sha256: 'c', bytes: 1 },
    candidateTarget: { url: '/matte-b.png', sha256: 'd', bytes: 1 },
    settings: normalizeFigureComparisonSettings({
      pixelTolerance: 255,
      maximumChangedFraction: 0,
      minimumStructuralSimilarity: 1
    })
  });
  assert.equal(matte.status, 'pass');
  assert.equal(matte.reproduction_status, 'within_tolerance');
  assert.equal(matte.metrics.structural_similarity.block_count, 4);
  assert.equal(
    matte.metrics.structural_similarity.mean_structural_similarity,
    1
  );
  assert.equal(
    matte.metrics.structural_similarity.maximum_luminance_delta,
    0
  );

  const strictReportFile = resolveFigureComparisonArtifact(
    directory,
    strict.figure_comparison_id,
    'report.json'
  ).file;
  const tamperedReport = JSON.parse(fs.readFileSync(
    strictReportFile,
    'utf8'
  ));
  tamperedReport.settings.minimum_structural_similarity = 0;
  fs.writeFileSync(strictReportFile, JSON.stringify(tamperedReport, null, 2));
  const tamperedVerification = verifyFigureComparison(
    directory,
    strict.figure_comparison_id
  );
  assert.equal(tamperedVerification.ok, false);
  assert.ok(tamperedVerification.errors.some((error) =>
    error.issue === 'comparison_settings_mismatch'
  ));
  assert.ok(tamperedVerification.errors.some((error) =>
    error.issue === 'deterministic_recalculation_mismatch'
  ));
});

test('immutable figure comparisons replay exact and thresholded PNG metrics', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-comparison-')
  );
  const chat = createChatSession({
    cwd: directory,
    title: 'Figure rerun',
    agent: 'scientist'
  });
  const baselinePng = figure(2, 2, [
    0, 0, 0, 255,
    40, 50, 60, 255,
    90, 100, 110, 255,
    200, 210, 220, 255
  ]);
  const alteredPng = figure(2, 2, [
    2, 0, 0, 255,
    40, 50, 60, 255,
    90, 100, 110, 255,
    200, 210, 220, 255
  ]);
  const baseline = recordedFigure(directory, baselinePng);
  const exactRerun = recordedFigure(directory, baselinePng);
  const alteredRerun = recordedFigure(directory, alteredPng);

  const exact = createFigureComparison({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    baseline: sourceFor(baseline),
    candidate: sourceFor(exactRerun),
    name: 'Exact rerun'
  });
  assert.equal(exact.report.status, 'pass');
  assert.equal(exact.report.reproduction_status, 'exact');
  assert.equal(exact.report.metrics.exact_changed_pixels, 0);
  assert.equal(exact.verification.ok, true);
  const exactDifference = decodePng(fs.readFileSync(
    resolveFigureComparisonArtifact(
      directory,
      exact.figure_comparison_id,
      'pixel-difference.png'
    ).file
  ));
  assert.equal(exactDifference.rgba.every((value, index) =>
    index % 4 === 3 ? value === 255 : value === 0
  ), true);

  const failed = createFigureComparison({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    baseline: sourceFor(baseline),
    candidate: sourceFor(alteredRerun),
    pixelTolerance: 1,
    maximumChangedFraction: 0.24
  });
  assert.equal(failed.report.status, 'fail');
  assert.equal(failed.report.reproduction_status, 'different');
  assert.equal(failed.report.metrics.exact_changed_pixels, 1);
  assert.equal(failed.report.metrics.tolerance_exceeding_pixels, 1);
  assert.equal(failed.report.metrics.tolerance_exceeding_fraction, 0.25);
  assert.deepEqual(failed.report.metrics.changed_bounding_box, {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  });
  assert.equal(verifyFigureComparison(
    directory,
    failed.figure_comparison_id
  ).ok, true);

  const tolerated = createFigureComparison({
    cwd: directory,
    baseline: sourceFor(baseline),
    candidate: sourceFor(alteredRerun),
    pixelTolerance: 2,
    maximumChangedFraction: 0
  });
  assert.equal(tolerated.report.status, 'pass');
  assert.equal(tolerated.report.reproduction_status, 'within_tolerance');
  assert.equal(tolerated.report.metrics.tolerance_exceeding_pixels, 0);
  assert.equal(listFigureComparisons(directory).length, 3);

  const interaction = recordInteraction({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    surface: 'figure',
    action: 'comparison.inspected',
    artifact: figureComparisonInteractionArtifact(failed),
    payload: figureComparisonInteractionPayload(failed, {
      selected_region: { x: 0, y: 0, width: 1, height: 1 },
      blend: 0.65,
      difference_gain: 6,
      note: 'Inspect the changed upper-left pixel before accepting the rerun.'
    })
  });
  const prompt = interactionAwarePrompt({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    message: 'Explain the rerun discrepancy.'
  });
  assert.match(prompt.prompt, /Recorded figure rerun comparison/);
  assert.match(prompt.prompt, /changed fraction 0\.25 at RGBA tolerance 1/);
  assert.match(prompt.prompt, /user inspected pixel region 0,0,1,1/);
  assert.match(prompt.prompt, /decoded-pixel and optional structural-similarity/);
  assert.match(prompt.prompt, /block luminance SSIM/);
  assert.match(prompt.prompt, /worst SSIM block/);

  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.figure_comparisons, 3);
  assert.equal(gate.counts.verified_figure_comparisons, 3);
  assert.equal(gate.counts.exact_figure_comparisons, 1);
  assert.equal(gate.counts.figure_comparisons_needing_attention, 1);

  const lineage = buildLineageGraph(directory);
  const comparisonNode = 'figure-comparison:' + failed.figure_comparison_id;
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) => node.id === comparisonNode));
  assert.equal(lineage.edges.filter((edge) =>
    edge.target === comparisonNode && edge.relation === 'compared_by'
  ).length, 2);
  assert.ok(lineage.edges.some((edge) =>
    edge.source === comparisonNode &&
    edge.target === 'interaction:' + interaction.interaction_id &&
    edge.relation === 'revised_as'
  ));

  const harness = buildHarnessView({
    cwd: directory,
    chat: {
      ...getChatSession(directory, chat.manifest.chat_id),
      verification: { ok: true, errors: [] }
    },
    figureComparisons: listFigureComparisons(directory)
  });
  assert.equal(harness.board.figure_comparisons.length, 2);
  assert.equal(harness.board.validation.verified_figure_comparisons, 2);
  assert.equal(harness.board.validation.figure_comparisons_needing_attention, 1);
  assert.ok(harness.activity.some((event) =>
    event.type === 'figure.comparison.different'
  ));

  const cliCreated = invoke([
    'figure', 'compare', sourceFor(baseline).url, sourceFor(exactRerun).url,
    '--chat', chat.manifest.chat_id,
    '--name', 'CLI exact rerun',
    '--pixel-tolerance', '0',
    '--max-changed-fraction', '0',
    '--min-structural-similarity', '1'
  ], directory);
  assert.equal(cliCreated.code, 0, cliCreated.stderr);
  const cliPayload = JSON.parse(cliCreated.stdout);
  assert.equal(cliPayload.comparison.report.reproduction_status, 'exact');
  assert.equal(
    cliPayload.comparison.report.settings.minimum_structural_similarity,
    1
  );
  assert.equal(
    cliPayload.comparison.report.metrics.structural_similarity
      .mean_structural_similarity,
    1
  );
  assert.equal(cliPayload.interaction.action, 'comparison.created');
  const cliId = cliPayload.comparison.figure_comparison_id;
  assert.equal(invoke(['figure', 'verify', cliId], directory).code, 0);
  assert.equal(JSON.parse(invoke([
    'figure', 'list', '--chat', chat.manifest.chat_id, '--json'
  ], directory).stdout).length, 3);
  assert.match(invoke(['figure', 'help'], directory).stdout,
    /revision:ID/);
  const invalidCli = invoke([
    'figure', 'compare', 'not-a-local-url', sourceFor(exactRerun).url
  ], directory);
  assert.equal(invalidCli.code, 2);
  assert.match(invalidCli.stderr, /Lab artifact URLs/);
  assert.throws(() => createFigureComparison({
    cwd: directory,
    baseline: sourceFor(baseline),
    candidate: sourceFor(baseline)
  }), { code: 'FIGURE_COMPARISON_SAME_SOURCE' });
});

test('figure comparison records preserve incompatible outcomes and detect tampering', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-comparison-tamper-')
  );
  const baseline = recordedFigure(directory, figure(1, 1, [
    0, 0, 0, 255
  ]));
  const candidate = recordedFigure(directory, figure(2, 1, [
    0, 0, 0, 255,
    0, 0, 0, 255
  ]));
  const comparison = createFigureComparison({
    cwd: directory,
    baseline: sourceFor(baseline),
    candidate: sourceFor(candidate)
  });
  assert.equal(comparison.report.status, 'fail');
  assert.equal(
    comparison.report.reproduction_status,
    'incompatible_dimensions'
  );
  assert.equal(comparison.report.metrics, null);
  assert.equal(
    comparison.manifest.artifacts['pixel-difference.png'],
    undefined
  );
  assert.equal(comparison.verification.ok, true);

  const report = resolveFigureComparisonArtifact(
    directory,
    comparison.figure_comparison_id,
    'report.json'
  ).file;
  fs.appendFileSync(report, '\n');
  const verification = verifyFigureComparison(
    directory,
    comparison.figure_comparison_id
  );
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) =>
    error.file === 'report.json' && error.issue === 'hash_mismatch'
  ));
});
