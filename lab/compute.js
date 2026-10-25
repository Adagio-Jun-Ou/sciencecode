const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);
const MAX_EXPERIMENT_RUNS = 64;

let activeComputeJob = null;
let computePollingJobId = null;
let computeLauncherUi = null;
let computeJobContext = null;

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function fieldLabel(text, control, help = null) {
  const label = create('label', 'analysis-field');
  label.append(create('span', '', text), control);
  if (help) label.append(create('small', 'compute-field-help', help));
  return label;
}

function selectControl(values, selected = '') {
  const select = create('select', 'inference-control');
  for (const [value, label] of values) {
    const option = create('option', '', label);
    option.value = value;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function boundedLines(value, label, maximum) {
  const lines = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > maximum) {
    throw new Error(label + ' may contain at most ' + maximum + ' lines.');
  }
  if (lines.some((line) => line.length > 4_096)) {
    throw new Error(label + ' lines are limited to 4096 characters.');
  }
  return lines;
}

export function parseScientificJsonObject(value, label = 'Value') {
  const source = String(value ?? '').trim();
  if (!source) return {};
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(label + ' must be valid JSON: ' + error.message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(label + ' must be a JSON object.');
  }
  const names = Object.keys(parsed);
  if (names.length > 128 || names.some((name) =>
    !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name) ||
    ['__proto__', 'prototype', 'constructor'].includes(name))) {
    throw new Error(label + ' may contain at most 128 safe named values.');
  }
  return parsed;
}

export function parseExperimentSeedList(value) {
  const tokens = String(value ?? '').split(',').map((token) => token.trim());
  if (!tokens.length || tokens.some((token) => !/^\d+$/.test(token))) {
    throw new Error('Seeds must be comma-separated integers.');
  }
  const seeds = tokens.map(Number);
  if (seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 ||
      seed > 0xffffffff)) {
    throw new Error('Seeds must be integers from 0 through 4294967295.');
  }
  if (new Set(seeds).size !== seeds.length) {
    throw new Error('Experiment seeds must be unique.');
  }
  if (seeds.length > MAX_EXPERIMENT_RUNS) {
    throw new Error('An experiment may contain at most 64 seeds.');
  }
  return seeds;
}

export function experimentBranchCount(seeds, variations) {
  if (!Array.isArray(seeds) || !seeds.length) {
    throw new Error('An experiment requires at least one seed.');
  }
  let combinations = 1;
  for (const [name, values] of Object.entries(variations)) {
    if (!Array.isArray(values) || !values.length) {
      throw new Error('Variation ' + name + ' must be a non-empty JSON array.');
    }
    const keys = values.map((value) => JSON.stringify(value));
    if (new Set(keys).size !== keys.length) {
      throw new Error('Variation ' + name + ' contains duplicate values.');
    }
    combinations *= values.length;
    if (combinations * seeds.length > MAX_EXPERIMENT_RUNS) {
      throw new Error('Experiment matrix exceeds the safety limit of 64 runs.');
    }
  }
  return combinations * seeds.length;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(date);
}

function compact(value, limit = 80) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '...' : text;
}

function pluralView(kind) {
  return kind === 'experiment' ? 'experiments' : 'simulations';
}

function activeJobFromState(state) {
  return [
    ...(state?.simulation_jobs ?? []),
    ...(state?.experiment_jobs ?? [])
  ].find((job) => ACTIVE_JOB_STATUSES.has(job.status)) ?? null;
}

function updateComputeLauncher(job = activeComputeJob) {
  const ui = computeLauncherUi;
  if (!ui) return;
  const presentedJob = job && (
    ACTIVE_JOB_STATUSES.has(job.status) || job.kind === ui.kind
  ) ? job : null;
  const status = presentedJob?.status ?? 'ready';
  const active = ACTIVE_JOB_STATUSES.has(status);
  const sameKind = !presentedJob || presentedJob.kind === ui.kind;
  ui.workspace.setAttribute('aria-busy', String(active && sameKind));
  ui.status.className = 'inference-job-status ' + status;
  ui.status.textContent = presentedJob
    ? status.toUpperCase() + ' / ' + String(presentedJob.kind).toUpperCase() +
      (presentedJob.experiment_id || presentedJob.simulation_id
        ? ' / ' + compact(presentedJob.experiment_id ?? presentedJob.simulation_id, 31)
        : '')
    : 'READY / no standalone compute job is running';
  ui.submit.disabled = active;
  ui.stop.hidden = !active;
  ui.stop.disabled = status === 'cancelling';
  ui.stop.textContent = status === 'cancelling'
    ? 'Stopping ' + presentedJob.kind
    : 'Stop ' + (presentedJob?.kind ?? ui.kind);
  for (const control of ui.lockedControls) control.disabled = active;
  if (!active) ui.syncOptionalControls();
  ui.events.replaceChildren();
  const events = presentedJob?.events ?? [];
  if (!events.length) {
    ui.events.append(create('p', 'inference-event-empty',
      'Validated lifecycle and immutable-record events will appear here.'));
  } else {
    for (const event of events.slice(-8)) {
      const row = create('div', 'inference-event-row ' + (event.status ?? 'recorded'));
      row.append(
        create('span', '', presentedJob.kind === 'experiment' ? 'EXP' : 'SIM'),
        create('div', '', event.title ?? event.type),
        create('time', '', formatTime(event.timestamp))
      );
      ui.events.append(row);
    }
  }
  if (active && !sameKind) {
    ui.handoff.hidden = false;
    ui.handoff.textContent = 'A ' + presentedJob.kind +
      ' is already active. Open ' + pluralView(presentedJob.kind) + ' to inspect it.';
  } else {
    ui.handoff.hidden = true;
  }
}

