import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAudit, buildProjectGateReport, startLab } from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const computeProvider = () => ({
  ok: true,
  gpu: { available: false, devices: [] },
  npu: { available: false, devices: [] },
  runtimes: {}
});

function mutation(url, body, { origin = url, contentType = 'application/json' } = {}) {
  const headers = { Origin: origin };
  if (contentType) headers['Content-Type'] = contentType;
  return fetch(url + '/api/project-gates', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function waitFor(url, jobId, statuses, timeout = 10_000) {
  const expected = new Set(statuses);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await fetch(url + '/api/jobs/' + encodeURIComponent(jobId));
    const job = await response.json();
    if (expected.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for project gate: ' + [...expected].join(', '));
}

test('Lab runs the authoritative project gate with strict mutation and compact-state contracts', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-gate-lab-'));
  appendAudit(directory, { type: 'gate.fixture' });
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const crossOrigin = await mutation(details.url, {}, {
    origin: 'https://untrusted.example'
  });
  assert.equal(crossOrigin.status, 403);
  const wrongMedia = await mutation(details.url, {}, { contentType: null });
  assert.equal(wrongMedia.status, 415);
  const unknown = await mutation(details.url, { surprise: true });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'INVALID_PROJECT_GATE_REQUEST');
  assert.equal((await mutation(details.url, { allow_failed_runs: 'yes' })).status, 400);
  assert.equal((await mutation(details.url, { allowFailedRuns: true })).status, 400);

  const response = await mutation(details.url, {});
  assert.equal(response.status, 202);
  const launchedJob = await response.json();
  assert.equal(launchedJob.kind, 'gate');
  assert.equal(launchedJob.operation, 'verify');
  assert.equal(launchedJob.can_cancel, true);
  const completed = await waitFor(details.url, launchedJob.job_id, ['completed']);
  assert.equal(completed.result.ok, true);
  assert.equal(completed.result.schema_version, 1);
  assert.ok(Array.isArray(completed.result.issues));

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.project_gate_job.job_id, launchedJob.job_id);
  assert.equal(state.project_gate_job.status, 'completed');
  assert.equal(state.project_gate_job.result.ok, true);
  assert.equal(Object.hasOwn(state.project_gate_job.result, 'issues'), false);
  assert.equal(Object.hasOwn(state.project_gate_job.result, 'counts'), false);

  const auditFile = path.join(directory, '.sciencecode', 'audit', 'events.jsonl');
  fs.writeFileSync(
    auditFile,
    fs.readFileSync(auditFile, 'utf8').replace('gate.fixture', 'gate.tampered')
  );
  const blockedResponse = await mutation(details.url, {});
  assert.equal(blockedResponse.status, 202);
  const blockedLaunch = await blockedResponse.json();
  const blocked = await waitFor(details.url, blockedLaunch.job_id, ['completed']);
  assert.equal(blocked.result.ok, false);
  assert.ok(blocked.result.summary.integrity_blockers > 0);
  assert.ok(blocked.result.issues.some((issue) => issue.category === 'integrity'));

  const asset = await fetch(details.url + '/verification.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /renderVerificationWorkspace/);
});

test('Lab gate is single-flight, binding-safe, cancellable, and reusable after cancellation', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-gate-cancel-'));
  let calls = 0;
  const gateWorkerRunner = (_command, _args, options) => {
    calls += 1;
    if (calls > 1) {
      return Promise.resolve({
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          ok: true,
          report: buildProjectGateReport(directory)
        }),
        stderr: '',
        error: null,
        aborted: false
      });
    }
    return new Promise((resolve) => {
      options.signal.addEventListener('abort', () => resolve({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('Command cancelled.'), { code: 'ABORT_ERR' }),
        aborted: true
      }), { once: true });
    });
  };
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider,
    gateWorkerRunner
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const initialState = await (await fetch(details.url + '/api/state')).json();
  assert.equal(initialState.project_gate_job, null);

  const firstResponse = await mutation(details.url, {});
  assert.equal(firstResponse.status, 202);
  const first = await firstResponse.json();
  await waitFor(details.url, first.job_id, ['running']);

  const stateStarted = Date.now();
  const runningState = await (await fetch(details.url + '/api/state')).json();
  assert.ok(Date.now() - stateStarted < 1_500);
  assert.equal(runningState.project_gate_job.status, 'running');
  assert.ok(runningState.harness.running_jobs >= 1);

  const busy = await mutation(details.url, {});
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, 'PROJECT_GATE_BUSY');

  const cancelUrl = details.url + '/api/jobs/' + encodeURIComponent(first.job_id) + '/cancel';
  const mismatch = await fetch(cancelUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: details.url },
    body: JSON.stringify({ kind: 'simulation' })
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, 'JOB_BINDING_MISMATCH');

  const cancellation = await fetch(cancelUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: details.url },
    body: JSON.stringify({ kind: 'gate' })
  });
  assert.equal(cancellation.status, 202);
  assert.equal((await cancellation.json()).status, 'cancelling');
  const cancelled = await waitFor(details.url, first.job_id, ['cancelled']);
  assert.equal(cancelled.result, null);
  assert.ok(cancelled.events.some((event) => event.type === 'gate.cancel_requested'));
  assert.ok(cancelled.events.some((event) => event.type === 'gate.cancelled'));

  const secondResponse = await mutation(details.url, {
    allow_failed_runs: true
  });
  assert.equal(secondResponse.status, 202);
  const second = await secondResponse.json();
  const completed = await waitFor(details.url, second.job_id, ['completed']);
  assert.equal(completed.result.ok, true);
  assert.equal(completed.request.allow_failed_runs, true);
});
