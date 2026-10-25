import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHarnessView,
  buildLineageGraph,
  createChatSession,
  createProcedure,
  createProcedureAssessment,
  createProcedureDecision,
  evaluateProcedurePlan,
  getChatSession,
  ingestEvidence,
  interactionAwarePrompt,
  listProcedureAssessments,
  listProcedureDecisions,
  listProcedures,
  normalizeProcedureSpec,
  procedureAssessmentInteractionArtifact,
  procedureAssessmentInteractionPayload,
  procedureDecisionInteractionArtifact,
  procedureDecisionInteractionPayload,
  procedureInteractionArtifact,
  procedureInteractionPayload,
  recordInteraction,
  sendChatMessage,
  startLab,
  verifyProcedure,
  verifyProcedureAssessment,
  verifyProcedureDecision,
  verifyProject
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(prefix = 'sciencecode-procedure-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(directory, 'assay-method.md'), [
    '# Reference assay method',
    '',
    'Use positive and vehicle controls, calibrated liquid handling, and a plate reader.',
    'Stop when containment, calibration, or control acceptance conditions fail.'
  ].join('\n') + '\n');
  const evidence = ingestEvidence({
    cwd: directory,
    source: 'assay-method.md',
    title: 'Reference assay method'
  });
  const chat = createChatSession({
    cwd: directory,
    title: 'Procedure review',
    agent: 'scientist'
  });
  return {
    directory,
    evidenceId: evidence.manifest.evidence_id,
    chatId: chat.manifest.chat_id
  };
}

