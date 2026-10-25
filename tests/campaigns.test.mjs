import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHarnessView,
  buildLineageGraph,
  createCampaign,
  createChatSession,
  getCampaign,
  getChatSession,
  normalizeCampaignSpec,
  recordCampaignDecision,
  recordHypothesisAssessment,
  runCampaignTask,
  verifyCampaign,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-campaign-'));
  const configDir = path.join(directory, 'config');
  fs.mkdirSync(configDir);
  const chat = createChatSession({
    cwd: directory,
    title: 'Bounded discovery campaign',
    agent: 'scientist'
  });
  return {
    directory,
    configDir,
    scienceCodeHome: path.join(directory, '.engine-home'),
    chatId: chat.manifest.chat_id
  };
}

function spec(overrides = {}) {
  return {
    title: 'Candidate evidence campaign',
    question: 'Does candidate A outperform the recorded baseline under the stated context?',
    context: 'All claims must come from project evidence or explicitly recorded computations.',
    context_of_use: 'Exploratory prioritization only; not a clinical or regulatory decision.',
    classification: 'exploratory',
    hypotheses: [
      {
        id: 'candidate-benefit',
        statement: 'Candidate A improves the primary score.',
        rationale: 'A preliminary mechanistic result suggests a measurable effect.',
        falsification: 'The verified score is not greater than the recorded baseline.',
        priority: 5,
        parent_id: null,
        relation: 'root',
        budget: {
          max_task_attempts: 4,
          max_gpu_tasks: 0,
          max_npu_tasks: 1
        }
      },
      {
        id: 'null-effect',
        statement: 'Candidate A has no meaningful effect.',
        rationale: 'The preliminary result may reflect noise.',
        falsification: 'The verified score exceeds the prespecified margin.',
        priority: 4,
        parent_id: 'candidate-benefit',
        relation: 'alternative',
        budget: {
          max_task_attempts: 4,
          max_gpu_tasks: 0,
          max_npu_tasks: 1
        }
      }
    ],
    tasks: [
      {
        id: 'evidence-map',
        title: 'Map the recorded evidence',
        objective: 'Build a bounded evidence table and identify conflicts relevant to both hypotheses.',
        lane: 'literature',
        hypothesis_ids: ['candidate-benefit', 'null-effect'],
        depends_on: [],
        expected_outputs: ['Evidence table with record IDs', 'Explicit evidence gaps'],
        checkpoint: true,
        compute: 'cpu',
        risk: 'low',
        max_attempts: 1
      },
      {
        id: 'npu-score',
        title: 'Score the candidate on the NPU',
        objective: 'Use only a recorded ScienceCode inference and compare it with the stated baseline.',
        lane: 'compute',
        hypothesis_ids: ['candidate-benefit', 'null-effect'],
        depends_on: ['evidence-map'],
        expected_outputs: ['Verified inference record ID', 'Falsification comparison'],
        checkpoint: true,
        compute: 'npu',
        risk: 'moderate',
        max_attempts: 1
      },
      {
        id: 'adversarial-review',
        title: 'Challenge the result',
        objective: 'Review the prior recorded outputs for unsupported claims and alternative explanations.',
        lane: 'reviewer',
        hypothesis_ids: ['candidate-benefit', 'null-effect'],
        depends_on: ['npu-score'],
        expected_outputs: ['Claim-level findings', 'Recommendation with limitations'],
        checkpoint: false,
        compute: 'cpu',
        risk: 'low',
        max_attempts: 1
      }
    ],
    budget: {
      max_task_attempts: 4,
      max_gpu_tasks: 0,
      max_npu_tasks: 1,
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
    },
    ...overrides
  };
}

function legacySpec() {
  const value = spec();
  delete value.hypothesis_policy;
  value.hypotheses = value.hypotheses.map((hypothesis) => {
    const legacy = { ...hypothesis };
    delete legacy.parent_id;
    delete legacy.relation;
    delete legacy.budget;
    return legacy;
  });
  return value;
}

