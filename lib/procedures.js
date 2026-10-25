import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import { verifyEvidence } from './evidence.js';
import { sha256File, sha256Json } from './hash.js';
import { scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

export const PROCEDURE_SCHEMA_VERSION = 1;
export const PROCEDURE_ASSESSMENT_SCHEMA_VERSION = 1;
export const PROCEDURE_DECISION_SCHEMA_VERSION = 1;
export const PROCEDURE_DRY_RUN_ENGINE_VERSION = 1;
export const MAX_PROCEDURES = 10_000;
export const MAX_PROCEDURE_ASSESSMENTS = 10_000;
export const MAX_PROCEDURE_DECISIONS = 10_000;
export const MAX_PROCEDURE_SPEC_BYTES = 512 * 1024;
export const MAX_PROCEDURE_STEPS = 256;

const PROCEDURE_ID_PATTERN = /^procedure-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const ASSESSMENT_ID_PATTERN = /^procedure-assessment-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const DECISION_ID_PATTERN = /^procedure-decision-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EVIDENCE_ID_PATTERN = /^evidence-[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/;
const LOCAL_ID_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const DOMAINS = new Set(['general', 'chemistry', 'biology', 'drug_discovery', 'materials']);
const MATERIAL_ROLES = new Set([
  'reagent', 'sample', 'control', 'consumable', 'solvent', 'buffer', 'standard', 'other'
]);
const CONTROL_TYPES = new Set([
  'positive', 'negative', 'vehicle', 'blank', 'process', 'reference', 'other'
]);
const HAZARD_CATEGORIES = new Set([
  'chemical', 'biological', 'physical', 'radiological', 'environmental', 'data', 'other'
]);
const SEVERITIES = new Set(['low', 'moderate', 'high', 'critical']);
const CONTROL_LEVELS = new Set([
  'elimination', 'substitution', 'engineering', 'administrative',
  'work_practice', 'ppe', 'emergency'
]);
const OPERATIONS = new Set([
  'add', 'transfer', 'mix', 'incubate', 'heat_cool', 'separate', 'wash',
  'wait', 'sample', 'measure', 'observe', 'compute', 'other'
]);
const AUTOMATION_TARGETS = new Set(['xdl_2_0', 'opentrons_python']);
const DECISIONS = new Set(['approve', 'reject']);
const DECISION_SCOPES = new Set([
  'design_review', 'external_dry_run', 'external_physical_execution'
]);
const PHYSICAL_POLICY = 'external_human_control_only';

const TOP_LEVEL_KEYS = new Set([
  'name', 'objective', 'domain', 'context_of_use', 'supersedes_procedure_id',
  'source_evidence_ids', 'materials', 'equipment', 'controls', 'hazards', 'steps',
  'acceptance_criteria', 'stop_conditions', 'training_requirements',
  'emergency_procedures', 'waste_and_decontamination', 'automation_targets',
  'physical_execution_policy', 'notes'
]);
const MATERIAL_KEYS = new Set([
  'material_id', 'name', 'role', 'amount', 'concentration', 'source',
  'storage', 'sds_required', 'notes'
]);
const EQUIPMENT_KEYS = new Set([
  'equipment_id', 'name', 'purpose', 'operating_limits',
  'calibration_required', 'qualification_required'
]);
const CONTROL_KEYS = new Set([
  'control_id', 'type', 'label', 'purpose', 'acceptance_criterion'
]);
const HAZARD_KEYS = new Set([
  'hazard_id', 'category', 'severity', 'description', 'worst_case',
  'controls', 'emergency_response', 'applies_to_steps'
]);
const MITIGATION_KEYS = new Set(['type', 'description', 'verification']);
const STEP_KEYS = new Set([
  'step_id', 'title', 'operation', 'instruction', 'depends_on', 'materials',
  'equipment_ids', 'parameters', 'duration', 'expected_observation',
  'acceptance_criterion', 'on_deviation', 'hazard_ids', 'risk_note', 'outputs'
]);
const STEP_MATERIAL_KEYS = new Set(['material_id', 'amount']);
const PARAMETER_KEYS = new Set(['name', 'value', 'unit']);
const QUANTITY_KEYS = new Set(['value', 'unit']);
const CRITERION_KEYS = new Set(['criterion_id', 'label', 'measure', 'rule']);
const DECISION_KEYS = new Set([
  'procedure_id', 'procedure_assessment_id', 'decision', 'scope',
  'reviewer_name', 'reviewer_role', 'organization', 'basis', 'conditions',
  'expires_at', 'attestation'
]);

function procedureError(message, code = 'INVALID_PROCEDURE') {
  return Object.assign(new Error(message), { code });
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw procedureError(label + ' must be a JSON object.');
  }
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw procedureError('Unknown ' + label + ' field: ' + key);
  }
}

function boundedText(value, label, limit, { optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw procedureError(label + ' is required.');
  }
  const text = String(value).replace(/\r\n/g, '\n').trim();
  if (text.length > limit) {
    throw procedureError(label + ' must be ' + limit + ' characters or fewer.');
  }
  return text;
}

function boundedStringArray(value, label, maximum = 64, itemLimit = 1_000) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw procedureError(label + ' must contain at most ' + maximum + ' entries.');
  }
  return value.map((item, index) =>
    boundedText(item, label + ' item ' + (index + 1), itemLimit));
}

function booleanValue(value, label, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') throw procedureError(label + ' must be true or false.');
  return value;
}

function localId(value, label) {
  const id = String(value ?? '');
  if (!LOCAL_ID_PATTERN.test(id) ||
      ['__proto__', 'prototype', 'constructor'].includes(id)) {
    throw procedureError(label + ' is invalid.');
  }
  return id;
}

function normalizeQuantity(value, label, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw procedureError(label + ' is required.');
  }
  assertPlainObject(value, label);
  rejectUnknownKeys(value, QUANTITY_KEYS, label);
  if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0) {
    throw procedureError(label + ' value must be a finite non-negative number.');
  }
  return {
    value: value.value,
    unit: boundedText(value.unit, label + ' unit', 80)
  };
}

function normalizeMaterial(value, index) {
  assertPlainObject(value, 'Material ' + (index + 1));
  rejectUnknownKeys(value, MATERIAL_KEYS, 'material');
  const role = String(value.role ?? '');
  if (!MATERIAL_ROLES.has(role)) throw procedureError('Material role is invalid: ' + role);
  return {
    material_id: localId(value.material_id, 'Material ID'),
    name: boundedText(value.name, 'Material name', 240),
    role,
    amount: normalizeQuantity(value.amount, 'Material amount', { optional: true }),
    concentration: boundedText(value.concentration, 'Material concentration', 160, { optional: true }),
    source: boundedText(value.source, 'Material source', 500, { optional: true }),
    storage: boundedText(value.storage, 'Material storage', 500, { optional: true }),
    sds_required: booleanValue(value.sds_required, 'Material sds_required'),
    notes: boundedText(value.notes, 'Material notes', 1_000, { optional: true })
  };
}

function normalizeEquipment(value, index) {
  assertPlainObject(value, 'Equipment ' + (index + 1));
  rejectUnknownKeys(value, EQUIPMENT_KEYS, 'equipment');
  return {
    equipment_id: localId(value.equipment_id, 'Equipment ID'),
    name: boundedText(value.name, 'Equipment name', 240),
    purpose: boundedText(value.purpose, 'Equipment purpose', 1_000),
    operating_limits: boundedText(value.operating_limits, 'Equipment operating limits', 1_000),
    calibration_required: booleanValue(
      value.calibration_required, 'Equipment calibration_required'),
    qualification_required: booleanValue(
      value.qualification_required, 'Equipment qualification_required')
  };
}

function normalizeControl(value, index) {
  assertPlainObject(value, 'Control ' + (index + 1));
  rejectUnknownKeys(value, CONTROL_KEYS, 'control');
  const type = String(value.type ?? '');
  if (!CONTROL_TYPES.has(type)) throw procedureError('Control type is invalid: ' + type);
  return {
    control_id: localId(value.control_id, 'Control ID'),
    type,
    label: boundedText(value.label, 'Control label', 240),
    purpose: boundedText(value.purpose, 'Control purpose', 1_000),
    acceptance_criterion: boundedText(
      value.acceptance_criterion, 'Control acceptance criterion', 1_000)
  };
}

function normalizeMitigation(value, index, hazardId) {
  assertPlainObject(value, 'Hazard control ' + (index + 1));
  rejectUnknownKeys(value, MITIGATION_KEYS, 'hazard control');
  const type = String(value.type ?? '');
  if (!CONTROL_LEVELS.has(type)) {
    throw procedureError('Hazard ' + hazardId + ' has an invalid control type: ' + type);
  }
  return {
    type,
    description: boundedText(value.description, 'Hazard control description', 1_000),
    verification: boundedText(value.verification, 'Hazard control verification', 1_000)
  };
}

function normalizeHazard(value, index) {
  assertPlainObject(value, 'Hazard ' + (index + 1));
  rejectUnknownKeys(value, HAZARD_KEYS, 'hazard');
  const hazardId = localId(value.hazard_id, 'Hazard ID');
  const category = String(value.category ?? '');
  const severity = String(value.severity ?? '');
  if (!HAZARD_CATEGORIES.has(category)) {
    throw procedureError('Hazard category is invalid: ' + category);
  }
  if (!SEVERITIES.has(severity)) throw procedureError('Hazard severity is invalid: ' + severity);
  const controls = value.controls ?? [];
  if (!Array.isArray(controls) || controls.length > 32) {
    throw procedureError('Hazard controls must contain at most 32 entries.');
  }
  return {
    hazard_id: hazardId,
    category,
    severity,
    description: boundedText(value.description, 'Hazard description', 1_500),
    worst_case: boundedText(value.worst_case, 'Hazard worst case', 1_500),
    controls: controls.map((item, controlIndex) =>
      normalizeMitigation(item, controlIndex, hazardId)),
    emergency_response: boundedText(
      value.emergency_response, 'Hazard emergency response', 1_500),
    applies_to_steps: boundedStringArray(
      value.applies_to_steps, 'Hazard step references', MAX_PROCEDURE_STEPS, 80
    ).map((item) => localId(item, 'Hazard step reference'))
  };
}

function normalizeStepMaterial(value, index) {
  assertPlainObject(value, 'Step material ' + (index + 1));
  rejectUnknownKeys(value, STEP_MATERIAL_KEYS, 'step material');
  return {
    material_id: localId(value.material_id, 'Step material ID'),
    amount: normalizeQuantity(value.amount, 'Step material amount', { optional: true })
  };
}

