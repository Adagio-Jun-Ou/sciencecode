import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYSIS_CONTRACT_SCHEMA_VERSION,
  CONFIRMATORY_ASSESSMENT_SCHEMA_VERSION,
  CONFIRMATORY_ENGINE_VERSION,
  analysisContractInteractionArtifact,
  analysisContractInteractionPayload,
  confirmatoryAssessmentInteractionArtifact,
  confirmatoryAssessmentInteractionPayload,
  createAnalysisContract,
  createChatSession,
  createConfirmatoryAssessment,
  evaluateConfirmatoryExperiment,
  freezePreregistration,
  getAnalysisContractBinding,
  interactionAwarePrompt,
  normalizeAnalysisContractSpec,
  recordInteraction,
  runExperiment,
  sha256File,
  verifyAnalysisContract,
  verifyConfirmatoryAssessment,
  verifyExperiment
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function typedContractSpec(preregistrationId, overrides = {}) {
  return {
    schema_version: 2,
    name: 'Typed latency contract',
    hypothesis: 'Mean latency is at least 550 milliseconds.',
    preregistration_id: preregistrationId,
    script: 'analysis.py',
    analysis_population: 'All prespecified integrity-verified branches.',
    conditions: 'The frozen script is run for seeds 1 and 2.',
    missing_data_policy: 'fail',
    multiplicity_policy: 'One primary outcome.',
    outcomes: [{
      outcome_id: 'latency',
      role: 'primary',
      label: 'Mean latency',
      statistic: 'latency',
      variable: 'Terminal simulated latency',
      unit: { symbol: 'ms' },
      timepoint: 'Final step',
      summary_measure: 'Arithmetic mean across prespecified seeds',
      intercurrent_event_strategy: 'Any failed, missing, or invalid quantity is missing.',
      aggregation: 'mean',
      minimum_count: 2,
      filter: {},
      decision_rule: {
        operator: 'greater_than_or_equal',
        value: { value: 0.55, unit: 's' }
      }
    }],
    sensitivity_analyses: [],
    exclusions: 'No post-result exclusions.',
    notes: 'Typed deterministic threshold replay only.',
    ...overrides
  };
}

function binding() {
  return {
    analysis_contract_id: 'analysis-contract-typed',
    manifest_sha256: 'a'.repeat(64),
    contract_sha256: 'b'.repeat(64),
    created_at: '2026-08-10T12:00:00.000Z',
    preregistration_id: 'preregistration-typed',
    preregistration_record_sha256: 'c'.repeat(64),
    script_sha256: 'd'.repeat(64),
    schema_version: 2,
    unit_engine_version: 1
  };
}

function assessmentInputs(contract, results) {
  const contractBinding = binding();
  const plan = {
    analysis_contract: contractBinding,
    script: { sha256: contractBinding.script_sha256 },
    branches: [{ index: 0, parameters: {} }, { index: 1, parameters: {} }]
  };
  const experimentManifest = {
    analysis_contract: contractBinding,
    script: { sha256: contractBinding.script_sha256 },
    started_at: '2026-08-10T12:01:00.000Z',
    finished_at: '2026-08-10T12:02:00.000Z',
    status: 'completed',
    branch_count: 2,
    plan_sha256: 'e'.repeat(64)
  };
  return {
    contractId: contractBinding.analysis_contract_id,
    contractBinding,
    contract,
    experimentId: 'experiment-typed',
    experimentManifest,
    experimentManifestSha256: 'f'.repeat(64),
    plan,
    results
  };
}

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: [] },
    probe: {
      python: '3.11.9',
      torch: { version: 'test', cuda_runtime: 'test', cuda_available: true }
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
      name: 'Test GPU',
      uuid: 'GPU-typed-confirmatory',
      memory_total_mib: 16_384,
      memory_free_mib: 16_000,
      driver_version: 'test',
      compute_capability: 'test'
    }],
    error: null
  };
}

