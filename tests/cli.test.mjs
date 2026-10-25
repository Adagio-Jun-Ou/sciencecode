import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExperimentArguments,
  parseInferenceArguments,
  parseRunArguments,
  parseSimulationArguments,
  runCli
} from '../lib/cli.js';
import { VERSION } from '../lib/constants.js';
import { createChatSession } from '../lib/core.js';
import { findExecutable } from '../lib/process.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; }
  };
}

function invoke(argv, cwd, env = process.env) {
  const stdout = capture();
  const stderr = capture();
  const code = runCli({
    argv,
    cwd,
    root: packageRoot,
    env,
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  return { code, stdout: stdout.read(), stderr: stderr.read() };
}

test('recorded-run parser separates ScienceCode options from exact prompt text', () => {
  assert.deepEqual(
    parseRunArguments([
      '--agent', 'data-analyst',
      '-m', 'provider/model',
      '-f', 'measurements.csv',
      '--variant', 'high',
      '--thinking',
      '--no-store-prompt',
      '--',
      'compare A & B'
    ]),
    {
      agent: 'data-analyst',
      format: 'json',
      storePrompt: false,
      passthrough: [
        '--model', 'provider/model',
        '--file', 'measurements.csv',
        '--variant', 'high',
        '--thinking'
      ],
      prompt: 'compare A & B',
      help: false
    }
  );
  assert.throws(() => parseRunArguments(['--share', 'prompt']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseRunArguments(['--format', 'xml', 'prompt']), { code: 'INVALID_ARGUMENT' });
});

test('simulation parser keeps typed parameters separate from literal script arguments', () => {
  assert.deepEqual(
    parseSimulationArguments([
      'model.py',
      '--seed', '42',
      '--device', 'cuda:0',
      '--timeout', '90',
      '--param', 'particles=1000',
      '--param', 'label=control arm',
      '--input', 'observations.csv',
      '--',
      '--solver', 'A&B'
    ]),
    {
      script: 'model.py',
      seed: 42,
      device: 'cuda:0',
      timeoutMs: 90_000,
      parameters: { particles: 1000, label: 'control arm' },
      inputs: ['observations.csv'],
      scriptArgs: ['--solver', 'A&B'],
      help: false
    }
  );
  assert.throws(
    () => parseSimulationArguments(['model.py', '--param', 'particles=1', '--param', 'particles=2']),
    { code: 'INVALID_ARGUMENT' }
  );
  assert.throws(() => parseSimulationArguments(['model.py', '--timeout', '0']), { code: 'INVALID_ARGUMENT' });
});

test('experiment parser separates fixed values, sweep dimensions, seeds, and script arguments', () => {
  assert.deepEqual(
    parseExperimentArguments([
      'model.py',
      '--name', 'Dose response',
      '--hypothesis', 'Alpha changes the response.',
      '--seeds', '42,7',
      '--device', 'cuda:0',
      '--timeout', '120',
      '--param', 'steps=100',
      '--vary', 'alpha=[0.1,0.2]',
      '--input', 'observations.csv',
      '--analysis-contract', 'analysis-contract-20260810T120000Z-example',
      '--cad-build', 'cad-build-20260811T120000Z-example',
      '--',
      '--solver', 'A&B'
    ]),
    {
      script: 'model.py',
      name: 'Dose response',
      hypothesis: 'Alpha changes the response.',
      seeds: [42, 7],
      device: 'cuda:0',
      timeoutMs: 120_000,
      parameters: { steps: 100 },
      variations: { alpha: [0.1, 0.2] },
      inputs: ['observations.csv'],
      scriptArgs: ['--solver', 'A&B'],
      analysisContractId: 'analysis-contract-20260810T120000Z-example',
      cadBuildId: 'cad-build-20260811T120000Z-example',
      help: false
    }
  );
  assert.throws(
    () => parseExperimentArguments(['model.py', '--param', 'alpha=1', '--vary', 'alpha=[1,2]']),
    { code: 'INVALID_ARGUMENT' }
  );
  assert.throws(
    () => parseExperimentArguments(['model.py', '--seeds', '1,1']),
    { code: 'INVALID_ARGUMENT' }
  );
  assert.throws(
    () => parseExperimentArguments([
      'model.py', '--cad-build', 'first', '--cad-build', 'second'
    ]),
    { code: 'INVALID_ARGUMENT' }
  );
});

test('inference parser keeps accelerator policy and bounded execution settings explicit', () => {
  assert.deepEqual(
    parseInferenceArguments([
      'model.onnx',
      '--input', 'inputs.json',
      '--device', 'npu',
      '--allow-fallback',
      '--warmup', '4',
      '--iterations', '12',
      '--timeout', '75'
    ]),
    {
      model: 'model.onnx',
      input: 'inputs.json',
      device: 'npu',
      allowFallback: true,
      warmup: 4,
      iterations: 12,
      timeoutMs: 75_000,
      help: false
    }
  );
  assert.equal(parseInferenceArguments(['--device', 'cpu']).device, 'cpu');
  assert.equal(parseInferenceArguments(['--device', 'auto']).device, 'auto');
  assert.throws(() => parseInferenceArguments(['--device', 'cuda']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseInferenceArguments(['--warmup', '-1']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseInferenceArguments(['--iterations', '0']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseInferenceArguments(['--timeout', '0']), { code: 'INVALID_ARGUMENT' });
  assert.throws(
    () => parseInferenceArguments(['model.onnx', '--input', 'one.json', '--input', 'two.json']),
    { code: 'INVALID_ARGUMENT' }
  );
});

test('CLI initialization, snapshot, verification, and audit work together', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-'));
  fs.writeFileSync(path.join(directory, 'data.csv'), 'x,y\n1,2\n');

  const initialized = invoke(['init'], directory);
  assert.equal(initialized.code, 0);
  assert.equal(JSON.parse(initialized.stdout).ok, true);

  const snapshotted = invoke(['snapshot'], directory);
  assert.equal(snapshotted.code, 0);
  const snapshotFile = snapshotted.stdout.trim();
  assert.equal(fs.existsSync(snapshotFile), true);

  const verified = invoke(['verify', snapshotFile, '--strict'], directory);
  assert.equal(verified.code, 0);
  assert.equal(JSON.parse(verified.stdout).ok, true);

  const namedRelative = path.join(
    '.sciencecode', 'snapshots', 'named-baseline.json'
  );
  const named = invoke(['snapshot', namedRelative], directory);
  assert.equal(named.code, 0);
  assert.equal(named.stdout.trim(), path.join(directory, namedRelative));
  assert.equal(fs.existsSync(named.stdout.trim()), true);
  assert.equal(invoke(['verify', named.stdout.trim(), '--strict'], directory).code, 0);

  const audit = invoke(['audit', 'verify'], directory);
  assert.equal(audit.code, 0);
  assert.equal(JSON.parse(audit.stdout).ok, true);

  const runs = invoke(['runs'], directory);
  assert.equal(runs.code, 0);
  assert.equal(runs.stdout, 'No recorded runs.\n');

  const lineage = invoke(['lineage', 'show', '--json'], directory);
  assert.equal(lineage.code, 0);
  assert.equal(JSON.parse(lineage.stdout).integrity.ok, true);
  const lineageVerification = invoke(['lineage', 'verify'], directory);
  assert.equal(lineageVerification.code, 0);
  assert.equal(JSON.parse(lineageVerification.stdout).summary.nodes, 0);
});

test('CLI rejects traversal, unsafe run options, and secret-bearing prompts cleanly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-safe-'));
  let result = invoke(['verify', path.join('..', 'outside.json')], directory);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /escapes the project root/);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-outside-'));
  const link = path.join(directory, 'linked-outside');
  try {
    fs.symlinkSync(
      outside,
      link,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    result = invoke(['snapshot', path.join('linked-outside', 'snapshot.json')], directory);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /safe project directory|escapes the project root/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }

  result = invoke(['run', '--share', '--', 'safe prompt'], directory);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unsupported recorded-run option/);

  result = invoke(['run', '--', 'use token=supersecretvalue123'], directory);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /Potential secret detected/);
  assert.equal(fs.existsSync(path.join(directory, '.sciencecode')), false);
});