function normalizeParameter(value, index) {
  assertPlainObject(value, 'Step parameter ' + (index + 1));
  rejectUnknownKeys(value, PARAMETER_KEYS, 'step parameter');
  if (!['string', 'number', 'boolean'].includes(typeof value.value) ||
      (typeof value.value === 'number' && !Number.isFinite(value.value))) {
    throw procedureError('Step parameter value must be a finite scalar.');
  }
  return {
    name: boundedText(value.name, 'Step parameter name', 120),
    value: value.value,
    unit: boundedText(value.unit, 'Step parameter unit', 80, { optional: true })
  };
}

function normalizeStep(value, index) {
  assertPlainObject(value, 'Step ' + (index + 1));
  rejectUnknownKeys(value, STEP_KEYS, 'step');
  const operation = String(value.operation ?? '');
  if (!OPERATIONS.has(operation)) {
    throw procedureError('Step operation is invalid: ' + operation);
  }
  const materials = value.materials ?? [];
  const parameters = value.parameters ?? [];
  if (!Array.isArray(materials) || materials.length > 64) {
    throw procedureError('Step materials must contain at most 64 entries.');
  }
  if (!Array.isArray(parameters) || parameters.length > 64) {
    throw procedureError('Step parameters must contain at most 64 entries.');
  }
  return {
    step_id: localId(value.step_id, 'Step ID'),
    title: boundedText(value.title, 'Step title', 240),
    operation,
    instruction: boundedText(value.instruction, 'Step instruction', 4_000),
    depends_on: boundedStringArray(value.depends_on, 'Step dependencies', 64, 80)
      .map((item) => localId(item, 'Step dependency')),
    materials: materials.map(normalizeStepMaterial),
    equipment_ids: boundedStringArray(value.equipment_ids, 'Step equipment', 64, 80)
      .map((item) => localId(item, 'Step equipment ID')),
    parameters: parameters.map(normalizeParameter),
    duration: normalizeQuantity(value.duration, 'Step duration', { optional: true }),
    expected_observation: boundedText(
      value.expected_observation, 'Step expected observation', 1_500),
    acceptance_criterion: boundedText(
      value.acceptance_criterion, 'Step acceptance criterion', 1_500),
    on_deviation: boundedText(value.on_deviation, 'Step deviation action', 1_500),
    hazard_ids: boundedStringArray(value.hazard_ids, 'Step hazards', 64, 80)
      .map((item) => localId(item, 'Step hazard ID')),
    risk_note: boundedText(value.risk_note, 'Step risk note', 1_500),
    outputs: boundedStringArray(value.outputs, 'Step outputs', 64, 500)
  };
}

function normalizeCriterion(value, index) {
  assertPlainObject(value, 'Acceptance criterion ' + (index + 1));
  rejectUnknownKeys(value, CRITERION_KEYS, 'acceptance criterion');
  return {
    criterion_id: localId(value.criterion_id, 'Acceptance criterion ID'),
    label: boundedText(value.label, 'Acceptance criterion label', 240),
    measure: boundedText(value.measure, 'Acceptance criterion measure', 1_000),
    rule: boundedText(value.rule, 'Acceptance criterion rule', 1_000)
  };
}

function assertUnique(items, key, label) {
  const values = items.map((item) => item[key]);
  if (new Set(values).size !== values.length) {
    throw procedureError(label + ' IDs must be unique.');
  }
}

export function normalizeProcedureSpec(value) {
  assertPlainObject(value, 'Procedure');
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, 'procedure');
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_PROCEDURE_SPEC_BYTES) {
    throw procedureError(
      'Procedure exceeds the ' + MAX_PROCEDURE_SPEC_BYTES + '-byte limit.',
      'PROCEDURE_TOO_LARGE'
    );
  }
  const findings = scanSecrets(encoded);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in procedure; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const domain = String(value.domain ?? '');
  if (!DOMAINS.has(domain)) throw procedureError('Procedure domain is invalid: ' + domain);
  const policy = String(value.physical_execution_policy ?? '');
  if (policy !== PHYSICAL_POLICY) {
    throw procedureError(
      'physical_execution_policy must be ' + PHYSICAL_POLICY + '.',
      'PHYSICAL_EXECUTION_POLICY_REQUIRED'
    );
  }
  const supersedes = value.supersedes_procedure_id === undefined ||
    value.supersedes_procedure_id === null || value.supersedes_procedure_id === ''
    ? null
    : normalizeProcedureId(value.supersedes_procedure_id);
  const evidenceIds = boundedStringArray(
    value.source_evidence_ids, 'Source evidence IDs', 128, 180
  ).map((item) => {
    if (!EVIDENCE_ID_PATTERN.test(item)) {
      throw procedureError('Invalid source evidence ID: ' + item);
    }
    return item;
  });
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw procedureError('Source evidence IDs must be unique.');
  }
  const materials = value.materials ?? [];
  const equipment = value.equipment ?? [];
  const controls = value.controls ?? [];
  const hazards = value.hazards ?? [];
  const steps = value.steps ?? [];
  const criteria = value.acceptance_criteria ?? [];
  const collections = [
    [materials, 256, 'materials'],
    [equipment, 128, 'equipment'],
    [controls, 128, 'controls'],
    [hazards, 128, 'hazards'],
    [steps, MAX_PROCEDURE_STEPS, 'steps'],
    [criteria, 128, 'acceptance_criteria']
  ];
  for (const [items, maximum, label] of collections) {
    if (!Array.isArray(items) || items.length > maximum) {
      throw procedureError(label + ' must contain at most ' + maximum + ' entries.');
    }
  }
  if (steps.length < 1) throw procedureError('Procedure requires at least one step.');
  const normalizedMaterials = materials.map(normalizeMaterial);
  const normalizedEquipment = equipment.map(normalizeEquipment);
  const normalizedControls = controls.map(normalizeControl);
  const normalizedHazards = hazards.map(normalizeHazard);
  const normalizedSteps = steps.map(normalizeStep);
  const normalizedCriteria = criteria.map(normalizeCriterion);
  assertUnique(normalizedMaterials, 'material_id', 'Material');
  assertUnique(normalizedEquipment, 'equipment_id', 'Equipment');
  assertUnique(normalizedControls, 'control_id', 'Control');
  assertUnique(normalizedHazards, 'hazard_id', 'Hazard');
  assertUnique(normalizedSteps, 'step_id', 'Step');
  assertUnique(normalizedCriteria, 'criterion_id', 'Acceptance criterion');
  const targets = boundedStringArray(value.automation_targets, 'Automation targets', 2, 64)
    .map((item) => {
      if (!AUTOMATION_TARGETS.has(item)) {
        throw procedureError('Automation target is invalid: ' + item);
      }
      return item;
    });
  if (new Set(targets).size !== targets.length) {
    throw procedureError('Automation targets must be unique.');
  }
  return {
    name: boundedText(value.name, 'Procedure name', 240),
    objective: boundedText(value.objective, 'Procedure objective', 4_000),
    domain,
    context_of_use: boundedText(value.context_of_use, 'Procedure context of use', 4_000),
    supersedes_procedure_id: supersedes,
    source_evidence_ids: evidenceIds,
    materials: normalizedMaterials,
    equipment: normalizedEquipment,
    controls: normalizedControls,
    hazards: normalizedHazards,
    steps: normalizedSteps,
    acceptance_criteria: normalizedCriteria,
    stop_conditions: boundedStringArray(value.stop_conditions, 'Stop conditions', 64, 1_000),
    training_requirements: boundedStringArray(
      value.training_requirements, 'Training requirements', 64, 1_000),
    emergency_procedures: boundedStringArray(
      value.emergency_procedures, 'Emergency procedures', 64, 1_500),
    waste_and_decontamination: boundedText(
      value.waste_and_decontamination, 'Waste and decontamination plan', 4_000),
    automation_targets: targets,
    physical_execution_policy: policy,
    notes: boundedText(value.notes, 'Procedure notes', 4_000, { optional: true })
  };
}

const XDL_MAPPING = Object.freeze({
  add: 'Add',
  transfer: 'Transfer',
  mix: 'Stir',
  incubate: 'Wait',
  heat_cool: 'HeatChill',
  separate: 'Separate',
  wash: 'WashSolid',
  wait: 'Wait'
});

const OPENTRONS_MAPPING = Object.freeze({
  add: 'transfer',
  transfer: 'transfer',
  mix: 'mix',
  incubate: 'delay',
  heat_cool: 'module-context',
  wait: 'delay'
});

