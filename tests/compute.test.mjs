import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cadRuntimePaths,
  computeRuntimePaths,
  detectNvidiaGpu,
  detectWindowsNpu,
  isAllowedNpuProviderLibraryPath,
  npuRuntimePaths,
  probeCadRuntime,
  probeComputeRuntime,
  probeNpuRuntime,
  recordedNpuProviderLibrary,
  setupCadRuntime,
  sha256File,
  validateRuntimePath
} from '../lib/core.js';

test('CadQuery runtime probe is isolated and requires a valid adapter result', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-runtime-'));
  const paths = cadRuntimePaths({ scienceCodeHome: home });
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, '');
  fs.copyFileSync(path.resolve('runtime', 'cadquery_adapter.py'), paths.adapter);
  fs.copyFileSync(path.resolve('runtime', 'requirements-cad.txt'), paths.requirements);
  fs.writeFileSync(paths.manifest, JSON.stringify({
    schema_version: 1, profile: 'cad', profile_version: 1,
    requirements_sha256: sha256File(path.resolve('runtime', 'requirements-cad.txt')),
    adapter_sha256: sha256File(path.resolve('runtime', 'cadquery_adapter.py'))
  }));
  const result = probeCadRuntime({
    packageRoot: path.resolve('.'),
    scienceCodeHome: home,
    runner(command, args, options) {
      assert.equal(command, paths.python);
      assert.deepEqual(args, ['-I', '-B', paths.adapter, 'probe']);
      assert.equal(options.env.SCIENCECODE_HOME, path.resolve(home));
      assert.equal(options.env.PYTHONPATH, undefined);
      return {
        status: 0,
        stdout: 'SCIENCECODE_CADQUERY_RESULT_JSON=' + JSON.stringify({
          ok: true, python: '3.11.9', cadquery_version: '2.8.0',
          cadquery_ocp_version: '7.9.3.1', sample_valid: true, sample_volume_mm3: 6
        }) + '\n',
        stderr: ''
      };
    }
  });
  assert.equal(result.installed, true);
  assert.equal(result.healthy, true);
  assert.equal(result.probe.cadquery_version, '2.8.0');
  assert.match(result.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(validateRuntimePath(home, paths.adapter), true);
});

test('missing CadQuery runtime does not consult global Python', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-missing-'));
  const result = probeCadRuntime({
    scienceCodeHome: home,
    runner() { throw new Error('runner must not be called'); }
  });
  assert.equal(result.installed, false);
  assert.equal(result.healthy, false);
  assert.equal(result.error, 'runtime_not_installed');
});

test('CadQuery runtime refuses a modified installed adapter before launching Python', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-stale-'));
  const paths = cadRuntimePaths({ scienceCodeHome: home });
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, '');
  fs.writeFileSync(paths.adapter, '# modified installed adapter\n');
  fs.copyFileSync(path.resolve('runtime', 'requirements-cad.txt'), paths.requirements);
  fs.writeFileSync(paths.manifest, JSON.stringify({
    schema_version: 1, profile: 'cad', profile_version: 1,
    requirements_sha256: sha256File(path.resolve('runtime', 'requirements-cad.txt')),
    adapter_sha256: sha256File(path.resolve('runtime', 'cadquery_adapter.py'))
  }));
  let launches = 0;
  const result = probeCadRuntime({
    packageRoot: path.resolve('.'),
    scienceCodeHome: home,
    runner() { launches += 1; throw new Error('modified adapter must not execute'); }
  });
  assert.equal(result.installed, true);
  assert.equal(result.healthy, false);
  assert.equal(result.error, 'runtime_definition_changed');
  assert.equal(result.probe, null);
  assert.equal(launches, 0);
});