test('CLI reports unknown commands and exposes version/help without throwing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-basic-'));
  assert.equal(invoke(['--version'], directory).stdout, VERSION + '\n');
  assert.match(invoke(['help'], directory).stdout, /sciencecode verify-run RUN_ID/);
  const paths = JSON.parse(invoke(['paths'], directory).stdout);
  assert.ok(paths.engine.startsWith(path.join(packageRoot, 'node_modules', 'opencode-ai')));
  assert.match(paths.home, /ScienceCode|sciencecode/);
  assert.match(paths.compute.runtime, /python-gpu-v1/);
  assert.match(paths.compute.npu_runtime, /python-npu-v1/);
  assert.match(paths.compute.npu_python, /python(?:\.exe)?$/i);
  assert.equal(invoke(['simulate', 'list'], directory).stdout, 'No recorded simulations.\n');
  assert.equal(invoke(['experiment', 'list'], directory).stdout, 'No recorded experiments.\n');
  assert.equal(invoke(['inference', 'list'], directory).stdout, 'No recorded inferences.\n');
  const unknown = invoke(['destroy'], directory);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command/);
});

test('CLI manages immutable evidence and deterministic search end to end', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-evidence-'));
  fs.writeFileSync(path.join(directory, 'study.txt'),
    'Candidate ZX-4 improved the recorded assay response with a vehicle control.');
  const added = invoke([
    'evidence', 'add', 'study.txt', '--title', 'ZX-4 assay',
    '--doi', '10.5555/zx4', '--author', 'A. Scientist', '--year', '2026'
  ], directory);
  assert.equal(added.code, 0, added.stderr);
  const record = JSON.parse(added.stdout);
  assert.match(record.evidence_id, /^evidence-/);
  assert.equal(record.counts.pages, 1);

  const listed = invoke(['evidence', 'list', '--json'], directory);
  assert.equal(listed.code, 0);
  assert.equal(JSON.parse(listed.stdout)[0].title, 'ZX-4 assay');
  const searched = invoke(['evidence', 'search', 'vehicle', 'control', '--json'], directory);
  assert.equal(searched.code, 0, searched.stderr);
  assert.equal(JSON.parse(searched.stdout).results[0].evidence_id, record.evidence_id);
  const shown = invoke(['evidence', 'show', record.evidence_id], directory);
  assert.equal(JSON.parse(shown.stdout).verification.ok, true);
  const verified = invoke(['evidence', 'verify', record.evidence_id], directory);
  assert.equal(verified.code, 0);
  assert.equal(JSON.parse(verified.stdout).ok, true);
  const traversal = invoke(['evidence', 'add', '../outside.pdf'], directory);
  assert.equal(traversal.code, 2);
  assert.match(traversal.stderr, /escapes the project root/);
});