function topologicalDryRun(steps) {
  const byId = new Map(steps.map((step) => [step.step_id, step]));
  const indegree = new Map(steps.map((step) => [step.step_id, 0]));
  const outgoing = new Map(steps.map((step) => [step.step_id, []]));
  const unknown = [];
  for (const step of steps) {
    for (const dependency of step.depends_on) {
      if (!byId.has(dependency)) {
        unknown.push({ step_id: step.step_id, dependency });
        continue;
      }
      indegree.set(step.step_id, indegree.get(step.step_id) + 1);
      outgoing.get(dependency).push(step.step_id);
    }
  }
  const orderIndex = new Map(steps.map((step, index) => [step.step_id, index]));
  const ready = steps.filter((step) => indegree.get(step.step_id) === 0)
    .map((step) => step.step_id);
  const order = [];
  while (ready.length) {
    ready.sort((left, right) => orderIndex.get(left) - orderIndex.get(right));
    const current = ready.shift();
    order.push(current);
    for (const next of outgoing.get(current)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  const cycle = steps.map((step) => step.step_id).filter((id) => !order.includes(id));
  return { order, unknown_dependencies: unknown, cycle };
}

function durationSeconds(quantity) {
  if (!quantity) return null;
  const unit = quantity.unit.toLowerCase().replace(/\s+/g, '');
  const factors = {
    s: 1, sec: 1, second: 1, seconds: 1,
    min: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hour: 3600, hours: 3600,
    day: 86400, days: 86400
  };
  return Object.hasOwn(factors, unit) ? quantity.value * factors[unit] : null;
}

function adapterPreview(procedure, target) {
  const mapping = target === 'xdl_2_0' ? XDL_MAPPING : OPENTRONS_MAPPING;
  const label = target === 'xdl_2_0' ? 'XDL 2.0' : 'Opentrons Python';
  const steps = procedure.steps.map((step) => ({
    step_id: step.step_id,
    operation: step.operation,
    target_operation: mapping[step.operation] ?? null,
    status: mapping[step.operation] ? 'mapped' : 'manual_or_unsupported'
  }));
  const unmapped = steps.filter((step) => !step.target_operation).map((step) => step.step_id);
  const externalRequirements = target === 'xdl_2_0'
    ? [
        'Bind platform-specific hardware graph and vessel identifiers.',
        'Validate every mapped step against the selected XDL implementation and hardware.'
      ]
    : [
        'Bind robot type, API level, deck slots, labware definitions, instruments, and wells.',
        'Simulate the generated protocol with the matching Opentrons software before robot review.'
      ];
  return {
    target,
    label,
    requested: procedure.automation_targets.includes(target),
    status: procedure.automation_targets.includes(target)
      ? unmapped.length ? 'partial_mapping' : 'mapping_complete'
      : 'not_requested',
    steps,
    unmapped_step_ids: unmapped,
    external_requirements: externalRequirements,
    execution_enabled: false,
    disclaimer: 'Mapping preview only; this is not an executable protocol or hardware authorization.'
  };
}

function gate(id, label, status, detail) {
  return { id, label, status, detail };
}

function finding(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

export function evaluateProcedurePlan(procedure) {
  const plan = normalizeProcedureSpec(procedure);
  const findings = [];
  const materialIds = new Set(plan.materials.map((item) => item.material_id));
  const equipmentIds = new Set(plan.equipment.map((item) => item.equipment_id));
  const hazardIds = new Set(plan.hazards.map((item) => item.hazard_id));
  const stepIds = new Set(plan.steps.map((item) => item.step_id));
  const graph = topologicalDryRun(plan.steps);

  for (const item of graph.unknown_dependencies) {
    findings.push(finding(
      'error',
      'unknown_step_dependency',
      'Step ' + item.step_id + ' depends on unknown step ' + item.dependency + '.',
      item
    ));
  }
  if (graph.cycle.length) {
    findings.push(finding(
      'error',
      'step_dependency_cycle',
      'Procedure step dependencies contain a cycle.',
      { step_ids: graph.cycle }
    ));
  }

  for (const step of plan.steps) {
    for (const material of step.materials) {
      if (!materialIds.has(material.material_id)) {
        findings.push(finding(
          'error',
          'unknown_step_material',
          'Step ' + step.step_id + ' references unknown material ' + material.material_id + '.',
          { step_id: step.step_id, material_id: material.material_id }
        ));
      }
    }
    for (const equipmentId of step.equipment_ids) {
      if (!equipmentIds.has(equipmentId)) {
        findings.push(finding(
          'error',
          'unknown_step_equipment',
          'Step ' + step.step_id + ' references unknown equipment ' + equipmentId + '.',
          { step_id: step.step_id, equipment_id: equipmentId }
        ));
      }
    }
    for (const hazardId of step.hazard_ids) {
      if (!hazardIds.has(hazardId)) {
        findings.push(finding(
          'error',
          'unknown_step_hazard',
          'Step ' + step.step_id + ' references unknown hazard ' + hazardId + '.',
          { step_id: step.step_id, hazard_id: hazardId }
        ));
      }
    }
    if (!step.hazard_ids.length) {
      findings.push(finding(
        'warning',
        'step_without_linked_hazard',
        'Step ' + step.step_id + ' has an explicit risk note but no linked hazard record.',
        { step_id: step.step_id }
      ));
    }
  }

  for (const hazard of plan.hazards) {
    for (const stepId of hazard.applies_to_steps) {
      if (!stepIds.has(stepId)) {
        findings.push(finding(
          'error',
          'unknown_hazard_step',
          'Hazard ' + hazard.hazard_id + ' references unknown step ' + stepId + '.',
          { hazard_id: hazard.hazard_id, step_id: stepId }
        ));
      }
    }
    if (['moderate', 'high', 'critical'].includes(hazard.severity) &&
        hazard.controls.length === 0) {
      findings.push(finding(
        'error',
        'hazard_without_controls',
        'Hazard ' + hazard.hazard_id + ' requires documented controls.',
        { hazard_id: hazard.hazard_id, severity: hazard.severity }
      ));
    }
    if (['high', 'critical'].includes(hazard.severity) &&
        !hazard.controls.some((control) =>
          ['elimination', 'substitution', 'engineering', 'administrative', 'work_practice']
            .includes(control.type))) {
      findings.push(finding(
        'error',
        'high_hazard_relies_on_ppe_or_emergency_only',
        'High or critical hazard ' + hazard.hazard_id +
          ' requires a control above PPE or emergency response.',
        { hazard_id: hazard.hazard_id, severity: hazard.severity }
      ));
    }
    if (hazard.severity === 'critical') {
      findings.push(finding(
        'warning',
        'critical_hazard_requires_specialist_review',
        'Critical hazard ' + hazard.hazard_id + ' requires qualified facility-specific review.',
        { hazard_id: hazard.hazard_id }
      ));
    }
  }

  const laboratory = ['chemistry', 'biology', 'drug_discovery', 'materials']
    .includes(plan.domain);
  if (!plan.source_evidence_ids.length) {
    findings.push(finding(
      laboratory ? 'error' : 'warning',
      'procedure_without_source_evidence',
      'No immutable source evidence is linked to this procedure.'
    ));
  }
  if (laboratory && !plan.materials.length) {
    findings.push(finding('error', 'laboratory_procedure_without_materials',
      'Laboratory procedure requires an explicit material inventory.'));
  }
  if (laboratory && !plan.equipment.length) {
    findings.push(finding('error', 'laboratory_procedure_without_equipment',
      'Laboratory procedure requires equipment and operating limits.'));
  }
  if (laboratory && !plan.hazards.length) {
    findings.push(finding('error', 'laboratory_procedure_without_hazards',
      'Laboratory procedure requires a protocol-specific hazard assessment.'));
  }
  if (laboratory && !plan.training_requirements.length) {
    findings.push(finding('error', 'laboratory_procedure_without_training',
      'Laboratory procedure requires explicit training requirements.'));
  }
  if (laboratory && !plan.emergency_procedures.length) {
    findings.push(finding('error', 'laboratory_procedure_without_emergency_plan',
      'Laboratory procedure requires emergency procedures.'));
  }
  if (laboratory && !plan.stop_conditions.length) {
    findings.push(finding('error', 'laboratory_procedure_without_stop_conditions',
      'Laboratory procedure requires explicit stop conditions.'));
  }
  if (!plan.acceptance_criteria.length) {
    findings.push(finding('error', 'procedure_without_acceptance_criteria',
      'Procedure requires at least one overall acceptance criterion.'));
  }
  if (plan.domain === 'drug_discovery') {
    const types = new Set(plan.controls.map((item) => item.type));
    if (![...types].some((type) => ['positive', 'reference'].includes(type)) ||
        ![...types].some((type) => ['negative', 'vehicle', 'blank'].includes(type))) {
      findings.push(finding(
        'error',
        'drug_discovery_control_strategy_incomplete',
        'Drug-discovery procedures require both positive/reference and negative/vehicle/blank controls.'
      ));
    }
  }

  const durations = plan.steps.map((step) => ({
    step_id: step.step_id,
    duration: step.duration,
    seconds: durationSeconds(step.duration)
  }));
  const knownDurations = durations.filter((item) => item.seconds !== null);
  const materialTotals = {};
  for (const step of plan.steps) {
    for (const material of step.materials) {
      if (!material.amount) continue;
      const key = material.material_id + '|' + material.amount.unit;
      materialTotals[key] = (materialTotals[key] ?? 0) + material.amount.value;
    }
  }
  const adapters = [
    adapterPreview(plan, 'xdl_2_0'),
    adapterPreview(plan, 'opentrons_python')
  ];
  for (const adapter of adapters.filter((item) => item.requested)) {
    if (adapter.unmapped_step_ids.length) {
      findings.push(finding(
        'info',
        'adapter_mapping_incomplete',
        adapter.label + ' has manual or unsupported step mappings.',
        { target: adapter.target, step_ids: adapter.unmapped_step_ids }
      ));
    }
  }

  const errors = findings.filter((item) => item.severity === 'error');
  const warnings = findings.filter((item) => item.severity === 'warning');
  const sourceStatus = plan.source_evidence_ids.length
    ? 'pass' : laboratory ? 'blocked' : 'attention';
  const resourceStatus = !laboratory || (plan.materials.length && plan.equipment.length)
    ? 'pass' : 'blocked';
  const hazardStatus = findings.some((item) =>
    item.severity === 'error' && /hazard|training|emergency|stop_condition/.test(item.code))
    ? 'blocked'
    : warnings.some((item) => /hazard/.test(item.code)) ? 'attention' : 'pass';
  const graphStatus = graph.unknown_dependencies.length || graph.cycle.length
    ? 'blocked' : 'pass';
  const status = errors.length ? 'blocked' : 'ready_for_human_review';
  const gates = [
    gate('objective', 'Objective and context of use', 'pass',
      'Objective and context are explicit.'),
    gate('sources', 'Source methods and provenance', sourceStatus,
      plan.source_evidence_ids.length + ' immutable evidence record(s).'),
    gate('resources', 'Materials, equipment, and operating limits', resourceStatus,
      plan.materials.length + ' material(s), ' + plan.equipment.length + ' equipment item(s).'),
    gate('controls', 'Controls and acceptance criteria',
      plan.acceptance_criteria.length && (plan.domain !== 'drug_discovery' ||
        !findings.some((item) => item.code === 'drug_discovery_control_strategy_incomplete'))
        ? 'pass' : 'blocked',
      plan.controls.length + ' control(s), ' + plan.acceptance_criteria.length +
        ' overall criterion/criteria.'),
    gate('dependency_graph', 'Step graph and references', graphStatus,
      graph.order.length + '/' + plan.steps.length + ' steps ordered.'),
    gate('hazards', 'Hazards, controls, training, and emergency response', hazardStatus,
      plan.hazards.length + ' hazard(s), ' + plan.training_requirements.length +
        ' training requirement(s).'),
    gate('dry_run', 'Deterministic logical dry-run',
      graphStatus === 'pass' ? 'pass' : 'blocked',
      'No physical action; validates order, references, totals, and adapter mappings.'),
    gate('approval', 'Named human approval before physical execution', 'human_required',
      'ScienceCode records local attestations but never controls or authorizes hardware.')
  ];
  return {
    schema_version: PROCEDURE_ASSESSMENT_SCHEMA_VERSION,
    engine: {
      name: 'sciencecode-procedure-logical-dry-run',
      version: PROCEDURE_DRY_RUN_ENGINE_VERSION
    },
    status,
    gates,
    graph,
    resources: {
      materials: plan.materials.length,
      equipment: plan.equipment.length,
      controls: plan.controls.length,
      hazards: plan.hazards.length,
      steps: plan.steps.length,
      material_totals: Object.entries(materialTotals).map(([key, value]) => {
        const [material_id, unit] = key.split('|');
        return { material_id, value, unit };
      }),
      duration: {
        known_steps: knownDurations.length,
        unknown_steps: durations.length - knownDurations.length,
        total_seconds: knownDurations.reduce((total, item) => total + item.seconds, 0)
      }
    },
    adapters,
    findings,
    summary: {
      status,
      errors: errors.length,
      warnings: warnings.length,
      info: findings.filter((item) => item.severity === 'info').length,
      gates_passed: gates.filter((item) => item.status === 'pass').length,
      gates_blocked: gates.filter((item) => item.status === 'blocked').length,
      human_gates: gates.filter((item) => item.status === 'human_required').length
    },
    physical_execution: {
      enabled: false,
      policy: PHYSICAL_POLICY,
      statement: 'ScienceCode does not execute, schedule, or authorize physical laboratory actions.'
    },
    interpretation: [
      'This is a deterministic structural and logical dry-run, not a facility safety determination.',
      'Adapter output is a non-executable mapping preview and requires vendor validation.',
      'A local human decision record is an attestation, not identity verification or regulatory approval.'
    ]
  };
}

function normalizeId(value, pattern, label, code) {
  const id = String(value ?? '');
  if (!pattern.test(id) || id === '.' || id === '..') {
    throw procedureError('Invalid ' + label + ' ID: ' + id, code);
  }
  return id;
}

function normalizeProcedureId(value) {
  return normalizeId(value, PROCEDURE_ID_PATTERN, 'procedure', 'INVALID_PROCEDURE_ID');
}

function normalizeAssessmentId(value) {
  return normalizeId(
    value, ASSESSMENT_ID_PATTERN, 'procedure assessment', 'INVALID_PROCEDURE_ASSESSMENT_ID');
}

function normalizeDecisionId(value) {
  return normalizeId(
    value, DECISION_ID_PATTERN, 'procedure decision', 'INVALID_PROCEDURE_DECISION_ID');
}

function makeId(prefix, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return prefix + stamp + '-' + crypto.randomBytes(4).toString('hex');
}

export function makeProcedureId(now = new Date()) {
  return makeId('procedure-', now);
}

export function makeProcedureAssessmentId(now = new Date()) {
  return makeId('procedure-assessment-', now);
}

export function makeProcedureDecisionId(now = new Date()) {
  return makeId('procedure-decision-', now);
}

function secureRoot(cwd, name, { create = false } = {}) {
  const project = path.resolve(cwd);
  const metadata = path.join(project, INTERNAL_DIR);
  const root = path.join(metadata, name);
  if (fs.existsSync(metadata)) {
    const projectReal = fs.realpathSync(project);
    const metadataStat = fs.lstatSync(metadata);
    if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() ||
        !isPathInside(projectReal, fs.realpathSync(metadata))) {
      throw procedureError('ScienceCode metadata storage escapes the project.',
        'INVALID_PROCEDURE_PATH');
    }
  }
  if (create) {
    ensureScienceDir(project);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(root)) return root;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw procedureError('Procedure storage must be a real project directory.',
      'INVALID_PROCEDURE_PATH');
  }
  const metadataReal = fs.realpathSync(metadata);
  const rootReal = fs.realpathSync(root);
  if (!isPathInside(metadataReal, rootReal)) {
    throw procedureError('Procedure storage escapes the project metadata root.',
      'INVALID_PROCEDURE_PATH');
  }
  return rootReal;
}

function recordDirectory(cwd, rootName, id) {
  return path.join(secureRoot(cwd, rootName), id);
}

function safeRecordDirectory(cwd, rootName, id, notFoundCode, label) {
  const root = secureRoot(cwd, rootName);
  const directory = path.join(root, id);
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw procedureError(label + ' not found: ' + id, notFoundCode);
  }
  const directoryReal = fs.realpathSync(directory);
  if (!isPathInside(root, directoryReal)) {
    throw procedureError(label + ' escapes its storage root.', 'INVALID_PROCEDURE_PATH');
  }
  return directoryReal;
}

