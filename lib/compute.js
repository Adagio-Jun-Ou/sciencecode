import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from './hash.js';
import { findExecutable, runCommandSync } from './process.js';
import { ensureScienceCodeHome, resolveScienceCodeHome } from './runtime.js';
import { isPathInside, readJson, writeJson } from './storage.js';

export const COMPUTE_RUNTIME_SCHEMA_VERSION = 1;
export const COMPUTE_RUNTIME_PROFILE = 'gpu';
export const COMPUTE_RUNTIME_PROFILE_VERSION = 1;
export const NPU_RUNTIME_SCHEMA_VERSION = 1;
export const NPU_RUNTIME_PROFILE = 'npu';
export const NPU_RUNTIME_PROFILE_VERSION = 1;
export const NPU_EXECUTION_PROVIDER = 'VitisAIExecutionProvider';
export const CAD_RUNTIME_SCHEMA_VERSION = 1;
export const CAD_RUNTIME_PROFILE = 'cad';
export const CAD_RUNTIME_PROFILE_VERSION = 1;

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GPU_RUNTIME_DIRECTORY = 'python-gpu-v1';
const NPU_RUNTIME_DIRECTORY = 'python-npu-v1';
const CAD_RUNTIME_DIRECTORY = 'python-cad-v1';
const NVIDIA_QUERY = [
  '--query-gpu=name,uuid,memory.total,memory.free,driver_version,compute_cap',
  '--format=csv,noheader,nounits'
];

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function isolatedPythonEnvironment(env, scienceCodeHome) {
  const result = { ...env };
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX']) {
    delete result[name];
  }
  const home = path.resolve(scienceCodeHome);
  result.SCIENCECODE_HOME = home;
  result.PYTHONUTF8 = '1';
  result.PYTHONDONTWRITEBYTECODE = '1';
  result.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  result.UV_CACHE_DIR = path.join(home, 'cache', 'uv');
  result.TEMP = path.join(home, 'tmp');
  result.TMP = path.join(home, 'tmp');
  result.TMPDIR = path.join(home, 'tmp');
  return result;
}

export function pythonExecutableForRuntime(directory, platform = process.platform) {
  return path.join(
    path.resolve(directory),
    platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
  );
}

export function computeRuntimePaths({
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  platform = process.platform
} = {}) {
  const home = path.resolve(scienceCodeHome);
  const runtimes = path.join(home, 'runtimes');
  const runtime = path.join(runtimes, GPU_RUNTIME_DIRECTORY);
  return {
    home,
    runtimes,
    runtime,
    python: pythonExecutableForRuntime(runtime, platform),
    manifest: path.join(runtime, 'runtime-manifest.json'),
    requirements: {
      science: path.join(runtime, 'requirements-science.txt'),
      gpu: path.join(runtime, 'requirements-gpu.txt')
    }
  };
}

export function npuRuntimePaths({
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  platform = process.platform
} = {}) {
  const home = path.resolve(scienceCodeHome);
  const runtimes = path.join(home, 'runtimes');
  const runtime = path.join(runtimes, NPU_RUNTIME_DIRECTORY);
  return {
    home,
    runtimes,
    runtime,
    python: pythonExecutableForRuntime(runtime, platform),
    manifest: path.join(runtime, 'runtime-manifest.json'),
    requirements: path.join(runtime, 'requirements-npu.txt')
  };
}

export function cadRuntimePaths({
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  platform = process.platform
} = {}) {
  const home = path.resolve(scienceCodeHome);
  const runtimes = path.join(home, 'runtimes');
  const runtime = path.join(runtimes, CAD_RUNTIME_DIRECTORY);
  return {
    home,
    runtimes,
    runtime,
    python: pythonExecutableForRuntime(runtime, platform),
    adapter: path.join(runtime, 'cadquery_adapter.py'),
    manifest: path.join(runtime, 'runtime-manifest.json'),
    requirements: path.join(runtime, 'requirements-cad.txt')
  };
}

export function detectNvidiaGpu({
  env = process.env,
  runner = runCommandSync,
  platform = process.platform
} = {}) {
  const executable = findExecutable('nvidia-smi', env, platform);
  if (!executable) {
    return {
      available: false,
      backend: 'nvidia',
      executable: null,
      devices: [],
      error: 'nvidia-smi_not_found'
    };
  }
  const result = runner(executable, NVIDIA_QUERY, {
    env,
    encoding: 'utf8',
    timeout: 15_000
  });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      backend: 'nvidia',
      executable,
      devices: [],
      error: result.error?.message ?? String(result.stderr ?? 'nvidia-smi_failed').trim()
    };
  }
  const devices = String(result.stdout ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const [name, uuid, memoryTotal, memoryFree, driverVersion, computeCapability] = parseCsvLine(line);
      return {
        index,
        name,
        uuid,
        memory_total_mib: Number(memoryTotal),
        memory_free_mib: Number(memoryFree),
        driver_version: driverVersion,
        compute_capability: computeCapability
      };
    });
  return {
    available: devices.length > 0,
    backend: 'nvidia',
    executable,
    devices,
    error: devices.length ? null : 'no_nvidia_devices'
  };
}

function encodedPowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

function parseJsonPayload(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('empty_json_output');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('invalid_json_output');
    return JSON.parse(text.slice(start, end + 1));
  }
}

