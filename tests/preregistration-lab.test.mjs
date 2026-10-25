import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_PREREGISTRATION_BYTES,
  PREREGISTRATION_REQUIRED_SECTIONS,
  createChatSession,
  freezePreregistration,
  interactionAwarePrompt,
  startLab
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function authoredProtocol(suffix = '') {
  const bodies = {
    'Research question': 'Does the prespecified intervention improve the terminal score?',
    Hypotheses: 'The intervention mean is at least 0.75; the null case is below 0.75.',
    'Design and population': 'A two-seed controlled simulation using all prespecified branches.',
    'Primary outcomes': 'Terminal score, dimensionless, at the final recorded step, summarized by the mean.',
    'Sample size and stopping rule': 'Exactly two seeds are run; no early stopping is permitted.',
    'Inclusion, exclusion, and missing data': 'All planned branches are included; missing branches fail the rule.',
    'Analysis and decision rules': 'The arithmetic mean must be greater than or equal to 0.75.',
    'Multiplicity and sensitivity analyses': 'One primary outcome; report the minimum score as sensitivity analysis.',
    'Deviations, risks, and limitations': 'Disclose every deviation; simulation findings are not causal claims.'
  };
  return '# Terminal score preregistration\n\n' +
    PREREGISTRATION_REQUIRED_SECTIONS.map((section) =>
      '## ' + section + '\n' + bodies[section] + suffix
    ).join('\n\n') + '\n';
}

function contractSpec(preregistrationId) {
  return {
    name: 'Terminal score confirmatory contract',
    hypothesis: 'The mean terminal score is at least 0.75.',
    preregistration_id: preregistrationId,
    script: 'model.py',
    analysis_population: 'All prespecified and integrity-verified branches.',
    conditions: 'The frozen script is run for seeds 1 and 2.',
    missing_data_policy: 'fail',
    multiplicity_policy: 'One primary outcome; no adjustment is applicable.',
    outcomes: [{
      outcome_id: 'terminal_score',
      role: 'primary',
      label: 'Mean terminal score',
      statistic: 'score',
      variable: 'Terminal simulation score',
      unit: 'dimensionless',
      timepoint: 'Final recorded step',
      summary_measure: 'Arithmetic mean across prespecified seeds',
      intercurrent_event_strategy: 'Missing branches are treated as missing.',
      aggregation: 'mean',
      minimum_count: 2,
      filter: {},
      decision_rule: { operator: 'greater_than_or_equal', value: 0.75 }
    }],
    sensitivity_analyses: ['Report the minimum branch score.'],
    exclusions: 'No post-result exclusions.',
    notes: 'Threshold replay is descriptive.'
  };
}

function computeState() {
  return {
    ok: true,
    gpu: { available: false, backend: null, devices: [], error: null },
    runtime: {
      healthy: true,
      profile: 'cpu',
      paths: { python: process.execPath },
      manifest: { schema_version: 1, packages: [] },
      probe: { python: process.version }
    }
  };
}