test('CLI creates and human-adjudicates a versioned hypothesis tree', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-campaign-'));
  const chat = createChatSession({
    cwd: directory,
    title: 'CLI hypothesis tree',
    agent: 'scientist'
  });
  const plan = {
    title: 'CLI branch test',
    question: 'Which branch should receive the next bounded task?',
    context: 'Use recorded project evidence only.',
    context_of_use: 'Exploratory software test.',
    classification: 'exploratory',
    hypotheses: [
      {
        id: 'root-branch',
        statement: 'The root branch remains viable.',
        rationale: 'It is the current working explanation.',
        falsification: 'A completed declared control contradicts it.',
        priority: 1,
        parent_id: null,
        relation: 'root',
        budget: {
          max_task_attempts: 1,
          max_gpu_tasks: 0,
          max_npu_tasks: 0
        }
      },
      {
        id: 'alternate-branch',
        statement: 'The alternate branch is more useful.',
        rationale: 'It is a competing explanation.',
        falsification: 'The same declared control excludes it.',
        priority: 2,
        parent_id: 'root-branch',
        relation: 'alternative',
        budget: {
          max_task_attempts: 1,
          max_gpu_tasks: 0,
          max_npu_tasks: 0
        }
      }
    ],
    tasks: [{
      id: 'branch-check',
      title: 'Check the branches',
      objective: 'Run one bounded comparison.',
      lane: 'reviewer',
      hypothesis_ids: ['root-branch', 'alternate-branch'],
      depends_on: [],
      expected_outputs: ['Recorded comparison'],
      checkpoint: true,
      compute: 'cpu',
      risk: 'low',
      max_attempts: 1
    }],
    budget: {
      max_task_attempts: 1,
      max_gpu_tasks: 0,
      max_npu_tasks: 0,
      max_wall_clock_seconds: 3600
    },
    hypothesis_policy: {
      require_final_assessment: true,
      human_adjudication: true,
      automatic_pruning: false
    },
    execution_policy: {
      network: 'disabled',
      physical_execution: 'disabled',
      artifact_scope: 'project_only',
      ai_disclosure: true
    }
  };
  fs.writeFileSync(
    path.join(directory, 'campaign.json'),
    JSON.stringify(plan, null, 2)
  );
  const createdResult = invoke([
    'campaign', 'create', 'campaign.json',
    '--chat', chat.manifest.chat_id
  ], directory);
  assert.equal(createdResult.code, 0, createdResult.stderr);
  const created = JSON.parse(createdResult.stdout);
  const campaignId = created.campaign.manifest.campaign_id;
  assert.equal(created.campaign.manifest.schema_version, 2);
  const assessedResult = invoke([
    'campaign', 'assess', campaignId, 'alternate-branch',
    'inconclusive', 'pause',
    '--rationale', 'Pause this branch before spending its bounded task budget.'
  ], directory);
  assert.equal(assessedResult.code, 0, assessedResult.stderr);
  const assessed = JSON.parse(assessedResult.stdout);
  assert.equal(assessed.event.type, 'hypothesis.assessed');
  assert.equal(assessed.event.payload.human_checkpoint, true);
  assert.equal(assessed.interaction.action, 'hypothesis.assessed');
  assert.equal(
    assessed.campaign.state.hypotheses[1].effective_status,
    'paused'
  );
  const shown = invoke(['campaign', 'show', campaignId], directory);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).verification.ok, true);
  const invalid = invoke([
    'campaign', 'assess', campaignId, 'root-branch',
    'certain', 'continue', '--rationale', 'Invalid verdict.'
  ], directory);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /verdict must be supported/);
});

