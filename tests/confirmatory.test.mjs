import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analysisContractInteractionArtifact,
  analysisContractInteractionPayload,
  buildHarnessView,
  buildLineageGraph,
  confirmatoryAssessmentInteractionArtifact,
  confirmatoryAssessmentInteractionPayload,
  createAnalysisContract,
  createChatSession,
  createConfirmatoryAssessment,
  evaluateConfirmatoryExperiment,
  freezePreregistration,
  getAnalysisContractBinding,
  getChatSession,
  interactionAwarePrompt,
  listAnalysisContracts,
  listConfirmatoryAssessments,
  listExperiments,
  normalizeAnalysisContractSpec,
  recordInteraction,
  runExperiment,
  startLab,
  verifyAnalysisContract,
  verifyConfirmatoryAssessment,
  verifyExperiment,
  verifyProject
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: ['torch==2.12.0+cu130'] },
    probe: {
      python: '3.11.9',
      torch: { version: '2.12.0+cu130', cuda_runtime: '13.0', cuda_available: true }
    }
  };
}

function gpu() {
  return {
    available: true,
    backend: 'nvidia',
    executable: 'nvidia-smi',
    devices: [{
      index: 0,
      name: 'NVIDIA GeForce RTX 4090',
      uuid: 'GPU-confirmatory-test',
      memory_total_mib: 16311,
      memory_free_mib: 15000,
      driver_version: '610.47',
      compute_capability: '12.0'
    }],
    error: null
  };
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-confirmatory-'));
  fs.writeFileSync(path.join(directory, 'protocol.md'), [
    '# Preregistered protocol',
    '',
    'Primary outcome: mean terminal score across seeds.',
    'Missing branch results make the primary outcome indeterminate.'
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("confirmatory experiment")\n');
  const preregistration = freezePreregistration(directory, 'protocol.md', {
    name: 'Terminal score protocol'
  });
  return { directory, preregistration };
}

function contractSpec(preregistrationId, overrides = {}) {
  return {
    name: 'Terminal score confirmatory contract',
    hypothesis: 'The mean terminal score is at least 0.75 across prespecified seeds.',
    preregistration_id: preregistrationId,
    script: 'model.py',
    analysis_population: 'All prespecified and integrity-verified experiment branches.',
    conditions: 'The same frozen script is run for seeds 1 and 2.',
    missing_data_policy: 'fail',
    multiplicity_policy: 'One primary outcome; no multiplicity adjustment is applicable.',
    outcomes: [{
      outcome_id: 'terminal_score',
      role: 'primary',
      label: 'Mean terminal score',
      statistic: 'score',
      variable: 'Terminal simulation score',
      unit: 'dimensionless',
      timepoint: 'Final recorded simulation step',
      summary_measure: 'Arithmetic mean across prespecified seeds',
      intercurrent_event_strategy: 'A failed, unverified, or missing branch is treated as missing.',
      aggregation: 'mean',
      minimum_count: 2,
      filter: {},
      decision_rule: { operator: 'greater_than_or_equal', value: 0.75 }
    }],
    sensitivity_analyses: ['Report the minimum branch score without changing the primary decision.'],
    exclusions: 'No branch exclusions after execution.',
    notes: 'This threshold contract is descriptive and does not create an inferential claim.',
    ...overrides
  };
}

function simulationRunner(command, args) {
  const output = args[args.indexOf('--output-dir') + 1];
  const seed = Number(args[args.indexOf('--seed') + 1]);
  fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
    status: 'completed',
    seed,
    device: {
      selected: 'cuda:0',
      name: 'NVIDIA GeForce RTX 4090',
      peak_memory_bytes: 1024
    }
  }));
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
    model: 'Contract fixture',
    final_statistics: { score: seed === 1 ? 0.7 : 0.9 }
  }));
  return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
}

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; }
  };
}

