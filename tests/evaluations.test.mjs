import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVALUATION_REPORT_SCHEMA_VERSION,
  EVALUATION_SOURCE_PATHS,
  SCIENCECODE_CORE_EVALUATION_ID,
  SCIENCECODE_CORE_EVALUATION_VERSION,
  formatScienceCodeEvaluation,
  runScienceCodeEvaluation
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; }
  };
}

function invoke(argv, root = packageRoot) {
  const stdout = capture();
  const stderr = capture();
  const code = runCli({
    argv,
    cwd: packageRoot,
    root,
    env: process.env,
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  return { code, stdout: stdout.read(), stderr: stderr.read() };
}

function copiedEvaluationRoot(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-evaluation-root-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of EVALUATION_SOURCE_PATHS) {
    const source = path.join(packageRoot, ...relative.split('/'));
    const destination = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return root;
}

test('core evaluation covers every declared accuracy and governance dimension reproducibly', () => {
  const first = runScienceCodeEvaluation({ packageRoot });
  const second = runScienceCodeEvaluation({ packageRoot });

  assert.equal(first.schema_version, EVALUATION_REPORT_SCHEMA_VERSION);
  assert.equal(first.suite.suite_id, SCIENCECODE_CORE_EVALUATION_ID);
  assert.equal(first.suite.suite_version, SCIENCECODE_CORE_EVALUATION_VERSION);
  assert.equal(first.status, 'pass');
  assert.deepEqual(first.summary, {
    categories: 6,
    categories_passed: 6,
    cases: 57,
    passed: 57,
    failed: 0
  });
  assert.deepEqual(Object.keys(first.metrics), [
    'reviewer_detection',
    'citation_correctness',
    'numerical_review',
    'reproducible_reruns',
    'scientific_safety',
    'agent_role_separation'
  ]);
  assert.equal(first.metrics.reviewer_detection.precision, 1);
  assert.equal(first.metrics.reviewer_detection.recall, 1);
  assert.equal(first.metrics.reviewer_detection.confusion.false_positive, 0);
  assert.equal(first.metrics.reviewer_detection.confusion.false_negative, 0);
  assert.equal(first.repeatability.executions, 2);
  assert.equal(first.repeatability.identical, true);
  assert.equal(first.source_bindings.length, EVALUATION_SOURCE_PATHS.length);
  assert.ok(first.source_bindings.every((binding) =>
    binding.status === 'bound' && /^[a-f0-9]{64}$/.test(binding.normalized_text_sha256)
  ));
  assert.match(first.fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.fingerprint_sha256, second.fingerprint_sha256);
  assert.equal(first.suite.definition_sha256, second.suite.definition_sha256);
  assert.equal(first.source_bindings_sha256, second.source_bindings_sha256);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /sciencecode-evaluation-/i);
  assert.doesNotMatch(serialized, /evidence-20260101/i);
  assert.match(first.limitations.join(' '), /does not measure open-ended model intelligence/i);
  assert.match(first.limitations.join(' '), /not scientific entailment/i);

  const formatted = formatScienceCodeEvaluation(first);
  assert.match(formatted, /ScienceCode core evaluation v1: PASS/);
  assert.match(formatted, /57\/57 cases passed/);
  assert.match(formatted, /precision 1\.000000/);
  assert.match(formatted, /not a claim of open-ended scientific validity/i);
});

test('evaluation fails closed when a bound shipped safety contract drifts', (context) => {
  const root = copiedEvaluationRoot(context);
  const safetyFile = path.join(root, 'opencode', 'agents', 'safety-reviewer.md');
  const original = fs.readFileSync(safetyFile, 'utf8');
  assert.match(original, /Mark missing gates as blocking\./);
  fs.writeFileSync(
    safetyFile,
    original.replace(
      'Mark missing gates as blocking.',
      'Record missing gates for later consideration.'
    ),
    'utf8'
  );

  const report = runScienceCodeEvaluation({ packageRoot: root });
  assert.equal(report.status, 'fail');
  assert.equal(report.metrics.scientific_safety.pass, false);
  assert.equal(report.metrics.scientific_safety.failed, 1);
  assert.equal(report.metrics.reproducible_reruns.pass, true);
  const failure = report.cases.find((item) => item.case_id === 'safety.authorization-boundary');
  assert.equal(failure.pass, false);
  assert.deepEqual(failure.observed.missing_required, ['mark missing gates as blocking']);
  assert.equal(report.cases.filter((item) => !item.pass).length, 1);

  const cli = invoke(['evaluate', '--json'], root);
  assert.equal(cli.code, 1, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, 'fail');
});

test('evaluation refuses missing, oversized, and non-UTF-8 bound sources', (context) => {
  const root = copiedEvaluationRoot(context);
  const missingPath = 'opencode/skills/npu-inference/SKILL.md';
  const oversizedPath = 'opencode/agents/safety-reviewer.md';
  const invalidUtf8Path = 'opencode/commands/cad.md';
  fs.unlinkSync(path.join(root, ...missingPath.split('/')));
  fs.writeFileSync(
    path.join(root, ...oversizedPath.split('/')),
    Buffer.alloc(1024 * 1024 + 1, 0x61)
  );
  fs.writeFileSync(
    path.join(root, ...invalidUtf8Path.split('/')),
    Buffer.from([0xff, 0xfe, 0xfd])
  );

  const report = runScienceCodeEvaluation({ packageRoot: root });
  assert.equal(report.status, 'fail');
  const bindings = new Map(report.source_bindings.map((binding) => [binding.path, binding]));
  assert.equal(bindings.get(missingPath).error, 'source_missing_or_unsafe');
  assert.equal(bindings.get(oversizedPath).error, 'source_too_large');
  assert.equal(bindings.get(invalidUtf8Path).error, 'source_not_utf8');
  assert.equal(report.metrics.scientific_safety.pass, false);
  assert.equal(report.metrics.agent_role_separation.pass, false);
});

test('evaluation refuses a bound source tree that resolves outside its package root', (context) => {
  const root = copiedEvaluationRoot(context);
  const agents = path.join(root, 'opencode', 'agents');
  fs.rmSync(agents, { recursive: true, force: true });
  try {
    fs.symlinkSync(
      path.join(packageRoot, 'opencode', 'agents'),
      agents,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Directory links are unavailable on this host.');
      return;
    }
    throw error;
  }

  const report = runScienceCodeEvaluation({ packageRoot: root });
  assert.equal(report.status, 'fail');
  const agentBindings = report.source_bindings.filter((binding) =>
    binding.path.startsWith('opencode/agents/')
  );
  assert.ok(agentBindings.length > 0);
  assert.ok(agentBindings.every((binding) =>
    binding.error === 'source_realpath_outside_package'
  ));
  assert.equal(report.metrics.agent_role_separation.pass, false);
});

test('evaluation CLI exposes human, JSON, help, aliases, and strict option semantics', () => {
  const json = invoke(['evaluate', '--json']);
  assert.equal(json.code, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.cases, 57);

  const help = invoke(['eval', '--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /sciencecode evaluate \[--json]/);
  assert.match(help.stdout, /not evidence of open-ended model intelligence/i);

  const invalid = invoke(['evaluation', '--unknown']);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Unknown option: --unknown/);
});
