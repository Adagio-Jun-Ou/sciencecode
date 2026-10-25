const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);
const TERMINAL_CAMPAIGN_STATUSES = new Set(['completed', 'stopped', 'budget_exhausted']);

let context = null;
let workspaceUi = null;
let activeCampaign = null;
let activeJob = null;
let pollingJobId = null;
let selectionTimer = null;
let loadToken = null;
let selectedId = new URLSearchParams(
  typeof window === 'undefined' ? '' : window.location.search
).get('campaign');
let selectedTaskId = null;
let selectedHypothesisId = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function compact(value, limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}

function formatDate(value) {
  if (!value) return 'not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(date);
}

function statusPill(status) {
  const safe = String(status ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return element('span', 'mini-status ' + safe, String(status ?? 'unknown').replaceAll('_', ' '));
}

function button(label, className, handler) {
  const node = element('button', className, label);
  node.type = 'button';
  if (handler) node.addEventListener('click', handler);
  return node;
}

function field(label, control) {
  const node = element('label', 'campaign-field');
  node.append(element('span', '', label), control);
  return node;
}

function campaignArtifact(detail) {
  const id = detail.manifest.campaign_id;
  return {
    kind: 'campaign',
    record_id: id,
    name: detail.manifest.title,
    url: '/api/campaigns/' + encodeURIComponent(id)
  };
}

function taskDefinition(detail, taskId) {
  return detail.plan.tasks.find((task) => task.id === taskId) ?? null;
}

function taskState(detail, taskId) {
  return detail.state.tasks.find((task) => task.task_id === taskId) ?? null;
}

function hypothesisDefinition(detail, hypothesisId) {
  return detail.plan.hypotheses.find((hypothesis) =>
    hypothesis.id === hypothesisId) ?? null;
}

function hypothesisState(detail, hypothesisId) {
  return detail.state.hypotheses?.find((hypothesis) =>
    hypothesis.hypothesis_id === hypothesisId) ?? null;
}

function updateUrl(campaignId) {
  const url = new URL(window.location.href);
  if (campaignId) url.searchParams.set('campaign', campaignId);
  else url.searchParams.delete('campaign');
  window.history.replaceState({}, '', url);
}

export function defaultCampaignSpec(projectName = 'local research project') {
  return {
    title: 'Accelerated hypothesis campaign',
    question: 'Which supported hypothesis best explains the current project evidence, and what bounded computation would most strongly falsify it?',
    context: 'Use only recorded project evidence and reproducible project-local artifacts. GPU work is for simulation or high-throughput compute; NPU work is for profiled ONNX inference. Never substitute one accelerator for the other without recording the fallback.',
    context_of_use: 'Exploratory research planning for ' + projectName + '; not clinical, regulatory, or physical-execution authorization.',
    classification: 'exploratory',
    hypotheses: [
      {
        id: 'h1_supported_mechanism',
        statement: 'The leading mechanism is supported by the available project evidence and survives accelerator-backed sensitivity checks.',
        rationale: 'This is the current working hypothesis and must remain falsifiable.',
        falsification: 'A verified contradictory source, failed control, or preregistered compute result outside the acceptance range.',
        priority: 1,
        parent_id: null,
        relation: 'root',
        budget: {
          max_task_attempts: 8,
          max_gpu_tasks: 2,
          max_npu_tasks: 2
        }
      },
      {
        id: 'h2_alternative_mechanism',
        statement: 'An alternative mechanism explains the observations at least as well as the leading mechanism.',
        rationale: 'Competing explanations reduce confirmation bias.',
        falsification: 'The alternative fails the same controls and decision rules applied to the leading hypothesis.',
        priority: 2,
        parent_id: 'h1_supported_mechanism',
        relation: 'alternative',
        budget: {
          max_task_attempts: 8,
          max_gpu_tasks: 2,
          max_npu_tasks: 2
        }
      }
    ],
    tasks: [
      {
        id: 'evidence_map',
        title: 'Map evidence and falsifiers',
        objective: 'Inspect recorded project sources and artifacts, map support and contradiction for both hypotheses, and define explicit decision criteria before accelerator work.',
        lane: 'literature',
        hypothesis_ids: ['h1_supported_mechanism', 'h2_alternative_mechanism'],
        depends_on: [],
        expected_outputs: ['Evidence-to-claim map', 'Contradictions and missing evidence', 'Frozen falsification criteria'],
        checkpoint: true,
        compute: 'cpu',
        risk: 'moderate',
        max_attempts: 2
      },
      {
        id: 'gpu_sensitivity',
        title: 'Run deterministic GPU sensitivity study',
        objective: 'Use the CUDA GPU only for a seeded, recorded simulation or parameter study that applies the frozen criteria. Preserve inputs, environment, outputs, and limitations.',
        lane: 'compute',
        hypothesis_ids: ['h1_supported_mechanism', 'h2_alternative_mechanism'],
        depends_on: ['evidence_map'],
        expected_outputs: ['Recorded GPU run', 'Sensitivity table or figure', 'Numerical checks and failure modes'],
        checkpoint: true,
        compute: 'gpu',
        risk: 'moderate',
        max_attempts: 2
      },
      {
        id: 'npu_screen',
        title: 'Profile NPU inference screen',
        objective: 'Use a project-local ONNX model and exact inputs for a profiled NPU inference. Require execution-provider evidence and label any fallback; do not claim NPU execution from device presence alone.',
        lane: 'data',
        hypothesis_ids: ['h1_supported_mechanism', 'h2_alternative_mechanism'],
        depends_on: ['evidence_map'],
        expected_outputs: ['Immutable inference record', 'Provider-event attribution', 'Ranked or classified results with uncertainty'],
        checkpoint: true,
        compute: 'npu',
        risk: 'moderate',
        max_attempts: 2
      },
      {
        id: 'independent_synthesis',
        title: 'Challenge and synthesize the outcome',
        objective: 'Independently compare all recorded evidence and compute against the frozen falsifiers. Separate observation from interpretation and propose the smallest decisive next step.',
        lane: 'reviewer',
        hypothesis_ids: ['h1_supported_mechanism', 'h2_alternative_mechanism'],
        depends_on: ['gpu_sensitivity', 'npu_screen'],
        expected_outputs: ['Hypothesis disposition', 'Limitations and contradictory evidence', 'Auditable next-step recommendation'],
        checkpoint: true,
        compute: 'cpu',
        risk: 'moderate',
        max_attempts: 2
      }
    ],
    budget: {
      max_task_attempts: 8,
      max_gpu_tasks: 2,
      max_npu_tasks: 2,
      max_wall_clock_seconds: 86400
    },
    hypothesis_policy: {
      require_final_assessment: true,
      human_adjudication: true,
      automatic_pruning: false
    },
    execution_policy: {
      network: 'disabled',
      physical_execution: 'disabled',
      artifact_scope: 'project_only',
      ai_disclosure: true
    }
  };
}

async function shareTaskSelection(detail, state, definition) {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(async () => {
    try {
      await context.request(
        '/api/chats/' + encodeURIComponent(detail.manifest.chat_id) + '/interactions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surface: 'campaign',
            action: 'task.selected',
            artifact: campaignArtifact(detail),
            payload: {
              schema_version: 1,
              campaign_id: detail.manifest.campaign_id,
              task_id: state.task_id,
              title: definition.title,
              objective: definition.objective,
              status: state.status,
              attempt: state.next_attempt,
              compute: state.compute,
              risk: state.risk,
              depends_on: state.depends_on,
              hypothesis_ids: state.hypothesis_ids,
              budget: detail.state.budget,
              note: 'The user focused this campaign task in the interactive workspace.'
            }
          })
        }
      );
      await context.refreshHarness?.(detail.manifest.chat_id);
    } catch {
      // Selection remains usable even when an optional AI-visible note cannot be recorded.
    }
  }, 450);
}