test('CLI creates, verifies, lists, and explicitly accepts immutable artifact revisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-revision-'));
  fs.writeFileSync(path.join(directory, 'study.txt'), 'Original scientific manuscript.\n');
  const evidence = JSON.parse(invoke([
    'evidence', 'add', 'study.txt', '--title', 'Revision source'
  ], directory).stdout);
  const chat = createChatSession({ cwd: directory, title: 'Revision review', agent: 'scientist' });
  fs.writeFileSync(path.join(directory, 'revised.txt'), 'Revised scientific manuscript.\n');
  const sourceUrl = '/evidence-source/' + encodeURIComponent(evidence.evidence_id);

  const createdResult = invoke([
    'revision', 'create', sourceUrl, 'revised.txt',
    '--chat', chat.manifest.chat_id,
    '--name', 'study.txt',
    '--note', 'Corrected the conclusion.'
  ], directory);
  assert.equal(createdResult.code, 0, createdResult.stderr);
  const created = JSON.parse(createdResult.stdout);
  assert.equal(created.revision.status, 'proposed');
  assert.equal(created.interaction.action, 'revision.proposed');
  const revisionId = created.revision.manifest.revision_id;

  const listed = invoke(['revision', 'list', '--source', sourceUrl, '--json'], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].revision_id, revisionId);
  const shown = invoke(['revision', 'show', revisionId], directory);
  assert.equal(JSON.parse(shown.stdout).verification.ok, true);
  const verified = invoke(['revision', 'verify', revisionId], directory);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).status, 'proposed');

  const acceptedResult = invoke([
    'revision', 'decide', revisionId,
    '--chat', chat.manifest.chat_id,
    '--decision', 'accepted',
    '--note', 'Approved for downstream use.'
  ], directory);
  assert.equal(acceptedResult.code, 0, acceptedResult.stderr);
  const accepted = JSON.parse(acceptedResult.stdout);
  assert.equal(accepted.revision.status, 'accepted');
  assert.equal(accepted.interaction.action, 'revision.accepted');
  assert.equal(invoke(['revision', 'verify', revisionId], directory).code, 0);

  const invalid = invoke(['revision', 'decide', revisionId, '--decision', 'maybe'], directory);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /requires --chat/);
});

