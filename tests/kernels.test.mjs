import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createChatSession,
  createKernelManager,
  findExecutable,
  getChatSession,
  getKernelCell,
  kernelContext,
  listKernels,
  sendChatMessage,
  verifyAudit,
  verifyChat,
  verifyKernel,
  verifyProject
} from '../lib/core.js';

const python = findExecutable(process.platform === 'win32' ? 'python' : 'python3') ??
  findExecutable('python');

function project(prefix = 'sciencecode-kernel-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    directory,
    home: path.join(directory, '.runtime-home')
  };
}

function managerFor(fixture) {
  return createKernelManager({
    cwd: fixture.directory,
    scienceCodeHome: fixture.home,
    executables: { python }
  });
}

test('Python project kernel preserves state across cells and explicitly restores verified history', {
  skip: !python
}, async () => {
  const fixture = project();
  const firstManager = managerFor(fixture);
  try {
    const first = await firstManager.execute({
      language: 'python',
      code: 'x = 41\nprint("first output")\nx'
    });
    assert.equal(first.cell.manifest.execution_count, 1);
    assert.equal(first.cell.manifest.status, 'completed');
    assert.equal(first.cell.result.result.repr, '41');
    assert.match(first.cell.stdout, /first output/);

    const second = await firstManager.execute({
      language: 'python',
      code: 'x += 1\nx'
    });
    assert.equal(second.cell.result.result.repr, '42');
    assert.deepEqual(second.cell.result.variables.map((item) => item.name), ['x']);
    assert.equal(second.cell.result.variables[0].repr, '42');
    assert.equal(second.cell.manifest.previous_cell_sha256, first.verification.manifest_sha256);
    assert.equal(firstManager.status('python').history_loaded, true);
    assert.equal(verifyKernel(fixture.directory, 'python').ok, true);
  } finally {
    firstManager.shutdownAll('test_handoff');
  }

  const secondManager = managerFor(fixture);
  await assert.rejects(
    secondManager.execute({ language: 'python', code: 'x + 1' }),
    (error) => error.code === 'KERNEL_RESTORE_REQUIRED'
  );
  assert.equal(listKernels(fixture.directory)[0].execution_count, 2);
  try {
    const restored = await secondManager.restore('python');
    assert.equal(restored.history_loaded, true);
    assert.equal(restored.restored_through, 2);
    const third = await secondManager.execute({ language: 'python', code: 'x += 8\nx' });
    assert.equal(third.cell.result.result.repr, '50');
    assert.equal(third.cell.manifest.state_base.mode, 'restored');
    assert.equal(verifyKernel(fixture.directory, 'python').cells.length, 3);
  } finally {
    secondManager.shutdownAll('test_complete');
  }
  assert.equal(verifyAudit(fixture.directory).ok, true);
  assert.equal(verifyProject(fixture.directory).ok, true);
});

test('verified chat-linked notebook state reaches the next AI turn as bounded untrusted context', {
  skip: !python
}, async () => {
  const fixture = project('sciencecode-kernel-chat-');
  const configDir = path.join(fixture.directory, 'config');
  fs.mkdirSync(configDir);
  const chat = createChatSession({ cwd: fixture.directory, agent: 'scientist' });
  const manager = managerFor(fixture);
  let executed;
  try {
    executed = await manager.execute({
      language: 'python',
      chatId: chat.manifest.chat_id,
      code: 'candidate_score = 0.875\n{"candidate": "ZX-4", "score": candidate_score}'
    });
  } finally {
    manager.shutdownAll('chat_context_setup_complete');
  }

  const calls = [];
  const message = 'Use my notebook result to prioritize the next validation step.';
  const sent = sendChatMessage({
    cwd: fixture.directory,
    chatId: chat.manifest.chat_id,
    message,
    configDir,
    scienceCodeHome: path.join(fixture.directory, '.engine-home'),
    opencode: process.execPath,
    runner(command, args) {
      calls.push({ command, args: [...args] });
      return {
        status: 0,
        signal: null,
        stderr: '',
        stdout: [
          JSON.stringify({ type: 'step_start', sessionID: 'ses_kernel_context', part: { type: 'step-start' } }),
          JSON.stringify({
            type: 'text',
            sessionID: 'ses_kernel_context',
            part: { type: 'text', text: 'I used the verified ZX-4 notebook state.' }
          }),
          JSON.stringify({ type: 'step_finish', sessionID: 'ses_kernel_context', part: { type: 'step-finish' } })
        ].join('\n') + '\n'
      };
    }
  });

  assert.equal(calls.length, 1);
  const enginePrompt = calls[0].args.at(-1);
  assert.match(enginePrompt, /verified notebook context follows as JSONL/);
  assert.match(enginePrompt, /kernel-python.*cell-000001/);
  assert.match(enginePrompt, /candidate_score/);
  assert.match(enginePrompt, /ZX-4/);
  assert.equal(enginePrompt.endsWith(message), true);
  assert.equal(sent.turn.user.text, message);
  assert.equal(sent.turn.kernel_context.count, 1);
  assert.equal(sent.turn.kernel_context.cells[0].cell_id, executed.cell.manifest.cell_id);
  assert.equal(sent.turn.kernel_context.cells[0].code_sha256, executed.cell.manifest.code_sha256);
  assert.equal(verifyChat(fixture.directory, chat.manifest.chat_id).ok, true);
  assert.equal(getChatSession(fixture.directory, chat.manifest.chat_id).turns[0].kernel_context.count, 1);

  const resultFile = path.join(
    fixture.directory,
    '.sciencecode',
    'kernels',
    'kernel-python',
    'cells',
    executed.cell.manifest.cell_id,
    'result.json'
  );
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  result.result.repr = "{'candidate': 'tampered'}";
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n');
  const chatVerification = verifyChat(fixture.directory, chat.manifest.chat_id);
  assert.equal(chatVerification.ok, false);
  assert.ok(chatVerification.errors.some((error) => error.issue === 'kernel_context_invalid'));
});