export function isAllowedNpuProviderLibraryPath(candidate, {
  platform = process.platform,
  systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
} = {}) {
  if (platform !== 'win32' || typeof candidate !== 'string' || !candidate.trim()) return false;
  const root = path.win32.parse(path.win32.resolve(systemRoot)).root;
  if (!root) return false;
  const windowsApps = path.win32.join(root, 'Program Files', 'WindowsApps');
  const resolved = path.win32.resolve(candidate);
  const relative = path.win32.relative(windowsApps, resolved);
  if (!relative || relative.startsWith('..') || path.win32.isAbsolute(relative)) return false;
  const segments = relative.split(/[\\/]/);
  return (
    segments.length === 3 &&
    /^Microsoft\.WinML\.AMD\.NPU\.EP\.2_\d+(?:\.\d+){3}_(?:x64|arm64|x86)__8wekyb3d8bbwe$/i
      .test(segments[0]) &&
    segments[1].toLowerCase() === 'executionprovider' &&
    segments[2].toLowerCase() === 'onnxruntime_vitisai_ep.dll'
  );
}

export function recordedNpuProviderLibrary(manifest, {
  platform = process.platform,
  systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
  isFile = (candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() === true
} = {}) {
  const provider = manifest?.probe?.providers?.find?.(
    (item) => item?.name === NPU_EXECUTION_PROVIDER
  );
  const candidate = provider?.library_path;
  if (!isAllowedNpuProviderLibraryPath(candidate, { platform, systemRoot })) return null;
  try {
    return isFile(candidate) ? path.win32.normalize(candidate) : null;
  } catch {
    return null;
  }
}

function windowsNpuProbeSource() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$pnpUtil = Join-Path ([string]$env:SystemRoot) 'System32\\pnputil.exe'",
    "if (-not (Test-Path -LiteralPath $pnpUtil -PathType Leaf)) { throw 'pnputil_not_found' }",
    "[xml]$inventory = ((& $pnpUtil /enum-devices /class ComputeAccelerator /connected /drivers /format xml) -join \"`n\")",
    "if ($LASTEXITCODE -ne 0) { throw 'pnputil_failed' }",
    "$deviceRecords = @($inventory.PnpUtil.Device | ForEach-Object {",
    "  $item = $_",
    "  $drivers = @($item.MatchingDrivers.DriverName)",
    "  $driver = $drivers | Where-Object { [string]$_.Status -match 'Installed' } | Select-Object -First 1",
    "  if (-not $driver) { $driver = $drivers | Select-Object -First 1 }",
    "  $driverVersionValue = [string]$driver.DriverVersion",
    "  $driverVersionParts = $driverVersionValue -split ' ', 2",
    "  $service = ''",
    "  try {",
    "    $deviceRegistry = Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\' + [string]$item.InstanceId) -Name Service -ErrorAction Stop",
    "    $service = [string]$deviceRegistry.Service",
    "  } catch {",
    "    $service = ''",
    "  }",
    "  [pscustomobject]@{",
    "    name = [string]$item.DeviceDescription",
    "    manufacturer = [string]$item.ManufacturerName",
    "    status = if ([string]$item.Status -eq 'Started') { 'OK' } else { [string]$item.Status }",
    "    pnp_class = [string]$item.ClassName",
    "    service = $service",
    "    device_id = [string]$item.InstanceId",
    "    driver_version = if ($driverVersionParts.Count -gt 1) { $driverVersionParts[1] } else { $driverVersionValue }",
    "    driver_provider = [string]$driver.ProviderName",
    "    driver_date = if ($driverVersionParts.Count -gt 1) { $driverVersionParts[0] } else { $null }",
    "    inf_name = [string]$item.DriverName",
    "  }",
    "})",
    "$packageInventoryError = $null",
    "$packages = @()",
    "try {",
    "  $packages = @(Get-AppxPackage -Name 'Microsoft.WinML.AMD.NPU.EP.2' -ErrorAction Stop | ForEach-Object {",
    "    [pscustomobject]@{",
    "      name = [string]$_.Name",
    "      version = [string]$_.Version",
    "      package_full_name = [string]$_.PackageFullName",
    "      status = [string]$_.Status",
    "      install_location = [string]$_.InstallLocation",
    "    }",
    "  })",
    "} catch {",
    "  $packageInventoryError = [string]$_.Exception.Message",
    "}",
    "[pscustomobject]@{ devices = $deviceRecords; execution_provider_packages = $packages; execution_provider_package_error = $packageInventoryError } | ConvertTo-Json -Depth 6 -Compress"
  ].join('\n');
}

export function detectWindowsNpu({
  env = process.env,
  runner = runCommandSync,
  platform = process.platform
} = {}) {
  if (platform !== 'win32') {
    return {
      available: false,
      backend: 'windows-ml',
      devices: [],
      execution_provider: {
        name: NPU_EXECUTION_PROVIDER,
        package_present: false,
        packages: [],
        inventory_error: null
      },
      error: 'unsupported_platform'
    };
  }
  const executable = ['powershell.exe', 'powershell', 'pwsh']
    .map((name) => findExecutable(name, env, platform))
    .find(Boolean);
  if (!executable) {
    return {
      available: false,
      backend: 'windows-ml',
      devices: [],
      execution_provider: {
        name: NPU_EXECUTION_PROVIDER,
        package_present: false,
        packages: [],
        inventory_error: null
      },
      error: 'powershell_not_found'
    };
  }
  const result = runner(executable, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedPowerShell(windowsNpuProbeSource())
  ], {
    env,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      backend: 'windows-ml',
      executable,
      devices: [],
      execution_provider: {
        name: NPU_EXECUTION_PROVIDER,
        package_present: false,
        packages: [],
        inventory_error: null
      },
      error: result.error?.message ?? String(result.stderr ?? 'windows_npu_probe_failed').trim()
    };
  }
  try {
    const payload = parseJsonPayload(result.stdout);
    const rawDevices = Array.isArray(payload.devices)
      ? payload.devices
      : payload.devices ? [payload.devices] : [];
    const packages = Array.isArray(payload.execution_provider_packages)
      ? payload.execution_provider_packages
      : payload.execution_provider_packages ? [payload.execution_provider_packages] : [];
    const devices = rawDevices.map((device, index) => ({
      index,
      name: String(device.name ?? 'Windows NPU'),
      manufacturer: String(device.manufacturer ?? ''),
      status: String(device.status ?? ''),
      pnp_class: String(device.pnp_class ?? ''),
      service: String(device.service ?? ''),
      device_id: String(device.device_id ?? ''),
      driver_version: String(device.driver_version ?? ''),
      driver_provider: String(device.driver_provider ?? ''),
      driver_date: device.driver_date ?? null,
      inf_name: String(device.inf_name ?? '')
    }));
    const available = devices.some((device) => device.status.toLowerCase() === 'ok');
    return {
      available,
      backend: 'windows-ml',
      executable,
      devices,
      execution_provider: {
        name: NPU_EXECUTION_PROVIDER,
        package_present: packages.length > 0,
        packages,
        inventory_error: payload.execution_provider_package_error
          ? String(payload.execution_provider_package_error)
          : null
      },
      error: available ? null : 'no_ready_npu_devices'
    };
  } catch (error) {
    return {
      available: false,
      backend: 'windows-ml',
      executable,
      devices: [],
      execution_provider: {
        name: NPU_EXECUTION_PROVIDER,
        package_present: false,
        packages: [],
        inventory_error: null
      },
      error: 'invalid_windows_npu_probe_json: ' + error.message
    };
  }
}

