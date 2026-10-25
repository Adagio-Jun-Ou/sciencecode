import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { VERSION } from './constants.js';
import { evidenceAwarePrompt, verifyEvidenceContext } from './evidence.js';
import { sha256File, sha256Text } from './hash.js';
import {
  interactionAwarePrompt,
  listInteractions,
  verifyInteractions
} from './interactions.js';
import { kernelAwarePrompt, verifyKernelContext } from './kernels.js';
import { runOpenCode, runOpenCodeAsync, verifyRun } from './runs.js';
import { scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  resolveInsideRoot,
  writeJson,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

export const CHAT_SCHEMA_VERSION = 1;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AGENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_MESSAGE_LENGTH = 32_768;
const LINKED_EVENT_TYPES = new Set([
  'analysis_assessment.created',
  'analysis_contract.created',
  'experiment.finished',
  'evidence.retrieved',
  'kernel.cell.executed',
  'preregistration.frozen',
  'procedure.created',
  'procedure_assessment.created',
  'procedure_decision.created',
  'run.finished',
  'simulation.finished',
  'simulation.template_created'
]);

export function makeChatId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'chat-' + stamp + '-' + crypto.randomBytes(3).toString('hex');
}

function chatsDirectory(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'chats');
}

export function resolveChatDirectory(cwd, chatId) {
  if (!CHAT_ID_PATTERN.test(String(chatId ?? '')) || chatId === '.' || chatId === '..') {
    throw Object.assign(new Error('Invalid chat ID: ' + String(chatId ?? '')), {
      code: 'INVALID_CHAT_ID'
    });
  }
  return path.join(chatsDirectory(cwd), chatId);
}

function normalizeTitle(value, fallback = 'New research conversation') {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const title = String(value).replace(/\s+/g, ' ').trim();
  if (title.length > 120) {
    throw Object.assign(new Error('Chat title must be 120 characters or fewer.'), {
      code: 'INVALID_CHAT_TITLE'
    });
  }
  const findings = scanSecrets(title);
  if (findings.length) {
    throw Object.assign(new Error('Potential secret detected in chat title; refusing to persist it.'), {
      code: 'SECRET_DETECTED',
      findings
    });
  }
  return title;
}

function validateAgent(agent) {
  if (!AGENT_PATTERN.test(String(agent ?? ''))) {
    throw Object.assign(new Error('Invalid chat agent: ' + String(agent ?? '')), {
      code: 'INVALID_AGENT'
    });
  }
  return agent;
}

function validateMessage(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error('A non-empty research message is required.'), {
      code: 'MESSAGE_REQUIRED'
    });
  }
  if (value.length > MAX_MESSAGE_LENGTH) {
    throw Object.assign(new Error('Research messages are limited to ' + MAX_MESSAGE_LENGTH + ' characters.'), {
      code: 'MESSAGE_TOO_LARGE'
    });
  }
  const findings = scanSecrets(value);
  if (findings.length) {
    throw Object.assign(
      new Error(
        'Potential secret detected in message (' +
        findings.map((finding) => finding.rule).join(', ') +
        '); refusing to persist or send it.'
      ),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return value;
}

function manifestPaths(directory) {
  return {
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    turns: path.join(directory, 'turns')
  };
}

function persistManifest(directory, manifest, exclusive = false) {
  const paths = manifestPaths(directory);
  if (exclusive) {
    writeJsonExclusive(paths.manifest, manifest);
  } else {
    writeJson(paths.manifest, manifest);
  }
  const digest = sha256File(paths.manifest);
  if (exclusive) {
    writeTextExclusive(paths.digest, digest + '\n');
  } else {
    fs.writeFileSync(paths.digest, digest + '\n', { encoding: 'utf8', mode: 0o600 });
  }
  return digest;
}

function summaryFromManifest(manifest) {
  return {
    chat_id: manifest.chat_id,
    title: manifest.title,
    agent: manifest.agent,
    status: manifest.status,
    turn_count: manifest.turn_count,
    started_at: manifest.started_at,
    updated_at: manifest.updated_at,
    last_turn_status: manifest.last_turn_status ?? null
  };
}

export function createChatSession({
  cwd,
  title,
  agent = 'scientist',
  now = new Date()
}) {
  const project = path.resolve(cwd);
  validateAgent(agent);
  const scienceBase = ensureScienceDir(project);
  const chatId = makeChatId(now);
  const directory = path.join(scienceBase, 'chats', chatId);
  fs.mkdirSync(path.join(directory, 'turns'), { recursive: true, mode: 0o700 });
  const timestamp = now.toISOString();
  const manifest = {
    schema_version: CHAT_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    chat_id: chatId,
    title: normalizeTitle(title),
    agent,
    status: 'active',
    started_at: timestamp,
    updated_at: timestamp,
    engine_session_id: null,
    turn_count: 0,
    turn_head_sha256: null,
    turns: [],
    preservation_policy: 'append-only transcript; individual turns and linked run records are never overwritten'
  };
  const manifestHash = persistManifest(directory, manifest, true);
  appendAudit(project, {
    type: 'chat.created',
    chat_id: chatId,
    agent,
    manifest_sha256: manifestHash
  });
  return {
    manifest,
    manifest_sha256: manifestHash,
    directory
  };
}

export function getChatManifest(cwd, chatId) {
  const directory = resolveChatDirectory(cwd, chatId);
  const file = path.join(directory, 'manifest.json');
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error('Chat not found: ' + chatId), { code: 'CHAT_NOT_FOUND' });
  }
  return readJson(file);
}

