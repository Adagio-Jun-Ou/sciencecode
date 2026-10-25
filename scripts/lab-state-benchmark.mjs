import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { startLab } from '../lib/lab.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '..');
const argumentsList = process.argv.slice(2);
const skipComputeIndex = argumentsList.indexOf('--skip-compute');
const skipCompute = skipComputeIndex >= 0;
if (skipCompute) argumentsList.splice(skipComputeIndex, 1);
const project = path.resolve(argumentsList[0] ?? process.cwd());
const runs = Number(argumentsList[1] ?? 3);

if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
  throw new Error('Benchmark runs must be an integer from 1 through 20.');
}

const computeProvider = skipCompute
  ? () => ({
      ok: false,
      skipped: true,
      gpu: { available: false, devices: [], error: 'benchmark_skip' },
      npu: { available: false, devices: [], error: 'benchmark_skip' },
      runtime: null,
      runtimes: {},
      capabilities: {}
    })
  : undefined;
const launched = startLab({
  cwd: project,
  packageRoot,
  port: 0,
  ...(computeProvider ? { computeProvider } : {})
});
const details = await launched.ready;
const samples = [];
const summarizeCounts = (counts = {}) => Object.fromEntries([
  'simulations',
  'cad_projects',
  'cad_builds',
  'inferences',
  'experiments',
  'evidence',
  'chats',
  'figure_comparisons',
  'semantic_reviews',
  'procedures'
].map((name) => [name, counts[name] ?? 0]));

try {
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const response = await fetch(details.url + '/api/state');
    const text = await response.text();
    const elapsed = performance.now() - started;
    let state = null;
    try { state = JSON.parse(text); } catch { /* reported below */ }
    samples.push({
      run: index + 1,
      status: response.status,
      elapsed_ms: Number(elapsed.toFixed(3)),
      response_bytes: Buffer.byteLength(text),
      cache_hit: state?.integrity_cache?.hit ?? null,
      audit_ok: state?.audit?.ok ?? null,
      audit_records: state?.audit?.count ?? null,
      counts: state ? summarizeCounts(state.counts) : null,
      error: state?.error ?? (state ? null : { message: 'invalid_json_response' })
    });
  }
} finally {
  await new Promise((resolve) => launched.server.close(resolve));
}

const warm = samples.slice(1).map((sample) => sample.elapsed_ms);
const mean = (values) => values.length
  ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3))
  : null;
const output = {
  schema_version: 1,
  project,
  runs,
  compute_probe: skipCompute ? 'skipped' : 'enabled',
  cold_ms: samples[0]?.elapsed_ms ?? null,
  warm: warm.length ? {
    minimum_ms: Math.min(...warm),
    mean_ms: mean(warm),
    maximum_ms: Math.max(...warm)
  } : null,
  samples
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
if (samples.some((sample) => sample.status !== 200 || sample.audit_ok !== true)) {
  process.exitCode = 1;
}