function budgetMetric(label, used, maximum, mode = '') {
  const node = element('div', 'campaign-metric ' + mode);
  node.append(element('small', '', label), element('strong', '', String(used) + ' / ' + String(maximum)));
  return node;
}

function hypothesisDepth(detail, definition) {
  let depth = 0;
  let current = definition;
  const seen = new Set();
  while (current?.parent_id && depth < 8 && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    depth += 1;
    current = hypothesisDefinition(detail, current.parent_id);
  }
  return depth;
}

async function shareHypothesisSelection(detail, definition, state) {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(async () => {
    try {
      await context.request(
        '/api/chats/' + encodeURIComponent(detail.manifest.chat_id) + '/interactions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surface: 'campaign',
            action: 'hypothesis.selected',
            artifact: campaignArtifact(detail),
            payload: {
              schema_version: 1,
              campaign_id: detail.manifest.campaign_id,
              hypothesis_id: definition.id,
              statement: definition.statement,
              parent_id: definition.parent_id ?? null,
              relation: definition.relation ?? 'root',
              verdict: state?.verdict ?? 'unassessed',
              decision: state?.decision ?? 'continue',
              effective_status: state?.effective_status ?? 'active',
              budget: state?.budget ?? definition.budget ?? null,
              note: 'The user focused this hypothesis branch in the interactive workspace.'
            }
          })
        }
      );
      await context.refreshHarness?.(detail.manifest.chat_id);
    } catch {
      // Branch selection remains usable if the optional AI-visible note fails.
    }
  }, 450);
}

async function submitHypothesisAssessment(
  detail, definition, verdict, decision, rationale, taskInputs, control
) {
  if (!rationale.trim()) {
    context.notify('Record a scientific rationale before assessing this branch.');
    return;
  }
  control.disabled = true;
  const taskIds = taskInputs.filter((input) => input.checked).map((input) => input.value);
  try {
    const { payload } = await context.request(
      '/api/campaigns/' + encodeURIComponent(detail.manifest.campaign_id) +
        '/hypotheses/' + encodeURIComponent(definition.id) + '/assessments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verdict,
          decision,
          rationale: rationale.trim(),
          task_ids: taskIds
        })
      }
    );
    activeCampaign = payload.campaign;
    selectedHypothesisId = definition.id;
    context.notify(
      'Human hypothesis assessment recorded: ' + verdict + ' / ' + decision + '.'
    );
    await refreshAfterMutation(detail.manifest.campaign_id);
  } catch (error) {
    control.disabled = false;
    context.notify(error.message);
  }
}