function safeRegularFile(file, directory) {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return Boolean(stat?.isFile() && !stat.isSymbolicLink() &&
      isPathInside(directory, fs.realpathSync(file)));
  } catch {
    return false;
  }
}

function safeRemoveStaging(root, staging, prefix) {
  if (!isPathInside(root, staging) ||
      path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith(prefix)) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function descriptor(file) {
  return { sha256: sha256File(file), bytes: fs.statSync(file).size };
}

function validateTimestamp(now, label) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw procedureError(label + ' timestamp is invalid.');
  }
}

function validateChat(cwd, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = String(value);
  if (!CHAT_ID_PATTERN.test(id)) {
    throw procedureError('Invalid chat ID: ' + id, 'INVALID_CHAT_ID');
  }
  try {
    getChatManifest(cwd, id);
  } catch {
    throw procedureError('Chat not found: ' + id, 'CHAT_NOT_FOUND');
  }
  return id;
}

function cloneJson(value, label, maximumBytes = MAX_PROCEDURE_SPEC_BYTES) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw procedureError(label + ' must be JSON serializable: ' + error.message);
  }
  if (text === undefined || Buffer.byteLength(text) > maximumBytes) {
    throw procedureError(label + ' exceeds its safe JSON limit.');
  }
  return JSON.parse(text);
}

function registryIds(cwd, {
  rootName,
  pattern,
  auditType,
  auditField
}) {
  const ids = new Set();
  try {
    const root = secureRoot(cwd, rootName);
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (pattern.test(entry.name)) ids.add(entry.name);
      }
    }
  } catch {
    // Audit discovery still exposes unsafe or removed records when possible.
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === auditType && pattern.test(String(record[auditField] ?? ''))) {
        ids.add(record[auditField]);
      }
    }
  } catch {
    // Project verification reports audit failures.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

function procedureIds(cwd) {
  return registryIds(cwd, {
    rootName: 'procedures',
    pattern: PROCEDURE_ID_PATTERN,
    auditType: 'procedure.created',
    auditField: 'procedure_id'
  });
}

function procedureFiles(cwd, value, safe = false) {
  const id = normalizeProcedureId(value);
  const directory = safe
    ? safeRecordDirectory(cwd, 'procedures', id, 'PROCEDURE_NOT_FOUND', 'Procedure')
    : recordDirectory(cwd, 'procedures', id);
  return {
    id,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    procedure: path.join(directory, 'procedure.json'),
    request: path.join(directory, 'request.json')
  };
}

export function resolveProcedureDirectory(cwd, value) {
  return procedureFiles(cwd, value).directory;
}

function verifiedEvidenceLinks(cwd, ids) {
  return ids.map((evidenceId) => {
    const verification = verifyEvidence(cwd, evidenceId);
    if (!verification.ok) {
      throw Object.assign(
        new Error('Procedure source evidence failed integrity verification: ' + evidenceId),
        { code: 'PROCEDURE_EVIDENCE_INVALID', verification }
      );
    }
    return {
      evidence_id: evidenceId,
      manifest_sha256: verification.manifest_sha256
    };
  });
}

export function createProcedure({
  cwd,
  spec,
  chatId = null,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) {
    throw procedureError('Project directory does not exist: ' + project, 'PROJECT_NOT_FOUND');
  }
  validateTimestamp(now, 'Procedure');
  const normalizedChatId = validateChat(project, chatId);
  const submitted = cloneJson(spec, 'Procedure');
  const procedure = normalizeProcedureSpec(submitted);
  const evidence = verifiedEvidenceLinks(project, procedure.source_evidence_ids);
  let supersedes = null;
  if (procedure.supersedes_procedure_id) {
    const previous = verifyProcedure(project, procedure.supersedes_procedure_id);
    if (!previous.ok) {
      throw Object.assign(
        new Error('Superseded procedure failed integrity verification.'),
        { code: 'SUPERSEDED_PROCEDURE_INVALID', verification: previous }
      );
    }
    const previousTime = Date.parse(previous.manifest.created_at);
    if (!Number.isFinite(previousTime) || now.getTime() <= previousTime) {
      throw procedureError(
        'A procedure revision must be created after the record it supersedes.',
        'PROCEDURE_TIMESTAMP_ORDER'
      );
    }
    supersedes = {
      procedure_id: previous.procedure_id,
      manifest_sha256: previous.manifest_sha256
    };
  }
  if (procedureIds(project).length >= MAX_PROCEDURES) {
    throw procedureError('Procedure limit reached for this project.', 'PROCEDURE_LIMIT');
  }
  const root = secureRoot(project, 'procedures', { create: true });
  const id = makeProcedureId(now);
  const finalDirectory = recordDirectory(project, 'procedures', id);
  const staging = path.join(root, '.staging-procedure-' + crypto.randomBytes(8).toString('hex'));
  if (fs.existsSync(finalDirectory)) {
    throw procedureError('Procedure already exists: ' + id, 'PROCEDURE_EXISTS');
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    writeJsonExclusive(path.join(staging, 'request.json'), submitted);
    writeJsonExclusive(path.join(staging, 'procedure.json'), procedure);
    const manifest = {
      schema_version: PROCEDURE_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      procedure_id: id,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      name: procedure.name,
      domain: procedure.domain,
      status: 'frozen',
      supersedes,
      source_evidence: evidence,
      procedure: {
        file: 'procedure.json',
        ...descriptor(path.join(staging, 'procedure.json'))
      },
      request: {
        file: 'request.json',
        ...descriptor(path.join(staging, 'request.json'))
      },
      counts: {
        materials: procedure.materials.length,
        equipment: procedure.equipment.length,
        controls: procedure.controls.length,
        hazards: procedure.hazards.length,
        steps: procedure.steps.length,
        acceptance_criteria: procedure.acceptance_criteria.length
      },
      automation_targets: procedure.automation_targets,
      physical_execution: {
        enabled: false,
        policy: PHYSICAL_POLICY
      },
      preservation_policy: 'immutable procedure plan; changes create a superseding record'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(path.join(staging, 'manifest.json')) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'procedure.created',
      procedure_id: id,
      chat_id: normalizedChatId,
      manifest_sha256: manifestSha256,
      procedure_sha256: manifest.procedure.sha256,
      supersedes_procedure_id: supersedes?.procedure_id ?? null
    });
    return { manifest, procedure, manifest_sha256: manifestSha256, directory: finalDirectory };
  } catch (error) {
    if (fs.existsSync(staging)) {
      safeRemoveStaging(root, staging, '.staging-procedure-');
    }
    throw error;
  }
}