test('kernel errors, timeouts, secret preflight, unsafe replay, and gate policy are explicit', {
  skip: !python
}, async () => {
  const fixture = project('sciencecode-kernel-failure-');
  const manager = managerFor(fixture);
  await assert.rejects(
    manager.execute({ language: 'python', code: 'token = "sk-abcdefghijklmnopqrstuvwxyz"' }),
    (error) => error.code === 'SECRET_DETECTED'
  );
  assert.equal(listKernels(fixture.directory).length, 0);

  try {
    const failed = await manager.execute({
      language: 'python',
      code: 'partial = 7\nraise ValueError("expected test failure")'
    });
    assert.equal(failed.cell.manifest.status, 'error');
    assert.equal(failed.cell.result.error.type, 'builtins.ValueError');
    assert.match(failed.cell.result.error.message, /expected test failure/);
    const followup = await manager.execute({ language: 'python', code: 'partial + 1' });
    assert.equal(followup.cell.result.result.repr, '8');
    assert.equal(verifyKernel(fixture.directory, 'python').ok, true);
    const strictGate = verifyProject(fixture.directory);
    assert.equal(strictGate.ok, false);
    assert.ok(strictGate.errors.some((error) => error.issue === 'failed_kernel_cells'));
    assert.equal(verifyProject(fixture.directory, { allowFailedKernelCells: true }).ok, true);
  } finally {
    manager.shutdownAll('failure_test_handoff');
  }

  const replay = managerFor(fixture);
  await assert.rejects(
    replay.restore('python'),
    (error) => error.code === 'KERNEL_RESTORE_UNSAFE'
  );
  replay.shutdownAll('unsafe_replay_test');

  const timeoutFixture = project('sciencecode-kernel-timeout-');
  const timeoutManager = managerFor(timeoutFixture);
  try {
    const timedOut = await timeoutManager.execute({
      language: 'python',
      code: 'import time\ntime.sleep(2)',
      timeoutMs: 100
    });
    assert.equal(timedOut.cell.manifest.status, 'timed_out');
    assert.equal(timedOut.cell.result.error.type, 'KERNEL_TIMEOUT');
    assert.equal(verifyKernel(timeoutFixture.directory, 'python').ok, true);
    assert.equal(timeoutManager.status('python').live, false);
  } finally {
    timeoutManager.shutdownAll('timeout_test_complete');
  }
});

