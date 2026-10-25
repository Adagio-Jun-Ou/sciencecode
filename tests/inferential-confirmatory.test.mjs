import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION,
  CONFIRMATORY_INFERENTIAL_ENGINE_VERSION,
  CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION,
  STATISTICS_ENGINE_NAME,
  STATISTICS_ENGINE_VERSION,
  adjustPValues,
  createAnalysisContract,
  createChatSession,
  createConfirmatoryAssessment,
  evaluateConfirmatoryExperiment,
  freezePreregistration,
  getAnalysisContractBinding,
  interactionAwarePrompt,
  normalizeAnalysisContractSpec,
  oneSampleTTest,
  recordInteraction,
  confirmatoryAssessmentInteractionArtifact,
  confirmatoryAssessmentInteractionPayload,
  runExperiment,
  verifyAnalysisContract,
  verifyConfirmatoryAssessment,
  verifyExperiment,
  welchTTest
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function inferentialSpec(preregistrationId, overrides = {}) {
  return {
    schema_version: 3,
    name: 'Inferential latency contract',
    hypothesis: 'Mean latency exceeds 500 ms, and treatment latency differs from control.',
    preregistration_id: preregistrationId,
    script: 'analysis.py',
    analysis_population: 'All prespecified integrity-verified branches.',
    conditions: 'The frozen script runs for every prespecified seed and arm.',
    missing_data_policy: 'exclude_after_minimum_count',
    multiplicity_policy: 'Holm-Bonferroni over the two primary inferential outcomes.',
    multiplicity_correction: 'holm_bonferroni',
    outcomes: [
      {
        outcome_id: 'latency_gt_null',
        role: 'primary',
        label: 'Mean latency above the null',
        statistic: 'latency',
        variable: 'Terminal simulated latency',
        unit: { symbol: 'ms' },
        timepoint: 'Final step',
        summary_measure: 'One-sample t against 500 ms',
        intercurrent_event_strategy: 'Failed or invalid branches are missing.',
        aggregation: 'mean',
        minimum_count: 3,
        filter: {},
        decision_rule: { operator: 'greater_than', value: { value: 0.5, unit: 's' } },
        inference: {
          test: 'student_t_one_sample',
          sidedness: 'greater',
          alpha: 0.05,
          null_value: { value: 0.5, unit: 's' }
        }
      },
      {
        outcome_id: 'arm_difference',
        role: 'primary',
        label: 'Latency differs between arms',
        statistic: 'latency',
        variable: 'Terminal simulated latency',
        unit: { symbol: 'ms' },
        timepoint: 'Final step',
        summary_measure: 'Welch two-sample t between treatment and control arms',
        intercurrent_event_strategy: 'Failed or invalid branches are missing.',
        aggregation: 'mean',
        minimum_count: 4,
        filter: {},
        decision_rule: { operator: 'greater_than_or_equal', value: { value: 0, unit: 'ms' } },
        inference: {
          test: 'welch_t_two_sample',
          sidedness: 'two_sided',
          alpha: 0.05,
          null_value: { value: 0, unit: 'ms' },
          group_parameter: 'arm',
          group_a: 'treatment',
          group_b: 'control'
        }
      }
    ],
    sensitivity_analyses: [],
    exclusions: 'No post-result exclusions.',
    notes: 'Preregistered inferential replay fixture.',
    ...overrides
  };
}

function binding() {
  return {
    analysis_contract_id: 'analysis-contract-inferential',
    manifest_sha256: 'a'.repeat(64),
    contract_sha256: 'b'.repeat(64),
    created_at: '2026-08-20T12:00:00.000Z',
    preregistration_id: 'preregistration-inferential',
    preregistration_record_sha256: 'c'.repeat(64),
    script_sha256: 'd'.repeat(64),
    schema_version: 3,
    unit_engine_version: 1,
    statistics_engine_version: STATISTICS_ENGINE_VERSION
  };
}