test('Lab authors, verifies, serves, lists, and binds preregistrations without requiring chat', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-prereg-lab-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("model")\n');
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: computeState
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const headers = {
    'Content-Type': 'application/json',
    Origin: details.url
  };
  const content = authoredProtocol();
  const request = { name: 'Terminal score plan', content };

  const crossOrigin = await fetch(details.url + '/api/preregistrations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example'
    },
    body: JSON.stringify(request)
  });
  assert.equal(crossOrigin.status, 403);

  const wrongMedia = await fetch(details.url + '/api/preregistrations', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: details.url },
    body: JSON.stringify(request)
  });
  assert.equal(wrongMedia.status, 415);

  const unknown = await fetch(details.url + '/api/preregistrations', {
    method: 'POST', headers,
    body: JSON.stringify({ ...request, surprise: true })
  });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error.code, 'INVALID_PREREGISTRATION_REQUEST');

  const incomplete = await fetch(details.url + '/api/preregistrations', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'Incomplete', content: '## Research question\nWhy?\n' })
  });
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).error.code, 'INVALID_PREREGISTRATION_CONTENT');

  const oversized = await fetch(details.url + '/api/preregistrations', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'Oversized', content: 'x'.repeat(MAX_PREREGISTRATION_BYTES + 1) })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'PREREGISTRATION_TOO_LARGE');

  const oversizedBody = await fetch(details.url + '/api/preregistrations', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: 'Transport oversized',
      content: 'x'.repeat(MAX_PREREGISTRATION_BYTES + 40 * 1024)
    })
  });
  assert.equal(oversizedBody.status, 413);
  assert.equal((await oversizedBody.json()).error.code, 'REQUEST_TOO_LARGE');

  const createdResponse = await fetch(details.url + '/api/preregistrations', {
    method: 'POST', headers,
    body: JSON.stringify({ ...request, chat_id: null, note: null })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const id = created.preregistration.record.preregistration_id;
  assert.equal(created.preregistration.record.schema_version, 2);
  assert.equal(created.preregistration.record.source.kind, 'inline');
  assert.equal(created.preregistration.verification.ok, true);
  assert.equal(created.preregistration.verification.source_status, 'authored_inline');
  assert.equal(created.interaction, null);
  assert.equal(created.interaction_error, null);

  const sourceResponse = await fetch(
    details.url + '/api/preregistrations/' + encodeURIComponent(id) + '/source'
  );
  assert.equal(sourceResponse.status, 200);
  assert.match(sourceResponse.headers.get('content-type'), /^text\/markdown/);
  assert.equal(await sourceResponse.text(), content);

  const detail = await (await fetch(
    details.url + '/api/preregistrations/' + encodeURIComponent(id)
  )).json();
  assert.equal(detail.record.preregistration_id, id);
  assert.equal(detail.verification.ok, true);
  assert.equal(detail.source_url, '/api/preregistrations/' + encodeURIComponent(id) + '/source');

  const list = await (await fetch(details.url + '/api/preregistrations')).json();
  assert.equal(list.summary.count, 1);
  assert.equal(list.summary.verified, 1);
  assert.equal(list.summary.authored_inline, 1);
  assert.equal(list.preregistrations[0].source_url, detail.source_url);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.preregistrations, 1);
  assert.equal(state.counts.verified_preregistrations, 1);
  assert.equal(state.preregistrations[0].verified, true);

  const contractResponse = await fetch(details.url + '/api/analysis-contracts', {
    method: 'POST', headers,
    body: JSON.stringify({ chat_id: null, spec: contractSpec(id) })
  });
  assert.equal(contractResponse.status, 201);
  const contract = await contractResponse.json();
  assert.equal(contract.analysis_contract.verification.ok, true);
  assert.equal(contract.analysis_contract.manifest.preregistration.preregistration_id, id);
  assert.equal(contract.interaction, null);

  const lineage = await (await fetch(details.url + '/api/lineage')).json();
  const node = lineage.nodes.find((candidate) =>
    candidate.type === 'preregistration' && candidate.record_id === id
  );
  assert.equal(node.verified, true);
  const artifact = lineage.nodes.find((candidate) =>
    candidate.type === 'artifact' && candidate.metadata?.owner_id === node.id
  );
  assert.equal(artifact.url, detail.source_url);

  const malformed = await fetch(details.url + '/api/preregistrations/bad%2Fid');
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_PREREGISTRATION_ID');
  const absent = await fetch(details.url + '/api/preregistrations/preregistration-absent');
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).error.code, 'PREREGISTRATION_NOT_FOUND');

  const legacyContent = '<script>throw new Error("must stay inert")</script>\n';
  fs.writeFileSync(path.join(directory, 'legacy.html'), legacyContent);
  const legacy = freezePreregistration(directory, 'legacy.html', {
    name: 'Legacy source compatibility'
  });
  const legacySource = await fetch(
    details.url + '/api/preregistrations/' +
      encodeURIComponent(legacy.preregistration_id) + '/source'
  );
  assert.equal(legacySource.status, 200);
  assert.match(legacySource.headers.get('content-type'), /^text\/plain/);
  assert.equal(await legacySource.text(), legacyContent);

  fs.appendFileSync(
    path.join(directory, '.sciencecode', 'preregistrations',
      created.preregistration.record.frozen_file),
    '\ntampered\n'
  );
  const refusedSource = await fetch(
    details.url + '/api/preregistrations/' + encodeURIComponent(id) + '/source'
  );
  assert.equal(refusedSource.status, 409);
  assert.equal((await refusedSource.json()).error.code, 'PREREGISTRATION_INVALID');
});

test('Lab preregistration authoring can hand an immutable plan to a selected conversation', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-prereg-chat-'));
  const chat = createChatSession({
    cwd: directory,
    title: 'Preregistration review',
    agent: 'scientist'
  });
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: computeState
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const response = await fetch(details.url + '/api/preregistrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: details.url },
    body: JSON.stringify({
      name: 'AI-visible frozen plan',
      content: authoredProtocol(' Prespecified.'),
      chat_id: chat.manifest.chat_id,
      note: 'Challenge assumptions before preparing the analysis contract.'
    })
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.interaction.action, 'preregistration.frozen');
  assert.equal(payload.interaction.artifact.kind, 'preregistration');
  assert.equal(payload.interaction_error, null);

  const contextValue = interactionAwarePrompt({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    message: 'Review my plan.'
  });
  assert.equal(contextValue.context.count, 1);
  assert.match(contextValue.prompt, /Frozen preregistration/);
  assert.match(contextValue.prompt, /later changes require a new preregistration/);
});