function renderHypothesisInspector(detail, definition, state) {
  const inspector = element('section', 'campaign-hypothesis-inspector');
  const head = element('header');
  const copy = element('div');
  copy.append(
    element('span', 'section-kicker', 'HUMAN BRANCH CHECKPOINT'),
    element('h3', '', definition.id)
  );
  head.append(copy, statusPill(state?.verdict ?? 'legacy'));
  inspector.append(
    head,
    element('p', 'campaign-task-objective', definition.statement)
  );
  if (!state) {
    inspector.append(actionState(
      'This schema-v1 campaign remains verifiable but does not accept formal branch assessments.',
      'attention'
    ));
    return inspector;
  }
  const facts = element('div', 'campaign-task-facts');
  for (const [label, value] of [
    ['RELATION', definition.parent_id
      ? (definition.relation ?? 'alternative') + ' of ' + definition.parent_id
      : 'root'],
    ['VERDICT', state.verdict],
    ['DECISION', state.decision],
    ['EFFECTIVE', state.effective_status],
    ['ASSESSMENT', state.assessment_required
      ? 'required after latest work'
      : state.assessment_stale
        ? 'stale after later work'
        : state.assessment_ready
          ? (state.latest_assessment ? 'current' : 'not recorded')
          : (state.latest_assessment ? 'preliminary' : 'work pending')],
    ['ATTEMPTS', state.budget.used_task_attempts + ' / ' +
      state.budget.max_task_attempts],
    ['GPU / NPU', state.budget.used_gpu_tasks + ' / ' +
      state.budget.max_gpu_tasks + ' · ' + state.budget.used_npu_tasks +
      ' / ' + state.budget.max_npu_tasks]
  ]) {
    const item = element('div');
    item.append(element('small', '', label), element('strong', '', value));
    facts.append(item);
  }
  inspector.append(facts);
  if (state.latest_assessment) {
    const latest = element('blockquote', 'campaign-assessment-history');
    latest.append(
      element('small', '', 'LATEST HUMAN ASSESSMENT' +
        (state.assessment_stale ? ' · STALE AFTER LATER WORK' : '') + ' · ' +
        formatDate(state.latest_assessment.occurred_at)),
      element('p', '', state.latest_assessment.rationale),
      element('code', '', state.latest_assessment.event_id)
    );
    inspector.append(latest);
  }
  const verdict = element('select', 'campaign-control');
  verdict.setAttribute('aria-label', 'Hypothesis verdict');
  for (const value of ['supported', 'challenged', 'falsified', 'inconclusive']) {
    const option = element('option', '', value);
    option.value = value;
    verdict.append(option);
  }
  verdict.value = state.verdict === 'unassessed' ? 'inconclusive' : state.verdict;
  const decision = element('select', 'campaign-control');
  decision.setAttribute('aria-label', 'Hypothesis branch decision');
  for (const value of ['continue', 'pause', 'prune', 'promote']) {
    const option = element('option', '', value);
    option.value = value;
    decision.append(option);
  }
  decision.value = state.decision ?? 'continue';
  const rationale = element('textarea', 'campaign-control campaign-assessment-note');
  rationale.rows = 4;
  rationale.maxLength = 4000;
  rationale.placeholder =
    'Human rationale grounded in completed tasks, evidence, falsifiers, and uncertainty…';
  const completedTasks = detail.state.tasks.filter((task) => {
    const taskPlan = taskDefinition(detail, task.task_id);
    return task.status === 'completed' && (
      !taskPlan?.hypothesis_ids?.length ||
      taskPlan.hypothesis_ids.includes(definition.id)
    );
  });
  const taskLinks = element('fieldset', 'campaign-assessment-tasks');
  taskLinks.append(element('legend', '', 'COMPLETED TASK BASIS'));
  const taskInputs = [];
  if (!completedTasks.length) {
    taskLinks.append(element(
      'p', 'campaign-empty-copy',
      'No completed linked task is available. A plan-only human decision is allowed but remains visibly ungrounded.'
    ));
  } else {
    for (const task of completedTasks) {
      const label = element('label', 'campaign-assessment-task');
      const input = element('input');
      input.type = 'checkbox';
      input.value = task.task_id;
      input.checked = true;
      taskInputs.push(input);
      label.append(input, element('span', '', task.task_id + ' · ' + task.title));
      taskLinks.append(label);
    }
  }
  const record = button('Record human assessment', 'share-button');
  record.disabled = !state.can_assess;
  record.addEventListener('click', () => void submitHypothesisAssessment(
    detail,
    definition,
    verdict.value,
    decision.value,
    rationale.value,
    taskInputs,
    record
  ));
  inspector.append(
    field('SCIENTIFIC VERDICT', verdict),
    field('BRANCH DECISION', decision),
    taskLinks,
    field('RATIONALE', rationale),
    record,
    actionState(
      'ScienceCode records this as a declared local-user checkpoint. The bundled AI may recommend but must not submit it; local identity is not authenticated.',
      'complete'
    )
  );
  return inspector;
}

function renderHypotheses(detail) {
  const section = element('section', 'campaign-hypotheses');
  section.append(element('span', 'section-kicker', 'FALSIFIABLE HYPOTHESIS TREE'));
  const selectedExists = detail.plan.hypotheses.some((hypothesis) =>
    hypothesis.id === selectedHypothesisId);
  if (!selectedExists) {
    selectedHypothesisId = detail.state.next_hypothesis?.hypothesis_id ??
      detail.plan.hypotheses[0]?.id ?? null;
  }
  const grid = element('div', 'campaign-hypothesis-grid');
  for (const hypothesis of detail.plan.hypotheses) {
    const state = hypothesisState(detail, hypothesis.id);
    const depth = hypothesisDepth(detail, hypothesis);
    const card = element(
      'article',
      'campaign-hypothesis depth-' + Math.min(depth, 4) +
        (hypothesis.id === selectedHypothesisId ? ' active' : '')
    );
    const head = element('header');
    head.append(
      element('code', '', hypothesis.id),
      statusPill(state?.verdict ?? 'proposed')
    );
    const tree = element(
      'small',
      'campaign-branch-relation',
      hypothesis.parent_id
        ? (hypothesis.relation ?? 'alternative') + ' of ' + hypothesis.parent_id
        : 'root branch'
    );
    const inspect = button(
      hypothesis.id === selectedHypothesisId ? 'Branch selected' : 'Inspect branch',
      'quiet-button',
      () => {
        selectedHypothesisId = hypothesis.id;
        renderCampaignDetail(detail);
        void shareHypothesisSelection(detail, hypothesis, state);
      }
    );
    inspect.setAttribute(
      'aria-pressed',
      String(hypothesis.id === selectedHypothesisId)
    );
    card.append(
      head,
      tree,
      element('p', 'campaign-hypothesis-statement', hypothesis.statement),
      element('small', '', 'FALSIFIED IF'),
      element('p', 'campaign-falsifier', hypothesis.falsification),
      state ? element(
        'p',
        'campaign-branch-state',
        state.effective_status + ' · ' + state.budget.used_task_attempts +
          '/' + state.budget.max_task_attempts + ' attempts · ' +
          (state.assessment_required
            ? 'human verdict required'
            : state.assessment_stale
              ? 'verdict stale'
              : state.latest_assessment ? 'verdict recorded' : 'unassessed')
      ) : element('p', 'campaign-branch-state', 'legacy campaign'),
      inspect
    );
    grid.append(card);
  }
  section.append(grid);
  const definition = hypothesisDefinition(detail, selectedHypothesisId);
  if (definition) {
    section.append(
      renderHypothesisInspector(
        detail,
        definition,
        hypothesisState(detail, definition.id)
      )
    );
  }
  return section;
}