function assessmentInputs(contract, results, branches) {
  const contractBinding = binding();
  const plan = {
    analysis_contract: contractBinding,
    script: { sha256: contractBinding.script_sha256 },
    branches
  };
  const experimentManifest = {
    analysis_contract: contractBinding,
    script: { sha256: contractBinding.script_sha256 },
    started_at: '2026-08-20T12:01:00.000Z',
    finished_at: '2026-08-20T12:02:00.000Z',
    status: 'completed',
    branch_count: branches.length,
    plan_sha256: 'e'.repeat(64)
  };
  return {
    contractId: contractBinding.analysis_contract_id,
    contractBinding,
    contract,
    experimentId: 'experiment-inferential',
    experimentManifest,
    experimentManifestSha256: 'f'.repeat(64),
    plan,
    results
  };
}

function branchResult(index, latencyMs) {
  return {
    branch_index: index,
    status: 'completed',
    verified: true,
    final_statistics: { latency: { value: latencyMs, unit: 'ms' } }
  };
}

test('schema v3 normalization freezes inference declarations and rejects invalid ones', () => {
  const contract = normalizeAnalysisContractSpec(inferentialSpec('preregistration-inferential'));
  assert.equal(contract.schema_version, ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION);
  assert.equal(contract.multiplicity_correction, 'holm_bonferroni');
  assert.deepEqual(contract.outcomes[0].inference.null_value, { value: 500, unit: 'ms' });
  assert.equal(contract.outcomes[1].inference.group_parameter, 'arm');

  assert.throws(() => normalizeAnalysisContractSpec(inferentialSpec('p', {
    multiplicity_correction: 'fdr'
  })), /multiplicity_correction/);
  assert.throws(() => normalizeAnalysisContractSpec(inferentialSpec('p', {
    outcomes: inferentialSpec('p').outcomes.map((outcome) => {
      const { inference, ...rest } = outcome;
      return rest;
    })
  })), /at least one primary outcome with a declared inference/);
  const badAlpha = inferentialSpec('p');
  badAlpha.outcomes[0].inference.alpha = 1;
  assert.throws(() => normalizeAnalysisContractSpec(badAlpha), /alpha/);
  const sameGroups = inferentialSpec('p');
  sameGroups.outcomes[1].inference.group_b = 'treatment';
  assert.throws(() => normalizeAnalysisContractSpec(sameGroups), /groups must differ/);
  const v2WithInference = inferentialSpec('p', { schema_version: 2 });
  delete v2WithInference.multiplicity_correction;
  assert.throws(() => normalizeAnalysisContractSpec(v2WithInference), /schema_version 3/);
});

test('inferential assessment replays preregistered t-tests with Holm correction', () => {
  const contract = normalizeAnalysisContractSpec(inferentialSpec('preregistration-inferential'));
  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  const treatment = [620, 655, 640];
  const control = [510, 505, 520];
  const results = [...treatment, ...control].map((value, index) => branchResult(index, value));
  const report = evaluateConfirmatoryExperiment(assessmentInputs(contract, results, branches));

  assert.equal(report.schema_version, CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION);
  assert.equal(report.engine.version, CONFIRMATORY_INFERENTIAL_ENGINE_VERSION);
  assert.deepEqual(report.inference, {
    statistics_engine: { name: STATISTICS_ENGINE_NAME, version: STATISTICS_ENGINE_VERSION },
    multiplicity_correction: 'holm_bonferroni',
    family: ['latency_gt_null', 'arm_difference'],
    family_size: 2
  });

  const oneSample = oneSampleTTest([...treatment, ...control], 500, 'greater');
  const twoSample = welchTTest(treatment, control, 'two_sided');
  const adjusted = adjustPValues([oneSample.p_value, twoSample.p_value], 'holm_bonferroni', 2);

  const first = report.outcomes[0];
  assert.equal(first.inference.p_value, oneSample.p_value);
  assert.equal(first.inference.adjusted_p_value, adjusted[0]);
  assert.equal(first.inference.conclusion, 'reject_null');
  assert.equal(first.status, 'pass');
  assert.equal(first.threshold_status, 'pass');

  const second = report.outcomes[1];
  assert.equal(second.inference.p_value, twoSample.p_value);
  assert.equal(second.inference.adjusted_p_value, adjusted[1]);
  assert.equal(second.inference.conclusion, 'reject_null');
  assert.equal(second.status, 'pass');
  // The preregistered arm identities must survive alongside the computed
  // group summaries.
  assert.equal(second.inference.group_a, 'treatment');
  assert.equal(second.inference.group_b, 'control');
  assert.equal(second.inference.group_a_summary.n, 3);
  assert.equal(second.inference.group_b_summary.n, 3);
  // Confidence intervals ride along at the unadjusted level in outcome units.
  const interval = second.inference.confidence_interval;
  assert.equal(interval.level, 0.95);
  assert.equal(interval.unit, 'ms');
  assert.equal(interval.adjusted_for_multiplicity, false);
  assert.ok(interval.lower > 0 && interval.upper > interval.lower);
  assert.equal(first.inference.confidence_interval.upper, null);
  assert.ok(first.inference.confidence_interval.lower > 500);
  assert.equal(report.summary.status, 'pass');
  assert.equal(report.summary.inference.rejected_null, 2);
  assert.equal(report.summary.inference.family_size, 2);
  assert.equal(report.summary.inference.multiplicity_correction, 'holm_bonferroni');

  const replay = evaluateConfirmatoryExperiment(assessmentInputs(contract, results, branches));
  assert.deepEqual(replay, report);
});