function invoke(argv, cwd) {
  const stdout = capture();
  const stderr = capture();
  const code = runCli({
    argv,
    cwd,
    root: packageRoot,
    env: process.env,
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  return { code, stdout: stdout.read(), stderr: stderr.read() };
}

test('analysis contracts freeze a preregistration, normalized outcomes, and exact script bytes', () => {
  const { directory, preregistration } = fixture();
  const created = createAnalysisContract({
    cwd: directory,
    spec: contractSpec(preregistration.preregistration_id, { script: './model.py' })
  });
  const id = created.manifest.analysis_contract_id;
  assert.equal(created.manifest.status, 'frozen');
  assert.equal(created.contract.script, 'model.py');
  assert.deepEqual(created.manifest.counts, {
    outcomes: 1,
    primary: 1,
    secondary: 0,
    exploratory: 0
  });
  assert.equal(verifyAnalysisContract(directory, id).ok, true);
  assert.equal(listAnalysisContracts(directory)[0].verified, true);
  assert.equal(getAnalysisContractBinding(directory, id).script_sha256,
    created.manifest.script.frozen_sha256);
  const payload = analysisContractInteractionPayload(created);
  assert.equal(payload.primary_outcomes[0].outcome_id, 'terminal_score');

  fs.appendFileSync(path.join(directory, 'model.py'), '# later exploratory edit\n');
  const drifted = verifyAnalysisContract(directory, id);
  assert.equal(drifted.ok, true);
  assert.equal(drifted.source_status, 'modified');

  fs.appendFileSync(path.join(
    directory, '.sciencecode', 'analysis-contracts', id, 'contract.json'
  ), '\n');
  const tampered = verifyAnalysisContract(directory, id);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) =>
    error.file === 'contract.json' && error.issue === 'hash_mismatch'
  ));
});

test('deterministic assessment covers every aggregation, threshold family, filter, and missingness policy', () => {
  const outcome = (outcomeId, role, aggregation, decisionRule) => ({
    outcome_id: outcomeId,
    role,
    label: outcomeId,
    statistic: 'score',
    variable: 'Synthetic score',
    unit: 'dimensionless',
    timepoint: 'Final step',
    summary_measure: aggregation + ' across prespecified group A branches',
    intercurrent_event_strategy: 'Failed branches are missing.',
    aggregation,
    minimum_count: 2,
    filter: { group: 'A' },
    decision_rule: decisionRule
  });
  const contract = normalizeAnalysisContractSpec(contractSpec('preregistration-example', {
    outcomes: [
      outcome('median_inside', 'primary', 'median',
        { operator: 'between_inclusive', lower: 2, upper: 2 }),
      outcome('mean_gte', 'primary', 'mean',
        { operator: 'greater_than_or_equal', value: 2 }),
      outcome('minimum_lte', 'secondary', 'minimum',
        { operator: 'less_than_or_equal', value: 1 }),
      outcome('maximum_gt', 'secondary', 'maximum',
        { operator: 'greater_than', value: 99 }),
      outcome('mean_lt', 'exploratory', 'mean',
        { operator: 'less_than', value: 3 }),
      outcome('minimum_outside', 'exploratory', 'minimum',
        { operator: 'outside_inclusive', lower: 1, upper: 2 })
    ]
  }));
  const binding = {
    analysis_contract_id: 'analysis-contract-example',
    manifest_sha256: 'a'.repeat(64),
    contract_sha256: 'b'.repeat(64),
    created_at: '2026-08-10T12:00:00.000Z',
    preregistration_id: 'preregistration-example',
    preregistration_record_sha256: 'c'.repeat(64),
    script_sha256: 'd'.repeat(64)
  };
  const plan = {
    analysis_contract: binding,
    script: { sha256: binding.script_sha256 },
    branches: [
      { index: 0, parameters: { group: 'A' } },
      { index: 1, parameters: { group: 'A' } },
      { index: 2, parameters: { group: 'B' } }
    ]
  };
  const experimentManifest = {
    analysis_contract: binding,
    script: { sha256: binding.script_sha256 },
    started_at: '2026-08-10T12:01:00.000Z',
    finished_at: '2026-08-10T12:02:00.000Z',
    status: 'completed',
    branch_count: 3,
    plan_sha256: 'e'.repeat(64)
  };
  const results = [
    { branch_index: 0, status: 'completed', verified: true, final_statistics: { score: 1 } },
    { branch_index: 1, status: 'completed', verified: true, final_statistics: { score: 3 } },
    { branch_index: 2, status: 'completed', verified: true, final_statistics: { score: 500 } }
  ];
  const report = evaluateConfirmatoryExperiment({
    contractId: binding.analysis_contract_id,
    contractBinding: binding,
    contract,
    experimentId: 'experiment-example',
    experimentManifest,
    experimentManifestSha256: 'f'.repeat(64),
    plan,
    results
  });
  assert.equal(report.schema_version, 1);
  assert.equal(report.engine.version, 1);
  assert.equal(report.registration.status, 'prospective');
  assert.equal(report.summary.outcome_verdict, 'pass');
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.outcomes.map((item) => item.aggregate_value),
    [2, 2, 1, 3, 2, 1]);
  assert.deepEqual(report.outcomes.map((item) => item.status),
    ['pass', 'pass', 'pass', 'fail', 'pass', 'pass']);
  assert.ok(report.outcomes.every((item) => item.expected_count === 2));

  const missingResults = [
    results[0],
    { branch_index: 1, status: 'failed', verified: true, final_statistics: {} },
    results[2]
  ];
  const missingBase = contractSpec('preregistration-example', {
    outcomes: [{
      ...outcome('missingness', 'primary', 'mean',
        { operator: 'greater_than_or_equal', value: 1 }),
      minimum_count: 1
    }]
  });
  const strictMissing = evaluateConfirmatoryExperiment({
    contractId: binding.analysis_contract_id,
    contractBinding: binding,
    contract: normalizeAnalysisContractSpec(missingBase),
    experimentId: 'experiment-example',
    experimentManifest,
    experimentManifestSha256: 'f'.repeat(64),
    plan,
    results: missingResults
  });
  assert.equal(strictMissing.outcomes[0].status, 'indeterminate');
  assert.equal(strictMissing.status, 'indeterminate');
  const excludedMissing = evaluateConfirmatoryExperiment({
    contractId: binding.analysis_contract_id,
    contractBinding: binding,
    contract: normalizeAnalysisContractSpec({
      ...missingBase,
      missing_data_policy: 'exclude_after_minimum_count'
    }),
    experimentId: 'experiment-example',
    experimentManifest,
    experimentManifestSha256: 'f'.repeat(64),
    plan,
    results: missingResults
  });
  assert.equal(excludedMissing.outcomes[0].aggregate_value, 1);
  assert.equal(excludedMissing.status, 'pass');
});