function verifyFileDescriptor(files, value, expectedFile, errors, label) {
  if (!value || value.file !== expectedFile) {
    errors.push({ file: expectedFile, issue: 'invalid_' + label + '_descriptor' });
    return;
  }
  const file = path.join(files.directory, expectedFile);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!safeRegularFile(file, files.directory)) {
    errors.push({ file: expectedFile, issue: 'missing' });
    return;
  }
  const actualHash = sha256File(file);
  if (value.sha256 !== actualHash) {
    errors.push({
      file: expectedFile,
      issue: 'hash_mismatch',
      expected: value.sha256,
      actual: actualHash
    });
  }
  if (value.bytes !== stat.size) {
    errors.push({
      file: expectedFile,
      issue: 'size_mismatch',
      expected: value.bytes,
      actual: stat.size
    });
  }
}

export function verifyProcedure(cwd, value, { ancestry = [] } = {}) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeProcedureId(value);
  } catch (error) {
    return {
      ok: false,
      procedure_id: String(value ?? ''),
      errors: [{ issue: error.code ?? 'invalid_procedure_id', detail: error.message }]
    };
  }
  if (ancestry.includes(id)) {
    return {
      ok: false,
      procedure_id: id,
      manifest: null,
      procedure: null,
      manifest_sha256: null,
      errors: [{ issue: 'procedure_supersession_cycle', ancestry: [...ancestry, id] }]
    };
  }
  const nextAncestry = [...ancestry, id];
  let files;
  try {
    files = procedureFiles(project, id, true);
  } catch (error) {
    return {
      ok: false,
      procedure_id: id,
      errors: [{ issue: error.code ?? 'procedure_path_error', detail: error.message }]
    };
  }
  const errors = [];
  for (const [label, file] of [
    ['manifest.json', files.manifest],
    ['manifest.sha256', files.digest],
    ['procedure.json', files.procedure],
    ['request.json', files.request]
  ]) {
    if (!safeRegularFile(file, files.directory)) {
      errors.push({ file: label, issue: 'missing' });
    }
  }
  let manifest = null;
  let procedure = null;
  let request = null;
  try {
    if (safeRegularFile(files.manifest, files.directory)) manifest = readJson(files.manifest);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (safeRegularFile(files.procedure, files.directory)) procedure = readJson(files.procedure);
  } catch (error) {
    errors.push({ file: 'procedure.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (safeRegularFile(files.request, files.directory)) request = readJson(files.request);
  } catch (error) {
    errors.push({ file: 'request.json', issue: 'invalid_json', detail: error.message });
  }
  const manifestSha256 = safeRegularFile(files.manifest, files.directory)
    ? sha256File(files.manifest) : null;
  if (safeRegularFile(files.digest, files.directory)) {
    const expected = fs.readFileSync(files.digest, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(expected) || expected !== manifestSha256) {
      errors.push({
        file: 'manifest.sha256',
        issue: 'hash_mismatch',
        expected,
        actual: manifestSha256
      });
    }
  }
  if (manifest) {
    if (manifest.schema_version !== PROCEDURE_SCHEMA_VERSION) {
      errors.push({
        file: 'manifest.json',
        issue: 'unsupported_schema',
        expected: PROCEDURE_SCHEMA_VERSION,
        actual: manifest.schema_version
      });
    }
    if (manifest.procedure_id !== id) {
      errors.push({ file: 'manifest.json', issue: 'procedure_id_mismatch' });
    }
    if (manifest.status !== 'frozen') {
      errors.push({ file: 'manifest.json', issue: 'invalid_status' });
    }
    if (!Number.isFinite(Date.parse(manifest.created_at))) {
      errors.push({ file: 'manifest.json', issue: 'invalid_timestamp' });
    }
    if (manifest.physical_execution?.enabled !== false ||
        manifest.physical_execution?.policy !== PHYSICAL_POLICY) {
      errors.push({ file: 'manifest.json', issue: 'invalid_physical_execution_policy' });
    }
    verifyFileDescriptor(files, manifest.procedure, 'procedure.json', errors, 'procedure');
    verifyFileDescriptor(files, manifest.request, 'request.json', errors, 'request');
  }
  let normalized = null;
  try {
    if (procedure) normalized = normalizeProcedureSpec(procedure);
    if (procedure && sha256Json(normalized) !== sha256Json(procedure)) {
      errors.push({ file: 'procedure.json', issue: 'noncanonical_procedure' });
    }
  } catch (error) {
    errors.push({
      file: 'procedure.json',
      issue: error.code ?? 'invalid_procedure',
      detail: error.message
    });
  }
  try {
    if (request && normalized) {
      const replay = normalizeProcedureSpec(request);
      if (sha256Json(replay) !== sha256Json(normalized)) {
        errors.push({ file: 'request.json', issue: 'normalization_replay_mismatch' });
      }
    }
  } catch (error) {
    errors.push({
      file: 'request.json',
      issue: error.code ?? 'invalid_request',
      detail: error.message
    });
  }
  if (manifest && normalized) {
    const expectedCounts = {
      materials: normalized.materials.length,
      equipment: normalized.equipment.length,
      controls: normalized.controls.length,
      hazards: normalized.hazards.length,
      steps: normalized.steps.length,
      acceptance_criteria: normalized.acceptance_criteria.length
    };
    if (sha256Json(manifest.counts) !== sha256Json(expectedCounts)) {
      errors.push({ file: 'manifest.json', issue: 'count_mismatch' });
    }
    if (sha256Json(manifest.automation_targets) !==
        sha256Json(normalized.automation_targets)) {
      errors.push({ file: 'manifest.json', issue: 'automation_target_mismatch' });
    }
    const linkedEvidence = Array.isArray(manifest.source_evidence)
      ? manifest.source_evidence : [];
    if (linkedEvidence.length !== normalized.source_evidence_ids.length) {
      errors.push({ file: 'manifest.json', issue: 'evidence_count_mismatch' });
    }
    for (const evidenceId of normalized.source_evidence_ids) {
      const link = linkedEvidence.find((item) => item.evidence_id === evidenceId);
      const verification = verifyEvidence(project, evidenceId);
      if (!verification.ok) {
        errors.push({
          evidence_id: evidenceId,
          issue: 'evidence_invalid',
          errors: verification.errors
        });
      } else if (!link || link.manifest_sha256 !== verification.manifest_sha256) {
        errors.push({ evidence_id: evidenceId, issue: 'evidence_digest_mismatch' });
      }
    }
    if (normalized.supersedes_procedure_id) {
      const link = manifest.supersedes;
      const previous = verifyProcedure(project, normalized.supersedes_procedure_id, {
        ancestry: nextAncestry
      });
      if (!previous.ok) {
        errors.push({
          procedure_id: normalized.supersedes_procedure_id,
          issue: 'superseded_procedure_invalid',
          errors: previous.errors
        });
      } else {
        if (!link || link.procedure_id !== previous.procedure_id ||
            link.manifest_sha256 !== previous.manifest_sha256) {
          errors.push({ file: 'manifest.json', issue: 'superseded_digest_mismatch' });
        }
        if (Date.parse(manifest.created_at) <= Date.parse(previous.manifest.created_at)) {
          errors.push({ file: 'manifest.json', issue: 'supersession_timestamp_order' });
        }
      }
    } else if (manifest.supersedes !== null) {
      errors.push({ file: 'manifest.json', issue: 'unexpected_supersedes_link' });
    }
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else if (manifestSha256 && manifest) {
    const link = readAuditRecords(project).find((record) =>
      record.type === 'procedure.created' && record.procedure_id === id
    );
    if (!link || link.manifest_sha256 !== manifestSha256 ||
        link.procedure_sha256 !== manifest.procedure?.sha256 ||
        link.supersedes_procedure_id !== (manifest.supersedes?.procedure_id ?? null)) {
      errors.push({ issue: 'audit_link_mismatch' });
    }
  }
  return {
    ok: errors.length === 0,
    procedure_id: id,
    manifest,
    procedure: normalized ?? procedure,
    manifest_sha256: manifestSha256,
    errors
  };
}

export function getProcedure(cwd, value) {
  const verification = verifyProcedure(cwd, value);
  if (!verification.manifest || !verification.procedure) {
    throw procedureError(
      'Procedure not found: ' + String(value ?? ''), 'PROCEDURE_NOT_FOUND');
  }
  return {
    manifest: verification.manifest,
    procedure: verification.procedure,
    verification
  };
}

export function getProcedureManifest(cwd, value) {
  return getProcedure(cwd, value).manifest;
}

export function listProcedures(cwd) {
  const records = procedureIds(cwd).map((id) => {
    const verification = verifyProcedure(cwd, id);
    return {
      procedure_id: id,
      name: verification.manifest?.name ?? null,
      domain: verification.manifest?.domain ?? null,
      status: verification.manifest?.status ?? 'missing',
      created_at: verification.manifest?.created_at ?? null,
      chat_id: verification.manifest?.chat_id ?? null,
      supersedes_procedure_id:
        verification.manifest?.supersedes?.procedure_id ?? null,
      counts: verification.manifest?.counts ?? null,
      source_evidence_count:
        verification.manifest?.source_evidence?.length ?? 0,
      automation_targets: verification.manifest?.automation_targets ?? [],
      physical_execution_enabled:
        verification.manifest?.physical_execution?.enabled ?? false,
      verified: verification.ok
    };
  });
  const superseded = new Map();
  for (const record of records) {
    if (record.supersedes_procedure_id && record.verified) {
      const existing = superseded.get(record.supersedes_procedure_id);
      if (!existing || String(record.created_at).localeCompare(String(existing.created_at)) > 0) {
        superseded.set(record.supersedes_procedure_id, record);
      }
    }
  }
  return records.map((record) => ({
    ...record,
    current: !superseded.has(record.procedure_id),
    superseded_by: superseded.get(record.procedure_id)?.procedure_id ?? null
  }));
}

function assessmentIds(cwd) {
  return registryIds(cwd, {
    rootName: 'procedure-assessments',
    pattern: ASSESSMENT_ID_PATTERN,
    auditType: 'procedure_assessment.created',
    auditField: 'procedure_assessment_id'
  });
}

function assessmentFiles(cwd, value, safe = false) {
  const id = normalizeAssessmentId(value);
  const directory = safe
    ? safeRecordDirectory(
        cwd,
        'procedure-assessments',
        id,
        'PROCEDURE_ASSESSMENT_NOT_FOUND',
        'Procedure assessment'
      )
    : recordDirectory(cwd, 'procedure-assessments', id);
  return {
    id,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    report: path.join(directory, 'report.json')
  };
}

export function resolveProcedureAssessmentDirectory(cwd, value) {
  return assessmentFiles(cwd, value).directory;
}

function buildAssessmentReport(procedureVerification) {
  const evaluated = evaluateProcedurePlan(procedureVerification.procedure);
  return {
    ...evaluated,
    procedure: {
      procedure_id: procedureVerification.procedure_id,
      manifest_sha256: procedureVerification.manifest_sha256,
      procedure_sha256: procedureVerification.manifest.procedure.sha256,
      created_at: procedureVerification.manifest.created_at,
      name: procedureVerification.manifest.name,
      domain: procedureVerification.manifest.domain
    }
  };
}

export function createProcedureAssessment({
  cwd,
  procedureId,
  chatId = null,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  validateTimestamp(now, 'Procedure assessment');
  const normalizedChatId = validateChat(project, chatId);
  const procedure = verifyProcedure(project, procedureId);
  if (!procedure.ok) {
    throw Object.assign(
      new Error('Procedure failed integrity verification.'),
      { code: 'PROCEDURE_INVALID', verification: procedure }
    );
  }
  if (now.getTime() < Date.parse(procedure.manifest.created_at)) {
    throw procedureError(
      'Procedure assessment cannot predate its procedure.',
      'PROCEDURE_ASSESSMENT_TIMESTAMP_ORDER'
    );
  }
  if (assessmentIds(project).length >= MAX_PROCEDURE_ASSESSMENTS) {
    throw procedureError(
      'Procedure assessment limit reached for this project.',
      'PROCEDURE_ASSESSMENT_LIMIT'
    );
  }
  const report = buildAssessmentReport(procedure);
  const root = secureRoot(project, 'procedure-assessments', { create: true });
  const id = makeProcedureAssessmentId(now);
  const finalDirectory = recordDirectory(project, 'procedure-assessments', id);
  const staging = path.join(
    root, '.staging-procedure-assessment-' + crypto.randomBytes(8).toString('hex'));
  if (fs.existsSync(finalDirectory)) {
    throw procedureError(
      'Procedure assessment already exists: ' + id,
      'PROCEDURE_ASSESSMENT_EXISTS'
    );
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    writeJsonExclusive(path.join(staging, 'report.json'), report);
    const manifest = {
      schema_version: PROCEDURE_ASSESSMENT_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      procedure_assessment_id: id,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      status: report.status,
      procedure: {
        procedure_id: procedure.procedure_id,
        manifest_sha256: procedure.manifest_sha256,
        procedure_sha256: procedure.manifest.procedure.sha256
      },
      report: {
        file: 'report.json',
        ...descriptor(path.join(staging, 'report.json')),
        engine_version: PROCEDURE_DRY_RUN_ENGINE_VERSION
      },
      summary: report.summary,
      physical_execution: report.physical_execution,
      interpretation: 'Immutable non-executing procedure dry-run; qualified human review remains required.',
      preservation_policy: 'immutable assessment over an exact procedure record'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(path.join(staging, 'manifest.json')) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'procedure_assessment.created',
      procedure_assessment_id: id,
      procedure_id: procedure.procedure_id,
      chat_id: normalizedChatId,
      status: report.status,
      manifest_sha256: manifestSha256,
      report_sha256: manifest.report.sha256
    });
    return { manifest, report, manifest_sha256: manifestSha256, directory: finalDirectory };
  } catch (error) {
    if (fs.existsSync(staging)) {
      safeRemoveStaging(root, staging, '.staging-procedure-assessment-');
    }
    throw error;
  }
}

export function verifyProcedureAssessment(cwd, value) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeAssessmentId(value);
  } catch (error) {
    return {
      ok: false,
      procedure_assessment_id: String(value ?? ''),
      errors: [{ issue: error.code ?? 'invalid_procedure_assessment_id', detail: error.message }]
    };
  }
  let files;
  try {
    files = assessmentFiles(project, id, true);
  } catch (error) {
    return {
      ok: false,
      procedure_assessment_id: id,
      errors: [{ issue: error.code ?? 'procedure_assessment_path_error', detail: error.message }]
    };
  }
  const errors = [];
  for (const [label, file] of [
    ['manifest.json', files.manifest],
    ['manifest.sha256', files.digest],
    ['report.json', files.report]
  ]) {
    if (!safeRegularFile(file, files.directory)) {
      errors.push({ file: label, issue: 'missing' });
    }
  }
  let manifest = null;
  let report = null;
  try {
    if (safeRegularFile(files.manifest, files.directory)) manifest = readJson(files.manifest);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (safeRegularFile(files.report, files.directory)) report = readJson(files.report);
  } catch (error) {
    errors.push({ file: 'report.json', issue: 'invalid_json', detail: error.message });
  }
  const manifestSha256 = safeRegularFile(files.manifest, files.directory)
    ? sha256File(files.manifest) : null;
  if (safeRegularFile(files.digest, files.directory)) {
    const expected = fs.readFileSync(files.digest, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(expected) || expected !== manifestSha256) {
      errors.push({
        file: 'manifest.sha256',
        issue: 'hash_mismatch',
        expected,
        actual: manifestSha256
      });
    }
  }
  if (manifest) {
    if (manifest.schema_version !== PROCEDURE_ASSESSMENT_SCHEMA_VERSION) {
      errors.push({
        file: 'manifest.json',
        issue: 'unsupported_schema',
        expected: PROCEDURE_ASSESSMENT_SCHEMA_VERSION,
        actual: manifest.schema_version
      });
    }
    if (manifest.procedure_assessment_id !== id) {
      errors.push({ file: 'manifest.json', issue: 'procedure_assessment_id_mismatch' });
    }
    if (!Number.isFinite(Date.parse(manifest.created_at))) {
      errors.push({ file: 'manifest.json', issue: 'invalid_timestamp' });
    }
    if (!['blocked', 'ready_for_human_review'].includes(manifest.status)) {
      errors.push({ file: 'manifest.json', issue: 'invalid_status' });
    }
    if (manifest.physical_execution?.enabled !== false ||
        manifest.physical_execution?.policy !== PHYSICAL_POLICY) {
      errors.push({ file: 'manifest.json', issue: 'invalid_physical_execution_policy' });
    }
    verifyFileDescriptor(files, manifest.report, 'report.json', errors, 'report');
    if (manifest.report?.engine_version !== PROCEDURE_DRY_RUN_ENGINE_VERSION) {
      errors.push({ file: 'manifest.json', issue: 'unsupported_engine_version' });
    }
  }
  let procedure = null;
  if (manifest?.procedure?.procedure_id) {
    procedure = verifyProcedure(project, manifest.procedure.procedure_id);
    if (!procedure.ok) {
      errors.push({
        procedure_id: manifest.procedure.procedure_id,
        issue: 'procedure_invalid',
        errors: procedure.errors
      });
    } else {
      if (manifest.procedure.manifest_sha256 !== procedure.manifest_sha256 ||
          manifest.procedure.procedure_sha256 !== procedure.manifest.procedure.sha256) {
        errors.push({ file: 'manifest.json', issue: 'procedure_digest_mismatch' });
      }
      if (Date.parse(manifest.created_at) < Date.parse(procedure.manifest.created_at)) {
        errors.push({ file: 'manifest.json', issue: 'assessment_timestamp_order' });
      }
      try {
        const replay = buildAssessmentReport(procedure);
        if (sha256Json(replay) !== sha256Json(report)) {
          errors.push({ file: 'report.json', issue: 'deterministic_replay_mismatch' });
        }
      } catch (error) {
        errors.push({
          file: 'report.json',
          issue: error.code ?? 'assessment_replay_error',
          detail: error.message
        });
      }
    }
  } else if (manifest) {
    errors.push({ file: 'manifest.json', issue: 'missing_procedure_link' });
  }
  if (manifest && report) {
    if (manifest.status !== report.status ||
        sha256Json(manifest.summary) !== sha256Json(report.summary) ||
        sha256Json(manifest.physical_execution) !== sha256Json(report.physical_execution)) {
      errors.push({ file: 'manifest.json', issue: 'report_summary_mismatch' });
    }
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else if (manifestSha256 && manifest) {
    const link = readAuditRecords(project).find((record) =>
      record.type === 'procedure_assessment.created' &&
      record.procedure_assessment_id === id
    );
    if (!link || link.procedure_id !== manifest.procedure?.procedure_id ||
        link.status !== manifest.status ||
        link.manifest_sha256 !== manifestSha256 ||
        link.report_sha256 !== manifest.report?.sha256) {
      errors.push({ issue: 'audit_link_mismatch' });
    }
  }
  return {
    ok: errors.length === 0,
    procedure_assessment_id: id,
    manifest,
    report,
    manifest_sha256: manifestSha256,
    procedure,
    errors
  };
}

export function getProcedureAssessment(cwd, value) {
  const verification = verifyProcedureAssessment(cwd, value);
  if (!verification.manifest || !verification.report) {
    throw procedureError(
      'Procedure assessment not found: ' + String(value ?? ''),
      'PROCEDURE_ASSESSMENT_NOT_FOUND'
    );
  }
  return {
    manifest: verification.manifest,
    report: verification.report,
    verification
  };
}

export function getProcedureAssessmentManifest(cwd, value) {
  return getProcedureAssessment(cwd, value).manifest;
}

export function getProcedureAssessmentReport(cwd, value) {
  return getProcedureAssessment(cwd, value).report;
}

export function listProcedureAssessments(cwd) {
  const records = assessmentIds(cwd).map((id) => {
    const verification = verifyProcedureAssessment(cwd, id);
    return {
      procedure_assessment_id: id,
      procedure_id: verification.manifest?.procedure?.procedure_id ?? null,
      status: verification.manifest?.status ?? 'missing',
      created_at: verification.manifest?.created_at ?? null,
      chat_id: verification.manifest?.chat_id ?? null,
      summary: verification.manifest?.summary ?? null,
      gates: verification.report?.gates ?? [],
      adapters: verification.report?.adapters ?? [],
      findings: verification.report?.findings ?? [],
      physical_execution_enabled:
        verification.report?.physical_execution?.enabled ?? false,
      verified: verification.ok
    };
  });
  const latest = new Map();
  for (const record of records.filter((item) => item.verified && item.procedure_id)) {
    const existing = latest.get(record.procedure_id);
    if (!existing || String(record.created_at).localeCompare(String(existing.created_at)) > 0) {
      latest.set(record.procedure_id, record);
    }
  }
  return records.map((record) => {
    const current = latest.get(record.procedure_id);
    return {
      ...record,
      current_for_procedure: Boolean(current &&
        current.procedure_assessment_id === record.procedure_assessment_id),
      superseded_by: current && current.procedure_assessment_id !== record.procedure_assessment_id
        ? current.procedure_assessment_id : null
    };
  });
}

function normalizeDecisionInput(value, { now = null } = {}) {
  assertPlainObject(value, 'Procedure decision');
  rejectUnknownKeys(value, DECISION_KEYS, 'procedure decision');
  const decision = String(value.decision ?? '');
  const scope = String(value.scope ?? '');
  if (!DECISIONS.has(decision)) {
    throw procedureError('Procedure decision must be approve or reject.');
  }
  if (!DECISION_SCOPES.has(scope)) {
    throw procedureError('Procedure decision scope is invalid: ' + scope);
  }
  const attestation = booleanValue(value.attestation, 'Procedure decision attestation');
  if (decision === 'approve' && !attestation) {
    throw procedureError(
      'Approval requires the explicit non-execution attestation.',
      'PROCEDURE_DECISION_ATTESTATION_REQUIRED'
    );
  }
  let expiresAt = null;
  if (value.expires_at !== undefined && value.expires_at !== null &&
      String(value.expires_at).trim()) {
    const parsed = Date.parse(String(value.expires_at));
    if (!Number.isFinite(parsed)) {
      throw procedureError('Procedure decision expires_at must be an ISO timestamp.');
    }
    expiresAt = new Date(parsed).toISOString();
    if (now) {
      if (parsed <= now.getTime()) {
        throw procedureError(
          'Procedure approval expiry must be in the future.',
          'PROCEDURE_DECISION_EXPIRY'
        );
      }
      if (parsed > now.getTime() + 366 * 24 * 60 * 60 * 1000) {
        throw procedureError(
          'Procedure approval expiry cannot exceed 366 days.',
          'PROCEDURE_DECISION_EXPIRY'
        );
      }
    }
  }
  if (decision === 'approve' && scope === 'external_physical_execution' && !expiresAt) {
    throw procedureError(
      'External physical-execution attestations require an expiry.',
      'PROCEDURE_DECISION_EXPIRY_REQUIRED'
    );
  }
  return {
    procedure_id: normalizeProcedureId(value.procedure_id),
    procedure_assessment_id: normalizeAssessmentId(value.procedure_assessment_id),
    decision,
    scope,
    reviewer_name: boundedText(value.reviewer_name, 'Reviewer name', 240),
    reviewer_role: boundedText(value.reviewer_role, 'Reviewer role', 240),
    organization: boundedText(
      value.organization, 'Reviewer organization', 500, { optional: true }),
    basis: boundedText(value.basis, 'Decision basis', 4_000),
    conditions: boundedText(
      value.conditions, 'Decision conditions', 4_000, { optional: true }),
    expires_at: expiresAt,
    attestation
  };
}

function decisionIds(cwd) {
  return registryIds(cwd, {
    rootName: 'procedure-decisions',
    pattern: DECISION_ID_PATTERN,
    auditType: 'procedure_decision.created',
    auditField: 'procedure_decision_id'
  });
}

function decisionFiles(cwd, value, safe = false) {
  const id = normalizeDecisionId(value);
  const directory = safe
    ? safeRecordDirectory(
        cwd,
        'procedure-decisions',
        id,
        'PROCEDURE_DECISION_NOT_FOUND',
        'Procedure decision'
      )
    : recordDirectory(cwd, 'procedure-decisions', id);
  return {
    id,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    decision: path.join(directory, 'decision.json')
  };
}

export function resolveProcedureDecisionDirectory(cwd, value) {
  return decisionFiles(cwd, value).directory;
}

function assessmentCurrentAt(cwd, procedureId, assessmentId, timestamp) {
  const candidates = listProcedureAssessments(cwd)
    .filter((item) => item.verified && item.procedure_id === procedureId &&
      Number.isFinite(Date.parse(item.created_at)) &&
      Date.parse(item.created_at) <= timestamp)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  return candidates[0]?.procedure_assessment_id === assessmentId;
}

export function createProcedureDecision({
  cwd,
  input,
  chatId = null,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  validateTimestamp(now, 'Procedure decision');
  const normalizedChatId = validateChat(project, chatId);
  const submitted = cloneJson(input, 'Procedure decision', 64 * 1024);
  const decision = normalizeDecisionInput(submitted, { now });
  const procedure = verifyProcedure(project, decision.procedure_id);
  if (!procedure.ok) {
    throw Object.assign(
      new Error('Procedure failed integrity verification.'),
      { code: 'PROCEDURE_INVALID', verification: procedure }
    );
  }
  const assessment = verifyProcedureAssessment(project, decision.procedure_assessment_id);
  if (!assessment.ok) {
    throw Object.assign(
      new Error('Procedure assessment failed integrity verification.'),
      { code: 'PROCEDURE_ASSESSMENT_INVALID', verification: assessment }
    );
  }
  if (assessment.manifest.procedure.procedure_id !== procedure.procedure_id) {
    throw procedureError(
      'Procedure decision assessment belongs to a different procedure.',
      'PROCEDURE_DECISION_LINK_MISMATCH'
    );
  }
  if (!assessmentCurrentAt(
    project, procedure.procedure_id, assessment.procedure_assessment_id, now.getTime())) {
    throw procedureError(
      'Procedure decision requires the newest verified assessment for this procedure.',
      'PROCEDURE_ASSESSMENT_NOT_CURRENT'
    );
  }
  if (decision.decision === 'approve' &&
      assessment.report.status !== 'ready_for_human_review') {
    throw procedureError(
      'Blocked procedure assessment cannot be approved.',
      'PROCEDURE_NOT_READY'
    );
  }
  if (now.getTime() < Date.parse(assessment.manifest.created_at)) {
    throw procedureError(
      'Procedure decision cannot predate its assessment.',
      'PROCEDURE_DECISION_TIMESTAMP_ORDER'
    );
  }
  if (decisionIds(project).length >= MAX_PROCEDURE_DECISIONS) {
    throw procedureError(
      'Procedure decision limit reached for this project.',
      'PROCEDURE_DECISION_LIMIT'
    );
  }
  const root = secureRoot(project, 'procedure-decisions', { create: true });
  const id = makeProcedureDecisionId(now);
  const finalDirectory = recordDirectory(project, 'procedure-decisions', id);
  const staging = path.join(
    root, '.staging-procedure-decision-' + crypto.randomBytes(8).toString('hex'));
  if (fs.existsSync(finalDirectory)) {
    throw procedureError(
      'Procedure decision already exists: ' + id,
      'PROCEDURE_DECISION_EXISTS'
    );
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    writeJsonExclusive(path.join(staging, 'decision.json'), decision);
    const manifest = {
      schema_version: PROCEDURE_DECISION_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      procedure_decision_id: id,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      status: decision.decision === 'approve' ? 'approved' : 'rejected',
      scope: decision.scope,
      procedure: {
        procedure_id: procedure.procedure_id,
        manifest_sha256: procedure.manifest_sha256,
        procedure_sha256: procedure.manifest.procedure.sha256
      },
      assessment: {
        procedure_assessment_id: assessment.procedure_assessment_id,
        manifest_sha256: assessment.manifest_sha256,
        report_sha256: assessment.manifest.report.sha256,
        status: assessment.report.status
      },
      decision: {
        file: 'decision.json',
        ...descriptor(path.join(staging, 'decision.json'))
      },
      reviewer: {
        name: decision.reviewer_name,
        role: decision.reviewer_role,
        organization: decision.organization,
        identity_verified: false
      },
      expires_at: decision.expires_at,
      physical_execution: {
        enabled: false,
        policy: PHYSICAL_POLICY
      },
      interpretation: 'Local human attestation only; identity, facility authority, and regulatory validity are not verified.',
      preservation_policy: 'immutable scoped human decision over exact procedure and assessment records'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(path.join(staging, 'manifest.json')) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'procedure_decision.created',
      procedure_decision_id: id,
      procedure_id: procedure.procedure_id,
      procedure_assessment_id: assessment.procedure_assessment_id,
      chat_id: normalizedChatId,
      status: manifest.status,
      scope: decision.scope,
      manifest_sha256: manifestSha256,
      decision_sha256: manifest.decision.sha256
    });
    return { manifest, decision, manifest_sha256: manifestSha256, directory: finalDirectory };
  } catch (error) {
    if (fs.existsSync(staging)) {
      safeRemoveStaging(root, staging, '.staging-procedure-decision-');
    }
    throw error;
  }
}

export function verifyProcedureDecision(cwd, value) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeDecisionId(value);
  } catch (error) {
    return {
      ok: false,
      procedure_decision_id: String(value ?? ''),
      errors: [{ issue: error.code ?? 'invalid_procedure_decision_id', detail: error.message }]
    };
  }
  let files;
  try {
    files = decisionFiles(project, id, true);
  } catch (error) {
    return {
      ok: false,
      procedure_decision_id: id,
      errors: [{ issue: error.code ?? 'procedure_decision_path_error', detail: error.message }]
    };
  }
  const errors = [];
  for (const [label, file] of [
    ['manifest.json', files.manifest],
    ['manifest.sha256', files.digest],
    ['decision.json', files.decision]
  ]) {
    if (!safeRegularFile(file, files.directory)) {
      errors.push({ file: label, issue: 'missing' });
    }
  }
  let manifest = null;
  let decision = null;
  try {
    if (safeRegularFile(files.manifest, files.directory)) manifest = readJson(files.manifest);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (safeRegularFile(files.decision, files.directory)) decision = readJson(files.decision);
  } catch (error) {
    errors.push({ file: 'decision.json', issue: 'invalid_json', detail: error.message });
  }
  const manifestSha256 = safeRegularFile(files.manifest, files.directory)
    ? sha256File(files.manifest) : null;
  if (safeRegularFile(files.digest, files.directory)) {
    const expected = fs.readFileSync(files.digest, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(expected) || expected !== manifestSha256) {
      errors.push({
        file: 'manifest.sha256',
        issue: 'hash_mismatch',
        expected,
        actual: manifestSha256
      });
    }
  }
  if (manifest) {
    if (manifest.schema_version !== PROCEDURE_DECISION_SCHEMA_VERSION) {
      errors.push({
        file: 'manifest.json',
        issue: 'unsupported_schema',
        expected: PROCEDURE_DECISION_SCHEMA_VERSION,
        actual: manifest.schema_version
      });
    }
    if (manifest.procedure_decision_id !== id) {
      errors.push({ file: 'manifest.json', issue: 'procedure_decision_id_mismatch' });
    }
    if (!Number.isFinite(Date.parse(manifest.created_at))) {
      errors.push({ file: 'manifest.json', issue: 'invalid_timestamp' });
    }
    if (!['approved', 'rejected'].includes(manifest.status)) {
      errors.push({ file: 'manifest.json', issue: 'invalid_status' });
    }
    if (manifest.physical_execution?.enabled !== false ||
        manifest.physical_execution?.policy !== PHYSICAL_POLICY) {
      errors.push({ file: 'manifest.json', issue: 'invalid_physical_execution_policy' });
    }
    if (manifest.reviewer?.identity_verified !== false) {
      errors.push({ file: 'manifest.json', issue: 'invalid_identity_verification_claim' });
    }
    verifyFileDescriptor(files, manifest.decision, 'decision.json', errors, 'decision');
  }
  let normalized = null;
  try {
    if (decision) normalized = normalizeDecisionInput(decision);
    if (decision && sha256Json(normalized) !== sha256Json(decision)) {
      errors.push({ file: 'decision.json', issue: 'noncanonical_decision' });
    }
  } catch (error) {
    errors.push({
      file: 'decision.json',
      issue: error.code ?? 'invalid_decision',
      detail: error.message
    });
  }
  let procedure = null;
  let assessment = null;
  if (normalized && manifest) {
    procedure = verifyProcedure(project, normalized.procedure_id);
    if (!procedure.ok) {
      errors.push({
        procedure_id: normalized.procedure_id,
        issue: 'procedure_invalid',
        errors: procedure.errors
      });
    } else if (manifest.procedure?.procedure_id !== procedure.procedure_id ||
        manifest.procedure?.manifest_sha256 !== procedure.manifest_sha256 ||
        manifest.procedure?.procedure_sha256 !== procedure.manifest.procedure.sha256) {
      errors.push({ file: 'manifest.json', issue: 'procedure_digest_mismatch' });
    }
    assessment = verifyProcedureAssessment(project, normalized.procedure_assessment_id);
    if (!assessment.ok) {
      errors.push({
        procedure_assessment_id: normalized.procedure_assessment_id,
        issue: 'procedure_assessment_invalid',
        errors: assessment.errors
      });
    } else if (
      manifest.assessment?.procedure_assessment_id !== assessment.procedure_assessment_id ||
      manifest.assessment?.manifest_sha256 !== assessment.manifest_sha256 ||
      manifest.assessment?.report_sha256 !== assessment.manifest.report.sha256 ||
      manifest.assessment?.status !== assessment.report.status
    ) {
      errors.push({ file: 'manifest.json', issue: 'assessment_digest_mismatch' });
    }
    if (assessment.ok &&
        assessment.manifest.procedure.procedure_id !== normalized.procedure_id) {
      errors.push({ file: 'decision.json', issue: 'procedure_assessment_link_mismatch' });
    }
    if (normalized.decision === 'approve' && assessment.ok &&
        assessment.report.status !== 'ready_for_human_review') {
      errors.push({ file: 'decision.json', issue: 'blocked_assessment_approved' });
    }
    const created = Date.parse(manifest.created_at);
    if (assessment.ok && created < Date.parse(assessment.manifest.created_at)) {
      errors.push({ file: 'manifest.json', issue: 'decision_timestamp_order' });
    }
    if (assessment.ok && !assessmentCurrentAt(
      project, normalized.procedure_id, normalized.procedure_assessment_id, created)) {
      errors.push({ file: 'manifest.json', issue: 'assessment_not_current_at_decision' });
    }
    const expectedStatus = normalized.decision === 'approve' ? 'approved' : 'rejected';
    if (manifest.status !== expectedStatus || manifest.scope !== normalized.scope ||
        manifest.expires_at !== normalized.expires_at ||
        manifest.reviewer?.name !== normalized.reviewer_name ||
        manifest.reviewer?.role !== normalized.reviewer_role ||
        manifest.reviewer?.organization !== normalized.organization) {
      errors.push({ file: 'manifest.json', issue: 'decision_summary_mismatch' });
    }
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else if (manifestSha256 && manifest) {
    const link = readAuditRecords(project).find((record) =>
      record.type === 'procedure_decision.created' &&
      record.procedure_decision_id === id
    );
    if (!link || link.procedure_id !== manifest.procedure?.procedure_id ||
        link.procedure_assessment_id !== manifest.assessment?.procedure_assessment_id ||
        link.status !== manifest.status || link.scope !== manifest.scope ||
        link.manifest_sha256 !== manifestSha256 ||
        link.decision_sha256 !== manifest.decision?.sha256) {
      errors.push({ issue: 'audit_link_mismatch' });
    }
  }
  return {
    ok: errors.length === 0,
    procedure_decision_id: id,
    manifest,
    decision: normalized ?? decision,
    manifest_sha256: manifestSha256,
    procedure,
    assessment,
    errors
  };
}

