import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildHarnessView,
  classifyResearchGoal,
  createChatSession,
  getChatSession,
  publicOpenCodeEvent,
  recordInteraction,
  sendChatMessage
} from '../lib/core.js';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-harness-'));
  const configDir = path.join(directory, 'config');
  fs.mkdirSync(configDir);
  const created = createChatSession({ cwd: directory, agent: 'scientist' });
  return {
    directory,
    configDir,
    chatId: created.manifest.chat_id,
    scienceCodeHome: path.join(directory, '.engine-home')
  };
}

test('research goals enter domain-specific staged workflows', () => {
  assert.equal(classifyResearchGoal('Rank drug candidates for an oncology target.').id, 'drug_discovery');
  assert.equal(classifyResearchGoal('Draft an assay protocol for a compound screen.').id, 'procedure_development');
  assert.equal(classifyResearchGoal('Run a GPU Monte Carlo simulation.').id, 'computational_science');
  assert.equal(classifyResearchGoal('Review the primary literature and citations.').id, 'evidence_review');
  assert.equal(classifyResearchGoal('Explore an unusual scientific observation.').id, 'general_research');
  assert.equal(classifyResearchGoal('Design a CRISPR guide RNA against a named locus.').id, 'biomolecular_design');
  assert.equal(classifyResearchGoal('Select a stabilised antigen for a vaccine candidate.').id, 'biomolecular_design');
  assert.equal(classifyResearchGoal('Optimise codon usage for an expression construct.').id, 'biomolecular_design');
});

test('biomolecular design gates biosafety and states its layered grounding', () => {
  const workflow = classifyResearchGoal('Design an mRNA immunogen construct.');
  assert.equal(workflow.id, 'biomolecular_design');
  assert.equal(workflow.risk, 'high');
  assert.equal(workflow.physical_execution, 'human_approval_required');
  const stageIds = workflow.stages.map((stage) => stage[0]);
  assert.deepEqual(stageIds, [
    'scope', 'evidence', 'grounding', 'design', 'compute', 'biosafety', 'review', 'approval', 'outcome'
  ]);
  assert.equal(workflow.stages.find((stage) => stage[0] === 'biosafety')[2], 'biosafety');
});

test('a harness view carries the knowledge grounding for its workflow', () => {
  const context = setup();
  const chat = getChatSession(context.directory, context.chatId);
  const view = buildHarnessView({ cwd: context.directory, chat });
  assert.equal(view.workflow.knowledge.workflow, view.workflow.id);
  assert.ok(view.workflow.knowledge.principle_count > 0);
  assert.equal(view.workflow.knowledge.layer_span[0], 'mathematics');
  assert.ok(view.workflow.knowledge.domains.length > 0);
  fs.rmSync(context.directory, { recursive: true, force: true });
});

test('the public activity contract exposes tool progress without tool inputs or outputs', () => {
  const event = publicOpenCodeEvent({
    type: 'tool_use',
    timestamp: '2026-08-10T12:00:00.000Z',
    part: {
      tool: 'read',
      callID: 'call-safe',
      state: {
        status: 'completed',
        title: 'Read evidence table',
        input: { path: 'secret-dataset.csv', token: 'sk-1234567890abcdefghijkl' },
        output: 'private patient data',
        time: { start: 1, end: 2 }
      }
    }
  });
  assert.deepEqual(event, {
    type: 'tool',
    timestamp: '2026-08-10T12:00:00.000Z',
    tool: 'read',
    status: 'completed',
    title: 'Read evidence table',
    call_id: 'call-safe',
    started_at: 1,
    finished_at: 2
  });
  assert.equal(JSON.stringify(event).includes('secret-dataset'), false);
  assert.equal(JSON.stringify(event).includes('patient data'), false);
});

test('assistant response text is opt-in, redacted, control-safe, and UTF-8 bounded', () => {
  const raw = {
    type: 'text',
    timestamp: '2026-08-10T12:01:00.000Z',
    part: {
      id: 'part-live-1',
      messageID: 'message-live-1',
      text: 'Result\nsk-1234567890abcdefghijkl\u0000\n' + '🧬'.repeat(5_000)
    }
  };
  const recorded = publicOpenCodeEvent(raw);
  assert.deepEqual(recorded, {
    type: 'response.updated',
    timestamp: '2026-08-10T12:01:00.000Z',
    status: 'running',
    title: 'Synthesizing the research outcome'
  });
  assert.equal('content' in recorded, false);

  const live = publicOpenCodeEvent(raw, {
    includeResponseContent: true,
    maxResponseBytes: 8 * 1024
  });
  assert.equal(live.type, 'response.block');
  assert.equal(live.part_id, 'part-live-1');
  assert.equal(live.message_id, 'message-live-1');
  assert.match(live.content, /\[REDACTED TOKEN\]/);
  assert.equal(live.content.includes('sk-1234567890abcdefghijkl'), false);
  assert.equal(live.content.includes('\u0000'), false);
  assert.equal(live.content.includes('\ufffd'), false);
  assert.equal(live.truncated, true);
  assert.ok(Buffer.byteLength(live.content, 'utf8') <= 8 * 1024);
  assert.equal(live.content_bytes, Buffer.byteLength(live.content, 'utf8'));

  const narrow = publicOpenCodeEvent({
    type: 'text',
    part: { text: 'abc🧬def' }
  }, {
    includeResponseContent: true,
    maxResponseBytes: 5
  });
  assert.equal(narrow.content, 'abc');
  assert.equal(narrow.content_bytes, 3);
  assert.equal(narrow.truncated, true);
});