test('contract-bound experiments produce replayable prospective assessments and immutable rerun history', () => {
  const { directory, preregistration } = fixture();
  const contract = createAnalysisContract({
    cwd: directory,
    spec: contractSpec(preregistration.preregistration_id)
  });
  const contractId = contract.manifest.analysis_contract_id;
  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    name: 'Prespecified terminal score experiment',
    hypothesis: contract.contract.hypothesis,
    analysisContractId: contractId,
    seeds: [1, 2],
    device: 'cuda',
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  assert.equal(experiment.manifest.analysis_contract.analysis_contract_id, contractId);
  assert.equal(verifyExperiment(directory, experiment.manifest.experiment_id).ok, true);

  const first = createConfirmatoryAssessment({
    cwd: directory,
    contractId,
    experimentId: experiment.manifest.experiment_id
  });
  assert.equal(first.manifest.schema_version, 1);
  assert.equal(first.manifest.report.engine_version, 1);
  assert.equal(first.report.registration.status, 'prospective');
  assert.equal(first.report.status, 'pass');
  assert.equal(first.report.outcomes[0].aggregate_value, 0.8);
  assert.equal(first.report.outcomes[0].observed_count, 2);
  assert.equal(verifyConfirmatoryAssessment(
    directory, first.manifest.analysis_assessment_id
  ).ok, true);
  const interaction = confirmatoryAssessmentInteractionPayload(first);
  assert.equal(interaction.primary_outcomes[0].status, 'pass');

  const second = createConfirmatoryAssessment({
    cwd: directory,
    contractId,
    experimentId: experiment.manifest.experiment_id,
    deviationNote: 'Reported after an additional visualization review; threshold unchanged.'
  });
  assert.equal(second.report.registration.status, 'deviated');
  assert.equal(second.report.status, 'deviation');
  const history = listConfirmatoryAssessments(directory);
  assert.equal(history.length, 2);
  assert.equal(history[0].current_for_pair, true);
  assert.equal(history[1].current_for_pair, false);
  assert.equal(history[1].superseded_by, history[0].analysis_assessment_id);
  assert.equal(verifyConfirmatoryAssessment(
    directory, second.manifest.analysis_assessment_id
  ).ok, true);
});