function readySpec(evidenceId, overrides = {}) {
  const value = {
    name: 'Reference compound response assay',
    objective: 'Measure a prespecified compound response against reference and vehicle controls.',
    domain: 'drug_discovery',
    context_of_use: 'Design review and external facility planning only.',
    source_evidence_ids: [evidenceId],
    materials: [
      {
        material_id: 'compound',
        name: 'Test compound',
        role: 'sample',
        amount: { value: 100, unit: 'uL' },
        concentration: '10 uM',
        source: 'Qualified external inventory',
        storage: 'Per supplier documentation',
        sds_required: true
      },
      {
        material_id: 'reference',
        name: 'Reference control',
        role: 'control',
        amount: { value: 50, unit: 'uL' },
        concentration: '10 uM',
        source: 'Qualified external inventory',
        storage: 'Per supplier documentation',
        sds_required: true
      },
      {
        material_id: 'vehicle',
        name: 'Vehicle control',
        role: 'control',
        amount: { value: 50, unit: 'uL' },
        source: 'Qualified external inventory',
        storage: 'Per supplier documentation',
        sds_required: true
      }
    ],
    equipment: [
      {
        equipment_id: 'pipette',
        name: 'Calibrated pipette',
        purpose: 'Controlled liquid transfer',
        operating_limits: 'Use only within the current calibration range.',
        calibration_required: true,
        qualification_required: true
      },
      {
        equipment_id: 'reader',
        name: 'Plate reader',
        purpose: 'Acquire the response measurement',
        operating_limits: 'Use a qualified method and verified settings.',
        calibration_required: true,
        qualification_required: true
      }
    ],
    controls: [
      {
        control_id: 'positive-control',
        type: 'positive',
        label: 'Reference response',
        purpose: 'Confirm assay responsiveness.',
        acceptance_criterion: 'Meets the frozen facility-specific response range.'
      },
      {
        control_id: 'vehicle-control',
        type: 'vehicle',
        label: 'Vehicle baseline',
        purpose: 'Estimate the vehicle-only baseline.',
        acceptance_criterion: 'Meets the frozen facility-specific baseline range.'
      }
    ],
    hazards: [
      {
        hazard_id: 'chemical-exposure',
        category: 'chemical',
        severity: 'moderate',
        description: 'Potential exposure while handling research compounds.',
        worst_case: 'Uncontrolled contact or release.',
        controls: [
          {
            type: 'engineering',
            description: 'Use the facility-approved containment system.',
            verification: 'Qualified staff verify containment before work.'
          },
          {
            type: 'ppe',
            description: 'Use PPE selected by the facility risk assessment.',
            verification: 'Qualified staff verify PPE selection and condition.'
          }
        ],
        emergency_response: 'Stop work and follow the facility spill and exposure plan.',
        applies_to_steps: ['prepare']
      }
    ],
    steps: [
      {
        step_id: 'prepare',
        title: 'Prepare controlled plate',
        operation: 'transfer',
        instruction: 'Qualified external staff prepare sample, reference, and vehicle conditions.',
        depends_on: [],
        materials: [
          { material_id: 'compound', amount: { value: 20, unit: 'uL' } },
          { material_id: 'reference', amount: { value: 20, unit: 'uL' } },
          { material_id: 'vehicle', amount: { value: 20, unit: 'uL' } }
        ],
        equipment_ids: ['pipette'],
        parameters: [{ name: 'replicates', value: 3 }],
        duration: { value: 5, unit: 'minutes' },
        expected_observation: 'The planned wells are populated without visible deviation.',
        acceptance_criterion: 'All planned conditions and controls are present.',
        on_deviation: 'Stop and document the deviation; do not continue.',
        hazard_ids: ['chemical-exposure'],
        risk_note: 'Requires facility-specific containment and staff training.',
        outputs: ['Prepared controlled plate']
      },
      {
        step_id: 'measure',
        title: 'Acquire response',
        operation: 'measure',
        instruction: 'Qualified external staff acquire the frozen response measurement.',
        depends_on: ['prepare'],
        materials: [],
        equipment_ids: ['reader'],
        parameters: [{ name: 'method', value: 'qualified frozen method' }],
        duration: { value: 10, unit: 'minutes' },
        expected_observation: 'A complete response record is produced.',
        acceptance_criterion: 'Positive and vehicle controls satisfy their frozen criteria.',
        on_deviation: 'Stop analysis and open a deviation record.',
        hazard_ids: [],
        risk_note: 'No new physical handling is planned during acquisition.',
        outputs: ['Immutable response dataset']
      }
    ],
    acceptance_criteria: [
      {
        criterion_id: 'assay-validity',
        label: 'Assay validity',
        measure: 'Positive and vehicle control performance',
        rule: 'Both frozen control criteria must pass before interpretation.'
      }
    ],
    stop_conditions: [
      'Containment, equipment qualification, or control acceptance cannot be verified.'
    ],
    training_requirements: [
      'Facility-approved chemical handling and equipment training.'
    ],
    emergency_procedures: [
      'Stop work, secure the area, and follow the facility emergency plan.'
    ],
    waste_and_decontamination:
      'Qualified external staff apply the facility chemical hygiene and waste plan.',
    automation_targets: ['xdl_2_0', 'opentrons_python'],
    physical_execution_policy: 'external_human_control_only',
    notes: 'ScienceCode performs only a non-executing logical dry-run.',
    ...overrides
  };
  return value;
}

function at(value) {
  return new Date(value);
}

function decisionInput(procedureId, assessmentId, overrides = {}) {
  return {
    procedure_id: procedureId,
    procedure_assessment_id: assessmentId,
    decision: 'approve',
    scope: 'external_physical_execution',
    reviewer_name: 'Dr. Human Reviewer',
    reviewer_role: 'Qualified facility reviewer',
    organization: 'External laboratory',
    basis: 'Reviewed the exact frozen plan and deterministic assessment.',
    conditions: 'Facility authorization, validation, training, and safety controls remain mandatory.',
    expires_at: '2026-09-01T00:00:00.000Z',
    attestation: true,
    ...overrides
  };
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

function addProcedureTurn(directory, chatId) {
  const configDir = path.join(directory, 'config');
  const scienceCodeHome = path.join(directory, '.engine-home');
  fs.mkdirSync(configDir, { recursive: true });
  return sendChatMessage({
    cwd: directory,
    chatId,
    message: 'Develop and review a drug discovery assay procedure with controls and safety gates.',
    configDir,
    packageRoot,
    scienceCodeHome,
    opencode: process.execPath,
    runner: () => ({
      status: 0,
      signal: null,
      stderr: '',
      stdout: [
        JSON.stringify({
          type: 'step_start',
          sessionID: 'ses_procedure_test',
          part: { type: 'step-start' }
        }),
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_procedure_test',
          part: { type: 'text', text: 'Drafted for structured human review.' }
        }),
        JSON.stringify({
          type: 'step_finish',
          sessionID: 'ses_procedure_test',
          part: { type: 'step-finish' }
        })
      ].join('\n') + '\n'
    })
  });
}

