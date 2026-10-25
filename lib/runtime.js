import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findExecutable } from './process.js';

const require = createRequire(import.meta.url);
const INLINE_CONFIG = {
  default_agent: 'scientist',
  share: 'disabled',
  plugin: []
};

function packageBinary(packageFile) {
  const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const relative = typeof metadata.bin === 'string'
    ? metadata.bin
    : metadata.bin?.opencode ?? Object.values(metadata.bin ?? {})[0];
  if (!relative) return null;
  return path.resolve(path.dirname(packageFile), relative);
}

/** Resolve only ScienceCode's pinned dependency. There is deliberately no PATH fallback. */
export function resolveBundledOpenCode(packageRoot) {
  const packageFiles = [];
  if (packageRoot) {
    packageFiles.push(path.join(path.resolve(packageRoot), 'node_modules', 'opencode-ai', 'package.json'));
  }
  try {
    packageFiles.push(require.resolve('opencode-ai/package.json'));
  } catch {
    // Report a single ScienceCode-specific error below.
  }
  for (const packageFile of [...new Set(packageFiles)]) {
    if (!fs.existsSync(packageFile)) continue;
    const binary = packageBinary(packageFile);
    if (!binary) continue;
    const executable = findExecutable(binary);
    if (executable) return executable;
  }
  throw Object.assign(
    new Error('The bundled OpenCode runtime is missing. Run npm install in the ScienceCode package directory.'),
    { code: 'SCIENCECODE_RUNTIME_MISSING' }
  );
}

export function resolveScienceCodeHome(env = process.env, platform = process.platform) {
  if (env.SCIENCECODE_HOME) return path.resolve(env.SCIENCECODE_HOME);
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || env.APPDATA;
    if (base) return path.join(path.resolve(base), 'ScienceCode');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'ScienceCode');
  }
  const dataBase = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(path.resolve(dataBase), 'sciencecode');
}

export function isolatedOpenCodeEnvironment({
  configDir,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  packageRoot,
  projectRoot
}) {
  const isolated = { ...env };
  for (const name of [
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_DIR',
    'OPENCODE_CONFIG_CONTENT',
    'SCIENCECODE_CLI',
    'SCIENCECODE_PACKAGE_ROOT',
    'SCIENCECODE_PROJECT_ROOT',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'XDG_STATE_HOME'
  ]) {
    delete isolated[name];
  }
  const home = path.resolve(scienceCodeHome);
  isolated.SCIENCECODE_HOME = home;
  isolated.XDG_CONFIG_HOME = path.join(home, 'xdg', 'config');
  isolated.XDG_DATA_HOME = path.join(home, 'xdg', 'data');
  isolated.XDG_CACHE_HOME = path.join(home, 'xdg', 'cache');
  isolated.XDG_STATE_HOME = path.join(home, 'xdg', 'state');
  isolated.TEMP = path.join(home, 'tmp');
  isolated.TMP = path.join(home, 'tmp');
  isolated.TMPDIR = path.join(home, 'tmp');
  isolated.OPENCODE_CONFIG_DIR = path.resolve(configDir);
  isolated.OPENCODE_CONFIG_CONTENT = JSON.stringify(INLINE_CONFIG);
  isolated.OPENCODE_DISABLE_CLAUDE_CODE = '1';
  isolated.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = '1';
  isolated.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1';
  if (packageRoot) {
    isolated.SCIENCECODE_PACKAGE_ROOT = path.resolve(packageRoot);
    isolated.SCIENCECODE_CLI = path.join(path.resolve(packageRoot), 'bin', 'sciencecode.js');
  }
  if (projectRoot) isolated.SCIENCECODE_PROJECT_ROOT = path.resolve(projectRoot);
  return isolated;
}

export function ensureScienceCodeHome(home) {
  const resolved = path.resolve(home);
  for (const relative of [
    '',
    path.join('xdg', 'config'),
    path.join('xdg', 'data'),
    path.join('xdg', 'cache'),
    path.join('xdg', 'state'),
    'tmp'
  ]) {
    fs.mkdirSync(path.join(resolved, relative), { recursive: true, mode: 0o700 });
  }
  return resolved;
}

export function runtimePaths({ packageRoot, configDir, env = process.env, scienceCodeHome } = {}) {
  const home = resolveScienceCodeHome(
    scienceCodeHome ? { ...env, SCIENCECODE_HOME: scienceCodeHome } : env
  );
  return {
    engine: resolveBundledOpenCode(packageRoot),
    config: path.resolve(configDir),
    home,
    compute: {
      runtime: path.join(home, 'runtimes', 'python-gpu-v1'),
      python: path.join(
        home,
        'runtimes',
        'python-gpu-v1',
        process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
      ),
      npu_runtime: path.join(home, 'runtimes', 'python-npu-v1'),
      npu_python: path.join(
        home,
        'runtimes',
        'python-npu-v1',
        process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
      )
    },
    xdg: {
      config: path.join(home, 'xdg', 'config'),
      data: path.join(home, 'xdg', 'data'),
      cache: path.join(home, 'xdg', 'cache'),
      state: path.join(home, 'xdg', 'state')
    }
  };
}
