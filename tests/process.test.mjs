import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findExecutable, runCommand, runCommandSync } from '../lib/core.js';

test('Windows executable resolution prefers PATHEXT commands over extensionless shims', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-path-'));
  fs.writeFileSync(path.join(directory, 'opencode'), '#!/bin/sh');
  fs.writeFileSync(path.join(directory, 'opencode.CMD'), '@echo off\r\n');
  const resolved = findExecutable(
    'opencode',
    { Path: directory, PathExt: '.COM;.EXE;.CMD;.BAT' },
    'win32'
  );
  assert.equal(resolved.toLowerCase(), path.join(directory, 'opencode.CMD').toLowerCase());
});

test('Windows npm-style command shims receive shell metacharacters as one literal argument', {
  skip: process.platform !== 'win32'
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cmd-'));
  const script = path.join(directory, 'echo-args.mjs');
  const shim = path.join(directory, 'echo-args.cmd');
  fs.writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))\n');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0echo-args.mjs" %*\r\n`);
  const value = 'A & echo INJECTED';
  const result = runCommandSync(shim, [value]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [value]);
  assert.equal(result.stdout.includes('\nINJECTED'), false);
});

test('asynchronous commands stream output and resolve with the synchronous result shape', async () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const result = await runCommand(process.execPath, [
    '--input-type=module',
    '-e',
    'process.stdout.write("first\\n"); process.stderr.write("warning\\n"); setTimeout(() => process.stdout.write("second\\n"), 15);'
  ], {
    onStdout(value) { stdoutChunks.push(value); },
    onStderr(value) { stderrChunks.push(value); }
  });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.error, null);
  assert.equal(result.stdout, 'first\nsecond\n');
  assert.equal(result.stderr, 'warning\n');
  assert.equal(stdoutChunks.join(''), result.stdout);
  assert.equal(stderrChunks.join(''), result.stderr);
});

test('asynchronous command launch failures resolve as recorded errors', async () => {
  const missing = path.join(os.tmpdir(), 'sciencecode-command-that-does-not-exist');
  const result = await runCommand(missing, []);
  assert.notEqual(result.error, null);
  assert.equal(result.error.code, 'ENOENT');
  assert.notEqual(result.status, 0);
});

test('asynchronous commands honor AbortSignal and preserve bounded partial output', {
  timeout: 30_000
}, async () => {
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const running = runCommand(process.execPath, [
    '--input-type=module',
    '-e',
    'process.stdout.write("started\\n"); setInterval(() => {}, 1000);'
  ], {
    signal: controller.signal,
    onStdout(value) {
      if (value.includes('started')) markStarted();
    }
  });
  await started;
  const abortedAt = Date.now();
  controller.abort('test_requested');
  const result = await running;
  assert.equal(result.aborted, true);
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(result.error?.code, 'ABORT_ERR');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /started/);
  assert.ok(Date.now() - abortedAt < 5_000);

  const preCancelled = new AbortController();
  preCancelled.abort('test_requested');
  const skipped = await runCommand(process.execPath, ['--version'], {
    signal: preCancelled.signal
  });
  assert.equal(skipped.aborted, true);
  assert.equal(skipped.status, null);
  assert.equal(skipped.stdout, '');
});