test('procedure normalization and logical dry-run are strict, deterministic, and non-executing', () => {
  const { evidenceId } = fixture('sciencecode-procedure-evaluate-');
  const normalized = normalizeProcedureSpec(readySpec(evidenceId));
  const first = evaluateProcedurePlan(normalized);
  const second = evaluateProcedurePlan(normalized);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ready_for_human_review');
  assert.deepEqual(first.graph.order, ['prepare', 'measure']);
  assert.equal(first.resources.duration.total_seconds, 900);
  assert.equal(first.resources.material_totals.length, 3);
  assert.equal(first.physical_execution.enabled, false);
  assert.equal(first.adapters[0].requested, true);
  assert.equal(first.adapters[0].execution_enabled, false);
  assert.equal(first.adapters[1].execution_enabled, false);
  assert.deepEqual(first.adapters[0].unmapped_step_ids, ['measure']);
  assert.ok(first.findings.some((item) =>
    item.code === 'adapter_mapping_incomplete' && item.severity === 'info'
  ));

  const broken = readySpec(evidenceId);
  broken.steps[0].depends_on = ['measure'];
  broken.hazards[0].severity = 'high';
  broken.hazards[0].controls = [{
    type: 'ppe',
    description: 'PPE only.',
    verification: 'Visual check.'
  }];
  broken.controls = [];
  const blocked = evaluateProcedurePlan(broken);
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.findings.some((item) => item.code === 'step_dependency_cycle'));
  assert.ok(blocked.findings.some((item) =>
    item.code === 'high_hazard_relies_on_ppe_or_emergency_only'
  ));
  assert.ok(blocked.findings.some((item) =>
    item.code === 'drug_discovery_control_strategy_incomplete'
  ));

  assert.throws(() => normalizeProcedureSpec({
    ...readySpec(evidenceId),
    unexpected_authorization: true
  }), /Unknown procedure field/);
  assert.throws(() => normalizeProcedureSpec({
    ...readySpec(evidenceId),
    physical_execution_policy: 'sciencecode_controls_hardware'
  }), { code: 'PHYSICAL_EXECUTION_POLICY_REQUIRED' });
  const duplicate = readySpec(evidenceId);
  duplicate.steps.push({ ...duplicate.steps[0] });
  assert.throws(() => normalizeProcedureSpec(duplicate), /Step IDs must be unique/);
});