test('CadQuery refresh keeps the active runtime until its staged replacement validates', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-refresh-'));
  const paths = cadRuntimePaths({ scienceCodeHome: home });
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, '');
  fs.copyFileSync(path.resolve('runtime', 'cadquery_adapter.py'), paths.adapter);
  fs.copyFileSync(path.resolve('runtime', 'requirements-cad.txt'), paths.requirements);
  fs.writeFileSync(path.join(paths.runtime, 'old-marker.txt'), 'preserve me\n');
  fs.writeFileSync(paths.manifest, JSON.stringify({
    schema_version: 1, profile: 'cad', profile_version: 1,
    requirements_sha256: sha256File(path.resolve('runtime', 'requirements-cad.txt')),
    adapter_sha256: sha256File(path.resolve('runtime', 'cadquery_adapter.py'))
  }));

  const bin = path.join(home, 'fake-bin');
  fs.mkdirSync(bin);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const uv = path.join(bin, 'uv' + suffix);
  const systemPython = path.join(bin, 'python' + suffix);
  fs.writeFileSync(uv, '');
  fs.writeFileSync(systemPython, '');
  if (process.platform !== 'win32') {
    fs.chmodSync(uv, 0o755);
    fs.chmodSync(systemPython, 0o755);
  }
  const env = {
    ...process.env, PATH: bin, Path: bin, PATHEXT: '.EXE;.CMD;.BAT;.COM',
    SCIENCECODE_HOME: home
  };
  const probeResult = () => ({
    status: 0, stderr: '',
    stdout: 'SCIENCECODE_CADQUERY_RESULT_JSON=' + JSON.stringify({
      ok: true, python: '3.11.9', cadquery_version: '2.8.0',
      cadquery_ocp_version: '7.9.3.1', sample_valid: true, sample_volume_mm3: 6
    }) + '\n'
  });
  let stagingPython = null;
  let stagedProbePassed = false;
  const sameExecutable = (left, right) => {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  };
  const result = setupCadRuntime({
    packageRoot: path.resolve('.'), scienceCodeHome: home, env, refresh: true,
    runner(command, args) {
      if (sameExecutable(command, uv)) {
        assert.equal(fs.existsSync(paths.runtime), true,
          'active runtime moved before staged replacement validation');
        if (args[0] === 'venv') {
          const staging = args[1];
          stagingPython = process.platform === 'win32'
            ? path.join(staging, 'Scripts', 'python.exe')
            : path.join(staging, 'bin', 'python');
          fs.mkdirSync(path.dirname(stagingPython), { recursive: true });
          fs.writeFileSync(stagingPython, '');
          if (process.platform !== 'win32') fs.chmodSync(stagingPython, 0o755);
          return { status: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'pip' && args[1] === 'freeze') {
          assert.equal(stagedProbePassed, true);
          return { status: 0, stdout: 'cadquery==2.8.0\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
      if (stagingPython && sameExecutable(command, stagingPython)) {
        assert.equal(fs.existsSync(paths.runtime), true);
        stagedProbePassed = true;
        return probeResult();
      }
      if (sameExecutable(command, paths.python)) return probeResult();
      throw new Error('Unexpected refresh command: ' + command + ' ' + args.join(' '));
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.equal(stagedProbePassed, true);
  assert.equal(fs.existsSync(path.join(paths.runtime, 'old-marker.txt')), false);
  assert.equal(fs.readFileSync(path.join(result.preserved_previous_runtime,
    'old-marker.txt'), 'utf8'), 'preserve me\n');
});

test('NVIDIA probe captures device, memory, driver, and compute capability', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-gpu-probe-'));
  const executable = path.join(
    directory,
    process.platform === 'win32' ? 'nvidia-smi.EXE' : 'nvidia-smi'
  );
  fs.writeFileSync(executable, '');
  if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
  const result = detectNvidiaGpu({
    env: {
      PATH: directory,
      PATHEXT: '.EXE'
    },
    runner(command, args) {
      assert.equal(path.resolve(command), path.resolve(executable));
      assert.ok(args.some((value) => value.includes('compute_cap')));
      return {
        status: 0,
        stdout: 'NVIDIA GeForce RTX 4090, GPU-test, 16311, 12000, 610.47, 12.0\n',
        stderr: ''
      };
    }
  });
  assert.equal(result.available, true);
  assert.deepEqual(result.devices[0], {
    index: 0,
    name: 'NVIDIA GeForce RTX 4090',
    uuid: 'GPU-test',
    memory_total_mib: 16311,
    memory_free_mib: 12000,
    driver_version: '610.47',
    compute_capability: '12.0'
  });
});

test('compute runtime probe uses only the ScienceCode-owned Python environment', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-compute-'));
  const paths = computeRuntimePaths({ scienceCodeHome: home });
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, '');
  fs.writeFileSync(paths.manifest, JSON.stringify({ schema_version: 1, profile: 'gpu' }));
  const result = probeComputeRuntime({
    scienceCodeHome: home,
    runner(command, args, options) {
      assert.equal(command, paths.python);
      assert.equal(args[0], '-c');
      assert.equal(options.env.SCIENCECODE_HOME, path.resolve(home));
      assert.equal(options.env.PYTHONPATH, undefined);
      return {
        status: 0,
        stdout: JSON.stringify({
          python: '3.11.9',
          packages: { torch: '2.12.0' },
          torch: {
            version: '2.12.0',
            cuda_runtime: '13.0',
            cuda_available: true,
            device_count: 1,
            devices: [{ name: 'NVIDIA GeForce RTX 4090' }]
          }
        }),
        stderr: ''
      };
    }
  });
  assert.equal(result.installed, true);
  assert.equal(result.healthy, true);
  assert.equal(result.probe.torch.cuda_available, true);
  assert.match(result.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(validateRuntimePath(home, paths.python), true);
  assert.equal(validateRuntimePath(home, path.join(home, '..', 'outside')), false);
});

test('missing compute runtime is reported without consulting global Python', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-compute-missing-'));
  const result = probeComputeRuntime({
    scienceCodeHome: home,
    runner() {
      throw new Error('runner must not be called');
    }
  });
  assert.equal(result.installed, false);
  assert.equal(result.healthy, false);
  assert.equal(result.error, 'runtime_not_installed');
});

test('Windows NPU probe captures device, driver, and Vitis package without inference claims', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-npu-probe-'));
  const executable = path.join(directory, 'powershell.EXE');
  fs.writeFileSync(executable, '');
  const result = detectWindowsNpu({
    platform: 'win32',
    env: { PATH: directory, PATHEXT: '.EXE' },
    runner(command, args) {
      assert.equal(path.resolve(command).toLowerCase(), path.resolve(executable).toLowerCase());
      assert.ok(args.includes('-EncodedCommand'));
      return {
        status: 0,
        stdout: JSON.stringify({
          devices: [{
            name: 'NPU Compute Accelerator Device',
            manufacturer: 'AMD',
            status: 'OK',
            pnp_class: 'ComputeAccelerator',
            service: 'IpuMcdmDriver',
            device_id: 'PCI\\VEN_1022&DEV_17F0',
            driver_version: '32.0.20102.3930',
            driver_provider: 'AMD',
            driver_date: '2026-05-07T00:00:00.0000000Z',
            inf_name: 'oem10.inf'
          }],
          execution_provider_packages: [{
            name: 'Microsoft.WinML.AMD.NPU.EP.2',
            version: '0.0.68.0',
            status: 'Ok'
          }]
        }),
        stderr: ''
      };
    }
  });
  assert.equal(result.available, true);
  assert.equal(result.devices[0].driver_version, '32.0.20102.3930');
  assert.equal(result.devices[0].service, 'IpuMcdmDriver');
  assert.equal(result.execution_provider.name, 'VitisAIExecutionProvider');
  assert.equal(result.execution_provider.package_present, true);
});

test('Windows NPU detection preserves ready hardware when AppX inventory is degraded', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-npu-appx-'));
  const executable = path.join(directory, 'powershell.EXE');
  fs.writeFileSync(executable, '');
  const result = detectWindowsNpu({
    platform: 'win32',
    env: { PATH: directory, PATHEXT: '.EXE' },
    runner(command, args) {
      assert.equal(path.resolve(command).toLowerCase(), path.resolve(executable).toLowerCase());
      const encodedIndex = args.indexOf('-EncodedCommand');
      const source = Buffer.from(args[encodedIndex + 1], 'base64').toString('utf16le');
      assert.match(source, /pnputil\.exe/);
      assert.match(source, /\/format xml/);
      assert.doesNotMatch(source, /Win32_PnPSignedDriver/);
      assert.match(source,
        /Get-AppxPackage -Name 'Microsoft\.WinML\.AMD\.NPU\.EP\.2' -ErrorAction Stop/);
      assert.match(source, /\$packageInventoryError/);
      assert.match(source, /catch/);
      return {
        status: 0,
        stdout: JSON.stringify({
          devices: [{
            name: 'NPU Compute Accelerator Device',
            manufacturer: 'AMD',
            status: 'OK',
            pnp_class: 'ComputeAccelerator',
            device_id: 'PCI\\VEN_1022&DEV_17F0'
          }],
          execution_provider_packages: [],
          execution_provider_package_error: 'SQLITE_IOERR_TRUNCATE'
        }),
        stderr: ''
      };
    }
  });
  assert.equal(result.available, true);
  assert.equal(result.error, null);
  assert.equal(result.execution_provider.package_present, false);
  assert.equal(result.execution_provider.inventory_error, 'SQLITE_IOERR_TRUNCATE');
});

