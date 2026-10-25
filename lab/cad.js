const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);
const CAD_MODEL_PRESETS = {
  'mesh-validation': {
    label: 'Mesh geometry validation',
    template: 'cad-mesh-validation',
    script: 'simulations/cad-mesh-validation.py',
    parameters: {
      density_g_cm3: 1.24,
      precision: 'float64'
    }
  },
  'surface-thermal': {
    label: 'Surface thermal field',
    template: 'cad-surface-heat',
    script: 'simulations/cad-surface-heat.py',
    parameters: {
      initial_temperature_c: 20,
      hot_temperature_c: 80,
      cold_temperature_c: 20,
      hot_face: 'x_min',
      cold_face: 'x_max',
      thermal_diffusivity_mm2_s: 0.1,
      duration_s: 10,
      steps: 200,
      face_band_fraction: 0.02,
      precision: 'float64',
      history_frames: 50
    }
  }
};

function studyPreset(name) {
  const preset = CAD_MODEL_PRESETS[name];
  if (!preset) return { parameters: {}, variations: {} };
  const parameters = { ...preset.parameters };
  if (name === 'surface-thermal') {
    delete parameters.thermal_diffusivity_mm2_s;
    return {
      parameters,
      variations: { thermal_diffusivity_mm2_s: [0.05, 0.1, 0.2] }
    };
  }
  delete parameters.density_g_cm3;
  return {
    parameters,
    variations: { density_g_cm3: [0.9, 1.24, 1.8] }
  };
}

let context = null;
let ui = null;
let projectDetail = null;
let activeJob = null;
let pollingJobId = null;
let selectedFile = null;
let selectedBuildId = null;
let selectedProjectId = new URLSearchParams(
  typeof window === 'undefined' ? '' : window.location.search
).get('cad');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(label, className, handler) {
  const node = element('button', className, label);
  node.type = 'button';
  if (handler) node.addEventListener('click', handler);
  return node;
}

function labeledControl(label, control, className = '') {
  const wrapper = element('label', className);
  wrapper.append(element('span', '', label), control);
  return wrapper;
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

function metric(label, value) {
  const item = element('div', 'cad-metric');
  item.append(element('span', '', label), element('strong', '', String(value ?? '—')));
  return item;
}

function statusPill(status) {
  const safe = String(status ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return element('span', 'mini-status ' + safe, String(status ?? 'unknown').replaceAll('_', ' '));
}

function parseJsonControl(control, fallback, label) {
  const text = control.value.trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(label + ' must be valid JSON.');
  }
}

function applyModelPreset(name) {
  if (!ui) return;
  const preset = CAD_MODEL_PRESETS[name];
  ui.modelInstall.disabled = !preset;
  if (!preset) return;
  ui.modelScript.value = preset.script;
  ui.modelParameters.value = JSON.stringify(preset.parameters, null, 2);
  ui.modelArgs.value = '[]';
  ui.modelInputs.value = '';
  ui.modelDevice.value = 'cpu';
  const study = studyPreset(name);
  ui.studyParameters.value = JSON.stringify(study.parameters, null, 2);
  ui.studyVariations.value = JSON.stringify(study.variations, null, 2);
}

async function installModelTemplate() {
  const preset = CAD_MODEL_PRESETS[ui?.modelPreset?.value];
  if (!preset || !ui) {
    context.notify('Select a built-in CAD model preset first.');
    return;
  }
  ui.modelInstall.disabled = true;
  try {
    const { payload } = await context.request(
      '/api/simulation-templates/' + encodeURIComponent(preset.template),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(ui.chat.value ? { chat_id: ui.chat.value } : {}),
          note: 'Installed from the CAD simulation preset control.'
        })
      }
    );
    ui.modelScript.value = payload.template.file;
    context.notify(payload.template.created
      ? 'Installed ' + payload.template.file + ' without overwriting project files.'
      : payload.template.file + ' already matches the packaged template.');
    await context.refreshHarness?.(ui.chat.value);
  } catch (error) {
    context.notify(error.code === 'EEXIST'
      ? 'The target model file already exists with different content; ScienceCode will not overwrite it.'
      : error.message);
  } finally {
    if (ui) ui.modelInstall.disabled = !CAD_MODEL_PRESETS[ui.modelPreset.value];
  }
}

function updateUrl(projectId) {
  const url = new URL(window.location.href);
  if (projectId) url.searchParams.set('cad', projectId);
  else url.searchParams.delete('cad');
  window.history.replaceState({}, '', url);
}

function projectArtifact() {
  if (!projectDetail) return null;
  const id = projectDetail.descriptor.cad_project_id;
  return {
    kind: 'cad-project',
    record_id: id,
    name: projectDetail.descriptor.name,
    url: '/api/cad/projects/' + encodeURIComponent(id)
  };
}

function chatOptions(select) {
  const chats = (context.state?.chats ?? []).filter((chat) => chat.status === 'active');
  select.replaceChildren();
  const noChat = element('option', '', 'Do not link to a conversation');
  noChat.value = '';
  select.append(noChat);
  for (const chat of chats) {
    const option = element('option', '', chat.title + ' · ' + compact(chat.chat_id, 24));
    option.value = chat.chat_id;
    select.append(option);
  }
  if (chats.some((chat) => chat.chat_id === context.selectedChat)) {
    select.value = context.selectedChat;
  }
}

function currentProjectSummary() {
  return (context.state?.cad_projects ?? []).find((project) =>
    project.cad_project_id === selectedProjectId) ?? null;
}

function currentBuilds() {
  return (context.state?.cad_builds ?? []).filter((build) =>
    build.cad_project_id === selectedProjectId);
}

function currentSimulations() {
  return (context.state?.cad_simulations ?? []).filter((record) =>
    record.cad_project_id === selectedProjectId);
}

function currentPhysicsSimulations() {
  return (context.state?.simulations ?? []).filter((record) =>
    record.cad_parent?.cad_project_id === selectedProjectId &&
    (!selectedBuildId || record.cad_parent?.build_id === selectedBuildId)
  );
}

function currentStudies() {
  return (context.state?.experiments ?? []).filter((record) =>
    record.cad_parent?.cad_project_id === selectedProjectId &&
    (!selectedBuildId || record.cad_parent?.build_id === selectedBuildId)
  );
}

function currentSlices() {
  return (context.state?.cad_slices ?? []).filter((record) =>
    record.cad_project_id === selectedProjectId);
}

function setBusy(busy) {
  if (!ui) return;
  for (const control of ui.mutationControls) control.disabled = busy;
  ui.modelInstall.disabled = busy || !CAD_MODEL_PRESETS[ui.modelPreset.value];
  ui.editor.readOnly = busy;
  ui.save.disabled = busy || !selectedFile;
}