test('immutable procedure, assessment, and scoped decision lifecycle preserves currentness', () => {
  const { directory, evidenceId, chatId } = fixture('sciencecode-procedure-life-');
  const procedure = createProcedure({
    cwd: directory,
    chatId,
    spec: readySpec(evidenceId),
    now: at('2026-08-10T12:00:00.000Z')
  });
  const procedureId = procedure.manifest.procedure_id;
  assert.equal(verifyProcedure(directory, procedureId).ok, true);
  assert.equal(listProcedures(directory)[0].current, true);
  assert.equal(procedure.manifest.physical_execution.enabled, false);
  assert.equal(procedureInteractionPayload(procedure).physical_execution_enabled, false);

  const assessment1 = createProcedureAssessment({
    cwd: directory,
    chatId,
    procedureId,
    now: at('2026-08-10T12:01:00.000Z')
  });
  const assessment1Id = assessment1.manifest.procedure_assessment_id;
  assert.equal(assessment1.report.status, 'ready_for_human_review');
  assert.equal(verifyProcedureAssessment(directory, assessment1Id).ok, true);
  assert.equal(
    procedureAssessmentInteractionPayload(assessment1).physical_execution_enabled,
    false
  );
  assert.throws(() => createProcedureDecision({
    cwd: directory,
    chatId,
    input: decisionInput(procedureId, assessment1Id, { attestation: false }),
    now: at('2026-08-10T12:02:00.000Z')
  }), { code: 'PROCEDURE_DECISION_ATTESTATION_REQUIRED' });

  const decision1 = createProcedureDecision({
    cwd: directory,
    chatId,
    input: decisionInput(procedureId, assessment1Id),
    now: at('2026-08-10T12:02:00.000Z')
  });
  assert.equal(verifyProcedureDecision(
    directory, decision1.manifest.procedure_decision_id
  ).ok, true);
  assert.equal(decision1.manifest.physical_execution.enabled, false);
  assert.equal(procedureDecisionInteractionPayload(decision1).physical_execution_enabled, false);
  assert.equal(listProcedureDecisions(directory, {
    now: at('2026-08-10T12:02:30.000Z')
  })[0].effective, true);

  const assessment2 = createProcedureAssessment({
    cwd: directory,
    chatId,
    procedureId,
    now: at('2026-08-10T12:03:00.000Z')
  });
  const assessment2Id = assessment2.manifest.procedure_assessment_id;
  const assessments = listProcedureAssessments(directory);
  assert.equal(assessments.find((item) =>
    item.procedure_assessment_id === assessment1Id).current_for_procedure, false);
  assert.equal(assessments.find((item) =>
    item.procedure_assessment_id === assessment2Id).current_for_procedure, true);
  const stale = listProcedureDecisions(directory, {
    now: at('2026-08-10T12:03:30.000Z')
  })[0];
  assert.equal(stale.assessment_current, false);
  assert.equal(stale.effective, false);
  assert.equal(stale.effective_status, 'assessment_superseded');
  assert.throws(() => createProcedureDecision({
    cwd: directory,
    chatId,
    input: decisionInput(procedureId, assessment1Id),
    now: at('2026-08-10T12:04:00.000Z')
  }), { code: 'PROCEDURE_ASSESSMENT_NOT_CURRENT' });

  const decision2 = createProcedureDecision({
    cwd: directory,
    chatId,
    input: decisionInput(procedureId, assessment2Id),
    now: at('2026-08-10T12:04:00.000Z')
  });
  assert.equal(listProcedureDecisions(directory, {
    now: at('2026-08-10T12:04:30.000Z')
  }).find((item) =>
    item.procedure_decision_id === decision2.manifest.procedure_decision_id
  ).effective, true);

  const revision = createProcedure({
    cwd: directory,
    chatId,
    spec: readySpec(evidenceId, {
      name: 'Reference compound response assay revision',
      supersedes_procedure_id: procedureId
    }),
    now: at('2026-08-10T12:05:00.000Z')
  });
  assert.equal(listProcedures(directory).find((item) =>
    item.procedure_id === procedureId).current, false);
  assert.equal(listProcedureDecisions(directory, {
    now: at('2026-08-10T12:05:30.000Z')
  }).find((item) =>
    item.procedure_decision_id === decision2.manifest.procedure_decision_id
  ).effective_status, 'procedure_superseded');
  assert.equal(verifyProcedure(directory, revision.manifest.procedure_id).ok, true);

  const project = verifyProject(directory);
  assert.equal(project.ok, true);
  assert.equal(project.counts.procedures, 2);
  assert.equal(project.counts.current_procedures, 1);
  assert.equal(project.counts.procedure_assessments, 2);
  assert.equal(project.counts.procedure_decisions, 2);
  assert.equal(project.counts.effective_procedure_approvals, 0);
});