test('CLI imports and conflict-safely edits a declared multi-file CAD environment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-cad-'));
  const sourceRoot = path.join(directory, 'source-cad');
  fs.mkdirSync(path.join(sourceRoot, 'parts'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'assembly.scad'),
    'use <parts/body.scad>\nbody();\n'
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'parts', 'body.scad'),
    'module body(width=20) { cube([width, 12, 4], center=true); }\n'
  );
  fs.writeFileSync(path.join(sourceRoot, 'project.json'), JSON.stringify({
    cad_project_id: 'cad-cli-environment',
    name: 'CLI environment',
    entry: 'assembly.scad',
    files: ['assembly.scad', 'parts/body.scad'],
    parts: [
      { id: 'body', source: 'parts/body.scad', module: 'body' }
    ]
  }, null, 2));

  const createdResult = invoke(['cad', 'create', 'source-cad/project.json'], directory);
  assert.equal(createdResult.code, 0, createdResult.stderr);
  const created = JSON.parse(createdResult.stdout);
  assert.equal(created.descriptor.cad_project_id, 'cad-cli-environment');
  assert.equal(created.files.length, 2);

  const listed = invoke(['cad', 'list', '--json'], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].cad_project_id, 'cad-cli-environment');

  const read = invoke(
    ['cad', 'read', 'cad-cli-environment', 'parts/body.scad'],
    directory
  );
  assert.equal(read.code, 0, read.stderr);
  assert.match(read.stdout, /width=20/);

  const source = created.files.find((item) => item.path === 'parts/body.scad');
  fs.writeFileSync(
    path.join(directory, 'body-draft.scad'),
    read.stdout.replace('width=20', 'width=24')
  );
  const written = invoke([
    'cad', 'write', 'cad-cli-environment', 'parts/body.scad',
    '--from', 'body-draft.scad', '--expected', source.sha256
  ], directory);
  assert.equal(written.code, 0, written.stderr);
  assert.match(JSON.parse(written.stdout).content, /width=24/);

  const gate = invoke([
    'gate',
    '--allow-failed-cad-builds',
    '--allow-failed-cad-slices'
  ], directory);
  assert.equal(gate.code, 0, gate.stderr);
  assert.equal(JSON.parse(gate.stdout).counts.cad_projects, 1);
});

test('CLI executes a project kernel, requires explicit restore, and verifies immutable cells', {
  skip: !findExecutable(process.platform === 'win32' ? 'python' : 'python3') && !findExecutable('python')
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cli-kernel-'));
  const source = path.join(directory, 'cell.py');
  const env = {
    ...process.env,
    SCIENCECODE_HOME: path.join(directory, '.sciencecode-home')
  };

  const status = invoke(['kernel', 'status', 'python', '--json'], directory, env);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout)[0].available, true);

  fs.writeFileSync(source, 'x = 40\nx\n');
  const first = invoke(['kernel', 'exec', 'python', 'cell.py', '--timeout', '30'], directory, env);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).cell.result.result.repr, '40');

  fs.writeFileSync(source, 'x += 2\nx\n');
  const refused = invoke(['kernel', 'exec', 'python', 'cell.py'], directory, env);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /Explicitly restore them or start a fresh state/);

  const restored = invoke([
    'kernel', 'exec', 'python', 'cell.py', '--restore', '--timeout', '30'
  ], directory, env);
  assert.equal(restored.code, 0, restored.stderr);
  const restoredResult = JSON.parse(restored.stdout);
  assert.equal(restoredResult.cell.manifest.execution_count, 2);
  assert.equal(restoredResult.cell.manifest.state_base.mode, 'restored');
  assert.equal(restoredResult.cell.result.result.repr, '42');

  const shown = invoke(['kernel', 'show', 'python', 'cell-000002'], directory, env);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).manifest.code_sha256, restoredResult.cell.manifest.code_sha256);
  const verified = invoke(['kernel', 'verify', 'python'], directory, env);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
  const listed = invoke(['kernel', 'list', '--json'], directory, env);
  assert.equal(JSON.parse(listed.stdout)[0].execution_count, 2);
});

