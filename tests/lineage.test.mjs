import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLineageGraph,
  createChatSession,
  getEvidenceManifest,
  ingestEvidence,
  recordInteraction,
  sendChatMessage,
  traceLineage,
  verifyProject
} from '../lib/core.js';
import { layoutLineage, lineageSubgraph, lineageTrace } from '../lab/lineage.js';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lineage-'));
  const configDir = path.join(directory, 'config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(directory, 'evidence.txt'), [
    'Kinase SC42 reduced the measured response in the recorded control assay.',
    'The observation requires independent replication before candidate selection.'
  ].join('\n'));
  const evidence = ingestEvidence({
    cwd: directory,
    source: 'evidence.txt',
    title: 'SC42 control assay',
    authors: ['Research team'],
    year: 2026
  });
  const chat = createChatSession({ cwd: directory, agent: 'scientist' });
  return {
    directory,
    configDir,
    evidenceId: evidence.manifest.evidence_id,
    chatId: chat.manifest.chat_id
  };
}

function runner(calls) {
  return (command, args) => {
    calls.push({ command, args: [...args] });
    return {
      status: 0,
      signal: null,
      stderr: '',
      stdout: [
        JSON.stringify({ type: 'step_start', sessionID: 'ses_lineage', part: { type: 'step-start' } }),
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_lineage',
          part: { type: 'text', text: 'The evidence supports a provisional, replication-gated conclusion.' }
        }),
        JSON.stringify({ type: 'step_finish', sessionID: 'ses_lineage', part: { type: 'step-finish' } })
      ].join('\n') + '\n'
    };
  };
}

test('lineage joins evidence spans, user workspace state, turns, runs, and artifacts deterministically', () => {
  const { directory, configDir, evidenceId, chatId } = setup();
  const interaction = recordInteraction({
    cwd: directory,
    chatId,
    surface: 'lineage',
    action: 'trace.shared',
    artifact: null,
    payload: {
      graph_sha256: '0'.repeat(64),
      node_id: 'evidence:' + evidenceId,
      direction: 'upstream',
      node_ids: ['evidence:' + evidenceId],
      note: 'Check the replication limitation before drawing a conclusion.'
    }
  });
  const calls = [];
  const sent = sendChatMessage({
    cwd: directory,
    chatId,
    message: 'What does the SC42 control assay imply, and what limitation remains?',
    configDir,
    scienceCodeHome: path.join(directory, '.engine-home'),
    opencode: process.execPath,
    runner: runner(calls)
  });
  const unrelated = createChatSession({ cwd: directory, title: 'Unrelated conversation' });

  assert.match(calls[0].args.at(-1), /Lineage context selected/);
  assert.match(calls[0].args.at(-1), /replication limitation/);
  assert.ok(sent.turn.evidence_context?.retrieval_id);
  const fixedTime = new Date('2026-08-10T12:00:00.000Z');
  const graph = buildLineageGraph(directory, { chatId, now: fixedTime });
  const rebuilt = buildLineageGraph(directory, {
    chatId,
    now: new Date('2026-08-10T12:05:00.000Z')
  });

  assert.equal(graph.integrity.ok, true);
  assert.equal(graph.integrity.graph_sha256, rebuilt.integrity.graph_sha256);
  assert.equal(graph.generated_at, fixedTime.toISOString());
  assert.ok(graph.nodes.some((node) => node.id === 'evidence:' + evidenceId));
  assert.ok(graph.nodes.some((node) => node.type === 'citation'));
  assert.ok(graph.nodes.some((node) => node.id === 'retrieval:' + sent.turn.evidence_context.retrieval_id));
  assert.ok(graph.nodes.some((node) => node.id === 'interaction:' + interaction.interaction_id));
  assert.ok(graph.nodes.some((node) => node.id === 'run:' + sent.turn.run_id));
  assert.equal(graph.nodes.some((node) => node.id === 'chat:' + unrelated.manifest.chat_id), false);
  const projectGate = verifyProject(directory);
  assert.equal(projectGate.ok, true);
  assert.ok(projectGate.counts.lineage_nodes > graph.summary.nodes);
  assert.equal(projectGate.lineage.integrity.ok, true);

  const turnId = 'turn:' + chatId + ':1';
  assert.ok(graph.edges.some((edge) =>
    edge.source === 'retrieval:' + sent.turn.evidence_context.retrieval_id &&
    edge.target === turnId && edge.relation === 'grounded'
  ));
  assert.ok(graph.edges.some((edge) =>
    edge.source === 'interaction:' + interaction.interaction_id &&
    edge.target === turnId && edge.relation === 'informed'
  ));
  assert.ok(graph.edges.some((edge) =>
    edge.source === 'evidence:' + evidenceId &&
    edge.target === 'interaction:' + interaction.interaction_id &&
    edge.relation === 'revised_as'
  ));
  assert.ok(graph.edges.some((edge) =>
    edge.source === turnId && edge.target === 'run:' + sent.turn.run_id && edge.relation === 'executed_as'
  ));

  const upstream = traceLineage(graph, turnId, { direction: 'upstream' });
  assert.ok(upstream.node_ids.includes('interaction:' + interaction.interaction_id));
  assert.ok(upstream.node_ids.includes('evidence:' + evidenceId));
  assert.equal(upstream.node_ids.includes('run:' + sent.turn.run_id), false);
  assert.throws(() => traceLineage(graph, turnId, { direction: 'sideways' }), {
    code: 'INVALID_LINEAGE_DIRECTION'
  });
});

