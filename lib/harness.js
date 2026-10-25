import fs from 'node:fs';
import path from 'node:path';
import { parseOpenCodeEvents, publicOpenCodeEvent } from './events.js';
import { getCampaign, listCampaigns } from './campaigns.js';
import { listInteractions, verifyInteractions } from './interactions.js';
import { redactText } from './security.js';
import { resolveRunDir, verifyRun } from './runs.js';
import { knowledgeGroundingForWorkflow } from './knowledge.js';

export const HARNESS_SCHEMA_VERSION = 1;
const MAX_ACTIVITY_EVENTS = 240;
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);

const WORKFLOWS = {
  cad_engineering: {
    label: 'CAD engineering',
    domain: 'parametric-design-and-additive-manufacturing',
    risk: 'high',
    context: 'Multi-file parametric design, virtual geometry checks, and print preparation; not structural certification or printer authorization.',
    physical_execution: 'external_human_review_required',
    stages: [
      ['scope', 'Define design intent', 'supervisor'],
      ['evidence', 'Inspect requirements and references', 'evidence'],
      ['design', 'Edit parametric assembly', 'cad-engineer'],
      ['render', 'Render immutable mesh', 'cad-engineer'],
      ['simulate', 'Run geometry screen', 'compute'],
      ['slice', 'Prepare bounded slice', 'cad-engineer'],
      ['review', 'Review geometry and machine risk', 'reviewer'],
      ['outcome', 'Publish design record', 'recorder']
    ]
  },
  drug_discovery: {
    label: 'Drug discovery',
    domain: 'biomedical',
    risk: 'high',
    context: 'Research decision support for target, assay, candidate, and translational evidence; not clinical or laboratory authorization.',
    physical_execution: 'human_approval_required',
    stages: [
      ['scope', 'Define product question', 'supervisor'],
      ['evidence', 'Map evidence and prior art', 'evidence'],
      ['hypothesis', 'Generate competing mechanisms', 'scientist'],
      ['assay', 'Design falsifiable assay', 'methodologist'],
      ['candidate', 'Rank candidate strategy', 'drug-discovery'],
      ['compute', 'Run recorded computation', 'compute'],
      ['review', 'Challenge safety and validity', 'reviewer'],
      ['outcome', 'Publish decision record', 'recorder']
    ]
  },
  biomolecular_design: {
    label: 'Biomolecular design',
    domain: 'nucleic-acid-and-protein-engineering',
    risk: 'high',
    context: 'Sequence-level design support for nucleic acid, protein, and immunogen constructs against a declared target; not synthesis, editing, or immunisation authorization.',
    physical_execution: 'human_approval_required',
    stages: [
      ['scope', 'Define construct intent and target', 'supervisor'],
      ['evidence', 'Map reference sequences and prior art', 'evidence'],
      ['grounding', 'State the principles the design rests on', 'scientist'],
      ['design', 'Specify the sequence-level construct', 'biomolecular-designer'],
      ['compute', 'Run recorded sequence and structure checks', 'compute'],
      ['biosafety', 'Screen biosafety, biosecurity, and dual-use exposure', 'biosafety'],
      ['review', 'Challenge specificity, off-target, and validity', 'reviewer'],
      ['approval', 'Record external institutional approval', 'reviewer'],
      ['outcome', 'Publish design record', 'recorder']
    ]
  },
  procedure_development: {
    label: 'Procedure development',
    domain: 'laboratory-methods',
    risk: 'high',
    context: 'Drafting and validating a reproducible procedure with equipment, hazards, acceptance criteria, and approval gates.',
    physical_execution: 'human_approval_required',
    stages: [
      ['scope', 'Define procedure objective', 'supervisor'],
      ['evidence', 'Anchor source methods', 'evidence'],
      ['constraints', 'Capture materials and constraints', 'methodologist'],
      ['procedure', 'Draft executable steps', 'procedure-engineer'],
      ['safety', 'Review hazards and ethics', 'reviewer'],
      ['dry-run', 'Simulate or dry-run', 'compute'],
      ['approval', 'Request human approval', 'supervisor'],
      ['outcome', 'Version the procedure', 'recorder']
    ]
  },
  computational_science: {
    label: 'Computational science',
    domain: 'simulation-and-analysis',
    risk: 'moderate',
    context: 'Reproducible computational analysis or simulation for a defined scientific question.',
    physical_execution: 'not_applicable',
    stages: [
      ['scope', 'Operationalize question', 'supervisor'],
      ['evidence', 'Inspect inputs and assumptions', 'evidence'],
      ['hypothesis', 'Declare estimand or hypothesis', 'scientist'],
      ['design', 'Plan analysis and checks', 'methodologist'],
      ['compute', 'Run recorded computation', 'compute'],
      ['review', 'Reproduce and challenge', 'reviewer'],
      ['outcome', 'Publish evidence-backed result', 'recorder']
    ]
  },
  evidence_review: {
    label: 'Evidence synthesis',
    domain: 'literature-and-records',
    risk: 'moderate',
    context: 'Source-grounded synthesis with explicit claim-evidence and uncertainty tracking.',
    physical_execution: 'not_applicable',
    stages: [
      ['scope', 'Frame answerable question', 'supervisor'],
      ['evidence', 'Retrieve primary evidence', 'evidence'],
      ['synthesis', 'Compare claims and conflicts', 'scientist'],
      ['review', 'Audit citations and inference', 'reviewer'],
      ['outcome', 'Publish qualified synthesis', 'recorder']
    ]
  },
  general_research: {
    label: 'Scientific research',
    domain: 'general-science',
    risk: 'moderate',
    context: 'Exploratory scientific reasoning and project work with recorded evidence and independent checks.',
    physical_execution: 'human_approval_required',
    stages: [
      ['scope', 'Frame research goal', 'supervisor'],
      ['evidence', 'Inspect evidence', 'evidence'],
      ['hypothesis', 'Develop alternatives', 'scientist'],
      ['design', 'Design the test', 'methodologist'],
      ['compute', 'Run recorded work', 'compute'],
      ['review', 'Challenge the result', 'reviewer'],
      ['outcome', 'Publish decision record', 'recorder']
    ]
  }
};

const AGENT_LANES = [
  ['supervisor', 'Supervisor', 'Frames the goal, allocates lanes, and enforces stage gates.'],
  ['evidence', 'Evidence scout', 'Retrieves primary sources, project records, datasets, and prior procedures.'],
  ['scientist', 'Scientific reasoner', 'Builds testable hypotheses and integrates results without overstating them.'],
  ['methodologist', 'Methodologist', 'Defines controls, estimands, acceptance criteria, and falsification tests.'],
  ['drug-discovery', 'Discovery specialist', 'Connects target, assay, candidate, ADMET, and translational decisions.'],
  ['biomolecular-designer', 'Biomolecular designer', 'Specifies nucleic acid, protein, and immunogen constructs against named references, with stated specificity and off-target analysis.'],
  ['biosafety', 'Biosafety reviewer', 'Screens containment, biosecurity, and dual-use exposure, and records that ScienceCode authorizes no physical execution.'],
  ['procedure-engineer', 'Procedure engineer', 'Turns methods into versioned, checkable steps and dry-run requirements.'],
  ['cad-engineer', 'CAD engineer', 'Edits declared OpenSCAD/CadQuery assemblies, verifies STL/STEP, runs bounded geometry checks, and prepares non-transmitted slices.'],
  ['compute', 'Compute operator', 'Uses recorded scripts, simulations, experiments, seeds, and accelerator metadata.'],
  ['reviewer', 'Independent reviewer', 'Checks safety, citations, validity, reproducibility, and alternative explanations.'],
  ['recorder', 'Evidence recorder', 'Maintains the transcript, run links, artifacts, and outcome record.']
];

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