test('insufficient or degenerate data yields indeterminate inferential outcomes', () => {
  const contract = normalizeAnalysisContractSpec(inferentialSpec('preregistration-inferential'));
  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } }
  ];
  const results = [610, 630, 620, 505].map((value, index) => branchResult(index, value));
  const report = evaluateConfirmatoryExperiment(assessmentInputs(contract, results, branches));
  const twoSample = report.outcomes[1];
  assert.equal(twoSample.inference.reason, 'insufficient_group_observations');
  assert.equal(twoSample.inference.conclusion, 'indeterminate');
  assert.equal(twoSample.status, 'indeterminate');
  // The preregistered family size (2) still multiplies the one computable
  // p-value, so missing data cannot make a marginal result significant.
  const first = report.outcomes[0];
  assert.equal(first.inference.adjusted_p_value, Math.min(1, 2 * first.inference.p_value));
  assert.ok(first.inference.p_value < 0.05 && first.inference.adjusted_p_value > 0.05);
  assert.equal(first.inference.conclusion, 'fail_to_reject');
  assert.equal(report.summary.status, 'fail');
});

test('frozen v3 contracts pin both engines and verify end to end', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-inferential-'));
  fs.writeFileSync(path.join(directory, 'protocol.md'), '# Inferential protocol\n');
  fs.writeFileSync(path.join(directory, 'analysis.py'), 'print("inferential")\n');
  const preregistration = freezePreregistration(directory, 'protocol.md', {
    name: 'Inferential protocol'
  });
  const created = createAnalysisContract({
    cwd: directory,
    spec: inferentialSpec(preregistration.preregistration_id)
  });
  const id = created.manifest.analysis_contract_id;
  assert.equal(created.manifest.schema_version, ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION);
  assert.deepEqual(created.manifest.statistics_engine, {
    name: STATISTICS_ENGINE_NAME,
    version: STATISTICS_ENGINE_VERSION
  });
  assert.ok(created.manifest.unit_engine);
  const verification = verifyAnalysisContract(directory, id);
  assert.equal(verification.ok, true);
  const contractBinding = getAnalysisContractBinding(directory, id);
  assert.equal(contractBinding.schema_version, 3);
  assert.equal(contractBinding.statistics_engine_version, STATISTICS_ENGINE_VERSION);

  const manifestFile = path.join(
    directory, '.sciencecode', 'analysis-contracts', id, 'manifest.json'
  );
  const tampered = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  tampered.statistics_engine.version = 99;
  fs.writeFileSync(manifestFile, JSON.stringify(tampered));
  const invalid = verifyAnalysisContract(directory, id);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.issue === 'invalid_statistics_engine'));
});