export function getProcedureDecision(cwd, value) {
  const verification = verifyProcedureDecision(cwd, value);
  if (!verification.manifest || !verification.decision) {
    throw procedureError(
      'Procedure decision not found: ' + String(value ?? ''),
      'PROCEDURE_DECISION_NOT_FOUND'
    );
  }
  return {
    manifest: verification.manifest,
    decision: verification.decision,
    verification
  };
}

export function getProcedureDecisionManifest(cwd, value) {
  return getProcedureDecision(cwd, value).manifest;
}

export function listProcedureDecisions(cwd, { now = new Date() } = {}) {
  validateTimestamp(now, 'Procedure decision list');
  const currentProcedures = new Set(
    listProcedures(cwd).filter((item) => item.current && item.verified)
      .map((item) => item.procedure_id)
  );
  const currentAssessments = new Map(
    listProcedureAssessments(cwd)
      .filter((item) => item.current_for_procedure && item.verified)
      .map((item) => [item.procedure_id, item.procedure_assessment_id])
  );
  const records = decisionIds(cwd).map((id) => {
    const verification = verifyProcedureDecision(cwd, id);
    const expiresAt = verification.manifest?.expires_at ?? null;
    return {
      procedure_decision_id: id,
      procedure_id: verification.manifest?.procedure?.procedure_id ?? null,
      procedure_assessment_id:
        verification.manifest?.assessment?.procedure_assessment_id ?? null,
      status: verification.manifest?.status ?? 'missing',
      scope: verification.manifest?.scope ?? null,
      created_at: verification.manifest?.created_at ?? null,
      chat_id: verification.manifest?.chat_id ?? null,
      expires_at: expiresAt,
      reviewer: verification.manifest?.reviewer ?? null,
      expired: Boolean(expiresAt && Date.parse(expiresAt) <= now.getTime()),
      procedure_current: currentProcedures.has(
        verification.manifest?.procedure?.procedure_id),
      assessment_current: currentAssessments.get(
        verification.manifest?.procedure?.procedure_id
      ) === verification.manifest?.assessment?.procedure_assessment_id,
      physical_execution_enabled:
        verification.manifest?.physical_execution?.enabled ?? false,
      verified: verification.ok
    };
  });
  const latest = new Map();
  for (const record of records.filter((item) =>
    item.verified && item.procedure_id && item.scope)) {
    const key = record.procedure_id + '|' + record.scope;
    const existing = latest.get(key);
    if (!existing || String(record.created_at).localeCompare(String(existing.created_at)) > 0) {
      latest.set(key, record);
    }
  }
  return records.map((record) => {
    const key = record.procedure_id + '|' + record.scope;
    const current = latest.get(key);
    const currentForScope = Boolean(current &&
      current.procedure_decision_id === record.procedure_decision_id);
    const effective = record.verified && currentForScope && record.procedure_current &&
      record.assessment_current && record.status === 'approved' && !record.expired;
    return {
      ...record,
      current_for_scope: currentForScope,
      effective,
      effective_status: !record.verified ? 'invalid'
          : !currentForScope ? 'superseded'
          : !record.procedure_current ? 'procedure_superseded'
            : !record.assessment_current ? 'assessment_superseded'
            : record.expired ? 'expired'
              : record.status,
      superseded_by: current && !currentForScope
        ? current.procedure_decision_id : null
    };
  });
}