test('a running kernel cell can be interrupted and is preserved as an immutable failed cell', {
  skip: !python
}, async () => {
  const fixture = project('sciencecode-kernel-interrupt-');
  const manager = managerFor(fixture);
  try {
    const pending = manager.execute({
      language: 'python',
      code: 'import time\ntime.sleep(30)',
      timeoutMs: 60_000
    });
    for (let attempt = 0; attempt < 100 && !manager.status('python').busy; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(manager.status('python').busy, true);
    assert.equal(manager.interrupt('python'), true);
    const interrupted = await pending;
    assert.equal(interrupted.cell.manifest.status, 'interrupted');
    assert.equal(interrupted.cell.result.error.type, 'KERNEL_INTERRUPTED');
    assert.equal(interrupted.verification.ok, true);
    assert.equal(manager.status('python').live, false);
    assert.equal(verifyProject(fixture.directory).ok, false);
    assert.equal(verifyProject(fixture.directory, { allowFailedKernelCells: true }).ok, true);
  } finally {
    manager.shutdownAll('interrupt_test_complete');
  }
});

test('kernel verification detects immutable source tampering', { skip: !python }, async () => {
  const fixture = project('sciencecode-kernel-tamper-');
  const manager = managerFor(fixture);
  try {
    await manager.execute({ language: 'python', code: 'answer = 42\nanswer' });
  } finally {
    manager.shutdownAll('tamper_setup_complete');
  }
  const cell = getKernelCell(fixture.directory, 'python', 1);
  const source = path.join(
    fixture.directory,
    '.sciencecode',
    'kernels',
    'kernel-python',
    'cells',
    cell.manifest.cell_id,
    cell.manifest.source.file
  );
  fs.writeFileSync(source, 'answer = 43\nanswer\n');
  const verification = verifyKernel(fixture.directory, 'python');
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.issue === 'cell_invalid'));
  assert.ok(verifyProject(fixture.directory).errors.some((error) => error.issue === 'kernel_invalid'));
});

test('kernel cell reads reject manifest-directed paths outside canonical cell files', {
  skip: !python
}, async () => {
  const fixture = project('sciencecode-kernel-manifest-path-');
  const manager = managerFor(fixture);
  try {
    await manager.execute({ language: 'python', code: 'safe_value = 12\nsafe_value' });
  } finally {
    manager.shutdownAll('manifest_path_setup_complete');
  }
  fs.writeFileSync(path.join(fixture.directory, 'outside-secret.txt'), 'must not be returned');
  const manifestFile = path.join(
    fixture.directory, '.sciencecode', 'kernels', 'kernel-python', 'cells',
    'cell-000001', 'cell.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.source.file = '../../../../../outside-secret.txt';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(() => getKernelCell(fixture.directory, 'python', 1), {
    code: 'INVALID_KERNEL_PATH'
  });
  assert.equal(verifyKernel(fixture.directory, 'python').ok, false);
  const chat = createChatSession({ cwd: fixture.directory });
  assert.throws(() => kernelContext(fixture.directory, chat.manifest.chat_id), {
    code: 'KERNEL_HISTORY_INVALID'
  });
});

test('kernel restore refuses an internal staging junction before replay writes', {
  skip: !python
}, async (context) => {
  const fixture = project('sciencecode-kernel-staging-path-');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-kernel-staging-outside-'));
  const first = managerFor(fixture);
  try {
    await first.execute({ language: 'python', code: 'restorable_value = 5' });
  } finally {
    first.shutdownAll('staging_path_setup_complete');
  }
  const staging = path.join(
    fixture.directory, '.sciencecode', 'kernels', 'kernel-python', '.staging'
  );
  fs.rmdirSync(staging);
  try {
    fs.symlinkSync(outside, staging, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Directory symlinks are unavailable on this test host.');
      return;
    }
    throw error;
  }
  const replay = managerFor(fixture);
  await assert.rejects(
    replay.restore('python'),
    (error) => error.code === 'INVALID_KERNEL_PATH'
  );
  replay.shutdownAll('staging_path_test_complete');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('kernel storage refuses a junction or symlink that escapes project metadata', (context) => {
  const fixture = project('sciencecode-kernel-storage-');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-kernel-outside-'));
  fs.mkdirSync(path.join(fixture.directory, '.sciencecode'));
  try {
    fs.symlinkSync(
      outside,
      path.join(fixture.directory, '.sciencecode', 'kernels'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Directory symlinks are unavailable on this test host.');
      return;
    }
    throw error;
  }
  assert.throws(() => listKernels(fixture.directory), { code: 'INVALID_KERNEL_PATH' });
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('optional R kernels report a missing explicit runtime without creating project records', async () => {
  const fixture = project('sciencecode-kernel-r-missing-');
  const manager = createKernelManager({
    cwd: fixture.directory,
    scienceCodeHome: fixture.home,
    executables: { r: path.join(fixture.directory, 'missing-rscript') }
  });
  const status = manager.status('r');
  assert.equal(status.available, false);
  assert.equal(status.recorded, false);
  await assert.rejects(
    manager.execute({ language: 'r', code: 'x <- 1' }),
    (error) => error.code === 'KERNEL_RUNTIME_UNAVAILABLE'
  );
  assert.equal(listKernels(fixture.directory).length, 0);
});