test('unregistered experiments remain assessable but cannot be presented as confirmatory', () => {
  const { directory, preregistration } = fixture();
  const contract = createAnalysisContract({
    cwd: directory,
    spec: contractSpec(preregistration.preregistration_id)
  });
  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    seeds: [1, 2],
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  const assessment = createConfirmatoryAssessment({
    cwd: directory,
    contractId: contract.manifest.analysis_contract_id,
    experimentId: experiment.manifest.experiment_id
  });
  assert.equal(assessment.report.summary.outcome_verdict, 'pass');
  assert.equal(assessment.report.registration.status, 'unregistered');
  assert.equal(assessment.report.status, 'deviation');
  assert.deepEqual(assessment.report.registration.automatic_deviations,
    ['experiment_not_bound_to_contract']);
  assert.equal(verifyConfirmatoryAssessment(
    directory, assessment.manifest.analysis_assessment_id
  ).ok, true);
});

test('analysis contract validation fails closed before execution or immutable record creation', () => {
  const { directory, preregistration } = fixture();
  const noPrimary = contractSpec(preregistration.preregistration_id);
  noPrimary.outcomes[0].role = 'secondary';
  assert.throws(() => normalizeAnalysisContractSpec(noPrimary), {
    code: 'INVALID_ANALYSIS_CONTRACT'
  });
  assert.throws(() => createAnalysisContract({
    cwd: directory,
    spec: contractSpec(preregistration.preregistration_id, {
      notes: 'token=supersecretvalue123'
    })
  }), { code: 'SECRET_DETECTED' });

  const created = createAnalysisContract({
    cwd: directory,
    spec: contractSpec(preregistration.preregistration_id)
  });
  fs.appendFileSync(path.join(directory, 'model.py'), '# changed after freeze\n');
  assert.throws(() => runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    analysisContractId: created.manifest.analysis_contract_id,
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  }), { code: 'ANALYSIS_CONTRACT_SCRIPT_MISMATCH' });
  assert.equal(listExperiments(directory).length, 0);
});