test('inferential assessments replay end to end through real storage and reach the prompt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-inferential-e2e-'));
  fs.writeFileSync(path.join(directory, 'protocol.md'), [
    '# Inferential protocol',
    '',
    'Primary outcomes: mean latency above 500 ms, and treatment vs control arms.'
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'analysis.py'), 'print("inferential analysis")\n');
  const preregistration = freezePreregistration(directory, 'protocol.md', {
    name: 'Inferential latency protocol'
  });
  const chat = createChatSession({
    cwd: directory, title: 'Inferential latency study', agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  const contract = createAnalysisContract({
    cwd: directory,
    chatId,
    spec: inferentialSpec(preregistration.preregistration_id)
  });
  const contractId = contract.manifest.analysis_contract_id;
  assert.equal(contract.manifest.schema_version, 3);

  const latencies = {
    treatment: { 1: 620, 2: 655, 3: 640 },
    control: { 1: 510, 2: 505, 3: 520 }
  };
  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'analysis.py',
    name: 'Two-arm latency experiment',
    hypothesis: contract.contract.hypothesis,
    analysisContractId: contractId,
    seeds: [1, 2, 3],
    variations: { arm: ['treatment', 'control'] },
    device: 'cuda',
    runtime: {
      healthy: true,
      profile: 'gpu',
      paths: { python: process.execPath },
      manifest: { schema_version: 1, packages: [] },
      probe: {
        python: '3.11.9',
        torch: { version: 'test', cuda_runtime: 'test', cuda_available: true }
      }
    },
    gpuProbe: () => ({
      available: true,
      backend: 'nvidia',
      executable: 'nvidia-smi',
      devices: [{
        index: 0, name: 'Test GPU', uuid: 'GPU-inferential-e2e',
        memory_total_mib: 16311, memory_free_mib: 15000,
        driver_version: '610.47', compute_capability: '12.0'
      }],
      error: null
    }),
    runner(command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      const seed = Number(args[args.indexOf('--seed') + 1]);
      const parameters = JSON.parse(args[args.indexOf('--parameters-json') + 1]);
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        seed,
        device: { selected: 'cuda:0', name: 'Test GPU', peak_memory_bytes: 1024 }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        final_statistics: {
          latency: { value: latencies[parameters.arm][seed], unit: 'ms' }
        }
      }));
      return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
    }
  });
  assert.equal(experiment.manifest.status, 'completed');
  assert.equal(verifyExperiment(directory, experiment.manifest.experiment_id).ok, true);

  const assessment = createConfirmatoryAssessment({
    cwd: directory,
    chatId,
    contractId,
    experimentId: experiment.manifest.experiment_id
  });
  assert.equal(assessment.manifest.schema_version, 3);
  assert.equal(assessment.manifest.report.engine_version, 3);
  assert.equal(assessment.report.status, 'pass');
  assert.equal(assessment.report.summary.inference.rejected_null, 2);
  assert.equal(assessment.report.summary.inference.family_size, 2);
  const welch = assessment.report.outcomes[1].inference;
  assert.equal(welch.group_a, 'treatment');
  assert.ok(welch.adjusted_p_value < 0.05);
  assert.ok(welch.confidence_interval.lower > 0);
  assert.equal(welch.effect_size.method, 'cohens_d_average_variance');
  assert.ok(welch.effect_size.cohens_d > welch.effect_size.hedges_g);
  const verification = verifyConfirmatoryAssessment(
    directory, assessment.manifest.analysis_assessment_id);
  assert.equal(verification.ok, true);

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
    message: 'Interpret the inferential result.'
  });
  assert.match(context.prompt, /welch_t_two_sample p=/);
  assert.match(context.prompt, /after holm_bonferroni, cohens_d_average_variance d=/);
  // Accept negative and exponential renderings: a legitimate 'less' outcome or
  // a tiny effect must not fail this assertion.
  assert.match(context.prompt, /Hedges g=-?[\d.e+-]+\): reject_null/);
  assert.match(context.prompt, /normality and independence are assumed, not checked/);
  assert.doesNotMatch(context.prompt, /\[object Object\]/);
});