test('recorded NPU provider fallback accepts only the protected AMD WindowsApps DLL', () => {
  const allowed = 'C:\\Program Files\\WindowsApps\\' +
    'Microsoft.WinML.AMD.NPU.EP.2_0.0.68.0_x64__8wekyb3d8bbwe\\' +
    'ExecutionProvider\\onnxruntime_vitisai_ep.dll';
  assert.equal(isAllowedNpuProviderLibraryPath(allowed, {
    platform: 'win32', systemRoot: 'C:\\Windows'
  }), true);
  assert.equal(isAllowedNpuProviderLibraryPath(
    'C:\\Users\\scientist\\onnxruntime_vitisai_ep.dll',
    { platform: 'win32', systemRoot: 'C:\\Windows' }
  ), false);
  assert.equal(isAllowedNpuProviderLibraryPath(
    allowed.replace('onnxruntime_vitisai_ep.dll', 'other.dll'),
    { platform: 'win32', systemRoot: 'C:\\Windows' }
  ), false);
  const manifest = {
    probe: {
      providers: [{ name: 'VitisAIExecutionProvider', library_path: allowed }]
    }
  };
  assert.equal(recordedNpuProviderLibrary(manifest, {
    platform: 'win32', systemRoot: 'C:\\Windows', isFile: () => true
  }), path.win32.normalize(allowed));
  assert.equal(recordedNpuProviderLibrary({
    probe: { providers: [{
      name: 'VitisAIExecutionProvider',
      library_path: 'C:\\Users\\scientist\\unsafe.dll'
    }] }
  }, {
    platform: 'win32', systemRoot: 'C:\\Windows', isFile: () => true
  }), null);
});