test('contract and assessment interactions reach the next AI turn, harness, lineage, and project gate', () => {
  const { directory, preregistration } = fixture();
  const chat = createChatSession({
    cwd: directory,
    title: 'Prospective terminal-score study',
    agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  const contract = createAnalysisContract({
    cwd: directory,
    chatId,
    spec: contractSpec(preregistration.preregistration_id)
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'analysis',
    action: 'contract.frozen',
    artifact: analysisContractInteractionArtifact(contract),
    payload: analysisContractInteractionPayload(contract)
  });
  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    name: 'AI-visible confirmatory experiment',
    hypothesis: contract.contract.hypothesis,
    analysisContractId: contract.manifest.analysis_contract_id,
    seeds: [1, 2],
    device: 'cuda',
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  const assessment = createConfirmatoryAssessment({
    cwd: directory,
    chatId,
    contractId: contract.manifest.analysis_contract_id,
    experimentId: experiment.manifest.experiment_id
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'analysis',
    action: 'assessment.created',
    artifact: confirmatoryAssessmentInteractionArtifact(assessment),
    payload: confirmatoryAssessmentInteractionPayload(assessment)
  });

  const context = interactionAwarePrompt({
    cwd: directory,
    chatId,
    message: 'Interpret the registered result and propose the next test.'
  });
  assert.equal(context.context.count, 2);
  assert.match(context.prompt, /Frozen prospective analysis contract/);
  assert.match(context.prompt, /terminal_score greater_than_or_equal 0.75/);
  assert.match(context.prompt, /registration prospective/);
  assert.match(context.prompt, /terminal_score=0.8 dimensionless \[pass\]/);
  assert.match(context.prompt, /not an inferential or causal claim/);

  const contracts = listAnalysisContracts(directory);
  const assessments = listConfirmatoryAssessments(directory);
  const harness = buildHarnessView({
    cwd: directory,
    chat: getChatSession(directory, chatId),
    compute: { ok: true, runtime: runtime(), gpu: gpu() },
    experiments: listExperiments(directory),
    analysisContracts: contracts,
    confirmatoryAssessments: assessments
  });
  assert.equal(harness.board.confirmatory.contracts[0].verified, true);
  assert.equal(harness.board.confirmatory.assessments[0].registration_status, 'prospective');
  assert.equal(harness.board.validation.analysis_contracts_verified, 1);
  assert.equal(harness.board.validation.prospective_confirmatory_assessments, 1);
  assert.equal(harness.board.validation.confirmatory_assessments_needing_attention, 0);

  const graph = buildLineageGraph(directory);
  assert.equal(graph.integrity.ok, true);
  assert.ok(graph.nodes.some((node) =>
    node.type === 'analysis-contract' &&
    node.record_id === contract.manifest.analysis_contract_id
  ));
  assert.ok(graph.nodes.some((node) =>
    node.type === 'analysis-assessment' &&
    node.record_id === assessment.manifest.analysis_assessment_id
  ));
  assert.ok(graph.edges.some((edge) => edge.relation === 'constrains'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'governs'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'evaluated_by'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'assessed_by'));

  const project = verifyProject(directory);
  assert.equal(project.ok, true);
  assert.equal(project.counts.analysis_contracts, 1);
  assert.equal(project.counts.confirmatory_assessments, 1);
  assert.equal(project.counts.prospective_confirmatory_assessments, 1);
});

test('analysis CLI creates, lists, verifies, assesses, and shares immutable records', () => {
  const { directory, preregistration } = fixture();
  const chat = createChatSession({
    cwd: directory,
    title: 'CLI confirmatory workflow',
    agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  fs.writeFileSync(
    path.join(directory, 'analysis-contract.json'),
    JSON.stringify(contractSpec(preregistration.preregistration_id), null, 2)
  );

  const createdResult = invoke([
    'analysis', 'contract', 'create', 'analysis-contract.json', '--chat', chatId
  ], directory);
  assert.equal(createdResult.code, 0, createdResult.stderr);
  const created = JSON.parse(createdResult.stdout);
  const contractId = created.analysis_contract.manifest.analysis_contract_id;
  assert.equal(created.analysis_contract.verification.ok, true);
  assert.equal(created.interaction.action, 'contract.frozen');
  assert.equal(created.interaction_error, null);

  const listedContracts = invoke([
    'analysis', 'contract', 'list', '--chat', chatId, '--json'
  ], directory);
  assert.equal(listedContracts.code, 0, listedContracts.stderr);
  assert.equal(JSON.parse(listedContracts.stdout)[0].analysis_contract_id, contractId);
  assert.equal(invoke([
    'analysis', 'contract', 'verify', contractId
  ], directory).code, 0);

  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    analysisContractId: contractId,
    seeds: [1, 2],
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  const assessedResult = invoke([
    'analysis', 'assess', contractId, experiment.manifest.experiment_id,
    '--chat', chatId
  ], directory);
  assert.equal(assessedResult.code, 0, assessedResult.stderr);
  const assessed = JSON.parse(assessedResult.stdout);
  const assessmentId = assessed.assessment.manifest.analysis_assessment_id;
  assert.equal(assessed.assessment.report.status, 'pass');
  assert.equal(assessed.interaction.action, 'assessment.created');
  assert.equal(assessed.interaction_error, null);

  const listedAssessments = invoke([
    'analysis', 'assessment', 'list', '--contract', contractId, '--json'
  ], directory);
  assert.equal(listedAssessments.code, 0, listedAssessments.stderr);
  assert.equal(JSON.parse(listedAssessments.stdout)[0].analysis_assessment_id, assessmentId);
  const shown = invoke([
    'analysis', 'assessment', 'show', assessmentId
  ], directory);
  assert.equal(JSON.parse(shown.stdout).verification.ok, true);
  assert.equal(invoke([
    'analysis', 'assessment', 'verify', assessmentId
  ], directory).code, 0);

  const context = interactionAwarePrompt({
    cwd: directory,
    chatId,
    message: 'Summarize the result.'
  });
  assert.equal(context.context.count, 2);
  assert.match(context.prompt, /threshold outcome pass/);
});

test('Lab exposes interactive confirmatory creation, detail, harness, lineage, and AI handoff', async (context) => {
  const { directory, preregistration } = fixture();
  const chat = createChatSession({
    cwd: directory,
    title: 'Lab confirmatory workflow',
    agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const headers = {
    'Content-Type': 'application/json',
    Origin: details.url
  };
  const body = {
    chat_id: chatId,
    spec: contractSpec(preregistration.preregistration_id)
  };

  const crossOrigin = await fetch(details.url + '/api/analysis-contracts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example'
    },
    body: JSON.stringify(body)
  });
  assert.equal(crossOrigin.status, 403);
  const wrongMediaType = await fetch(details.url + '/api/analysis-contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: details.url },
    body: JSON.stringify(body)
  });
  assert.equal(wrongMediaType.status, 415);

  const contractResponse = await fetch(details.url + '/api/analysis-contracts', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  assert.equal(contractResponse.status, 201);
  const contractCreated = await contractResponse.json();
  const contractId = contractCreated.analysis_contract.manifest.analysis_contract_id;
  assert.equal(contractCreated.analysis_contract.verification.ok, true);
  assert.equal(contractCreated.interaction.action, 'contract.frozen');
  assert.equal(contractCreated.interaction_error, null);

  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    analysisContractId: contractId,
    seeds: [1, 2],
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  const assessmentResponse = await fetch(details.url + '/api/analysis-assessments', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      chat_id: chatId,
      analysis_contract_id: contractId,
      experiment_id: experiment.manifest.experiment_id
    })
  });
  assert.equal(assessmentResponse.status, 201);
  const assessmentCreated = await assessmentResponse.json();
  const assessmentId = assessmentCreated.assessment.manifest.analysis_assessment_id;
  assert.equal(assessmentCreated.assessment.report.status, 'pass');
  assert.equal(assessmentCreated.interaction.action, 'assessment.created');
  assert.equal(assessmentCreated.interaction_error, null);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.analysis_contracts, 1);
  assert.equal(state.counts.verified_analysis_contracts, 1);
  assert.equal(state.counts.confirmatory_assessments, 1);
  assert.equal(state.counts.prospective_confirmatory_assessments, 1);
  assert.equal(state.counts.confirmatory_assessments_needing_attention, 0);
  assert.equal(state.experiments[0].analysis_contract_id, contractId);

  const contracts = await (await fetch(
    details.url + '/api/analysis-contracts?chat=' + encodeURIComponent(chatId)
  )).json();
  assert.equal(contracts.summary.verified, 1);
  assert.equal(contracts.analysis_contracts[0].analysis_contract_id, contractId);
  const assessments = await (await fetch(
    details.url + '/api/analysis-assessments?contract=' + encodeURIComponent(contractId)
  )).json();
  assert.equal(assessments.summary.prospective, 1);
  assert.equal(assessments.assessments[0].analysis_assessment_id, assessmentId);

  const contractDetail = await (await fetch(
    details.url + '/api/analysis-contracts/' + encodeURIComponent(contractId)
  )).json();
  assert.equal(contractDetail.verification.ok, true);
  assert.equal(contractDetail.contract.outcomes[0].outcome_id, 'terminal_score');
  const assessmentDetail = await (await fetch(
    details.url + '/api/analysis-assessments/' + encodeURIComponent(assessmentId)
  )).json();
  assert.equal(assessmentDetail.verification.ok, true);
  assert.equal(assessmentDetail.report.registration.status, 'prospective');

  const lineage = await (await fetch(
    details.url + '/api/lineage?chat=' + encodeURIComponent(chatId)
  )).json();
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'analysis-assessment' && node.record_id === assessmentId
  ));
  const harness = await (await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/harness'
  )).json();
  assert.equal(harness.board.confirmatory.contracts[0].analysis_contract_id, contractId);
  assert.equal(harness.board.confirmatory.assessments[0].analysis_assessment_id, assessmentId);
  assert.equal(harness.board.validation.prospective_confirmatory_assessments, 1);

  const [indexSource, appSource, styleSource] = await Promise.all([
    fetch(details.url + '/').then((item) => item.text()),
    fetch(details.url + '/app.js').then((item) => item.text()),
    fetch(details.url + '/styles.css').then((item) => item.text())
  ]);
  assert.match(indexSource, /data-view="analysis"/);
  assert.match(appSource, /renderConfirmatoryWorkspace/);
  assert.match(appSource, /showAnalysisContractDetail/);
  assert.match(appSource, /showConfirmatoryAssessmentDetail/);
  assert.match(appSource, /\/api\/analysis-contracts/);
  assert.match(appSource, /\/api\/analysis-assessments/);
  assert.match(styleSource, /\.analysis-workspace/);
  assert.match(styleSource, /\.analysis-outcome-card/);

  const aiContext = interactionAwarePrompt({
    cwd: directory,
    chatId,
    message: 'Use my confirmatory workspace state.'
  });
  assert.equal(aiContext.context.count, 2);
  assert.match(aiContext.prompt, /registration prospective/);
});

