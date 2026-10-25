import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureScienceCodeHome,
  isolatedOpenCodeEnvironment,
  resolveBundledOpenCode,
  resolveScienceCodeHome
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('runtime resolver selects the pinned package-local engine', () => {
  const engine = resolveBundledOpenCode(packageRoot);
  assert.ok(engine.startsWith(path.join(packageRoot, 'node_modules', 'opencode-ai')));
  assert.equal(fs.existsSync(engine), true);
});

test('isolated engine environment replaces existing OpenCode and XDG settings', () => {
  const home = path.join(os.tmpdir(), 'sciencecode-home-contract');
  const config = path.join(packageRoot, 'opencode');
  const value = isolatedOpenCodeEnvironment({
    configDir: config,
    scienceCodeHome: home,
    packageRoot,
    projectRoot: packageRoot,
    env: {
      PATH: process.env.PATH,
      OPENCODE_CONFIG: 'existing.json',
      OPENCODE_CONFIG_DIR: 'existing-dir',
      OPENCODE_CONFIG_CONTENT: '{"model":"existing/provider"}',
      XDG_DATA_HOME: 'existing-data'
    }
  });
  assert.equal(value.SCIENCECODE_HOME, path.resolve(home));
  assert.equal(value.OPENCODE_CONFIG_DIR, config);
  assert.deepEqual(JSON.parse(value.OPENCODE_CONFIG_CONTENT), {
    default_agent: 'scientist',
    share: 'disabled',
    plugin: []
  });
  assert.equal(value.OPENCODE_DISABLE_CLAUDE_CODE, '1');
  assert.equal(value.XDG_DATA_HOME, path.join(path.resolve(home), 'xdg', 'data'));
  assert.notEqual(value.XDG_DATA_HOME, 'existing-data');
  assert.equal(value.TEMP, path.join(path.resolve(home), 'tmp'));
  assert.equal(value.TMP, path.join(path.resolve(home), 'tmp'));
  assert.equal(value.TMPDIR, path.join(path.resolve(home), 'tmp'));
  assert.equal(value.SCIENCECODE_PACKAGE_ROOT, packageRoot);
  assert.equal(value.SCIENCECODE_PROJECT_ROOT, packageRoot);
  assert.equal(value.SCIENCECODE_CLI, path.join(packageRoot, 'bin', 'sciencecode.js'));
});

test('ScienceCode home supports an explicit override and creates isolated roots', (context) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-home-'));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nested = path.join(home, 'standalone');
  assert.equal(resolveScienceCodeHome({ SCIENCECODE_HOME: nested }), path.resolve(nested));
  ensureScienceCodeHome(nested);
  for (const type of ['config', 'data', 'cache', 'state']) {
    assert.equal(fs.statSync(path.join(nested, 'xdg', type)).isDirectory(), true);
  }
  assert.equal(fs.statSync(path.join(nested, 'tmp')).isDirectory(), true);
});
