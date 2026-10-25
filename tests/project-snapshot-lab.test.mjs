import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLab } from '../lib/core.js';
import { runCommand } from '../lib/process.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const computeProvider = () => ({
  ok: true,
  gpu: { available: false, devices: [] },
  npu: { available: false, devices: [] },
  runtimes: {}
});

function mutation(base, pathname, body, {
  origin = base,
  contentType = 'application/json'
} = {}) {
  const headers = { Origin: origin };
  if (contentType) headers['Content-Type'] = contentType;
  return fetch(base + pathname, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function waitFor(base, jobId, statuses, timeout = 15_000) {
  const expected = new Set(statuses);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await fetch(base + '/api/jobs/' + encodeURIComponent(jobId));
    const job = await response.json();
    if (expected.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for snapshot job: ' + [...expected].join(', '));
}

test('Lab creates, lists, downloads, and strictly verifies project snapshots', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-snapshot-lab-'));
  fs.writeFileSync(path.join(directory, 'data.txt'), 'baseline\n');
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const initial = await (await fetch(details.url + '/api/state')).json();
  assert.equal(initial.counts.project_snapshots, 0);
  assert.equal(initial.project_snapshot_job, null);

  assert.equal((await mutation(details.url, '/api/project-snapshots', {}, {
    origin: 'https://untrusted.example'
  })).status, 403);
  assert.equal((await mutation(details.url, '/api/project-snapshots', {}, {
    contentType: null
  })).status, 415);
  const unknown = await mutation(details.url, '/api/project-snapshots', {
    name: 'not accepted'
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'INVALID_PROJECT_SNAPSHOT_REQUEST');

  const response = await mutation(details.url, '/api/project-snapshots', {});
  assert.equal(response.status, 202);
  const launchedJob = await response.json();
  assert.equal(launchedJob.kind, 'snapshot');
  assert.equal(launchedJob.operation, 'create');
  assert.match(launchedJob.snapshot_id, /^snapshot-/);
  assert.equal(launchedJob.can_cancel, true);
  const completed = await waitFor(details.url, launchedJob.job_id, ['completed']);
  assert.equal(completed.result.ok, true);
  assert.equal(completed.result.operation, 'create');
  assert.ok(Array.isArray(completed.result.findings));
  assert.match(completed.result.anchors.snapshot_sha256, /^[a-f0-9]{64}$/);

  const listResponse = await fetch(details.url + '/api/project-snapshots');
  assert.equal(listResponse.status, 200);
  const listing = await listResponse.json();
  assert.equal(listing.summary.total, 1);
  assert.equal(listing.snapshots[0].snapshot_id, launchedJob.snapshot_id);
  assert.equal(listing.snapshots[0].status, 'recorded');

  const download = await fetch(
    details.url + '/project-snapshot/' + encodeURIComponent(launchedJob.snapshot_id)
  );
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const exact = await download.json();
  assert.equal(exact.algorithm, 'sha256');
  assert.equal(exact.files['data.txt'].bytes, 9);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.project_snapshots, 1);
  assert.equal(state.project_snapshot_job.job_id, launchedJob.job_id);
  assert.equal(state.project_snapshot_job.result.ok, true);
  assert.equal(Object.hasOwn(state.project_snapshot_job.result, 'findings'), false);

  fs.writeFileSync(path.join(directory, 'added.txt'), 'later\n');
  const relaxedResponse = await mutation(
    details.url,
    '/api/project-snapshots/' + encodeURIComponent(launchedJob.snapshot_id) +
      '/verifications',
    { strict: false }
  );
  assert.equal(relaxedResponse.status, 202);
  const relaxed = await waitFor(
    details.url,
    (await relaxedResponse.json()).job_id,
    ['completed']
  );
  assert.equal(relaxed.result.ok, true);
  assert.equal(relaxed.result.summary.added, 0);

  const strictResponse = await mutation(
    details.url,
    '/api/project-snapshots/' + encodeURIComponent(launchedJob.snapshot_id) +
      '/verifications',
    { strict: true }
  );
  const strict = await waitFor(
    details.url,
    (await strictResponse.json()).job_id,
    ['completed']
  );
  assert.equal(strict.result.ok, false);
  assert.equal(strict.result.record_integrity.ok, true);
  assert.equal(strict.result.summary.added, 1);
  assert.ok(strict.result.findings.some((finding) =>
    finding.category === 'added' && finding.file === 'added.txt'));

  const absent = await mutation(
    details.url,
    '/api/project-snapshots/snapshot-absent/verifications',
    { strict: true }
  );
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).error.code, 'PROJECT_SNAPSHOT_NOT_FOUND');
  const invalid = await mutation(
    details.url,
    '/api/project-snapshots/%2Foutside/verifications',
    { strict: true }
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_PROJECT_SNAPSHOT_ID');

  const asset = await fetch(details.url + '/reproducibility.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /renderReproducibilityWorkspace/);
});

test('Lab snapshot jobs are single-flight, responsive, binding-safe, cancellable, and reusable', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-snapshot-cancel-'));
  fs.writeFileSync(path.join(directory, 'data.txt'), 'baseline\n');
  let calls = 0;
  const snapshotWorkerRunner = (command, args, options) => {
    calls += 1;
    if (calls > 1) return runCommand(command, args, options);
    assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    assert.equal(options.timeout, 5 * 60_000);
    const workerRequest = JSON.parse(
      Buffer.from(args[1], 'base64url').toString('utf8')
    );
    const snapshotDirectory = path.join(directory, '.sciencecode', 'snapshots');
    fs.mkdirSync(snapshotDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(snapshotDirectory, '.pending-' + workerRequest.snapshot_id + '.json'),
      '{"partial":true}\n'
    );
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
    snapshotWorkerRunner
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const firstResponse = await mutation(details.url, '/api/project-snapshots', {});
  assert.equal(firstResponse.status, 202);
  const first = await firstResponse.json();
  await waitFor(details.url, first.job_id, ['running']);

  const stateStarted = Date.now();
  const state = await (await fetch(details.url + '/api/state')).json();
  assert.ok(Date.now() - stateStarted < 1_500);
  assert.equal(state.project_snapshot_job.status, 'running');
  assert.ok(state.harness.running_jobs >= 1);

  const busy = await mutation(details.url, '/api/project-snapshots', {});
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, 'PROJECT_SNAPSHOT_BUSY');

  const cancelUrl = details.url + '/api/jobs/' +
    encodeURIComponent(first.job_id) + '/cancel';
  const mismatch = await mutation(
    details.url,
    '/api/jobs/' + encodeURIComponent(first.job_id) + '/cancel',
    { kind: 'snapshot', snapshot_id: 'snapshot-wrong', operation: 'create' }
  );
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, 'JOB_BINDING_MISMATCH');

  const cancellation = await fetch(cancelUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: details.url },
    body: JSON.stringify({
      kind: 'snapshot',
      snapshot_id: first.snapshot_id,
      operation: 'create'
    })
  });
  assert.equal(cancellation.status, 202);
  assert.equal((await cancellation.json()).status, 'cancelling');
  const cancelled = await waitFor(details.url, first.job_id, ['cancelled']);
  assert.equal(cancelled.result, null);
  assert.ok(cancelled.events.some((event) =>
    event.type === 'snapshot.cancel_requested'));
  assert.ok(cancelled.events.some((event) => event.type === 'snapshot.cancelled'));
  assert.deepEqual(
    fs.readdirSync(path.join(directory, '.sciencecode', 'snapshots')),
    [],
    'cancelled capture removes only its exact uncommitted pending file'
  );

  const secondResponse = await mutation(details.url, '/api/project-snapshots', {});
  assert.equal(secondResponse.status, 202);
  const second = await secondResponse.json();
  const completed = await waitFor(details.url, second.job_id, ['completed']);
  assert.equal(completed.result.ok, true);
  assert.notEqual(second.snapshot_id, first.snapshot_id);
  assert.equal((await (await fetch(details.url + '/api/project-snapshots')).json())
    .summary.total, 1);
});