test('audit registries expose removed records and project verification rejects assessment tampering', () => {
  const removedFixture = fixture();
  const removed = createAnalysisContract({
    cwd: removedFixture.directory,
    spec: contractSpec(removedFixture.preregistration.preregistration_id)
  });
  fs.rmSync(removed.directory, { recursive: true });
  const removedList = listAnalysisContracts(removedFixture.directory);
  assert.equal(removedList.length, 1);
  assert.equal(removedList[0].verified, false);
  assert.equal(verifyProject(removedFixture.directory).ok, false);

  const tamperedFixture = fixture();
  const contract = createAnalysisContract({
    cwd: tamperedFixture.directory,
    spec: contractSpec(tamperedFixture.preregistration.preregistration_id)
  });
  const experiment = runExperiment({
    cwd: tamperedFixture.directory,
    packageRoot,
    script: 'model.py',
    analysisContractId: contract.manifest.analysis_contract_id,
    seeds: [1, 2],
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  const assessment = createConfirmatoryAssessment({
    cwd: tamperedFixture.directory,
    contractId: contract.manifest.analysis_contract_id,
    experimentId: experiment.manifest.experiment_id
  });
  fs.appendFileSync(path.join(assessment.directory, 'report.json'), '\n');
  const verification = verifyConfirmatoryAssessment(
    tamperedFixture.directory,
    assessment.manifest.analysis_assessment_id
  );
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) =>
    error.file === 'report.json' && error.issue === 'hash_mismatch'
  ));
  assert.equal(verifyProject(tamperedFixture.directory).ok, false);
});

