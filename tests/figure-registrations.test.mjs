import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatSession, getChatSession } from '../lib/chats.js';
import { runCli } from '../lib/cli.js';
import {
  analyzeFigureRegistration,
  buildFigureSemanticSidecar,
  createFigureRegistration,
  figureRegistrationInteractionArtifact,
  figureRegistrationInteractionPayload,
  listFigureRegistrations,
  MAX_FIGURE_REGISTRATIONS,
  MAX_FIGURE_REGISTRATION_MANIFEST_BYTES,
  MAX_FIGURE_SEMANTIC_REPORT_BYTES,
  MAX_FIGURE_SEMANTIC_SIDECAR_BYTES,
  MAX_FIGURE_SEMANTIC_SOURCE_BYTES,
  MAX_FIGURE_SERIES,
  MAX_FIGURE_TABLE_COLUMNS,
  MAX_FIGURE_TABLE_ROWS,
  normalizeFigureRegistrationSpec,
  normalizeFigureSemanticContract,
  normalizeFigureSemanticSidecar,
  parseFigureSemanticTable,
  projectFigureSemanticData,
  replayFigureSemanticData,
  resolveFigureRegistrationArtifact,
  resolveFigureRegistrationDirectory,
  verifyFigureRegistration
} from '../lib/figure-registrations.js';
import { buildHarnessView } from '../lib/harness.js';
import { interactionAwarePrompt, recordInteraction } from '../lib/interactions.js';
import { buildLineageGraph } from '../lib/lineage.js';
import { encodeRgbaPng } from '../lib/png.js';
import { verifyProject } from '../lib/project.js';
import { runSimulation } from '../lib/simulations.js';
import { sha256Json } from '../lib/hash.js';

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

