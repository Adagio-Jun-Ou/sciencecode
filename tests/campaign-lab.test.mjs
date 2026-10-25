import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatSession,
  getChatSession,
  listChats,
  listInteractions,
  sendChatMessageAsync,
  startLab,
  verifyCampaign,
  verifyChat
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function plan(title = 'Lab campaign') {
  return {
    title,
    question: 'Can the bounded recorded evidence distinguish the candidate from the null?',
    context: 'Use only local recorded evidence and computations.',
    context_of_use: 'Exploratory prioritization; no physical or clinical decision.',
    classification: 'exploratory',
    hypotheses: [
      {
        id: 'candidate',
        statement: 'The candidate exceeds the baseline.',
        rationale: 'A preliminary recorded observation motivates evaluation.',
        falsification: 'The verified result does not exceed the baseline.',
        priority: 4,
        parent_id: null,
        relation: 'root',
        budget: {
          max_task_attempts: 1,
          max_gpu_tasks: 0,
          max_npu_tasks: 0
        }
      },
      {
        id: 'null',
        statement: 'The candidate does not exceed the baseline.',
        rationale: 'The preliminary observation may be noise.',
        falsification: 'The verified result exceeds the baseline.',
        priority: 4,
        parent_id: 'candidate',
        relation: 'alternative',
        budget: {
          max_task_attempts: 1,
          max_gpu_tasks: 0,
          max_npu_tasks: 0
        }
      }
    ],
    tasks: [{
      id: 'bounded-review',
      title: 'Bounded evidence review',
      objective: 'Review the local evidence and report a falsification-aware comparison.',
      lane: 'reviewer',
      hypothesis_ids: ['candidate', 'null'],
      depends_on: [],
      expected_outputs: ['Evidence record IDs', 'Falsification-aware verdict'],
      checkpoint: true,
      compute: 'cpu',
      risk: 'low',
      max_attempts: 1
    }],
    budget: {
      max_task_attempts: 1,
      max_gpu_tasks: 0,
      max_npu_tasks: 0,
      max_wall_clock_seconds: 3600
    },
    hypothesis_policy: {
      require_final_assessment: true,
      human_adjudication: true,
      automatic_pruning: false
    },
    execution_policy: {
      network: 'disabled',
      physical_execution: 'disabled',
      artifact_scope: 'project_only',
      ai_disclosure: true
    }
  };
}

function compute() {
  return {
    ok: true,
    gpu: { available: false, devices: [] },
    npu: { available: false, devices: [] },
    runtime: { healthy: false },
    runtimes: { gpu: { healthy: false }, npu: { healthy: false } },
    capabilities: {}
  };
}