function engineRunner(calls, { failAt = null } = {}) {
  return (command, args) => {
    const dispatch = calls.length + 1;
    calls.push({ command, args: [...args] });
    if (dispatch === failAt) {
      return {
        status: 7,
        signal: null,
        stdout: '',
        stderr: 'bounded test failure\n'
      };
    }
    return {
      status: 0,
      signal: null,
      stderr: '',
      stdout: [
        JSON.stringify({
          type: 'step_start',
          sessionID: 'ses_campaign',
          part: { type: 'step-start' }
        }),
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_campaign',
          part: {
            type: 'text',
            text: 'Recorded bounded campaign result ' + dispatch
          }
        }),
        JSON.stringify({
          type: 'step_finish',
          sessionID: 'ses_campaign',
          part: { type: 'step-finish' }
        })
      ].join('\n') + '\n'
    };
  };
}

function runOptions(fixtureValue, campaignId, calls, taskId, runnerOptions = {}) {
  return {
    cwd: fixtureValue.directory,
    campaignId,
    taskId,
    packageRoot,
    configDir: fixtureValue.configDir,
    scienceCodeHome: fixtureValue.scienceCodeHome,
    opencode: process.execPath,
    runner: engineRunner(calls, runnerOptions)
  };
}

test('campaigns execute one approved task at a time through a hash-chained Scientist transcript', () => {
  const value = fixture();
  const created = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: spec()
  });
  const id = created.manifest.campaign_id;
  const initial = getCampaign(value.directory, id);
  assert.equal(initial.verification.ok, true);
  assert.equal(initial.state.status, 'waiting_checkpoint');
  assert.equal(initial.state.tasks[0].status, 'awaiting_approval');
  assert.equal(initial.state.tasks[1].status, 'blocked');
  assert.equal(initial.plan.execution_policy.enforcement.network,
    'prompt_policy_not_an_os_sandbox');
  assert.throws(
    () => runCampaignTask(runOptions(value, id, [], 'evidence-map')),
    { code: 'CAMPAIGN_CHECKPOINT_REQUIRED' }
  );

  const calls = [];
  recordCampaignDecision({
    cwd: value.directory,
    campaignId: id,
    taskId: 'evidence-map',
    decision: 'approved',
    note: 'Proceed with the bounded evidence map.'
  });
  const first = runCampaignTask(runOptions(value, id, calls, 'evidence-map'));
  assert.equal(first.status, 'completed');
  assert.equal(first.turn.turn_index, 1);
  assert.match(first.turn.user.text, /Execute exactly this one approved task/);
  assert.match(first.turn.user.text, /Network policy: disabled/);
  assert.match(first.turn.user.text, /A human must explicitly advance/);
  assert.doesNotMatch(first.turn.user.text, /Score the candidate on the NPU/);

  const afterFirst = getCampaign(value.directory, id);
  assert.equal(afterFirst.state.status, 'waiting_checkpoint');
  assert.equal(afterFirst.state.tasks[0].status, 'completed');
  assert.equal(afterFirst.state.tasks[1].status, 'awaiting_approval');
  assert.equal(afterFirst.state.tasks[2].status, 'blocked');

  recordCampaignDecision({
    cwd: value.directory,
    campaignId: id,
    taskId: 'npu-score',
    decision: 'approved',
    note: 'Use the one permitted NPU task.'
  });
  const second = runCampaignTask(runOptions(value, id, calls, 'npu-score'));
  assert.equal(second.status, 'completed');
  const afterSecond = getCampaign(value.directory, id);
  assert.equal(afterSecond.state.tasks[2].status, 'ready');
  assert.equal(afterSecond.state.budget.used_npu_tasks, 1);

  const third = runCampaignTask(runOptions(value, id, calls, 'adversarial-review'));
  assert.equal(third.status, 'completed');
  const awaitingAssessment = getCampaign(value.directory, id);
  assert.equal(awaitingAssessment.state.status, 'waiting_hypothesis');
  assert.equal(awaitingAssessment.state.hypothesis_counts.assessment_required, 2);
  const leadingAssessment = recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'candidate-benefit',
    verdict: 'supported',
    decision: 'pause',
    rationale: 'All three tasks are complete, but pause before committing the branch.',
    taskIds: ['evidence-map', 'npu-score', 'adversarial-review']
  });
  assert.equal(leadingAssessment.payload.human_checkpoint, true);
  const pausedAfterWork = getCampaign(value.directory, id);
  assert.equal(pausedAfterWork.state.status, 'waiting_hypothesis');
  assert.equal(pausedAfterWork.state.next_hypothesis.hypothesis_id,
    'candidate-benefit');
  const continuedAssessment = recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'candidate-benefit',
    verdict: 'supported',
    decision: 'continue',
    rationale: 'The user resolves the pause and continues this supported branch.',
    taskIds: ['evidence-map', 'npu-score', 'adversarial-review']
  });
  assert.equal(continuedAssessment.payload.supersedes_event_id,
    leadingAssessment.event_id);
  assert.equal(getCampaign(value.directory, id).state.status,
    'waiting_hypothesis');
  recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'null-effect',
    verdict: 'challenged',
    decision: 'prune',
    rationale: 'The completed comparison and adversarial review challenge the null branch.',
    taskIds: ['evidence-map', 'npu-score', 'adversarial-review']
  });
  const final = getCampaign(value.directory, id);
  assert.equal(final.state.status, 'completed');
  assert.deepEqual(final.state.counts, {
    ready: 0,
    awaiting_approval: 0,
    checkpoint_rejected: 0,
    running: 0,
    completed: 3,
    failed: 0,
    skipped: 0,
    blocked: 0,
    budget_exhausted: 0,
    branch_pruned: 0,
    branch_paused: 0
  });
  assert.equal(final.state.hypothesis_counts.assessed, 2);
  assert.equal(final.state.hypothesis_counts.supported, 1);
  assert.equal(final.state.hypothesis_counts.pruned, 1);
  assert.equal(final.events.length, 11);
  assert.equal(final.events[0].previous_event_sha256, null);
  for (let index = 1; index < final.events.length; index += 1) {
    assert.equal(final.events[index].previous_event_sha256,
      final.events[index - 1].event_sha256);
  }
  assert.equal(final.verification.ok, true);
  assert.equal(getChatSession(value.directory, value.chatId).manifest.turn_count, 3);
  const harness = buildHarnessView({
    cwd: value.directory,
    chat: {
      ...getChatSession(value.directory, value.chatId),
      verification: { ok: true, errors: [] }
    },
    compute: {
      gpu: { available: false },
      npu: { available: false },
      runtime: { healthy: false },
      runtimes: { gpu: { healthy: false }, npu: { healthy: false } },
      capabilities: {}
    }
  });
  const campaignBoard = harness.board.campaigns.find((campaign) =>
    campaign.campaign_id === id);
  assert.equal(campaignBoard.hypothesis_counts.assessed, 2);
  assert.equal(campaignBoard.hypotheses[1].state.decision, 'prune');
  assert.ok(campaignBoard.recent_events.some((event) =>
    event.type === 'hypothesis.assessed' &&
    event.hypothesis_id === 'candidate-benefit'));
  const lineage = buildLineageGraph(value.directory);
  const nullNode = lineage.nodes.find((node) =>
    node.type === 'hypothesis' && node.record_id === 'null-effect');
  assert.equal(nullNode.status, 'challenged');
  assert.equal(nullNode.metadata.effective_status, 'pruned');
  assert.ok(lineage.edges.some((edge) =>
    edge.relation === 'alternative' &&
    edge.target === nullNode.id));
  assert.equal(verifyProject(value.directory).ok, true);
});

