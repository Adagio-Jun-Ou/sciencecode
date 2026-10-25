import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatSession,
  getChatSession,
  getRunManifest,
  listChats,
  readAuditRecords,
  runSimulation,
  sendChatMessage,
  verifyChat,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-chat-'));
  const configDir = path.join(directory, 'config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("chat-linked simulation")\n');
  return {
    directory,
    configDir,
    scienceCodeHome: path.join(directory, '.engine-home')
  };
}

function engineRunner(calls, directory, { linkSimulation = false } = {}) {
  return (command, args) => {
    calls.push({ command, args: [...args] });
    if (linkSimulation && calls.length === 1) {
      runSimulation({
        cwd: directory,
        packageRoot,
        script: 'model.py',
        runtime: {
          healthy: true,
          profile: 'cpu',
          paths: { python: process.execPath },
          manifest: { schema_version: 1 },
          probe: { python: process.versions.node }
        },
        gpuProbe: () => ({ available: false, devices: [], error: 'test fixture' }),
        runner: () => ({ status: 0, signal: null, stdout: 'completed\n', stderr: '' })
      });
    }
    return {
      status: 0,
      signal: null,
      stderr: '',
      stdout: [
        JSON.stringify({ type: 'step_start', sessionID: 'ses_science_chat', part: { type: 'step-start' } }),
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_science_chat',
          part: { type: 'text', text: 'Recorded answer ' + calls.length }
        }),
        JSON.stringify({ type: 'step_finish', sessionID: 'ses_science_chat', part: { type: 'step-finish' } })
      ].join('\n') + '\n'
    };
  };
}

test('chat turns continue one engine session and form a verifiable transcript linked to runs', () => {
  const { directory, configDir, scienceCodeHome } = setup();
  const calls = [];
  const created = createChatSession({ cwd: directory, agent: 'scientist' });
  const first = sendChatMessage({
    cwd: directory,
    chatId: created.manifest.chat_id,
    message: 'Inspect the recorded evidence.',
    configDir,
    scienceCodeHome,
    opencode: process.execPath,
    runner: engineRunner(calls, directory, { linkSimulation: true })
  });
  const second = sendChatMessage({
    cwd: directory,
    chatId: created.manifest.chat_id,
    message: 'Now challenge the strongest claim.',
    configDir,
    scienceCodeHome,
    opencode: process.execPath,
    runner: engineRunner(calls, directory)
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.includes('--session'), false);
  const sessionIndex = calls[1].args.indexOf('--session');
  assert.notEqual(sessionIndex, -1);
  assert.equal(calls[1].args[sessionIndex + 1], 'ses_science_chat');
  assert.equal(first.turn.assistant.text, 'Recorded answer 1');
  assert.equal(second.turn.assistant.text, 'Recorded answer 2');
  assert.match(first.turn.linked_records[0].simulation_id, /^\d{8}T\d{6}Z-/);

  const detail = getChatSession(directory, created.manifest.chat_id);
  assert.equal(detail.manifest.turn_count, 2);
  assert.equal(detail.manifest.engine_session_id, 'ses_science_chat');
  assert.equal(detail.turns[1].previous_turn_sha256, detail.manifest.turns[0].sha256);
  assert.equal(detail.manifest.turn_head_sha256, detail.manifest.turns[1].sha256);
  assert.match(detail.manifest.title, /^Inspect the recorded evidence/);
  assert.deepEqual(listChats(directory).map((chat) => chat.chat_id), [created.manifest.chat_id]);

  for (const turn of detail.turns) {
    const run = getRunManifest(directory, turn.run_id);
    assert.deepEqual(run.chat, {
      chat_id: created.manifest.chat_id,
      turn_index: turn.turn_index
    });
    assert.equal(run.prompt_sha256, turn.user.sha256);
  }
  assert.equal(verifyChat(directory, created.manifest.chat_id).ok, true);
  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.chats, 1);
  assert.equal(gate.counts.runs, 2);
  assert.deepEqual(
    readAuditRecords(directory).map((record) => record.type),
    [
      'chat.created',
      'run.started',
      'simulation.started',
      'simulation.finished',
      'run.finished',
      'chat.turn.finished',
      'run.started',
      'run.finished',
      'chat.turn.finished'
    ]
  );
});

test('chat verification detects transcript tampering', () => {
  const { directory, configDir, scienceCodeHome } = setup();
  const created = createChatSession({ cwd: directory });
  sendChatMessage({
    cwd: directory,
    chatId: created.manifest.chat_id,
    message: 'Produce a testable hypothesis.',
    configDir,
    scienceCodeHome,
    opencode: process.execPath,
    runner: engineRunner([], directory)
  });
  const turnFile = path.join(created.directory, 'turns', '000001.json');
  const turn = JSON.parse(fs.readFileSync(turnFile, 'utf8'));
  turn.assistant.text = 'tampered response';
  fs.writeFileSync(turnFile, JSON.stringify(turn, null, 2) + '\n');
  const verification = verifyChat(directory, created.manifest.chat_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.issue === 'hash_mismatch'));
  assert.ok(verification.errors.some((error) => error.issue === 'assistant_message_hash_mismatch'));
});

test('chat message secret preflight runs before creating a turn or engine run', () => {
  const { directory, configDir, scienceCodeHome } = setup();
  const created = createChatSession({ cwd: directory });
  assert.throws(
    () => sendChatMessage({
      cwd: directory,
      chatId: created.manifest.chat_id,
      message: 'Use token=supersecretvalue123 in the analysis.',
      configDir,
      scienceCodeHome,
      opencode: process.execPath,
      runner: engineRunner([], directory)
    }),
    { code: 'SECRET_DETECTED' }
  );
  const detail = getChatSession(directory, created.manifest.chat_id);
  assert.equal(detail.manifest.turn_count, 0);
  assert.deepEqual(detail.turns, []);
  assert.equal(fs.readdirSync(path.join(directory, '.sciencecode', 'runs')).length, 0);
  assert.deepEqual(readAuditRecords(directory).map((record) => record.type), ['chat.created']);
  assert.equal(verifyChat(directory, created.manifest.chat_id).ok, true);
});

test('chat transcript reads reject manifest paths outside the turns namespace', () => {
  const { directory } = setup();
  const created = createChatSession({ cwd: directory });
  const manifestFile = path.join(created.directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.turn_count = 1;
  manifest.turns = [{
    turn_index: 1,
    file: 'manifest.json',
    sha256: 'd'.repeat(64),
    run_id: 'run-invalid',
    status: 'completed'
  }];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(
    () => getChatSession(directory, created.manifest.chat_id),
    { code: 'INVALID_TURN_PATH' }
  );
});