function pythonProbeSource() {
  return [
    'import importlib.metadata as metadata',
    'import json',
    'import platform',
    'import sys',
    'payload = {',
    '  "python": sys.version.split()[0],',
    '  "implementation": platform.python_implementation(),',
    '  "executable": sys.executable,',
    '  "packages": {}',
    '}',
    'for name in ["torch", "numpy", "scipy", "matplotlib", "pandas"]:',
    '  try:',
    '    payload["packages"][name] = metadata.version(name)',
    '  except metadata.PackageNotFoundError:',
    '    payload["packages"][name] = None',
    'try:',
    '  import torch',
    '  devices = []',
    '  if torch.cuda.is_available():',
    '    for index in range(torch.cuda.device_count()):',
    '      properties = torch.cuda.get_device_properties(index)',
    '      devices.append({',
    '        "index": index,',
    '        "name": torch.cuda.get_device_name(index),',
    '        "compute_capability": ".".join(map(str, torch.cuda.get_device_capability(index))),',
    '        "total_memory_bytes": properties.total_memory',
    '      })',
    '  payload["torch"] = {',
    '    "version": torch.__version__,',
    '    "cuda_runtime": torch.version.cuda,',
    '    "cuda_available": torch.cuda.is_available(),',
    '    "device_count": torch.cuda.device_count(),',
    '    "devices": devices',
    '  }',
    'except Exception as exc:',
    '  payload["torch"] = None',
    '  payload["error"] = type(exc).__name__ + ": " + str(exc)',
    'print(json.dumps(payload, sort_keys=True))'
  ].join('\n');
}

function probePython(python, { env, cwd, runner = runCommandSync } = {}) {
  const result = runner(python, ['-c', pythonProbeSource()], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message ?? String(result.stderr ?? 'python_probe_failed').trim(),
      details: null
    };
  }
  try {
    const details = JSON.parse(String(result.stdout ?? '').trim());
    return {
      ok: !details.error,
      error: details.error ?? null,
      details
    };
  } catch (error) {
    return { ok: false, error: 'invalid_python_probe_json: ' + error.message, details: null };
  }
}

function parseNpuWorkerOutput(value) {
  const prefix = 'SCIENCECODE_RESULT_JSON=';
  const lines = String(value ?? '').trim().split(/\r?\n/).reverse();
  const tagged = lines.find((line) => line.startsWith(prefix));
  if (!tagged) throw new Error('missing_npu_worker_result');
  return JSON.parse(tagged.slice(prefix.length));
}