test('paired inferences match observations across arms by the preregistered pair key', () => {
  const spec = inferentialSpec('preregistration-inferential');
  spec.outcomes[1].inference = {
    test: 'student_t_paired',
    sidedness: 'two_sided',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control',
    pair_parameter: 'block'
  };
  const contract = normalizeAnalysisContractSpec(spec);
  assert.equal(contract.outcomes[1].inference.pair_parameter, 'block');

  const branches = [
    { index: 0, parameters: { arm: 'treatment', block: 1 } },
    { index: 1, parameters: { arm: 'treatment', block: 2 } },
    { index: 2, parameters: { arm: 'treatment', block: 3 } },
    { index: 3, parameters: { arm: 'control', block: 3 } },
    { index: 4, parameters: { arm: 'control', block: 1 } },
    { index: 5, parameters: { arm: 'control', block: 2 } }
  ];
  const values = [620, 655, 640, 520, 510, 505];
  const results = values.map((value, index) => branchResult(index, value));
  const report = evaluateConfirmatoryExperiment(assessmentInputs(contract, results, branches));
  const paired = report.outcomes[1].inference;
  assert.equal(paired.test, 'student_t_paired');
  assert.equal(paired.pairs, 3);
  // Pairs align by block regardless of branch order: (620-510, 655-505, 640-520).
  const expected = oneSampleTTest([110, 150, 120], 0, 'two_sided');
  assert.equal(paired.t, expected.t);
  assert.equal(paired.p_value, expected.p_value);
  assert.equal(paired.conclusion, 'reject_null');
  assert.equal(paired.pair_parameter, 'block');

  // A pair with only one arm present is excluded; too few pairs is loud.
  const sparseBranches = branches.slice(0, 4);
  const sparseResults = values.slice(0, 4).map((value, index) => branchResult(index, value));
  const sparse = evaluateConfirmatoryExperiment(
    assessmentInputs(contract, sparseResults, sparseBranches));
  assert.equal(sparse.outcomes[1].inference.reason, 'insufficient_pair_observations');
  assert.equal(sparse.outcomes[1].inference.conclusion, 'indeterminate');

  // Two observations for the same arm and pair key fail closed.
  const ambiguousBranches = [...branches,
    { index: 6, parameters: { arm: 'treatment', block: 1 } }];
  const ambiguousResults = [...results, branchResult(6, 999)];
  const ambiguous = evaluateConfirmatoryExperiment(
    assessmentInputs(contract, ambiguousResults, ambiguousBranches));
  assert.equal(ambiguous.outcomes[1].inference.reason, 'ambiguous_pairing');

  const missingPair = inferentialSpec('p');
  missingPair.outcomes[1].inference.test = 'student_t_paired';
  assert.throws(() => normalizeAnalysisContractSpec(missingPair), /pair_parameter/);
  const strayPair = inferentialSpec('p');
  strayPair.outcomes[0].inference.pair_parameter = 'block';
  assert.throws(() => normalizeAnalysisContractSpec(strayPair), /comparison groups or pairing/);

  const selfPair = inferentialSpec('p');
  selfPair.outcomes[1].inference.test = 'student_t_paired';
  selfPair.outcomes[1].inference.pair_parameter = 'arm';
  assert.throws(() => normalizeAnalysisContractSpec(selfPair),
    /pair_parameter must differ from group_parameter/);
});

test('pair ordering is codepoint-deterministic under collation-equal keys', () => {
  const spec = inferentialSpec('preregistration-inferential');
  spec.outcomes[1].inference = {
    test: 'student_t_paired',
    sidedness: 'two_sided',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control',
    pair_parameter: 'block'
  };
  const contract = normalizeAnalysisContractSpec(spec);
  // Three pair keys that a collation compare treats as equal (soft hyphens),
  // listed in two different branch orders; the report must be identical.
  const keys = ['ab', 'a­b', 'a­­b'];
  const build = (order) => {
    const branches = [];
    const results = [];
    let index = 0;
    for (const position of order) {
      for (const [arm, value] of [
        ['treatment', 600 + position * 17], ['control', 500 + position * 5]
      ]) {
        branches.push({ index, parameters: { arm, block: keys[position] } });
        results.push(branchResult(index, value));
        index += 1;
      }
    }
    return evaluateConfirmatoryExperiment(assessmentInputs(contract, results, branches));
  };
  const forward = build([0, 1, 2]);
  const shuffled = build([2, 0, 1]);
  assert.deepEqual(forward.outcomes[1].inference, shuffled.outcomes[1].inference);
});

test('records frozen under statistics engine v2 replay without effect sizes', () => {
  const contract = normalizeAnalysisContractSpec(inferentialSpec('preregistration-inferential'));
  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  const results = [620, 655, 640, 510, 505, 520]
    .map((value, index) => branchResult(index, value));
  const inputs = assessmentInputs(contract, results, branches);
  const legacy = evaluateConfirmatoryExperiment({
    ...inputs,
    contractBinding: { ...inputs.contractBinding, statistics_engine_version: 2 }
  });
  assert.equal(legacy.inference.statistics_engine.version, 2);
  for (const outcome of legacy.outcomes) {
    assert.equal(outcome.inference.effect_size, undefined);
    assert.ok(outcome.inference.confidence_interval);
  }
  const current = evaluateConfirmatoryExperiment(inputs);
  assert.equal(current.inference.statistics_engine.version, STATISTICS_ENGINE_VERSION);
  assert.ok(current.outcomes[0].inference.effect_size);
});