test('NPU runtime probe requires a ready and registered Vitis provider', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-npu-runtime-'));
  const paths = npuRuntimePaths({ scienceCodeHome: home, platform: 'win32' });
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, '');
  fs.writeFileSync(paths.manifest, JSON.stringify({
    schema_version: 1,
    profile: 'npu',
    execution_provider: 'VitisAIExecutionProvider'
  }));
  const providerLibrary = 'C:\\Program Files\\WindowsApps\\' +
    'Microsoft.WinML.AMD.NPU.EP.2_0.0.68.0_x64__8wekyb3d8bbwe\\' +
    'ExecutionProvider\\onnxruntime_vitisai_ep.dll';
  const result = probeNpuRuntime({
    packageRoot: path.resolve('.'),
    scienceCodeHome: home,
    platform: 'win32',
    providerLibraryResolver() {
      return providerLibrary;
    },
    runner(command, args, options) {
      assert.equal(command, paths.python);
      assert.equal(args[1], 'probe');
      assert.equal(args.includes('--allow-provider-download'), false);
      assert.equal(args[args.indexOf('--provider-library') + 1], providerLibrary);
      assert.equal(options.env.SCIENCECODE_HOME, path.resolve(home));
      assert.equal(options.env.PYTHONPATH, undefined);
      return {
        status: 0,
        stdout: 'compiler noise\nSCIENCECODE_RESULT_JSON=' + JSON.stringify({
          ok: true,
          python: '3.11.9',
          onnxruntime_version: '1.25.2',
          providers: [{
            name: 'VitisAIExecutionProvider',
            ready_state: 'ready',
            registered: true
          }],
          registered_providers: [
            'DmlExecutionProvider',
            'CPUExecutionProvider',
            'VitisAIExecutionProvider'
          ]
        }) + '\n',
        stderr: ''
      };
    }
  });
  assert.equal(result.installed, true);
  assert.equal(result.healthy, true);
  assert.equal(result.probe.onnxruntime_version, '1.25.2');
  assert.equal(result.provider_library, providerLibrary);
  assert.match(result.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(validateRuntimePath(home, paths.python), true);
});

test('missing NPU runtime is reported without consulting global Python', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-npu-missing-'));
  const result = probeNpuRuntime({
    packageRoot: path.resolve('.'),
    scienceCodeHome: home,
    platform: 'win32',
    runner() {
      throw new Error('runner must not be called');
    }
  });
  assert.equal(result.installed, false);
  assert.equal(result.healthy, false);
  assert.equal(result.error, 'runtime_not_installed');
});