test('failed campaign tasks preserve attempts and require a fresh checkpoint before retry', () => {
  const value = fixture();
  const retrySpec = spec({
    tasks: [{
      id: 'replicate',
      title: 'Replicate the score',
      objective: 'Run one bounded recorded calculation and report whether it replicated.',
      lane: 'compute',
      hypothesis_ids: ['candidate-benefit'],
      depends_on: [],
      expected_outputs: ['Recorded run ID', 'Replication verdict'],
      checkpoint: true,
      compute: 'cpu',
      risk: 'moderate',
      max_attempts: 2
    }],
    budget: {
      max_task_attempts: 2,
      max_gpu_tasks: 0,
      max_npu_tasks: 0,
      max_wall_clock_seconds: 3600
    }
  });
  const created = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: retrySpec
  });
  const id = created.manifest.campaign_id;
  recordCampaignDecision({
    cwd: value.directory,
    campaignId: id,
    taskId: 'replicate',
    decision: 'approved',
    note: 'Approve attempt one.'
  });
  const calls = [];
  const failed = runCampaignTask(runOptions(value, id, calls, 'replicate', { failAt: 1 }));
  assert.equal(failed.status, 'failed');
  const retry = getCampaign(value.directory, id);
  assert.equal(retry.state.status, 'waiting_checkpoint');
  assert.equal(retry.state.tasks[0].status, 'awaiting_approval');
  assert.equal(retry.state.tasks[0].next_attempt, 2);
  assert.throws(
    () => runCampaignTask(runOptions(value, id, calls, 'replicate')),
    { code: 'CAMPAIGN_CHECKPOINT_REQUIRED' }
  );
  recordCampaignDecision({
    cwd: value.directory,
    campaignId: id,
    taskId: 'replicate',
    decision: 'approved',
    note: 'Approve the explicit retry after reviewing the failure.'
  });
  const completed = runCampaignTask(runOptions(value, id, calls, 'replicate'));
  assert.equal(completed.status, 'completed');
  assert.equal(getCampaign(value.directory, id).state.status, 'waiting_hypothesis');
  recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'candidate-benefit',
    verdict: 'supported',
    decision: 'continue',
    rationale: 'The successful bounded retry supports continued investigation.',
    taskIds: ['replicate']
  });
  recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'null-effect',
    verdict: 'inconclusive',
    decision: 'prune',
    rationale: 'This branch had no declared retry task and is pruned without an evidence claim.',
    taskIds: []
  });
  const final = getCampaign(value.directory, id);
  assert.equal(final.state.status, 'completed');
  assert.deepEqual(final.state.tasks[0].attempts.map((attempt) => attempt.status),
    ['failed', 'completed']);
  assert.equal(final.verification.ok, true);
});