// Terms that name a biomolecular design artifact on their own.
const BIOMOLECULAR_ARTIFACTS = [
  /\bcrispr\b/, /\bcas9\b/, /\bcas12\b/, /\bsgrna\b/, /guide rna/, /\bgrna\b/,
  /base edit/, /prime edit/, /gene edit/, /genome edit/, /\bknock(?:out|in)\b/,
  /\bprimer\b/, /oligonucleotide/, /\bplasmid\b/, /\bcodon\b/, /\baptamer\b/,
  /\bepitope\b/, /\bimmunogen\b/, /\bvaccine\b/, /\bantibody\b/, /\bnanobody\b/,
  /expression (?:construct|vector)/, /structure prediction/, /sequence design/
];

// Biomolecules that are only a design signal alongside a design verb: naming a
// protein or a genome is ordinary science, engineering one is not.
const BIOMOLECULES = [
  /\bdna\b/, /\brna\b/, /\bmrna\b/, /\bsirna\b/, /\bgenome\b/, /\bgene\b/,
  /\bprotein\b/, /\bpeptide\b/, /\benzyme\b/, /\bantigen\b/, /\btoxin\b/,
  /\bvector\b/, /\bsequence\b/
];

const DESIGN_INTENT = [
  /\bdesign(?:ing|ed)?\b/, /\bengineer(?:ing|ed)?\b/, /\boptimi[sz]/, /\bconstruct\b/,
  /\bsynthesi[sz]/, /\bassembl/, /\bclon(?:e|ing)\b/, /\bexpress\b/, /\bmutagenesis\b/,
  /\bvariant\b/, /\bre-?code/, /\bhumani[sz]/, /\bstabili[sz]/
];

export function classifyResearchGoal(value) {
  const text = String(value ?? '').toLowerCase();
  let id = 'general_research';
  // Explicit procedure language takes precedence over domain terms such as
  // "assay" so a request to author a laboratory method gets procedure gates.
  if (includesAny(text, [
    /\bcad\b/, /openscad/, /\bscad\b/, /3d print/, /\bslicer\b/, /\bstl\b/,
    /parametric (?:part|assembly|design)/, /additive manufactur/
  ])) {
    id = 'cad_engineering';
  } else if (includesAny(text, [
    /\bprocedure\b/, /\bprotocol\b/, /standard operating/, /\bsop\b/, /liquid handl/,
    /opentrons/, /chemputer/, /\bxdl\b/, /wet lab/, /laboratory method/
  ])) {
    id = 'procedure_development';
  } else if (includesAny(text, [
    /literature/, /citation/, /\bpapers?\b/, /evidence review/, /systematic review/,
    /meta-analysis/, /scoping review/
  ])) {
    // Appraising the literature about a domain is evidence work, not design
    // work, so this is tested before the domain branches below.
    id = 'evidence_review';
  } else if (includesAny(text, BIOMOLECULAR_ARTIFACTS) ||
      (includesAny(text, BIOMOLECULES) && includesAny(text, DESIGN_INTENT))) {
    id = 'biomolecular_design';
  } else if (includesAny(text, [
    /\bdrug\b/, /compound/, /therapeutic/, /target identification/, /admet/, /toxicity/,
    /binding affinity/, /molecule/, /protein/, /assay/, /disease/, /pharmac/
  ])) {
    id = 'drug_discovery';
  } else if (includesAny(text, [
    /simulation/, /dataset/, /data analys/, /model/, /python/, /gpu/, /cuda/, /statistic/,
    /monte carlo/, /molecular dynamics/, /machine learning/
  ])) {
    id = 'computational_science';
  }
  return { id, ...WORKFLOWS[id] };
}