test('the knowledge CLI reports layers, derivations, grounding, and invariants', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-knowledge-cli-'));

  const usage = invoke(['knowledge'], directory);
  assert.equal(usage.code, 0, usage.stderr);
  assert.match(usage.stdout, /mathematics, physics, chemistry, biology, biomedicine/);

  const layers = invoke(['knowledge', 'layers', '--json'], directory);
  assert.equal(layers.code, 0, layers.stderr);
  assert.deepEqual(
    JSON.parse(layers.stdout).map((layer) => layer.id),
    ['mathematics', 'physics', 'chemistry', 'biology', 'biomedicine']
  );

  const verified = invoke(['knowledge', 'verify', '--json'], directory);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);

  const derived = invoke(['knowledge', 'derive', 'bioeng.vaccine.antigen_selection', '--json'], directory);
  assert.equal(derived.code, 0, derived.stderr);
  const derivation = JSON.parse(derived.stdout);
  assert.equal(derivation.grounded_in_mathematics, true);
  assert.equal(derivation.chain.at(-1).id, 'bioeng.vaccine.antigen_selection');
  assert.ok(derivation.weakest_link.limits.length > 0);

  const shown = invoke(['knowledge', 'show', 'bio.dna.double_helix'], directory);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /Limits:/);
  assert.match(shown.stdout, /Rests on:/);

  const listed = invoke(['knowledge', 'list', '--layer', 'chemistry', '--json'], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.ok(JSON.parse(listed.stdout).every((record) => record.layer === 'chemistry'));

  const domain = invoke(['knowledge', 'domain', 'vaccine_design', '--json'], directory);
  assert.equal(domain.code, 0, domain.stderr);
  assert.ok(JSON.parse(domain.stdout).governance.includes('bioeng.biosafety.dual_use'));

  const grounded = invoke(['knowledge', 'ground', 'biomolecular_design', '--json'], directory);
  assert.equal(grounded.code, 0, grounded.stderr);
  assert.ok(JSON.parse(grounded.stdout).principle_count > 0);

  const unknown = invoke(['knowledge', 'show', 'not.a.principle'], directory);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown knowledge principle/);

  const badAction = invoke(['knowledge', 'summon'], directory);
  assert.equal(badAction.code, 2);
  assert.match(badAction.stderr, /knowledge action must be/);

  const badOption = invoke(['knowledge', 'list', '--vibes'], directory);
  assert.equal(badOption.code, 2);
  assert.match(badOption.stderr, /Unknown knowledge option/);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('the published package version matches the compiled product version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, VERSION);
});

test('stats calculator replays the pinned engine deterministically from the CLI', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-stats-cli-'));

  const oneSample = invoke(['stats', 'ttest',
    '--values', '1,2,3,4,5', '--null', '2', '--sidedness', 'two_sided'], directory);
  assert.equal(oneSample.code, 0);
  const oneSampleReport = JSON.parse(oneSample.stdout);
  assert.equal(oneSampleReport.engine.name, 'sciencecode-inferential-t');
  assert.equal(oneSampleReport.result.degrees_of_freedom, 4);
  assert.ok(Math.abs(oneSampleReport.result.p_value - 0.23019964108049695) < 1e-15);
  assert.ok(oneSampleReport.confidence_interval.lower < 3);
  assert.match(oneSample.stdout, /assumed, not checked/);

  const welch = invoke(['stats', 'ttest',
    '--group-a', '620,655,640', '--group-b', '510,505,520'], directory);
  assert.equal(welch.code, 0);
  const welchReport = JSON.parse(welch.stdout);
  assert.equal(welchReport.result.test, 'welch_t_two_sample');
  assert.ok(welchReport.result.p_value < 0.01);
  assert.ok(welchReport.confidence_interval.lower > 0);

  const quantile = invoke(['stats', 'quantile', '0.975', '9'], directory);
  assert.equal(quantile.code, 0);
  assert.ok(Math.abs(JSON.parse(quantile.stdout).quantile - 2.2621571627982027) < 1e-9);

  const adjusted = invoke(['stats', 'adjust', '0.01,0.04',
    '--correction', 'holm_bonferroni', '--family', '3'], directory);
  assert.equal(adjusted.code, 0);
  assert.deepEqual(JSON.parse(adjusted.stdout).adjusted_p_values, [0.03, 0.08]);

  const usage = invoke(['stats', 'help'], directory);
  assert.match(usage.stdout, /records nothing/);
  assert.equal(invoke(['stats', 'ttest', '--values', '1,2', '--group-a', '1,2'],
    directory).code, 2);
  assert.equal(invoke(['stats', 'ttest', '--values', '1,x', '--null', '0'],
    directory).code, 2);
  assert.equal(invoke(['stats', 'adjust', '0.5', '--correction', 'fdr'],
    directory).code, 2);
});

