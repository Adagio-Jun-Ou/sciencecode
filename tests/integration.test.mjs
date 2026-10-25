import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listRuns,
  readAuditRecords,
  runOpenCode,
  verifyAudit,
  verifyRun
} from '../lib/core.js';

function makeOpenCodeStub(directory) {
  const file = path.join(directory, 'opencode-stub.mjs');
  fs.writeFileSync(file, `
    import fs from 'node:fs';
    const args = process.argv.slice(2);
    fs.writeFileSync('captured-args.json', JSON.stringify(args, null, 2));
    fs.writeFileSync('captured-env.json', JSON.stringify({
      SCIENCECODE_HOME: process.env.SCIENCECODE_HOME,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
      OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT,
      OPENCODE_DISABLE_CLAUDE_CODE: process.env.OPENCODE_DISABLE_CLAUDE_CODE,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      TEMP: process.env.TEMP
    }, null, 2));
    fs.writeFileSync('result.txt', 'generated');
    console.log(JSON.stringify({ type: 'step_start', sessionID: 'ses_test', part: { type: 'step-start' } }));
    console.log(JSON.stringify({
      type: 'text',
      sessionID: 'ses_test',
      part: { type: 'text', text: 'analysis complete; token=supersecretvalue123', time: { end: Date.now() } }
    }));
    console.log(JSON.stringify({ type: 'step_finish', sessionID: 'ses_test', part: { type: 'step-finish' } }));
    console.error('password=hunter2');
  `);
  return file;
}

test('recorded run hands off exact arguments and creates verifiable redacted provenance', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-project-'));
  const config = path.join(directory, 'config');
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(directory, 'ARCHIVE_OLD.txt'), 'irreplaceable');
  const stub = makeOpenCodeStub(directory);
  const prompt = 'analyze A & B safely';
  const engineHome = path.join(directory, '.sciencecode', 'engine-test');
  const result = runOpenCode({
    cwd: directory,
    configDir: config,
    opencode: process.execPath,
    opencodePrefixArgs: [stub],
    scienceCodeHome: engineHome,
    agent: 'scientist',
    prompt
  });

  assert.equal(result.manifest.status, 'completed');
  assert.equal(result.manifest.exit_code, 0);
  assert.equal(fs.readFileSync(path.join(directory, 'ARCHIVE_OLD.txt'), 'utf8'), 'irreplaceable');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'captured-args.json'), 'utf8')), [
    'run',
    '--agent',
    'scientist',
    '--format',
    'json',
    '--',
    prompt
  ]);
  assert.ok(result.manifest.changes.added.includes('captured-args.json'));
  assert.ok(result.manifest.changes.added.includes('captured-env.json'));
  assert.ok(result.manifest.changes.added.includes('result.txt'));
  assert.equal(JSON.stringify(result.manifest).includes(prompt), false);
  assert.match(result.displayStdout, /\[REDACTED\]/);
  assert.doesNotMatch(result.displayStdout, /supersecretvalue123/);
  assert.equal(result.displayStderr, 'password=[REDACTED]\n');
  const capturedEnvironment = JSON.parse(fs.readFileSync(path.join(directory, 'captured-env.json'), 'utf8'));
  assert.equal(capturedEnvironment.SCIENCECODE_HOME, engineHome);
  assert.equal(capturedEnvironment.OPENCODE_CONFIG_DIR, config);
  assert.equal(capturedEnvironment.OPENCODE_DISABLE_CLAUDE_CODE, '1');
  assert.match(capturedEnvironment.XDG_CONFIG_HOME, /engine-test[\\/]xdg[\\/]config$/);
  assert.match(capturedEnvironment.XDG_DATA_HOME, /engine-test[\\/]xdg[\\/]data$/);
  assert.match(capturedEnvironment.TEMP, /engine-test[\\/]tmp$/);

  const eventsFile = path.join(result.runDir, 'events.jsonl');
  const events = fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events.length, 3);
  assert.equal(events[1].part.text, 'analysis complete; token=[REDACTED]');
  assert.equal(fs.readFileSync(path.join(result.runDir, 'stderr.log'), 'utf8'), 'password=[REDACTED]\n');
  assert.ok(fs.existsSync(path.join(result.runDir, 'snapshot-before.json')));
  assert.ok(fs.existsSync(path.join(result.runDir, 'snapshot-after.json')));
  assert.ok(fs.existsSync(path.join(result.runDir, 'manifest.sha256')));

  assert.equal(verifyAudit(directory).ok, true);
  assert.deepEqual(readAuditRecords(directory).map((event) => event.type), ['run.started', 'run.finished']);
  assert.equal(verifyRun(directory, result.manifest.run_id).ok, true);
  assert.deepEqual(listRuns(directory).map((run) => run.run_id), [result.manifest.run_id]);
});

test('recorded run rejects a secret before creating ScienceCode metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-secret-'));
  const config = path.join(directory, 'config');
  fs.mkdirSync(config);
  assert.throws(
    () => runOpenCode({
      cwd: directory,
      configDir: config,
      opencode: process.execPath,
      scienceCodeHome: path.join(directory, '.sciencecode', 'engine-test'),
      prompt: 'use token=supersecretvalue123'
    }),
    { code: 'SECRET_DETECTED' }
  );
  assert.equal(fs.existsSync(path.join(directory, '.sciencecode')), false);
});

test('run verification detects artifact mutation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-tamper-'));
  const config = path.join(directory, 'config');
  fs.mkdirSync(config);
  const stub = makeOpenCodeStub(directory);
  const result = runOpenCode({
    cwd: directory,
    configDir: config,
    opencode: process.execPath,
    opencodePrefixArgs: [stub],
    scienceCodeHome: path.join(directory, '.sciencecode', 'engine-test'),
    prompt: 'perform a safe analysis'
  });
  fs.appendFileSync(path.join(result.runDir, 'stdout.log'), 'tampered');
  const verification = verifyRun(directory, result.manifest.run_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.file === 'stdout.log' && error.issue === 'hash_mismatch'));
});