function renderJob(job = activeJob) {
  if (!ui) return;
  ui.jobEvents.replaceChildren();
  if (!job) {
    ui.jobStatus.className = 'cad-job-status ready';
    ui.jobStatus.textContent = 'No active CAD operation';
    ui.jobEvents.append(element('p', 'cad-muted',
      'Renders and slices run in an isolated child process so this activity panel remains responsive.'));
    ui.modelStop.disabled = true;
    ui.studyStop.disabled = true;
    ui.workspace.setAttribute('aria-busy', 'false');
    setBusy(false);
    return;
  }
  ui.jobStatus.className = 'cad-job-status ' + job.status;
  ui.jobStatus.textContent = String(job.operation ?? 'CAD') + ' · ' +
    String(job.status).replaceAll('_', ' ');
  for (const event of job.events ?? []) {
    const row = element('div', 'cad-job-event ' + String(event.status ?? 'recorded'));
    row.append(element('i'), element('span', '', formatDate(event.timestamp)),
      element('strong', '', event.title ?? event.type));
    ui.jobEvents.append(row);
  }
  if (job.error) {
    ui.jobEvents.append(element('p', 'cad-job-error',
      String(job.error.code ?? 'CAD_ERROR') + ' · ' + String(job.error.message ?? 'Operation failed')));
  }
  const active = ACTIVE_JOB_STATUSES.has(job.status);
  const cancellable = job.can_cancel && ['queued', 'running'].includes(job.status);
  ui.modelStop.disabled = !(job.operation === 'model' && cancellable);
  ui.studyStop.disabled = !(job.operation === 'study' && cancellable);
  ui.modelStop.textContent = job.operation === 'model' && job.status === 'cancelling'
    ? 'Stopping model' : 'Stop model';
  ui.studyStop.textContent = job.operation === 'study' && job.status === 'cancelling'
    ? 'Stopping study' : 'Stop study';
  if (job.operation === 'study' && active) ui.studyPanel.open = true;
  ui.workspace.setAttribute('aria-busy', String(active));
  setBusy(active);
}

async function pollJob(jobId) {
  if (!jobId || pollingJobId === jobId) return;
  pollingJobId = jobId;
  try {
    let failures = 0;
    while (pollingJobId === jobId && context?.isActive()) {
      try {
        const { payload } = await context.request('/api/jobs/' + encodeURIComponent(jobId));
        activeJob = payload;
        failures = 0;
        renderJob(activeJob);
        if (!ACTIVE_JOB_STATUSES.has(activeJob.status)) {
          await context.refreshState();
          context.notify(activeJob.status === 'completed'
            ? 'CAD operation finished and passed integrity verification.'
            : activeJob.status === 'cancelled'
              ? activeJob.operation === 'study'
                ? activeJob.result?.manifest?.cancellation?.reason ===
                    'study_wall_clock_timeout'
                  ? 'CAD study reached its whole-matrix time limit; completed, interrupted, and unrun branches are preserved in a verified partial experiment record.'
                  : 'CAD study stopped; completed, interrupted, and unrun branches are preserved in a verified partial experiment record.'
                : 'CAD-linked model stopped; its partial immutable evidence remains available.'
              : activeJob.error?.message ?? 'CAD operation requires review.');
          context.rerender();
          return;
        }
      } catch (error) {
        failures += 1;
        if (failures >= 4) throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
  } catch (error) {
    context?.notify(error.message);
  } finally {
    if (pollingJobId === jobId) pollingJobId = null;
  }
}

async function createProject() {
  const name = ui.newName.value.trim() || 'Parametric assembly';
  const id = ui.newId.value.trim();
  ui.create.disabled = true;
  try {
    const { payload } = await context.request('/api/cad/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        engine: ui.newEngine.value,
        ...(id ? { cad_project_id: id } : {}),
        ...(ui.chat.value ? { chat_id: ui.chat.value } : {}),
        note: 'Created from the interactive CAD workspace.'
      })
    });
    selectedProjectId = payload.project.descriptor.cad_project_id;
    selectedFile = null;
    selectedBuildId = null;
    updateUrl(selectedProjectId);
    await context.refreshState();
    context.rerender();
  } catch (error) {
    context.notify(error.message);
  } finally {
    if (ui) ui.create.disabled = false;
  }
}

async function loadSource(file, { share = true } = {}) {
  if (!projectDetail || !file) return;
  try {
    const projectId = projectDetail.descriptor.cad_project_id;
    const { payload } = await context.request(
      '/api/cad/projects/' + encodeURIComponent(projectId) + '/files/' +
      encodeURIComponent(file)
    );
    selectedFile = file;
    ui.editor.value = payload.content;
    ui.editor.dataset.sha256 = payload.sha256;
    ui.editor.dataset.editable = String(payload.editable !== false);
    ui.fileTitle.textContent = file;
    ui.fileMeta.textContent = payload.bytes + ' bytes · SHA-256 ' + payload.sha256.slice(0, 16) + '…';
    ui.save.disabled = payload.editable === false;
    ui.editor.readOnly = payload.editable === false;
    ui.editor.setAttribute('aria-label', payload.file?.endsWith?.('.py')
      ? 'Editable CadQuery Python source' : 'Editable OpenSCAD source');
    for (const node of ui.fileRail.querySelectorAll('[data-cad-file]')) {
      node.classList.toggle('active', node.dataset.cadFile === file);
    }
    if (share && ui.chat.value && context.saveInteraction) {
      void context.saveInteraction('cad', 'file.selected', projectArtifact(), {
        cad_project_id: projectId,
        file,
        sha256: payload.sha256,
        note: 'The user selected this source in the multi-file CAD workspace.'
      }, { quiet: true });
    }
  } catch (error) {
    context.notify(error.message);
  }
}

async function saveSource() {
  if (!projectDetail || !selectedFile) return;
  ui.save.disabled = true;
  try {
    const projectId = projectDetail.descriptor.cad_project_id;
    const { payload } = await context.request(
      '/api/cad/projects/' + encodeURIComponent(projectId) + '/files/' +
        encodeURIComponent(selectedFile),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: ui.editor.value,
          expected_sha256: ui.editor.dataset.sha256,
          actor: 'lab-user',
          ...(ui.chat.value ? { chat_id: ui.chat.value } : {}),
          note: ui.note.value.trim() || 'Source saved from the interactive CAD workspace.'
        })
      }
    );
    ui.editor.dataset.sha256 = payload.file.sha256;
    ui.fileMeta.textContent = payload.file.bytes + ' bytes · SHA-256 ' +
      payload.file.sha256.slice(0, 16) + '…';
    context.notify(payload.file.changed
      ? 'CAD source saved with an immutable before/after revision.'
      : 'No source changes to save.');
    await context.refreshHarness?.(ui.chat.value);
  } catch (error) {
    context.notify(error.code === 'CAD_EDIT_CONFLICT'
      ? 'This file changed elsewhere. Reload it before saving your draft.'
      : error.message);
  } finally {
    if (ui) ui.save.disabled = false;
  }
}

