import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createArtifactRevision,
  buildLineageGraph,
  createChatSession,
  decideArtifactRevision,
  getArtifactRevision,
  listArtifactRevisions,
  interactionAwarePrompt,
  readAuditRecords,
  resolveArtifactRevision,
  revisionInteractionArtifact,
  revisionInteractionPayload,
  runSimulation,
  startLab,
  verifyProject,
  verifyArtifactRevision
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeRuntime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: ['numpy==2.3.5'] },
    probe: { python: '3.11.9', torch: { version: '2.12.0', cuda_available: false } }
  };
}

function recordedSimulation(directory, name = 'results.csv') {
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("simulation")\n');
  return runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: fakeRuntime(),
    gpuProbe: () => ({ available: false, backend: 'nvidia', devices: [], error: 'test' }),
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed', device: { selected: 'cpu' }, seed: 0
      }));
      fs.writeFileSync(path.join(output, name), 'estimate\n0.125\n');
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
}

function sourceFor(simulation, name = 'results.csv') {
  return {
    kind: 'simulation',
    record_id: simulation.manifest.simulation_id,
    name,
    url: '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) + '/' +
      encodeURIComponent(name),
    sha256: simulation.manifest.artifacts['artifacts/' + name].sha256
  };
}

test('artifact revisions preserve replacement bytes, version chains, and explicit decisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-revision-'));
  const chat = createChatSession({ cwd: directory, title: 'Review output', agent: 'scientist' });
  const simulation = recordedSimulation(directory);
  const source = sourceFor(simulation);

  const first = createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source,
    content: 'estimate\n0.250\n',
    note: 'Corrected the transcribed estimate.'
  });
  assert.equal(first.status, 'proposed');
  assert.equal(first.source.sha256, source.sha256);
  assert.equal(first.artifact.sha256.length, 64);
  assert.equal(fs.readFileSync(resolveArtifactRevision(directory, first.revision_id).file, 'utf8'),
    'estimate\n0.250\n');
  assert.equal(verifyArtifactRevision(directory, first.revision_id).ok, true);

  const accepted = decideArtifactRevision({
    cwd: directory,
    revisionId: first.revision_id,
    chatId: chat.manifest.chat_id,
    decision: 'accepted',
    note: 'Use this value in the report.'
  });
  assert.equal(accepted.decision, 'accepted');
  assert.equal(getArtifactRevision(directory, first.revision_id).status, 'accepted');

  const second = createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source,
    content: 'estimate\n0.251\n',
    previousRevisionId: first.revision_id
  });
  assert.equal(second.previous_revision.revision_id, first.revision_id);
  decideArtifactRevision({
    cwd: directory,
    revisionId: second.revision_id,
    chatId: chat.manifest.chat_id,
    decision: 'rejected',
    note: 'This rounding was not requested.'
  });
  const secondVerification = verifyArtifactRevision(directory, second.revision_id);
  assert.equal(secondVerification.ok, true);
  assert.equal(secondVerification.status, 'rejected');

  const listed = listArtifactRevisions(directory, { sourceUrl: source.url });
  assert.equal(listed.length, 2);
  assert.deepEqual(new Set(listed.map((record) => record.status)), new Set(['accepted', 'rejected']));
  assert.equal(revisionInteractionArtifact(first).record_id, first.revision_id);
  assert.equal(revisionInteractionPayload(first).artifact_sha256, first.artifact.sha256);
  assert.deepEqual(readAuditRecords(directory).map((record) => record.type), [
    'chat.created',
    'simulation.started',
    'simulation.finished',
    'artifact_revision.created',
    'artifact_revision.decided',
    'artifact_revision.created',
    'artifact_revision.decided'
  ]);
  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.artifact_revisions, 2);
  assert.equal(gate.counts.accepted_artifact_revisions, 1);
  assert.equal(gate.counts.rejected_artifact_revisions, 1);
  const lineage = buildLineageGraph(directory, { chatId: chat.manifest.chat_id });
  assert.equal(lineage.integrity.ok, true);
  assert.equal(lineage.nodes.filter((node) => node.type === 'revision').length, 2);
  assert.equal(lineage.nodes.filter((node) => node.type === 'decision').length, 2);
  assert.ok(lineage.edges.some((edge) => edge.relation === 'derived_as'));
  assert.ok(lineage.edges.some((edge) => edge.relation === 'revised_as'));
  assert.ok(lineage.edges.some((edge) => edge.relation === 'reviewed_as'));
});