test('harness view derives activity, stage gates, evidence, outcomes, and interactions from verified records', () => {
  const { directory, configDir, chatId, scienceCodeHome } = setup();
  sendChatMessage({
    cwd: directory,
    chatId,
    message: 'Rank therapeutic compounds for a protein target with an assay and ADMET plan.',
    configDir,
    scienceCodeHome,
    opencode: process.execPath,
    runner() {
      return {
        status: 0,
        signal: null,
        stderr: '',
        stdout: [
          JSON.stringify({ type: 'step_start', sessionID: 'ses_harness', part: { type: 'step-start' } }),
          JSON.stringify({
            type: 'tool_use',
            sessionID: 'ses_harness',
            part: {
              type: 'tool',
              tool: 'read',
              callID: 'call-read',
              state: {
                status: 'completed',
                title: 'Inspect primary assay evidence',
                input: { filePath: 'private-evidence.csv' },
                output: 'sensitive row-level values'
              }
            }
          }),
          JSON.stringify({
            type: 'tool_use',
            sessionID: 'ses_harness',
            part: {
              type: 'tool',
              tool: 'bash',
              callID: 'call-compute',
              state: { status: 'completed', title: 'Run recorded ranking model' }
            }
          }),
          JSON.stringify({
            type: 'text',
            sessionID: 'ses_harness',
            part: {
              type: 'text',
              text: 'Hypothesis: candidate A has the best window. The assay method uses controls and acceptance criteria. Safety and toxicity remain limitations; independently review and falsify this ranking.'
            }
          }),
          JSON.stringify({ type: 'step_finish', sessionID: 'ses_harness', part: { type: 'step-finish' } })
        ].join('\n') + '\n'
      };
    }
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'three-d',
    action: 'point.selected',
    artifact: { name: 'candidate.pdb', kind: 'simulation', record_id: 'sim-candidate' },
    payload: {
      view: { yaw: 0.2, pitch: 0.3, zoom: 1.4 },
      selected: { index: 11, element: 'O' }
    }
  });

  const chat = {
    ...getChatSession(directory, chatId),
    verification: { ok: true, errors: [] }
  };
  const view = buildHarnessView({
    cwd: directory,
    chat,
    compute: {
      runtime: { healthy: true },
      runtimes: {
        gpu: { healthy: true },
        npu: { healthy: true }
      },
      gpu: { available: true },
      npu: { available: true },
      capabilities: {
        npu_onnx_inference: {
          execution_provider: 'VitisAIExecutionProvider'
        }
      }
    },
    experiments: [{ experiment_id: 'experiment-one' }],
    simulations: [{ simulation_id: 'simulation-one' }],
    inferences: [{
      inference_id: 'inference-one',
      npu_executed: true,
      verified: true
    }]
  });

  assert.equal(view.truthful_trace, true);
  assert.equal(view.workflow.id, 'drug_discovery');
  assert.equal(view.workflow.physical_execution, 'human_approval_required');
  assert.equal(view.board.validation.evidence_observed, true);
  assert.equal(view.board.validation.review_observed, true);
  assert.equal(view.board.validation.interactions_verified, true);
  assert.equal(view.board.computation.gpu_available, true);
  assert.equal(view.board.computation.gpu_runtime_ready, true);
  assert.equal(view.board.computation.npu_available, true);
  assert.equal(view.board.computation.npu_runtime_ready, true);
  assert.equal(view.board.computation.npu_execution_provider, 'VitisAIExecutionProvider');
  assert.equal(view.board.computation.inferences, 1);
  assert.equal(view.board.computation.npu_verified_inferences, 1);
  assert.equal(view.board.computation.linked_compute, true);
  assert.equal(view.board.outcomes.length, 1);
  assert.equal(view.interactions.count, 1);
  assert.equal(view.interactions.head_hash.length, 64);
  assert.ok(view.activity.some((event) => event.type === 'tool' && event.tool === 'read'));
  assert.ok(view.activity.some((event) => event.type === 'user.point.selected'));
  assert.ok(view.stages.some((stage) => stage.id === 'evidence' && stage.status === 'complete'));
  assert.ok(view.stages.some((stage) => stage.id === 'compute' && stage.status === 'complete'));
  assert.equal(view.board.procedure.execution_state, 'design_only');
  assert.ok(view.board.procedure.gates.some((gate) => gate.id === 'approval' && gate.status === 'required'));
  assert.equal(JSON.stringify(view).includes('private-evidence.csv'), false);
  assert.equal(JSON.stringify(view).includes('sensitive row-level values'), false);
});