function safeText(value, limit = 500) {
  return redactText(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function recordedRunEvents(cwd, turn) {
  const verification = verifyRun(cwd, turn.run_id);
  if (!verification.ok || !verification.manifest?.artifacts?.['events.jsonl']) {
    return [{
      type: 'integrity.warning',
      status: 'attention',
      title: 'Run event trace could not be verified',
      timestamp: turn.finished_at,
      source: 'sciencecode',
      run_id: turn.run_id,
      turn_index: turn.turn_index
    }];
  }
  const file = path.join(resolveRunDir(cwd, turn.run_id), 'events.jsonl');
  try {
    return parseOpenCodeEvents(fs.readFileSync(file, 'utf8')).events
      .map((event) => publicOpenCodeEvent(event))
      .filter(Boolean)
      .map((event) => ({
        ...event,
        source: 'opencode',
        run_id: turn.run_id,
        turn_index: turn.turn_index
      }));
  } catch (error) {
    return [{
      type: 'integrity.warning',
      status: 'attention',
      title: 'Recorded event trace is unreadable: ' + safeText(error.message, 160),
      timestamp: turn.finished_at,
      source: 'sciencecode',
      run_id: turn.run_id,
      turn_index: turn.turn_index
    }];
  }
}

function activityFromTurns(cwd, turns) {
  const activity = [];
  for (const turn of turns) {
    activity.push({
      type: 'goal.received',
      status: 'completed',
      title: 'Research goal received for turn ' + turn.turn_index,
      timestamp: turn.started_at,
      source: 'sciencecode',
      run_id: turn.run_id,
      turn_index: turn.turn_index
    });
    activity.push(...recordedRunEvents(cwd, turn));
    for (const [changeType, files] of Object.entries(turn.changes ?? {})) {
      for (const file of files ?? []) {
        activity.push({
          type: 'workspace.' + changeType,
          status: 'recorded',
          title: safeText(file, 240),
          timestamp: turn.finished_at,
          source: 'workspace',
          run_id: turn.run_id,
          turn_index: turn.turn_index
        });
      }
    }
    for (const record of turn.linked_records ?? []) {
      activity.push({
        type: record.type,
        status: 'recorded',
        title: 'Linked ' + record.type.replaceAll('.', ' '),
        timestamp: record.ts ?? turn.finished_at,
        source: 'audit',
        run_id: turn.run_id,
        turn_index: turn.turn_index,
        record
      });
    }
    activity.push({
      type: 'outcome.recorded',
      status: turn.status,
      title: turn.status === 'completed'
        ? 'Turn outcome recorded and hashed'
        : turn.status === 'cancelled'
          ? 'Cancelled turn preserved as incomplete'
          : 'Failed turn preserved for review',
      timestamp: turn.finished_at,
      source: 'sciencecode',
      run_id: turn.run_id,
      turn_index: turn.turn_index
    });
  }
  return activity.slice(-MAX_ACTIVITY_EVENTS);
}

function observedSignals(activity, turns) {
  const tools = activity.filter((event) => event.type === 'tool');
  const toolNames = new Set(tools.map((event) => event.tool));
  const text = turns.map((turn) => turn.assistant?.text ?? '').join('\n').toLowerCase();
  const linkedTypes = new Set(turns.flatMap((turn) => (turn.linked_records ?? []).map((record) => record.type)));
  return {
    hasTurns: turns.length > 0,
    hasCompletedTurn: turns.some((turn) => turn.status === 'completed'),
    evidence: tools.some((event) => ['read', 'glob', 'grep', 'webfetch', 'websearch', 'codesearch'].includes(event.tool)) ||
      linkedTypes.has('evidence.retrieved') || turns.some((turn) => turn.evidence_context?.result_count > 0),
    method: /method|design|control|estimand|protocol|procedure|assay|acceptance criter/.test(text),
    hypothesis: /hypothes|mechanism|alternative explanation|prediction/.test(text),
    safety: /safety|hazard|toxicity|risk|ethic|contraindicat/.test(text),
    // A cited principle id is the only unambiguous evidence of grounding; the
    // phrase "in principle" is not, so bare mentions do not satisfy the stage.
    grounding: /\b(?:math|phys|chem|bio|med|bioeng)\.[a-z_]+\.[a-z_]+\b/.test(text) ||
      /\bfirst principles\b/.test(text) || /\bgrounded in\b/.test(text) ||
      /\bderivation chain\b/.test(text) || /\brests? on the principle/.test(text),
    biosafety: /biosafety|biosecurity|dual[- ]use|containment|\bbsl-?[1-4]\b|institutional review|select agent/.test(text),
    compute: linkedTypes.has('simulation.finished') || linkedTypes.has('experiment.finished') ||
      linkedTypes.has('inference.finished') ||
      [...toolNames].some((name) => ['bash', 'python', 'task'].includes(name)),
    review: /review|verify|falsif|limitation|uncertainty|challenge/.test(text) ||
      linkedTypes.has('experiment.finished'),
    outcome: turns.some((turn) => turn.status === 'completed' && turn.assistant?.text?.trim()),
    toolNames: [...toolNames].sort(),
    linkedTypes: [...linkedTypes].sort()
  };
}

function stageStatus(stageId, signals, job) {
  const active = job && ACTIVE_JOB_STATUSES.has(job.status);
  if (stageId === 'scope') return signals.hasTurns ? 'complete' : active ? 'active' : 'ready';
  if (stageId === 'evidence') return signals.evidence ? 'complete' : active ? 'active' : 'queued';
  if (['hypothesis', 'synthesis'].includes(stageId)) return signals.hypothesis || signals.outcome ? 'complete' : 'queued';
  if (['design', 'assay', 'constraints', 'procedure', 'candidate'].includes(stageId)) {
    return signals.method ? 'complete' : active ? 'active' : 'queued';
  }
  if (stageId === 'safety') return signals.safety ? 'complete' : signals.outcome ? 'attention' : 'queued';
  if (stageId === 'grounding') return signals.grounding ? 'complete' : active ? 'active' : 'queued';
  // Biosafety never passes silently: an unscreened design that has produced an
  // outcome is an open finding, not a queued step.
  if (stageId === 'biosafety') return signals.biosafety ? 'complete' : signals.outcome ? 'attention' : 'queued';
  if (stageId === 'render') return signals.cadBuild ? 'complete' : signals.cadDesign ? 'active' : 'queued';
  if (stageId === 'simulate') return signals.cadSimulation ? 'complete' : signals.cadBuild ? 'ready' : 'queued';
  if (stageId === 'slice') return signals.cadSlice ? 'complete' : signals.cadBuild ? 'ready' : 'queued';
  if (['compute', 'dry-run'].includes(stageId)) return signals.compute ? 'complete' : 'queued';
  if (stageId === 'review') return signals.review ? 'complete' : signals.outcome ? 'attention' : 'queued';
  // 'approval' is a resting state, not a pending one: it says a named human
  // has to act and ScienceCode cannot act for them. Biomolecular design has no
  // procedure record to carry that decision, so the stage stays here and the
  // view states why in its limitations rather than implying a step is queued.
  if (stageId === 'approval') return signals.procedureApproval ? 'complete' : 'approval';
  if (stageId === 'outcome') return signals.outcome ? 'complete' : active ? 'active' : 'queued';
  return 'queued';
}

function laneStatus(laneId, workflow, stages, signals, job) {
  const active = job && ACTIVE_JOB_STATUSES.has(job.status);
  const owned = stages.filter((stage) => stage.owner === laneId);
  if (!owned.length && !workflow.stages.some((stage) => stage[2] === laneId)) return 'available';
  if (owned.some((stage) => stage.status === 'active')) return 'active';
  if (owned.some((stage) => stage.status === 'attention')) return 'attention';
  if (owned.some((stage) => stage.status === 'approval')) return 'approval';
  if (owned.length && owned.every((stage) => stage.status === 'complete')) return 'complete';
  if (active && laneId === 'supervisor') return 'active';
  if (laneId === 'compute' && signals.compute) return 'complete';
  return 'queued';
}

function procedureBoard(workflow, signals, {
  procedures = [],
  assessments = [],
  decisions = []
} = {}) {
  if (!['drug_discovery', 'procedure_development'].includes(workflow.id)) return null;
  const currentPlans = procedures.filter((item) => item.current && item.verified)
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const selected = currentPlans.at(-1) ?? null;
  const currentAssessment = selected
    ? assessments.filter((item) =>
        item.procedure_id === selected.procedure_id &&
        item.current_for_procedure && item.verified
      ).sort((left, right) =>
        String(left.created_at).localeCompare(String(right.created_at))).at(-1) ?? null
    : null;
  const currentDecisions = selected
    ? decisions.filter((item) =>
        item.procedure_id === selected.procedure_id &&
        item.current_for_scope && item.verified
      )
    : [];
  const physicalApproval = currentDecisions.find((item) =>
    item.scope === 'external_physical_execution' && item.effective) ?? null;
  const fallbackGates = [
    { id: 'objective', label: 'Objective and context of use',
      status: signals.hasTurns ? 'complete' : 'open' },
    { id: 'sources', label: 'Source methods and provenance',
      status: signals.evidence ? 'complete' : 'open' },
    { id: 'resources', label: 'Materials, equipment, and operating limits',
      status: signals.method ? 'attention' : 'open' },
    { id: 'controls', label: 'Controls and acceptance criteria',
      status: signals.method ? 'attention' : 'open' },
    { id: 'hazards', label: 'Hazard controls, training, and emergency response',
      status: signals.safety ? 'attention' : 'required' },
    { id: 'dry_run', label: 'Deterministic logical dry-run', status: 'required' },
    { id: 'approval', label: 'Named human approval before physical execution',
      status: 'required' }
  ];
  const gates = currentAssessment
    ? currentAssessment.gates.map((item) => ({
        id: item.id,
        label: item.label,
        status: item.id === 'approval'
          ? physicalApproval ? 'attested' : 'required'
          : item.status === 'pass' ? 'complete' : item.status,
        detail: item.id === 'approval' && physicalApproval
          ? 'Local external-only attestation ' + physicalApproval.procedure_decision_id +
            '; identity and facility authority are not verified.'
          : item.detail
      }))
    : fallbackGates;
  const adapters = currentAssessment
    ? currentAssessment.adapters.map((item) => ({
        id: item.target,
        label: item.label,
        requested: item.requested,
        status: item.status,
        unmapped_step_ids: item.unmapped_step_ids,
        execution_enabled: false,
        external_requirements: item.external_requirements
      }))
    : [
        { id: 'xdl_2_0', label: 'XDL 2.0', requested: false,
          status: 'not_requested', execution_enabled: false },
        { id: 'opentrons_python', label: 'Opentrons Python', requested: false,
          status: 'not_requested', execution_enabled: false }
      ];
  return {
    format: workflow.id === 'procedure_development'
      ? 'immutable neutral procedure with non-executable adapter mappings'
      : 'assay and validation procedure',
    execution_state: physicalApproval
      ? 'external_attestation_recorded' : 'design_only',
    physical_execution_enabled: false,
    selected_procedure_id: selected?.procedure_id ?? null,
    selected_assessment_id: currentAssessment?.procedure_assessment_id ?? null,
    plan: selected,
    assessment: currentAssessment,
    decisions: currentDecisions,
    gates,
    adapters,
    counts: {
      plans: procedures.length,
      current_plans: currentPlans.length,
      assessments: assessments.length,
      decisions: decisions.length,
      effective_external_physical_attestations: physicalApproval ? 1 : 0
    },
    limitations: [
      'Logical dry-runs do not determine facility safety or scientific validity.',
      'Adapter mappings are not executable protocols.',
      'Local decisions do not verify reviewer identity, authority, training, or facility readiness.',
      'ScienceCode never controls or authorizes physical laboratory hardware.'
    ]
  };
}

export function buildHarnessView({
  cwd,
  chat,
  job = null,
  compute = null,
  experiments = [],
  simulations = [],
  inferences = [],
  reviews = [],
  figureComparisons = [],
  figureRegistrations = [],
  figureVisuals = [],
  procedures = [],
  procedureAssessments = [],
  procedureDecisions = [],
  analysisContracts = [],
  confirmatoryAssessments = [],
  literature = [],
  campaigns = [],
  cadProjects = [],
  cadBuilds = [],
  cadSimulations = [],
  cadSlices = []
}) {
  const turns = chat?.turns ?? [];
  const chatId = chat?.manifest?.chat_id ?? null;
  const goal = turns[0]?.user?.text ?? '';
  const workflow = classifyResearchGoal(goal);
  const recordedActivity = activityFromTurns(cwd, turns);
  const interactionVerification = chatId
    ? verifyInteractions(cwd, chatId)
    : { ok: true, count: 0, head_hash: null, errors: [] };
  const interactions = chatId && interactionVerification.ok
    ? listInteractions(cwd, chatId)
    : [];
  const interactionActivity = interactions.map((record) => ({
    type: 'user.' + record.action,
    status: 'recorded',
    title: 'User ' + record.action.replaceAll('.', ' ') + ' · ' +
      (record.artifact?.name ?? record.surface),
    timestamp: record.ts,
    source: 'user',
    interaction_id: record.interaction_id,
    surface: record.surface
  }));
  const scopedFigureComparisons = figureComparisons
    .filter((comparison) => !chatId || comparison.chat_id === chatId)
    .sort((left, right) =>
      String(left.created_at ?? '').localeCompare(
        String(right.created_at ?? '')
      )
    );
  const figureComparisonActivity = scopedFigureComparisons.map(
    (comparison) => ({
      type: 'figure.comparison.' +
        String(comparison.reproduction_status ?? 'recorded'),
      status: comparison.verified === false
        ? 'attention'
        : comparison.status === 'pass' ? 'completed' : 'attention',
      title: 'Figure rerun · ' +
        String(comparison.reproduction_status ?? comparison.status),
      timestamp: comparison.created_at,
      source: 'figure-comparison',
      figure_comparison_id: comparison.figure_comparison_id,
      structural_similarity:
        comparison.summary?.structural_similarity ?? null,
      minimum_structural_similarity:
        comparison.summary?.minimum_structural_similarity ?? null
    })
  );
  const scopedFigureRegistrations = figureRegistrations
    .filter((registration) => !chatId || registration.chat_id === chatId)
    .sort((left, right) =>
      String(left.created_at ?? '').localeCompare(
        String(right.created_at ?? '')
      )
    );
  const figureRegistrationActivity = scopedFigureRegistrations.map(
    (registration) => ({
      type: 'figure.registration.' +
        String(registration.registration_status ?? 'recorded'),
      status: registration.verified === false || registration.status !== 'pass'
        ? 'attention' : 'completed',
      title: 'Figure semantics · ' +
        String(registration.registration_status ?? registration.status),
      timestamp: registration.created_at,
      source: 'figure-registration',
      figure_registration_id: registration.figure_registration_id,
      plotted_points: registration.summary?.plotted_points ?? null,
      series: registration.summary?.series ?? null
    })
  );
  const scopedFigureVisuals = figureVisuals
    .filter((visual) => !chatId || visual.chat_id === chatId)
    .sort((left, right) =>
      String(left.created_at ?? '').localeCompare(
        String(right.created_at ?? '')
      )
    );
  const figureVisualActivity = scopedFigureVisuals.map((visual) => ({
    type: 'figure.visual.' + String(visual.visual_status ?? 'recorded'),
    status: visual.verified === false || visual.status !== 'pass'
      ? 'attention' : 'completed',
    title: 'Figure pixels · ' + String(visual.visual_status ?? visual.status),
    timestamp: visual.created_at,
    source: 'figure-visual',
    figure_visual_id: visual.figure_visual_id,
    figure_registration_id: visual.figure_registration_id,
    matched_mark_samples: visual.summary?.matched_mark_samples ?? null,
    expected_mark_samples: visual.summary?.expected_mark_samples ?? null
  }));
  const campaignSummaries = (campaigns.length ? campaigns : listCampaigns(cwd))
    .filter((campaign) => !chatId || campaign.chat_id === chatId);
  const campaignDetails = campaignSummaries.map((campaign) => {
    try {
      return getCampaign(cwd, campaign.campaign_id);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const campaignActivity = campaignDetails.flatMap((campaign) =>
    campaign.events.map((event) => ({
      type: 'campaign.' + event.type,
      status: event.type === 'task.completed'
        ? 'completed'
        : event.type === 'task.failed' || event.type === 'task.cancelled'
          ? 'failed'
          : 'recorded',
      title: event.type.replaceAll('.', ' ') +
        (event.payload?.task_id
          ? ' · ' + event.payload.task_id
          : event.payload?.hypothesis_id
            ? ' · ' + event.payload.hypothesis_id + ' · ' +
              String(event.payload.verdict ?? 'assessed')
            : ''),
      timestamp: event.occurred_at,
      source: 'campaign',
      campaign_id: campaign.manifest.campaign_id,
      task_id: event.payload?.task_id ?? null,
      hypothesis_id: event.payload?.hypothesis_id ?? null,
      event_id: event.event_id
    }))
  );
  const cadModelSimulations = simulations.filter((record) =>
    record.cad_parent?.build_id
  );
  const cadSurfaceThermalModels = cadModelSimulations.filter((record) =>
    record.summary?.classification ===
      'surface_graph_heat_diffusion_not_volumetric_fea'
  );
  const cadStudies = experiments.filter((record) => record.cad_parent?.build_id);
  const cadActivity = [
    ...cadBuilds.map((record) => ({
      type: 'cad.build.' + String(record.status ?? 'recorded'),
      status: record.status === 'completed' ? 'completed' : 'attention',
      title: (record.engine === 'cadquery' ? 'CadQuery' : 'OpenSCAD') +
        ' build · ' + String(record.build_id),
      timestamp: record.created_at,
      source: 'cad',
      cad_project_id: record.cad_project_id,
      build_id: record.build_id
    })),
    ...cadSimulations.map((record) => ({
      type: 'cad.simulation.' + String(record.status ?? 'recorded'),
      status: record.status === 'pass' ? 'completed' : 'attention',
      title: 'Geometry screen · ' + String(record.status),
      timestamp: record.created_at,
      source: 'cad',
      cad_project_id: record.cad_project_id,
      build_id: record.build_id,
      simulation_id: record.simulation_id
    })),
    ...cadModelSimulations.map((record) => ({
      type: 'cad.model.' + String(record.status ?? 'recorded'),
      status: record.status === 'completed' ? 'completed' : 'attention',
      title: (record.summary?.classification ===
        'surface_graph_heat_diffusion_not_volumetric_fea'
        ? 'CAD surface thermal field'
        : 'CAD-linked CPU/GPU model') + ' · ' + String(record.simulation_id),
      timestamp: record.finished_at ?? record.started_at,
      source: 'cad',
      cad_project_id: record.cad_parent.cad_project_id,
      build_id: record.cad_parent.build_id,
      simulation_id: record.simulation_id
    })),
    ...cadStudies.map((record) => ({
      type: 'cad.study.' + String(record.status ?? 'recorded'),
      status: record.status === 'completed' && record.verified !== false
        ? 'completed' : 'attention',
      title: 'CAD parameter study · ' + String(record.experiment_id),
      timestamp: record.finished_at ?? record.started_at,
      source: 'cad',
      cad_project_id: record.cad_parent.cad_project_id,
      build_id: record.cad_parent.build_id,
      experiment_id: record.experiment_id
    })),
    ...cadSlices.map((record) => ({
      type: 'cad.slice.' + String(record.status ?? 'recorded'),
      status: String(record.status).startsWith('completed') ? 'completed' : 'attention',
      title: String(record.mode ?? 'preview') + ' slice · transmission disabled',
      timestamp: record.created_at,
      source: 'cad',
      cad_project_id: record.cad_project_id,
      build_id: record.build_id,
      slice_id: record.slice_id
    }))
  ];
  const liveActivity = (job?.events ?? []).map((event) => ({ ...event, source: event.source ?? 'live' }));
  const activity = [
    ...recordedActivity,
    ...interactionActivity,
    ...figureComparisonActivity,
    ...figureRegistrationActivity,
    ...figureVisualActivity,
    ...campaignActivity,
    ...cadActivity,
    ...liveActivity
  ]
    .sort((left, right) => String(left.timestamp ?? '').localeCompare(String(right.timestamp ?? '')))
    .slice(-MAX_ACTIVITY_EVENTS);
  const signals = observedSignals(activity, turns);
  const semanticReviews = reviews
    .filter((review) => !chatId || review.chat_id === chatId)
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  signals.review = signals.review || semanticReviews.length > 0;
  signals.compute = signals.compute || scopedFigureComparisons.length > 0;
  signals.review = signals.review || scopedFigureComparisons.some(
    (comparison) => comparison.status !== 'pass'
  );
  signals.compute = signals.compute || scopedFigureRegistrations.length > 0;
  signals.review = signals.review || scopedFigureRegistrations.some(
    (registration) => registration.status !== 'pass'
  );
  signals.compute = signals.compute || scopedFigureVisuals.length > 0;
  signals.review = signals.review || scopedFigureVisuals.some(
    (visual) => visual.status !== 'pass'
  );
  const scopedAnalysisContracts = analysisContracts
    .filter((contract) => !chatId || contract.chat_id === chatId)
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  const scopedAssessments = confirmatoryAssessments
    .filter((assessment) => !chatId || assessment.chat_id === chatId)
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  signals.method = signals.method || scopedAnalysisContracts.length > 0;
  signals.review = signals.review || scopedAssessments.length > 0;
  const scopedProcedures = procedures
    .filter((procedure) => !chatId || procedure.chat_id === chatId)
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  const scopedProcedureIds = new Set(scopedProcedures.map((item) => item.procedure_id));
  const scopedProcedureAssessments = procedureAssessments
    .filter((assessment) => !chatId || assessment.chat_id === chatId ||
      scopedProcedureIds.has(assessment.procedure_id))
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  const scopedProcedureDecisions = procedureDecisions
    .filter((decision) => !chatId || decision.chat_id === chatId ||
      scopedProcedureIds.has(decision.procedure_id))
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  const currentProcedureAssessment = scopedProcedureAssessments
    .filter((item) => item.current_for_procedure && item.verified).at(-1) ?? null;
  signals.method = signals.method || scopedProcedures.length > 0;
  signals.evidence = signals.evidence || scopedProcedures.some(
    (item) => item.source_evidence_count > 0);
  signals.safety = signals.safety || Boolean(currentProcedureAssessment);
  signals.compute = signals.compute || scopedProcedureAssessments.length > 0;
  signals.review = signals.review || scopedProcedureDecisions.length > 0;
  signals.method = signals.method || campaignDetails.length > 0;
  signals.compute = signals.compute || campaignDetails.some((campaign) =>
    campaign.state.budget.used_task_attempts > 0);
  signals.review = signals.review || campaignDetails.some((campaign) =>
    campaign.state.tasks.some((task) => task.lane === 'reviewer' &&
      task.status === 'completed'));
  signals.cadDesign = cadProjects.length > 0;
  signals.cadBuild = cadBuilds.some((record) => record.status === 'completed');
  signals.cadSimulation = cadSimulations.length > 0 ||
    cadModelSimulations.length > 0 || cadStudies.length > 0;
  signals.cadSlice = cadSlices.some((record) =>
    String(record.status).startsWith('completed'));
  signals.method = signals.method || signals.cadDesign;
  signals.compute = signals.compute || signals.cadBuild || signals.cadSimulation;
  signals.review = signals.review || cadSimulations.some((record) =>
    ['review', 'fail'].includes(record.status));
  signals.review = signals.review || cadModelSimulations.some((record) =>
    record.status !== 'completed');
  signals.review = signals.review || cadStudies.some((record) =>
    record.review?.verdict !== 'pass');
  signals.procedureApproval = scopedProcedureDecisions.some((item) =>
    item.current_for_scope && item.effective &&
    item.scope === 'external_physical_execution');
  const stages = workflow.stages.map(([id, label, owner]) => ({
    id,
    label,
    owner,
    status: stageStatus(id, signals, job),
    basis: 'Derived from verified run, tool, artifact, and transcript records.'
  }));
  const agents = AGENT_LANES.map(([id, label, role]) => ({
    id,
    label,
    role,
    status: laneStatus(id, workflow, stages, signals, job),
    included: workflow.stages.some((stage) => stage[2] === id) || ['supervisor', 'recorder'].includes(id)
  }));
  const observedEvidence = activity
    .filter((event) => event.type === 'tool' || event.source === 'audit')
    .map((event) => ({
      kind: event.type === 'tool' ? event.tool : event.type,
      label: event.title,
      status: event.status,
      run_id: event.run_id ?? null,
      turn_index: event.turn_index ?? null
    }))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.kind === item.kind && candidate.label === item.label) === index);
  const retrievedEvidence = turns.flatMap((turn) => (turn.evidence_context?.citations ?? []).map((citation) => ({
    kind: 'retrieved span',
    label: citation.evidence_id + ' · page ' + citation.page + ' · ' + citation.span_id,
    status: 'verified',
    run_id: turn.run_id,
    turn_index: turn.turn_index,
    evidence_id: citation.evidence_id,
    page: citation.page,
    span_id: citation.span_id
  })));
  const evidence = [...observedEvidence, ...retrievedEvidence]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.kind === item.kind && candidate.label === item.label) === index)
    .slice(-24);
  const outcomes = turns.map((turn) => ({
    turn_index: turn.turn_index,
    run_id: turn.run_id,
    status: turn.status,
    summary: safeText(turn.assistant?.text, 900),
    finished_at: turn.finished_at,
    session_consistent: turn.session_consistent
  }));
  return {
    schema_version: HARNESS_SCHEMA_VERSION,
    chat_id: chatId,
    generated_at: new Date().toISOString(),
    truthful_trace: true,
    workflow: {
      id: workflow.id,
      label: workflow.label,
      domain: workflow.domain,
      risk: workflow.risk,
      context_of_use: workflow.context,
      physical_execution: workflow.physical_execution,
      stage_count: stages.length,
      knowledge: knowledgeGroundingForWorkflow(workflow.id)
    },
    goal: {
      question: safeText(goal, 1200) || 'Start a conversation to define the research question.',
      status: signals.hasTurns ? 'defined' : 'open'
    },
    job: job ? {
      job_id: job.job_id,
      kind: job.kind ?? 'chat',
      campaign_id: job.campaign_id ?? null,
      task_id: job.task_id ?? null,
      status: job.status,
      created_at: job.created_at,
      started_at: job.started_at ?? null,
      finished_at: job.finished_at ?? null,
      cancel_requested_at: job.cancel_requested_at ?? null,
      cancelled_at: job.cancelled_at ?? null,
      can_cancel: ['queued', 'running'].includes(job.status),
      cancellation_interaction_id: job.cancellation_interaction_id ?? null,
      error: job.error ?? null
    } : null,
    stages,
    agents,
    activity,
    board: {
      evidence,
      outcomes,
      reviews: semanticReviews.slice(-12).map((review) => ({
        review_id: review.review_id,
        status: review.status,
        verified: review.verified,
        current_for_target: review.current_for_target,
        superseded_by: review.superseded_by,
        reviewer: review.reviewer,
        created_at: review.created_at,
        target: review.target ? {
          name: review.target.name,
          url: review.target.url,
          sha256: review.target.sha256
        } : null,
        counts: review.counts,
        url: review.url
      })),
      figure_comparisons: scopedFigureComparisons.slice(-24).map(
        (comparison) => ({
          figure_comparison_id: comparison.figure_comparison_id,
          name: comparison.name,
          status: comparison.status,
          reproduction_status: comparison.reproduction_status,
          verified: comparison.verified,
          created_at: comparison.created_at,
          baseline: comparison.baseline ? {
            name: comparison.baseline.name,
            url: comparison.baseline.url,
            sha256: comparison.baseline.sha256
          } : null,
          candidate: comparison.candidate ? {
            name: comparison.candidate.name,
            url: comparison.candidate.url,
            sha256: comparison.candidate.sha256
          } : null,
          summary: comparison.summary,
          url: comparison.url
        })
      ),
      figure_registrations: scopedFigureRegistrations.slice(-24).map(
        (registration) => ({
          figure_registration_id: registration.figure_registration_id,
          name: registration.name,
          status: registration.status,
          registration_status: registration.registration_status,
          verified: registration.verified,
          created_at: registration.created_at,
          figure: registration.figure ? {
            name: registration.figure.name,
            url: registration.figure.url,
            sha256: registration.figure.sha256
          } : null,
          source: registration.source ? {
            name: registration.source.name,
            url: registration.source.url,
            sha256: registration.source.sha256
          } : null,
          summary: registration.summary,
          url: registration.url
        })
      ),
      figure_visuals: scopedFigureVisuals.slice(-24).map((visual) => ({
        figure_visual_id: visual.figure_visual_id,
        figure_registration_id: visual.figure_registration_id,
        name: visual.name,
        status: visual.status,
        visual_status: visual.visual_status,
        verified: visual.verified,
        created_at: visual.created_at,
        figure_sha256: visual.figure_sha256,
        profile_sha256: visual.profile_sha256,
        summary: visual.summary,
        url: visual.url
      })),
      campaigns: campaignDetails.map((campaign) => ({
        campaign_id: campaign.manifest.campaign_id,
        title: campaign.manifest.title,
        question: campaign.manifest.question,
        classification: campaign.manifest.classification,
        status: campaign.state.status,
        verified: campaign.verification.ok,
        ai_disclosure: campaign.manifest.ai_disclosure,
        plan_sha256: campaign.manifest.plan.sha256,
        event_head_sha256: campaign.verification.event_head_sha256,
        budget: campaign.state.budget,
        counts: campaign.state.counts,
        hypothesis_policy: campaign.state.hypothesis_policy ?? null,
        hypothesis_counts: campaign.state.hypothesis_counts ?? null,
        next_task: campaign.state.next_task,
        next_hypothesis: campaign.state.next_hypothesis ?? null,
        hypotheses: campaign.plan.hypotheses.map((hypothesis) => ({
          id: hypothesis.id,
          statement: hypothesis.statement,
          falsification: hypothesis.falsification,
          priority: hypothesis.priority,
          parent_id: hypothesis.parent_id ?? null,
          relation: hypothesis.relation ?? 'root',
          budget: hypothesis.budget ?? null,
          state: campaign.state.hypotheses?.find((candidate) =>
            candidate.hypothesis_id === hypothesis.id) ?? null
        })),
        tasks: campaign.plan.tasks.map((task) => ({
          ...campaign.state.tasks.find((candidate) =>
            candidate.task_id === task.id),
          objective: task.objective,
          expected_outputs: task.expected_outputs
        })),
        recent_events: campaign.events.slice(-24).map((event) => ({
          event_id: event.event_id,
          type: event.type,
          occurred_at: event.occurred_at,
          task_id: event.payload?.task_id ?? null,
          hypothesis_id: event.payload?.hypothesis_id ?? null,
          verdict: event.payload?.verdict ?? null,
          decision: event.payload?.decision ?? null,
          attempt: event.payload?.attempt ?? null,
          run_id: event.payload?.run_id ?? null,
          turn_index: event.payload?.turn_index ?? null
        })),
        url: '/api/campaigns/' +
          encodeURIComponent(campaign.manifest.campaign_id)
      })),
      cad: {
        projects: cadProjects.slice(0, 24).map((project) => ({
          cad_project_id: project.cad_project_id,
          name: project.name,
          description: project.description,
          engine: project.engine ?? 'openscad',
          healthy: project.healthy,
          file_count: project.file_count,
          part_count: project.part_count,
          source_sha256: project.source_sha256,
          url: '/api/cad/projects/' + encodeURIComponent(project.cad_project_id)
        })),
        builds: cadBuilds.slice(0, 24).map((build) => ({
          build_id: build.build_id,
          cad_project_id: build.cad_project_id,
          status: build.status,
          engine: build.engine ?? 'openscad',
          verified: build.verified,
          triangles: build.mesh?.triangles ?? null,
          topology: build.mesh?.topology ?? null,
          geometry: build.mesh?.geometry ?? null,
          created_at: build.created_at,
          mesh_url: build.status === 'completed'
            ? '/api/cad/artifacts/build/' + encodeURIComponent(build.build_id) +
              '/assembly.stl'
            : null,
          step_url: build.status === 'completed' && build.artifacts?.['assembly.step']
            ? '/api/cad/artifacts/build/' + encodeURIComponent(build.build_id) +
              '/assembly.step'
            : null
        })),
        simulations: cadSimulations.slice(0, 24),
        models: cadModelSimulations.slice(0, 24),
        surface_thermal_models: cadSurfaceThermalModels.slice(0, 24),
        parameter_studies: cadStudies.slice(0, 24),
        slices: cadSlices.slice(0, 24).map((slice) => ({
          ...slice,
          printer_transmission: 'disabled'
        })),
        safety: {
          printer_transmission: 'disabled',
          slicer_post_process: 'disabled',
          default_slice_mode: 'preview_no_extrusion',
          model_cancellation: 'verified_partial_record',
          study_cancellation: 'verified_partial_experiment_record',
          gpu_dispatch: 'fresh_free_memory_gate',
          surface_thermal_solver:
            'bounded_surface_graph_diffusion_not_volumetric_fea',
          scalar_field_interaction: 'vertex_selection_visible_to_next_ai_turn',
          comparative_studies:
            'bounded_matrix_on_one_verified_immutable_mesh_not_fea_validation',
          cadquery_python_execution: 'user_permissions_not_os_sandboxed',
          step_interchange: 'immutable_hash_verified_artifact',
          structural_certification: false
        }
      },
      confirmatory: {
        contracts: scopedAnalysisContracts.slice(-12).map((contract) => ({
          analysis_contract_id: contract.analysis_contract_id,
          name: contract.name,
          status: contract.status,
          verified: contract.verified,
          schema_version: contract.schema_version ?? null,
          unit_engine: contract.unit_engine ?? null,
          statistics_engine: contract.statistics_engine ?? null,
          preregistration_id: contract.preregistration_id,
          script: contract.script,
          counts: contract.counts,
          created_at: contract.created_at,
          url: contract.url
        })),
        assessments: scopedAssessments.slice(-12).map((assessment) => ({
          analysis_assessment_id: assessment.analysis_assessment_id,
          analysis_contract_id: assessment.analysis_contract_id,
          experiment_id: assessment.experiment_id,
          status: assessment.status,
          schema_version: assessment.schema_version ?? null,
          registration_status: assessment.registration_status,
          outcome_verdict: assessment.outcome_verdict,
          verified: assessment.verified,
          current_for_pair: assessment.current_for_pair,
          superseded_by: assessment.superseded_by,
          summary: assessment.summary,
          created_at: assessment.created_at,
          url: assessment.url
        }))
      },
      literature: literature.slice(0, 16).map((record) => ({
        literature_id: record.literature_id,
        source: record.source,
        identifier: record.identifier,
        title: record.title,
        year: record.year,
        doi: record.doi,
        transport: record.transport,
        retrieved_at: record.retrieved_at,
        verified: record.verified,
        url: record.url
      })),
      procedure: procedureBoard(workflow, signals, {
        procedures: scopedProcedures,
        assessments: scopedProcedureAssessments,
        decisions: scopedProcedureDecisions
      }),
      computation: {
        runtime_ready: Boolean(compute?.runtime?.healthy),
        gpu_runtime_ready: Boolean(compute?.runtimes?.gpu?.healthy ?? compute?.runtime?.healthy),
        gpu_available: Boolean(compute?.gpu?.available),
        npu_available: Boolean(compute?.npu?.available),
        npu_runtime_ready: Boolean(compute?.runtimes?.npu?.healthy),
        cad_runtime_ready: Boolean(compute?.runtimes?.cad?.healthy),
        cadquery_version: compute?.runtimes?.cad?.probe?.cadquery_version ?? null,
        npu_execution_provider: compute?.capabilities?.npu_onnx_inference?.execution_provider ?? null,
        experiments: experiments.length,
        simulations: simulations.length,
        figure_comparisons: scopedFigureComparisons.length,
        figure_registrations: scopedFigureRegistrations.length,
        figure_visuals: scopedFigureVisuals.length,
        cad_builds: cadBuilds.length,
        cad_simulations: cadSimulations.length,
        cad_linked_models: cadModelSimulations.length,
        cad_surface_thermal_models: cadSurfaceThermalModels.length,
        cad_parameter_studies: cadStudies.length,
        cancelled_cad_parameter_studies: cadStudies.filter((item) =>
          item.status === 'cancelled').length,
        cancelled_cad_linked_models: cadModelSimulations.filter((item) =>
          item.status === 'cancelled').length,
        cad_slices: cadSlices.length,
        inferences: inferences.length,
        npu_verified_inferences: inferences.filter((item) =>
          item.npu_executed && item.verified !== false).length,
        linked_compute: signals.compute
      },
      validation: {
        transcript_verified: Boolean(chat?.verification?.ok),
        session_consistent: turns.every((turn) => turn.session_consistent !== false),
        evidence_observed: signals.evidence,
        review_observed: signals.review,
        semantic_reviews: semanticReviews.length,
        semantic_reviews_current: semanticReviews.filter((review) => review.current_for_target).length,
        semantic_reviews_verified: semanticReviews.filter((review) => review.verified).length,
        semantic_reviews_needing_attention: semanticReviews.filter((review) =>
          review.current_for_target && ['review', 'fail'].includes(review.status)).length,
        figure_comparisons: scopedFigureComparisons.length,
        verified_figure_comparisons: scopedFigureComparisons.filter(
          (comparison) => comparison.verified
        ).length,
        exact_figure_comparisons: scopedFigureComparisons.filter(
          (comparison) => comparison.verified &&
            comparison.reproduction_status === 'exact'
        ).length,
        structural_figure_comparisons: scopedFigureComparisons.filter(
          (comparison) => comparison.verified &&
            Number.isFinite(
              comparison.summary?.minimum_structural_similarity
            )
        ).length,
        structural_figure_comparisons_passing:
          scopedFigureComparisons.filter(
            (comparison) => comparison.verified &&
              comparison.summary?.structural_similarity_rule_pass === true
          ).length,
        figure_comparisons_needing_attention: scopedFigureComparisons.filter(
          (comparison) => comparison.verified &&
            ['different', 'incompatible_dimensions'].includes(
              comparison.reproduction_status
            )
        ).length,
        figure_registrations: scopedFigureRegistrations.length,
        verified_figure_registrations: scopedFigureRegistrations.filter(
          (registration) => registration.verified
        ).length,
        matched_figure_registrations: scopedFigureRegistrations.filter(
          (registration) => registration.verified &&
            registration.registration_status === 'matched'
        ).length,
        figure_registrations_needing_attention: scopedFigureRegistrations.filter(
          (registration) => registration.verified &&
            registration.registration_status === 'mismatch'
        ).length,
        figure_visuals: scopedFigureVisuals.length,
        verified_figure_visuals: scopedFigureVisuals.filter(
          (visual) => visual.verified
        ).length,
        conforming_figure_visuals: scopedFigureVisuals.filter(
          (visual) => visual.verified && visual.visual_status === 'conforming'
        ).length,
        figure_visuals_needing_attention: scopedFigureVisuals.filter(
          (visual) => visual.verified && visual.visual_status === 'nonconforming'
        ).length,
        analysis_contracts: scopedAnalysisContracts.length,
        analysis_contracts_verified: scopedAnalysisContracts.filter((contract) =>
          contract.verified).length,
        inferential_analysis_contracts: scopedAnalysisContracts.filter((contract) =>
          (contract.schema_version ?? 1) >= 3).length,
        confirmatory_assessments: scopedAssessments.length,
        inferential_confirmatory_assessments: scopedAssessments.filter((assessment) =>
          (assessment.schema_version ?? 1) >= 3).length,
        indeterminate_confirmatory_assessments: scopedAssessments.filter((assessment) =>
          assessment.current_for_pair &&
          assessment.outcome_verdict === 'indeterminate').length,
        confirmatory_assessments_current: scopedAssessments.filter((assessment) =>
          assessment.current_for_pair).length,
        prospective_confirmatory_assessments: scopedAssessments.filter((assessment) =>
          assessment.current_for_pair &&
          assessment.registration_status === 'prospective').length,
        confirmatory_assessments_needing_attention: scopedAssessments.filter((assessment) =>
          assessment.current_for_pair && assessment.status !== 'pass').length,
        procedure_plans: scopedProcedures.length,
        current_procedure_plans: scopedProcedures.filter((item) => item.current).length,
        verified_procedure_plans: scopedProcedures.filter((item) => item.verified).length,
        procedure_assessments: scopedProcedureAssessments.length,
        current_procedure_assessments: scopedProcedureAssessments.filter(
          (item) => item.current_for_procedure).length,
        blocked_procedure_assessments: scopedProcedureAssessments.filter(
          (item) => item.current_for_procedure && item.status === 'blocked').length,
        procedure_decisions: scopedProcedureDecisions.length,
        effective_procedure_approvals: scopedProcedureDecisions.filter(
          (item) => item.effective).length,
        // Literature manifests carry no chat binding, so these two counters
        // are project-wide, unlike the chat-scoped counters around them.
        project_literature_records: literature.length,
        project_verified_literature_records: literature.filter(
          (record) => record.verified).length,
        campaigns: campaignDetails.length,
        campaigns_verified: campaignDetails.filter((campaign) =>
          campaign.verification.ok).length,
        active_campaigns: campaignDetails.filter((campaign) =>
          ['ready', 'running', 'waiting_checkpoint'].includes(
            campaign.state.status
          )).length,
        completed_campaign_tasks: campaignDetails.reduce((total, campaign) =>
          total + campaign.state.counts.completed, 0),
        failed_campaign_tasks: campaignDetails.reduce((total, campaign) =>
          total + campaign.state.counts.failed, 0),
        cad_projects: cadProjects.length,
        healthy_cad_projects: cadProjects.filter((project) => project.healthy).length,
        cad_builds: cadBuilds.length,
        verified_cad_builds: cadBuilds.filter((build) => build.verified).length,
        cad_simulations: cadSimulations.length,
        cad_linked_models: cadModelSimulations.length,
        cad_surface_thermal_models: cadSurfaceThermalModels.length,
        cad_parameter_studies: cadStudies.length,
        verified_cad_parameter_studies: cadStudies.filter((item) =>
          item.verified === true).length,
        passing_cad_parameter_studies: cadStudies.filter((item) =>
          item.verified === true && item.status === 'completed' &&
            item.review?.verdict === 'pass').length,
        cancelled_cad_parameter_studies: cadStudies.filter((item) =>
          item.status === 'cancelled').length,
        cad_parameter_studies_needing_attention: cadStudies.filter((item) =>
          item.status !== 'completed' || item.verified === false).length,
        cad_models_needing_attention: cadModelSimulations.filter((item) =>
          item.status !== 'completed').length,
        cad_slices: cadSlices.length,
        safe_preview_slices: cadSlices.filter((slice) =>
          slice.status === 'completed_preview').length,
        printer_profile_slices: cadSlices.filter((slice) =>
          slice.mode === 'printer-profile').length,
        interactions_verified: interactionVerification.ok,
        limitations: [
          !signals.evidence ? 'No source or project evidence tool is visible in the recorded trace yet.' : null,
          !signals.review ? 'No independent challenge or semantic review is visible in the recorded trace yet.' : null,
          scopedAnalysisContracts.length === 0
            ? 'No frozen primary-outcome analysis contract is linked to this conversation yet.'
            : null,
          ['drug_discovery', 'procedure_development'].includes(workflow.id) &&
            scopedProcedures.length === 0
            ? 'No immutable structured procedure plan is linked to this conversation yet.'
            : null,
          scopedProcedureAssessments.some((item) =>
            item.current_for_procedure && item.status === 'blocked')
            ? 'The newest logical procedure dry-run has unresolved blockers.'
            : null,
          workflow.physical_execution === 'human_approval_required' ? 'ScienceCode does not authorize physical or clinical execution.' : null
          ,
          workflow.id === 'cad_engineering'
            ? 'Geometry screening is not FEA, tolerance validation, material qualification, or printer safety certification; G-code transmission is disabled.'
            : null,
          workflow.id === 'biomolecular_design' && !signals.biosafety
            ? 'No biosafety, biosecurity, or dual-use screening is visible in the recorded trace yet.'
            : null,
          workflow.id === 'biomolecular_design' && !signals.procedureApproval
            ? 'External institutional approval stays open: ScienceCode records no approval of its own and cannot clear this stage.'
            : null,
          workflow.id === 'biomolecular_design'
            ? 'Sequence-level design is not synthesis, editing, immunisation, or institutional biosafety authorization; specificity and off-target predictions are computational only.'
            : null,
          scopedAssessments.some((assessment) => (assessment.schema_version ?? 1) >= 3)
            ? 'Inferential assessments replay preregistered hypothesis tests deterministically; parametric tests assume normality and independence, rank-based tests assume only independence, none of it is checked, and no causal claim follows.'
            : null,
          literature.length
            ? 'Literature records are registry metadata frozen at retrieval time; they do not verify the cited work\'s content or correctness.'
            : null
        ].filter(Boolean)
      }
    },
    interactions: {
      count: interactions.length,
      verified: interactionVerification.ok,
      head_hash: interactionVerification.head_hash,
      recent: interactions.slice(-12).map((record) => ({
        interaction_id: record.interaction_id,
        ts: record.ts,
        surface: record.surface,
        action: record.action,
        artifact: record.artifact,
        payload_sha256: record.payload_sha256
      }))
    },
    observed: {
      tool_names: signals.toolNames,
      linked_record_types: signals.linkedTypes,
      recorded_turns: turns.length
    }
  };
}