test('hypothesis trees support human pause, superseding prune, branch gating, and final adjudication', () => {
  const value = fixture();
  const treeSpec = spec({
    hypotheses: [
      {
        id: 'root-mechanism',
        statement: 'The root mechanism explains the recorded response.',
        rationale: 'It is the current leading mechanism.',
        falsification: 'A completed bounded control contradicts its expected response.',
        priority: 1,
        parent_id: null,
        relation: 'root',
        budget: {
          max_task_attempts: 1,
          max_gpu_tasks: 0,
          max_npu_tasks: 0
        }
      },
      {
        id: 'alternate-mechanism',
        statement: 'An alternate mechanism explains the response.',
        rationale: 'The branch protects against confirmation bias.',
        falsification: 'The same completed control excludes the alternate mechanism.',
        priority: 2,
        parent_id: 'root-mechanism',
        relation: 'alternative',
        budget: {
          max_task_attempts: 1,
          max_gpu_tasks: 0,
          max_npu_tasks: 0
        }
      }
    ],
    tasks: [
      {
        id: 'root-control',
        title: 'Run the root control',
        objective: 'Run one bounded recorded control for the root mechanism.',
        lane: 'compute',
        hypothesis_ids: ['root-mechanism'],
        depends_on: [],
        expected_outputs: ['Recorded root control'],
        checkpoint: false,
        compute: 'cpu',
        risk: 'low',
        max_attempts: 1
      },
      {
        id: 'alternate-control',
        title: 'Run the alternate control',
        objective: 'Run one bounded recorded control for the alternate mechanism.',
        lane: 'compute',
        hypothesis_ids: ['alternate-mechanism'],
        depends_on: [],
        expected_outputs: ['Recorded alternate control'],
        checkpoint: false,
        compute: 'cpu',
        risk: 'low',
        max_attempts: 1
      }
    ],
    budget: {
      max_task_attempts: 2,
      max_gpu_tasks: 0,
      max_npu_tasks: 0,
      max_wall_clock_seconds: 3600
    }
  });
  const created = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: treeSpec
  });
  const id = created.manifest.campaign_id;
  const paused = recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'alternate-mechanism',
    verdict: 'inconclusive',
    decision: 'pause',
    rationale: 'Pause this branch until the root control is inspected.',
    taskIds: []
  });
  assert.equal(paused.payload.supersedes_event_id, null);
  assert.equal(
    getCampaign(value.directory, id).state.tasks[1].status,
    'branch_paused'
  );
  const pruned = recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'alternate-mechanism',
    verdict: 'challenged',
    decision: 'prune',
    rationale: 'The human checkpoint prunes this branch before spending its budget.',
    taskIds: []
  });
  assert.equal(pruned.payload.supersedes_event_id, paused.event_id);
  const afterPrune = getCampaign(value.directory, id);
  assert.equal(afterPrune.state.tasks[1].status, 'branch_pruned');
  assert.equal(afterPrune.state.hypotheses[1].assessment_count, 2);
  assert.equal(afterPrune.state.hypotheses[1].effective_status, 'pruned');
  const preliminary = recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'root-mechanism',
    verdict: 'inconclusive',
    decision: 'continue',
    rationale: 'This is a preliminary checkpoint before the root control runs.',
    taskIds: []
  });
  const beforeRootWork = getCampaign(value.directory, id);
  assert.equal(beforeRootWork.state.hypotheses[0].assessment_ready, false);
  assert.equal(beforeRootWork.state.hypotheses[0].assessment_current, true);
  assert.equal(beforeRootWork.state.hypotheses[0].assessment_stale, false);

  const calls = [];
  const run = runCampaignTask(runOptions(value, id, calls, 'root-control'));
  assert.equal(run.status, 'completed');
  const afterRootWork = getCampaign(value.directory, id);
  assert.equal(afterRootWork.state.status, 'waiting_hypothesis');
  assert.equal(afterRootWork.state.hypotheses[0].assessment_ready, true);
  assert.equal(afterRootWork.state.hypotheses[0].assessment_current, false);
  assert.equal(afterRootWork.state.hypotheses[0].assessment_stale, true);
  assert.equal(afterRootWork.state.hypotheses[0].assessment_required, true);
  assert.equal(afterRootWork.state.hypothesis_counts.assessment_stale, 1);
  assert.throws(() => recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'alternate-mechanism',
    verdict: 'supported',
    decision: 'continue',
    rationale: 'This task was not declared for the alternate branch.',
    taskIds: ['root-control']
  }), { code: 'CAMPAIGN_HYPOTHESIS_TASK_MISMATCH' });
  assert.throws(() => recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'root-mechanism',
    verdict: 'falsified',
    decision: 'promote',
    rationale: 'Contradictory state.',
    taskIds: ['root-control']
  }), /cannot be promoted/);
  const finalAssessment = recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'root-mechanism',
    verdict: 'supported',
    decision: 'continue',
    rationale: 'The completed root control supports continued investigation.',
    taskIds: ['root-control']
  });
  assert.equal(finalAssessment.payload.supersedes_event_id, preliminary.event_id);
  const final = getCampaign(value.directory, id);
  assert.equal(final.state.status, 'completed');
  assert.equal(final.state.counts.branch_pruned, 1);
  assert.equal(final.state.hypothesis_counts.assessed, 2);
  assert.equal(final.state.hypothesis_counts.assessment_current, 2);
  assert.equal(final.state.hypothesis_counts.assessment_stale, 0);
  assert.equal(final.verification.ok, true);
  const gate = verifyProject(value.directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.pruned_campaign_hypotheses, 1);
});