test('procedure interactions inform AI context, harness state, and scientific lineage', () => {
  const { directory, evidenceId, chatId } = fixture('sciencecode-procedure-context-');
  addProcedureTurn(directory, chatId);
  const procedure = createProcedure({
    cwd: directory,
    chatId,
    spec: readySpec(evidenceId),
    now: at('2026-08-10T13:00:00.000Z')
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'procedure',
    action: 'plan.created',
    artifact: procedureInteractionArtifact(procedure),
    payload: procedureInteractionPayload(procedure, 'Review the exact control strategy.')
  });
  const assessment = createProcedureAssessment({
    cwd: directory,
    chatId,
    procedureId: procedure.manifest.procedure_id,
    now: at('2026-08-10T13:01:00.000Z')
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'procedure',
    action: 'assessment.created',
    artifact: procedureAssessmentInteractionArtifact(assessment),
    payload: procedureAssessmentInteractionPayload(assessment)
  });
  const decision = createProcedureDecision({
    cwd: directory,
    chatId,
    input: decisionInput(
      procedure.manifest.procedure_id,
      assessment.manifest.procedure_assessment_id
    ),
    now: at('2026-08-10T13:02:00.000Z')
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'procedure',
    action: 'decision.recorded',
    artifact: procedureDecisionInteractionArtifact(decision),
    payload: procedureDecisionInteractionPayload(decision)
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'procedure',
    action: 'board.focused',
    artifact: procedureInteractionArtifact(procedure),
    payload: {
      procedure_id: procedure.manifest.procedure_id,
      step_id: 'prepare',
      operation: 'transfer',
      physical_execution_enabled: false,
      note: 'Challenge this selected step.'
    }
  });
  recordInteraction({
    cwd: directory,
    chatId,
    surface: 'procedure',
    action: 'assessment.focused',
    artifact: procedureAssessmentInteractionArtifact(assessment),
    payload: {
      procedure_assessment_id: assessment.manifest.procedure_assessment_id,
      procedure_id: procedure.manifest.procedure_id,
      status: assessment.report.status,
      summary: assessment.report.summary,
      findings: [],
      selected_focus: {
        kind: 'gate',
        id: 'hazards',
        label: 'gate Hazards and controls'
      },
      physical_execution_enabled: false,
      note: 'Explain this selected gate.'
    }
  });

  const context = interactionAwarePrompt({
    cwd: directory,
    chatId,
    message: 'What is ready and what remains outside ScienceCode?'
  });
  assert.equal(context.context.count, 5);
  assert.match(context.prompt, /Frozen procedure plan/);
  assert.match(context.prompt, /Procedure logical dry-run/);
  assert.match(context.prompt, /Local procedure decision/);
  assert.match(context.prompt, /user selected step prepare \(transfer\)/);
  assert.match(context.prompt, /user selected gate hazards/);
  assert.match(context.prompt, /Explain this selected gate/);
  assert.match(context.prompt, /physical execution remains disabled/);

  const procedures = listProcedures(directory);
  const assessments = listProcedureAssessments(directory);
  const decisions = listProcedureDecisions(directory, {
    now: at('2026-08-10T13:03:00.000Z')
  });
  const harness = buildHarnessView({
    cwd: directory,
    chat: getChatSession(directory, chatId),
    compute: {
      ok: true,
      runtime: { healthy: true },
      gpu: { available: true }
    },
    procedures,
    procedureAssessments: assessments,
    procedureDecisions: decisions
  });
  assert.equal(harness.workflow.id, 'procedure_development');
  assert.equal(harness.board.procedure.selected_procedure_id,
    procedure.manifest.procedure_id);
  assert.equal(harness.board.procedure.execution_state,
    'external_attestation_recorded');
  assert.equal(harness.board.procedure.physical_execution_enabled, false);
  assert.equal(harness.board.procedure.adapters[0].execution_enabled, false);
  assert.equal(harness.board.procedure.gates.find((item) =>
    item.id === 'approval').status, 'attested');
  assert.equal(harness.board.validation.verified_procedure_plans, 1);
  assert.equal(harness.board.validation.effective_procedure_approvals, 1);

  const graph = buildLineageGraph(directory, {
    now: at('2026-08-10T13:03:00.000Z')
  });
  assert.equal(graph.integrity.ok, true);
  assert.ok(graph.nodes.some((node) =>
    node.type === 'procedure' && node.record_id === procedure.manifest.procedure_id
  ));
  assert.ok(graph.nodes.some((node) =>
    node.type === 'procedure-assessment' &&
    node.record_id === assessment.manifest.procedure_assessment_id
  ));
  assert.ok(graph.nodes.some((node) =>
    node.type === 'procedure-decision' &&
    node.record_id === decision.manifest.procedure_decision_id
  ));
  assert.ok(graph.edges.some((edge) => edge.relation === 'informs'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'validated_by'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'governed_by'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'basis_for'));
});