test('a declared nonzero Welch null difference drives the decision from engine v3', () => {
  const spec = inferentialSpec('preregistration-inferential');
  // Preregister superiority by at least 200 ms, which the data does not meet.
  spec.outcomes[1].inference.null_value = { value: 200, unit: 'ms' };
  spec.outcomes[1].inference.sidedness = 'greater';
  const contract = normalizeAnalysisContractSpec(spec);
  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  const results = [620, 655, 640, 510, 505, 520]
    .map((value, index) => branchResult(index, value));
  const inputs = assessmentInputs(contract, results, branches);
  const report = evaluateConfirmatoryExperiment(inputs);
  const welch = report.outcomes[1].inference;
  // Observed difference is ~127 ms, short of the 200 ms null, so a
  // superiority test cannot reject.
  assert.equal(welch.conclusion, 'fail_to_reject');
  assert.equal(welch.t, welchTTest([620, 655, 640], [510, 505, 520], 'greater', 200).t);
  assert.ok(welch.effect_size.cohens_d < 0);

  // A v2 record ignored the declared null and must keep replaying that way.
  const legacy = evaluateConfirmatoryExperiment({
    ...inputs,
    contractBinding: { ...inputs.contractBinding, statistics_engine_version: 2 }
  });
  assert.equal(legacy.outcomes[1].inference.t,
    welchTTest([620, 655, 640], [510, 505, 520], 'greater', 0).t);
  assert.equal(legacy.outcomes[1].inference.conclusion, 'reject_null');
});