function png(red = 0) {
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

function contract(overrides = {}) {
  return {
    chart_type: 'line_scatter',
    title: 'Response over time',
    x_axis: {
      column: 'time_ms',
      label: 'Time',
      source_unit: { symbol: 'ms' },
      display_unit: { symbol: 's' },
      scale: 'linear'
    },
    y_axis: {
      label: 'Response',
      display_unit: { symbol: 's' },
      scale: 'linear'
    },
    series: [
      {
        id: 'response_a',
        column: 'response_s',
        label: 'Response A',
        source_unit: { symbol: 's' }
      },
      {
        id: 'response_b',
        column: 'response_ms',
        label: 'Response B',
        source_unit: { symbol: 'ms' }
      }
    ],
    missing_value_policy: 'drop_row',
    row_order: 'x_ascending',
    duplicate_x_policy: 'error',
    sampling: { method: 'evenly_spaced', maximum_points: 3 },
    aggregation: 'none',
    ...overrides
  };
}

function sourceText() {
  return [
    'time_ms,response_s,response_ms,note',
    '3000,4,4000,"last, observed"',
    '0,1,1000,start',
    '1000,,,missing',
    '2000,3,3000,middle',
    '4000,5,5000,end',
    ''
  ].join('\n');
}

function recordedBundle(directory, {
  semanticContract = contract(),
  csv = sourceText(),
  figure = png(),
  mutateSidecar = (value) => value
} = {}) {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("semantic figure")\n');
  return runSimulation({
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
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      const source = Buffer.from(csv);
      const sidecar = mutateSidecar(buildFigureSemanticSidecar({
        figure,
        source,
        sourceName: 'data.csv',
        contract: semanticContract
      }));
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        device: { selected: 'cpu' },
        seed: 0
      }));
      fs.writeFileSync(path.join(output, 'figure.png'), figure);
      fs.writeFileSync(path.join(output, 'data.csv'), source);
      fs.writeFileSync(
        path.join(output, 'figure.semantic.json'),
        JSON.stringify(sidecar)
      );
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

function specFor(simulation, semanticContract = contract()) {
  return {
    schema_version: 1,
    name: 'Registered response figure',
    note: 'Check the producer declaration against the immutable table.',
    figure: selector(simulation, 'figure.png'),
    source: selector(simulation, 'data.csv'),
    sidecar: selector(simulation, 'figure.semantic.json'),
    contract: semanticContract
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

test('semantic figure replay freezes columns, units, row policy, order, and sampling', () => {
  const normalized = normalizeFigureSemanticContract(contract());
  assert.deepEqual(normalized.x_axis.source_unit, {
    symbol: 'ms', dimension: 'time', canonical_unit: 's'
  });
  assert.deepEqual(normalized.y_axis.display_unit, {
    symbol: 's', dimension: 'time', canonical_unit: 's'
  });
  const table = parseFigureSemanticTable(Buffer.from(sourceText()), {
    name: 'data.csv'
  });
  assert.deepEqual(table.header, [
    'time_ms', 'response_s', 'response_ms', 'note'
  ]);
  assert.equal(table.rows.length, 5);

  const replay = replayFigureSemanticData({
    source: Buffer.from(sourceText()),
    sourceName: 'data.csv',
    contract: normalized
  });
  const projected = projectFigureSemanticData({
    source: Buffer.from(sourceText()),
    sourceName: 'data.csv',
    contract: normalized
  });
  assert.deepEqual(projected.points, [
    { source_row: 3, x: 0, y: [1, 1] },
    { source_row: 2, x: 3, y: [4, 4] },
    { source_row: 6, x: 4, y: [5, 5] }
  ]);
  assert.equal(Object.hasOwn(projected, 'rows'), false);
  assert.equal(JSON.stringify(projected).includes('last, observed'), false);
  assert.equal(replay.data_row_count, 5);
  assert.equal(replay.complete_row_count, 4);
  assert.equal(replay.dropped_row_count, 1);
  assert.equal(replay.plotted_point_count, 3);
  assert.equal(replay.sampled, true);
  assert.deepEqual(
    [replay.x_axis.minimum, replay.x_axis.maximum],
    [0, 4]
  );
  assert.equal(replay.x_axis.converted, true);
  assert.deepEqual(
    replay.series.map((item) => [item.id, item.minimum, item.maximum, item.converted]),
    [
      ['response_a', 1, 5, false],
      ['response_b', 1, 5, true]
    ]
  );
  assert.equal(replay.series[0].data_sha256, replay.series[1].data_sha256);
  assert.equal(
    replay.plotted_data_sha256,
    replayFigureSemanticData({
      source: Buffer.from(sourceText()),
      sourceName: 'data.csv',
      contract: normalized
    }).plotted_data_sha256
  );
});

test('semantic figure contracts and tables fail closed on ambiguity and bad numerics', () => {
  assert.throws(() => normalizeFigureSemanticContract({
    ...contract(),
    hidden: true
  }), { code: 'INVALID_FIGURE_SEMANTIC_CONTRACT' });
  assert.throws(() => normalizeFigureSemanticContract({
    ...contract(),
    x_axis: {
      ...contract().x_axis,
      display_unit: { symbol: 'kg' }
    }
  }), { code: 'INVALID_FIGURE_SEMANTIC_CONTRACT' });
  assert.throws(() => normalizeFigureSemanticContract({
    ...contract(),
    series: [contract().series[0], {
      ...contract().series[1],
      id: 'response_a'
    }]
  }), { code: 'INVALID_FIGURE_SEMANTIC_CONTRACT' });
  assert.throws(() => normalizeFigureSemanticContract({
    ...contract(),
    sampling: { method: 'all', maximum_points: 5 }
  }), { code: 'INVALID_FIGURE_SEMANTIC_CONTRACT' });
  assert.throws(() => parseFigureSemanticTable(
    Buffer.from('x,x\n1,2\n'),
    { name: 'data.csv' }
  ), { code: 'INVALID_FIGURE_SEMANTIC_DATA' });
  assert.throws(() => parseFigureSemanticTable(
    Buffer.from('x,y\n"unterminated,2\n'),
    { name: 'data.csv' }
  ), { code: 'INVALID_FIGURE_SEMANTIC_DATA' });
  assert.throws(() => replayFigureSemanticData({
    source: Buffer.from('time_ms,response_s,response_ms\n0,1,NaN\n'),
    sourceName: 'data.csv',
    contract: contract({ sampling: { method: 'all' } })
  }), { code: 'INVALID_FIGURE_SEMANTIC_DATA' });
  assert.throws(() => replayFigureSemanticData({
    source: Buffer.from(
      'time_ms,response_s,response_ms\n0,1,1000\n0,2,2000\n'
    ),
    sourceName: 'data.csv',
    contract: contract({ sampling: { method: 'all' } })
  }), /duplicate after unit conversion/);
  assert.throws(() => replayFigureSemanticData({
    source: Buffer.from('time_ms,response_s,response_ms\n0,0,0\n'),
    sourceName: 'data.csv',
    contract: contract({
      y_axis: { ...contract().y_axis, scale: 'log10' },
      sampling: { method: 'all' }
    })
  }), /log10 scale requires positive/);
  assert.throws(() => normalizeFigureRegistrationSpec({
    ...specFor({
      manifest: {
        simulation_id: 'simulation-fake',
        artifacts: {
          'artifacts/figure.png': { sha256: 'a'.repeat(64) },
          'artifacts/data.csv': { sha256: 'b'.repeat(64) },
          'artifacts/figure.semantic.json': { sha256: 'c'.repeat(64) }
        }
      }
    }),
    typo: true
  }), { code: 'INVALID_FIGURE_REGISTRATION' });
  assert.throws(() => normalizeFigureRegistrationSpec({
    ...specFor({
      manifest: {
        simulation_id: 'simulation-fake',
        artifacts: {
          'artifacts/figure.png': { sha256: 'a'.repeat(64) },
          'artifacts/data.csv': { sha256: 'b'.repeat(64) },
          'artifacts/figure.semantic.json': { sha256: 'c'.repeat(64) }
        }
      }
    }),
    figure: {
      ...specFor({
        manifest: {
          simulation_id: 'simulation-fake',
          artifacts: {
            'artifacts/figure.png': { sha256: 'a'.repeat(64) },
            'artifacts/data.csv': { sha256: 'b'.repeat(64) },
            'artifacts/figure.semantic.json': { sha256: 'c'.repeat(64) }
          }
        }
      }).figure,
      untrusted: true
    }
  }), { code: 'INVALID_FIGURE_REGISTRATION' });
});

test('semantic figure byte, shape, series, sidecar, and project-count ceilings fail closed', () => {
  assert.throws(() => parseFigureSemanticTable(
    Buffer.alloc(MAX_FIGURE_SEMANTIC_SOURCE_BYTES + 1, 0x61),
    { name: 'data.csv' }
  ), { code: 'FIGURE_SEMANTIC_SOURCE_TOO_LARGE' });

  const tooManyColumns = Array.from(
    { length: MAX_FIGURE_TABLE_COLUMNS + 1 },
    (_, index) => 'column_' + index
  );
  assert.throws(() => parseFigureSemanticTable(Buffer.from(
    tooManyColumns.join(',') + '\n' +
    tooManyColumns.map(() => '1').join(',') + '\n'
  )), { code: 'FIGURE_SEMANTIC_SOURCE_TOO_LARGE' });

  assert.throws(() => parseFigureSemanticTable(Buffer.from(
    'x,y\n' + '1,2\n'.repeat(MAX_FIGURE_TABLE_ROWS + 1)
  )), { code: 'FIGURE_SEMANTIC_SOURCE_TOO_LARGE' });

  const boundedSeries = Array.from({ length: MAX_FIGURE_SERIES }, (_, index) => ({
    id: 'series_' + index,
    column: 'value_' + index,
    label: 'Series ' + index,
    source_unit: { symbol: 's' }
  }));
  assert.equal(normalizeFigureSemanticContract(contract({
    series: boundedSeries
  })).series.length, MAX_FIGURE_SERIES);
  assert.throws(() => normalizeFigureSemanticContract(contract({
    series: [
      ...boundedSeries,
      {
        id: 'series_overflow',
        column: 'value_overflow',
        label: 'Overflow series',
        source_unit: { symbol: 's' }
      }
    ]
  })), { code: 'INVALID_FIGURE_SEMANTIC_CONTRACT' });

  const oversizedSidecar = analyzeFigureRegistration({
    figure: png(),
    source: Buffer.from(sourceText()),
    sourceName: 'data.csv',
    sidecar: Buffer.alloc(MAX_FIGURE_SEMANTIC_SIDECAR_BYTES + 1, 0x20),
    contract: contract()
  });
  assert.equal(oversizedSidecar.status, 'fail');
  assert.equal(
    oversizedSidecar.mismatches[0].code,
    'FIGURE_SEMANTIC_SIDECAR_TOO_LARGE'
  );

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-registration-cap-')
  );
  const simulation = recordedBundle(directory);
  const spec = normalizeFigureRegistrationSpec(specFor(simulation));
  const root = path.join(directory, '.sciencecode', 'figure-registrations');
  fs.mkdirSync(root, { recursive: true });
  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = function boundedRegistryRead(target, options) {
    if (path.resolve(String(target)) === path.resolve(root) &&
        options?.withFileTypes === true) {
      return Array.from({ length: MAX_FIGURE_REGISTRATIONS }, (_, index) => ({
        name: 'figure-registration-20260811T000000Z-' + index.toString(36),
        isDirectory() { return true; }
      }));
    }
    return originalReaddirSync.call(fs, target, options);
  };
  try {
    assert.throws(() => createFigureRegistration({
      cwd: directory,
      figure: spec.figure,
      source: spec.source,
      sidecar: spec.sidecar,
      contract: spec.contract
    }), { code: 'FIGURE_REGISTRATION_LIMIT' });
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
});

test('semantic registration storage rejects metadata and registry links before writes', () => {
  for (const mode of ['metadata', 'registry']) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sciencecode-figure-registration-link-')
    );
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sciencecode-figure-registration-outside-')
    );
    if (mode === 'registry') fs.mkdirSync(path.join(directory, '.sciencecode'));
    fs.symlinkSync(
      outside,
      mode === 'metadata'
        ? path.join(directory, '.sciencecode')
        : path.join(directory, '.sciencecode', 'figure-registrations'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.throws(() => listFigureRegistrations(directory), {
      code: 'INVALID_FIGURE_REGISTRATION_PATH'
    });
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});

test('semantic sidecar analysis distinguishes exact bindings from producer mismatches', () => {
  const figure = png();
  const source = Buffer.from(sourceText());
  const semanticContract = contract();
  const sidecar = buildFigureSemanticSidecar({
    figure,
    source,
    sourceName: 'data.csv',
    contract: semanticContract
  });
  assert.equal(normalizeFigureSemanticSidecar(sidecar).replay_sha256,
    sidecar.replay_sha256);
  const exact = analyzeFigureRegistration({
    figure,
    source,
    sourceName: 'data.csv',
    sidecar: Buffer.from(JSON.stringify(sidecar)),
    contract: semanticContract
  });
  assert.equal(exact.status, 'pass');
  assert.equal(exact.registration_status, 'matched');
  assert.deepEqual(exact.checks.map((item) => item.status),
    ['pass', 'pass', 'pass', 'pass', 'pass']);

  const wrongReplay = structuredClone(sidecar);
  wrongReplay.replay.plotted_point_count += 1;
  wrongReplay.replay_sha256 = sha256Json(wrongReplay.replay);
  const mismatch = analyzeFigureRegistration({
    figure,
    source,
    sourceName: 'data.csv',
    sidecar: Buffer.from(JSON.stringify(wrongReplay)),
    contract: semanticContract
  });
  assert.equal(mismatch.status, 'fail');
  assert.deepEqual(mismatch.mismatches.map((item) => item.issue), [
    'data_replay_mismatch'
  ]);

  const wrongFigure = structuredClone(sidecar);
  wrongFigure.figure.sha256 = '0'.repeat(64);
  const figureMismatch = analyzeFigureRegistration({
    figure,
    source,
    sourceName: 'data.csv',
    sidecar: Buffer.from(JSON.stringify(wrongFigure)),
    contract: semanticContract
  });
  assert.deepEqual(figureMismatch.mismatches.map((item) => item.issue), [
    'figure_binding_mismatch'
  ]);

  const malformed = analyzeFigureRegistration({
    figure,
    source,
    sourceName: 'data.csv',
    sidecar: Buffer.from('{not json'),
    contract: semanticContract
  });
  assert.equal(malformed.status, 'fail');
  assert.equal(malformed.mismatches[0].issue, 'sidecar_invalid');
});

test('immutable semantic registrations verify, link interactions and lineage, and detect tampering', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-registration-')
  );
  const chat = createChatSession({
    cwd: directory,
    title: 'Semantic figure',
    agent: 'scientist'
  });
  const simulation = recordedBundle(directory);
  const spec = normalizeFigureRegistrationSpec(specFor(simulation));
  const registration = createFigureRegistration({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    figure: spec.figure,
    source: spec.source,
    sidecar: spec.sidecar,
    contract: spec.contract,
    name: spec.name,
    note: spec.note
  });
  assert.equal(registration.report.status, 'pass');
  assert.equal(registration.verification.ok, true);
  assert.equal(listFigureRegistrations(directory).length, 1);
  assert.equal(resolveFigureRegistrationArtifact(
    directory,
    registration.figure_registration_id,
    'source.csv'
  ).descriptor.sha256, registration.manifest.source.sha256);

  const interaction = recordInteraction({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    surface: 'figure',
    action: 'registration.created',
    artifact: figureRegistrationInteractionArtifact(registration),
    payload: figureRegistrationInteractionPayload(registration)
  });
  const prompt = interactionAwarePrompt({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    message: 'Review the registered figure.'
  });
  assert.match(prompt.prompt, /Recorded semantic figure registration/);
  assert.match(prompt.prompt, /3 plotted points across 2 series/);
  assert.match(prompt.prompt, /does not infer semantics from pixels/);

  const lineage = buildLineageGraph(directory);
  const nodeId = 'figure-registration:' + registration.figure_registration_id;
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) => node.id === nodeId));
  assert.equal(lineage.edges.filter((edge) =>
    edge.target === nodeId && edge.relation === 'registered_by'
  ).length, 3);
  assert.ok(lineage.edges.some((edge) =>
    edge.source === nodeId &&
    edge.target === 'interaction:' + interaction.interaction_id
  ));

  const harness = buildHarnessView({
    cwd: directory,
    chat: {
      ...getChatSession(directory, chat.manifest.chat_id),
      verification: { ok: true, errors: [] }
    },
    figureRegistrations: listFigureRegistrations(directory)
  });
  assert.equal(harness.board.figure_registrations.length, 1);
  assert.equal(harness.board.validation.matched_figure_registrations, 1);
  assert.ok(harness.activity.some((event) =>
    event.type === 'figure.registration.matched'
  ));

  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.figure_registrations, 1);
  assert.equal(gate.counts.matched_figure_registrations, 1);

  const registrationDirectory = resolveFigureRegistrationDirectory(
    directory,
    registration.figure_registration_id
  );
  for (const [name, maximum] of [
    ['manifest.json', MAX_FIGURE_REGISTRATION_MANIFEST_BYTES],
    ['report.json', MAX_FIGURE_SEMANTIC_REPORT_BYTES]
  ]) {
    const file = path.join(registrationDirectory, name);
    const original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, Buffer.alloc(maximum + 1, 0x20));
      const oversized = verifyFigureRegistration(
        directory,
        registration.figure_registration_id
      );
      assert.equal(oversized.ok, false);
      assert.equal(
        oversized.errors[0].issue,
        'FIGURE_REGISTRATION_FILE_TOO_LARGE'
      );
    } finally {
      fs.writeFileSync(file, original);
    }
  }

  const copiedSidecar = resolveFigureRegistrationArtifact(
    directory,
    registration.figure_registration_id,
    'sidecar.json'
  ).file;
  fs.appendFileSync(copiedSidecar, '\n');
  const tampered = verifyFigureRegistration(
    directory,
    registration.figure_registration_id
  );
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((item) =>
    item.file === 'sidecar.json' && item.issue === 'hash_mismatch'
  ));
});