async function startOperation(operation) {
  if (!projectDetail) return;
  const projectId = projectDetail.descriptor.cad_project_id;
  let endpoint;
  let body = {
    ...(ui.chat.value ? { chat_id: ui.chat.value } : {}),
    note: ui.note.value.trim() || 'Started from the interactive CAD workspace.'
  };
  if (operation === 'build') {
    endpoint = '/api/cad/projects/' + encodeURIComponent(projectId) + '/builds';
    body.timeout_seconds = 300;
  } else {
    const build = currentBuilds().find((item) => item.build_id === selectedBuildId);
    if (!build || build.status !== 'completed' || !build.verified) {
      context.notify('Select a completed, verified CAD build first.');
      return;
    }
    endpoint = '/api/cad/builds/' + encodeURIComponent(build.build_id) +
      (operation === 'simulate'
        ? '/simulations'
        : operation === 'model'
          ? '/models'
          : operation === 'study' ? '/studies' : '/slices');
    if (operation === 'simulate') {
      body.density_g_cm3 = Number(ui.density.value);
      body.maximum_severe_overhang_fraction = Number(ui.overhang.value);
    } else if (operation === 'model') {
      try {
        const parameters = parseJsonControl(
          ui.modelParameters, {}, 'Model parameters'
        );
        if (!parameters || typeof parameters !== 'object' ||
            Array.isArray(parameters)) {
          throw new Error('Model parameters must be a JSON object.');
        }
        const scriptArgs = parseJsonControl(
          ui.modelArgs, [], 'Model script arguments'
        );
        if (!Array.isArray(scriptArgs) ||
            scriptArgs.some((value) => typeof value !== 'string')) {
          throw new Error('Model script arguments must be a JSON array of strings.');
        }
        body.script = ui.modelScript.value.trim();
      body.device = ui.modelDevice.value;
      body.seed = Number(ui.modelSeed.value);
      body.minimum_free_gpu_mib = Number(ui.modelGpuReserve.value);
        body.parameters = parameters;
        body.script_args = scriptArgs;
        body.inputs = ui.modelInputs.value
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean);
        body.timeout_seconds = Number(ui.modelTimeout.value);
      } catch (error) {
        context.notify(error.message);
        return;
      }
    } else if (operation === 'study') {
      try {
        const parameters = parseJsonControl(
          ui.studyParameters, {}, 'Study fixed parameters'
        );
        const variations = parseJsonControl(
          ui.studyVariations, {}, 'Study variations'
        );
        const seeds = parseJsonControl(ui.studySeeds, [0], 'Study seeds');
        const scriptArgs = parseJsonControl(
          ui.modelArgs, [], 'Model script arguments'
        );
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) ||
            !variations || typeof variations !== 'object' || Array.isArray(variations)) {
          throw new Error('Study fixed parameters and variations must be JSON objects.');
        }
        if (!Array.isArray(seeds) || !seeds.length ||
            seeds.some((value) => !Number.isSafeInteger(value))) {
          throw new Error('Study seeds must be a non-empty JSON array of integers.');
        }
        if (!Array.isArray(scriptArgs) ||
            scriptArgs.some((value) => typeof value !== 'string')) {
          throw new Error('Model script arguments must be a JSON array of strings.');
        }
        body.script = ui.modelScript.value.trim();
        body.device = ui.modelDevice.value;
        body.seeds = seeds;
        body.parameters = parameters;
        body.variations = variations;
        body.script_args = scriptArgs;
        body.inputs = ui.modelInputs.value
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean);
        body.name = ui.studyName.value.trim();
        body.hypothesis = ui.studyHypothesis.value.trim();
        body.minimum_free_gpu_mib = Number(ui.modelGpuReserve.value);
        body.timeout_seconds = Number(ui.modelTimeout.value);
      } catch (error) {
        context.notify(error.message);
        return;
      }
    } else {
      body.mode = ui.sliceMode.value;
      body.settings = {
        layer_height_mm: Number(ui.layerHeight.value),
        nozzle_diameter_mm: Number(ui.nozzle.value),
        filament_diameter_mm: Number(ui.filament.value),
        infill_percent: Number(ui.infill.value),
        threads: Number(ui.threads.value)
      };
      if (body.mode === 'printer-profile') {
        body.profile_path = ui.profile.value.trim();
        body.acknowledge_physical_risk = ui.physicalAck.checked;
      }
    }
  }
  try {
    const { payload } = await context.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    activeJob = payload;
    renderJob(activeJob);
    void pollJob(activeJob.job_id);
  } catch (error) {
    context.notify(error.message);
  }
}

async function cancelCadOperation(operation) {
  if (!activeJob || activeJob.operation !== operation || !activeJob.can_cancel) return;
  const stop = operation === 'study' ? ui.studyStop : ui.modelStop;
  stop.disabled = true;
  try {
    const { payload } = await context.request(
      '/api/jobs/' + encodeURIComponent(activeJob.job_id) + '/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'cad',
          operation: activeJob.operation,
          cad_project_id: activeJob.cad_project_id,
          build_id: activeJob.build_id,
          chat_id: activeJob.chat_id ?? ''
        })
      }
    );
    activeJob = payload;
    renderJob(activeJob);
    context.notify(operation === 'study'
      ? 'Stopping the CAD study after the active branch is safely finalized.'
      : 'Stopping the CAD-linked model; partial evidence will be preserved.');
  } catch (error) {
    context.notify(error.message);
    if (ui) stop.disabled = false;
  }
}

function renderFileRail() {
  ui.fileRail.replaceChildren();
  for (const descriptor of projectDetail.files ?? []) {
    const node = button(descriptor.path, 'cad-file-item', descriptor.text
      ? () => void loadSource(descriptor.path)
      : () => context.notify('This binary CAD asset is preserved in the environment but is not a text-editable source.'));
    node.dataset.cadFile = descriptor.path;
    node.append(element('small', '', String(descriptor.bytes) + ' B · ' +
      (descriptor.editable ? 'editable' : descriptor.text ? 'view only' : 'binary asset')));
    ui.fileRail.append(node);
  }
}

function renderProjectFacts() {
  const descriptor = projectDetail.descriptor;
  ui.projectFacts.replaceChildren(
    metric('Files', descriptor.files.length),
    metric('Parts', descriptor.parts.length),
    metric('Engine', descriptor.engine),
    metric('Units', descriptor.units),
    metric('Build volume', descriptor.build_volume_mm.join(' × ') + ' mm')
  );
  ui.build.textContent = descriptor.engine === 'cadquery'
    ? 'Build CadQuery + STEP snapshot' : 'Render OpenSCAD snapshot';
  ui.parts.replaceChildren();
  for (const part of descriptor.parts) {
    const row = element('div', 'cad-part-row');
    row.append(element('strong', '', part.name),
      element('span', '', part.source),
      element('small', '', 'qty ' + part.quantity +
        (part.material ? ' · ' + part.material : '')));
    ui.parts.append(row);
  }
}