test('procedure CLI creates, assesses, decides, lists, and verifies records', () => {
  const { directory, evidenceId, chatId } = fixture('sciencecode-procedure-cli-');
  fs.writeFileSync(
    path.join(directory, 'procedure.json'),
    JSON.stringify(readySpec(evidenceId), null, 2) + '\n'
  );
  const createdResult = invoke([
    'procedure', 'create', 'procedure.json', '--chat', chatId,
    '--note', 'CLI-created procedure'
  ], directory);
  assert.equal(createdResult.code, 0, createdResult.stderr);
  const created = JSON.parse(createdResult.stdout);
  const procedureId = created.procedure.manifest.procedure_id;
  assert.equal(created.procedure.verification.ok, true);
  assert.equal(created.interaction.action, 'plan.created');

  const assessedResult = invoke([
    'procedure', 'assess', procedureId, '--chat', chatId
  ], directory);
  assert.equal(assessedResult.code, 0, assessedResult.stderr);
  const assessed = JSON.parse(assessedResult.stdout);
  const assessmentId = assessed.assessment.manifest.procedure_assessment_id;
  assert.equal(assessed.assessment.report.status, 'ready_for_human_review');
  assert.equal(assessed.interaction.action, 'assessment.created');

  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const decidedResult = invoke([
    'procedure', 'decide', procedureId, assessmentId,
    '--decision', 'approve',
    '--scope', 'external_physical_execution',
    '--reviewer', 'CLI Human Reviewer',
    '--role', 'Qualified facility reviewer',
    '--organization', 'External laboratory',
    '--basis', 'Reviewed exact frozen records.',
    '--conditions', 'External facility controls remain required.',
    '--expires', expiry,
    '--attest',
    '--chat', chatId
  ], directory);
  assert.equal(decidedResult.code, 0, decidedResult.stderr);
  const decided = JSON.parse(decidedResult.stdout);
  const decisionId = decided.decision.manifest.procedure_decision_id;
  assert.equal(decided.decision.verification.ok, true);
  assert.equal(decided.decision.manifest.physical_execution.enabled, false);
  assert.equal(decided.interaction.action, 'decision.recorded');

  const listed = invoke([
    'procedure', 'list', '--current', '--domain', 'drug_discovery', '--json'
  ], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].procedure_id, procedureId);
  const assessmentList = invoke([
    'procedure', 'assessment', 'list', '--procedure', procedureId, '--json'
  ], directory);
  assert.equal(assessmentList.code, 0, assessmentList.stderr);
  assert.equal(JSON.parse(assessmentList.stdout)[0].procedure_assessment_id, assessmentId);
  const decisionList = invoke([
    'procedure', 'decision', 'list', '--procedure', procedureId,
    '--scope', 'external_physical_execution', '--json'
  ], directory);
  assert.equal(decisionList.code, 0, decisionList.stderr);
  assert.equal(JSON.parse(decisionList.stdout)[0].procedure_decision_id, decisionId);
  assert.equal(invoke(['procedure', 'verify', procedureId], directory).code, 0);
  assert.equal(invoke([
    'procedure', 'assessment', 'verify', assessmentId
  ], directory).code, 0);
  assert.equal(invoke([
    'procedure', 'decision', 'verify', decisionId
  ], directory).code, 0);
});

