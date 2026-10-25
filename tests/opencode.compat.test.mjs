import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchOpenCode,
  resolveBundledOpenCode,
  validateOpenCodeConfig
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configDir = path.join(packageRoot, 'opencode');
const executable = resolveBundledOpenCode(packageRoot);

test('bundled engine resolves ScienceCode config without the user OpenCode config', (context) => {
  const scienceCodeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-engine-'));
  context.after(() => fs.rmSync(scienceCodeHome, { recursive: true, force: true }));
  const result = validateOpenCodeConfig({
    configDir,
    cwd: packageRoot,
    executable,
    scienceCodeHome,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'existing-user/provider' })
    }
  });
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.config.default_agent, 'scientist');
  assert.ok(result.config.agent.scientist);
  assert.ok(result.config.agent['data-analyst']);
  assert.ok(result.config.agent['literature-reviewer']);
  assert.ok(result.config.agent['reproducibility-reviewer']);
  assert.ok(result.config.agent.skeptic);
  assert.ok(result.config.agent.methodologist);
  assert.ok(result.config.agent['citation-auditor']);
  assert.ok(result.config.agent['scientific-writer']);
  assert.ok(result.config.agent['simulation-engineer']);
  assert.ok(result.config.agent['cad-engineer']);
  assert.ok(result.config.agent['confirmatory-reviewer']);
  for (const command of [
    'research',
    'literature',
    'analyze',
    'reproduce',
    'challenge',
    'design',
    'audit-citations',
    'write-report',
    'cad',
    'simulate',
    'inference',
    'confirmatory',
    'campaign',
    'compare-figure'
  ]) {
    assert.ok(result.config.command[command], command);
  }
  assert.match(
    fs.readFileSync(path.join(configDir, 'skills', 'npu-inference', 'SKILL.md'), 'utf8'),
    /VitisAIExecutionProvider execution event/
  );
  const cadSkill = fs.readFileSync(
    path.join(configDir, 'skills', 'cad-engineering', 'SKILL.md'), 'utf8'
  );
  assert.match(cadSkill, /Never add post-processing/);
  assert.match(cadSkill, /sufficient refreshed\s+free VRAM/);
  assert.match(cadSkill, /verified cancelled record/);
  assert.match(cadSkill, /--engine openscad\|cadquery/);
  assert.match(cadSkill, /--expected OPENED_SHA256/);
  assert.match(cadSkill, /same STL contract plus verified STEP/);
  assert.match(cadSkill, /SCIENCECODE_SOURCE_ROOT/);
  assert.match(cadSkill, /not a filesystem, process, or network sandbox/);
  const hypothesisSkill = fs.readFileSync(
    path.join(configDir, 'skills', 'hypothesis-testing', 'SKILL.md'), 'utf8'
  );
  assert.match(hypothesisSkill, /ordered hypothesis tree/);
  assert.match(hypothesisSkill, /must never invoke `sciencecode campaign assess`/);
  const scientist = fs.readFileSync(
    path.join(configDir, 'agents', 'scientist.md'), 'utf8'
  );
  assert.match(scientist, /"sciencecode campaign assess \*": deny/);
  assert.match(scientist, /unassessed or stale verdict/);
  assert.match(scientist, /minimum block-luminance structural similarity/);
  assert.match(scientist, /fixed-block SSIM agreement/);
  const cadAgent = fs.readFileSync(
    path.join(configDir, 'agents', 'cad-engineer.md'), 'utf8'
  );
  const figureCommand = fs.readFileSync(
    path.join(configDir, 'commands', 'compare-figure.md'), 'utf8'
  );
  assert.match(figureCommand, /configured pixel rule and structural rule must both pass/i);
  assert.match(figureCommand, /not semantic equivalence or scientific validation/);
  const cadCommand = fs.readFileSync(
    path.join(configDir, 'commands', 'cad.md'), 'utf8'
  );
  for (const source of [scientist, cadAgent, cadCommand, cadSkill]) {
    assert.match(source, /Lab stop\s+aborts only the active branch/i);
    assert.match(source, /marks undispatched branches\s+`not_run`/i);
    assert.match(source, /verified partial\s+experiment/i);
    assert.match(source, /never\s+(?:present|report)\s+a\s+cancelled\s+study\s+or\s+partial\s+aggregate\s+as\s+a\s+completed\s+comparison/i);
    assert.doesNotMatch(source, /(?:non-cancellable|cannot be cancell?ed)/i);
  }
  assert.notEqual(result.config.model, 'existing-user/provider');
});

test('launcher executes the bundled engine cross-platform', (context) => {
  const scienceCodeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-engine-'));
  context.after(() => fs.rmSync(scienceCodeHome, { recursive: true, force: true }));
  const result = launchOpenCode({
    cwd: packageRoot,
    configDir,
    packageRoot,
    scienceCodeHome,
    args: ['--version'],
    stdio: 'pipe'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  assert.ok(executable.startsWith(path.join(packageRoot, 'node_modules')));
});