test('semantic mismatches remain valid immutable negative records', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-registration-mismatch-')
  );
  const simulation = recordedBundle(directory, {
    mutateSidecar(value) {
      value.replay.plotted_point_count += 1;
      value.replay_sha256 = sha256Json(value.replay);
      return value;
    }
  });
  const spec = normalizeFigureRegistrationSpec(specFor(simulation));
  const registration = createFigureRegistration({
    cwd: directory,
    figure: spec.figure,
    source: spec.source,
    sidecar: spec.sidecar,
    contract: spec.contract,
    name: spec.name
  });
  assert.equal(registration.report.status, 'fail');
  assert.equal(registration.report.registration_status, 'mismatch');
  assert.deepEqual(registration.report.mismatches.map((item) => item.issue), [
    'data_replay_mismatch'
  ]);
  assert.equal(registration.verification.ok, true);
  assert.equal(listFigureRegistrations(directory, { status: 'fail' }).length, 1);
  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.verified_figure_registrations, 1);
  assert.equal(gate.counts.matched_figure_registrations, 0);
  assert.equal(gate.counts.figure_registrations_needing_attention, 1);
  const lineage = buildLineageGraph(directory);
  assert.ok(lineage.findings.some((item) =>
    item.code === 'figure_semantic_registration_attention'
  ));
  fs.rmSync(resolveFigureRegistrationDirectory(
    directory,
    registration.figure_registration_id
  ), { recursive: true });
  const deleted = listFigureRegistrations(directory);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].verified, false);
  assert.equal(verifyProject(directory).ok, false);
});

