import fs from 'node:fs';
import path from 'node:path';
import { computeStatus } from './compute.js';
import { verifyKnowledgeBase } from './knowledge.js';
import { STATISTICS_ENGINE_NAME, STATISTICS_ENGINE_VERSION } from './statistics.js';
import { UNIT_ENGINE_NAME, UNIT_ENGINE_VERSION } from './units.js';
import { probeCommand, runCommandSync } from './process.js';
import {
  ensureScienceCodeHome,
  isolatedOpenCodeEnvironment,
  resolveBundledOpenCode,
  resolveScienceCodeHome
} from './runtime.js';

export const MINIMUM_NODE_VERSION = '20.16.0';
export const MINIMUM_OPENCODE_VERSION = '1.18.0';
export const TESTED_OPENCODE_VERSION = '1.18.15';

function parseVersion(value) {
  const match = String(value ?? '').match(/(?:^|\D)v?(\d+)\.(\d+)\.(\d+)(?:\D|$)/);
  return match ? match.slice(1).map(Number) : null;
}

export function versionAtLeast(value, minimum) {
  const actual = parseVersion(value);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

function toolCheck({ name, aliases = [name], required = false, args = ['--version'] }, options) {
  const result = probeCommand(aliases, args, options);
  return {
    name,
    required,
    ok: result.ok,
    path: result.path,
    version: result.output || null,
    detail: result.ok ? null : result.attempts.map((attempt) => attempt.issue).join(', ') || 'not_found'
  };
}

function bundledConfigCheck(configDir) {
  if (!configDir) {
    return { name: 'sciencecode-config', required: true, ok: false, path: null, detail: 'config_dir_not_provided' };
  }
  const expected = [
    'opencode.jsonc',
    path.join('agents', 'scientist.md'),
    path.join('agents', 'methodologist.md'),
    path.join('agents', 'citation-auditor.md'),
    path.join('agents', 'simulation-engineer.md'),
    path.join('agents', 'confirmatory-reviewer.md'),
    path.join('agents', 'drug-discovery-scientist.md'),
    path.join('agents', 'procedure-engineer.md'),
    path.join('agents', 'safety-reviewer.md'),
    path.join('commands', 'research.md'),
    path.join('commands', 'design.md'),
    path.join('commands', 'audit-citations.md'),
    path.join('commands', 'simulate.md'),
    path.join('commands', 'confirmatory.md'),
    path.join('commands', 'discover.md'),
    path.join('commands', 'procedure.md'),
    path.join('skills', 'research-protocol', 'SKILL.md'),
    path.join('skills', 'reproducibility', 'SKILL.md'),
    path.join('skills', 'experimental-design', 'SKILL.md'),
    path.join('skills', 'citation-audit', 'SKILL.md'),
    path.join('skills', 'gpu-simulation', 'SKILL.md'),
    path.join('skills', 'confirmatory-analysis', 'SKILL.md'),
    path.join('skills', 'drug-discovery-harness', 'SKILL.md'),
    path.join('skills', 'procedure-development', 'SKILL.md'),
    path.join('skills', 'model-credibility', 'SKILL.md')
  ];
  const missing = expected.filter((relative) => !fs.existsSync(path.join(configDir, relative)));
  return {
    name: 'sciencecode-config',
    required: true,
    ok: missing.length === 0,
    path: path.resolve(configDir),
    version: null,
    detail: missing.length ? `missing: ${missing.join(', ')}` : null
  };
}

export function validateOpenCodeConfig({
  configDir,
  cwd = process.cwd(),
  env = process.env,
  executable,
  packageRoot,
  scienceCodeHome
} = {}) {
  let command;
  try {
    command = executable ?? resolveBundledOpenCode(packageRoot);
  } catch (error) {
    return { ok: false, detail: error.message, config: null };
  }
  const engineEnvironment = isolatedOpenCodeEnvironment({
    configDir,
    env,
    scienceCodeHome: scienceCodeHome ?? resolveScienceCodeHome(env),
    packageRoot,
    projectRoot: cwd
  });
  ensureScienceCodeHome(engineEnvironment.SCIENCECODE_HOME);
  const result = runCommandSync(command, ['debug', 'config'], {
    cwd,
    env: engineEnvironment,
    // Loading the complete bundled agent/command/skill graph can contend with
    // the integration suite's worker processes on slower Windows hosts.
    timeout: 60_000
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      detail: result.error?.message ?? String(result.stderr ?? result.stdout ?? `exit ${result.status}`).trim(),
      config: null
    };
  }
  try {
    const config = JSON.parse(result.stdout);
    const missing = [];
    if (config.default_agent !== 'scientist') missing.push('default_agent=scientist');
    if (!config.agent?.scientist) missing.push('agent.scientist');
    if (!config.command?.research) missing.push('command.research');
    return {
      ok: missing.length === 0,
      detail: missing.length ? `resolved config missing ${missing.join(', ')}` : null,
      config
    };
  } catch (error) {
    return { ok: false, detail: `invalid debug config JSON: ${error.message}`, config: null };
  }
}

export function doctor(input = {}) {
  const options = input && input.PATH !== undefined && input.env === undefined ? { env: input } : input;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const configDir = options.configDir;
  const packageRoot = options.packageRoot;
  const scienceCodeHome = options.scienceCodeHome ?? resolveScienceCodeHome(env);
  const nodeVersion = process.versions.node;
  const checks = [{
    name: 'node',
    required: true,
    ok: versionAtLeast(nodeVersion, MINIMUM_NODE_VERSION),
    path: process.execPath,
    version: nodeVersion,
    detail: versionAtLeast(nodeVersion, MINIMUM_NODE_VERSION) ? null : `requires >= ${MINIMUM_NODE_VERSION}`
  }];

  let enginePath = null;
  let engineCheck;
  try {
    enginePath = resolveBundledOpenCode(packageRoot);
    const engineEnvironment = isolatedOpenCodeEnvironment({
      configDir,
      env,
      scienceCodeHome,
      packageRoot,
      projectRoot: cwd
    });
    ensureScienceCodeHome(scienceCodeHome);
    const probe = runCommandSync(enginePath, ['--version'], {
      cwd,
      env: engineEnvironment,
      timeout: 10_000
    });
    const version = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();
    engineCheck = {
      name: 'sciencecode-engine',
      required: true,
      ok: !probe.error && probe.status === 0 && versionAtLeast(version, MINIMUM_OPENCODE_VERSION),
      path: enginePath,
      version: version || null,
      detail: probe.error?.message ?? (probe.status !== 0
        ? `exit_${probe.status ?? 'unknown'}`
        : versionAtLeast(version, MINIMUM_OPENCODE_VERSION) ? null : `requires >= ${MINIMUM_OPENCODE_VERSION}`)
    };
  } catch (error) {
    engineCheck = {
      name: 'sciencecode-engine',
      required: true,
      ok: false,
      path: null,
      version: null,
      detail: error.message
    };
  }
  checks.push(engineCheck);
  checks.push({
    name: 'sciencecode-home',
    required: true,
    ok: fs.existsSync(scienceCodeHome),
    path: scienceCodeHome,
    version: null,
    detail: fs.existsSync(scienceCodeHome) ? null : 'state_directory_unavailable'
  });
  checks.push(bundledConfigCheck(configDir));
  const knowledge = verifyKnowledgeBase();
  checks.push({
    name: 'sciencecode-knowledge-base',
    required: true,
    ok: knowledge.ok,
    path: null,
    version: String(knowledge.schema_version),
    detail: knowledge.ok
      ? knowledge.principle_count + ' principles across ' + knowledge.layers.length + ' layers'
      : knowledge.findings.filter((finding) => !finding.ok).map((finding) => finding.check).join(',')
  });

  if (options.compatibility !== false && enginePath && configDir) {
    const compatibility = validateOpenCodeConfig({
      configDir,
      cwd,
      env,
      executable: enginePath,
      packageRoot,
      scienceCodeHome
    });
    checks.push({
      name: 'sciencecode-engine-config',
      required: true,
      ok: compatibility.ok,
      path: configDir,
      version: null,
      detail: compatibility.detail
    });
  }

  const pythonCheck = toolCheck({ name: 'python', aliases: ['python', 'python3', 'py'] }, { env, cwd });
  checks.push(
    toolCheck({ name: 'git' }, { env, cwd }),
    pythonCheck,
    toolCheck({ name: 'R' }, { env, cwd }),
    toolCheck({ name: 'jupyter' }, { env, cwd }),
    toolCheck({ name: 'uv' }, { env, cwd }),
    toolCheck({ name: 'docker' }, { env, cwd })
  );
  let scientificStack = {
    name: 'python-scientific-stack',
    required: false,
    ok: false,
    path: pythonCheck.path,
    version: null,
    detail: 'python_unavailable'
  };
  if (pythonCheck.ok && pythonCheck.path) {
    const probe = runCommandSync(pythonCheck.path, ['-c', [
      'import json',
      'versions = {}',
      'for name in ("numpy", "scipy", "matplotlib"):',
      '    try:',
      '        versions[name] = __import__("importlib.metadata", fromlist=["version"]).version(name)',
      '    except Exception:',
      '        versions[name] = None',
      'print(json.dumps(versions))'
    ].join('\n')], { cwd, env, timeout: 20_000 });
    let versions = null;
    try {
      versions = JSON.parse(String(probe.stdout ?? '').trim());
    } catch {
      versions = null;
    }
    const complete = versions && Object.values(versions).every(Boolean);
    scientificStack = {
      name: 'python-scientific-stack',
      required: false,
      ok: Boolean(complete),
      path: pythonCheck.path,
      version: versions
        ? Object.entries(versions).map(([name, version]) =>
          name + ' ' + (version ?? 'missing')).join(', ')
        : null,
      detail: complete
        ? null
        : probe.error?.message ?? 'scipy_stack_incomplete_for_scipy_simulation_templates'
    };
  }
  checks.push(scientificStack);
  checks.push({
    name: 'sciencecode-decision-engines',
    required: true,
    ok: true,
    path: null,
    version: UNIT_ENGINE_NAME + ' v' + UNIT_ENGINE_VERSION + ', ' +
      STATISTICS_ENGINE_NAME + ' v' + STATISTICS_ENGINE_VERSION,
    detail: 'bumping either engine version invalidates existing typed or inferential records'
  });
  const compute = computeStatus({ env, scienceCodeHome });
  const gpu = compute.gpu.devices[0];
  checks.push({
    name: 'nvidia-gpu',
    required: false,
    ok: compute.gpu.available,
    path: compute.gpu.executable,
    version: gpu
      ? gpu.name + ', ' + gpu.memory_total_mib + ' MiB, driver ' + gpu.driver_version + ', SM ' + gpu.compute_capability
      : null,
    detail: compute.gpu.error
  });
  checks.push({
    name: 'sciencecode-compute-runtime',
    required: false,
    ok: compute.runtime.healthy,
    path: compute.runtime.paths.runtime,
    version: compute.runtime.probe?.torch
      ? 'Python ' + compute.runtime.probe.python + ', PyTorch ' + compute.runtime.probe.torch.version +
        ', CUDA ' + compute.runtime.probe.torch.cuda_runtime
      : null,
    detail: compute.runtime.error
  });
  checks.push({
    name: 'sciencecode-cadquery-runtime',
    required: false,
    ok: compute.runtimes.cad.healthy,
    path: compute.runtimes.cad.paths.runtime,
    version: compute.runtimes.cad.probe
      ? 'Python ' + compute.runtimes.cad.probe.python + ', CadQuery ' +
        compute.runtimes.cad.probe.cadquery_version + ', OCP ' +
        compute.runtimes.cad.probe.cadquery_ocp_version
      : null,
    detail: compute.runtimes.cad.error
  });
  return {
    ok: checks.filter((check) => check.required).every((check) => check.ok),
    minimum_opencode_version: MINIMUM_OPENCODE_VERSION,
    tested_opencode_version: TESTED_OPENCODE_VERSION,
    checks,
    compute
  };
}