test('Lab exposes mutation-guarded procedure lifecycle, details, state, harness, and lineage', async (context) => {
  const { directory, evidenceId, chatId } = fixture('sciencecode-procedure-lab-');
  addProcedureTurn(directory, chatId);
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({
      ok: true,
      runtime: { healthy: true, profile: 'test' },
      gpu: { available: false, devices: [], error: 'test fixture' }
    })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const headers = {
    'Content-Type': 'application/json',
    Origin: details.url
  };
  const moduleResponse = await fetch(details.url + '/procedure.js');
  assert.equal(moduleResponse.status, 200);
  assert.match(moduleResponse.headers.get('content-type') ?? '',
    /javascript/);
  assert.match(await moduleResponse.text(), /defaultProcedureSpec/);
  const createBody = {
    chat_id: chatId,
    spec: readySpec(evidenceId),
    note: 'Created in Lab'
  };

  const crossOrigin = await fetch(details.url + '/api/procedures', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example'
    },
    body: JSON.stringify(createBody)
  });
  assert.equal(crossOrigin.status, 403);
  const wrongMedia = await fetch(details.url + '/api/procedures', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: details.url },
    body: JSON.stringify(createBody)
  });
  assert.equal(wrongMedia.status, 415);

  const procedureResponse = await fetch(details.url + '/api/procedures', {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody)
  });
  assert.equal(procedureResponse.status, 201);
  const procedureCreated = await procedureResponse.json();
  const procedureId = procedureCreated.procedure.manifest.procedure_id;
  assert.equal(procedureCreated.procedure.verification.ok, true);
  assert.equal(procedureCreated.interaction.action, 'plan.created');

  const assessmentResponse = await fetch(
    details.url + '/api/procedure-assessments',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chat_id: chatId,
        procedure_id: procedureId,
        note: 'Run structural dry-run'
      })
    }
  );
  assert.equal(assessmentResponse.status, 201);
  const assessmentCreated = await assessmentResponse.json();
  const assessmentId = assessmentCreated.assessment.manifest.procedure_assessment_id;
  assert.equal(assessmentCreated.assessment.report.status, 'ready_for_human_review');

  const decisionResponse = await fetch(details.url + '/api/procedure-decisions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      chat_id: chatId,
      input: decisionInput(procedureId, assessmentId, {
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    })
  });
  assert.equal(decisionResponse.status, 201);
  const decisionCreated = await decisionResponse.json();
  const decisionId = decisionCreated.decision.manifest.procedure_decision_id;
  assert.equal(decisionCreated.decision.manifest.physical_execution.enabled, false);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.procedures, 1);
  assert.equal(state.counts.current_procedures, 1);
  assert.equal(state.counts.procedure_assessments, 1);
  assert.equal(state.counts.procedure_decisions, 1);
  assert.equal(state.counts.effective_procedure_approvals, 1);
  const plans = await (await fetch(
    details.url + '/api/procedures?chat=' + encodeURIComponent(chatId) + '&current=1'
  )).json();
  assert.equal(plans.summary.verified, 1);
  assert.equal(plans.procedures[0].procedure_id, procedureId);
  const assessments = await (await fetch(
    details.url + '/api/procedure-assessments?procedure=' +
      encodeURIComponent(procedureId)
  )).json();
  assert.equal(assessments.summary.ready, 1);
  const decisions = await (await fetch(
    details.url + '/api/procedure-decisions?procedure=' +
      encodeURIComponent(procedureId)
  )).json();
  assert.equal(decisions.summary.effective, 1);

  const procedureDetail = await (await fetch(
    details.url + '/api/procedures/' + encodeURIComponent(procedureId)
  )).json();
  assert.equal(procedureDetail.verification.ok, true);
  assert.equal(procedureDetail.procedure.steps.length, 2);
  const assessmentDetail = await (await fetch(
    details.url + '/api/procedure-assessments/' + encodeURIComponent(assessmentId)
  )).json();
  assert.equal(assessmentDetail.verification.ok, true);
  assert.equal(assessmentDetail.report.physical_execution.enabled, false);
  const decisionDetail = await (await fetch(
    details.url + '/api/procedure-decisions/' + encodeURIComponent(decisionId)
  )).json();
  assert.equal(decisionDetail.verification.ok, true);
  assert.equal(decisionDetail.manifest.reviewer.identity_verified, false);

  const harness = await (await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/harness'
  )).json();
  assert.equal(harness.board.procedure.execution_state, 'external_attestation_recorded');
  assert.equal(harness.board.procedure.physical_execution_enabled, false);
  const lineage = await (await fetch(
    details.url + '/api/lineage?chat=' + encodeURIComponent(chatId)
  )).json();
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) => node.type === 'procedure-decision'));
});

