import fs from 'node:fs';
import path from 'node:path';
import crossSpawn from 'cross-spawn';

const WINDOWS_EXTENSIONS = ['.COM', '.EXE', '.CMD', '.BAT'];

function commandCancellationError() {
  const error = new Error('Command cancelled.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    try {
      const killer = crossSpawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' }
      );
      const fallback = () => {
        try { child.kill(); } catch { /* process already exited */ }
      };
      killer.once('error', fallback);
      killer.once('close', (status) => {
        if (status !== 0) fallback();
      });
      return;
    } catch {
      // Fall through to the direct child termination path.
    }
  }
  try { child.kill('SIGTERM'); } catch { /* process already exited */ }
}

function environmentValue(env, name, platform = process.platform) {
  if (env?.[name] !== undefined) return env[name];
  if (platform !== 'win32' || !env || typeof env !== 'object') return undefined;
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

function canExecute(file, platform = process.platform) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathExtensions(env, platform) {
  if (platform !== 'win32') return [''];
  const configured = String(environmentValue(env, 'PATHEXT', platform) ?? '')
    .split(';')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set([...WINDOWS_EXTENSIONS, ...configured])];
}

/** Resolve a command without asking a shell to interpret user-controlled text. */
export function findExecutable(name, env = process.env, platform = process.platform) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const command = name.trim();
  const hasDirectory = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const directories = hasDirectory
    ? ['']
    : String(environmentValue(env, 'PATH', platform) ?? '')
      .split(path.delimiter)
      .map((value) => value.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);

  // A version-dotted name such as `python3.11` has a path extname of `.11`,
  // which is not an executable extension. Treating it as one would skip every
  // PATHEXT candidate and report the command as missing, so only a real
  // executable extension suppresses the search.
  const available = pathExtensions(env, platform);
  const suppliedExtension = path.extname(command).toUpperCase();
  // The bare name is tried last so a PATHEXT command still wins over an
  // extensionless shim of the same name, matching how the shell resolves it.
  const extensions = suppliedExtension && available.includes(suppliedExtension)
    ? ['']
    : [...new Set([...available, ''])];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = hasDirectory ? `${command}${extension}` : path.join(directory, `${command}${extension}`);
      if (canExecute(candidate, platform)) return path.resolve(candidate);
    }
  }
  return null;
}

/**
 * cross-spawn safely handles npm .cmd shims on Windows without enabling a
 * general-purpose shell for prompt text or other user-controlled arguments.
 */
export function runCommandSync(command, args = [], options = {}) {
  return crossSpawn.sync(command, args.map(String), {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
}

/**
 * Run a command without blocking the Lab server. Output callbacks receive text
 * as it arrives, while the resolved result keeps the same shape as
 * runCommandSync. A hard buffer limit prevents an agent process from growing
 * the ScienceCode host without bound.
 */
export function runCommand(command, args = [], options = {}) {
  const {
    onStdout,
    onStderr,
    maxBuffer = 64 * 1024 * 1024,
    encoding = 'utf8',
    signal: abortSignal,
    ...spawnOptions
  } = options;
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: commandCancellationError(),
        aborted: true
      });
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let launchError = null;
    let overflow = false;
    let settled = false;
    let aborted = false;
    let cancellationError = null;
    let forceTimer = null;
    const child = crossSpawn(command, args.map(String), {
      windowsHide: true,
      ...spawnOptions
    });
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      abortSignal?.removeEventListener?.('abort', abort);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString(encoding),
        stderr: Buffer.concat(stderr).toString(encoding),
        error: cancellationError ?? launchError ?? (overflow
          ? Object.assign(new Error('Command output exceeded the configured buffer limit.'), { code: 'ENOBUFS' })
          : null),
        aborted
      });
    };
    const abort = () => {
      if (settled || aborted) return;
      aborted = true;
      cancellationError = commandCancellationError();
      terminateChild(child);
      if (process.platform !== 'win32') {
        forceTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* process already exited */ }
        }, 2_000);
        forceTimer.unref?.();
      }
    };
    const collect = (chunks, callback, value, stream) => {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (stream === 'stdout') stdoutBytes += buffer.length;
      else stderrBytes += buffer.length;
      if (stdoutBytes + stderrBytes > maxBuffer) {
        // A child that keeps writing after the cap would otherwise spawn one
        // terminateChild (a taskkill process on Windows) per chunk, so the
        // first overflow is the only one that terminates.
        if (!overflow) {
          overflow = true;
          terminateChild(child);
        }
        return;
      }
      chunks.push(buffer);
      if (typeof callback === 'function') callback(buffer.toString(encoding));
    };
    child.stdout?.on('data', (value) => collect(stdout, onStdout, value, 'stdout'));
    child.stderr?.on('data', (value) => collect(stderr, onStderr, value, 'stderr'));
    child.on('error', (error) => {
      launchError = error;
    });
    child.on('close', finish);
    abortSignal?.addEventListener?.('abort', abort, { once: true });
    if (abortSignal?.aborted) abort();
  });
}

export function probeCommand(names, args = ['--version'], options = {}) {
  const env = options.env ?? process.env;
  const candidates = Array.isArray(names) ? names : [names];
  const attempts = [];
  for (const name of candidates) {
    const executable = findExecutable(name, env, options.platform ?? process.platform);
    if (!executable) {
      attempts.push({ name, issue: 'not_found' });
      continue;
    }
    const result = runCommandSync(executable, args, {
      cwd: options.cwd,
      env,
      timeout: options.timeout ?? 10_000
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (!result.error && result.status === 0) {
      return { ok: true, name, path: executable, output, status: 0, attempts };
    }
    attempts.push({
      name,
      path: executable,
      issue: result.error?.code ?? `exit_${result.status ?? 'unknown'}`,
      output
    });
  }
  return { ok: false, path: null, output: '', status: null, attempts };
}