async function pollComputeJob(jobId) {
  if (computePollingJobId === jobId || !computeJobContext) return;
  computePollingJobId = jobId;
  let failures = 0;
  try {
    while (true) {
      try {
        const { payload: job } = await computeJobContext.request(
          '/api/jobs/' + encodeURIComponent(jobId)
        );
        activeComputeJob = job;
        failures = 0;
        updateComputeLauncher(job);
        if (!ACTIVE_JOB_STATUSES.has(job.status)) {
          await computeJobContext.refreshState();
          if (computeJobContext.isActive(job.kind)) {
            computeJobContext.rerender(job.kind);
            const recordId = job.experiment_id ?? job.simulation_id;
            if (recordId) computeJobContext.openRecord(job.kind, recordId);
          }
          computeJobContext.notify(job.status === 'completed'
            ? (job.kind === 'experiment' ? 'Experiment matrix' : 'Simulation') +
              ' completed and its immutable record verified.'
            : job.status === 'cancelled'
              ? (job.kind === 'experiment' ? 'Experiment' : 'Simulation') +
                ' stopped. Partial evidence remains recorded and incomplete.'
              : job.error?.message ?? 'Scientific compute failed; inspect its record.');
          return job;
        }
      } catch (error) {
        failures += 1;
        if (failures >= 4) throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
  } finally {
    if (computePollingJobId === jobId) computePollingJobId = null;
  }
}

function ensureComputePolling(job) {
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status) ||
      computePollingJobId === job.job_id) return;
  void pollComputeJob(job.job_id).catch((error) => computeJobContext?.notify(error.message));
}

export function resumeScientificComputeJob(context) {
  computeJobContext = context;
  const recovered = ACTIVE_JOB_STATUSES.has(activeComputeJob?.status)
    ? activeComputeJob
    : activeJobFromState(context.state);
  if (!recovered) return;
  activeComputeJob = recovered;
  updateComputeLauncher(recovered);
  ensureComputePolling(recovered);
}

async function startComputeJob() {
  const ui = computeLauncherUi;
  if (!ui || ACTIVE_JOB_STATUSES.has(activeComputeJob?.status)) return;
  try {
    const parameters = parseScientificJsonObject(ui.parameters.value, 'Fixed parameters');
    const body = {
      script: ui.script.value.trim(),
      device: ui.device.value,
      timeout_seconds: Number(ui.timeout.value),
      parameters,
      script_arguments: boundedLines(ui.arguments.value, 'Script arguments', 128),
      inputs: boundedLines(ui.inputs.value, 'Declared inputs', 64),
      cad_build_id: ui.cadBuild.value || null,
      chat_id: ui.share.checked ? ui.selectedChat : null,
      note: ui.share.checked ? ui.note.value.trim() || null : null
    };
    if (!body.script) throw new Error('Choose a project-relative Python script.');
    if (ui.kind === 'simulation') {
      body.seed = Number(ui.seed.value);
      if (!Number.isSafeInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff) {
        throw new Error('Seed must be an integer from 0 through 4294967295.');
      }
    } else {
      body.name = ui.name.value.trim() || null;
      body.hypothesis = ui.hypothesis.value.trim() || null;
      body.seeds = parseExperimentSeedList(ui.seeds.value);
      body.variations = parseScientificJsonObject(ui.variations.value, 'Variations');
      experimentBranchCount(body.seeds, body.variations);
      body.analysis_contract_id = ui.analysisContract.value || null;
    }
    ui.submit.disabled = true;
    ui.status.textContent = 'VALIDATING / paths, runtime, parameters, and secrets';
    const { payload } = await computeJobContext.request(
      '/api/' + pluralView(ui.kind),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    activeComputeJob = payload;
    updateComputeLauncher(payload);
    ensureComputePolling(payload);
  } catch (error) {
    updateComputeLauncher(activeComputeJob);
    computeJobContext.notify(error.message);
  }
}

async function cancelComputeJob() {
  const job = activeComputeJob;
  if (!job || !['queued', 'running'].includes(job.status)) return;
  activeComputeJob = { ...job, status: 'cancelling' };
  updateComputeLauncher(activeComputeJob);
  try {
    const { payload } = await computeJobContext.request(
      '/api/jobs/' + encodeURIComponent(job.job_id) + '/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: job.kind, chat_id: job.chat_id })
      }
    );
    activeComputeJob = payload;
    updateComputeLauncher(payload);
    computeJobContext.notify('Stopping the ' + job.kind +
      '; partial immutable evidence will be preserved.');
  } catch (error) {
    activeComputeJob = job;
    updateComputeLauncher(job);
    computeJobContext.notify(error.message);
  }
}