test('schema-v1 campaigns remain replayable and reject version-2 assessment events', () => {
  const value = fixture();
  const created = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: legacySpec(),
    schemaVersion: 1
  });
  const id = created.manifest.campaign_id;
  const record = getCampaign(value.directory, id);
  assert.equal(record.manifest.schema_version, 1);
  assert.equal(record.verification.ok, true);
  assert.equal(record.state.hypotheses, undefined);
  assert.throws(() => recordHypothesisAssessment({
    cwd: value.directory,
    campaignId: id,
    hypothesisId: 'candidate-benefit',
    verdict: 'inconclusive',
    decision: 'continue',
    rationale: 'Legacy records cannot be silently upgraded.',
    taskIds: []
  }), { code: 'CAMPAIGN_SCHEMA_UPGRADE_REQUIRED' });
  assert.equal(verifyProject(value.directory).ok, true);
});

test('campaign validation rejects cycles, unsafe autonomy, secrets, and accelerator budget overruns', () => {
  const invalidTree = spec();
  invalidTree.hypotheses[0].parent_id = 'null-effect';
  invalidTree.hypotheses[0].relation = 'alternative';
  invalidTree.hypotheses[1].parent_id = null;
  invalidTree.hypotheses[1].relation = 'root';
  assert.throws(() => normalizeCampaignSpec(invalidTree),
    /parent must reference an earlier hypothesis/);
  assert.throws(() => normalizeCampaignSpec(spec({
    hypothesis_policy: {
      require_final_assessment: true,
      human_adjudication: false,
      automatic_pruning: false
    }
  })), /human_adjudication must remain enabled/);
  assert.throws(() => normalizeCampaignSpec(spec({
    hypothesis_policy: {
      require_final_assessment: true,
      human_adjudication: true,
      automatic_pruning: true
    }
  })), /automatic_pruning must remain disabled/);
  assert.throws(() => normalizeCampaignSpec(spec({
    tasks: [
      {
        id: 'later',
        title: 'Later',
        objective: 'Wait for an invalid forward dependency.',
        lane: 'scientist',
        hypothesis_ids: [],
        depends_on: ['first'],
        expected_outputs: ['Result'],
        checkpoint: true,
        compute: 'cpu',
        risk: 'low',
        max_attempts: 1
      },
      {
        id: 'first',
        title: 'First',
        objective: 'Create a dependency cycle.',
        lane: 'scientist',
        hypothesis_ids: [],
        depends_on: ['later'],
        expected_outputs: ['Result'],
        checkpoint: true,
        compute: 'cpu',
        risk: 'low',
        max_attempts: 1
      }
    ]
  })), /dependencies must appear earlier|dependency cycle/);
  assert.throws(() => normalizeCampaignSpec(spec({
    tasks: [{
      id: 'unsafe',
      title: 'Unsafe',
      objective: 'Attempt high-risk autonomous work.',
      lane: 'procedure',
      hypothesis_ids: [],
      depends_on: [],
      expected_outputs: ['Result'],
      checkpoint: false,
      compute: 'cpu',
      risk: 'high',
      max_attempts: 1
    }]
  })), /High-risk campaign tasks require/);
  assert.throws(() => normalizeCampaignSpec(spec({
    context: 'api_key = "sk-12345678901234567890"'
  })), { code: 'SECRET_DETECTED' });

  const value = fixture();
  const created = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: spec({
      tasks: [{
        id: 'gpu-only',
        title: 'GPU task',
        objective: 'Attempt a task beyond the declared GPU ceiling.',
        lane: 'compute',
        hypothesis_ids: ['candidate-benefit'],
        depends_on: [],
        expected_outputs: ['No unbudgeted execution'],
        checkpoint: false,
        compute: 'gpu',
        risk: 'low',
        max_attempts: 1
      }],
      budget: {
        max_task_attempts: 1,
        max_gpu_tasks: 0,
        max_npu_tasks: 0,
        max_wall_clock_seconds: 3600
      }
    })
  });
  const record = getCampaign(value.directory, created.manifest.campaign_id);
  assert.equal(record.state.status, 'budget_exhausted');
  assert.equal(record.state.tasks[0].reason, 'gpu_tasks');
  assert.throws(
    () => runCampaignTask(runOptions(
      value, created.manifest.campaign_id, [], 'gpu-only'
    )),
    { code: 'CAMPAIGN_NOT_ACTIONABLE' }
  );

  const branchLimited = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: spec({
      hypotheses: spec().hypotheses.map((hypothesis) => ({
        ...hypothesis,
        budget: { ...hypothesis.budget, max_gpu_tasks: 0 }
      })),
      tasks: [{
        id: 'branch-gpu',
        title: 'Branch-limited GPU task',
        objective: 'Attempt a GPU task beyond only the branch ceiling.',
        lane: 'compute',
        hypothesis_ids: ['candidate-benefit'],
        depends_on: [],
        expected_outputs: ['No unbudgeted branch execution'],
        checkpoint: false,
        compute: 'gpu',
        risk: 'low',
        max_attempts: 1
      }],
      budget: {
        max_task_attempts: 1,
        max_gpu_tasks: 1,
        max_npu_tasks: 0,
        max_wall_clock_seconds: 3600
      }
    })
  });
  const branchRecord = getCampaign(
    value.directory, branchLimited.manifest.campaign_id
  );
  assert.equal(branchRecord.state.status, 'budget_exhausted');
  assert.equal(branchRecord.state.tasks[0].reason, 'hypothesis_gpu_tasks');
});