export function listChats(cwd) {
  const directory = chatsDirectory(cwd);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return summaryFromManifest(getChatManifest(cwd, entry.name));
      } catch (error) {
        return {
          chat_id: entry.name,
          title: 'Invalid conversation record',
          status: 'invalid',
          turn_count: 0,
          error: error.message
        };
      }
    })
    .sort((left, right) => String(right.updated_at ?? right.chat_id).localeCompare(
      String(left.updated_at ?? left.chat_id)
    ));
}

function readTurn(directory, summary) {
  if (!/^turns\/\d{6}\.json$/.test(String(summary.file ?? '').replace(/\\/g, '/'))) {
    throw Object.assign(new Error('Chat manifest contains an invalid turn path.'), {
      code: 'INVALID_TURN_PATH'
    });
  }
  const file = resolveInsideRoot(directory, summary.file);
  const rootReal = fs.realpathSync(directory);
  const fileReal = fs.realpathSync(file);
  if (!isPathInside(rootReal, fileReal) || !fs.statSync(fileReal).isFile()) {
    throw Object.assign(new Error('Chat turn escapes its transcript directory.'), {
      code: 'INVALID_TURN_PATH'
    });
  }
  return readJson(fileReal);
}

export function getChatSession(cwd, chatId) {
  const directory = resolveChatDirectory(cwd, chatId);
  const manifest = getChatManifest(cwd, chatId);
  return {
    manifest,
    turns: manifest.turns.map((summary) => readTurn(directory, summary))
  };
}

function compactAuditLink(record) {
  const identifiers = {};
  for (const name of [
    'run_id', 'simulation_id', 'inference_id', 'experiment_id', 'preregistration_id', 'retrieval_id',
    'analysis_contract_id', 'analysis_assessment_id', 'procedure_id',
    'procedure_assessment_id', 'procedure_decision_id', 'campaign_id'
  ]) {
    if (record[name]) identifiers[name] = record[name];
  }
  return {
    type: record.type,
    sequence: record.sequence,
    hash: record.hash,
    ts: record.ts,
    ...identifiers
  };
}

function linkedRecords(records, startIndex, parentRunId) {
  return records.slice(startIndex)
    .filter((record) => LINKED_EVENT_TYPES.has(record.type))
    .filter((record) => record.type !== 'run.finished' || record.run_id !== parentRunId)
    .map(compactAuditLink);
}

function automaticTitle(message) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length <= 84 ? normalized : normalized.slice(0, 81).trimEnd() + '...';
}