async function installSimulationTemplate() {
  const ui = computeLauncherUi;
  if (!ui?.template || ACTIVE_JOB_STATUSES.has(activeComputeJob?.status)) return;
  ui.installTemplate.disabled = true;
  ui.templateStatus.textContent = 'Installing exact packaged template...';
  try {
    const { payload } = await computeJobContext.request(
      '/api/simulation-templates/' + encodeURIComponent(ui.template.value),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ui.share.checked ? ui.selectedChat : null,
          note: ui.share.checked ? ui.note.value.trim() || null : null
        })
      }
    );
    ui.script.value = payload.template.file;
    ui.templateStatus.textContent = payload.template.created
      ? 'Installed ' + payload.template.file
      : 'Exact template already present at ' + payload.template.file;
    computeJobContext.notify(ui.templateStatus.textContent);
    await computeJobContext.refreshState();
  } catch (error) {
    ui.templateStatus.textContent = 'Not installed / ' + error.message;
    computeJobContext.notify(error.message);
  } finally {
    ui.installTemplate.disabled = ACTIVE_JOB_STATUSES.has(activeComputeJob?.status);
  }
}

function verifiedCadBuildOptions(state) {
  return (state?.cad_builds ?? [])
    .filter((build) => build.verified && build.status === 'completed')
    .map((build) => [
      build.build_id,
      (build.cad_project_id ? compact(build.cad_project_id, 22) + ' / ' : '') +
        compact(build.build_id, 28)
    ]);
}