function renderMesh(build) {
  ui.mesh.replaceChildren();
  if (!build?.mesh_url) {
    ui.mesh.append(element('div', 'cad-empty-stage',
      'Build the declared parametric assembly to open the interactive mesh.'));
    return;
  }
  const loading = element('div', 'cad-empty-stage', 'Loading verified ASCII STL…');
  ui.mesh.append(loading);
  void (async () => {
    try {
      const response = await fetch(build.mesh_url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Mesh request failed with status ' + response.status);
      const text = await response.text();
      if (text.length > 12 * 1024 * 1024) throw new Error('Interactive CAD mesh is limited to 12 MiB.');
      if (!ui?.mesh.isConnected || selectedBuildId !== build.build_id) return;
      ui.mesh.replaceChildren();
      context.openMesh(ui.mesh, {
        kind: 'cad-project',
        record_id: projectDetail.descriptor.cad_project_id,
        name: projectDetail.descriptor.name + ' · ' + compact(build.build_id, 32),
        url: build.mesh_url
      }, text, 'stl');
    } catch (error) {
      if (ui?.mesh) ui.mesh.replaceChildren(element('div', 'cad-empty-stage error', error.message));
    }
  })();
}

function renderReports(build) {
  ui.buildMetrics.replaceChildren();
  if (!build) {
    ui.buildMetrics.append(element('p', 'cad-muted', 'No build selected.'));
    return;
  }
  const geometry = build.mesh?.geometry;
  ui.buildMetrics.append(
    metric('Status', build.status),
    metric('Engine', build.engine ?? 'openscad'),
    metric('Integrity', build.verified ? 'verified' : 'attention'),
    metric('Triangles', build.mesh?.triangles ?? '—'),
    metric('Watertight', build.mesh?.topology?.watertight ? 'yes' : 'no'),
    metric('Size', geometry?.bounding_box?.size?.join(' × ') + ' mm'),
    metric('Volume', geometry?.volume_mm3 != null ? geometry.volume_mm3 + ' mm³' : '—')
  );
  ui.buildArtifacts.replaceChildren();
  for (const artifact of build.artifacts ?? []) {
    if (!['assembly.stl', 'assembly.step'].includes(artifact.name)) continue;
    const link = element('a', 'quiet-button',
      artifact.name === 'assembly.step' ? 'Download engineering STEP' : 'Download verified STL');
    link.href = artifact.url;
    link.download = artifact.name;
    ui.buildArtifacts.append(link);
  }
  ui.reportJson.textContent = JSON.stringify({
    engine: build.engine ?? 'openscad',
    cadquery: build.cadquery_report ?? null,
    topology: build.mesh?.topology ?? null,
    geometry: build.mesh?.geometry ?? null,
    printability_indicators: build.mesh?.printability_indicators ?? null,
    limitations: build.mesh?.limitations ?? [],
    failure: build.failure ?? null
  }, null, 2);
}

async function inspectModelField(record, artifact) {
  if (!artifact?.url || !ui) return;
  const simulationId = record.simulation_id;
  ui.mesh.replaceChildren(
    element('div', 'cad-empty-stage', 'Loading recorded scalar field…')
  );
  try {
    const response = await fetch(artifact.url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Scalar-field request failed with status ' + response.status);
    }
    const text = await response.text();
    if (text.length > 12 * 1024 * 1024) {
      throw new Error('Interactive CAD scalar fields are limited to 12 MiB.');
    }
    if (!ui?.mesh.isConnected ||
        !currentPhysicsSimulations().some((item) =>
          item.simulation_id === simulationId)) return;
    ui.mesh.replaceChildren();
    context.openMesh(ui.mesh, {
      kind: 'simulation',
      record_id: simulationId,
      name: artifact.name,
      url: artifact.url
    }, text, 'ply');
  } catch (error) {
    if (ui?.mesh) {
      ui.mesh.replaceChildren(element('div', 'cad-empty-stage error', error.message));
    }
  }
}

function studyAggregateText(record) {
  const aggregates = Object.entries(record.review?.numeric_aggregates ?? {});
  if (!aggregates.length) return 'No scalar final statistics were reported by the model.';
  return aggregates.slice(0, 4).map(([name, value]) => {
    const minimum = Number.isFinite(value?.min) ? Number(value.min).toPrecision(5) : '—';
    const maximum = Number.isFinite(value?.max) ? Number(value.max).toPrecision(5) : '—';
    const mean = Number.isFinite(value?.mean) ? Number(value.mean).toPrecision(5) : '—';
    return name + ' ' + minimum + '–' + maximum + ' (mean ' + mean + ')';
  }).join(' · ');
}

async function shareStudyWithAi(record) {
  if (!ui.chat.value || !context.saveInteraction) {
    context.notify('Select a chat session before sharing this study with the AI.');
    return;
  }
  const parameterNames = [...new Set((record.results ?? []).flatMap((result) =>
    Object.keys(result.parameters ?? {})))].sort();
  try {
    await context.saveInteraction('cad', 'study.compared', {
      kind: 'experiment',
      record_id: record.experiment_id,
      name: record.name ?? record.experiment_id,
      url: '/api/experiments/' + encodeURIComponent(record.experiment_id)
    }, {
      cad_project_id: selectedProjectId,
      build_id: record.cad_parent?.build_id ?? selectedBuildId,
      experiment_id: record.experiment_id,
      status: record.status,
      planned_branches: record.counts?.planned ?? 0,
      completed_branches: record.counts?.completed ?? 0,
      verified_branches: record.counts?.verified ?? 0,
      review_verdict: record.review?.verdict ?? null,
      parameters_compared: parameterNames,
      numeric_aggregates: record.review?.numeric_aggregates ?? {},
      note: record.status === 'cancelled'
        ? 'The user shared this verified but incomplete CAD parameter study. Treat completed branches as partial evidence and untouched branches as not run.'
        : 'The user shared this verified CAD parameter comparison from the interactive workspace.'
    });
    await context.refreshHarness?.(ui.chat.value);
    context.notify(record.status === 'cancelled'
      ? 'The verified partial CAD study is now visible to the AI harness.'
      : 'The verified CAD comparison is now visible to the AI harness.');
  } catch (error) {
    context.notify(error.message);
  }
}

function renderSimulationHistory() {
  ui.simulationHistory.replaceChildren();
  const records = currentSimulations().filter((item) =>
    !selectedBuildId || item.build_id === selectedBuildId);
  const modeled = currentPhysicsSimulations();
  const studies = currentStudies();
  if (!records.length && !modeled.length && !studies.length) {
    ui.simulationHistory.append(element('p', 'cad-muted',
      'No geometry screen, linked CPU/GPU model, or comparative study recorded for this build.'));
    return;
  }
  for (const record of records) {
    const card = element('article', 'cad-result-card ' + record.status);
    const output = record.report?.outputs ?? {};
    card.append(
      statusPill(record.status),
      element('strong', '', 'Deterministic geometry screen'),
      element('span', '', formatDate(record.created_at)),
      element('p', '', 'Estimated mass ' + String(output.estimated_mass_g ?? '—') +
        ' g · build-volume fit ' + String(output.build_volume_dimension_fit ?? '—') +
        ' · topology ' + String(output.topology_pass ?? '—')),
      element('small', '', 'Not FEA, dynamics, thermal, fatigue, tolerance, or printer certification.')
    );
    ui.simulationHistory.append(card);
  }
  for (const record of modeled) {
    const card = element('article', 'cad-result-card ' + record.status);
    const selectedDevice = record.device?.selected ?? record.device?.name ?? 'device not reported';
    const thermal = record.summary?.classification ===
      'surface_graph_heat_diffusion_not_volumetric_fea';
    const temperatureField = (record.artifacts ?? []).find((artifact) =>
      artifact.name === 'temperature-field.ply');
    const final = record.summary?.final ?? {};
    card.append(
      statusPill(record.status),
      element('strong', '', thermal
        ? 'Interactive surface temperature field'
        : 'Recorded CAD-linked model'),
      element('span', '', formatDate(record.finished_at ?? record.started_at)),
      element('p', '', thermal
        ? 'Range ' + String(final.minimum_c ?? '—') + '–' +
          String(final.maximum_c ?? '—') + ' °C · mean ' +
          String(final.mean_c ?? '—') + ' °C · ' + selectedDevice
        : compact(record.script, 90) + ' · ' + selectedDevice +
          ' · seed ' + String(record.seed ?? '—')),
      element('small', '',
        thermal
          ? 'Bounded surface-graph diffusion on the immutable mesh; not volumetric heat conduction, FEA, material validation, or thermal-safety certification.'
          : 'Model-dependent CPU/GPU result with an immutable mesh parent; inspect equations, material data, boundary conditions, convergence, and limitations.')
    );
    if (thermal && temperatureField) {
      card.append(button('Open interactive temperature field', 'share-button',
        () => void inspectModelField(record, temperatureField)));
    }
    const open = element('a', 'quiet-button', 'Inspect recorded simulation');
    open.href = '/api/simulations/' + encodeURIComponent(record.simulation_id);
    card.append(open);
    ui.simulationHistory.append(card);
  }
  for (const record of studies) {
    const card = element('article', 'cad-result-card cad-study-card ' + record.status);
    const counts = record.counts ?? {};
    card.append(
      statusPill(record.status),
      element('strong', '', record.name ?? 'Comparative CAD parameter study'),
      element('span', '', formatDate(record.finished_at ?? record.started_at)),
      element('p', '', String(counts.completed ?? 0) + '/' +
        String(counts.planned ?? 0) + ' branches completed · ' +
        String(counts.verified ?? 0) + ' verified · reviewer ' +
        String(record.review?.verdict ?? 'not available')),
      element('p', 'cad-study-aggregate',
        (record.status === 'cancelled' ? 'Partial aggregate only · ' : '') +
          studyAggregateText(record)),
      element('small', '',
        'Every branch is bound to the same immutable mesh. Comparisons inherit the model’s assumptions and do not establish FEA, material validation, or manufacturing safety.')
    );
    if (record.status === 'cancelled') {
      card.append(element('p', 'cad-study-cancellation',
        'Stopped at ' + formatDate(record.cancellation?.cancelled_at) +
        ' · reason ' + String(record.cancellation?.reason ?? 'not reported')
          .replaceAll('_', ' ') +
        '. Completed and interrupted branches remain inspectable; untouched branches are explicitly not run.'));
    }
    const details = element('details', 'cad-study-details');
    const summary = element('summary', '', 'Inspect branch parameters and outcomes');
    details.append(summary);
    for (const result of record.results ?? []) {
      const row = element('div', 'cad-study-branch');
      const branchState = element('span', 'cad-study-branch-state');
      branchState.append(
        statusPill(result.status),
        element('small', '', result.verified ? 'integrity verified' : 'not verified')
      );
      row.append(
        branchState,
        element('code', '', compact(JSON.stringify(result.parameters ?? {}), 180)),
        element('span', '', compact(JSON.stringify(result.final_statistics ?? {}), 180))
      );
      const simulation = modeled.find((item) =>
        item.simulation_id === result.simulation_id);
      const temperatureField = simulation?.artifacts?.find((artifact) =>
        artifact.name === 'temperature-field.ply');
      if (simulation && temperatureField) {
        row.append(button('Open branch field', 'quiet-button',
          () => void inspectModelField(simulation, temperatureField)));
      }
      details.append(row);
    }
    card.append(details, button(record.status === 'cancelled'
      ? 'Share partial study with AI' : 'Share comparison with AI', 'share-button',
      () => void shareStudyWithAi(record)));
    const open = element('a', 'quiet-button', 'Inspect experiment record');
    open.href = '/api/experiments/' + encodeURIComponent(record.experiment_id);
    card.append(open);
    ui.simulationHistory.append(card);
  }
}

async function inspectGcode(record) {
  if (!record.gcode_url) return;
  try {
    const response = await fetch(record.gcode_url, { cache: 'no-store' });
    if (!response.ok) throw new Error('G-code request failed with status ' + response.status);
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new Error('Interactive G-code inspection is limited to 8 MiB.');
    ui.gcode.replaceChildren();
    context.openCode(ui.gcode, {
      kind: 'cad-slice',
      record_id: record.slice_id,
      name: 'preview.gcode',
      url: record.gcode_url
    }, text);
  } catch (error) {
    context.notify(error.message);
  }
}

function renderSliceHistory() {
  ui.sliceHistory.replaceChildren();
  const records = currentSlices().filter((item) =>
    !selectedBuildId || item.build_id === selectedBuildId);
  if (!records.length) {
    ui.sliceHistory.append(element('p', 'cad-muted', 'No slice recorded for this build.'));
    return;
  }
  for (const record of records) {
    const card = element('article', 'cad-result-card ' + record.status);
    const indicators = record.analysis?.physical_command_indicators ?? {};
    card.append(
      statusPill(record.status),
      element('strong', '', String(record.mode ?? 'preview') + ' G-code'),
      element('span', '', formatDate(record.created_at)),
      element('p', '', String(record.analysis?.layers ?? 0) + ' layers · ' +
        String(record.analysis?.motion_moves ?? 0) + ' moves · heaters ' +
        String(indicators.heater_commands ?? 0) + ' · extrusion moves ' +
        String(record.analysis?.positive_extrusion_moves ?? 0)),
      element('small', '', 'Printer transmission disabled · post-process disabled')
    );
    if (record.gcode_url) {
      card.append(button('Inspect immutable G-code', 'quiet-button', () => void inspectGcode(record)));
    }
    ui.sliceHistory.append(card);
  }
}

function renderBuildSelection() {
  const builds = currentBuilds();
  ui.buildSelect.replaceChildren();
  if (!builds.length) {
    const option = element('option', '', 'No builds yet');
    option.value = '';
    ui.buildSelect.append(option);
    ui.buildSelect.disabled = true;
    selectedBuildId = null;
  } else {
    ui.buildSelect.disabled = false;
    for (const build of builds) {
      const option = element('option', '', compact(build.build_id, 34) + ' · ' + build.status);
      option.value = build.build_id;
      ui.buildSelect.append(option);
    }
    if (!builds.some((build) => build.build_id === selectedBuildId)) {
      selectedBuildId = builds.find((build) => build.status === 'completed')?.build_id ??
        builds[0].build_id;
    }
    ui.buildSelect.value = selectedBuildId;
  }
  const build = builds.find((item) => item.build_id === selectedBuildId) ?? null;
  renderReports(build);
  renderMesh(build);
  renderSimulationHistory();
  renderSliceHistory();
}

async function loadProject(projectId) {
  if (!projectId || !ui) return;
  const token = Symbol('cad-project-load');
  loadProject.token = token;
  ui.editor.value = '';
  ui.fileTitle.textContent = 'Loading source tree…';
  try {
    const { payload } = await context.request(
      '/api/cad/projects/' + encodeURIComponent(projectId)
    );
    if (loadProject.token !== token || !ui?.workspace.isConnected) return;
    projectDetail = payload;
    selectedProjectId = projectId;
    updateUrl(projectId);
    renderProjectFacts();
    renderFileRail();
    renderBuildSelection();
    const file = payload.descriptor.files.includes(selectedFile)
      ? selectedFile : payload.descriptor.entry;
    await loadSource(file, { share: false });
  } catch (error) {
    context.notify(error.message);
  }
}

function buildWorkspace() {
  const workspace = element('section', 'cad-workspace');
  const head = element('header', 'cad-workspace-head');
  const copy = element('div');
  copy.append(
    element('span', 'section-kicker', 'PARAMETRIC DESIGN + PRINT PREPARATION'),
    element('h2', '', 'Multi-file CAD engineering workspace'),
    element('p', '', 'Edit declared OpenSCAD or CadQuery sources, build immutable STL/STEP artifacts, rotate and inspect meshes, run bounded models, and prepare non-transmitted slices.')
  );
  const safety = element('div', 'cad-safety-badges');
  safety.append(statusPill('project_only'), statusPill('no_printer_link'),
    statusPill('post_process_off'));
  head.append(copy, safety);
  workspace.append(head);

  const setup = element('section', 'cad-setup');
  const projectSelect = element('select', 'cad-control');
  const projects = context.state?.cad_projects ?? [];
  if (!projects.length) {
    const option = element('option', '', 'No CAD environment yet');
    option.value = '';
    projectSelect.append(option);
    projectSelect.disabled = true;
  } else {
    for (const project of projects) {
      const option = element('option', '', project.name + ' · ' +
        (project.healthy ? 'healthy' : 'attention'));
      option.value = project.cad_project_id;
      projectSelect.append(option);
    }
    if (!projects.some((project) => project.cad_project_id === selectedProjectId)) {
      selectedProjectId = projects[0].cad_project_id;
    }
    projectSelect.value = selectedProjectId;
  }
  const newName = element('input', 'cad-control');
  newName.placeholder = 'New environment name';
  newName.maxLength = 240;
  const newId = element('input', 'cad-control');
  newId.placeholder = 'Optional cad-project-id';
  newId.maxLength = 80;
  const newEngine = element('select', 'cad-control');
  for (const [value, label] of [
    ['openscad', 'OpenSCAD · declarative'],
    ['cadquery', 'CadQuery · Python + STEP']
  ]) {
    const option = element('option', '', label); option.value = value; newEngine.append(option);
  }
  const chat = element('select', 'cad-control');
  chatOptions(chat);
  const createButton = button('Create parametric environment', 'share-button');
  setup.append(projectSelect, newName, newId, newEngine, chat, createButton);
  workspace.append(setup);

  const facts = element('div', 'cad-project-facts');
  const parts = element('div', 'cad-parts');
  workspace.append(facts, parts);

  const source = element('section', 'cad-source-workspace');
  const fileRail = element('nav', 'cad-file-rail');
  const editorPanel = element('div', 'cad-editor-panel');
  const editorHead = element('header', 'cad-editor-head');
  const fileCopy = element('div');
  const fileTitle = element('strong', '', 'Select a source');
  const fileMeta = element('small', '', 'Conflict-safe saves use the opened SHA-256.');
  fileCopy.append(fileTitle, fileMeta);
  const save = button('Save source + revision', 'share-button');
  save.disabled = true;
  editorHead.append(fileCopy, save);
  const editor = element('textarea', 'cad-source-editor');
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'Editable parametric CAD source');
  const note = element('textarea', 'cad-control cad-note');
  note.rows = 2;
  note.maxLength = 2000;
  note.placeholder = 'Optional direction for the next Scientist turn…';
  editorPanel.append(editorHead, editor, note);
  source.append(fileRail, editorPanel);
  workspace.append(source);

  const actionBar = element('section', 'cad-action-bar');
  const build = button('Render OpenSCAD snapshot', 'run-button');
  const buildSelect = element('select', 'cad-control cad-build-select');
  const simulate = button('Run geometry screen', 'secondary-button');
  const density = element('input', 'cad-control');
  density.type = 'number'; density.min = '0.000001'; density.max = '100'; density.step = '0.01'; density.value = '1.24';
  density.title = 'Uniform density in grams per cubic centimeter';
  const overhang = element('input', 'cad-control');
  overhang.type = 'number'; overhang.min = '0'; overhang.max = '1'; overhang.step = '0.01'; overhang.value = '0.15';
  overhang.title = 'Maximum severe overhang area fraction';
  actionBar.append(build, buildSelect, simulate,
    element('span', 'cad-inline-label', 'density g/cm³'), density,
    element('span', 'cad-inline-label', 'overhang limit'), overhang);
  workspace.append(actionBar);

  const design = element('section', 'cad-design-grid');
  const meshPanel = element('div', 'cad-mesh-panel');
  meshPanel.append(element('span', 'section-kicker', 'INTERACTIVE VERIFIED MESH'));
  const mesh = element('div', 'cad-mesh-host');
  meshPanel.append(mesh);
  const reportPanel = element('div', 'cad-report-panel');
  reportPanel.append(element('span', 'section-kicker', 'GEOMETRY + TOPOLOGY'));
  const buildMetrics = element('div', 'cad-build-metrics');
  const buildArtifacts = element('div', 'cad-build-artifacts');
  const reportJson = element('pre', 'cad-report-json');
  reportPanel.append(buildMetrics, buildArtifacts, reportJson);
  design.append(meshPanel, reportPanel);
  workspace.append(design);

  const downstream = element('section', 'cad-downstream-grid');
  const simulationPanel = element('section', 'cad-operation-panel');
  simulationPanel.append(element('span', 'section-kicker', 'SIMULATION LAYER'),
    element('h3', '', 'Geometry screen + recorded CPU/GPU models'),
    element('p', 'cad-muted',
      'Launch a project-relative Python model against the exact verified mesh. Equations, materials, boundary conditions, convergence, and interpretation remain model responsibilities.'));
  const modelControls = element('div', 'cad-model-controls');
  const modelPreset = element('select', 'cad-control');
  for (const [value, label] of [
    ['surface-thermal', 'Surface thermal field — interactive'],
    ['mesh-validation', 'Mesh geometry validation'],
    ['custom', 'Custom project script']
  ]) {
    const option = element('option', '', label);
    option.value = value;
    modelPreset.append(option);
  }
  modelPreset.value = 'surface-thermal';
  modelPreset.setAttribute('aria-label', 'CAD model preset');
  const modelInstall = button('Install / verify selected template', 'secondary-button');
  const modelScript = element('input', 'cad-control');
  modelScript.classList.add('cad-model-wide');
  modelScript.placeholder = 'project-relative simulation.py';
  modelScript.value = 'simulations/cad-surface-heat.py';
  modelScript.setAttribute('aria-label', 'CAD model script');
  const modelDevice = element('select', 'cad-control');
  for (const [value, label] of [
    ['cpu', 'CPU — safe default'],
    ['auto', 'Auto-select compute device'],
    ['cuda', 'CUDA GPU — check free memory first']
  ]) {
    const option = element('option', '', label);
    option.value = value;
    modelDevice.append(option);
  }
  const modelSeed = element('input', 'cad-control');
  modelSeed.type = 'number'; modelSeed.min = '0'; modelSeed.max = '4294967295';
  modelSeed.step = '1'; modelSeed.value = '17';
  modelSeed.setAttribute('aria-label', 'CAD model seed');
  const modelTimeout = element('input', 'cad-control');
  modelTimeout.type = 'number'; modelTimeout.min = '1'; modelTimeout.max = '86400';
  modelTimeout.step = '1'; modelTimeout.value = '3600';
  modelTimeout.setAttribute('aria-label', 'CAD model timeout seconds');
  const modelGpuReserve = element('input', 'cad-control');
  modelGpuReserve.type = 'number'; modelGpuReserve.min = '256';
  modelGpuReserve.max = '16384'; modelGpuReserve.step = '256';
  modelGpuReserve.value = '2048';
  modelGpuReserve.setAttribute('aria-label', 'Minimum free GPU memory MiB');
  const modelParameters = element('textarea', 'cad-control cad-model-json');
  modelParameters.rows = 3;
  modelParameters.value = JSON.stringify(
    CAD_MODEL_PRESETS['surface-thermal'].parameters, null, 2
  );
  modelParameters.setAttribute('aria-label', 'CAD model parameters JSON');
  const modelArgs = element('textarea', 'cad-control cad-model-json');
  modelArgs.rows = 2;
  modelArgs.value = '[]';
  modelArgs.setAttribute('aria-label', 'CAD model script arguments JSON');
  const modelInputs = element('textarea', 'cad-control cad-model-json');
  modelInputs.rows = 2;
  modelInputs.placeholder = 'Optional project-relative declared inputs, one per line';
  modelInputs.setAttribute('aria-label', 'CAD model declared inputs');
  const modelRun = button('Launch CAD-linked model', 'share-button');
  const modelStop = button('Stop model', 'secondary-button');
  modelStop.disabled = true;
  modelControls.append(
    labeledControl('Model preset', modelPreset, 'cad-model-preset'),
    modelInstall,
    modelScript,
    labeledControl('Device', modelDevice),
    labeledControl('Seed', modelSeed),
    labeledControl('Timeout s', modelTimeout),
    labeledControl('Min free GPU MiB', modelGpuReserve),
    labeledControl('Parameters JSON', modelParameters, 'cad-model-wide'),
    labeledControl('Script arguments JSON', modelArgs, 'cad-model-wide'),
    labeledControl('Additional declared inputs', modelInputs, 'cad-model-wide'),
    modelRun, modelStop
  );
  const defaults = studyPreset('surface-thermal');
  const studyPanel = element('details', 'cad-study-controls');
  studyPanel.append(element('summary', '', 'Comparative parameter study'));
  const studyGrid = element('div', 'cad-study-grid');
  const studyName = element('input', 'cad-control');
  studyName.value = 'CAD surface thermal sensitivity';
  studyName.setAttribute('aria-label', 'CAD study name');
  const studyHypothesis = element('textarea', 'cad-control cad-model-json');
  studyHypothesis.rows = 2;
  studyHypothesis.value =
    'Changing the normalized surface diffusivity changes the final mean field while the fixed boundary extrema remain pinned.';
  studyHypothesis.setAttribute('aria-label', 'CAD study hypothesis');
  const studyParameters = element('textarea', 'cad-control cad-model-json');
  studyParameters.rows = 4;
  studyParameters.value = JSON.stringify(defaults.parameters, null, 2);
  studyParameters.setAttribute('aria-label', 'CAD study fixed parameters JSON');
  const studyVariations = element('textarea', 'cad-control cad-model-json');
  studyVariations.rows = 3;
  studyVariations.value = JSON.stringify(defaults.variations, null, 2);
  studyVariations.setAttribute('aria-label', 'CAD study variations JSON');
  const studySeeds = element('textarea', 'cad-control cad-model-json');
  studySeeds.rows = 2;
  studySeeds.value = '[23]';
  studySeeds.setAttribute('aria-label', 'CAD study seeds JSON');
  const studyRun = button('Launch comparative CAD study', 'share-button');
  const studyStop = button('Stop study', 'secondary-button');
  studyStop.disabled = true;
  studyGrid.append(
    labeledControl('Study name', studyName, 'cad-model-wide'),
    labeledControl('Hypothesis', studyHypothesis, 'cad-model-wide'),
    labeledControl('Fixed parameters JSON', studyParameters, 'cad-model-wide'),
    labeledControl('Variations JSON', studyVariations, 'cad-model-wide'),
    labeledControl('Seeds JSON', studySeeds, 'cad-model-wide'),
    element('small', 'cad-study-note',
      'The Cartesian matrix is bounded to 64 branches. Each branch reuses this model script, device policy, timeout, arguments, inputs, and exact verified mesh. Stopping preserves completed and interrupted evidence and marks untouched branches not run.'),
    studyRun, studyStop
  );
  studyPanel.append(studyGrid);
  const simulationHistory = element('div', 'cad-result-list');
  simulationPanel.append(modelControls, studyPanel, simulationHistory);
  const slicerPanel = element('section', 'cad-operation-panel');
  slicerPanel.append(element('span', 'section-kicker', '3D PRINT SLICER'),
    element('h3', '', 'PrusaSlicer preparation'));
  const slicerControls = element('div', 'cad-slicer-controls');
  const sliceMode = element('select', 'cad-control');
  for (const [value, label] of [
    ['preview', 'Preview — no extrusion / zero temperature'],
    ['printer-profile', 'Printer profile — physical review required']
  ]) {
    const option = element('option', '', label); option.value = value; sliceMode.append(option);
  }
  const layerHeight = element('input', 'cad-control'); layerHeight.type = 'number'; layerHeight.value = '0.2'; layerHeight.step = '0.01';
  const nozzle = element('input', 'cad-control'); nozzle.type = 'number'; nozzle.value = '0.4'; nozzle.step = '0.05';
  const filament = element('input', 'cad-control'); filament.type = 'number'; filament.value = '1.75'; filament.step = '0.01';
  const infill = element('input', 'cad-control'); infill.type = 'number'; infill.value = '15'; infill.min = '0'; infill.max = '100';
  const threads = element('input', 'cad-control'); threads.type = 'number'; threads.value = '2'; threads.min = '1'; threads.max = '8';
  const profile = element('input', 'cad-control'); profile.placeholder = 'project-relative printer.ini'; profile.disabled = true;
  const ackLabel = element('label', 'cad-physical-ack');
  const physicalAck = document.createElement('input'); physicalAck.type = 'checkbox'; physicalAck.disabled = true;
  ackLabel.append(physicalAck, element('span', '', 'I acknowledge this profile can generate physical machine-control data.'));
  const slice = button('Generate bounded slice', 'share-button');
  slicerControls.append(sliceMode,
    element('label', '', 'Layer mm'), layerHeight,
    element('label', '', 'Nozzle mm'), nozzle,
    element('label', '', 'Filament mm'), filament,
    element('label', '', 'Infill %'), infill,
    element('label', '', 'Threads'), threads,
    profile, ackLabel, slice);
  const sliceHistory = element('div', 'cad-result-list');
  const gcode = element('div', 'cad-gcode-host');
  slicerPanel.append(slicerControls, sliceHistory, gcode);
  downstream.append(simulationPanel, slicerPanel);
  workspace.append(downstream);

  const monitor = element('aside', 'cad-job-monitor');
  monitor.append(element('span', 'section-kicker', 'LIVE CAD PROVENANCE'));
  const jobStatus = element('p', 'cad-job-status ready', 'No active CAD operation');
  jobStatus.setAttribute('role', 'status');
  jobStatus.setAttribute('aria-live', 'polite');
  jobStatus.setAttribute('aria-atomic', 'true');
  const jobEvents = element('div', 'cad-job-events');
  monitor.append(jobStatus, jobEvents,
    element('small', 'cad-provenance-note',
      'Renders, geometry screens, and slices finish their provenance record. Model runs and comparative studies can be stopped; cancellation preserves a verifiable partial record.'));
  workspace.append(monitor);

  ui = {
    workspace, projectSelect, newName, newId, newEngine, chat, create: createButton,
    projectFacts: facts, parts, fileRail, fileTitle, fileMeta, editor, note, save,
    build, buildSelect, simulate, density, overhang, mesh, buildMetrics, buildArtifacts, reportJson,
    simulationHistory, modelPreset, modelInstall, modelScript, modelDevice, modelSeed, modelTimeout,
    modelGpuReserve, modelParameters, modelArgs, modelInputs, modelRun, modelStop,
    studyName, studyHypothesis, studyParameters, studyVariations, studySeeds, studyRun,
    studyStop, studyPanel,
    sliceMode, layerHeight, nozzle, filament, infill, threads,
    profile, physicalAck, slice, sliceHistory, gcode, jobStatus, jobEvents,
    mutationControls: [projectSelect, createButton, save, build, buildSelect, simulate,
      density, overhang, newEngine, modelPreset, modelInstall, modelScript,
      modelDevice, modelSeed, modelTimeout,
      modelGpuReserve, modelParameters, modelArgs, modelInputs, modelRun,
      studyName, studyHypothesis, studyParameters, studyVariations, studySeeds, studyRun,
      sliceMode, layerHeight, nozzle, filament, infill, threads,
      profile, physicalAck, slice]
  };
  createButton.addEventListener('click', () => void createProject());
  projectSelect.addEventListener('change', () => {
    selectedFile = null; selectedBuildId = null;
    void loadProject(projectSelect.value);
  });
  save.addEventListener('click', () => void saveSource());
  build.addEventListener('click', () => void startOperation('build'));
  simulate.addEventListener('click', () => void startOperation('simulate'));
  modelPreset.addEventListener('change', () => applyModelPreset(modelPreset.value));
  modelInstall.addEventListener('click', () => void installModelTemplate());
  modelRun.addEventListener('click', () => void startOperation('model'));
  studyRun.addEventListener('click', () => void startOperation('study'));
  modelStop.addEventListener('click', () => void cancelCadOperation('model'));
  studyStop.addEventListener('click', () => void cancelCadOperation('study'));
  slice.addEventListener('click', () => void startOperation('slice'));
  buildSelect.addEventListener('change', () => {
    selectedBuildId = buildSelect.value || null;
    renderBuildSelection();
    if (ui.chat.value && selectedBuildId && context.saveInteraction) {
      void context.saveInteraction('cad', 'build.selected', projectArtifact(), {
        cad_project_id: selectedProjectId,
        build_id: selectedBuildId,
        note: 'The user selected this immutable mesh build in the CAD workspace.'
      }, { quiet: true });
    }
  });
  sliceMode.addEventListener('change', () => {
    const physical = sliceMode.value === 'printer-profile';
    profile.disabled = !physical;
    physicalAck.disabled = !physical;
    if (!physical) physicalAck.checked = false;
  });
  return workspace;
}

export function recoverCadJob(state) {
  const recovered = state?.cad_jobs?.find((job) => ACTIVE_JOB_STATUSES.has(job.status)) ?? null;
  if (recovered) activeJob = recovered;
  return activeJob;
}

export function renderCadWorkspace(options) {
  context = options;
  const projects = options.state?.cad_projects ?? [];
  if (!projects.some((project) => project.cad_project_id === selectedProjectId)) {
    selectedProjectId = projects[0]?.cad_project_id ?? null;
    selectedFile = null;
    selectedBuildId = null;
  }
  const workspace = buildWorkspace();
  const recovered = recoverCadJob(options.state);
  renderJob(recovered);
  if (recovered) void pollJob(recovered.job_id);
  if (selectedProjectId) queueMicrotask(() => void loadProject(selectedProjectId));
  else {
    ui.mesh.append(element('div', 'cad-empty-stage',
      'Create a parametric environment to begin editing multiple OpenSCAD or CadQuery files.'));
  }
  return workspace;
}

export function currentCadProjectId() {
  return selectedProjectId;
}