test('artifact revision preflight rejects secrets, forged sources, and mismatched version ancestry', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-revision-preflight-'));
  const chat = createChatSession({ cwd: directory, title: 'Review output', agent: 'scientist' });
  const simulation = recordedSimulation(directory);
  const source = sourceFor(simulation);
  const before = listArtifactRevisions(directory).length;

  assert.throws(() => createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source,
    content: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456'
  }), { code: 'SECRET_DETECTED' });
  assert.throws(() => createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: { ...source, sha256: '0'.repeat(64) },
    content: 'safe\n'
  }), { code: 'REVISION_SOURCE_MISMATCH' });
  assert.throws(() => createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: { url: '/artifact/' + simulation.manifest.simulation_id + '/../manifest.json' },
    content: 'safe\n'
  }), { code: 'INVALID_REVISION_SOURCE' });
  assert.equal(listArtifactRevisions(directory).length, before);

  const first = createArtifactRevision({ cwd: directory, chatId: chat.manifest.chat_id,
    source, content: 'estimate\n0.250\n' });
  const secondDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-revision-other-'));
  const otherChat = createChatSession({ cwd: secondDirectory, title: 'Other', agent: 'scientist' });
  const otherSimulation = recordedSimulation(secondDirectory, 'other.csv');
  assert.throws(() => createArtifactRevision({
    cwd: secondDirectory,
    chatId: otherChat.manifest.chat_id,
    source: sourceFor(otherSimulation, 'other.csv'),
    content: 'estimate\n0.9\n',
    previousRevisionId: first.revision_id
  }), { code: 'REVISION_PREVIOUS_INVALID' });
});

test('artifact revision verification detects replacement and decision tampering', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-revision-tamper-'));
  const chat = createChatSession({ cwd: directory, title: 'Review output', agent: 'scientist' });
  const simulation = recordedSimulation(directory);
  const revision = createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: sourceFor(simulation),
    content: 'estimate\n0.250\n'
  });
  decideArtifactRevision({ cwd: directory, revisionId: revision.revision_id,
    chatId: chat.manifest.chat_id, decision: 'accepted' });

  const resolved = resolveArtifactRevision(directory, revision.revision_id);
  fs.appendFileSync(resolved.file, 'tampered\n');
  assert.equal(verifyArtifactRevision(directory, revision.revision_id).ok, false);

  const decisionFile = path.join(directory, '.sciencecode', 'revisions', revision.revision_id,
    'decisions.jsonl');
  const decision = JSON.parse(fs.readFileSync(decisionFile, 'utf8').trim());
  decision.decision = 'rejected';
  fs.writeFileSync(decisionFile, JSON.stringify(decision) + '\n');
  const verification = verifyArtifactRevision(directory, revision.revision_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.issue === 'decision_hash_mismatch'));
});

test('audit-backed revision registry detects a removed immutable record', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-revision-removed-'));
  const chat = createChatSession({ cwd: directory, title: 'Review output', agent: 'scientist' });
  const simulation = recordedSimulation(directory);
  const revision = createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: sourceFor(simulation),
    content: 'estimate\n0.250\n'
  });
  const recordDirectory = path.join(directory, '.sciencecode', 'revisions', revision.revision_id);
  fs.renameSync(recordDirectory, path.join(path.dirname(recordDirectory),
    '.removed-for-test-' + revision.revision_id));
  const listed = listArtifactRevisions(directory);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].revision_id, revision.revision_id);
  assert.equal(listed[0].verified, false);
  const gate = verifyProject(directory);
  assert.equal(gate.ok, false);
  assert.ok(gate.errors.some((error) =>
    error.issue === 'artifact_revision_invalid' && error.revision_id === revision.revision_id
  ));
});