test('lineage fails closed when a referenced scientific record is mutated', () => {
  const { directory, evidenceId } = setup();
  const manifest = getEvidenceManifest(directory, evidenceId);
  const source = path.join(directory, '.sciencecode', 'evidence', evidenceId, manifest.source.file);
  fs.appendFileSync(source, '\ntampered');

  const graph = buildLineageGraph(directory);
  const evidence = graph.nodes.find((node) => node.id === 'evidence:' + evidenceId);
  assert.equal(evidence.verified, false);
  assert.equal(graph.integrity.ok, false);
  assert.ok(graph.findings.some((finding) =>
    finding.code === 'record_unverified' && finding.node_id === evidence.id
  ));
});

test('client lineage helpers lay out, filter, and trace graph records without a browser dependency', () => {
  const graph = {
    nodes: [
      { id: 'evidence:1', type: 'evidence', label: 'Source', verified: true },
      { id: 'retrieval:1', type: 'retrieval', label: 'Search', verified: true },
      { id: 'turn:1', type: 'turn', label: 'Turn', verified: true },
      { id: 'artifact:1', type: 'artifact', label: 'Figure', verified: false }
    ],
    edges: [
      { source: 'evidence:1', target: 'retrieval:1', relation: 'ranked_in' },
      { source: 'retrieval:1', target: 'turn:1', relation: 'grounded' },
      { source: 'turn:1', target: 'artifact:1', relation: 'produced' }
    ],
    findings: [{ severity: 'error', code: 'mutated', node_id: 'artifact:1' }]
  };
  assert.deepEqual([...lineageTrace(graph, 'turn:1', 'upstream')].sort(), [
    'evidence:1', 'retrieval:1', 'turn:1'
  ]);
  const focused = lineageSubgraph(graph, {
    selected: 'turn:1',
    direction: 'downstream'
  });
  assert.deepEqual(focused.nodes.map((node) => node.id), ['turn:1', 'artifact:1']);
  const issues = lineageSubgraph(graph, { integrity: 'issues' });
  assert.deepEqual(issues.nodes.map((node) => node.id), ['artifact:1']);
  const layout = layoutLineage(graph);
  assert.equal(layout.positions.size, 4);
  assert.ok(layout.positions.get('evidence:1').x < layout.positions.get('artifact:1').x);
  assert.ok(layout.width >= 760);
  assert.ok(layout.height >= 440);
});