function renderJobPanel(detail) {
  const panel = workspaceUi?.jobPanel;
  if (!panel) return;
  panel.replaceChildren();
  const job = activeJob?.campaign_id === detail.manifest.campaign_id ? activeJob : null;
  panel.append(element('span', 'section-kicker', 'LIVE AI WORK WINDOW'));
  const heading = element('div', 'campaign-job-heading');
  heading.append(
    element('h3', '', job ? compact(job.task_id, 80) : 'No task is running'),
    statusPill(job?.status ?? 'idle')
  );
  panel.append(heading);

  if (!job) {
    panel.append(element('p', 'campaign-empty-copy',
      'Approve a checkpoint and run one task. OpenCode events and completed response blocks will appear here without hiding the underlying record.'));
  } else {
    const binding = element('div', 'campaign-job-binding');
    binding.append(
      element('span', '', 'job ' + compact(job.job_id, 28)),
      element('span', '', 'chat ' + compact(job.chat_id, 28)),
      element('span', '', 'task ' + compact(job.task_id, 28))
    );
    panel.append(binding);
    const response = element('div', 'campaign-live-response');
    const blocks = job.response?.blocks ?? [];
    if (!blocks.length) {
      response.append(element('p', 'campaign-empty-copy',
        ACTIVE_JOB_STATUSES.has(job.status)
          ? 'Waiting for the next completed OpenCode text block…'
          : 'No assistant response block was retained for this job.'));
    } else {
      for (const block of blocks) {
        const content = typeof block.content === 'string'
          ? block.content : JSON.stringify(block.content, null, 2);
        const item = element('article', 'campaign-response-block');
        item.append(
          element('small', '', 'ASSISTANT BLOCK ' + block.sequence + ' · ' + formatDate(block.timestamp)),
          element('pre', '', content)
        );
        response.append(item);
      }
    }
    panel.append(response);
    const events = element('div', 'campaign-live-events');
    for (const event of (job.events ?? []).slice(-8)) {
      const row = element('div', 'campaign-live-event ' + (event.status ?? 'recorded'));
      row.append(
        element('span', '', String(event.type ?? 'event').startsWith('campaign') ? 'CAM' : 'AI'),
        element('p', '', event.title ?? event.type),
        element('time', '', formatDate(event.timestamp))
      );
      events.append(row);
    }
    panel.append(events);
    if (['queued', 'running', 'cancelling'].includes(job.status)) {
      const stop = button(
        job.status === 'cancelling' ? 'Stopping task…' : 'Stop this exact task',
        'stop-button',
        () => void cancelCampaignJob()
      );
      stop.disabled = job.status === 'cancelling';
      panel.append(stop);
    }
  }

  const ledger = element('details', 'campaign-ledger');
  ledger.append(element('summary', '', 'Immutable event ledger · ' + detail.events.length + ' event(s)'));
  const rows = element('div', 'campaign-ledger-rows');
  for (const event of detail.events.slice(-14).reverse()) {
    const row = element('div', 'campaign-ledger-row');
    row.append(
      element('code', '', String(event.sequence).padStart(6, '0')),
      element('strong', '', event.type),
      element('span', '', compact(
        event.payload?.task_id ?? event.payload?.hypothesis_id ?? 'campaign',
        42
      )),
      element('time', '', formatDate(event.occurred_at))
    );
    rows.append(row);
  }
  ledger.append(rows);
  panel.append(ledger);
}

function actionState(message, mode = '') {
  return element('p', 'campaign-action-state ' + mode, message);
}

async function campaignDecision(detail, state, decision, note, control) {
  control.disabled = true;
  try {
    const { payload } = await context.request(
      '/api/campaigns/' + encodeURIComponent(detail.manifest.campaign_id) + '/decisions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: state.task_id, decision, note: note || null })
      }
    );
    activeCampaign = payload.campaign;
    selectedTaskId = state.task_id;
    context.notify('Checkpoint ' + decision + ' and appended to the verified campaign ledger.');
    await refreshAfterMutation(detail.manifest.campaign_id);
  } catch (error) {
    control.disabled = false;
    context.notify(error.message);
  }
}

async function startCampaignTask(detail, state, control) {
  if (ACTIVE_JOB_STATUSES.has(activeJob?.status)) return;
  control.disabled = true;
  try {
    const { payload } = await context.request(
      '/api/campaigns/' + encodeURIComponent(detail.manifest.campaign_id) + '/advance',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: state.task_id })
      }
    );
    activeJob = payload;
    renderJobPanel(detail);
    ensureCampaignPolling(payload);
  } catch (error) {
    control.disabled = false;
    context.notify(error.message);
  }
}