test('equivalence outcomes run TOST and conclude in equivalence vocabulary', () => {
  const spec = inferentialSpec('preregistration-inferential');
  spec.outcomes[1].inference = {
    test: 'welch_t_two_sample',
    sidedness: 'equivalence',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    equivalence_lower: { value: -50, unit: 'ms' },
    equivalence_upper: { value: 50, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control'
  };
  const contract = normalizeAnalysisContractSpec(spec);
  assert.deepEqual(contract.outcomes[1].inference.equivalence, {
    lower: { value: -50, unit: 'ms' },
    upper: { value: 50, unit: 'ms' },
    kind: 'equivalence'
  });

  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  // Arms differ by ~2 ms, far inside the +/-50 ms equivalence bounds.
  const equivalentResults = [501, 503, 502, 500, 501, 500]
    .map((value, index) => branchResult(index, value));
  const report = evaluateConfirmatoryExperiment(
    assessmentInputs(contract, equivalentResults, branches));
  const inference = report.outcomes[1].inference;
  assert.equal(inference.conclusion, 'equivalent');
  assert.equal(report.outcomes[1].status, 'pass');
  assert.equal(inference.tost.p_value, Math.max(inference.tost.p_lower, inference.tost.p_upper));
  assert.equal(inference.p_value, inference.tost.p_value);
  assert.deepEqual(inference.equivalence, {
    lower: { value: -50, unit: 'ms' },
    upper: { value: 50, unit: 'ms' },
    kind: 'equivalence'
  });
  // The reported interval is the 1 - 2*alpha two-sided interval.
  assert.ok(inference.confidence_interval.level === 0.9);
  // A superiority t against a different null must not sit beside the TOST
  // p-value where a reader would try to recompute one from the other.
  assert.equal(inference.t, undefined);
  // Family counts still partition the family.
  const summary = report.summary.inference;
  assert.equal(summary.margin_claims_established, 1);
  assert.equal(
    summary.rejected_null + summary.failed_to_reject + summary.indeterminate,
    summary.family_size
  );

  // Arms differing by ~120 ms are not equivalent within the same bounds.
  const differentResults = [620, 655, 640, 510, 505, 520]
    .map((value, index) => branchResult(index, value));
  const different = evaluateConfirmatoryExperiment(
    assessmentInputs(contract, differentResults, branches));
  assert.equal(different.outcomes[1].inference.conclusion, 'not_equivalent');
  assert.equal(different.outcomes[1].status, 'fail');

  const missingBounds = inferentialSpec('p');
  missingBounds.outcomes[1].inference.sidedness = 'equivalence';
  assert.throws(() => normalizeAnalysisContractSpec(missingBounds),
    /requires equivalence_lower, equivalence_upper, or both/);
  const strayBounds = inferentialSpec('p');
  strayBounds.outcomes[1].inference.equivalence_lower = { value: -1, unit: 'ms' };
  assert.throws(() => normalizeAnalysisContractSpec(strayBounds),
    /require sidedness "equivalence"/);
  const wideAlpha = inferentialSpec('p');
  wideAlpha.outcomes[1].inference.sidedness = 'equivalence';
  wideAlpha.outcomes[1].inference.alpha = 0.5;
  wideAlpha.outcomes[1].inference.equivalence_lower = { value: -50, unit: 'ms' };
  wideAlpha.outcomes[1].inference.equivalence_upper = { value: 50, unit: 'ms' };
  assert.throws(() => normalizeAnalysisContractSpec(wideAlpha), /alpha must be below 0.5/);
  const unbracketed = inferentialSpec('p');
  unbracketed.outcomes[1].inference.sidedness = 'equivalence';
  unbracketed.outcomes[1].inference.equivalence_lower = { value: 10, unit: 'ms' };
  unbracketed.outcomes[1].inference.equivalence_upper = { value: 50, unit: 'ms' };
  assert.throws(() => normalizeAnalysisContractSpec(unbracketed),
    /lower bound must lie below the declared null/);
});

test('one-sided non-inferiority margins are preregisterable and evaluated', () => {
  const spec = inferentialSpec('preregistration-inferential');
  spec.outcomes[1].inference = {
    test: 'welch_t_two_sample',
    sidedness: 'equivalence',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    equivalence_lower: { value: -50, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control'
  };
  const contract = normalizeAnalysisContractSpec(spec);
  assert.equal(contract.outcomes[1].inference.equivalence.kind, 'non_inferiority');
  assert.equal(contract.outcomes[1].inference.equivalence.upper, undefined);

  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  // Treatment is far above control, so it is not worse by 50 ms.
  const report = evaluateConfirmatoryExperiment(assessmentInputs(
    contract,
    [620, 655, 640, 510, 505, 520].map((value, index) => branchResult(index, value)),
    branches
  ));
  const inference = report.outcomes[1].inference;
  assert.equal(inference.conclusion, 'non_inferior');
  assert.equal(report.outcomes[1].status, 'pass');
  assert.equal(inference.tost.kind, 'non_inferiority');
  assert.equal(inference.tost.p_upper, null);
  // A one-bound decision matches the one-sided 1 - alpha interval.
  assert.equal(inference.confidence_interval.level, 0.95);
  assert.equal(inference.confidence_interval.upper, null);
  assert.equal(report.summary.inference.margin_claims_established, 1);

  // Treatment far below control fails the same non-inferiority margin.
  const worse = evaluateConfirmatoryExperiment(assessmentInputs(
    contract,
    [300, 305, 310, 510, 505, 520].map((value, index) => branchResult(index, value)),
    branches
  ));
  assert.equal(worse.outcomes[1].inference.conclusion, 'not_non_inferior');
  assert.equal(worse.outcomes[1].status, 'fail');

  const noBounds = inferentialSpec('p');
  noBounds.outcomes[1].inference.sidedness = 'equivalence';
  assert.throws(() => normalizeAnalysisContractSpec(noBounds),
    /equivalence_lower, equivalence_upper, or both/);
  const wrongSide = inferentialSpec('p');
  wrongSide.outcomes[1].inference.sidedness = 'equivalence';
  wrongSide.outcomes[1].inference.equivalence_lower = { value: 10, unit: 'ms' };
  assert.throws(() => normalizeAnalysisContractSpec(wrongSide),
    /lower bound must lie below the declared null/);
});

test('an assessment frozen under an older statistics engine replays byte-identically', () => {
  const contract = normalizeAnalysisContractSpec(inferentialSpec('preregistration-inferential'));
  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  const results = [620, 655, 640, 510, 505, 520]
    .map((value, index) => branchResult(index, value));
  const inputs = assessmentInputs(contract, results, branches);
  const forVersion = (version) => evaluateConfirmatoryExperiment({
    ...inputs,
    contractBinding: { ...inputs.contractBinding, statistics_engine_version: version }
  });

  // v0.41.0 shipped statistics engine v2. Its report shape and disclosure text
  // are frozen: anything added since must not appear when replaying it, or the
  // record's own verification would reject it.
  const v2 = forVersion(2);
  assert.equal(v2.inference.statistics_engine.version, 2);
  assert.equal(v2.summary.inference.margin_claims_established, undefined);
  assert.equal(v2.outcomes[0].inference.effect_size, undefined);
  assert.ok(v2.interpretation.some((line) =>
    line === 'Confidence intervals match each test\'s sidedness at the unadjusted level; the multiplicity correction applies to decisions, not intervals.'));
  assert.ok(v2.interpretation.every((line) => !line.includes('margin-claim')));

  // v3 added effect sizes but not margin claims.
  const v3 = forVersion(3);
  assert.ok(v3.outcomes[0].inference.effect_size);
  assert.equal(v3.summary.inference.margin_claims_established, undefined);
  assert.ok(v3.interpretation.every((line) => !line.includes('margin-claim')));

  // The current engine reports both.
  const current = forVersion(STATISTICS_ENGINE_VERSION);
  assert.equal(current.summary.inference.margin_claims_established, 0);
  assert.ok(current.outcomes[0].inference.effect_size);
  assert.ok(current.interpretation.some((line) => line.includes('margin-claim')));

  // Replay is stable within each generation.
  assert.deepEqual(forVersion(2), v2);
  assert.deepEqual(forVersion(3), v3);
});

test('a rank-based test is preregisterable and assessed without a normality claim', () => {
  const spec = inferentialSpec('preregistration-inferential');
  spec.outcomes[1].inference = {
    test: 'mann_whitney_u',
    sidedness: 'two_sided',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control'
  };
  const contract = normalizeAnalysisContractSpec(spec);
  assert.equal(contract.outcomes[1].inference.test, 'mann_whitney_u');

  const branches = [
    { index: 0, parameters: { arm: 'treatment' } },
    { index: 1, parameters: { arm: 'treatment' } },
    { index: 2, parameters: { arm: 'treatment' } },
    { index: 3, parameters: { arm: 'control' } },
    { index: 4, parameters: { arm: 'control' } },
    { index: 5, parameters: { arm: 'control' } }
  ];
  // One extreme outlier: a rank test is unmoved by its magnitude, which is
  // the reason to preregister one.
  const results = [620, 655, 999999, 510, 505, 520]
    .map((value, index) => branchResult(index, value));
  const report = evaluateConfirmatoryExperiment(
    assessmentInputs(contract, results, branches));
  const inference = report.outcomes[1].inference;

  assert.equal(inference.test, 'mann_whitney_u');
  assert.equal(inference.method, 'exact');
  assert.equal(typeof inference.p_value, 'number');
  // The interval is distribution-free, not a t interval.
  assert.match(inference.confidence_interval.method, /^distribution_free/);
  assert.equal(inference.confidence_interval.unit, 'ms');
  // The effect size is rank-biserial, not Cohen's d.
  assert.equal(inference.effect_size.method, 'rank_biserial_correlation');
  assert.ok(Math.abs(inference.effect_size.value) <= 1);
  // No t statistic is claimed for a test that has none.
  assert.equal(inference.t, undefined);

  // The paired form requires a pair parameter, since without one there is
  // nothing to difference.
  const paired = inferentialSpec('p');
  paired.outcomes[1].inference = {
    test: 'wilcoxon_signed_rank',
    sidedness: 'two_sided',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control'
  };
  assert.throws(() => normalizeAnalysisContractSpec(paired), /requires a pair_parameter/);

  // Rank tests have no equivalence formulation.
  const equivalence = inferentialSpec('p');
  equivalence.outcomes[1].inference = {
    test: 'mann_whitney_u',
    sidedness: 'equivalence',
    alpha: 0.05,
    null_value: { value: 0, unit: 'ms' },
    equivalence_lower: { value: -50, unit: 'ms' },
    equivalence_upper: { value: 50, unit: 'ms' },
    group_parameter: 'arm',
    group_a: 'treatment',
    group_b: 'control'
  };
  assert.throws(() => normalizeAnalysisContractSpec(equivalence),
    /rank-based tests do not support equivalence/);
});
