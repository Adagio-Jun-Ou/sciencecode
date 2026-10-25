import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { RUN_SCHEMA_VERSION, VERSION } from './constants.js';
import { publicOpenCodeEvent, renderOpenCodeEvents, summarizeOpenCodeEvents } from './events.js';
import { sha256File, sha256Text } from './hash.js';
import { findExecutable, runCommand, runCommandSync } from './process.js';
import {
  ensureScienceCodeHome,
  isolatedOpenCodeEnvironment,
  resolveBundledOpenCode,
  resolveScienceCodeHome
} from './runtime.js';
import { redactText, scanSecrets } from './security.js';
import { diffSnapshots, snapshot } from './snapshot.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  readJson,
  resolveInsideRoot,
  writeJson,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

const AGENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function makeRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function validateRunInput({ cwd, configDir, agent, prompt, format, passthrough, opencodePrefixArgs }) {
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw Object.assign(new Error(`Project directory does not exist: ${cwd}`), { code: 'PROJECT_NOT_FOUND' });
  }
  if (!fs.statSync(configDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw Object.assign(new Error(`ScienceCode config directory does not exist: ${configDir}`), { code: 'CONFIG_NOT_FOUND' });
  }
  if (!AGENT_PATTERN.test(agent)) {
    throw Object.assign(new Error(`Invalid agent name: ${agent}`), { code: 'INVALID_AGENT' });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw Object.assign(new Error('A non-empty research prompt is required.'), { code: 'PROMPT_REQUIRED' });
  }
  const findings = scanSecrets(prompt);
  if (findings.length) {
    throw Object.assign(
      new Error(`Potential secret detected in prompt (${findings.map((finding) => finding.rule).join(', ')}); refusing to persist or send it.`),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  if (!['default', 'json'].includes(format)) {
    throw Object.assign(new Error(`Unsupported OpenCode format: ${format}`), { code: 'INVALID_FORMAT' });
  }
  if (!Array.isArray(passthrough) || !Array.isArray(opencodePrefixArgs)) {
    throw Object.assign(new Error('OpenCode arguments must be arrays.'), { code: 'INVALID_ARGUMENTS' });
  }
}

function artifactMetadata(runDir, names) {
  const artifacts = {};
  for (const name of names) {
    const file = path.join(runDir, name);
    if (!fs.existsSync(file)) continue;
    artifacts[name] = { sha256: sha256File(file), bytes: fs.statSync(file).size };
  }
  return artifacts;
}

export function runOpenCode({
  cwd,
  configDir,
  opencode,
  opencodePrefixArgs = [],
  packageRoot,
  scienceCodeHome,
  agent = 'scientist',
  prompt,
  passthrough = [],
  format = 'json',
  storePrompt = true,
  chat = null,
  env = process.env,
  runner = runCommandSync
}) {
  const project = path.resolve(cwd);
  const configuration = path.resolve(configDir);
  validateRunInput({
    cwd: project,
    configDir: configuration,
    agent,
    prompt,
    format,
    passthrough,
    opencodePrefixArgs
  });
  if (
    chat !== null &&
    (
      typeof chat !== 'object' ||
      !/^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(chat.chat_id ?? '')) ||
      !Number.isInteger(chat.turn_index) ||
      chat.turn_index < 1
    )
  ) {
    throw Object.assign(new Error('Invalid chat context for recorded run.'), {
      code: 'INVALID_CHAT_CONTEXT'
    });
  }

  const executable = opencode
    ? (findExecutable(opencode, env) ?? opencode)
    : resolveBundledOpenCode(packageRoot);
  const engineEnvironment = isolatedOpenCodeEnvironment({
    configDir: configuration,
    env,
    scienceCodeHome: scienceCodeHome ?? resolveScienceCodeHome(env),
    packageRoot,
    projectRoot: project
  });
  ensureScienceCodeHome(engineEnvironment.SCIENCECODE_HOME);

  const scienceBase = ensureScienceDir(project);
  const id = makeRunId();
  const runDir = path.join(scienceBase, 'runs', id);
  fs.mkdirSync(runDir, { recursive: false, mode: 0o700 });
  const startedAt = new Date();
  const before = snapshot(project);
  const promptHash = sha256Text(prompt);
  const request = storePrompt
    ? `# Research request\n\n${prompt}\n`
    : `# Research request\n\n[Prompt omitted by user request. SHA-256: ${promptHash}]\n`;
  writeTextExclusive(path.join(runDir, 'request.md'), request);

  const childArguments = [
    ...opencodePrefixArgs,
    'run',
    '--agent',
    agent,
    '--format',
    format,
    ...passthrough,
    '--',
    prompt
  ];
  const manifest = {
    schema_version: RUN_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    run_id: id,
    started_at: startedAt.toISOString(),
    cwd: project,
    agent,
    capture_format: format,
    request_storage: storePrompt ? 'full' : 'hash-only',
    command: [
      executable,
      ...opencodePrefixArgs,
      'run',
      '--agent',
      agent,
      '--format',
      format,
      ...passthrough.map((value) => redactText(value)),
      '--',
      '[PROMPT REDACTED FROM MANIFEST]'
    ],
    prompt_sha256: promptHash,
    chat: chat ? {
      chat_id: chat.chat_id,
      turn_index: chat.turn_index
    } : undefined,
    preservation_policy: 'append-only; do not delete archived/legacy work',
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      engine: executable,
      sciencecode_home: engineEnvironment.SCIENCECODE_HOME
    },
    status: 'running'
  };
  writeJsonExclusive(path.join(runDir, 'manifest.json'), manifest);
  appendAudit(project, {
    type: 'run.started',
    run_id: id,
    agent,
    prompt_sha256: promptHash,
    capture_format: format,
    chat_id: chat?.chat_id,
    chat_turn_index: chat?.turn_index
  });

  const child = runner(executable, childArguments, {
    cwd: project,
    env: {
      ...engineEnvironment,
      SCIENCECODE_RUN_DIR: runDir,
      SCIENCECODE_RUN_ID: id
    },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  const rawStdout = String(child.stdout ?? '');
  const rawStderr = String(child.stderr ?? '');
  const redactedRawStdout = redactText(rawStdout);
  const redactedStderr = redactText(rawStderr);
  let displayStdout = redactedRawStdout;
  let eventSummary = null;
  const artifactNames = ['request.md'];

  if (format === 'json') {
    eventSummary = summarizeOpenCodeEvents(rawStdout);
    const rendered = redactText(renderOpenCodeEvents(rawStdout));
    displayStdout = rendered || (eventSummary.invalid_lines.length ? redactedRawStdout : '');
    writeTextExclusive(path.join(runDir, 'events.jsonl'), redactedRawStdout);
    artifactNames.push('events.jsonl');
  }
  writeTextExclusive(path.join(runDir, 'stdout.log'), displayStdout ? `${displayStdout.replace(/\s+$/, '')}\n` : '');
  writeTextExclusive(path.join(runDir, 'stderr.log'), redactedStderr);
  artifactNames.push('stdout.log', 'stderr.log');

  const after = snapshot(project);
  const changes = diffSnapshots(before, after);
  writeJsonExclusive(path.join(runDir, 'snapshot-before.json'), before);
  writeJsonExclusive(path.join(runDir, 'snapshot-after.json'), after);
  artifactNames.push('snapshot-before.json', 'snapshot-after.json');

  const finishedAt = new Date();
  manifest.finished_at = finishedAt.toISOString();
  manifest.duration_ms = finishedAt.getTime() - startedAt.getTime();
  manifest.exit_code = child.status ?? (child.error ? 127 : 1);
  manifest.signal = child.signal ?? null;
  manifest.status = manifest.exit_code === 0 ? 'completed' : 'failed';
  manifest.changes = changes;
  manifest.events = eventSummary;
  manifest.launch_error = child.error ? redactText(child.error.message ?? String(child.error)) : null;
  manifest.artifacts = artifactMetadata(runDir, artifactNames);
  writeJson(path.join(runDir, 'manifest.json'), manifest);
  const manifestHash = sha256File(path.join(runDir, 'manifest.json'));
  writeTextExclusive(path.join(runDir, 'manifest.sha256'), `${manifestHash}\n`);
  appendAudit(project, {
    type: 'run.finished',
    run_id: id,
    status: manifest.status,
    exit_code: manifest.exit_code,
    manifest_sha256: manifestHash,
    changes,
    chat_id: chat?.chat_id,
    chat_turn_index: chat?.turn_index
  });
  return {
    child,
    manifest,
    runDir,
    displayStdout,
    displayStderr: redactedStderr
  };
}

/**
 * Asynchronous recorded OpenCode execution for the Lab. This intentionally
 * mirrors runOpenCode's archive format so CLI and UI runs verify identically,
 * while forwarding a sanitized event stream to the visible harness.
 */
export async function runOpenCodeAsync({
  cwd,
  configDir,
  opencode,
  opencodePrefixArgs = [],
  packageRoot,
  scienceCodeHome,
  agent = 'scientist',
  prompt,
  passthrough = [],
  format = 'json',
  storePrompt = true,
  chat = null,
  env = process.env,
  runner = runCommand,
  onEvent,
  signal
}) {
  const project = path.resolve(cwd);
  const configuration = path.resolve(configDir);
  validateRunInput({
    cwd: project,
    configDir: configuration,
    agent,
    prompt,
    format,
    passthrough,
    opencodePrefixArgs
  });
  if (
    chat !== null &&
    (
      typeof chat !== 'object' ||
      !/^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(chat.chat_id ?? '')) ||
      !Number.isInteger(chat.turn_index) ||
      chat.turn_index < 1
    )
  ) {
    throw Object.assign(new Error('Invalid chat context for recorded run.'), {
      code: 'INVALID_CHAT_CONTEXT'
    });
  }

  const executable = opencode
    ? (findExecutable(opencode, env) ?? opencode)
    : resolveBundledOpenCode(packageRoot);
  const engineEnvironment = isolatedOpenCodeEnvironment({
    configDir: configuration,
    env,
    scienceCodeHome: scienceCodeHome ?? resolveScienceCodeHome(env),
    packageRoot,
    projectRoot: project
  });
  ensureScienceCodeHome(engineEnvironment.SCIENCECODE_HOME);

  const scienceBase = ensureScienceDir(project);
  const id = makeRunId();
  const runDir = path.join(scienceBase, 'runs', id);
  fs.mkdirSync(runDir, { recursive: false, mode: 0o700 });
  const startedAt = new Date();
  const before = snapshot(project);
  const promptHash = sha256Text(prompt);
  const request = storePrompt
    ? '# Research request\n\n' + prompt + '\n'
    : '# Research request\n\n[Prompt omitted by user request. SHA-256: ' + promptHash + ']\n';
  writeTextExclusive(path.join(runDir, 'request.md'), request);

  const childArguments = [
    ...opencodePrefixArgs,
    'run',
    '--agent',
    agent,
    '--format',
    format,
    ...passthrough,
    '--',
    prompt
  ];
  const manifest = {
    schema_version: RUN_SCHEMA_VERSION,
    sciencecode_version: VERSION,
    run_id: id,
    started_at: startedAt.toISOString(),
    cwd: project,
    agent,
    capture_format: format,
    request_storage: storePrompt ? 'full' : 'hash-only',
    command: [
      executable,
      ...opencodePrefixArgs,
      'run',
      '--agent',
      agent,
      '--format',
      format,
      ...passthrough.map((value) => redactText(value)),
      '--',
      '[PROMPT REDACTED FROM MANIFEST]'
    ],
    prompt_sha256: promptHash,
    chat: chat ? {
      chat_id: chat.chat_id,
      turn_index: chat.turn_index
    } : undefined,
    preservation_policy: 'append-only; do not delete archived/legacy work',
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      engine: executable,
      sciencecode_home: engineEnvironment.SCIENCECODE_HOME
    },
    status: 'running'
  };
  writeJsonExclusive(path.join(runDir, 'manifest.json'), manifest);
  appendAudit(project, {
    type: 'run.started',
    run_id: id,
    agent,
    prompt_sha256: promptHash,
    capture_format: format,
    chat_id: chat?.chat_id,
    chat_turn_index: chat?.turn_index
  });

  if (typeof onEvent === 'function') {
    onEvent({
      type: 'run.started',
      timestamp: startedAt.toISOString(),
      status: 'running',
      title: 'Pinned OpenCode engine started',
      run_id: id,
      agent
    });
  }
  let eventBuffer = '';
  const forwardLines = (chunk, flush = false) => {
    eventBuffer += String(chunk ?? '');
    const lines = eventBuffer.split(/\r?\n/);
    const tail = lines.pop() ?? '';
    eventBuffer = flush ? '' : tail;
    if (flush && tail) lines.push(tail);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(redactText(line));
        const publicEvent = publicOpenCodeEvent(event, { includeResponseContent: true });
        if (publicEvent && typeof onEvent === 'function') onEvent(publicEvent);
      } catch {
        // Invalid event lines remain represented by the final verified summary.
      }
    }
  };
  let child;
  try {
    child = await runner(executable, childArguments, {
      cwd: project,
      env: {
        ...engineEnvironment,
        SCIENCECODE_RUN_DIR: runDir,
        SCIENCECODE_RUN_ID: id
      },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      signal,
      onStdout: format === 'json' ? (chunk) => forwardLines(chunk) : undefined
    });
  } catch (error) {
    child = {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error,
      aborted: Boolean(signal?.aborted || error?.name === 'AbortError')
    };
  }
  if (format === 'json') forwardLines('', true);
  const rawStdout = String(child.stdout ?? '');
  const rawStderr = String(child.stderr ?? '');
  const redactedRawStdout = redactText(rawStdout);
  const redactedStderr = redactText(rawStderr);
  let displayStdout = redactedRawStdout;
  let eventSummary = null;
  const artifactNames = ['request.md'];

  if (format === 'json') {
    eventSummary = summarizeOpenCodeEvents(rawStdout);
    const rendered = redactText(renderOpenCodeEvents(rawStdout));
    displayStdout = rendered || (eventSummary.invalid_lines.length ? redactedRawStdout : '');
    writeTextExclusive(path.join(runDir, 'events.jsonl'), redactedRawStdout);
    artifactNames.push('events.jsonl');
  }
  writeTextExclusive(path.join(runDir, 'stdout.log'), displayStdout ? displayStdout.replace(/\s+$/, '') + '\n' : '');
  writeTextExclusive(path.join(runDir, 'stderr.log'), redactedStderr);
  artifactNames.push('stdout.log', 'stderr.log');

  const after = snapshot(project);
  const changes = diffSnapshots(before, after);
  writeJsonExclusive(path.join(runDir, 'snapshot-before.json'), before);
  writeJsonExclusive(path.join(runDir, 'snapshot-after.json'), after);
  artifactNames.push('snapshot-before.json', 'snapshot-after.json');

  const finishedAt = new Date();
  manifest.finished_at = finishedAt.toISOString();
  manifest.duration_ms = finishedAt.getTime() - startedAt.getTime();
  manifest.exit_code = child.aborted ? null : child.status ?? (child.error ? 127 : 1);
  manifest.signal = child.signal ?? null;
  manifest.status = child.aborted
    ? 'cancelled'
    : manifest.exit_code === 0 ? 'completed' : 'failed';
  if (child.aborted) {
    const cancellationReason = ['user_requested', 'server_shutdown'].includes(signal?.reason)
      ? signal.reason
      : 'abort_signal';
    manifest.cancelled_at = finishedAt.toISOString();
    manifest.cancellation = {
      reason: cancellationReason,
      partial_output_preserved: true
    };
  }
  manifest.changes = changes;
  manifest.events = eventSummary;
  manifest.launch_error = child.error && !child.aborted
    ? redactText(child.error.message ?? String(child.error))
    : null;
  manifest.artifacts = artifactMetadata(runDir, artifactNames);
  writeJson(path.join(runDir, 'manifest.json'), manifest);
  const manifestHash = sha256File(path.join(runDir, 'manifest.json'));
  writeTextExclusive(path.join(runDir, 'manifest.sha256'), manifestHash + '\n');
  appendAudit(project, {
    type: 'run.finished',
    run_id: id,
    status: manifest.status,
    exit_code: manifest.exit_code,
    manifest_sha256: manifestHash,
    changes,
    chat_id: chat?.chat_id,
    chat_turn_index: chat?.turn_index,
    cancelled: Boolean(child.aborted)
  });
  if (typeof onEvent === 'function') {
    onEvent({
      type: 'run.finished',
      timestamp: finishedAt.toISOString(),
      status: manifest.status,
      title: manifest.status === 'completed'
        ? 'Recorded engine run completed'
        : manifest.status === 'cancelled'
          ? 'Recorded engine run cancelled by the user'
          : 'Recorded engine run failed',
      run_id: id,
      duration_ms: manifest.duration_ms
    });
  }
  return {
    child,
    manifest,
    runDir,
    displayStdout,
    displayStderr: redactedStderr
  };
}