test('schema-v2 contracts normalize unit declarations and convert typed decision bounds', () => {
  const contract = normalizeAnalysisContractSpec(typedContractSpec('preregistration-typed'));
  assert.equal(contract.schema_version, ANALYSIS_CONTRACT_SCHEMA_VERSION);
  assert.deepEqual(contract.outcomes[0].unit, {
    symbol: 'ms', dimension: 'time', canonical_unit: 's'
  });
  assert.deepEqual(contract.outcomes[0].decision_rule.value, { value: 550, unit: 'ms' });

  const interval = typedContractSpec('preregistration-typed');
  interval.outcomes[0].decision_rule = {
    operator: 'between_inclusive',
    lower: { value: 0.5, unit: 's' },
    upper: { value: 750, unit: 'ms' }
  };
  assert.deepEqual(normalizeAnalysisContractSpec(interval).outcomes[0].decision_rule, {
    operator: 'between_inclusive',
    lower: { value: 500, unit: 'ms' },
    upper: { value: 750, unit: 'ms' }
  });

  const invalid = typedContractSpec('preregistration-typed');
  invalid.outcomes[0].decision_rule.value = { value: 1, unit: 'm' };
  assert.throws(() => normalizeAnalysisContractSpec(invalid), {
    code: 'INVALID_ANALYSIS_CONTRACT'
  });
  assert.throws(() => normalizeAnalysisContractSpec({
    ...typedContractSpec('preregistration-typed'),
    schema_version: 3
  }), { code: 'INVALID_ANALYSIS_CONTRACT' });

  const bareThreshold = typedContractSpec('preregistration-typed');
  bareThreshold.outcomes[0].decision_rule.value = 550;
  assert.throws(() => normalizeAnalysisContractSpec(bareThreshold), {
    code: 'INVALID_ANALYSIS_CONTRACT'
  });
  const freeTextUnit = typedContractSpec('preregistration-typed');
  freeTextUnit.outcomes[0].unit = 'ms';
  assert.throws(() => normalizeAnalysisContractSpec(freeTextUnit), {
    code: 'INVALID_ANALYSIS_CONTRACT'
  });

  const legacy = typedContractSpec('preregistration-typed');
  legacy.schema_version = 1;
  legacy.outcomes[0].unit = 'milliseconds';
  legacy.outcomes[0].decision_rule.value = 550;
  const normalizedLegacy = normalizeAnalysisContractSpec(legacy);
  assert.equal(Object.hasOwn(normalizedLegacy, 'schema_version'), false);
  assert.equal(normalizedLegacy.outcomes[0].unit, 'milliseconds');
  assert.equal(normalizedLegacy.outcomes[0].decision_rule.value, 550);
});

test('typed confirmatory replay converts observations and makes unit faults indeterminate', () => {
  const contract = normalizeAnalysisContractSpec(typedContractSpec('preregistration-typed'));
  const validResults = [{
    branch_index: 0,
    status: 'completed',
    verified: true,
    final_statistics: { latency: { value: 500, unit: 'ms' } }
  }, {
    branch_index: 1,
    status: 'completed',
    verified: true,
    final_statistics: { latency: { value: 0.7, unit: 's' } }
  }];
  const report = evaluateConfirmatoryExperiment(assessmentInputs(contract, validResults));
  assert.equal(report.schema_version, CONFIRMATORY_ASSESSMENT_SCHEMA_VERSION);
  assert.equal(report.engine.version, CONFIRMATORY_ENGINE_VERSION);
  assert.equal(report.status, 'pass');
  assert.equal(report.outcomes[0].aggregate_value, 600);
  assert.deepEqual(report.outcomes[0].aggregate_quantity, { value: 600, unit: 'ms' });
  assert.deepEqual(report.outcomes[0].observations, [{
    branch_index: 0,
    value: 500,
    unit: 'ms',
    source_value: 500,
    source_unit: 'ms',
    converted: false
  }, {
    branch_index: 1,
    value: 700,
    unit: 'ms',
    source_value: 0.7,
    source_unit: 's',
    converted: true
  }]);

  const invalidResults = structuredClone(validResults);
  invalidResults[0].final_statistics.latency = 500;
  invalidResults[1].final_statistics.latency = { value: 2, unit: 'm' };
  const invalid = evaluateConfirmatoryExperiment(assessmentInputs(contract, invalidResults));
  assert.equal(invalid.status, 'indeterminate');
  assert.deepEqual(invalid.outcomes[0].missing.map((item) => item.reason), [
    'statistic_requires_typed_quantity',
    'statistic_unit_mismatch'
  ]);
  assert.equal(invalid.outcomes[0].aggregate_quantity, null);

  const overflowSpec = typedContractSpec('preregistration-typed');
  overflowSpec.outcomes[0].unit = { symbol: 'kg' };
  overflowSpec.outcomes[0].decision_rule.value = { value: 0, unit: 'kg' };
  const overflowContract = normalizeAnalysisContractSpec(overflowSpec);
  const overflowResults = validResults.map((result) => ({
    ...result,
    final_statistics: { latency: { value: Number.MAX_VALUE, unit: 'kg' } }
  }));
  const overflow = evaluateConfirmatoryExperiment(
    assessmentInputs(overflowContract, overflowResults)
  );
  assert.equal(overflow.status, 'indeterminate');
  assert.equal(overflow.outcomes[0].calculation_error, 'aggregate_nonfinite');
  assert.equal(overflow.outcomes[0].aggregate_quantity, null);
});