export function sendChatMessage({
  cwd,
  chatId,
  message,
  configDir,
  packageRoot,
  scienceCodeHome,
  env = process.env,
  opencode,
  opencodePrefixArgs = [],
  runner
}) {
  const project = path.resolve(cwd);
  validateMessage(message);
  const directory = resolveChatDirectory(project, chatId);
  const manifest = getChatManifest(project, chatId);
  validateAgent(manifest.agent);
  if (manifest.status !== 'active') {
    throw Object.assign(new Error('Chat is not active: ' + chatId), { code: 'CHAT_NOT_ACTIVE' });
  }
  const turnIndex = manifest.turn_count + 1;
  const auditStart = readAuditRecords(project).length;
  const startedAt = new Date();
  const interaction = interactionAwarePrompt({ cwd: project, chatId, message });
  const kernel = kernelAwarePrompt({ cwd: project, chatId, basePrompt: interaction.prompt });
  const evidence = evidenceAwarePrompt({
    cwd: project,
    message,
    basePrompt: kernel.prompt,
    now: startedAt
  });
  const passthrough = manifest.engine_session_id
    ? ['--session', manifest.engine_session_id]
    : [];
  const result = runOpenCode({
    cwd: project,
    configDir,
    packageRoot,
    scienceCodeHome,
    env,
    opencode,
    opencodePrefixArgs,
    runner,
    agent: manifest.agent,
    prompt: evidence.prompt,
    passthrough,
    format: 'json',
    storePrompt: true,
    chat: {
      chat_id: chatId,
      turn_index: turnIndex
    }
  });
  const eventSessionIds = result.manifest.events?.session_ids ?? [];
  const engineSessionId = manifest.engine_session_id ?? eventSessionIds[0] ?? null;
  const sessionConsistent = !manifest.engine_session_id ||
    eventSessionIds.length === 0 ||
    eventSessionIds.includes(manifest.engine_session_id);
  const finishedAt = new Date();
  const assistantText = result.displayStdout.trim();
  const errorText = result.displayStderr.trim();
  const auditRecords = readAuditRecords(project);
  const turn = {
    schema_version: CHAT_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    chat_id: chatId,
    turn_index: turnIndex,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    agent: manifest.agent,
    status: result.manifest.status,
    exit_code: result.manifest.exit_code,
    run_id: result.manifest.run_id,
    engine_session_id: engineSessionId,
    session_consistent: sessionConsistent,
    previous_turn_sha256: manifest.turn_head_sha256,
    user: {
      text: message,
      sha256: sha256Text(message)
    },
    engine_prompt_sha256: result.manifest.prompt_sha256,
    interaction_context: interaction.context,
    kernel_context: kernel.context,
    evidence_context: evidence.context,
    assistant: {
      text: assistantText,
      sha256: sha256Text(assistantText)
    },
    error: errorText || result.manifest.launch_error || null,
    events: result.manifest.events,
    changes: result.manifest.changes,
    linked_records: linkedRecords(auditRecords, auditStart, result.manifest.run_id)
  };
  const relative = path.join('turns', String(turnIndex).padStart(6, '0') + '.json');
  const turnFile = path.join(directory, relative);
  writeJsonExclusive(turnFile, turn);
  const turnHash = sha256File(turnFile);

  manifest.updated_at = finishedAt.toISOString();
  manifest.engine_session_id = engineSessionId;
  manifest.turn_count = turnIndex;
  manifest.turn_head_sha256 = turnHash;
  manifest.last_turn_status = turn.status;
  if (turnIndex === 1 && manifest.title === 'New research conversation') {
    manifest.title = automaticTitle(message);
  }
  manifest.turns.push({
    turn_index: turnIndex,
    file: relative.split(path.sep).join('/'),
    sha256: turnHash,
    run_id: turn.run_id,
    status: turn.status,
    started_at: turn.started_at,
    finished_at: turn.finished_at
  });
  const manifestHash = persistManifest(directory, manifest);
  appendAudit(project, {
    type: 'chat.turn.finished',
    chat_id: chatId,
    turn_index: turnIndex,
    run_id: turn.run_id,
    status: turn.status,
    turn_sha256: turnHash,
    manifest_sha256: manifestHash,
    linked_records: turn.linked_records.map((record) => ({
      type: record.type,
      sequence: record.sequence,
      hash: record.hash
    }))
  });
  return {
    chat: summaryFromManifest(manifest),
    turn,
    manifest_sha256: manifestHash
  };
}

/**
 * Nonblocking Lab turn with the same transcript and audit format as the CLI
 * path. Sanitized engine events are forwarded to the in-memory Lab job trace.
 */