function probeNpuPython(python, {
  packageRoot,
  env,
  scienceCodeHome,
  cwd,
  runner = runCommandSync,
  allowProviderDownload = false,
  providerLibrary = null
} = {}) {
  const worker = path.join(path.resolve(packageRoot), 'runtime', 'npu_worker.py');
  if (!fs.statSync(worker, { throwIfNoEntry: false })?.isFile()) {
    return { ok: false, details: null, error: 'npu_worker_missing' };
  }
  const argumentsList = [worker, 'probe', '--json'];
  if (allowProviderDownload) argumentsList.push('--allow-provider-download');
  if (providerLibrary) argumentsList.push('--provider-library', providerLibrary);
  const result = runner(python, argumentsList, {
    cwd,
    env: isolatedPythonEnvironment(env, scienceCodeHome),
    encoding: 'utf8',
    timeout: 90_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  let details = null;
  try {
    details = parseNpuWorkerOutput(result.stdout);
  } catch (error) {
    return {
      ok: false,
      details: null,
      error: result.error?.message ??
        String(result.stderr ?? '').trim() ??
        'invalid_npu_probe_json: ' + error.message
    };
  }
  const provider = details.providers?.find?.((item) => item.name === NPU_EXECUTION_PROVIDER);
  const registered = details.registered_providers?.includes?.(NPU_EXECUTION_PROVIDER) === true;
  const ok = (
    result.status === 0 &&
    !result.error &&
    details.ok === true &&
    provider?.ready_state === 'ready' &&
    registered
  );
  return {
    ok,
    details,
    error: ok ? null : details.error ?? provider?.error ??
      result.error?.message ?? String(result.stderr ?? 'vitisai_execution_provider_unavailable').trim()
  };
}

export function probeNpuRuntime({
  packageRoot = MODULE_ROOT,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform,
  providerLibraryResolver = recordedNpuProviderLibrary
} = {}) {
  const paths = npuRuntimePaths({ env, scienceCodeHome, platform });
  if (platform !== 'win32') {
    return {
      installed: false,
      healthy: false,
      profile: NPU_RUNTIME_PROFILE,
      paths,
      manifest: null,
      probe: null,
      error: 'unsupported_platform'
    };
  }
  if (!fs.statSync(paths.python, { throwIfNoEntry: false })?.isFile()) {
    return {
      installed: false,
      healthy: false,
      profile: NPU_RUNTIME_PROFILE,
      paths,
      manifest: null,
      probe: null,
      error: 'runtime_not_installed'
    };
  }
  let manifest = null;
  try {
    manifest = readJson(paths.manifest);
  } catch (error) {
    return {
      installed: true,
      healthy: false,
      profile: NPU_RUNTIME_PROFILE,
      paths,
      manifest: null,
      probe: null,
      error: 'invalid_runtime_manifest: ' + error.message
    };
  }
  const providerLibrary = providerLibraryResolver(manifest, {
    platform,
    systemRoot: env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows'
  });
  const result = probeNpuPython(paths.python, {
    packageRoot,
    env,
    scienceCodeHome,
    cwd: paths.runtime,
    runner,
    providerLibrary
  });
  if (!result.details) {
    return {
      installed: true,
      healthy: false,
      profile: NPU_RUNTIME_PROFILE,
      paths,
      manifest,
      manifest_sha256: sha256File(paths.manifest),
      provider_library: providerLibrary,
      probe: null,
      error: result.error
    };
  }
  return {
    installed: true,
    healthy: result.ok,
    profile: NPU_RUNTIME_PROFILE,
    paths,
    manifest,
    manifest_sha256: sha256File(paths.manifest),
    provider_library: providerLibrary,
    probe: result.details,
    error: result.error
  };
}

export function probeComputeRuntime({
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform
} = {}) {
  const paths = computeRuntimePaths({ env, scienceCodeHome, platform });
  if (!fs.statSync(paths.python, { throwIfNoEntry: false })?.isFile()) {
    return {
      installed: false,
      healthy: false,
      profile: COMPUTE_RUNTIME_PROFILE,
      paths,
      manifest: null,
      probe: null,
      error: 'runtime_not_installed'
    };
  }
  let manifest = null;
  try {
    manifest = readJson(paths.manifest);
  } catch (error) {
    return {
      installed: true,
      healthy: false,
      profile: COMPUTE_RUNTIME_PROFILE,
      paths,
      manifest: null,
      probe: null,
      error: 'invalid_runtime_manifest: ' + error.message
    };
  }
  const pythonEnvironment = isolatedPythonEnvironment(env, scienceCodeHome);
  const probe = probePython(paths.python, {
    env: pythonEnvironment,
    cwd: paths.runtime,
    runner
  });
  const cudaAvailable = probe.details?.torch?.cuda_available === true;
  return {
    installed: true,
    healthy: probe.ok && cudaAvailable,
    profile: COMPUTE_RUNTIME_PROFILE,
    paths,
    manifest,
    manifest_sha256: sha256File(paths.manifest),
    probe: probe.details,
    error: probe.error ?? (cudaAvailable ? null : 'cuda_unavailable_in_runtime')
  };
}

function parseCadAdapterOutput(value) {
  const prefix = 'SCIENCECODE_CADQUERY_RESULT_JSON=';
  const lines = String(value ?? '').trim().split(/\r?\n/).reverse();
  const tagged = lines.find((line) => line.startsWith(prefix));
  if (!tagged) throw new Error('missing_cadquery_adapter_result');
  return JSON.parse(tagged.slice(prefix.length));
}

function probeCadPython(python, adapter, {
  env, scienceCodeHome, cwd, runner = runCommandSync
} = {}) {
  const result = runner(python, ['-I', '-B', adapter, 'probe'], {
    cwd,
    env: isolatedPythonEnvironment(env, scienceCodeHome),
    encoding: 'utf8',
    timeout: 90_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  let details = null;
  try {
    details = parseCadAdapterOutput(result.stdout);
  } catch (error) {
    return {
      ok: false,
      details: null,
      error: result.error?.message ?? (String(result.stderr ?? '').trim() ||
        'invalid_cadquery_probe_json: ' + error.message)
    };
  }
  const ok = result.status === 0 && !result.error && details.ok === true &&
    Boolean(details.cadquery_version) && details.sample_valid === true;
  return {
    ok,
    details,
    error: ok ? null : details.error ?? result.error?.message ??
      String(result.stderr ?? 'cadquery_runtime_unavailable').trim()
  };
}

export function probeCadRuntime({
  packageRoot = MODULE_ROOT,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform
} = {}) {
  const paths = cadRuntimePaths({ env, scienceCodeHome, platform });
  if (!fs.statSync(paths.python, { throwIfNoEntry: false })?.isFile() ||
      !fs.statSync(paths.adapter, { throwIfNoEntry: false })?.isFile()) {
    return {
      installed: false, healthy: false, profile: CAD_RUNTIME_PROFILE, paths,
      manifest: null, probe: null, error: 'runtime_not_installed'
    };
  }
  let manifest = null;
  try {
    manifest = readJson(paths.manifest);
  } catch (error) {
    return {
      installed: true, healthy: false, profile: CAD_RUNTIME_PROFILE, paths,
      manifest: null, probe: null, error: 'invalid_runtime_manifest: ' + error.message
    };
  }
  if (manifest.schema_version !== CAD_RUNTIME_SCHEMA_VERSION ||
      manifest.profile !== CAD_RUNTIME_PROFILE ||
      manifest.profile_version !== CAD_RUNTIME_PROFILE_VERSION) {
    return {
      installed: true, healthy: false, profile: CAD_RUNTIME_PROFILE, paths,
      manifest, manifest_sha256: sha256File(paths.manifest), probe: null,
      error: 'unsupported_runtime_manifest'
    };
  }
  const packagedRequirements = path.join(path.resolve(packageRoot), 'runtime', 'requirements-cad.txt');
  const packagedAdapter = path.join(path.resolve(packageRoot), 'runtime', 'cadquery_adapter.py');
  const definitionCurrent =
    fs.statSync(packagedRequirements, { throwIfNoEntry: false })?.isFile() &&
    fs.statSync(packagedAdapter, { throwIfNoEntry: false })?.isFile() &&
    fs.statSync(paths.requirements, { throwIfNoEntry: false })?.isFile() &&
    fs.statSync(paths.adapter, { throwIfNoEntry: false })?.isFile() &&
    manifest.requirements_sha256 === sha256File(packagedRequirements) &&
    manifest.requirements_sha256 === sha256File(paths.requirements) &&
    manifest.adapter_sha256 === sha256File(packagedAdapter) &&
    manifest.adapter_sha256 === sha256File(paths.adapter);
  if (!definitionCurrent) {
    return {
      installed: true, healthy: false, profile: CAD_RUNTIME_PROFILE, paths,
      manifest, manifest_sha256: sha256File(paths.manifest), probe: null,
      error: 'runtime_definition_changed'
    };
  }
  const probe = probeCadPython(paths.python, paths.adapter, {
    env, scienceCodeHome, cwd: paths.runtime, runner
  });
  return {
    installed: true,
    healthy: probe.ok,
    profile: CAD_RUNTIME_PROFILE,
    paths,
    manifest,
    manifest_sha256: sha256File(paths.manifest),
    probe: probe.details,
    error: probe.error
  };
}

function commandFailure(label, result, stagingDirectory) {
  const detail = result.error?.message ?? String(result.stderr ?? result.stdout ?? '').trim();
  const error = new Error(
    label + ' failed' + (detail ? ': ' + detail : '') + '. Preserved staging directory: ' + stagingDirectory
  );
  error.code = 'COMPUTE_SETUP_FAILED';
  error.staging_directory = stagingDirectory;
  return error;
}

export function setupComputeRuntime({
  packageRoot,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform,
  inheritOutput = false
} = {}) {
  const root = path.resolve(packageRoot ?? '.');
  const requirementsFiles = {
    science: path.join(root, 'runtime', 'requirements-science.txt'),
    gpu: path.join(root, 'runtime', 'requirements-gpu.txt')
  };
  const missingRequirements = Object.values(requirementsFiles)
    .filter((file) => !fs.statSync(file, { throwIfNoEntry: false })?.isFile());
  if (missingRequirements.length) {
    throw Object.assign(new Error('ScienceCode compute requirements are missing: ' + missingRequirements.join(', ')), {
      code: 'COMPUTE_REQUIREMENTS_MISSING'
    });
  }
  ensureScienceCodeHome(scienceCodeHome);
  const paths = computeRuntimePaths({ env, scienceCodeHome, platform });
  fs.mkdirSync(paths.runtimes, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(paths.home, 'cache', 'uv'), { recursive: true, mode: 0o700 });

  if (fs.existsSync(paths.runtime)) {
    const existing = probeComputeRuntime({ env, scienceCodeHome, runner, platform });
    if (existing.healthy) return { ok: true, reused: true, runtime: existing };
    throw Object.assign(
      new Error('The existing ScienceCode compute runtime is unhealthy and was preserved: ' + paths.runtime),
      { code: 'COMPUTE_RUNTIME_INVALID', runtime: existing }
    );
  }

  const uv = findExecutable('uv', env, platform);
  if (!uv) {
    throw Object.assign(
      new Error('uv is required to create the isolated compute runtime. Install uv and retry.'),
      { code: 'UV_NOT_FOUND' }
    );
  }
  const systemPython = ['python', 'python3', 'py']
    .map((name) => findExecutable(name, env, platform))
    .find(Boolean);
  if (!systemPython) {
    throw Object.assign(new Error('Python 3.11 or newer is required to create the compute runtime.'), {
      code: 'PYTHON_NOT_FOUND'
    });
  }

  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + crypto.randomBytes(3).toString('hex');
  const stagingDirectory = path.join(paths.runtimes, GPU_RUNTIME_DIRECTORY + '.installing-' + suffix);
  const stagingPython = pythonExecutableForRuntime(stagingDirectory, platform);
  const pythonEnvironment = isolatedPythonEnvironment(env, scienceCodeHome);
  const commonOptions = {
    cwd: root,
    env: pythonEnvironment,
    encoding: 'utf8',
    timeout: 45 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    ...(inheritOutput ? { stdio: 'inherit' } : {})
  };

  let result = runner(uv, ['venv', stagingDirectory, '--python', systemPython, '--seed'], commonOptions);
  if (result.error || result.status !== 0) throw commandFailure('Creating the Python environment', result, stagingDirectory);

  result = runner(uv, [
    'pip',
    'install',
    '--python',
    stagingPython,
    '--requirement',
    requirementsFiles.science
  ], commonOptions);
  if (result.error || result.status !== 0) {
    throw commandFailure('Installing the scientific Python stack', result, stagingDirectory);
  }
  result = runner(uv, [
    'pip',
    'install',
    '--python',
    stagingPython,
    '--requirement',
    requirementsFiles.gpu
  ], commonOptions);
  if (result.error || result.status !== 0) {
    throw commandFailure('Installing the CUDA-enabled PyTorch runtime', result, stagingDirectory);
  }

  const probe = probePython(stagingPython, {
    env: pythonEnvironment,
    cwd: stagingDirectory,
    runner
  });
  if (!probe.ok || probe.details?.torch?.cuda_available !== true) {
    const reason = probe.error ?? 'PyTorch did not expose a CUDA device.';
    throw Object.assign(
      new Error('GPU runtime validation failed: ' + reason + ' Preserved staging directory: ' + stagingDirectory),
      { code: 'COMPUTE_GPU_UNAVAILABLE', staging_directory: stagingDirectory, probe }
    );
  }

  const freeze = runner(uv, ['pip', 'freeze', '--python', stagingPython], {
    cwd: stagingDirectory,
    env: pythonEnvironment,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (freeze.error || freeze.status !== 0) throw commandFailure('Capturing the runtime lock', freeze, stagingDirectory);

  fs.copyFileSync(
    requirementsFiles.science,
    path.join(stagingDirectory, 'requirements-science.txt'),
    fs.constants.COPYFILE_EXCL
  );
  fs.copyFileSync(
    requirementsFiles.gpu,
    path.join(stagingDirectory, 'requirements-gpu.txt'),
    fs.constants.COPYFILE_EXCL
  );
  const manifest = {
    schema_version: COMPUTE_RUNTIME_SCHEMA_VERSION,
    profile: COMPUTE_RUNTIME_PROFILE,
    profile_version: COMPUTE_RUNTIME_PROFILE_VERSION,
    created_at: new Date().toISOString(),
    python_source: systemPython,
    uv,
    requirements_sha256: {
      science: sha256File(requirementsFiles.science),
      gpu: sha256File(requirementsFiles.gpu)
    },
    packages: String(freeze.stdout ?? '').trim().split(/\r?\n/).filter(Boolean),
    probe: {
      ...probe.details,
      executable: paths.python
    }
  };
  writeJson(path.join(stagingDirectory, 'runtime-manifest.json'), manifest);
  fs.renameSync(stagingDirectory, paths.runtime);

  const runtime = probeComputeRuntime({ env, scienceCodeHome, runner, platform });
  return { ok: runtime.healthy, reused: false, runtime };
}

export function setupNpuRuntime({
  packageRoot = MODULE_ROOT,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform,
  inheritOutput = false
} = {}) {
  if (platform !== 'win32') {
    throw Object.assign(new Error('The Windows ML NPU runtime is supported only on Windows.'), {
      code: 'NPU_UNSUPPORTED_PLATFORM'
    });
  }
  const root = path.resolve(packageRoot);
  const requirementsFile = path.join(root, 'runtime', 'requirements-npu.txt');
  if (!fs.statSync(requirementsFile, { throwIfNoEntry: false })?.isFile()) {
    throw Object.assign(new Error('ScienceCode NPU requirements are missing: ' + requirementsFile), {
      code: 'COMPUTE_REQUIREMENTS_MISSING'
    });
  }
  ensureScienceCodeHome(scienceCodeHome);
  const paths = npuRuntimePaths({ env, scienceCodeHome, platform });
  fs.mkdirSync(paths.runtimes, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(paths.home, 'cache', 'uv'), { recursive: true, mode: 0o700 });

  if (fs.existsSync(paths.runtime)) {
    const existing = probeNpuRuntime({
      packageRoot: root,
      env,
      scienceCodeHome,
      runner,
      platform
    });
    if (existing.healthy) return { ok: true, reused: true, runtime: existing };
    throw Object.assign(
      new Error('The existing ScienceCode NPU runtime is unhealthy and was preserved: ' + paths.runtime),
      { code: 'NPU_RUNTIME_INVALID', runtime: existing }
    );
  }

  const uv = findExecutable('uv', env, platform);
  if (!uv) {
    throw Object.assign(
      new Error('uv is required to create the isolated NPU runtime. Install uv and retry.'),
      { code: 'UV_NOT_FOUND' }
    );
  }
  const systemPython = ['python', 'python3', 'py']
    .map((name) => findExecutable(name, env, platform))
    .find(Boolean);
  if (!systemPython) {
    throw Object.assign(
      new Error('An unpackaged Python 3.11 through 3.13 runtime is required for Windows ML.'),
      { code: 'PYTHON_NOT_FOUND' }
    );
  }

  const pythonEnvironment = isolatedPythonEnvironment(env, scienceCodeHome);
  let stagingDirectory = null;
  let stagingPython = null;
  let probe = null;
  let resumed = false;
  const stagingPrefix = NPU_RUNTIME_DIRECTORY + '.installing-';
  const candidates = fs.readdirSync(paths.runtimes, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(stagingPrefix))
    .map((entry) => path.join(paths.runtimes, entry.name))
    .sort((left, right) => right.localeCompare(left));
  for (const candidate of candidates) {
    const candidatePython = pythonExecutableForRuntime(candidate, platform);
    if (!fs.statSync(candidatePython, { throwIfNoEntry: false })?.isFile()) continue;
    const candidateProbe = probeNpuPython(candidatePython, {
      packageRoot: root,
      env,
      scienceCodeHome,
      cwd: candidate,
      runner,
      allowProviderDownload: true
    });
    if (!candidateProbe.ok) continue;
    stagingDirectory = candidate;
    stagingPython = candidatePython;
    probe = candidateProbe;
    resumed = true;
    break;
  }

  if (!stagingDirectory) {
    const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' +
      crypto.randomBytes(3).toString('hex');
    stagingDirectory = path.join(paths.runtimes, stagingPrefix + suffix);
    stagingPython = pythonExecutableForRuntime(stagingDirectory, platform);
    const commonOptions = {
      cwd: root,
      env: pythonEnvironment,
      encoding: 'utf8',
      timeout: 45 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      ...(inheritOutput ? { stdio: 'inherit' } : {})
    };
    let install = runner(uv, [
      'venv', stagingDirectory, '--python', systemPython, '--seed'
    ], commonOptions);
    if (install.error || install.status !== 0) {
      throw commandFailure('Creating the NPU Python environment', install, stagingDirectory);
    }
    install = runner(uv, [
      'pip',
      'install',
      '--python',
      stagingPython,
      '--requirement',
      requirementsFile
    ], commonOptions);
    if (install.error || install.status !== 0) {
      throw commandFailure('Installing the Windows ML NPU stack', install, stagingDirectory);
    }
    probe = probeNpuPython(stagingPython, {
      packageRoot: root,
      env,
      scienceCodeHome,
      cwd: stagingDirectory,
      runner,
      allowProviderDownload: true
    });
  }
  if (!probe.ok) {
    throw Object.assign(
      new Error(
        'NPU runtime validation failed: ' + (probe.error ?? 'Vitis AI was not registered.') +
        ' Preserved staging directory: ' + stagingDirectory
      ),
      { code: 'COMPUTE_NPU_UNAVAILABLE', staging_directory: stagingDirectory, probe }
    );
  }

  const freeze = runner(uv, ['pip', 'freeze', '--python', stagingPython], {
    cwd: stagingDirectory,
    env: pythonEnvironment,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (freeze.error || freeze.status !== 0) {
    throw commandFailure('Capturing the NPU runtime lock', freeze, stagingDirectory);
  }
  const stagedRequirements = path.join(stagingDirectory, 'requirements-npu.txt');
  if (fs.existsSync(stagedRequirements)) {
    if (sha256File(stagedRequirements) !== sha256File(requirementsFile)) {
      throw Object.assign(
        new Error('Preserved NPU staging requirements do not match the current package: ' + stagingDirectory),
        { code: 'NPU_STAGING_REQUIREMENTS_MISMATCH', staging_directory: stagingDirectory }
      );
    }
  } else {
    fs.copyFileSync(requirementsFile, stagedRequirements, fs.constants.COPYFILE_EXCL);
  }
  const manifest = {
    schema_version: NPU_RUNTIME_SCHEMA_VERSION,
    profile: NPU_RUNTIME_PROFILE,
    profile_version: NPU_RUNTIME_PROFILE_VERSION,
    execution_provider: NPU_EXECUTION_PROVIDER,
    created_at: new Date().toISOString(),
    python_source: systemPython,
    uv,
    requirements_sha256: sha256File(requirementsFile),
    packages: String(freeze.stdout ?? '').trim().split(/\r?\n/).filter(Boolean),
    probe: {
      ...probe.details,
      python_executable: paths.python
    }
  };
  writeJson(path.join(stagingDirectory, 'runtime-manifest.json'), manifest);
  fs.renameSync(stagingDirectory, paths.runtime);

  const runtime = probeNpuRuntime({
    packageRoot: root,
    env,
    scienceCodeHome,
    runner,
    platform
  });
  return { ok: runtime.healthy, reused: false, resumed, runtime };
}

export function setupCadRuntime({
  packageRoot = MODULE_ROOT,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform,
  inheritOutput = false,
  refresh = false
} = {}) {
  const root = path.resolve(packageRoot);
  const requirementsFile = path.join(root, 'runtime', 'requirements-cad.txt');
  const adapterFile = path.join(root, 'runtime', 'cadquery_adapter.py');
  const missing = [requirementsFile, adapterFile].filter((file) =>
    !fs.statSync(file, { throwIfNoEntry: false })?.isFile());
  if (missing.length) {
    throw Object.assign(new Error('ScienceCode CAD runtime files are missing: ' + missing.join(', ')), {
      code: 'COMPUTE_REQUIREMENTS_MISSING'
    });
  }
  ensureScienceCodeHome(scienceCodeHome);
  const paths = cadRuntimePaths({ env, scienceCodeHome, platform });
  fs.mkdirSync(paths.runtimes, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(paths.home, 'cache', 'uv'), { recursive: true, mode: 0o700 });
  const installSuffix = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' +
    crypto.randomBytes(3).toString('hex');
  let preservedPreviousRuntime = null;

  if (fs.existsSync(paths.runtime)) {
    const existing = probeCadRuntime({
      packageRoot: root, env, scienceCodeHome, runner, platform
    });
    if (existing.healthy && !refresh) return { ok: true, reused: true, runtime: existing };
    if (!refresh) throw Object.assign(
      new Error('The existing ScienceCode CAD runtime is unhealthy and was preserved: ' + paths.runtime),
      { code: 'CAD_RUNTIME_INVALID', runtime: existing }
    );
  }

  const uv = findExecutable('uv', env, platform);
  if (!uv) {
    throw Object.assign(
      new Error('uv is required to create the isolated CAD runtime. Install uv and retry.'),
      { code: 'UV_NOT_FOUND' }
    );
  }
  const systemPython = ['python', 'python3', 'py']
    .map((name) => findExecutable(name, env, platform))
    .find(Boolean);
  if (!systemPython) {
    throw Object.assign(new Error('Python 3.9 or newer is required to create the CAD runtime.'), {
      code: 'PYTHON_NOT_FOUND'
    });
  }

  const stagingDirectory = path.join(paths.runtimes, CAD_RUNTIME_DIRECTORY + '.installing-' + installSuffix);
  const stagingPython = pythonExecutableForRuntime(stagingDirectory, platform);
  const stagingAdapter = path.join(stagingDirectory, 'cadquery_adapter.py');
  const pythonEnvironment = isolatedPythonEnvironment(env, scienceCodeHome);
  const commonOptions = {
    cwd: root,
    env: pythonEnvironment,
    encoding: 'utf8',
    timeout: 45 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    ...(inheritOutput ? { stdio: 'inherit' } : {})
  };

  let result = runner(uv, [
    'venv', stagingDirectory, '--python', systemPython, '--seed'
  ], commonOptions);
  if (result.error || result.status !== 0) {
    throw commandFailure('Creating the CAD Python environment', result, stagingDirectory);
  }
  result = runner(uv, [
    'pip', 'install', '--python', stagingPython, '--requirement', requirementsFile
  ], commonOptions);
  if (result.error || result.status !== 0) {
    throw commandFailure('Installing the CadQuery runtime', result, stagingDirectory);
  }
  fs.copyFileSync(requirementsFile, path.join(stagingDirectory, 'requirements-cad.txt'), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(adapterFile, stagingAdapter, fs.constants.COPYFILE_EXCL);

  const probe = probeCadPython(stagingPython, stagingAdapter, {
    env, scienceCodeHome, cwd: stagingDirectory, runner
  });
  if (!probe.ok) {
    throw Object.assign(
      new Error('CAD runtime validation failed: ' + (probe.error ?? 'CadQuery probe failed.') +
        ' Preserved staging directory: ' + stagingDirectory),
      { code: 'CAD_RUNTIME_UNAVAILABLE', staging_directory: stagingDirectory, probe }
    );
  }
  const freeze = runner(uv, ['pip', 'freeze', '--python', stagingPython], {
    cwd: stagingDirectory,
    env: pythonEnvironment,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (freeze.error || freeze.status !== 0) {
    throw commandFailure('Capturing the CAD runtime lock', freeze, stagingDirectory);
  }
  const manifest = {
    schema_version: CAD_RUNTIME_SCHEMA_VERSION,
    profile: CAD_RUNTIME_PROFILE,
    profile_version: CAD_RUNTIME_PROFILE_VERSION,
    created_at: new Date().toISOString(),
    python_source: systemPython,
    uv,
    requirements_sha256: sha256File(requirementsFile),
    adapter_sha256: sha256File(adapterFile),
    packages: String(freeze.stdout ?? '').trim().split(/\r?\n/).filter(Boolean),
    probe: { ...probe.details, python_executable: paths.python }
  };
  writeJson(path.join(stagingDirectory, 'runtime-manifest.json'), manifest);
  if (fs.existsSync(paths.runtime)) {
    preservedPreviousRuntime = path.join(
      paths.runtimes, CAD_RUNTIME_DIRECTORY + '.replaced-' + installSuffix
    );
    fs.renameSync(paths.runtime, preservedPreviousRuntime);
  }
  try {
    fs.renameSync(stagingDirectory, paths.runtime);
  } catch (error) {
    if (preservedPreviousRuntime && !fs.existsSync(paths.runtime) &&
        fs.existsSync(preservedPreviousRuntime)) {
      fs.renameSync(preservedPreviousRuntime, paths.runtime);
      preservedPreviousRuntime = null;
    }
    throw error;
  }
  const runtime = probeCadRuntime({
    packageRoot: root, env, scienceCodeHome, runner, platform
  });
  return {
    ok: runtime.healthy, reused: false, refreshed: Boolean(preservedPreviousRuntime),
    preserved_previous_runtime: preservedPreviousRuntime, runtime
  };
}

export function computeStatus({
  packageRoot = MODULE_ROOT,
  env = process.env,
  scienceCodeHome = resolveScienceCodeHome(env),
  runner = runCommandSync,
  platform = process.platform,
  gpuProbe = detectNvidiaGpu,
  npuProbe = detectWindowsNpu,
  gpuRuntimeProbe = probeComputeRuntime,
  npuRuntimeProbe = probeNpuRuntime,
  cadRuntimeProbe = probeCadRuntime
} = {}) {
  const gpu = gpuProbe({ env, runner, platform });
  const npu = npuProbe({ env, runner, platform });
  const gpuRuntime = gpuRuntimeProbe({ env, scienceCodeHome, runner, platform });
  const npuRuntime = npuRuntimeProbe({
    packageRoot,
    env,
    scienceCodeHome,
    runner,
    platform
  });
  const cadRuntime = cadRuntimeProbe({
    packageRoot,
    env,
    scienceCodeHome,
    runner,
    platform
  });
  const cudaReady = gpu.available && gpuRuntime.healthy;
  const npuReady = npu.available && npuRuntime.healthy;
  const cadReady = cadRuntime.healthy;
  return {
    ok: cudaReady || npuReady || cadReady,
    gpu,
    npu,
    runtime: gpuRuntime,
    runtimes: {
      gpu: gpuRuntime,
      npu: npuRuntime,
      cad: cadRuntime
    },
    capabilities: {
      cuda_simulation_training: {
        ready: cudaReady,
        device: gpu.devices?.[0]?.name ?? null,
        runtime: 'pytorch-cuda'
      },
      npu_onnx_inference: {
        ready: npuReady,
        device: npu.devices?.[0]?.name ?? null,
        runtime: 'windows-ml',
        execution_provider: NPU_EXECUTION_PROVIDER,
        fallback_policy: 'explicit_and_recorded'
      },
      cadquery_parametric_cad: {
        ready: cadReady,
        runtime: 'cadquery-occt',
        cadquery_version: cadRuntime.probe?.cadquery_version ?? null,
        interchange: ['STEP'],
        interactive_mesh: 'ASCII STL'
      }
    }
  };
}

export function validateRuntimePath(scienceCodeHome, candidate) {
  const home = path.resolve(scienceCodeHome);
  const resolved = path.resolve(candidate);
  return isPathInside(home, resolved);
}