test('typed records bind unit-engine provenance and replay end to end', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-typed-analysis-'));
  fs.writeFileSync(path.join(directory, 'protocol.md'), [
    '# Typed protocol',
    '',
    'Primary outcome: mean latency in milliseconds.',
    'Every final statistic is emitted as an explicit typed quantity.'
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'analysis.py'), 'print("typed analysis")\n');
  const preregistration = freezePreregistration(directory, 'protocol.md', {
    name: 'Typed latency protocol'
  });
  const chat = createChatSession({
    cwd: directory,
    title: 'Typed latency study',
    agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  const contract = createAnalysisContract({
    cwd: directory,
    chatId,
    spec: typedContractSpec(preregistration.preregistration_id)
  });
  const contractId = contract.manifest.analysis_contract_id;
  assert.equal(contract.manifest.schema_version, 2);
  assert.deepEqual(contract.manifest.unit_engine, {
    name: 'sciencecode-bounded-units', version: 1
  });
  assert.equal(verifyAnalysisContract(directory, contractId).ok, true);
  assert.equal(getAnalysisContractBinding(directory, contractId).schema_version, 2);
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
    script: 'analysis.py',
    analysisContractId: contractId,
    seeds: [1, 2],
    device: 'cuda',
    runtime: runtime(),
    gpuProbe: gpu,
    runner(command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      const seed = Number(args[args.indexOf('--seed') + 1]);
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        seed,
        device: { selected: 'cuda:0', name: 'Test GPU', peak_memory_bytes: 1024 }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        final_statistics: {
          latency: seed === 1
            ? { value: 500, unit: 'ms' }
            : { value: 0.7, unit: 's' }
        }
      }));
      return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
    }
  });
  assert.equal(experiment.manifest.status, 'completed');
  assert.equal(experiment.review.schema_version, 2);
  assert.equal(experiment.review.quantity_aggregates.latency.mean, 0.6);
  assert.equal(experiment.review.quantity_aggregates.latency.unit, 's');
  assert.equal(verifyExperiment(directory, experiment.manifest.experiment_id).ok, true);

  const assessment = createConfirmatoryAssessment({
    cwd: directory,
    chatId,
    contractId,
    experimentId: experiment.manifest.experiment_id
  });
  assert.equal(assessment.manifest.schema_version, 2);
  assert.equal(assessment.manifest.report.engine_version, 2);
  assert.equal(assessment.report.status, 'pass');
  assert.equal(assessment.report.outcomes[0].aggregate_value, 600);
  assert.equal(verifyConfirmatoryAssessment(
    directory,
    assessment.manifest.analysis_assessment_id
  ).ok, true);
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
    message: 'Interpret the typed result.'
  });
  assert.match(context.prompt, /latency greater_than_or_equal 550 ms/);
  assert.match(context.prompt, /latency=600 ms \[pass\]/);
  assert.doesNotMatch(context.prompt, /\[object Object\]/);

  const contractDirectory = path.join(
    directory, '.sciencecode', 'analysis-contracts', contractId
  );
  const manifestFile = path.join(contractDirectory, 'manifest.json');
  const tamperedManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  tamperedManifest.unit_engine.version = 999;
  fs.writeFileSync(manifestFile, JSON.stringify(tamperedManifest, null, 2) + '\n');
  fs.writeFileSync(
    path.join(contractDirectory, 'manifest.sha256'),
    sha256File(manifestFile) + '\n'
  );
  const tampered = verifyAnalysisContract(directory, contractId);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.issue === 'invalid_unit_engine'));
});