export function renderScientificComputeWorkspace({
  kind,
  state,
  selectedChat,
  request,
  notify,
  refreshState,
  rerender,
  isActive,
  openRecord
}) {
  const experiment = kind === 'experiment';
  computeJobContext = {
    state,
    request,
    notify,
    refreshState,
    rerender,
    isActive,
    openRecord
  };
  const workspace = create('section', 'inference-launcher compute-launcher');
  workspace.setAttribute('aria-label', experiment
    ? 'Recorded experiment launcher'
    : 'Recorded simulation launcher');
  workspace.setAttribute('aria-busy', 'false');
  const head = create('header', 'inference-launcher-head compute-launcher-head');
  head.append(
    create('span', 'section-kicker', experiment
      ? 'BOUNDED SEQUENTIAL MATRIX'
      : 'REPRODUCIBLE LOCAL COMPUTE'),
    create('h2', '', experiment
      ? 'Design and run a recorded experiment'
      : 'Run a recorded simulation'),
    create('p', '', experiment
      ? 'Freeze a hypothesis, seeds, fixed parameters, and bounded variation matrix before dispatch. Every branch remains an independently verified simulation.'
      : 'Select a project Python model, deterministic seed, declared inputs, and execution policy. Generated artifacts remain immutable and independently verifiable.')
  );
  const runtimeReady = Boolean(
    state?.compute?.capabilities?.gpu_simulation?.ready ||
    state?.compute?.runtimes?.gpu?.healthy ||
    state?.compute?.runtime?.healthy
  );
  head.append(create('span',
    'inference-readiness ' + (runtimeReady ? 'ready' : 'attention'),
    runtimeReady ? 'SCIENTIFIC RUNTIME READY' : 'RUNTIME NEEDS SETUP'));

  const body = create('div', 'inference-launcher-grid compute-launcher-grid');
  const form = create('form', 'inference-launch-form compute-launch-form');
  const script = create('input', 'inference-control');
  script.type = 'text';
  script.required = true;
  script.maxLength = 4_096;
  script.placeholder = 'simulations/reaction-diffusion.py';
  const device = selectControl([
    ['auto', 'Auto / record selected device'],
    ['cpu', 'CPU'],
    ['cuda', 'CUDA default device'],
    ['cuda:0', 'CUDA device 0']
  ], 'auto');
  const timeout = create('input', 'inference-control');
  timeout.type = 'number';
  timeout.min = '1';
  timeout.max = '86400';
  timeout.value = experiment ? '3600' : '900';
  const parameters = create('textarea', 'inference-control compute-json-control');
  parameters.rows = 4;
  parameters.value = '{}';
  parameters.spellcheck = false;
  const variations = experiment
    ? create('textarea', 'inference-control compute-json-control')
    : null;
  if (variations) {
    variations.rows = 4;
    variations.value = '{}';
    variations.spellcheck = false;
  }
  const inputs = create('textarea', 'inference-control');
  inputs.rows = 3;
  inputs.placeholder = 'data/input.csv\nmodels/weights.json';
  const scriptArguments = create('textarea', 'inference-control');
  scriptArguments.rows = 3;
  scriptArguments.placeholder = '--mode\nbaseline';
  const seed = experiment ? null : create('input', 'inference-control');
  if (seed) {
    seed.type = 'number';
    seed.min = '0';
    seed.max = '4294967295';
    seed.value = '0';
  }
  const seeds = experiment ? create('input', 'inference-control') : null;
  if (seeds) {
    seeds.type = 'text';
    seeds.value = '0';
    seeds.placeholder = '0,1,2';
  }
  const name = experiment ? create('input', 'inference-control') : null;
  if (name) {
    name.type = 'text';
    name.maxLength = 200;
    name.placeholder = 'Dose-response sensitivity';
  }
  const hypothesis = experiment ? create('textarea', 'inference-control') : null;
  if (hypothesis) {
    hypothesis.rows = 3;
    hypothesis.maxLength = 4_000;
    hypothesis.placeholder = 'State the falsifiable hypothesis evaluated by this matrix.';
  }
  const analysisContracts = (state?.analysis_contracts ?? [])
    .filter((contract) => contract.verified)
    .map((contract) => [
      contract.analysis_contract_id,
      compact(contract.name ?? contract.analysis_contract_id, 46)
    ]);
  const analysisContract = experiment
    ? selectControl([['', 'Unregistered / no frozen contract'], ...analysisContracts], '')
    : null;
  const cadBuild = selectControl([
    ['', 'No CAD parent'],
    ...verifiedCadBuildOptions(state)
  ], '');
  const share = create('input');
  share.type = 'checkbox';
  share.checked = Boolean(selectedChat);
  share.disabled = !selectedChat;
  const shareLabel = create('label', 'inference-check');
  shareLabel.append(
    share,
    create('span', '', selectedChat
      ? 'Share the immutable outcome with the selected conversation'
      : 'Select a conversation to share this outcome with the AI')
  );
  const note = create('textarea', 'inference-control');
  note.rows = 3;
  note.maxLength = 2_000;
  note.placeholder = 'Optional scientific direction for the selected conversation...';

  const scriptField = fieldLabel('Project Python script', script,
    'Project-relative .py path; the exact source is archived before execution.');
  scriptField.classList.add('inference-field-wide');
  const parameterField = fieldLabel('Fixed parameters / JSON object', parameters);
  parameterField.classList.add('inference-field-wide');
  const inputField = fieldLabel('Declared input paths / one per line', inputs);
  inputField.classList.add('inference-field-wide');
  const argumentField = fieldLabel('Script arguments / one per line', scriptArguments);
  argumentField.classList.add('inference-field-wide');
  const noteField = fieldLabel('AI-visible direction', note);
  noteField.classList.add('inference-field-full');

  if (experiment) {
    const hypothesisField = fieldLabel('Falsifiable hypothesis', hypothesis);
    hypothesisField.classList.add('inference-field-full');
    const variationField = fieldLabel('Variation matrix / JSON arrays', variations);
    variationField.classList.add('inference-field-wide');
    form.append(
      fieldLabel('Experiment name', name),
      fieldLabel('Seeds', seeds, 'Comma-separated unique integers.'),
      fieldLabel('Execution policy', device),
      hypothesisField,
      scriptField,
      fieldLabel('Timeout per branch / seconds', timeout),
      parameterField,
      variationField,
      fieldLabel('Prospective analysis contract', analysisContract),
      fieldLabel('Verified CAD parent', cadBuild),
      inputField,
      argumentField
    );
  } else {
    const templateBand = create('div', 'compute-template-band');
    const template = selectControl([
      ['reaction-diffusion', 'Reaction-diffusion example'],
      ['cad-mesh-validation', 'CAD mesh validation'],
      ['cad-surface-heat', 'CAD surface heat diffusion']
    ], 'reaction-diffusion');
    const installTemplate = create('button', 'secondary-button', 'Install exact template');
    installTemplate.type = 'button';
    const templateStatus = create('small', 'compute-template-status',
      'Templates are additive and never overwrite changed project files.');
    templateBand.append(fieldLabel('Packaged starter', template), installTemplate, templateStatus);
    form.append(
      templateBand,
      scriptField,
      fieldLabel('Deterministic seed', seed),
      fieldLabel('Execution policy', device),
      fieldLabel('Timeout / seconds', timeout),
      parameterField,
      fieldLabel('Verified CAD parent', cadBuild),
      inputField,
      argumentField
    );
    form.templateControls = { template, installTemplate, templateStatus };
  }
  form.append(shareLabel, noteField);
  const matrixStatus = create('p', 'compute-matrix-status');
  matrixStatus.setAttribute('role', 'status');
  matrixStatus.setAttribute('aria-live', 'polite');
  if (experiment) form.append(matrixStatus);
  const actions = create('div', 'inference-launch-actions');
  const submit = create('button', 'share-button', experiment
    ? 'Run recorded experiment'
    : 'Run recorded simulation');
  submit.type = 'submit';
  const stop = create('button', 'stop-button', experiment
    ? 'Stop experiment'
    : 'Stop simulation');
  stop.type = 'button';
  stop.hidden = true;
  actions.append(submit, stop);
  form.append(actions);

  const monitor = create('aside', 'inference-monitor compute-monitor');
  monitor.append(
    create('span', 'board-label', 'LIVE SCIENTIFIC COMPUTE JOB'),
    create('h3', '', experiment ? 'Matrix and provenance trace' : 'Runtime and provenance trace')
  );
  const status = create('p', 'inference-job-status ready');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const handoff = create('p', 'compute-job-handoff');
  handoff.hidden = true;
  const events = create('div', 'inference-events');
  monitor.append(status, handoff, events);
  body.append(form, monitor);
  workspace.append(head, body);

  const lockedControls = [
    script, device, timeout, parameters, inputs, scriptArguments, cadBuild,
    share, note,
    ...(experiment
      ? [name, hypothesis, seeds, variations, analysisContract]
      : [seed, form.templateControls.template, form.templateControls.installTemplate])
  ];
  const syncOptionalControls = () => {
    share.disabled = !selectedChat;
    note.disabled = !selectedChat || !share.checked;
  };
  const updateMatrix = () => {
    if (!experiment) return;
    try {
      const parsedSeeds = parseExperimentSeedList(seeds.value);
      const parsedVariations = parseScientificJsonObject(variations.value, 'Variations');
      const count = experimentBranchCount(parsedSeeds, parsedVariations);
      matrixStatus.className = 'compute-matrix-status ready';
      matrixStatus.textContent = count + ' sequential branch' + (count === 1 ? '' : 'es') +
        ' planned / hard limit 64';
    } catch (error) {
      matrixStatus.className = 'compute-matrix-status attention';
      matrixStatus.textContent = error.message;
    }
  };
  computeLauncherUi = {
    kind,
    workspace,
    selectedChat,
    script,
    device,
    timeout,
    parameters,
    variations,
    inputs,
    arguments: scriptArguments,
    seed,
    seeds,
    name,
    hypothesis,
    analysisContract,
    cadBuild,
    share,
    note,
    submit,
    stop,
    status,
    handoff,
    events,
    matrixStatus,
    lockedControls,
    syncOptionalControls,
    ...(form.templateControls ?? {})
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void startComputeJob();
  });
  stop.addEventListener('click', () => void cancelComputeJob());
  share.addEventListener('change', syncOptionalControls);
  if (experiment) {
    seeds.addEventListener('input', updateMatrix);
    variations.addEventListener('input', updateMatrix);
    updateMatrix();
  } else {
    form.templateControls.installTemplate.addEventListener(
      'click', () => void installSimulationTemplate()
    );
  }
  const recovered = ACTIVE_JOB_STATUSES.has(activeComputeJob?.status)
    ? activeComputeJob
    : activeJobFromState(state);
  if (recovered) activeComputeJob = recovered;
  syncOptionalControls();
  updateComputeLauncher(activeComputeJob);
  ensureComputePolling(activeComputeJob);
  return workspace;
}