test('stats calculator rejects empty list elements instead of injecting zeros', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-stats-empty-'));
  const trailing = invoke(['stats', 'ttest', '--values', '1,2,3,', '--null', '0'], directory);
  assert.equal(trailing.code, 2);
  assert.match(trailing.stderr, /empty element/);
  const inner = invoke(['stats', 'ttest', '--values', '1,,3,4', '--null', '0'], directory);
  assert.equal(inner.code, 2);
  const adjustTrailing = invoke(['stats', 'adjust', '0.01,0.2,',
    '--correction', 'none'], directory);
  assert.equal(adjustTrailing.code, 2);
  assert.match(adjustTrailing.stderr, /empty element/);
  const degenerate = invoke(['stats', 'ttest', '--values', '2,2,2', '--null', '0'], directory);
  assert.equal(degenerate.code, 0);
  const report = JSON.parse(degenerate.stdout);
  assert.equal(report.result.degenerate, 'zero_variance');
  assert.equal(report.confidence_interval, null);
});

test('stats tost assesses equivalence against declared bounds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-tost-cli-'));
  const equivalent = invoke(['stats', 'tost',
    '--group-a', '100,102,101,99', '--group-b', '100,101,100,100',
    '--lower', '-5', '--upper', '5'], directory);
  assert.equal(equivalent.code, 0);
  const report = JSON.parse(equivalent.stdout);
  assert.equal(report.conclusion, 'equivalent');
  assert.equal(report.tost.p_value, Math.max(report.tost.p_lower, report.tost.p_upper));
  assert.equal(report.confidence_interval.level, 0.9);
  assert.match(equivalent.stdout, /failing to establish it is not evidence of a difference/);

  const notEquivalent = invoke(['stats', 'tost',
    '--group-a', '100,102,101,99', '--group-b', '100,101,100,100',
    '--lower', '-0.1', '--upper', '0.1'], directory);
  assert.equal(JSON.parse(notEquivalent.stdout).conclusion, 'not_equivalent');

  const paired = invoke(['stats', 'tost',
    '--group-a', '10,11,12,13', '--group-b', '10,11,12,13',
    '--paired', '--lower', '-1', '--upper', '1'], directory);
  assert.equal(paired.code, 0);
  assert.equal(JSON.parse(paired.stdout).tost, null);

  assert.equal(invoke(['stats', 'tost', '--values', '1,2,3'], directory).code, 2);
  assert.equal(invoke(['stats', 'tost', '--values', '1,2,3',
    '--lower', '5', '--upper', '-5'], directory).code, 2);
  assert.match(invoke(['stats', 'help'], directory).stdout, /stats tost/);
});

test('stats ttest refuses equivalence sidedness and points at tost', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-equiv-cli-'));
  const rejected = invoke(['stats', 'ttest', '--values', '1,2,3,4',
    '--null', '2', '--sidedness', 'equivalence'], directory);
  assert.equal(rejected.code, 2);
  assert.match(rejected.stderr, /stats tost/);
  const wideAlpha = invoke(['stats', 'tost', '--values', '1,2,3,4',
    '--lower', '-5', '--upper', '5', '--alpha', '0.5'], directory);
  assert.equal(wideAlpha.code, 2);
  assert.match(wideAlpha.stderr, /below 0\.5/);
});