export async function sendChatMessageAsync({
  cwd,
  chatId,
  message,
  configDir,
  packageRoot,
  scienceCodeHome,
  env = process.env,
  opencode,
  opencodePrefixArgs = [],
  runner,
  onEvent,
  signal
}) {
  const project = path.resolve(cwd);
  validateMessage(message);
  const directory = resolveChatDirectory(project, chatId);
  const manifest = getChatManifest(project, chatId);
  validateAgent(manifest.agent);
  if (manifest.status !== 'active') {
    throw Object.assign(new Error('Chat is not active: ' + chatId), { code: 'CHAT_NOT_ACTIVE' });
  }
  const turnIndex = manifest.turn_count + 1;
  const auditStart = readAuditRecords(project).length;
  const startedAt = new Date();
  const interaction = interactionAwarePrompt({ cwd: project, chatId, message });
  const kernel = kernelAwarePrompt({ cwd: project, chatId, basePrompt: interaction.prompt });
  const evidence = evidenceAwarePrompt({
    cwd: project,
    message,
    basePrompt: kernel.prompt,
    now: startedAt
  });
  const passthrough = manifest.engine_session_id
    ? ['--session', manifest.engine_session_id]
    : [];
  const result = await runOpenCodeAsync({
    cwd: project,
    configDir,
    packageRoot,
    scienceCodeHome,
    env,
    opencode,
    opencodePrefixArgs,
    runner,
    onEvent,
    signal,
    agent: manifest.agent,
    prompt: evidence.prompt,
    passthrough,
    format: 'json',
    storePrompt: true,
    chat: {
      chat_id: chatId,
      turn_index: turnIndex
    }
  });
  const eventSessionIds = result.manifest.events?.session_ids ?? [];
  const engineSessionId = manifest.engine_session_id ?? eventSessionIds[0] ?? null;
  const sessionConsistent = !manifest.engine_session_id ||
    eventSessionIds.length === 0 ||
    eventSessionIds.includes(manifest.engine_session_id);
  const finishedAt = new Date();
  const assistantText = result.displayStdout.trim();
  const errorText = result.displayStderr.trim();
  const auditRecords = readAuditRecords(project);
  const turn = {
    schema_version: CHAT_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    chat_id: chatId,
    turn_index: turnIndex,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    agent: manifest.agent,
    status: result.manifest.status,
    exit_code: result.manifest.exit_code,
    run_id: result.manifest.run_id,
    engine_session_id: engineSessionId,
    session_consistent: sessionConsistent,
    previous_turn_sha256: manifest.turn_head_sha256,
    user: {
      text: message,
      sha256: sha256Text(message)
    },
    engine_prompt_sha256: result.manifest.prompt_sha256,
    interaction_context: interaction.context,
    kernel_context: kernel.context,
    evidence_context: evidence.context,
    assistant: {
      text: assistantText,
      sha256: sha256Text(assistantText)
    },
    error: result.manifest.status === 'cancelled'
      ? null
      : errorText || result.manifest.launch_error || null,
    cancellation: result.manifest.status === 'cancelled'
      ? {
          cancelled_at: result.manifest.cancelled_at,
          reason: result.manifest.cancellation?.reason ?? 'abort_signal',
          partial_output_preserved: true
        }
      : null,
    events: result.manifest.events,
    changes: result.manifest.changes,
    linked_records: linkedRecords(auditRecords, auditStart, result.manifest.run_id)
  };
  const relative = path.join('turns', String(turnIndex).padStart(6, '0') + '.json');
  const turnFile = path.join(directory, relative);
  writeJsonExclusive(turnFile, turn);
  const turnHash = sha256File(turnFile);

  manifest.updated_at = finishedAt.toISOString();
  manifest.engine_session_id = engineSessionId;
  manifest.turn_count = turnIndex;
  manifest.turn_head_sha256 = turnHash;
  manifest.last_turn_status = turn.status;
  if (turnIndex === 1 && manifest.title === 'New research conversation') {
    manifest.title = automaticTitle(message);
  }
  manifest.turns.push({
    turn_index: turnIndex,
    file: relative.split(path.sep).join('/'),
    sha256: turnHash,
    run_id: turn.run_id,
    status: turn.status,
    started_at: turn.started_at,
    finished_at: turn.finished_at
  });
  const manifestHash = persistManifest(directory, manifest);
  appendAudit(project, {
    type: 'chat.turn.finished',
    chat_id: chatId,
    turn_index: turnIndex,
    run_id: turn.run_id,
    status: turn.status,
    turn_sha256: turnHash,
    manifest_sha256: manifestHash,
    linked_records: turn.linked_records.map((record) => ({
      type: record.type,
      sequence: record.sequence,
      hash: record.hash
    }))
  });
  if (typeof onEvent === 'function') {
    onEvent({
      type: 'outcome.recorded',
      timestamp: finishedAt.toISOString(),
      status: turn.status,
      title: turn.status === 'completed'
        ? 'Outcome added to the design board'
        : turn.status === 'cancelled'
          ? 'Cancelled turn preserved as incomplete'
          : 'Failed turn preserved for review',
      run_id: turn.run_id,
      turn_index: turn.turn_index
    });
  }
  return {
    chat: summaryFromManifest(manifest),
    turn,
    manifest_sha256: manifestHash
  };
}

