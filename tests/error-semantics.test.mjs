import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../lib/cli.js';
import {
  REGISTERED_ERROR_CODES,
  cliExitCodeForError,
  httpStatusForError
} from '../lib/error-semantics.js';

// Codes that come from Node or the OS rather than from the product taxonomy.
const PLATFORM_ERROR_CODES = new Set([
  'ENOENT', 'ENOBUFS', 'EEXIST', 'EACCES', 'EPERM', 'EBUSY', 'ERR_INVALID_ARG_TYPE'
]);
import { startLab } from '../lib/lab.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; }
  };
}

function invoke(argv, cwd) {
  const stdout = capture();
  const stderr = capture();
  const code = runCli({
    argv,
    cwd,
    root: packageRoot,
    env: process.env,
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  return { code, stdout: stdout.read(), stderr: stderr.read() };
}

test('shared error semantics preserve distinct input, absence, conflict, and service states', () => {
  assert.equal(httpStatusForError({ status: 418, code: 'INVALID_REVIEW_ID' }), 418);
  assert.equal(httpStatusForError({ code: 'INVALID_REVIEW_ID' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_PREREGISTRATION_REQUEST' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_PROJECT_GATE_REQUEST' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_PROJECT_SNAPSHOT_REQUEST' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_PROJECT_SNAPSHOT_ID' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_BENCHMARK' }), 400);
  assert.equal(httpStatusForError({ code: 'BENCHMARK_LABELS_SEALED' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_UNIT' }), 400);
  assert.equal(httpStatusForError({ code: 'INVALID_QUANTITY' }), 400);
  assert.equal(httpStatusForError({ code: 'UNIT_DIMENSION_MISMATCH' }), 400);
  assert.equal(httpStatusForError({ code: 'REVIEW_NOT_FOUND' }), 404);
  assert.equal(httpStatusForError({ code: 'REVIEW_SOURCE_TOO_LARGE' }), 413);
  assert.equal(httpStatusForError({ code: 'PREREGISTRATION_TOO_LARGE' }), 413);
  assert.equal(httpStatusForError({ code: 'PROJECT_SNAPSHOT_MANIFEST_TOO_LARGE' }), 413);
  assert.equal(httpStatusForError({ code: 'BENCHMARK_TOO_LARGE' }), 413);
  assert.equal(httpStatusForError({ code: 'PROJECT_SNAPSHOT_NOT_FOUND' }), 404);
  assert.equal(httpStatusForError({ code: 'REVIEW_LIMIT' }), 409);
  assert.equal(httpStatusForError({ code: 'PREREGISTRATION_STORAGE_UNSAFE' }), 409);
  assert.equal(httpStatusForError({ code: 'PROJECT_GATE_BUSY' }), 409);
  assert.equal(httpStatusForError({ code: 'PROJECT_SNAPSHOT_BUSY' }), 409);
  assert.equal(httpStatusForError({ code: 'NPU_RUNTIME_UNAVAILABLE' }), 503);
  assert.equal(httpStatusForError({ code: 'PROJECT_GATE_WORKER_FAILED' }), 503);
  assert.equal(httpStatusForError({ code: 'PROJECT_SNAPSHOT_WORKER_FAILED' }), 503);
  assert.equal(httpStatusForError({ code: 'UNCLASSIFIED_FAILURE' }), 500);

  assert.equal(cliExitCodeForError({ code: 'INVALID_CAMPAIGN_ID' }), 2);
  assert.equal(cliExitCodeForError({ code: 'INVALID_BENCHMARK_RUN' }), 2);
  assert.equal(cliExitCodeForError({ code: 'UNIT_DIMENSION_MISMATCH' }), 2);
  assert.equal(cliExitCodeForError({ code: 'CAMPAIGN_NOT_FOUND' }), 1);
  assert.equal(cliExitCodeForError({ code: 'SECRET_DETECTED' }), 3);
  assert.equal(cliExitCodeForError({ code: 'ENOENT' }), 127);
  assert.equal(cliExitCodeForError({ code: 'UNCLASSIFIED_FAILURE' }), 1);
});

test('CLI reports malformed identifiers as usage and well-formed absent records as failures', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-error-cli-'));
  const malformed = [
    ['campaign', 'show', 'bad'],
    ['figure', 'show', 'bad'],
    ['figure', 'semantic', 'show', 'bad'],
    ['review', 'show', 'bad'],
    ['inference', 'show', '!'],
    ['simulate', 'show', '!'],
    ['experiment', 'show', '!'],
    ['preregister', 'show', '!'],
    ['show', '!']
  ];
  for (const argv of malformed) {
    const result = invoke(argv, directory);
    assert.equal(result.code, 2, argv.join(' ') + ': ' + result.stderr);
    assert.match(result.stderr, /Invalid .* ID/i);
  }

  const absent = [
    ['campaign', 'show', 'campaign-missing'],
    ['figure', 'show', 'figure-comparison-missing'],
    ['figure', 'semantic', 'show', 'figure-registration-missing'],
    ['review', 'show', 'review-missing'],
    ['inference', 'show', 'missing'],
    ['simulate', 'show', 'missing'],
    ['experiment', 'show', 'missing']
  ];
  for (const argv of absent) {
    const result = invoke(argv, directory);
    assert.equal(result.code, 1, argv.join(' ') + ': ' + result.stderr);
    assert.match(result.stderr, /not found/i);
  }
});

test('Lab detail routes distinguish malformed identifiers from absent records', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-error-lab-'));
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: null, npu: null, runtimes: {} })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const cases = [
    ['/api/simulations/%21', 400, 'INVALID_SIMULATION_ID'],
    ['/api/simulations/missing', 404, 'SIMULATION_NOT_FOUND'],
    ['/api/experiments/%21', 400, 'INVALID_EXPERIMENT_ID'],
    ['/api/experiments/missing', 404, 'EXPERIMENT_NOT_FOUND'],
    ['/api/inferences/%21', 400, 'INVALID_INFERENCE_ID'],
    ['/api/inferences/missing', 404, 'INFERENCE_NOT_FOUND'],
    ['/api/reviews/%21', 400, 'INVALID_REVIEW_ID'],
    ['/api/reviews/review-missing', 404, 'REVIEW_NOT_FOUND'],
    ['/api/figure-comparisons/%21', 400, 'INVALID_FIGURE_COMPARISON_ID'],
    ['/api/figure-comparisons/figure-comparison-missing', 404,
      'FIGURE_COMPARISON_NOT_FOUND'],
    ['/api/figure-registrations/%21', 400, 'INVALID_FIGURE_REGISTRATION_ID'],
    ['/api/figure-registrations/figure-registration-missing', 404,
      'FIGURE_REGISTRATION_NOT_FOUND'],
    ['/api/campaigns/%21', 400, 'INVALID_CAMPAIGN_ID'],
    ['/api/campaigns/campaign-missing', 404, 'CAMPAIGN_NOT_FOUND']
  ];
  for (const [pathname, status, code] of cases) {
    const response = await fetch(details.url + pathname);
    assert.equal(response.status, status, pathname);
    assert.equal((await response.json()).error.code, code, pathname);
  }
});

test('every error code thrown in lib/ is registered in the status taxonomy', () => {
  // An unregistered code silently becomes HTTP 500 and CLI exit 1, so a
  // not-found or a policy refusal would present as an internal fault.
  const registered = new Set(REGISTERED_ERROR_CODES);
  const libraryDir = path.join(packageRoot, 'lib');
  const thrown = new Map();
  for (const entry of fs.readdirSync(libraryDir)) {
    if (!entry.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(libraryDir, entry), 'utf8');
    for (const match of source.matchAll(/\bcode:\s*'([A-Z][A-Z0-9_]*)'/g)) {
      if (!thrown.has(match[1])) thrown.set(match[1], entry);
    }
    // Per-module error factories default a code as their second argument.
    for (const match of source.matchAll(/^\s*function \w*[Ee]rror\([^)]*=\s*'([A-Z][A-Z0-9_]*)'/gm)) {
      if (!thrown.has(match[1])) thrown.set(match[1], entry);
    }
  }
  assert.ok(thrown.size > 100, 'expected to find the thrown codes');
  const unregistered = [...thrown]
    .filter(([code]) => !registered.has(code) && !PLATFORM_ERROR_CODES.has(code))
    .map(([code, file]) => code + ' (' + file + ')')
    .sort();
  assert.deepEqual(unregistered, []);
});