test('Lab persists an edited artifact, records AI-visible context, serves it, and records acceptance', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-revision-lab-'));
  const chat = createChatSession({ cwd: directory, title: 'Interactive revision', agent: 'scientist' });
  const simulation = recordedSimulation(directory);
  const source = sourceFor(simulation);
  const launched = startLab({ cwd: directory, packageRoot, port: 0 });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const [appSource, styles] = await Promise.all([
    fetch(details.url + '/app.js').then((response) => response.text()),
    fetch(details.url + '/styles.css').then((response) => response.text())
  ]);
  assert.match(appSource, /Save immutable revision/);
  assert.match(appSource, /persistArtifactRevision/);
  assert.match(appSource, /decideRevision\(revision\.revision_id, 'accepted'/);
  assert.match(styles, /\.revision-ledger/);
  assert.match(styles, /\.revision-decision\.accept/);

  const createdResponse = await fetch(details.url + '/api/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat.manifest.chat_id,
      source,
      content: 'estimate\n0.333\n',
      note: 'Use the corrected value.'
    })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.revision.status, 'proposed');
  assert.equal(created.interaction.action, 'revision.proposed');
  assert.equal(created.interaction_error, null);
  const id = created.revision.manifest.revision_id;

  const artifactResponse = await fetch(details.url + '/revision-artifact/' + encodeURIComponent(id));
  assert.equal(artifactResponse.status, 200);
  assert.equal(await artifactResponse.text(), 'estimate\n0.333\n');
  const prompt = interactionAwarePrompt({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    message: 'Which result should I report?'
  });
  assert.match(prompt.prompt, new RegExp(id));
  assert.match(prompt.prompt, /is proposed/);

  const decisionResponse = await fetch(details.url + '/api/revisions/' + encodeURIComponent(id) + '/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat.manifest.chat_id,
      decision: 'accepted',
      note: 'Approved after reviewing the source table.'
    })
  });
  assert.equal(decisionResponse.status, 201);
  const decided = await decisionResponse.json();
  assert.equal(decided.revision.status, 'accepted');
  assert.equal(decided.interaction.action, 'revision.accepted');

  const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3]);
  const binaryResponse = await fetch(details.url + '/api/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat.manifest.chat_id,
      source,
      name: 'replacement.xlsx',
      media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content_base64: binary.toString('base64'),
      previous_revision_id: id
    })
  });
  assert.equal(binaryResponse.status, 201);
  const binaryRevision = await binaryResponse.json();
  const binaryArtifact = await fetch(details.url + binaryRevision.revision.url);
  assert.deepEqual(Buffer.from(await binaryArtifact.arrayBuffer()), binary);

  const malformedBase64 = await fetch(details.url + '/api/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat.manifest.chat_id, source,
      name: 'bad.xlsx', content_base64: 'not-base64' })
  });
  assert.equal(malformedBase64.status, 400);

  const listedResponse = await fetch(details.url + '/api/revisions?source=' + encodeURIComponent(source.url));
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  assert.equal(listed.summary.accepted, 1);
  assert.equal(listed.summary.proposed, 1);
  assert.equal(listed.summary.count, 2);
  assert.equal(listed.revisions[0].verified, true);
  const graphResponse = await fetch(details.url + '/api/lineage?chat=' +
    encodeURIComponent(chat.manifest.chat_id));
  assert.equal(graphResponse.status, 200);
  const graph = await graphResponse.json();
  assert.equal(graph.integrity.ok, true);
  assert.ok(graph.nodes.some((node) => node.id === 'revision:' + encodeURIComponent(id)));
  assert.ok(graph.edges.some((edge) => edge.relation === 'informed') === false);
  assert.equal(verifyProject(directory).ok, true);
});