function boundedNote(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return boundedText(value, 'Procedure interaction note', 1_000);
}

export function procedureInteractionArtifact(record) {
  return {
    kind: 'procedure',
    record_id: record.manifest.procedure_id,
    name: record.manifest.name,
    url: '/api/procedures/' + encodeURIComponent(record.manifest.procedure_id)
  };
}

export function procedureInteractionPayload(record, note = null) {
  return {
    procedure_id: record.manifest.procedure_id,
    name: record.manifest.name,
    domain: record.manifest.domain,
    counts: record.manifest.counts,
    automation_targets: record.manifest.automation_targets,
    supersedes_procedure_id: record.manifest.supersedes?.procedure_id ?? null,
    physical_execution_enabled: false,
    note: boundedNote(note)
  };
}

export function procedureAssessmentInteractionArtifact(record) {
  return {
    kind: 'procedure-assessment',
    record_id: record.manifest.procedure_assessment_id,
    name: record.report.procedure.name,
    url: '/api/procedure-assessments/' +
      encodeURIComponent(record.manifest.procedure_assessment_id)
  };
}

export function procedureAssessmentInteractionPayload(record, note = null) {
  return {
    procedure_assessment_id: record.manifest.procedure_assessment_id,
    procedure_id: record.report.procedure.procedure_id,
    status: record.report.status,
    summary: record.report.summary,
    gates: record.report.gates.map((item) => ({
      id: item.id,
      status: item.status,
      detail: item.detail
    })),
    findings: record.report.findings.slice(0, 24).map((item) => ({
      severity: item.severity,
      code: item.code,
      message: item.message
    })),
    findings_truncated: record.report.findings.length > 24,
    adapters: record.report.adapters.map((item) => ({
      target: item.target,
      requested: item.requested,
      status: item.status,
      unmapped_step_ids: item.unmapped_step_ids
    })),
    physical_execution_enabled: false,
    note: boundedNote(note)
  };
}

export function procedureDecisionInteractionArtifact(record) {
  return {
    kind: 'procedure-decision',
    record_id: record.manifest.procedure_decision_id,
    name: record.manifest.scope,
    url: '/api/procedure-decisions/' +
      encodeURIComponent(record.manifest.procedure_decision_id)
  };
}

export function procedureDecisionInteractionPayload(record, note = null) {
  return {
    procedure_decision_id: record.manifest.procedure_decision_id,
    procedure_id: record.manifest.procedure.procedure_id,
    procedure_assessment_id: record.manifest.assessment.procedure_assessment_id,
    status: record.manifest.status,
    scope: record.manifest.scope,
    expires_at: record.manifest.expires_at,
    reviewer_role: record.manifest.reviewer.role,
    reviewer_identity_verified: false,
    physical_execution_enabled: false,
    note: boundedNote(note)
  };
}