test('stats ranktest exposes the rank-based engine without a normality claim', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-ranktest-cli-'));
  const twoSample = invoke(['stats', 'ranktest',
    '--group-a', '1,2,3,4,5', '--group-b', '6,7,8,9,10'], directory);
  assert.equal(twoSample.code, 0);
  const report = JSON.parse(twoSample.stdout);
  assert.equal(report.result.test, 'mann_whitney_u');
  assert.equal(report.result.method, 'exact');
  assert.ok(Math.abs(report.result.p_value - 2 / 252) < 1e-12);
  assert.match(twoSample.stdout, /assume no particular distribution shape/);
  assert.match(twoSample.stdout, /shift in location, not a difference in means/);

  const paired = invoke(['stats', 'ranktest',
    '--group-a', '2,4,6,8,10', '--group-b', '1,2,3,4,5', '--paired'], directory);
  assert.equal(paired.code, 0);
  const pairedReport = JSON.parse(paired.stdout);
  assert.equal(pairedReport.result.test, 'wilcoxon_signed_rank');
  assert.equal(pairedReport.result.w_plus, 15);

  // A null shift is a location shift and applies to both tests: the
  // hypothesis is that group A minus the shift matches group B.
  assert.equal(invoke(['stats', 'ranktest', '--group-a', '2,4,6',
    '--group-b', '1,2,3', '--null', '1', '--paired'], directory).code, 0);
  const shifted = invoke(['stats', 'ranktest', '--group-a', '101,102,103,104,105',
    '--group-b', '1,2,3,4,5', '--null', '100'], directory);
  assert.equal(shifted.code, 0);
  const unshifted = invoke(['stats', 'ranktest', '--group-a', '101,102,103,104,105',
    '--group-b', '1,2,3,4,5'], directory);
  // Declaring the true shift as the null must make the data unsurprising.
  assert.ok(JSON.parse(shifted.stdout).result.p_value >
    JSON.parse(unshifted.stdout).result.p_value);

  // Rank tests have no equivalence formulation here.
  assert.equal(invoke(['stats', 'ranktest', '--group-a', '1,2,3',
    '--group-b', '4,5,6', '--sidedness', 'equivalence'], directory).code, 2);
  assert.equal(invoke(['stats', 'ranktest', '--group-a', '1,2,3'], directory).code, 2);
  // Discoverable from both the top-level and the stats help.
  assert.match(invoke(['--help'], directory).stdout, /potency/);
  assert.match(invoke(['stats', 'help'], directory).stdout, /ranktest/);
});

test('potency fit is reachable and reports its honesty diagnostics', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-potency-cli-'));
  const good = invoke(['potency', 'fit',
    '--concentrations', '1,3,10,30,100,300,1000,3000,10000',
    '--responses', '99.6,98.8,96.2,89.3,71.4,45.5,20,7.5,2.4',
    '--unit', 'nM'], directory);
  assert.equal(good.code, 0);
  const fit = JSON.parse(good.stdout);
  assert.equal(fit.concentration_unit, 'nM');
  assert.ok(Math.abs(fit.half_maximal_concentration - 250) < 5);
  assert.equal(fit.converged, true);
  assert.match(good.stdout, /neither an affinity nor a dose/);

  // An unobserved plateau must be called out despite an excellent r-squared.
  const partial = invoke(['potency', 'fit',
    '--concentrations', '1,3,10,30,100',
    '--responses', '100,96,88,74,61'], directory);
  assert.equal(partial.code, 0);
  assert.match(partial.stdout, /NOT reached by the concentrations tested/);
  assert.match(partial.stdout, /r-squared does not make that potency reliable/);

  // A saturated design has nothing left to assess the fit against.
  assert.match(invoke(['potency', 'fit', '--concentrations', '1,10,100,1000',
    '--responses', '100,74,26,1'], directory).stdout, /no degrees of freedom left/);

  // Refusals carry their reason.
  assert.equal(invoke(['potency', 'fit', '--concentrations', '0,1,10,100',
    '--responses', '100,90,50,10'], directory).code, 2);
  assert.match(invoke(['potency', 'fit', '--concentrations', '1,10,100,1000',
    '--responses', '100,75,25,0', '--bottom', '5'], directory).stderr,
  /applies only to --model three_parameter_logistic/);
  assert.equal(invoke(['potency', 'fit', '--concentrations', '1,10,100,1000',
    '--responses', '100,75,25,0', '--unit', 'bogus'], directory).code, 2);
});
