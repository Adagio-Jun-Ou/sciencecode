import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeStatus,
  createKernelManager,
  resolveScienceCodeHome,
  startLab,
  verifyKernel,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argumentsFor(argv) {
  const options = { home: null, requireCuda: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--home') {
      if (!argv[index + 1]) throw new Error('--home requires a directory.');
      options.home = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--require-cuda') {
      options.requireCuda = true;
    } else {
      throw new Error('Unknown live-kernel smoke option: ' + value);
    }
  }
  return options;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const options = argumentsFor(process.argv.slice(2));
const environment = {
  ...process.env,
  ...(options.home ? { SCIENCECODE_HOME: options.home } : {})
};
const scienceCodeHome = options.home ?? resolveScienceCodeHome(environment);
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-live-kernel-'));
const manager = createKernelManager({ cwd: project, scienceCodeHome, env: environment });
let launched = null;

try {
  const first = await manager.execute({
    language: 'python',
    timeoutMs: 120_000,
    code: [
      'import numpy as np',
      'import torch',
      'values = np.linspace(0.0, 1.0, 9)',
      'cuda_available = bool(torch.cuda.is_available())',
      'cuda_probe = None',
      'if cuda_available:',
      '    gpu_values = torch.arange(8, dtype=torch.float32, device="cuda")',
      '    cuda_probe = float((gpu_values * gpu_values).sum().cpu())',
      '{"mean": float(values.mean()), "cuda_available": cuda_available, "cuda_probe": cuda_probe, "torch": torch.__version__}'
    ].join('\n')
  });
  const second = await manager.execute({
    language: 'python',
    timeoutMs: 120_000,
    code: [
      'import matplotlib.pyplot as plt',
      'fig, ax = plt.subplots(figsize=(5, 3))',
      'ax.plot(values, values ** 2, marker="o")',
      'ax.set(title="ScienceCode 0.9 live kernel", xlabel="x", ylabel="x squared")',
      '{"points": int(values.size), "last": float((values ** 2)[-1])}'
    ].join('\n')
  });

  launched = startLab({
    cwd: project,
    packageRoot,
    port: 0,
    kernelManager: manager,
    computeProvider: () => computeStatus({ env: environment, refresh: true })
  });
  const ready = await launched.ready;
  const cellResponse = await fetch(
    ready.url + '/api/kernels/python/cells/' + encodeURIComponent(second.cell.manifest.cell_id)
  );
  const cell = await cellResponse.json();
  const artifact = cell.cell?.artifacts?.[0] ?? null;
  const artifactResponse = artifact ? await fetch(ready.url + artifact.url) : null;
  const artifactBytes = artifactResponse ? (await artifactResponse.arrayBuffer()).byteLength : 0;
  const state = await (await fetch(ready.url + '/api/state')).json();
  const cudaVariable = first.cell.result.variables.find((item) => item.name === 'cuda_available');

  await closeServer(launched.server);
  launched = null;

  const report = {
    schema_version: 1,
    project,
    sciencecode_home: scienceCodeHome,
    runtime_source: first.cell.manifest.runtime.source,
    python: first.cell.manifest.runtime.language_version,
    cuda_available: cudaVariable?.repr === 'True',
    first_result: first.cell.result.result.repr,
    second_result: second.cell.result.result.repr,
    dependencies: first.cell.result.dependencies,
    figure: {
      count: cell.cell?.artifacts?.length ?? 0,
      status: artifactResponse?.status ?? null,
      bytes: artifactBytes
    },
    kernel_verified: verifyKernel(project, 'python').ok,
    project_verified: verifyProject(project).ok,
    live_kernel_count_during_lab: state.counts.live_kernels,
    live_after_shutdown: manager.status('python').live,
    lock_after_shutdown: fs.existsSync(path.join(
      project, '.sciencecode', 'kernels', 'kernel-python', 'kernel.lock'
    ))
  };
  report.ok = report.runtime_source === 'sciencecode-compute' &&
    report.figure.count > 0 &&
    report.figure.status === 200 &&
    report.figure.bytes > 100 &&
    report.kernel_verified &&
    report.project_verified &&
    report.live_kernel_count_during_lab === 1 &&
    !report.live_after_shutdown &&
    !report.lock_after_shutdown &&
    (!options.requireCuda || report.cuda_available);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  await closeServer(launched?.server);
  manager.shutdownAll('live_smoke_failed');
  process.stderr.write('ScienceCode live kernel smoke failed: ' + error.stack + '\n');
  process.exitCode = 1;
}