function runsDirectory(cwd) {
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'runs');
}

export function resolveRunDir(cwd, runId) {
  if (!RUN_ID_PATTERN.test(String(runId ?? '')) || runId === '.' || runId === '..') {
    throw Object.assign(new Error(`Invalid run ID: ${runId ?? ''}`), { code: 'INVALID_RUN_ID' });
  }
  return path.join(runsDirectory(cwd), runId);
}

export function getRunManifest(cwd, runId) {
  const runDir = resolveRunDir(cwd, runId);
  const file = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`Run not found: ${runId}`), { code: 'RUN_NOT_FOUND' });
  }
  return readJson(file);
}

export function listRuns(cwd) {
  const directory = runsDirectory(cwd);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const manifest = getRunManifest(cwd, entry.name);
        return {
          run_id: entry.name,
          status: manifest.status ?? 'unknown',
          agent: manifest.agent ?? null,
          started_at: manifest.started_at ?? null,
          finished_at: manifest.finished_at ?? null,
          exit_code: manifest.exit_code ?? null
        };
      } catch (error) {
        return { run_id: entry.name, status: 'invalid', error: error.message };
      }
    })
    .sort((left, right) => right.run_id.localeCompare(left.run_id));
}

export function verifyRun(cwd, runId) {
  const errors = [];
  let runDir;
  let manifest;
  try {
    runDir = resolveRunDir(cwd, runId);
    manifest = getRunManifest(cwd, runId);
  } catch (error) {
    return { ok: false, run_id: runId, errors: [{ issue: error.code ?? 'run_error', detail: error.message }] };
  }

  const manifestFile = path.join(runDir, 'manifest.json');
  const digestFile = path.join(runDir, 'manifest.sha256');
  let manifestHash = sha256File(manifestFile);
  if (!fs.existsSync(digestFile)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else {
    const expected = fs.readFileSync(digestFile, 'utf8').trim();
    if (expected !== manifestHash) {
      errors.push({ file: 'manifest.json', issue: 'hash_mismatch', expected, actual: manifestHash });
    }
  }

  for (const [name, metadata] of Object.entries(manifest.artifacts ?? {})) {
    let file;
    try {
      file = resolveInsideRoot(runDir, name);
    } catch (error) {
      errors.push({ file: name, issue: 'invalid_path', detail: error.message });
      continue;
    }
    if (!fs.existsSync(file)) {
      errors.push({ file: name, issue: 'missing' });
      continue;
    }
    const actual = sha256File(file);
    if (actual !== metadata.sha256) {
      errors.push({ file: name, issue: 'hash_mismatch', expected: metadata.sha256, actual });
    } else if (metadata.bytes !== undefined && fs.statSync(file).size !== metadata.bytes) {
      errors.push({ file: name, issue: 'size_mismatch', expected: metadata.bytes, actual: fs.statSync(file).size });
    }
  }

  const audit = verifyAudit(cwd);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const finish = readAuditRecords(cwd).findLast(
      (record) => record.type === 'run.finished' && record.run_id === runId
    );
    if (!finish) errors.push({ issue: 'missing_audit_event' });
    else if (finish.manifest_sha256 !== manifestHash) {
      errors.push({
        issue: 'audit_manifest_mismatch',
        expected: finish.manifest_sha256 ?? null,
        actual: manifestHash
      });
    }
  }
  return { ok: errors.length === 0, run_id: runId, manifest, manifest_sha256: manifestHash, errors };
}

export function launchOpenCode({
  cwd,
  configDir,
  args = [],
  opencode,
  opencodePrefixArgs = [],
  packageRoot,
  scienceCodeHome,
  env = process.env,
  stdio = 'inherit',
  runner = runCommandSync
}) {
  const executable = opencode
    ? (findExecutable(opencode, env) ?? opencode)
    : resolveBundledOpenCode(packageRoot);
  const engineEnvironment = isolatedOpenCodeEnvironment({
    configDir,
    env,
    scienceCodeHome: scienceCodeHome ?? resolveScienceCodeHome(env),
    packageRoot,
    projectRoot: cwd
  });
  ensureScienceCodeHome(engineEnvironment.SCIENCECODE_HOME);
  return runner(executable, [...opencodePrefixArgs, ...args], {
    cwd: path.resolve(cwd),
    env: engineEnvironment,
    stdio,
    windowsHide: false
  });
}