async function waitFor(url, jobId, statuses) {
  let job;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await fetch(url + '/api/jobs/' + encodeURIComponent(jobId));
    assert.equal(response.status, 200);
    job = await response.json();
    if (statuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('campaign job did not reach ' + statuses.join(' or ') + ': ' + job?.status);
}

test('Lab creates, checkpoints, streams, serializes, and cancels bounded campaign tasks', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-campaign-lab-'));
  const chat = createChatSession({
    cwd: directory,
    title: 'Campaign Lab conversation',
    agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let runnerCalls = 0;
  const provider = {
    list({ cwd }) {
      return listChats(cwd);
    },
    get({ cwd, chatId: requested }) {
      return {
        ...getChatSession(cwd, requested),
        verification: verifyChat(cwd, requested)
      };
    },
    sendAsync(options) {
      return sendChatMessageAsync({
        ...options,
        opencode: process.execPath,
        scienceCodeHome: path.join(directory, '.engine-home'),
        async runner(command, args, runOptions) {
          runnerCalls += 1;
          if (runnerCalls === 1) {
            await firstGate;
            const output = [
              JSON.stringify({
                type: 'step_start',
                sessionID: 'ses_campaign_lab',
                part: { type: 'step-start' }
              }),
              JSON.stringify({
                type: 'text',
                sessionID: 'ses_campaign_lab',
                part: {
                  type: 'text',
                  text: 'Bounded campaign evidence review completed.'
                }
              }),
              JSON.stringify({
                type: 'step_finish',
                sessionID: 'ses_campaign_lab',
                part: { type: 'step-finish' }
              })
            ].join('\n') + '\n';
            runOptions.onStdout(output);
            return {
              status: 0,
              signal: null,
              stderr: '',
              stdout: output,
              error: null,
              aborted: false
            };
          }
          const partial = [
            JSON.stringify({
              type: 'step_start',
              sessionID: 'ses_campaign_cancel',
              part: { type: 'step-start' }
            }),
            JSON.stringify({
              type: 'text',
              sessionID: 'ses_campaign_cancel',
              part: {
                type: 'text',
                text: 'Partial campaign review; incomplete because the user stopped it.'
              }
            })
          ].join('\n') + '\n';
          runOptions.onStdout(partial);
          await new Promise((resolve, reject) => {
            if (runOptions.signal.aborted) return resolve();
            const timeout = setTimeout(
              () => reject(new Error('campaign cancellation signal was not delivered')),
              5_000
            );
            runOptions.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
          return {
            status: null,
            signal: 'SIGTERM',
            stderr: '',
            stdout: partial,
            error: null,
            aborted: true
          };
        }
      });
    }
  };
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => compute(),
    chatProvider: provider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const mutate = (pathname, body, origin = details.url) => fetch(details.url + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Prefer: 'respond-async'
    },
    body: JSON.stringify(body)
  });

  const crossOrigin = await mutate('/api/campaigns', {
    spec: plan(),
    chat_id: chatId
  }, 'https://untrusted.example');
  assert.equal(crossOrigin.status, 403);
  const unknown = await mutate('/api/campaigns', {
    spec: plan(),
    chat_id: chatId,
    command: 'arbitrary'
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'INVALID_CAMPAIGN');

  const createResponse = await mutate('/api/campaigns', {
    spec: plan(),
    chat_id: chatId,
    note: 'Create a human-supervised campaign.'
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  const campaignId = created.campaign.manifest.campaign_id;
  assert.equal(created.campaign.state.status, 'waiting_checkpoint');
  assert.equal(created.campaign.verification.ok, true);
  assert.ok(created.interaction.interaction_id);

  const earlyAdvance = await mutate(
    '/api/campaigns/' + encodeURIComponent(campaignId) + '/advance',
    { task_id: 'bounded-review' }
  );
  assert.equal(earlyAdvance.status, 409);
  assert.equal((await earlyAdvance.json()).error.code, 'CAMPAIGN_CHECKPOINT_REQUIRED');

  const decisionResponse = await mutate(
    '/api/campaigns/' + encodeURIComponent(campaignId) + '/decisions',
    {
      task_id: 'bounded-review',
      decision: 'approved',
      note: 'Approve exactly one bounded review.'
    }
  );
  assert.equal(decisionResponse.status, 201);
  const decision = await decisionResponse.json();
  assert.equal(decision.campaign.state.status, 'ready');
  assert.equal(decision.event.type, 'checkpoint.decision');

  const launchResponse = await mutate(
    '/api/campaigns/' + encodeURIComponent(campaignId) + '/advance',
    { task_id: 'bounded-review' }
  );
  assert.equal(launchResponse.status, 202);
  const started = await launchResponse.json();
  assert.equal(started.kind, 'campaign');
  assert.equal(started.campaign_id, campaignId);
  assert.equal(started.task_id, 'bounded-review');
  assert.equal(started.request.risk, 'low');
  const running = await waitFor(details.url, started.job_id, ['running']);
  assert.equal(running.response.complete, false);

  const runningDetail = await (await fetch(
    details.url + '/api/campaigns/' + encodeURIComponent(campaignId)
  )).json();
  assert.equal(runningDetail.state.status, 'running');
  assert.equal(runningDetail.verification.ok, true);

  const competing = await mutate(
    '/api/campaigns/' + encodeURIComponent(campaignId) + '/advance',
    { task_id: 'bounded-review' }
  );
  assert.equal(competing.status, 409);
  assert.equal((await competing.json()).error.code, 'CAMPAIGN_BUSY');

  releaseFirst();
  const completed = await waitFor(details.url, started.job_id, ['completed']);
  assert.equal(completed.result.status, 'completed');
  assert.equal(completed.result.campaign_status, 'waiting_hypothesis');
  assert.equal(completed.response.retained_block_count, 1);
  assert.match(completed.response.blocks[0].content, /Bounded campaign evidence/);
  assert.ok(completed.events.some((event) => event.type === 'campaign.task.started'));
  assert.ok(completed.events.some((event) => event.type === 'campaign.task.finished'));
  assert.ok(completed.interaction_id);
  assert.equal(verifyCampaign(directory, campaignId).ok, true);

  const assessmentPath = (hypothesisId) =>
    '/api/campaigns/' + encodeURIComponent(campaignId) +
    '/hypotheses/' + encodeURIComponent(hypothesisId) + '/assessments';
  const crossOriginAssessment = await mutate(assessmentPath('candidate'), {
    verdict: 'supported',
    decision: 'continue',
    rationale: 'This cross-origin request must not be accepted.',
    task_ids: ['bounded-review']
  }, 'https://untrusted.example');
  assert.equal(crossOriginAssessment.status, 403);
  const invalidAssessment = await mutate(assessmentPath('candidate'), {
    verdict: 'certain',
    decision: 'continue',
    rationale: 'Invalid scientific certainty.',
    task_ids: ['bounded-review']
  });
  assert.equal(invalidAssessment.status, 400);
  const candidateAssessment = await mutate(assessmentPath('candidate'), {
    verdict: 'supported',
    decision: 'continue',
    rationale: 'The completed bounded review supports continued exploration.',
    task_ids: ['bounded-review']
  });
  assert.equal(candidateAssessment.status, 201);
  const candidateResult = await candidateAssessment.json();
  assert.equal(candidateResult.event.type, 'hypothesis.assessed');
  assert.equal(candidateResult.event.payload.ai_generated, false);
  assert.equal(candidateResult.campaign.state.status, 'waiting_hypothesis');
  assert.ok(candidateResult.interaction.interaction_id);
  const nullAssessment = await mutate(assessmentPath('null'), {
    verdict: 'challenged',
    decision: 'prune',
    rationale: 'The same completed review challenges the null branch.',
    task_ids: ['bounded-review']
  });
  assert.equal(nullAssessment.status, 201);
  const nullResult = await nullAssessment.json();
  assert.equal(nullResult.campaign.state.status, 'completed');
  assert.equal(nullResult.campaign.state.hypothesis_counts.assessed, 2);
  assert.equal(nullResult.campaign.verification.ok, true);

  const collection = await (await fetch(details.url + '/api/campaigns')).json();
  assert.equal(collection.summary.count, 1);
  assert.equal(collection.summary.completed, 1);
  assert.equal(collection.summary.hypotheses_requiring_assessment, 0);
  assert.equal(collection.summary.stale_hypothesis_assessments, 0);
  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.campaigns, 1);
  assert.equal(state.counts.completed_campaigns, 1);
  assert.equal(state.counts.assessed_campaign_hypotheses, 2);
  assert.equal(state.counts.current_campaign_hypothesis_assessments, 2);
  assert.equal(state.counts.stale_campaign_hypothesis_assessments, 0);
  assert.equal(state.campaign_jobs.length, 0);
  assert.equal(listInteractions(directory, chatId).length, 5);

  const secondCreate = await (await mutate('/api/campaigns', {
    spec: plan('Cancelled Lab campaign'),
    chat_id: chatId
  })).json();
  const secondId = secondCreate.campaign.manifest.campaign_id;
  await mutate('/api/campaigns/' + encodeURIComponent(secondId) + '/decisions', {
    task_id: 'bounded-review',
    decision: 'approved',
    note: 'Approve the cancellable task.'
  });
  const secondLaunch = await (await mutate(
    '/api/campaigns/' + encodeURIComponent(secondId) + '/advance',
    { task_id: 'bounded-review' }
  )).json();
  await waitFor(details.url, secondLaunch.job_id, ['running']);
  const cancelPath = '/api/jobs/' + encodeURIComponent(secondLaunch.job_id) + '/cancel';
  const mismatch = await mutate(cancelPath, {
    kind: 'campaign',
    campaign_id: secondId,
    task_id: 'wrong-task',
    chat_id: chatId
  });
  assert.equal(mismatch.status, 409);
  const cancelResponse = await mutate(cancelPath, {
    kind: 'campaign',
    campaign_id: secondId,
    task_id: 'bounded-review',
    chat_id: chatId
  });
  assert.equal(cancelResponse.status, 202);
  const cancelling = await cancelResponse.json();
  assert.equal(cancelling.status, 'cancelling');
  assert.ok(cancelling.cancellation_interaction_id);
  const cancelled = await waitFor(details.url, secondLaunch.job_id, ['cancelled']);
  assert.equal(cancelled.result.status, 'cancelled');
  assert.match(cancelled.response.blocks[0].content, /Partial campaign review/);
  assert.ok(cancelled.events.some((event) =>
    event.type === 'campaign.cancel_requested'
  ));
  const cancelledDetail = await (await fetch(
    details.url + '/api/campaigns/' + encodeURIComponent(secondId)
  )).json();
  assert.equal(cancelledDetail.state.tasks[0].status, 'failed');
  assert.equal(cancelledDetail.state.tasks[0].attempts[0].status, 'cancelled');
  assert.equal(cancelledDetail.verification.ok, true);
});