test('campaign verification detects immutable plan and event tampering', () => {
  const value = fixture();
  const created = createCampaign({
    cwd: value.directory,
    chatId: value.chatId,
    spec: spec()
  });
  const id = created.manifest.campaign_id;
  recordCampaignDecision({
    cwd: value.directory,
    campaignId: id,
    taskId: 'evidence-map',
    decision: 'approved',
    note: 'Create one event to verify.'
  });
  const eventFile = path.join(
    value.directory, '.sciencecode', 'campaigns', id, 'events', '000001.json'
  );
  fs.appendFileSync(eventFile, '\n');
  const eventTamper = verifyCampaign(value.directory, id);
  assert.equal(eventTamper.ok, false);
  assert.ok(eventTamper.errors.some((error) =>
    error.issue === 'event_audit_link_mismatch' || error.issue === 'head_mismatch'
  ));

  const second = fixture();
  const secondCreated = createCampaign({
    cwd: second.directory,
    chatId: second.chatId,
    spec: spec()
  });
  const planFile = path.join(
    second.directory,
    '.sciencecode',
    'campaigns',
    secondCreated.manifest.campaign_id,
    'plan.json'
  );
  fs.appendFileSync(planFile, '\n');
  const planTamper = verifyCampaign(second.directory, secondCreated.manifest.campaign_id);
  assert.equal(planTamper.ok, false);
  assert.ok(planTamper.errors.some((error) =>
    error.file === 'plan.json' && error.issue === 'hash_mismatch'
  ));
});