async function abandonCampaignTask(detail, state, reason, control) {
  if (!reason.trim()) {
    context.notify('Record a reason before abandoning an interrupted task.');
    return;
  }
  control.disabled = true;
  try {
    const { payload } = await context.request(
      '/api/campaigns/' + encodeURIComponent(detail.manifest.campaign_id) + '/abandon',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: state.task_id, reason: reason.trim() })
      }
    );
    activeCampaign = payload.campaign;
    context.notify('Interrupted task marked abandoned; its partial output remains auditable.');
    await refreshAfterMutation(detail.manifest.campaign_id);
  } catch (error) {
    control.disabled = false;
    context.notify(error.message);
  }
}

function renderTaskInspector(detail, state, definition) {
  const inspector = element('section', 'campaign-task-inspector');
  const head = element('header');
  const title = element('div');
  title.append(element('span', 'section-kicker', 'SELECTED TASK'), element('h3', '', definition.title));
  head.append(title, statusPill(state.status));
  inspector.append(head, element('p', 'campaign-task-objective', definition.objective));

  const facts = element('div', 'campaign-task-facts');
  for (const [label, value] of [
    ['LANE', state.lane],
    ['COMPUTE', state.compute.toUpperCase()],
    ['RISK', state.risk],
    ['ATTEMPT', state.next_attempt + ' / ' + definition.max_attempts],
    ['DEPENDS ON', state.depends_on.length ? state.depends_on.join(', ') : 'none'],
    ['HYPOTHESES', state.hypothesis_ids.join(', ')]
  ]) {
    const item = element('div');
    item.append(element('small', '', label), element('strong', '', value));
    facts.append(item);
  }
  inspector.append(facts);

  const outputs = element('div', 'campaign-outputs');
  outputs.append(element('span', 'section-kicker', 'EXPECTED OUTPUTS'));
  const list = element('ul');
  for (const output of definition.expected_outputs) list.append(element('li', '', output));
  outputs.append(list);
  inspector.append(outputs);

  const active = ACTIVE_JOB_STATUSES.has(activeJob?.status);
  const note = element('textarea', 'campaign-control campaign-decision-note');
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = 'Human checkpoint rationale or retry direction…';
  const actions = element('div', 'campaign-task-actions');
  if (state.can_approve) {
    const approve = button('Approve checkpoint', 'share-button');
    approve.disabled = active;
    approve.addEventListener('click', () => void campaignDecision(
      detail, state, 'approved', note.value.trim(), approve
    ));
    const reject = button('Reject', 'secondary-button');
    reject.disabled = active;
    reject.addEventListener('click', () => void campaignDecision(
      detail, state, 'rejected', note.value.trim(), reject
    ));
    actions.append(approve, reject);
  }
  if (['ready', 'awaiting_approval', 'checkpoint_rejected'].includes(state.status)) {
    const skip = button('Skip with record', 'quiet-button');
    skip.disabled = active;
    skip.addEventListener('click', () => void campaignDecision(
      detail, state, 'skipped', note.value.trim(), skip
    ));
    actions.append(skip);
  }
  if (state.can_advance) {
    const run = button('Run exactly one AI turn', 'campaign-run-button');
    run.disabled = active;
    run.addEventListener('click', () => void startCampaignTask(detail, state, run));
    actions.prepend(run);
  }
  if (state.can_abandon && !active) {
    const abandon = button('Abandon interrupted attempt', 'stop-button');
    abandon.addEventListener('click', () => void abandonCampaignTask(
      detail, state, note.value, abandon
    ));
    actions.append(abandon);
  }
  if (actions.childElementCount) inspector.append(note, actions);
  else inspector.append(actionState(
    state.status === 'completed'
      ? 'Task completed. Its exact run and turn are linked in the ledger.'
      : state.reason ? 'Task is not actionable: ' + state.reason.replaceAll('_', ' ') + '.'
        : 'This task becomes actionable when its dependencies and checkpoint are satisfied.',
    state.status === 'completed' ? 'complete' : ''
  ));

  if (state.attempts.length) {
    const attempts = element('div', 'campaign-attempts');
    attempts.append(element('span', 'section-kicker', 'RECORDED ATTEMPTS'));
    for (const attempt of state.attempts) {
      const row = element('div', 'campaign-attempt-row');
      row.append(
        element('strong', '', '#' + attempt.attempt + ' · ' + attempt.status),
        element('span', '', attempt.run_id ? 'run ' + compact(attempt.run_id, 28) : 'no run link'),
        element('time', '', formatDate(attempt.finished_at ?? attempt.started_at))
      );
      attempts.append(row);
    }
    inspector.append(attempts);
  }
  return inspector;
}