test('procedure tampering and deletion are visible to verification and the project gate', () => {
  const first = fixture('sciencecode-procedure-tamper-');
  const procedure = createProcedure({
    cwd: first.directory,
    chatId: first.chatId,
    spec: readySpec(first.evidenceId),
    now: at('2026-08-10T14:00:00.000Z')
  });
  fs.appendFileSync(path.join(
    procedure.directory, 'procedure.json'
  ), '\n');
  const verification = verifyProcedure(first.directory, procedure.manifest.procedure_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) =>
    error.file === 'procedure.json' && error.issue === 'hash_mismatch'
  ));
  assert.equal(verifyProject(first.directory).ok, false);

  const second = fixture('sciencecode-procedure-delete-');
  const removed = createProcedure({
    cwd: second.directory,
    chatId: second.chatId,
    spec: readySpec(second.evidenceId),
    now: at('2026-08-10T14:01:00.000Z')
  });
  fs.rmSync(removed.directory, { recursive: true });
  const records = listProcedures(second.directory);
  assert.equal(records.length, 1);
  assert.equal(records[0].verified, false);
  assert.equal(records[0].status, 'missing');
  assert.equal(verifyProject(second.directory).ok, false);
});

test('blocked plans, impossible times, long expiries, and filesystem-link stores fail closed', (context) => {
  const blockedFixture = fixture('sciencecode-procedure-blocked-');
  const blockedSpec = readySpec(blockedFixture.evidenceId);
  blockedSpec.controls = [];
  const blockedPlan = createProcedure({
    cwd: blockedFixture.directory,
    spec: blockedSpec,
    now: at('2026-08-10T15:00:00.000Z')
  });
  const blockedAssessment = createProcedureAssessment({
    cwd: blockedFixture.directory,
    procedureId: blockedPlan.manifest.procedure_id,
    now: at('2026-08-10T15:01:00.000Z')
  });
  assert.equal(blockedAssessment.report.status, 'blocked');
  assert.throws(() => createProcedureDecision({
    cwd: blockedFixture.directory,
    input: decisionInput(
      blockedPlan.manifest.procedure_id,
      blockedAssessment.manifest.procedure_assessment_id
    ),
    now: at('2026-08-10T15:02:00.000Z')
  }), { code: 'PROCEDURE_NOT_READY' });

  const timeFixture = fixture('sciencecode-procedure-time-');
  assert.throws(() => createProcedure({
    cwd: timeFixture.directory,
    spec: readySpec(timeFixture.evidenceId),
    now: new Date('invalid')
  }), { code: 'INVALID_PROCEDURE' });
  const plan = createProcedure({
    cwd: timeFixture.directory,
    spec: readySpec(timeFixture.evidenceId),
    now: at('2026-08-10T16:00:00.000Z')
  });
  assert.throws(() => createProcedureAssessment({
    cwd: timeFixture.directory,
    procedureId: plan.manifest.procedure_id,
    now: at('2026-08-10T15:59:00.000Z')
  }), { code: 'PROCEDURE_ASSESSMENT_TIMESTAMP_ORDER' });
  const assessment = createProcedureAssessment({
    cwd: timeFixture.directory,
    procedureId: plan.manifest.procedure_id,
    now: at('2026-08-10T16:01:00.000Z')
  });
  assert.throws(() => createProcedureDecision({
    cwd: timeFixture.directory,
    input: decisionInput(
      plan.manifest.procedure_id,
      assessment.manifest.procedure_assessment_id,
      { expires_at: '2028-08-10T00:00:00.000Z' }
    ),
    now: at('2026-08-10T16:02:00.000Z')
  }), { code: 'PROCEDURE_DECISION_EXPIRY' });

  const linkFixture = fixture('sciencecode-procedure-link-');
  const root = path.join(linkFixture.directory, '.sciencecode', 'procedures');
  fs.rmSync(root, { recursive: true });
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sciencecode-procedure-outside-')
  );
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(outside, root, linkType);
  } catch (error) {
    context.skip('Filesystem links are unavailable in this test environment: ' + error.code);
    return;
  }
  assert.throws(() => createProcedure({
    cwd: linkFixture.directory,
    spec: readySpec(linkFixture.evidenceId)
  }), { code: 'INVALID_PROCEDURE_PATH' });
  assert.equal(fs.readdirSync(outside).length, 0);
});