test('analysis stores reject filesystem-link escapes and impossible assessment timestamps', (context) => {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const contractFixture = fixture();
  const outsideContracts = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-contract-outside-'));
  const contractRoot = path.join(
    contractFixture.directory, '.sciencecode', 'analysis-contracts'
  );
  try {
    fs.symlinkSync(outsideContracts, contractRoot, linkType);
  } catch (error) {
    context.skip('Filesystem links are unavailable in this test environment: ' + error.code);
    return;
  }
  assert.throws(() => createAnalysisContract({
    cwd: contractFixture.directory,
    spec: contractSpec(contractFixture.preregistration.preregistration_id)
  }), { code: 'INVALID_ANALYSIS_CONTRACT_PATH' });
  assert.equal(fs.readdirSync(outsideContracts).length, 0);

  const assessmentFixture = fixture();
  const contract = createAnalysisContract({
    cwd: assessmentFixture.directory,
    spec: contractSpec(assessmentFixture.preregistration.preregistration_id)
  });
  const experiment = runExperiment({
    cwd: assessmentFixture.directory,
    packageRoot,
    script: 'model.py',
    analysisContractId: contract.manifest.analysis_contract_id,
    seeds: [1, 2],
    runtime: runtime(),
    gpuProbe: gpu,
    runner: simulationRunner
  });
  assert.throws(() => createConfirmatoryAssessment({
    cwd: assessmentFixture.directory,
    contractId: contract.manifest.analysis_contract_id,
    experimentId: experiment.manifest.experiment_id,
    now: new Date(0)
  }), { code: 'CONFIRMATORY_ASSESSMENT_TIME_INVALID' });

  const outsideAssessments = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-assessment-outside-')
  );
  fs.symlinkSync(
    outsideAssessments,
    path.join(assessmentFixture.directory, '.sciencecode', 'analysis-assessments'),
    linkType
  );
  assert.throws(() => createConfirmatoryAssessment({
    cwd: assessmentFixture.directory,
    contractId: contract.manifest.analysis_contract_id,
    experimentId: experiment.manifest.experiment_id
  }), { code: 'INVALID_CONFIRMATORY_ASSESSMENT_PATH' });
  assert.equal(fs.readdirSync(outsideAssessments).length, 0);
});