function renderTaskBoard(detail) {
  const section = element('section', 'campaign-task-studio');
  const rail = element('nav', 'campaign-task-rail');
  rail.setAttribute('aria-label', 'Campaign task graph');
  const selectedExists = detail.state.tasks.some((task) => task.task_id === selectedTaskId);
  if (!selectedExists) {
    selectedTaskId = detail.state.next_task?.task_id ?? detail.state.tasks[0]?.task_id ?? null;
  }
  for (const [index, state] of detail.state.tasks.entries()) {
    const definition = taskDefinition(detail, state.task_id);
    const node = button('', 'campaign-task-node ' + state.status +
      (state.task_id === selectedTaskId ? ' active' : ''));
    node.setAttribute('aria-pressed', String(state.task_id === selectedTaskId));
    const indexNode = element('span', 'campaign-task-index', String(index + 1).padStart(2, '0'));
    const copy = element('span', 'campaign-task-node-copy');
    copy.append(
      element('strong', '', definition.title),
      element('small', '', state.lane + ' · ' + state.compute.toUpperCase() +
        (state.depends_on.length ? ' · ← ' + state.depends_on.join(', ') : ' · root'))
    );
    node.append(indexNode, copy, statusPill(state.status));
    node.addEventListener('click', () => {
      selectedTaskId = state.task_id;
      renderCampaignDetail(detail);
      void shareTaskSelection(detail, state, definition);
    });
    rail.append(node);
  }
  const state = taskState(detail, selectedTaskId);
  const definition = taskDefinition(detail, selectedTaskId);
  section.append(rail, renderTaskInspector(detail, state, definition));
  return section;
}

async function stopCampaign(detail, reason, control) {
  if (!reason.trim()) {
    context.notify('Record a reason before stopping the campaign.');
    return;
  }
  control.disabled = true;
  try {
    const { payload } = await context.request(
      '/api/campaigns/' + encodeURIComponent(detail.manifest.campaign_id) + '/stop',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
      }
    );
    activeCampaign = payload.campaign;
    context.notify('Campaign stopped; the immutable plan and ledger were preserved.');
    await refreshAfterMutation(detail.manifest.campaign_id);
  } catch (error) {
    control.disabled = false;
    context.notify(error.message);
  }
}

function renderCampaignDetail(detail) {
  if (!workspaceUi?.detail || selectedId !== detail.manifest.campaign_id) return;
  activeCampaign = detail;
  const root = workspaceUi.detail;
  root.replaceChildren();
  const head = element('header', 'campaign-detail-head');
  const copy = element('div');
  copy.append(
    element('span', 'section-kicker', detail.manifest.classification.toUpperCase() + ' RESEARCH CAMPAIGN'),
    element('h2', '', detail.manifest.title),
    element('p', '', detail.manifest.question)
  );
  const integrity = element('div', 'campaign-integrity');
  integrity.append(
    statusPill(detail.state.status),
    statusPill(detail.verification.ok ? 'verified' : 'attention'),
    element('code', '', compact(detail.manifest.campaign_id, 40))
  );
  head.append(copy, integrity);
  root.append(head);

  const budget = detail.state.budget;
  const metrics = element('div', 'campaign-budget');
  metrics.append(
    budgetMetric('TASK ATTEMPTS', budget.used_task_attempts, budget.max_task_attempts),
    budgetMetric('GPU TASKS', budget.used_gpu_tasks, budget.max_gpu_tasks, 'gpu'),
    budgetMetric('NPU TASKS', budget.used_npu_tasks, budget.max_npu_tasks, 'npu'),
    budgetMetric('COMPLETED', detail.state.counts.completed, detail.plan.tasks.length, 'complete'),
    budgetMetric(
      'CURRENT VERDICTS',
      detail.state.hypothesis_counts?.assessment_current ??
        detail.state.hypothesis_counts?.assessed ?? 0,
      detail.state.hypothesis_counts?.total ?? detail.plan.hypotheses.length,
      'complete'
    )
  );
  root.append(metrics);

  const policy = element('div', 'campaign-policy-strip');
  for (const [label, value, mode] of [
    ['NETWORK', detail.plan.execution_policy.network + ' · prompt policy', 'attention'],
    ['PHYSICAL', detail.plan.execution_policy.physical_execution, 'safe'],
    ['ARTIFACTS', detail.plan.execution_policy.artifact_scope, 'safe'],
    ['BRANCHES', detail.state.hypothesis_policy?.human_adjudication
      ? 'human adjudication' : 'legacy', 'safe'],
    ['AI', detail.plan.execution_policy.ai_disclosure ? 'disclosed' : 'undisclosed', 'safe']
  ]) {
    const item = element('span', mode);
    item.append(element('small', '', label), element('strong', '', value.replaceAll('_', ' ')));
    policy.append(item);
  }
  root.append(policy, renderHypotheses(detail), renderTaskBoard(detail));

  const lower = element('div', 'campaign-lower-grid');
  const jobPanel = element('section', 'campaign-job-panel');
  workspaceUi.jobPanel = jobPanel;
  lower.append(jobPanel);
  const governance = element('section', 'campaign-governance');
  governance.append(
    element('span', 'section-kicker', 'HUMAN GOVERNANCE'),
    element('h3', '', 'Stop without erasing the record'),
    element('p', '', 'Stopping prevents future advances. If an AI task is live, stop that exact job first so its partial output is marked incomplete.')
  );
  const reason = element('textarea', 'campaign-control');
  reason.rows = 3;
  reason.maxLength = 2000;
  reason.placeholder = 'Why this campaign should stop…';
  const stop = button('Stop campaign permanently', 'stop-button');
  stop.disabled = TERMINAL_CAMPAIGN_STATUSES.has(detail.state.status) ||
    ACTIVE_JOB_STATUSES.has(activeJob?.status);
  stop.addEventListener('click', () => void stopCampaign(detail, reason.value, stop));
  governance.append(reason, stop,
    element('p', 'campaign-hash', 'plan ' + detail.manifest.plan.sha256 +
      '\nevent head ' + (detail.verification.event_head_sha256 ?? 'none')));
  lower.append(governance);
  root.append(lower);
  renderJobPanel(detail);
}