test('semantic figure CLI builds sidecars and registers, lists, shows, and verifies records', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-figure-registration-cli-')
  );
  const semanticContract = contract();
  fs.writeFileSync(path.join(directory, 'contract.json'),
    JSON.stringify(semanticContract));
  fs.writeFileSync(path.join(directory, 'figure.png'), png());
  fs.writeFileSync(path.join(directory, 'data.csv'), sourceText());

  const built = invoke([
    'figure', 'semantic', 'sidecar',
    'contract.json', 'figure.png', 'data.csv',
    '--output', 'figure.semantic.json'
  ], directory);
  assert.equal(built.code, 0, built.stderr);
  assert.equal(fs.existsSync(path.join(directory, 'figure.semantic.json')), true);
  assert.equal(JSON.parse(built.stdout).sidecar.schema_version, 1);
  const duplicateOutput = invoke([
    'figure', 'semantic', 'sidecar',
    'contract.json', 'figure.png', 'data.csv',
    '--output', 'one.json', '--output', 'two.json'
  ], directory);
  assert.equal(duplicateOutput.code, 2);

  const simulation = recordedBundle(directory);
  fs.writeFileSync(path.join(directory, 'registration.json'),
    JSON.stringify(specFor(simulation)));
  const created = invoke([
    'figure', 'semantic', 'register', 'registration.json'
  ], directory);
  assert.equal(created.code, 0, created.stderr);
  const payload = JSON.parse(created.stdout);
  assert.equal(payload.registration.report.status, 'pass');
  const id = payload.registration.figure_registration_id;

  const listed = invoke([
    'figure', 'semantic', 'list', '--status', 'pass', '--json'
  ], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].figure_registration_id, id);
  assert.equal(invoke([
    'figure', 'semantic', 'show', id
  ], directory).code, 0);
  const verified = invoke([
    'figure', 'semantic', 'verify', id
  ], directory);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
  assert.equal(invoke([
    'figure', 'semantic', 'list', '--json', '--json'
  ], directory).code, 2);
  assert.equal(invoke([
    'figure', 'semantic', 'list', '--status', 'maybe'
  ], directory).code, 2);
});