export function verifyChat(cwd, chatId) {
  const project = path.resolve(cwd);
  const errors = [];
  let directory;
  let manifest;
  try {
    directory = resolveChatDirectory(project, chatId);
    manifest = getChatManifest(project, chatId);
  } catch (error) {
    return {
      ok: false,
      chat_id: chatId,
      errors: [{ issue: error.code ?? 'chat_error', detail: error.message }]
    };
  }
  const paths = manifestPaths(directory);
  const manifestHash = sha256File(paths.manifest);
  if (!fs.existsSync(paths.digest)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else {
    const expected = fs.readFileSync(paths.digest, 'utf8').trim();
    if (expected !== manifestHash) {
      errors.push({ file: 'manifest.json', issue: 'hash_mismatch', expected, actual: manifestHash });
    }
  }
  if (manifest.schema_version !== CHAT_SCHEMA_VERSION) {
    errors.push({
      file: 'manifest.json',
      issue: 'unsupported_schema',
      expected: CHAT_SCHEMA_VERSION,
      actual: manifest.schema_version
    });
  }
  if (manifest.chat_id !== chatId) {
    errors.push({ file: 'manifest.json', issue: 'chat_id_mismatch' });
  }
  if (manifest.turn_count !== manifest.turns?.length) {
    errors.push({
      file: 'manifest.json',
      issue: 'turn_count_mismatch',
      expected: manifest.turns?.length ?? 0,
      actual: manifest.turn_count
    });
  }

  const audit = verifyAudit(project);
  const auditRecords = audit.ok ? readAuditRecords(project) : [];
  if (!audit.ok) errors.push({ issue: 'audit_invalid', errors: audit.errors });
  const interactions = verifyInteractions(project, chatId);
  if (!interactions.ok) {
    errors.push({ issue: 'interactions_invalid', errors: interactions.errors });
  }
  const interactionRecords = interactions.ok ? listInteractions(project, chatId) : [];
  let previousHash = null;
  const seenRuns = new Set();
  for (let index = 0; index < (manifest.turns ?? []).length; index += 1) {
    const summary = manifest.turns[index];
    const expectedIndex = index + 1;
    if (summary.turn_index !== expectedIndex) {
      errors.push({ file: summary.file, issue: 'turn_index_mismatch', expected: expectedIndex, actual: summary.turn_index });
    }
    let file;
    let turn;
    try {
      if (!/^turns\/\d{6}\.json$/.test(String(summary.file ?? '').replace(/\\/g, '/'))) {
        throw Object.assign(new Error('Invalid turn path.'), { code: 'INVALID_TURN_PATH' });
      }
      file = resolveInsideRoot(directory, summary.file);
      const rootReal = fs.realpathSync(directory);
      const fileReal = fs.realpathSync(file);
      if (!isPathInside(rootReal, fileReal) || !fs.statSync(fileReal).isFile()) {
        throw Object.assign(new Error('Turn path escapes transcript directory.'), {
          code: 'INVALID_TURN_PATH'
        });
      }
      file = fileReal;
      turn = readJson(file);
    } catch (error) {
      errors.push({ file: summary.file, issue: 'invalid_turn', detail: error.message });
      continue;
    }
    const actualHash = sha256File(file);
    if (actualHash !== summary.sha256) {
      errors.push({ file: summary.file, issue: 'hash_mismatch', expected: summary.sha256, actual: actualHash });
    }
    if (turn.previous_turn_sha256 !== previousHash) {
      errors.push({
        file: summary.file,
        issue: 'turn_chain_break',
        expected: previousHash,
        actual: turn.previous_turn_sha256 ?? null
      });
    }
    previousHash = actualHash;
    if (turn.chat_id !== chatId || turn.turn_index !== expectedIndex) {
      errors.push({ file: summary.file, issue: 'turn_identity_mismatch' });
    }
    if (summary.run_id !== turn.run_id) {
      errors.push({
        file: summary.file,
        issue: 'turn_summary_run_mismatch',
        expected: turn.run_id,
        actual: summary.run_id
      });
    }
    if (summary.status !== turn.status) {
      errors.push({
        file: summary.file,
        issue: 'turn_summary_status_mismatch',
        expected: turn.status,
        actual: summary.status
      });
    }
    if (sha256Text(turn.user?.text ?? '') !== turn.user?.sha256) {
      errors.push({ file: summary.file, issue: 'user_message_hash_mismatch' });
    }
    if (sha256Text(turn.assistant?.text ?? '') !== turn.assistant?.sha256) {
      errors.push({ file: summary.file, issue: 'assistant_message_hash_mismatch' });
    }
    const notebookContext = verifyKernelContext(project, turn.kernel_context, { chatId });
    if (!notebookContext.ok) {
      errors.push({
        file: summary.file,
        issue: 'kernel_context_invalid',
        errors: notebookContext.errors
      });
    }
    const evidenceContext = verifyEvidenceContext(project, turn.evidence_context, {
      query: turn.user?.text
    });
    if (!evidenceContext.ok) {
      errors.push({
        file: summary.file,
        issue: 'evidence_context_invalid',
        retrieval_id: turn.evidence_context?.retrieval_id ?? null,
        errors: evidenceContext.errors
      });
    }
    if (seenRuns.has(turn.run_id)) {
      errors.push({ file: summary.file, issue: 'duplicate_run_link', run_id: turn.run_id });
    }
    seenRuns.add(turn.run_id);
    const runVerification = verifyRun(project, turn.run_id);
    if (!runVerification.ok) {
      errors.push({ file: summary.file, issue: 'run_invalid', run_id: turn.run_id, errors: runVerification.errors });
    } else {
      const context = runVerification.manifest.chat;
      if (context?.chat_id !== chatId || context?.turn_index !== expectedIndex) {
        errors.push({ file: summary.file, issue: 'run_chat_link_mismatch', run_id: turn.run_id });
      }
      if (runVerification.manifest.status !== turn.status) {
        errors.push({
          file: summary.file,
          issue: 'run_status_mismatch',
          run_id: turn.run_id,
          expected: turn.status,
          actual: runVerification.manifest.status
        });
      }
      const expectedPromptHash = turn.engine_prompt_sha256 ?? turn.user?.sha256;
      if (runVerification.manifest.prompt_sha256 !== expectedPromptHash) {
        errors.push({ file: summary.file, issue: 'run_prompt_hash_mismatch', run_id: turn.run_id });
      }
      if (turn.interaction_context?.head_hash && !interactionRecords.some(
        (record) => record.hash === turn.interaction_context.head_hash
      )) {
        errors.push({ file: summary.file, issue: 'interaction_context_missing', run_id: turn.run_id });
      }
    }
    for (const link of turn.linked_records ?? []) {
      const record = auditRecords[link.sequence - 1];
      if (!record || record.hash !== link.hash || record.type !== link.type) {
        errors.push({
          file: summary.file,
          issue: 'linked_audit_record_mismatch',
          sequence: link.sequence
        });
      }
    }
  }
  if ((manifest.turn_head_sha256 ?? null) !== previousHash) {
    errors.push({
      file: 'manifest.json',
      issue: 'turn_head_mismatch',
      expected: previousHash,
      actual: manifest.turn_head_sha256 ?? null
    });
  }
  if (audit.ok) {
    const latest = auditRecords.findLast(
      (record) => (record.type === 'chat.created' || record.type === 'chat.turn.finished') &&
        record.chat_id === chatId
    );
    if (!latest) {
      errors.push({ issue: 'missing_chat_audit_event' });
    } else if (latest.manifest_sha256 !== manifestHash) {
      errors.push({
        issue: 'audit_manifest_mismatch',
        expected: latest.manifest_sha256 ?? null,
        actual: manifestHash
      });
    }
  }
  return {
    ok: errors.length === 0,
    chat_id: chatId,
    manifest,
    manifest_sha256: manifestHash,
    interactions,
    errors
  };
}