export async function openCampaign(campaignId, taskId = null) {
  if (!campaignId) return;
  selectedId = campaignId;
  if (taskId) selectedTaskId = taskId;
  updateUrl(campaignId);
  if (workspaceUi?.select) workspaceUi.select.value = campaignId;
  if (!workspaceUi?.detail) return;
  workspaceUi.detail.replaceChildren(element('div', 'campaign-loading', 'Verifying campaign plan and event chain…'));
  const token = Symbol('campaign-load');
  loadToken = token;
  try {
    const { payload } = await context.request('/api/campaigns/' + encodeURIComponent(campaignId));
    if (loadToken !== token || !context.isActive()) return;
    activeCampaign = payload;
    renderCampaignDetail(payload);
  } catch (error) {
    if (loadToken !== token) return;
    workspaceUi.detail.replaceChildren(element('div', 'campaign-loading attention', error.message));
    context.notify(error.message);
  }
}

async function createCampaign(editor, chat, note, control, stateNode) {
  if (!chat.value) {
    context.notify('Start or select an active Scientist conversation before freezing a campaign.');
    return;
  }
  let spec;
  try {
    spec = JSON.parse(editor.value);
  } catch (error) {
    context.notify('Campaign JSON is invalid: ' + error.message);
    return;
  }
  control.disabled = true;
  stateNode.className = 'campaign-draft-state working';
  stateNode.textContent = 'VALIDATING · strict schema, dependencies, budgets, secrets, and linked chat';
  try {
    const { payload } = await context.request('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, chat_id: chat.value, note: note.value.trim() || null })
    });
    const id = payload.campaign.manifest.campaign_id;
    selectedId = id;
    selectedTaskId = null;
    selectedHypothesisId = null;
    activeCampaign = payload.campaign;
    context.notify('Campaign frozen. Every future checkpoint and AI turn will append to its hash chain.');
    await refreshAfterMutation(id);
  } catch (error) {
    control.disabled = false;
    stateNode.className = 'campaign-draft-state invalid';
    stateNode.textContent = 'INVALID · ' + error.message;
    context.notify(error.message);
  }
}

function updateDraftState(editor, stateNode) {
  try {
    const spec = JSON.parse(editor.value);
    const tasks = Array.isArray(spec.tasks) ? spec.tasks : [];
    const hypotheses = Array.isArray(spec.hypotheses) ? spec.hypotheses : [];
    stateNode.className = 'campaign-draft-state';
    stateNode.textContent = 'DRAFT · ' + hypotheses.length + ' hypotheses · ' + tasks.length +
      ' tasks · ' + tasks.filter((task) => task.compute === 'gpu').length + ' GPU · ' +
      tasks.filter((task) => task.compute === 'npu').length + ' NPU';
  } catch (error) {
    stateNode.className = 'campaign-draft-state invalid';
    stateNode.textContent = 'INVALID JSON · ' + error.message;
  }
}

async function refreshAfterMutation(campaignId) {
  await context.refreshState();
  await context.refreshHarness?.(activeCampaign?.manifest?.chat_id ?? null);
  if (!context.isActive()) return;
  context.rerender();
}

async function pollCampaignJob(jobId) {
  if (pollingJobId === jobId) return;
  pollingJobId = jobId;
  let failures = 0;
  try {
    while (true) {
      try {
        const { payload: job } = await context.request('/api/jobs/' + encodeURIComponent(jobId));
        activeJob = job;
        failures = 0;
        if (activeCampaign?.manifest?.campaign_id === job.campaign_id) {
          renderJobPanel(activeCampaign);
        }
        if (!ACTIVE_JOB_STATUSES.has(job.status)) {
          const id = job.campaign_id;
          context.notify(job.status === 'completed'
            ? 'Campaign task completed and linked to its exact Scientist turn.'
            : job.status === 'cancelled'
              ? 'Campaign task stopped. Partial output is recorded as incomplete.'
              : job.error?.message ?? 'Campaign task failed; its attempt remains auditable.');
          await refreshAfterMutation(id);
          return job;
        }
      } catch (error) {
        failures += 1;
        if (failures >= 4) throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
  } finally {
    if (pollingJobId === jobId) pollingJobId = null;
  }
}

function ensureCampaignPolling(job) {
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status) || pollingJobId === job.job_id) return;
  void pollCampaignJob(job.job_id).catch((error) => context.notify(error.message));
}

async function cancelCampaignJob() {
  const job = activeJob;
  if (!job || !['queued', 'running'].includes(job.status)) return;
  activeJob = { ...job, status: 'cancelling' };
  if (activeCampaign) renderJobPanel(activeCampaign);
  try {
    const { payload } = await context.request(
      '/api/jobs/' + encodeURIComponent(job.job_id) + '/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'campaign',
          campaign_id: job.campaign_id,
          task_id: job.task_id,
          chat_id: job.chat_id
        })
      }
    );
    activeJob = payload;
    if (activeCampaign) renderJobPanel(activeCampaign);
    context.notify('Stopping the exact campaign task; partial output will stay marked incomplete.');
  } catch (error) {
    activeJob = job;
    if (activeCampaign) renderJobPanel(activeCampaign);
    context.notify(error.message);
  }
}

export function recoverCampaignJob(state) {
  const recovered = state?.campaign_jobs?.find((job) => ACTIVE_JOB_STATUSES.has(job.status));
  if (recovered) {
    activeJob = recovered;
    ensureCampaignPolling(recovered);
  }
  return activeJob;
}

export function renderCampaignWorkspace(options) {
  context = options;
  recoverCampaignJob(options.state);
  const campaigns = options.state?.campaigns ?? [];
  if (!campaigns.some((record) => record.campaign_id === selectedId)) {
    selectedId = campaigns[0]?.campaign_id ?? null;
    selectedTaskId = null;
    selectedHypothesisId = null;
  }
  const workspace = element('section', 'campaign-workspace');
  const head = element('header', 'campaign-workspace-head');
  const copy = element('div');
  copy.append(
    element('span', 'section-kicker', 'BOUNDED RESEARCH ORCHESTRATION'),
    element('h2', '', 'Hypothesis → checkpoint → one auditable AI turn'),
    element('p', '', 'Freeze a falsifiable plan, inspect its dependency graph, then approve each bounded task. GPU simulation and NPU inference have separate budgets and provenance.')
  );
  const readiness = element('div', 'campaign-readiness');
  const gpuReady = Boolean(options.state?.compute?.gpu?.available &&
    (options.state?.compute?.runtimes?.gpu?.healthy ?? options.state?.compute?.runtime?.healthy));
  const npuReady = Boolean(options.state?.compute?.npu?.available &&
    options.state?.compute?.runtimes?.npu?.healthy);
  readiness.append(
    statusPill(gpuReady ? 'gpu_ready' : 'gpu_attention'),
    statusPill(npuReady ? 'npu_ready' : 'npu_attention')
  );
  head.append(copy, readiness);
  workspace.append(head);

  const builder = element('div', 'campaign-builder');
  const planner = element('section', 'campaign-planner');
  const plannerHead = element('header', 'campaign-panel-head');
  plannerHead.append(element('span', 'section-kicker', 'NEW IMMUTABLE PLAN'), element('h3', '', 'Campaign specification'));
  const chat = element('select', 'campaign-control');
  chat.setAttribute('aria-label', 'Linked Scientist conversation');
  const chats = (options.state?.chats ?? []).filter((item) => item.status === 'active');
  if (!chats.length) {
    const item = element('option', '', 'Start a Scientist conversation first');
    item.value = '';
    chat.append(item);
    chat.disabled = true;
  } else {
    for (const record of chats) {
      const item = element('option', '', record.title + ' · ' + compact(record.chat_id, 26));
      item.value = record.chat_id;
      chat.append(item);
    }
    if (chats.some((item) => item.chat_id === options.selectedChat)) chat.value = options.selectedChat;
  }
  const editor = element('textarea', 'campaign-spec-editor');
  editor.rows = 26;
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'Research campaign JSON');
  editor.value = JSON.stringify(defaultCampaignSpec(options.state?.project?.name), null, 2);
  const note = element('textarea', 'campaign-control campaign-plan-note');
  note.rows = 2;
  note.maxLength = 2000;
  note.placeholder = 'Optional AI-visible reason for freezing this plan…';
  const draftState = element('p', 'campaign-draft-state');
  updateDraftState(editor, draftState);
  editor.addEventListener('input', () => updateDraftState(editor, draftState));
  const reset = button('Reset accelerated template', 'quiet-button', () => {
    editor.value = JSON.stringify(defaultCampaignSpec(options.state?.project?.name), null, 2);
    updateDraftState(editor, draftState);
  });
  const freeze = button('Freeze research campaign', 'share-button');
  freeze.disabled = !chats.length;
  freeze.addEventListener('click', () => void createCampaign(editor, chat, note, freeze, draftState));
  const plannerActions = element('div', 'campaign-planner-actions');
  plannerActions.append(freeze, reset);
  planner.append(
    plannerHead,
    field('LINKED SCIENTIST CONVERSATION', chat),
    field('STRICT JSON PLAN', editor),
    field('PLAN NOTE', note),
    draftState,
    plannerActions
  );

  const browser = element('section', 'campaign-browser');
  const browserHead = element('header', 'campaign-panel-head');
  browserHead.append(element('span', 'section-kicker', 'VERIFIED CAMPAIGN RECORD'), element('h3', '', 'Inspect and advance'));
  const select = element('select', 'campaign-control');
  select.setAttribute('aria-label', 'Research campaign');
  if (!campaigns.length) {
    const item = element('option', '', 'No campaign frozen yet');
    item.value = '';
    select.append(item);
    select.disabled = true;
  } else {
    for (const record of campaigns) {
      const item = element('option', '', record.title + ' · ' + record.status);
      item.value = record.campaign_id;
      select.append(item);
    }
    select.value = selectedId;
  }
  select.addEventListener('change', () => {
    selectedTaskId = null;
    selectedHypothesisId = null;
    void openCampaign(select.value);
  });
  const selectedSummary = element('div', 'campaign-browser-summary');
  selectedSummary.append(
    element('strong', '', campaigns.length + ' campaign' + (campaigns.length === 1 ? '' : 's')),
    element('span', '', (options.state?.counts?.active_campaigns ?? 0) + ' active · ' +
      (options.state?.counts?.campaign_tasks_completed ?? 0) + ' tasks completed')
  );
  const policyNote = element('div', 'campaign-enforcement-note');
  policyNote.append(
    element('strong', '', 'ENFORCEMENT BOUNDARY'),
    element('p', '', 'Task and accelerator budgets are enforced by ScienceCode. Network and physical-execution restrictions are explicit prompt/human policies, not an operating-system sandbox.')
  );
  browser.append(browserHead, field('SELECT CAMPAIGN', select), selectedSummary, policyNote);
  builder.append(planner, browser);
  workspace.append(builder);

  const detail = element('div', 'campaign-detail');
  workspace.append(detail);
  workspaceUi = { workspace, select, detail, jobPanel: null };
  if (selectedId) queueMicrotask(() => void openCampaign(selectedId, selectedTaskId));
  else detail.append(element('div', 'campaign-loading', 'Freeze a plan to open its interactive task graph.'));
  return workspace;
}

export function currentCampaignId() {
  return selectedId;
}
