import { parseThreeD } from '/geometry.js';
import {
  chemicalPointToCanvas,
  fitChemicalView,
  nearestChemicalAtom,
  panChemicalView,
  parseChemicalDocument,
  zoomChemicalView
} from '/chemistry.js';
import {
  canvasToGenomePosition,
  fitGenomeView,
  genomePositionToCanvas,
  genomeTicks,
  panGenomeView,
  parseGenomeDocument,
  visibleGenomeFeatures,
  zoomGenomeView
} from '/genomics.js';
import { layoutLineage, lineageSubgraph, lineageTrace } from '/lineage.js';
import { openCampaign, renderCampaignWorkspace } from '/campaign.js';
import { renderCadWorkspace } from '/cad.js';
import {
  renderScientificComputeWorkspace,
  resumeScientificComputeJob
} from '/compute.js';
import { renderPreregistrationBuilder } from '/preregistration.js';
import { renderReproducibilityWorkspace } from '/reproducibility.js';
import { renderVerificationWorkspace } from '/verification.js';
import { defaultProcedureSpec, procedureDraftModel } from '/procedure.js';
import {
  boundedUtf8Excerpt,
  boundedManuscriptChanges,
  diffManuscript,
  manuscriptHunks
} from '/manuscript.js';
import {
  buildPlotSeries,
  canvasToFigurePoint,
  canvasToPlot,
  clampUnitPoint,
  figureLayout,
  figurePointToCanvas,
  fitPlotView,
  formatPlotNumber,
  nearestPlotPoint,
  panPlotView,
  plotToCanvas,
  zoomFigureView,
  zoomPlotView
} from '/visualization.js';

const elements = {
  connection: document.querySelector('#connection-status'),
  connectionLabel: document.querySelector('#connection-status .connection-label'),
  version: document.querySelector('#version-badge'),
  refresh: document.querySelector('#refresh-button'),
  project: document.querySelector('#project-label'),
  newChat: document.querySelector('#new-chat-button'),
  chatList: document.querySelector('#chat-list'),
  chatCount: document.querySelector('#chat-count'),
  campaignCount: document.querySelector('#campaign-count'),
  cadCount: document.querySelector('#cad-count'),
  experimentCount: document.querySelector('#experiment-count'),
  analysisCount: document.querySelector('#analysis-count'),
  procedureCount: document.querySelector('#procedure-count'),
  simulationCount: document.querySelector('#simulation-count'),
  inferenceCount: document.querySelector('#inference-count'),
  evidenceCount: document.querySelector('#evidence-count'),
  reviewCount: document.querySelector('#review-count'),
  notebookCount: document.querySelector('#notebook-count'),
  lineageCount: document.querySelector('#lineage-count'),
  snapshotCount: document.querySelector('#snapshot-count'),
  verificationCount: document.querySelector('#verification-count'),
  computeHealth: document.querySelector('#compute-health'),
  computeTitle: document.querySelector('#compute-title'),
  computeRuntime: document.querySelector('#compute-runtime'),
  memoryFill: document.querySelector('#memory-fill'),
  computeFacts: document.querySelector('#compute-facts'),
  mainStage: document.querySelector('#main-stage'),
  chatView: document.querySelector('#chat-view'),
  archiveView: document.querySelector('#archive-view'),
  backToChat: document.querySelector('#back-to-chat'),
  archiveKicker: document.querySelector('#archive-kicker'),
  archiveTitle: document.querySelector('#archive-title'),
  archiveSummary: document.querySelector('#archive-summary'),
  archiveList: document.querySelector('#archive-list'),
  recordDetail: document.querySelector('#record-detail'),
  chatTitle: document.querySelector('#chat-title'),
  chatStatus: document.querySelector('#chat-status'),
  chatMessages: document.querySelector('#chat-messages'),
  recordingIndicator: document.querySelector('#recording-indicator'),
  starterActions: document.querySelector('#starter-actions'),
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  agentSelect: document.querySelector('#agent-select'),
  send: document.querySelector('#send-button'),
  stop: document.querySelector('#stop-button'),
  harnessLive: document.querySelector('#harness-live'),
  harnessActivity: document.querySelector('#harness-activity'),
  harnessDesign: document.querySelector('#harness-design'),
  harnessOutcome: document.querySelector('#harness-outcome'),
  transcriptStatus: document.querySelector('#transcript-status'),
  transcriptHash: document.querySelector('#transcript-hash'),
  notice: document.querySelector('#notice')
};

let labState = null;
let activeChat = null;
let activeHarness = null;
let activeJob = null;
let pendingAssistant = null;
let activeInferenceJob = null;
let inferenceLauncherUi = null;
let inferencePollingJobId = null;
let chatBusy = false;
let stateBusy = true;
let stateReady = false;
let stateCurrent = false;
let draftConversation = false;
let selectedChat = new URLSearchParams(window.location.search).get('chat');
let activeView = 'chat';
let activeKernelLanguage = 'python';
let activeLineage = null;
let selectedLineageNode = null;
let lineageDirection = 'both';
let lineageSelectionTimer = null;
let lineageUi = null;
const observedPngSources = new Map();
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function compact(value, limit = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}

function formatDate(value) {
  if (!value) return 'not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(date);
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(date);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1000) return Math.round(milliseconds) + ' ms';
  if (milliseconds < 60000) return (milliseconds / 1000).toFixed(1) + ' s';
  return (milliseconds / 60000).toFixed(1) + ' min';
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { elements.notice.hidden = true; }, 7000);
}

function setConnection(mode, label) {
  elements.connection.className = 'connection ' + mode;
  elements.connectionLabel.textContent = label;
  elements.connection.setAttribute('aria-label', 'Connection status: ' + label);
  if (mode !== 'online') elements.connection.title = label;
}

function setIntegrityConnection() {
  if (!stateCurrent) {
    setConnection('error', 'State stale');
    elements.connection.title =
      'The latest project-state refresh failed. Retry before trusting updated counts or integrity.';
    return;
  }
  const integrityOk = labState?.audit?.ok === true;
  const reused = labState?.integrity_cache?.hit === true;
  setConnection(
    integrityOk ? 'online' : 'error',
    integrityOk ? (reused ? 'Local · verified snapshot' : 'Local · verified now')
      : 'Integrity warning'
  );
  elements.connection.title = integrityOk
    ? (reused
        ? 'Unchanged project metadata; reused the snapshot verified ' +
          formatDate(labState.integrity_cache?.verified_at) + '.'
        : 'Project records were fully verified for this state response.')
    : 'The project audit chain failed verification. Inspect the recorded errors before trusting results.';
}

function syncInteractionControls() {
  const unavailable = stateBusy || !stateReady;
  const blocked = unavailable || chatBusy;
  elements.refresh.disabled = stateBusy;
  elements.newChat.disabled = blocked;
  elements.send.disabled = blocked;
  elements.chatInput.disabled = blocked;
  elements.agentSelect.disabled = blocked || Boolean(activeChat?.manifest?.turn_count);
  for (const button of document.querySelectorAll('[data-view]')) {
    button.disabled = unavailable;
  }
  for (const button of document.querySelectorAll('.chat-item')) {
    button.disabled = blocked;
  }
  for (const button of elements.starterActions.querySelectorAll('[data-prompt]')) {
    button.disabled = blocked;
  }
}

function setStateBusy(value) {
  stateBusy = value;
  elements.mainStage.setAttribute('aria-busy', String(value));
  elements.chatMessages.setAttribute('aria-busy', String(value || chatBusy));
  syncInteractionControls();
}

function renderInitialStateFailure(message) {
  const state = create('div', 'initial-workspace-state error');
  state.append(
    create('strong', '', 'The local workspace could not be verified'),
    create('p', '', compact(message, 400)),
    create('small', '', 'Review the error, then use Refresh to try again.')
  );
  elements.chatMessages.replaceChildren(state);
  elements.starterActions.hidden = true;
  elements.chatTitle.textContent = 'Workspace unavailable';
  elements.chatStatus.className = 'run-state error';
  elements.chatStatus.querySelector('span').textContent = 'Unavailable';
}

function scrollElementIntoView(element, block = 'start') {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block });
}

function focusRecordDetail() {
  elements.recordDetail.focus({ preventScroll: true });
  scrollElementIntoView(elements.recordDetail);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) }
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? 'Request failed with status ' + response.status);
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return { response, payload };
}

function setHarnessLive(mode, label) {
  elements.harnessLive.className = 'harness-live ' + mode;
  elements.harnessLive.querySelector('span').textContent = label;
}

function updateJobControls(job = activeJob) {
  const visible = Boolean(chatBusy && job && ACTIVE_JOB_STATUSES.has(job.status));
  elements.stop.hidden = !visible;
  elements.stop.disabled = !visible || job?.status === 'cancelling';
  elements.stop.querySelector('span').textContent =
    job?.status === 'cancelling' ? 'Stopping' : 'Stop';
}

function setChatBusy(value, label = 'Working') {
  chatBusy = value;
  syncInteractionControls();
  elements.chatMessages.setAttribute('aria-busy', String(value || stateBusy));
  elements.send.querySelector('span').textContent = value ? 'Running' : 'Run';
  elements.chatStatus.className = 'run-state ' + (value ? 'working' : 'ready');
  elements.chatStatus.querySelector('span').textContent = value ? label : 'Ready';
  elements.recordingIndicator.textContent = value ? 'LIVE TRACE' : 'RECORDED';
  setHarnessLive(value ? 'working' : 'idle', value ? label : 'Idle');
  updateJobControls();
}

function updateChatUrl(chatId) {
  const url = new URL(window.location.href);
  if (chatId) url.searchParams.set('chat', chatId);
  else url.searchParams.delete('chat');
  window.history.replaceState({}, '', url);
}

function renderCompute() {
  const compute = labState?.compute;
  const gpu = compute?.gpu;
  const npu = compute?.npu;
  const gpuRuntime = compute?.runtimes?.gpu ?? compute?.runtime;
  const npuRuntime = compute?.runtimes?.npu;
  const currentGpu = gpu?.devices?.[0];
  const recordedGpu = gpuRuntime?.manifest?.probe?.torch?.devices?.[0];
  const gpuDevice = currentGpu ?? recordedGpu;
  const npuDevice = npu?.devices?.[0];
  const gpuReady = Boolean(gpu?.available && gpuRuntime?.healthy);
  const npuReady = Boolean(npu?.available && npuRuntime?.healthy);
  const readyCount = Number(gpuReady) + Number(npuReady);
  elements.computeHealth.textContent = gpuReady && npuReady ? 'GPU + NPU' :
    gpuReady ? 'GPU READY' : npuReady ? 'NPU READY' :
      (gpuDevice || npuDevice) ? 'OFFLINE' : 'CPU';
  elements.computeHealth.className = readyCount ? 'ready' :
    (gpuDevice || npuDevice) ? 'attention' : 'neutral';
  elements.computeTitle.textContent = readyCount === 2
    ? 'Dual-accelerator research stack'
    : gpuReady ? gpuDevice?.name ?? 'CUDA accelerator'
      : npuReady ? npuDevice?.name ?? 'Windows ML NPU'
        : gpuDevice?.name ?? npuDevice?.name ?? 'CPU scientific runtime';
  elements.computeRuntime.textContent = gpuReady && npuReady
    ? 'CUDA simulation/training and profiled Windows ML inference are available.'
    : gpuReady ? 'CUDA simulation/training is ready; the NPU runtime needs attention.'
      : npuReady ? 'Windows ML NPU inference is ready; CUDA is unavailable.'
        : 'No isolated accelerator runtime is currently ready.';
  const total = currentGpu?.memory_total_mib;
  const free = currentGpu?.memory_free_mib;
  const used = Number.isFinite(total) && total > 0 && Number.isFinite(free)
    ? Math.max(0, Math.min(100, ((total - free) / total) * 100)) : gpuReady ? 18 : 0;
  elements.memoryFill.style.width = used + '%';
  elements.computeFacts.replaceChildren();
  const facts = [
    ['GPU', gpuReady ? compact(gpuDevice?.name ?? 'ready', 24) : 'not ready'],
    ['CUDA', gpuRuntime?.probe?.torch?.cuda_runtime ??
      gpuRuntime?.manifest?.probe?.torch?.cuda_runtime ?? '—'],
    ['NPU', npuReady ? compact(npuDevice?.name ?? 'ready', 24) : 'not ready'],
    ['NPU EP', npuRuntime?.healthy ? 'Vitis AI' :
      npu?.execution_provider?.package_present ? 'package present' : 'not ready']
  ];
  for (const [label, value] of facts) {
    const row = create('span');
    row.append(create('small', '', label), create('b', '', value));
    elements.computeFacts.append(row);
  }
}

function renderSidebar() {
  elements.project.textContent = labState?.project?.name ?? 'ScienceCode local project';
  elements.chatCount.textContent = String(labState?.counts?.chats ?? 0);
  elements.campaignCount.textContent = String(labState?.counts?.campaigns ?? 0);
  elements.cadCount.textContent = String(labState?.counts?.cad_projects ?? 0);
  elements.experimentCount.textContent = String(labState?.counts?.experiments ?? 0);
  elements.analysisCount.textContent = String(
    (labState?.counts?.analysis_contracts ?? 0) +
    (labState?.counts?.current_confirmatory_assessments ?? 0)
  );
  elements.procedureCount.textContent = String(
    (labState?.counts?.current_procedures ?? 0) +
    (labState?.counts?.current_procedure_assessments ?? 0)
  );
  elements.simulationCount.textContent = String(labState?.counts?.simulations ?? 0);
  elements.inferenceCount.textContent = String(labState?.counts?.inferences ?? 0);
  elements.evidenceCount.textContent = String(labState?.counts?.evidence ?? 0);
  elements.reviewCount.textContent = String(labState?.counts?.semantic_reviews ?? 0);
  elements.notebookCount.textContent = String(labState?.counts?.kernel_cells ?? 0);
  renderSnapshotCount();
  renderVerificationCount();
  renderCompute();
  renderChatList();
}

function renderSnapshotCount() {
  const job = labState?.project_snapshot_job;
  elements.snapshotCount.textContent = ACTIVE_JOB_STATUSES.has(job?.status)
    ? '\u2026'
    : String(labState?.counts?.project_snapshots ?? 0);
  elements.snapshotCount.title = labState?.counts?.project_snapshot_registry_issues
    ? 'Snapshot registry integrity requires attention.'
    : '';
}

function renderVerificationCount() {
  const gate = labState?.project_gate_job;
  elements.verificationCount.textContent = ACTIVE_JOB_STATUSES.has(gate?.status)
    ? '\u2026'
    : gate?.status === 'completed'
      ? gate.result?.ok ? 'PASS' : String(gate.result?.summary?.blockers ?? '!')
      : gate ? '!' : '\u2014';
}

function renderChatList() {
  elements.chatList.replaceChildren();
  const chats = labState?.chats ?? [];
  if (!chats.length) {
    const empty = create('div', 'empty-list');
    empty.append(create('strong', '', 'No conversations yet'),
      create('p', '', 'Start with a research question. Every completed turn becomes a verifiable project record.'));
    elements.chatList.append(empty);
    return;
  }
  for (const chat of chats) {
    const button = create('button', 'chat-item' + (selectedChat === chat.chat_id ? ' active' : ''));
    button.type = 'button';
    button.disabled = stateBusy || chatBusy || !stateReady;
    const top = create('span', 'chat-item-top');
    top.append(create('strong', '', chat.title), create('em', '', String(chat.turn_count ?? 0)));
    button.append(top, create('small', '', formatDate(chat.updated_at)));
    button.addEventListener('click', () => selectChat(chat.chat_id));
    elements.chatList.append(button);
  }
}

function welcomeBlock() {
  const welcome = create('div', 'welcome-block');
  const mark = create('span', 'welcome-mark');
  mark.append(create('i'), create('i'), create('i'));
  welcome.append(mark, create('span', 'section-kicker', 'SCIENCECODE HARNESS'),
    create('h2', '', 'What are we investigating?'),
    create('p', '', 'The scientist can inspect code and evidence, delegate specialist reviews, run recorded computation, and leave a reproducible outcome. The right panel shows the real work trace.'));
  return welcome;
}

function linkedRecordButton(record) {
  const id = record.campaign_id ?? record.simulation_id ?? record.inference_id ?? record.experiment_id ?? record.preregistration_id ??
    record.retrieval_id ?? record.run_id;
  const button = create('button', 'output-chip',
    record.type.replaceAll('.', ' ') + (id ? ' · ' + compact(id, 24) : ''));
  button.type = 'button';
  if (record.campaign_id) button.addEventListener('click', () => showArchive('campaigns', record.campaign_id));
  else if (record.simulation_id) button.addEventListener('click', () => showArchive('simulations', record.simulation_id));
  else if (record.inference_id) button.addEventListener('click', () => showArchive('inferences', record.inference_id));
  else if (record.experiment_id) button.addEventListener('click', () => showArchive('experiments', record.experiment_id));
  else if (record.retrieval_id) button.addEventListener('click', () => showArchive('evidence'));
  else button.disabled = true;
  return button;
}

function messageBlock(role, text, turn) {
  const block = create('article', 'message ' + role);
  const head = create('header');
  const avatar = create('span', 'message-avatar', role === 'user' ? 'YOU' : 'SC');
  const identity = create('span');
  identity.append(create('strong', '', role === 'user' ? 'You' : 'ScienceCode'),
    create('small', '', role === 'user' ? 'Research direction' : (turn?.agent ?? 'scientist') + ' · recorded'));
  head.append(avatar, identity);
  block.append(head, create('div', 'message-body',
    text || (role === 'assistant' ? 'No response text was recorded.' : '')));
  if (role === 'assistant' && turn) {
    if (turn.error) block.append(create('pre', 'message-error', turn.error));
    if (turn.linked_records?.length) {
      const outputs = create('div', 'linked-outputs');
      outputs.append(create('span', '', 'LINKED OUTPUTS'));
      for (const record of turn.linked_records) outputs.append(linkedRecordButton(record));
      block.append(outputs);
    }
    const metadata = create('footer', 'message-meta');
    metadata.append(create('span', 'status ' + turn.status, String(turn.status).toUpperCase()),
      create('span', '', 'run ' + compact(turn.run_id, 18)),
      create('span', '', (turn.events?.types?.tool_use ?? 0) + ' tools'),
      create('span', '', formatDuration(new Date(turn.finished_at) - new Date(turn.started_at))));
    const changed = [...(turn.changes?.added ?? []), ...(turn.changes?.modified ?? []), ...(turn.changes?.missing ?? [])];
    if (changed.length) metadata.append(create('span', '', changed.length + ' file changes'));
    block.append(metadata);
  }
  return block;
}

function renderConversation() {
  pendingAssistant = null;
  elements.chatMessages.replaceChildren();
  const turns = activeChat?.turns ?? [];
  if (!turns.length) {
    elements.chatMessages.append(welcomeBlock());
    elements.starterActions.hidden = false;
    elements.chatTitle.textContent = 'New research conversation';
    elements.transcriptStatus.textContent = 'NO TRANSCRIPT';
    elements.transcriptHash.textContent = 'waiting for a recorded turn';
    return;
  }
  elements.starterActions.hidden = true;
  elements.chatTitle.textContent = activeChat.manifest.title;
  for (const turn of turns) {
    elements.chatMessages.append(messageBlock('user', turn.user?.text ?? '', turn),
      messageBlock('assistant', turn.assistant?.text ?? '', turn));
  }
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  const verified = Boolean(activeChat.verification?.ok);
  elements.transcriptStatus.textContent = verified ? 'VERIFIED TRANSCRIPT' : 'TRANSCRIPT NEEDS REVIEW';
  elements.transcriptStatus.className = verified ? 'verified' : 'attention';
  elements.transcriptHash.textContent = activeChat.manifest.turn_head_sha256 ?? 'no transcript head';
}

function renderPendingMessage(message) {
  elements.starterActions.hidden = true;
  const assistant = messageBlock(
    'assistant',
    'Supervisor is framing the goal and dispatching the recorded scientist…'
  );
  assistant.classList.add('pending');
  const body = assistant.querySelector('.message-body');
  const identity = assistant.querySelector('header small');
  const metadata = create('footer', 'live-response-meta',
    'Waiting for the first completed OpenCode response block');
  body.setAttribute('aria-live', 'polite');
  body.setAttribute('aria-busy', 'true');
  assistant.append(metadata);
  pendingAssistant = { block: assistant, body, identity, metadata, rendered: null };
  elements.chatMessages.append(messageBlock('user', message), assistant);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function updatePendingResponse(job) {
  if (!pendingAssistant || !job) return;
  const response = job.response;
  const blocks = Array.isArray(response?.blocks)
    ? response.blocks.filter((block) => typeof block?.content === 'string' && block.content)
    : [];
  const omitted = Number(response?.omitted_block_count ?? 0);
  const prefix = omitted
    ? '[Earlier live response blocks were omitted from this bounded preview.]\n\n'
    : '';
  const text = prefix + blocks.map((block) => block.content).join('\n\n');
  const follow = elements.chatMessages.scrollHeight -
    elements.chatMessages.scrollTop -
    elements.chatMessages.clientHeight < 96;
  if (text && text !== pendingAssistant.rendered) {
    pendingAssistant.body.textContent = text;
    pendingAssistant.rendered = text;
    pendingAssistant.block.classList.add('has-live-response');
  } else if (!text && ACTIVE_JOB_STATUSES.has(job.status)) {
    const latest = job.events?.at(-1)?.title;
    if (latest && latest !== pendingAssistant.rendered) {
      pendingAssistant.body.textContent = latest + '…';
      pendingAssistant.rendered = latest;
    }
  }
  const retained = Number(response?.retained_block_count ?? blocks.length);
  pendingAssistant.identity.textContent = retained
    ? 'scientist · live OpenCode response'
    : 'scientist · recorded harness running';
  const status = String(job.status ?? 'running').toUpperCase();
  const blockLabel = retained + ' response block' + (retained === 1 ? '' : 's');
  pendingAssistant.metadata.textContent = retained
    ? status + ' · ' + blockLabel + ' · bounded live preview; final answer is recorded on completion'
    : status + ' · waiting for a completed response block';
  const terminal = !ACTIVE_JOB_STATUSES.has(job.status);
  pendingAssistant.body.setAttribute('aria-busy', String(!terminal));
  pendingAssistant.block.classList.toggle('terminal', terminal);
  if (follow) elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function emptyHarness() {
  elements.harnessActivity.replaceChildren();
  const empty = create('div', 'empty-harness');
  const mark = create('span', 'radar-mark');
  mark.append(create('i'));
  empty.append(mark, create('strong', '', 'No active work'),
    create('p', '', 'Run a scientific task to see the supervisor, real tool calls, recorded changes, and review gates here.'));
  elements.harnessActivity.append(empty);
  elements.harnessDesign.replaceChildren();
  elements.harnessOutcome.replaceChildren();
}

function eventBadge(event) {
  if (event.type === 'tool') return String(event.tool ?? 'tool').slice(0, 4).toUpperCase();
  if (event.type?.startsWith('reasoning')) return 'AI';
  if (event.type?.startsWith('response')) return 'TEXT';
  if (event.type?.startsWith('workspace')) return 'FILE';
  if (event.type?.startsWith('harness')) return 'PLAN';
  if (event.type?.startsWith('outcome')) return 'OUT';
  if (event.type?.includes('error') || event.type?.includes('warning')) return '!';
  return 'LOG';
}

function renderActivity(events) {
  elements.harnessActivity.replaceChildren();
  if (!events?.length) {
    const empty = create('div', 'empty-pane');
    empty.append(create('strong', '', 'No recorded activity'),
      create('p', '', 'Tool calls and harness decisions will appear here.'));
    elements.harnessActivity.append(empty);
    return;
  }
  const timeline = create('div', 'activity-timeline');
  for (const event of events.slice(-100)) {
    const row = create('article', 'activity-event ' + (event.status ?? 'recorded'));
    row.append(create('span', 'event-badge', eventBadge(event)));
    const body = create('div');
    const top = create('div', 'event-top');
    top.append(create('strong', '', event.title ?? event.type),
      create('time', '', formatTime(event.timestamp ?? event.started_at)));
    body.append(top, create('p', '', [
      event.tool ? 'tool ' + event.tool : null,
      event.status,
      event.run_id ? 'run ' + compact(event.run_id, 17) : null
    ].filter(Boolean).join(' · ')));
    row.append(body);
    timeline.append(row);
  }
  elements.harnessActivity.append(timeline);
  elements.harnessActivity.scrollTop = elements.harnessActivity.scrollHeight;
}

function statusPill(status) {
  return create('span', 'mini-status ' + status, String(status ?? 'unknown').replaceAll('_', ' '));
}

function boardCard(label, title) {
  const card = create('section', 'board-card');
  card.append(create('span', 'board-label', label), create('h3', '', title));
  return card;
}

function renderDesign(harness) {
  elements.harnessDesign.replaceChildren();
  if (!harness) {
    elements.harnessDesign.append(create('p', 'pane-placeholder',
      'The design board opens after the first research goal.'));
    return;
  }
  const overview = boardCard('CONTEXT OF USE', harness.workflow.label);
  const chips = create('div', 'context-chips');
  chips.append(create('span', '', harness.workflow.domain),
    create('span', 'risk ' + harness.workflow.risk, harness.workflow.risk + ' risk'),
    create('span', '', harness.workflow.physical_execution.replaceAll('_', ' ')));
  overview.append(chips, create('p', '', harness.workflow.context_of_use),
    create('blockquote', '', harness.goal.question));
  const knowledge = harness.workflow.knowledge;
  if (knowledge) {
    overview.append(create('p', 'context-grounding',
      'Grounded in ' + knowledge.principle_count + ' principles across ' +
      knowledge.layer_span.join(' → ') + '.'));
    if (knowledge.provisional_claims.length) {
      overview.append(create('p', 'context-grounding',
        'Provisional: ' + knowledge.provisional_claims.join(', ')));
    }
  }
  elements.harnessDesign.append(overview);

  const stages = boardCard('WORKFLOW', harness.stages.length + ' stage decision path');
  const list = create('ol', 'stage-list');
  for (const stage of harness.stages) {
    const item = create('li', stage.status);
    item.tabIndex = 0;
    item.title = 'Focus this stage for the next ScienceCode turn';
    const body = create('div');
    body.append(create('strong', '', stage.label), create('small', '', stage.owner));
    item.append(create('span', 'stage-marker'), body, statusPill(stage.status));
    const focusStage = () => saveInteraction('design', 'stage.focused', null, {
      stage: stage.id,
      label: stage.label,
      owner: stage.owner
    });
    item.addEventListener('click', focusStage);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        focusStage();
      }
    });
    list.append(item);
  }
  stages.append(list);
  elements.harnessDesign.append(stages);

  const agents = boardCard('SPECIALIST LANES', 'Scientific work queue');
  const agentList = create('div', 'agent-lanes');
  for (const agent of harness.agents.filter((item) => item.included || item.status !== 'available')) {
    const row = create('div', 'agent-lane');
    const main = create('div');
    main.append(create('strong', '', agent.label), create('p', '', agent.role));
    row.append(main, statusPill(agent.status));
    agentList.append(row);
  }
  agents.append(agentList);
  elements.harnessDesign.append(agents);

  const campaigns = harness.board?.campaigns ?? [];
  const campaignCard = boardCard('RESEARCH CAMPAIGNS',
    campaigns.length
      ? campaigns.length + ' versioned plan' + (campaigns.length === 1 ? '' : 's')
      : 'No frozen plan');
  const campaignList = create('div', 'harness-campaign-list');
  if (!campaigns.length) {
    campaignList.append(create('p', 'pane-placeholder',
      'Freeze a falsifiable hypothesis tree to expose branch decisions, task dependencies, accelerator budgets, and human checkpoints here.'));
  }
  for (const campaign of campaigns.slice(-5).reverse()) {
    const row = create('button', 'harness-campaign-row ' + campaign.status);
    row.type = 'button';
    const copy = create('div');
    copy.append(
      create('strong', '', campaign.title),
      create('small', '',
        String(campaign.counts?.completed ?? 0) + '/' +
        String(campaign.tasks?.length ?? 0) + ' tasks · ' +
        String(campaign.budget?.used_gpu_tasks ?? 0) + '/' +
        String(campaign.budget?.max_gpu_tasks ?? 0) + ' GPU · ' +
        String(campaign.budget?.used_npu_tasks ?? 0) + '/' +
        String(campaign.budget?.max_npu_tasks ?? 0) + ' NPU'),
      create('small', '',
        String(campaign.hypothesis_counts?.assessment_current ??
          campaign.hypothesis_counts?.assessed ?? 0) + '/' +
        String(campaign.hypothesis_counts?.total ?? 0) + ' current verdicts · ' +
        String(campaign.hypothesis_counts?.assessment_required ?? 0) +
          ' human checkpoint' +
          ((campaign.hypothesis_counts?.assessment_required ?? 0) === 1 ? '' : 's') +
          ' due'),
      create('small', 'harness-campaign-next',
        campaign.next_task
          ? 'next · ' + campaign.next_task.title + ' · ' +
            String(campaign.next_task.status).replaceAll('_', ' ')
          : campaign.next_hypothesis
            ? 'human checkpoint · ' + campaign.next_hypothesis.hypothesis_id +
              ' · ' + String(campaign.next_hypothesis.verdict).replaceAll('_', ' ')
            : 'no pending task or branch checkpoint')
    );
    row.append(copy, statusPill(campaign.verified ? campaign.status : 'attention'));
    row.addEventListener('click', () =>
      showArchive('campaigns', campaign.campaign_id));
    campaignList.append(row);
  }
  const openCampaigns = create('button', 'quiet-button',
    campaigns.length ? 'Open campaign workspace' : 'Design a campaign');
  openCampaigns.type = 'button';
  openCampaigns.addEventListener('click', () => showArchive('campaigns'));
  campaignCard.append(campaignList, openCampaigns);
  elements.harnessDesign.append(campaignCard);

  const cad = harness.board?.cad;
  if (cad) {
    const latestProject = cad.projects?.[0] ?? null;
    const latestBuild = cad.builds?.[0] ?? null;
    const latestSimulation = cad.simulations?.[0] ?? null;
    const latestModel = cad.models?.[0] ?? null;
    const latestStudy = cad.parameter_studies?.[0] ?? null;
    const latestSlice = cad.slices?.[0] ?? null;
    const thermalModel = latestModel?.summary?.classification ===
      'surface_graph_heat_diffusion_not_volumetric_fea';
    const card = boardCard('CAD ENGINEERING',
      latestProject ? latestProject.name : 'No parametric environment');
    const gates = create('div', 'gate-list');
    for (const [label, status] of [
      ['Declared source environment', latestProject?.healthy ? 'complete' : 'required'],
      ['Immutable CAD mesh', latestBuild?.verified &&
        latestBuild.status === 'completed' ? 'complete' : 'required'],
      ['Geometry screen', latestSimulation ? latestSimulation.status : 'required'],
      [thermalModel ? 'Surface thermal field' : 'Recorded CAD model',
        latestModel?.status ?? 'required'],
      ['Comparative parameter study', latestStudy
        ? latestStudy.review?.verdict ?? latestStudy.status : 'optional'],
      ['Bounded slicer output', latestSlice?.status ?? 'required'],
      ['Printer transmission', 'disabled']
    ]) {
      const row = create('div', 'gate-row');
      row.append(create('span', '', label), statusPill(status));
      gates.append(row);
    }
    const safety = create('p', 'pane-placeholder',
      'Source scope project-only · post-process disabled · no printer link · ' +
      (thermalModel
        ? 'surface graph diffusion and bounded parameter comparisons are interactive but not volumetric FEA.'
        : 'geometry and model outputs require method-specific validation.'));
    const open = create('button', 'quiet-button',
      latestProject ? 'Open CAD Studio' : 'Create CAD environment');
    open.type = 'button';
    open.addEventListener('click', () => showArchive('cad'));
    card.append(gates, safety, open);
    elements.harnessDesign.append(card);
  }

  const figureComparisons = harness.board?.figure_comparisons ?? [];
  const figureCard = boardCard('FIGURE REPRODUCIBILITY',
    figureComparisons.length
      ? figureComparisons.length + ' immutable figure check' +
        (figureComparisons.length === 1 ? '' : 's')
      : 'No baseline/rerun comparison');
  if (!figureComparisons.length) {
    figureCard.append(create('p', 'pane-placeholder',
      'Open a recorded PNG figure to compare a baseline with a rerun, inspect pixel and structural-similarity evidence, and share the exact result with the AI.'));
  } else {
    const list = create('div', 'harness-figure-list');
    for (const comparison of figureComparisons.slice(-5).reverse()) {
      const row = create('button', 'harness-figure-row');
      row.type = 'button';
      const copy = create('div');
      const changed = comparison.summary?.tolerance_exceeding_fraction;
      const structural = comparison.summary?.structural_similarity;
      copy.append(
        create('strong', '', comparison.name ?? comparison.figure_comparison_id),
        create('small', '',
          String(comparison.reproduction_status).replaceAll('_', ' ') +
          (Number.isFinite(changed)
            ? ' / ' + (changed * 100).toFixed(4) + '% beyond tolerance'
            : ' / dimensions incompatible') +
          (Number.isFinite(structural)
            ? ' / SSIM ' + structural.toFixed(6)
            : ''))
      );
      row.append(copy, statusPill(comparison.verified
        ? comparison.status : 'attention'));
      row.addEventListener('click', () => {
        const source = recordedPngSource(comparison.baseline?.url);
        if (!source) {
          showNotice('The baseline is recorded but is not available in the current Lab state.');
          return;
        }
        openArtifactStudio(source.artifact, source.record, 'figure');
      });
      list.append(row);
    }
    figureCard.append(list, create('p', 'pane-placeholder',
      'Pass/fail reflects frozen mechanical pixel and optional block-luminance SSIM rules; scientific meaning remains a separate review.'));
  }
  elements.harnessDesign.append(figureCard);

  const figureRegistrations = harness.board?.figure_registrations ?? [];
  const semanticFigureCard = boardCard('FIGURE SEMANTICS',
    figureRegistrations.length
      ? figureRegistrations.length + ' registered figure contract' +
        (figureRegistrations.length === 1 ? '' : 's')
      : 'No source-to-figure registration');
  if (!figureRegistrations.length) {
    semanticFigureCard.append(create('p', 'pane-placeholder',
      'Open a recorded PNG to register a producer sidecar against its immutable CSV/TSV source, exact columns, units, scales, row policy, and plotted-data digest.'));
  } else {
    const list = create('div', 'harness-figure-list');
    for (const registration of figureRegistrations.slice(-5).reverse()) {
      const row = create('button', 'harness-figure-row');
      row.type = 'button';
      const copy = create('div');
      copy.append(
        create('strong', '', registration.name ??
          registration.figure_registration_id),
        create('small', '',
          String(registration.registration_status).replaceAll('_', ' ') +
          ' / ' + String(registration.summary?.plotted_points ?? 0) +
          ' points / ' + String(registration.summary?.series ?? 0) + ' series')
      );
      row.append(copy, statusPill(registration.verified
        ? registration.status : 'attention'));
      row.addEventListener('click', () => {
        const source = recordedPngSource(registration.figure?.url);
        if (!source) {
          showNotice('The registered PNG is not available in the current Lab state.');
          return;
        }
        openArtifactStudio(source.artifact, source.record, 'figure');
      });
      list.append(row);
    }
    semanticFigureCard.append(list, create('p', 'pane-placeholder',
      'Matched means the producer sidecar and deterministic tabular replay agree. It does not infer semantics from image pixels or certify renderer behavior.'));
  }
  elements.harnessDesign.append(semanticFigureCard);

  const figureVisuals = harness.board?.figure_visuals ?? [];
  const visualFigureCard = boardCard('FIGURE PIXELS',
    figureVisuals.length
      ? figureVisuals.length + ' decoded-pixel validation' +
        (figureVisuals.length === 1 ? '' : 's')
      : 'No decoded-pixel validation');
  if (!figureVisuals.length) {
    visualFigureCard.append(create('p', 'pane-placeholder',
      'Open a semantically matched PNG to declare its plot rectangle, axis domains, and flat colors, then validate actual decoded axis and mark pixels.'));
  } else {
    const list = create('div', 'harness-figure-list');
    for (const visual of figureVisuals.slice(-5).reverse()) {
      const row = create('button', 'harness-figure-row');
      row.type = 'button';
      const copy = create('div');
      copy.append(
        create('strong', '', visual.name ?? visual.figure_visual_id),
        create('small', '',
          String(visual.visual_status).replaceAll('_', ' ') + ' / ' +
          String(visual.summary?.matched_mark_samples ?? 0) + '/' +
          String(visual.summary?.expected_mark_samples ?? 0) +
          ' expected mark samples')
      );
      row.append(copy, statusPill(visual.verified
        ? visual.status : 'attention'));
      row.addEventListener('click', () => {
        const registration = (labState?.figure_registrations ?? []).find(
          (item) => item.figure_registration_id === visual.figure_registration_id
        );
        const source = recordedPngSource(registration?.figure?.url);
        if (!source) {
          showNotice('The validated PNG is recorded but is not available in the current Lab state.');
          return;
        }
        openArtifactStudio(source.artifact, source.record, 'figure');
      });
      list.append(row);
    }
    visualFigureCard.append(list, create('p', 'pane-placeholder',
      'This constrained layer checks declared flat-color axes and projected line/scatter marks in decoded PNG pixels. It does not OCR labels, ticks, legends, or annotations.'));
  }
  elements.harnessDesign.append(visualFigureCard);

  const procedure = harness.board?.procedure;
  if (procedure) {
    const card = boardCard('PROCEDURE GATES', procedure.execution_state.replaceAll('_', ' '));
    card.classList.add('harness-procedure-card');
    if (procedure.plan) {
      card.append(
        create('strong', '', procedure.plan.name ?? procedure.selected_procedure_id),
        create('p', 'pane-placeholder',
          String(procedure.plan.counts?.steps ?? 0) + ' steps / ' +
          String(procedure.plan.counts?.hazards ?? 0) + ' hazards / ' +
          'physical execution disabled')
      );
    }
    const gates = create('div', 'gate-list');
    for (const gate of procedure.gates) {
      const row = create('button', 'gate-row');
      row.type = 'button';
      row.title = gate.detail ?? 'Share this procedure gate with the next AI turn';
      row.append(
        create('span', '', gate.label),
        statusPill(gate.status)
      );
      row.addEventListener('click', () => saveInteraction(
        'procedure',
        'board.focused',
        procedure.selected_procedure_id ? {
          kind: 'procedure',
          record_id: procedure.selected_procedure_id,
          name: procedure.plan?.name ?? procedure.selected_procedure_id,
          url: '/api/procedures/' +
            encodeURIComponent(procedure.selected_procedure_id)
        } : null,
        {
          procedure_id: procedure.selected_procedure_id,
          procedure_assessment_id: procedure.selected_assessment_id,
          gate_id: gate.id,
          gate_status: gate.status,
          physical_execution_enabled: false,
          note: 'Focus on procedure gate ' + gate.label + ': ' +
            String(gate.detail ?? '')
        }
      ));
      gates.append(row);
    }
    const adapterList = create('div', 'harness-adapter-list');
    for (const adapter of procedure.adapters) {
      const row = create('span');
      row.append(
        create('strong', '', adapter.label),
        statusPill(adapter.status)
      );
      adapterList.append(row);
    }
    const actions = create('div', 'analysis-actions');
    const openPlan = create('button', 'quiet-button',
      procedure.selected_procedure_id ? 'Open procedure' : 'Open Studio');
    openPlan.type = 'button';
    openPlan.addEventListener('click', () =>
      showArchive('procedures', procedure.selected_procedure_id));
    actions.append(openPlan);
    if (procedure.selected_assessment_id) {
      const openAssessment = create('button', 'quiet-button', 'Open dry-run');
      openAssessment.type = 'button';
      openAssessment.addEventListener('click', () =>
        showArchive('procedures', procedure.selected_assessment_id));
      actions.append(openAssessment);
    }
    card.append(
      gates,
      create('span', 'board-label', 'NON-EXECUTABLE ADAPTER PREVIEWS'),
      adapterList,
      actions
    );
    elements.harnessDesign.append(card);
  }
  const confirmatory = harness.board?.confirmatory;
  const contracts = confirmatory?.contracts ?? [];
  const latestContract = contracts.at(-1);
  const analysis = boardCard('CONFIRMATORY DESIGN',
    latestContract ? latestContract.name : 'No frozen outcome contract');
  if (!latestContract) {
    analysis.append(create('p', 'pane-placeholder',
      'Freeze a preregistration-linked outcome contract before running confirmatory computation.'));
  } else {
    const gates = create('div', 'gate-list');
    const rows = [
      ['Frozen integrity', latestContract.verified ? 'complete' : 'required'],
      ['Preregistration linked', latestContract.preregistration_id ? 'complete' : 'required'],
      ['Exact script bound', latestContract.script ? 'complete' : 'required'],
      [String(latestContract.counts?.primary ?? 0) + ' primary outcome(s)',
        (latestContract.counts?.primary ?? 0) > 0 ? 'complete' : 'required'],
      ...((latestContract.schema_version ?? 1) >= 3 ? [[
        'Preregistered t-tests (' +
          String(latestContract.statistics_engine?.name ?? 'statistics engine') +
          ' v' + String(latestContract.statistics_engine?.version ?? '?') + ')',
        latestContract.statistics_engine ? 'complete' : 'required'
      ]] : [])
    ];
    for (const [label, status] of rows) {
      const row = create('div', 'gate-row');
      row.append(create('span', '', label), statusPill(status));
      gates.append(row);
    }
    const open = create('button', 'quiet-button', 'Open frozen contract');
    open.type = 'button';
    open.addEventListener('click', () =>
      showArchive('analysis', latestContract.analysis_contract_id));
    analysis.append(gates, open);
  }
  elements.harnessDesign.append(analysis);
}

function checkRow(label, okay, detail) {
  const row = create('div', 'check-row ' + (okay ? 'pass' : 'attention'));
  row.append(create('span', 'check-mark', okay ? '✓' : '!'));
  const copy = create('div');
  copy.append(create('strong', '', label), create('small', '', detail));
  row.append(copy);
  return row;
}

function metric(label, value) {
  const block = create('div');
  block.append(create('strong', '', String(value)), create('small', '', label));
  return block;
}

function renderOutcome(harness) {
  elements.harnessOutcome.replaceChildren();
  if (!harness) {
    elements.harnessOutcome.append(create('p', 'pane-placeholder',
      'Recorded findings, evidence, and limitations will appear here.'));
    return;
  }
  const outcomes = harness.board?.outcomes ?? [];
  const latest = outcomes.at(-1);
  const result = boardCard('LATEST OUTCOME', latest ? 'Turn ' + latest.turn_index : 'No result yet');
  if (latest) {
    result.append(statusPill(latest.status), create('p', 'outcome-copy', latest.summary));
    const meta = create('div', 'outcome-meta');
    meta.append(create('span', '', 'run ' + compact(latest.run_id, 22)),
      create('span', '', formatDate(latest.finished_at)));
    result.append(meta);
  } else {
    result.append(create('p', '', 'Run the scientist to create a recorded outcome.'));
  }
  elements.harnessOutcome.append(result);

  const observed = harness.board?.evidence ?? [];
  const evidence = boardCard('EVIDENCE', observed.length + ' observed records');
  const evidenceList = create('div', 'evidence-list');
  if (!observed.length) {
    evidenceList.append(create('p', 'pane-placeholder', 'No evidence tool is visible yet.'));
  }
  for (const item of observed.slice(-10)) {
    const row = create('div', 'evidence-row');
    row.append(create('span', '', String(item.kind).slice(0, 4).toUpperCase()),
      create('p', '', item.label));
    evidenceList.append(row);
  }
  evidence.append(evidenceList);
  elements.harnessOutcome.append(evidence);

  const validation = harness.board?.validation;
  const reviews = harness.board?.reviews ?? [];
  const reviewCard = boardCard('INDEPENDENT REVIEW',
    reviews.length + ' semantic review' + (reviews.length === 1 ? '' : 's'));
  const reviewList = create('div', 'harness-review-list');
  if (!reviews.length) {
    reviewList.append(create('p', 'pane-placeholder',
      'Review a manuscript artifact to map claims, citations, calculations, and outputs.'));
  }
  for (const review of reviews.slice(-6).reverse()) {
    const historical = Boolean(review.superseded_by);
    const row = create('button', 'harness-review-row ' + review.status +
      (historical ? ' historical' : ''));
    row.type = 'button';
    row.append(create('span', '', historical ? 'HIST' : String(review.status).toUpperCase()),
      create('div', '', null));
    row.lastChild.append(create('strong', '', review.target?.name ?? review.review_id),
      create('small', '',
        String(review.counts?.claims ?? 0) + ' claims · ' +
        String(review.counts?.findings ?? 0) + ' findings' +
        (historical ? ' · superseded' : ' · current')));
    row.addEventListener('click', () => showArchive('reviews', review.review_id));
    reviewList.append(row);
  }
  reviewCard.append(reviewList);
  elements.harnessOutcome.append(reviewCard);

  const confirmatory = harness.board?.confirmatory;
  const assessments = confirmatory?.assessments ?? [];
  const assessmentCard = boardCard('CONFIRMATORY OUTCOMES',
    assessments.length + ' immutable assessment' + (assessments.length === 1 ? '' : 's'));
  const assessmentList = create('div', 'harness-review-list');
  if (!assessments.length) {
    assessmentList.append(create('p', 'pane-placeholder',
      'Bind an experiment to a frozen analysis contract, then replay its primary outcomes.'));
  }
  for (const assessment of assessments.slice(-6).reverse()) {
    const historical = Boolean(assessment.superseded_by);
    const row = create('button',
      'harness-review-row ' + assessment.status + (historical ? ' historical' : ''));
    row.type = 'button';
    row.append(
      create('span', '', historical ? 'HIST' :
        String(assessment.registration_status ?? assessment.status).toUpperCase()),
      create('div')
    );
    const inference = assessment.summary?.inference;
    row.lastChild.append(
      create('strong', '', String(assessment.outcome_verdict ?? 'unknown') +
        ' primary verdict'),
      create('small', '',
        compact(assessment.experiment_id, 22) + ' · ' +
        (historical ? 'superseded' : 'current') + ' · ' +
        String(assessment.status))
    );
    if (inference) {
      row.lastChild.append(create('small', '',
        'preregistered t-tests: ' + String(inference.rejected_null ?? 0) +
        '/' + String(inference.family_size ?? 0) + ' rejected after ' +
        String(inference.multiplicity_correction ?? 'none').replaceAll('_', '-') +
        (inference.indeterminate ? ' · ' + String(inference.indeterminate) +
          ' indeterminate' : '')));
    }
    row.addEventListener('click', () =>
      showArchive('analysis', assessment.analysis_assessment_id));
    assessmentList.append(row);
  }
  assessmentCard.append(assessmentList);
  elements.harnessOutcome.append(assessmentCard);

  const literature = harness.board?.literature ?? [];
  if (literature.length) {
    const literatureCard = boardCard('LITERATURE RECORDS',
      literature.length + ' frozen registry snapshot' + (literature.length === 1 ? '' : 's'));
    const literatureList = create('div', 'harness-review-list');
    for (const record of literature.slice(0, 6)) {
      const row = create('div',
        'harness-review-row ' + (record.verified ? 'pass' : 'attention'));
      row.append(
        create('span', '', String(record.source ?? '?').toUpperCase()),
        create('div')
      );
      row.lastChild.append(
        create('strong', '', compact(record.title ?? record.identifier ?? record.literature_id, 60)),
        create('small', '',
          (record.year ? String(record.year) + ' · ' : '') +
          (record.doi ?? record.identifier ?? '') + ' · ' +
          (record.verified ? 'verified' : 'attention') + ' · ' +
          String(record.transport ?? ''))
      );
      literatureList.append(row);
    }
    literatureCard.append(literatureList);
    elements.harnessOutcome.append(literatureCard);
  }

  const procedure = harness.board?.procedure;
  if (procedure) {
    const procedureCard = boardCard('PROCEDURE OUTCOME',
      procedure.assessment?.status?.replaceAll('_', ' ') ??
      'No immutable logical dry-run');
    const procedureMetrics = create('div', 'board-metrics');
    procedureMetrics.append(
      metric('Plans', procedure.counts.plans),
      metric('Assessments', procedure.counts.assessments),
      metric('Decisions', procedure.counts.decisions),
      metric('Effective external attestations',
        procedure.counts.effective_external_physical_attestations)
    );
    procedureCard.append(
      procedureMetrics,
      create('p', 'limitation',
        'Execution state / ' + procedure.execution_state.replaceAll('_', ' ') +
        '. Physical execution remains disabled.')
    );
    const adapters = create('div', 'harness-adapter-list');
    for (const adapter of procedure.adapters) {
      const row = create('span');
      row.append(create('strong', '', adapter.label), statusPill(adapter.status));
      adapters.append(row);
    }
    const open = create('button', 'quiet-button', 'Open Procedure Studio');
    open.type = 'button';
    open.addEventListener('click', () => showArchive(
      'procedures',
      procedure.selected_assessment_id ?? procedure.selected_procedure_id
    ));
    procedureCard.append(adapters, open);
    elements.harnessOutcome.append(procedureCard);
  }

  const checks = boardCard('VALIDATION', 'Decision readiness');
  checks.append(
    checkRow('Transcript integrity', Boolean(validation?.transcript_verified),
      validation?.transcript_verified ? 'Hash chain verified' : 'Verification required'),
    checkRow('Campaign integrity',
      (validation?.campaigns ?? 0) > 0 &&
        validation?.campaigns_verified === validation?.campaigns,
      validation?.campaigns
        ? String(validation.campaigns_verified ?? 0) + '/' +
          String(validation.campaigns) + ' campaign plans and ledgers verified'
        : 'No checkpointed research campaign linked'),
    checkRow('Campaign task outcomes',
      (validation?.completed_campaign_tasks ?? 0) > 0 &&
        (validation?.failed_campaign_tasks ?? 0) === 0,
      String(validation?.completed_campaign_tasks ?? 0) + ' completed · ' +
        String(validation?.failed_campaign_tasks ?? 0) + ' failed'),
    checkRow('Session continuity', Boolean(validation?.session_consistent),
      validation?.session_consistent ? 'One persistent engine context' : 'Session mismatch detected'),
    checkRow('Evidence observed', Boolean(validation?.evidence_observed),
      validation?.evidence_observed ? 'Recorded evidence tools present' : 'No evidence tool recorded'),
    checkRow('Independent challenge', Boolean(validation?.review_observed),
      validation?.semantic_reviews
        ? String(validation.semantic_reviews_verified ?? 0) + '/' +
          String(validation.semantic_reviews) + ' verified · ' +
          String(validation.semantic_reviews_current ?? validation.semantic_reviews) + ' current'
        : validation?.review_observed ? 'Review signals present' : 'Reviewer pass still needed'),
    checkRow('Primary outcome contract', (validation?.analysis_contracts_verified ?? 0) > 0,
      validation?.analysis_contracts
        ? String(validation.analysis_contracts_verified ?? 0) + '/' +
          String(validation.analysis_contracts) + ' frozen contracts verified'
        : 'No preregistered analysis contract linked'),
    checkRow('Prospective assessment',
      (validation?.prospective_confirmatory_assessments ?? 0) > 0,
      validation?.confirmatory_assessments
        ? String(validation.prospective_confirmatory_assessments ?? 0) +
          ' prospective · ' +
          String(validation.confirmatory_assessments_needing_attention ?? 0) +
          ' current needing attention'
        : 'No confirmatory assessment recorded'),
    checkRow('Structured procedure plan',
      (validation?.verified_procedure_plans ?? 0) > 0,
      validation?.procedure_plans
        ? String(validation.verified_procedure_plans ?? 0) + '/' +
          String(validation.procedure_plans) + ' plans verified'
        : 'No structured plan linked'),
    checkRow('Procedure logical dry-run',
      (validation?.current_procedure_assessments ?? 0) > 0 &&
        (validation?.blocked_procedure_assessments ?? 0) === 0,
      validation?.procedure_assessments
        ? String(validation.current_procedure_assessments ?? 0) +
          ' current / ' +
          String(validation.blocked_procedure_assessments ?? 0) + ' blocked'
        : 'No immutable logical dry-run linked'),
    checkRow('External human attestation',
      (validation?.effective_procedure_approvals ?? 0) > 0,
      String(validation?.effective_procedure_approvals ?? 0) +
        ' effective local attestation(s); identity and authority remain unverified')
  );
  for (const limitation of validation?.limitations ?? []) {
    checks.append(create('p', 'limitation', limitation));
  }
  elements.harnessOutcome.append(checks);

  const compute = harness.board?.computation;
  const computeCard = boardCard('COMPUTE',
    compute?.gpu_runtime_ready && compute?.npu_runtime_ready ? 'GPU + NPU online' :
      compute?.gpu_runtime_ready ? 'GPU online' :
        compute?.npu_runtime_ready ? 'NPU online' :
          compute?.runtime_ready ? 'CPU runtime ready' : 'Runtime attention');
  const metrics = create('div', 'board-metrics');
  metrics.append(metric('Experiments', compute?.experiments ?? 0),
    metric('Simulations', compute?.simulations ?? 0),
    metric('NPU runs', compute?.npu_verified_inferences ?? 0),
    metric('NPU EP', compute?.npu_execution_provider ? 'Vitis AI' : '—'),
    metric('Linked', compute?.linked_compute ? 'yes' : 'no'));
  computeCard.append(metrics);
  elements.harnessOutcome.append(computeCard);

  const direction = boardCard('USER DIRECTION', 'Guide the next AI turn');
  const input = create('textarea', 'direction-input');
  input.rows = 3;
  input.maxLength = 2000;
  input.placeholder = 'Add an interpretation, correction, priority, or question for ScienceCode…';
  const button = create('button', 'share-button', 'Save direction for AI');
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (!input.value.trim()) return;
    await saveInteraction('outcome', 'direction.added', null, { note: input.value.trim() });
    input.value = '';
  });
  direction.append(input, button);
  elements.harnessOutcome.append(direction);
}

function renderHarness(harness, job = activeJob) {
  activeHarness = harness;
  const events = job && ACTIVE_JOB_STATUSES.has(job.status)
    ? job.events : harness?.activity ?? job?.events ?? [];
  renderActivity(events);
  renderDesign(harness);
  renderOutcome(harness);
  if (job && ACTIVE_JOB_STATUSES.has(job.status)) {
    setHarnessLive('working',
      job.status === 'queued' ? 'Queued' :
        job.status === 'cancelling' ? 'Stopping' : 'Working');
  } else if (job?.status === 'failed') {
    setHarnessLive('failed', 'Needs review');
  } else if (job?.status === 'cancelled') {
    setHarnessLive('cancelled', 'Stopped');
  } else {
    setHarnessLive('idle', harness?.observed?.recorded_turns ? 'Recorded' : 'Idle');
  }
  updateJobControls(job);
}

function setHarnessTab(name) {
  for (const button of document.querySelectorAll('[data-harness-tab]')) {
    const selected = button.dataset.harnessTab === name;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const [panel, selected] of [
    [elements.harnessActivity, name === 'activity'],
    [elements.harnessDesign, name === 'design'],
    [elements.harnessOutcome, name === 'outcome']
  ]) {
    panel.classList.toggle('active', selected);
    panel.hidden = !selected;
  }
}

function showView(name, { focus = false } = {}) {
  activeView = name;
  const chat = name === 'chat';
  elements.chatView.classList.toggle('active', chat);
  elements.archiveView.classList.toggle('active', !chat);
  elements.chatView.hidden = !chat;
  elements.archiveView.hidden = chat;
  for (const button of document.querySelectorAll('[data-view]')) {
    const selected = button.dataset.view === (chat ? 'chat' : name);
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (!chat) {
    if (name === 'lineage') void renderLineageWorkspace(selectedChat);
    else renderArchive(name);
  }
  if (focus) {
    window.queueMicrotask(() => {
      (chat ? elements.chatTitle : elements.archiveTitle).focus({ preventScroll: true });
    });
  }
}

function svgElement(name, attributes = {}, text = null) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== null) element.textContent = text;
  return element;
}

function lineageArtifact(node) {
  return {
    kind: 'lineage',
    record_id: compact(node.record_id ?? node.id, 150),
    name: compact(node.label, 220),
    url: '/api/lineage' + (activeLineage?.scope?.chat_id
      ? '?chat=' + encodeURIComponent(activeLineage.scope.chat_id)
      : '')
  };
}

function lineageInteractionPayload(node, note = '') {
  const ids = [...lineageTrace(activeLineage, node.id, lineageDirection, 97)];
  return {
    schema_version: 1,
    graph_sha256: activeLineage.integrity.graph_sha256,
    node_id: node.id,
    node_type: node.type,
    direction: lineageDirection,
    node_ids: ids.slice(0, 96),
    truncated: ids.length > 96,
    note: compact(note, 2000) ?? ''
  };
}

function queueLineageSelection(node) {
  window.clearTimeout(lineageSelectionTimer);
  if (!selectedChat) return;
  lineageSelectionTimer = window.setTimeout(() => {
    void saveInteraction(
      'lineage',
      'node.selected',
      lineageArtifact(node),
      lineageInteractionPayload(node),
      { quiet: true }
    );
  }, 500);
}

async function renderLineageWorkspace(scopeChat = selectedChat) {
  const token = Symbol('lineage-load');
  renderLineageWorkspace.token = token;
  elements.archiveKicker.textContent = 'VERIFIED SCIENTIFIC PROVENANCE';
  elements.archiveTitle.textContent = 'Research lineage';
  elements.archiveSummary.textContent = scopeChat
    ? 'Conversation-scoped evidence, code, computation, artifacts, and user revisions.'
    : 'Every connected scientific record in this local project.';
  elements.recordDetail.hidden = true;
  elements.recordDetail.replaceChildren();
  elements.archiveList.replaceChildren(create('div', 'archive-empty', 'Building verified lineage graph…'));
  try {
    const url = '/api/lineage' + (scopeChat ? '?chat=' + encodeURIComponent(scopeChat) : '');
    const { payload } = await fetchJson(url);
    if (renderLineageWorkspace.token !== token || activeView !== 'lineage') return;
    activeLineage = payload;
    if (!activeLineage.nodes.some((node) => node.id === selectedLineageNode)) {
      selectedLineageNode = null;
      lineageDirection = 'both';
    }
    elements.lineageCount.textContent = String(payload.summary.nodes);

    const workspace = create('section', 'lineage-workspace');
    const toolbar = create('div', 'lineage-toolbar');
    const scope = create('select', 'lineage-filter');
    scope.setAttribute('aria-label', 'Lineage scope');
    if (selectedChat) {
      const current = create('option', '', 'Current conversation');
      current.value = selectedChat;
      scope.append(current);
    }
    const project = create('option', '', 'Whole project');
    project.value = '';
    scope.append(project);
    scope.value = scopeChat ?? '';

    const type = create('select', 'lineage-filter');
    type.setAttribute('aria-label', 'Lineage record type');
    const allTypes = create('option', '', 'All record types');
    allTypes.value = 'all';
    type.append(allTypes);
    for (const [name, count] of Object.entries(payload.summary.by_type)) {
      const option = create('option', '', name + ' (' + count + ')');
      option.value = name;
      type.append(option);
    }

    const integrity = create('select', 'lineage-filter');
    integrity.setAttribute('aria-label', 'Lineage integrity filter');
    for (const [value, label] of [
      ['all', 'All integrity states'],
      ['verified', 'Verified only'],
      ['issues', 'Needs review']
    ]) {
      const option = create('option', '', label);
      option.value = value;
      integrity.append(option);
    }
    const fit = create('button', 'secondary-button', 'Fit graph');
    fit.type = 'button';
    const clear = create('button', 'secondary-button', 'Clear focus');
    clear.type = 'button';
    clear.disabled = !selectedLineageNode;
    toolbar.append(scope, type, integrity, fit, clear);

    const summary = create('div', 'lineage-summary');
    for (const [label, value, mode] of [
      ['NODES', payload.summary.nodes, ''],
      ['EDGES', payload.summary.edges, ''],
      ['VERIFIED', payload.summary.verified_nodes, 'good'],
      ['ERRORS', payload.summary.errors, payload.summary.errors ? 'bad' : 'good'],
      ['WARNINGS', payload.summary.warnings, payload.summary.warnings ? 'warn' : 'good']
    ]) {
      const metric = create('span', 'lineage-metric ' + mode);
      metric.append(create('small', '', label), create('strong', '', String(value)));
      summary.append(metric);
    }
    const digest = create('code', 'lineage-digest', payload.integrity.graph_sha256.slice(0, 16) + '…');
    digest.title = payload.integrity.graph_sha256;
    summary.append(digest);

    const body = create('div', 'lineage-body');
    const viewport = create('div', 'lineage-viewport');
    const inspector = create('aside', 'lineage-inspector');
    body.append(viewport, inspector);
    workspace.append(toolbar, summary, body);
    elements.archiveList.replaceChildren(workspace);
    lineageUi = { scope, type, integrity, fit, clear, viewport, inspector, scopeChat };
    scope.addEventListener('change', () => {
      selectedLineageNode = null;
      lineageDirection = 'both';
      void renderLineageWorkspace(scope.value || null);
    });
    type.addEventListener('change', renderLineageGraph);
    integrity.addEventListener('change', renderLineageGraph);
    fit.addEventListener('click', () => lineageUi?.fitGraph?.());
    clear.addEventListener('click', () => {
      selectedLineageNode = null;
      lineageDirection = 'both';
      renderLineageGraph();
    });
    renderLineageGraph();
  } catch (error) {
    if (renderLineageWorkspace.token !== token) return;
    elements.archiveList.replaceChildren(create('div', 'studio-error', error.message));
  }
}

function selectLineageNode(node, { record = true } = {}) {
  selectedLineageNode = node.id;
  lineageDirection = 'both';
  renderLineageGraph();
  if (record) queueLineageSelection(node);
}

function renderLineageInspector(node) {
  const inspector = lineageUi.inspector;
  inspector.replaceChildren();
  if (!node) {
    const empty = create('div', 'lineage-inspector-empty');
    empty.append(
      create('span', 'radar-mark'),
      create('strong', '', 'Select a record'),
      create('p', '', 'Click any node to inspect its exact upstream and downstream lineage. Selection is recorded for the next AI turn.')
    );
    inspector.append(empty);
    return;
  }
  const head = create('header', 'lineage-inspector-head');
  const title = create('div');
  title.append(create('span', 'section-kicker', node.type.toUpperCase()), create('h3', '', node.label));
  const verified = create('span', 'lineage-integrity ' + (node.verified ? 'good' : 'bad'),
    node.verified ? 'VERIFIED' : 'INVALID');
  head.append(title, verified);
  inspector.append(head);
  if (node.detail) inspector.append(create('p', 'lineage-node-detail', node.detail));

  const direction = create('div', 'lineage-direction');
  for (const [value, label] of [
    ['upstream', 'Upstream'],
    ['both', 'Both'],
    ['downstream', 'Downstream']
  ]) {
    const button = create('button', value === lineageDirection ? 'active' : '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(value === lineageDirection));
    button.addEventListener('click', () => {
      lineageDirection = value;
      renderLineageGraph();
      queueLineageSelection(node);
    });
    direction.append(button);
  }
  inspector.append(direction);

  const facts = create('dl', 'lineage-facts');
  const values = [
    ['Status', node.status],
    ['Record ID', node.record_id],
    ['Recorded', node.created_at ? formatDate(node.created_at) : null],
    ['SHA-256', node.hash]
  ];
  for (const [label, value] of values) {
    if (value === null || value === undefined || value === '') continue;
    facts.append(create('dt', '', label), create('dd', '', compact(value, 180)));
  }
  inspector.append(facts);

  const incoming = activeLineage.edges.filter((edge) => edge.target === node.id);
  const outgoing = activeLineage.edges.filter((edge) => edge.source === node.id);
  const relations = create('section', 'lineage-relations');
  relations.append(create('h4', '', 'LINKS · ' + incoming.length + ' IN / ' + outgoing.length + ' OUT'));
  for (const edge of [...incoming, ...outgoing].slice(0, 18)) {
    const relatedId = edge.target === node.id ? edge.source : edge.target;
    const related = activeLineage.nodes.find((candidate) => candidate.id === relatedId);
    if (!related) continue;
    const button = create('button', 'lineage-link');
    button.type = 'button';
    button.append(
      create('small', '', (edge.target === node.id ? '<- ' : '-> ') + edge.relation),
      create('span', '', related.label)
    );
    button.addEventListener('click', () => selectLineageNode(related));
    relations.append(button);
  }
  inspector.append(relations);

  const nodeFindings = activeLineage.findings.filter((finding) =>
    finding.node_id === node.id || finding.target_id === node.id
  );
  if (nodeFindings.length) {
    const findings = create('section', 'lineage-findings');
    findings.append(create('h4', '', 'REVIEW FINDINGS'));
    for (const finding of nodeFindings) {
      const item = create('div', 'lineage-finding ' + finding.severity);
      item.append(create('strong', '', finding.code), create('p', '', finding.message));
      findings.append(item);
    }
    inspector.append(findings);
  }

  const metadata = Object.fromEntries(Object.entries(node.metadata ?? {}).filter(([, value]) =>
    value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)
  ));
  if (Object.keys(metadata).length) {
    const details = create('details', 'lineage-metadata');
    details.append(create('summary', '', 'Record metadata'), create('pre', '', JSON.stringify(metadata, null, 2)));
    inspector.append(details);
  }

  const note = create('textarea', 'lineage-note');
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = 'Tell the AI what to inspect, compare, or revise in this lineage…';
  const actions = create('div', 'lineage-actions');
  if (node.url) {
    const open = create('a', 'secondary-button', 'Open record');
    open.href = node.url;
    open.target = '_blank';
    open.rel = 'noopener';
    actions.append(open);
  }
  const share = create('button', 'share-button', 'Share trace with AI');
  share.type = 'button';
  share.addEventListener('click', async () => {
    const record = await saveInteraction(
      'lineage',
      'trace.shared',
      lineageArtifact(node),
      lineageInteractionPayload(node, note.value)
    );
    if (record) {
      share.textContent = 'Trace shared';
      note.value = '';
    }
  });
  actions.append(share);
  inspector.append(note, actions);
}

function installLineageNavigation(svg, bounds) {
  let view = {
    x: 0,
    y: 0,
    width: Math.min(bounds.width, 1120),
    height: Math.min(bounds.height, 680)
  };
  let drag = null;
  function apply() {
    svg.setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
  }
  function fit() {
    view = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    apply();
  }
  apply();
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    const nextWidth = Math.max(280, Math.min(bounds.width * 1.15, view.width * factor));
    const nextHeight = Math.max(180, Math.min(bounds.height * 1.15, view.height * factor));
    const rectangle = svg.getBoundingClientRect();
    const rx = rectangle.width ? (event.clientX - rectangle.left) / rectangle.width : 0.5;
    const ry = rectangle.height ? (event.clientY - rectangle.top) / rectangle.height : 0.5;
    view.x += (view.width - nextWidth) * rx;
    view.y += (view.height - nextHeight) * ry;
    view.width = nextWidth;
    view.height = nextHeight;
    apply();
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('.lineage-node')) return;
    drag = { x: event.clientX, y: event.clientY, view: { ...view } };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const rectangle = svg.getBoundingClientRect();
    view.x = drag.view.x - (event.clientX - drag.x) * drag.view.width / Math.max(1, rectangle.width);
    view.y = drag.view.y - (event.clientY - drag.y) * drag.view.height / Math.max(1, rectangle.height);
    apply();
  });
  const stop = () => {
    drag = null;
    svg.classList.remove('panning');
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  svg.addEventListener('dblclick', fit);
  lineageUi.fitGraph = fit;
}

function renderLineageGraph() {
  if (!activeLineage || !lineageUi) return;
  const nodeMap = new Map(activeLineage.nodes.map((node) => [node.id, node]));
  const selected = nodeMap.get(selectedLineageNode) ?? null;
  lineageUi.clear.disabled = !selected;
  const graph = lineageSubgraph(activeLineage, {
    type: lineageUi.type.value,
    integrity: lineageUi.integrity.value,
    selected: selected?.id ?? null,
    direction: lineageDirection
  });
  lineageUi.viewport.replaceChildren();
  renderLineageInspector(selected);
  if (!graph.nodes.length) {
    const empty = create('div', 'lineage-empty');
    empty.append(create('strong', '', 'No records match this view'),
      create('p', '', 'Clear the focus or change the integrity and record-type filters.'));
    lineageUi.viewport.append(empty);
    lineageUi.fitGraph = () => {};
    return;
  }

  const layout = layoutLineage(graph);
  const svg = svgElement('svg', {
    class: 'lineage-canvas',
    role: 'group',
    'aria-label': 'Interactive scientific lineage graph',
    width: layout.width,
    height: layout.height
  });
  const definitions = svgElement('defs');
  const marker = svgElement('marker', {
    id: 'lineage-arrow',
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse'
  });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
  definitions.append(marker);
  svg.append(definitions, svgElement('rect', {
    class: 'lineage-canvas-base',
    x: 0,
    y: 0,
    width: layout.width,
    height: layout.height
  }));

  for (const edge of graph.edges) {
    const source = layout.positions.get(edge.source);
    const target = layout.positions.get(edge.target);
    if (!source || !target) continue;
    const startsRight = source.x <= target.x;
    const sx = startsRight ? source.x + source.width : source.x;
    const tx = startsRight ? target.x : target.x + target.width;
    const sy = source.y + source.height / 2;
    const ty = target.y + target.height / 2;
    const span = Math.max(36, Math.abs(tx - sx) * 0.42);
    const path = svgElement('path', {
      class: 'lineage-edge relation-' + edge.relation.replace(/[^a-z0-9_-]/gi, '-'),
      d: 'M ' + sx + ' ' + sy + ' C ' + (sx + (startsRight ? span : -span)) + ' ' + sy +
        ', ' + (tx - (startsRight ? span : -span)) + ' ' + ty + ', ' + tx + ' ' + ty,
      'marker-end': 'url(#lineage-arrow)'
    });
    path.append(svgElement('title', {}, edge.relation));
    svg.append(path);
  }

  for (const node of graph.nodes) {
    const position = layout.positions.get(node.id);
    const group = svgElement('g', {
      class: 'lineage-node type-' + node.type +
        (node.id === selected?.id ? ' selected' : '') +
        (node.verified ? ' verified' : ' invalid'),
      transform: 'translate(' + position.x + ' ' + position.y + ')',
      role: 'button',
      tabindex: 0,
      'aria-label': node.type + ': ' + node.label + ', ' + (node.verified ? 'verified' : 'invalid')
    });
    group.append(
      svgElement('rect', { width: position.width, height: position.height, rx: 8 }),
      svgElement('circle', { class: 'lineage-node-state', cx: 12, cy: 13, r: 3.5 }),
      svgElement('text', { class: 'lineage-node-type', x: 21, y: 16 }, node.type.toUpperCase()),
      svgElement('text', { class: 'lineage-node-label', x: 12, y: 37 }, compact(node.label, 27)),
      svgElement('text', { class: 'lineage-node-status', x: 12, y: 53 }, compact(node.status, 30))
    );
    group.append(svgElement('title', {}, node.label + (node.detail ? '\n' + node.detail : '')));
    group.addEventListener('click', () => selectLineageNode(node));
    group.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectLineageNode(node);
    });
    svg.append(group);
  }
  lineageUi.viewport.append(svg);
  installLineageNavigation(svg, layout);
}

function archiveCard(title, subtitle, facts, status, onSelect) {
  const card = create('button', 'archive-card');
  card.type = 'button';
  const head = create('div');
  head.append(create('span', 'record-type', subtitle), statusPill(status));
  card.append(head, create('h3', '', title));
  const factList = create('div', 'record-facts');
  for (const fact of facts) factList.append(create('span', '', fact));
  card.append(factList);
  card.addEventListener('click', onSelect);
  return card;
}

function renderEmptyArchive(message, guidance =
  'Use the scientist to design and record the next reproducible work item.') {
  const empty = create('div', 'archive-empty');
  empty.append(create('strong', '', message),
    create('p', '', guidance));
  elements.archiveList.append(empty);
}

function notebookCellPayload(language, cell, note = '') {
  const result = cell?.result ?? {};
  return {
    language,
    kernel_id: cell?.manifest?.kernel_id ?? 'kernel-' + language,
    cell_id: cell?.manifest?.cell_id ?? null,
    execution_count: cell?.manifest?.execution_count ?? null,
    status: cell?.manifest?.status ?? null,
    code_sha256: cell?.manifest?.code_sha256 ?? null,
    result: compact(result.result?.repr ?? result.error?.message ?? '', 600),
    variables: (result.variables ?? []).slice(0, 24).map((item) => ({
      name: compact(item.name, 80),
      type: compact(item.type, 120),
      repr: compact(item.repr, 240)
    })),
    dependencies: (result.dependencies ?? []).slice(0, 24).map((item) => ({
      name: compact(item.name, 80),
      version: compact(item.version ?? '', 80)
    })),
    note: compact(note, 2000)
  };
}

async function shareNotebookCell(language, cell, note, action = 'state.shared', quiet = false) {
  return saveInteraction('notebook', action, {
    kind: 'kernel',
    record_id: cell.manifest.kernel_id,
    name: language + ' ' + cell.manifest.cell_id,
    url: '/api/kernels/' + encodeURIComponent(language) + '/cells/' +
      encodeURIComponent(cell.manifest.cell_id)
  }, notebookCellPayload(language, cell, note), { quiet });
}

async function mutateKernel(language, action, body = {}) {
  const { payload } = await fetchJson(
    '/api/kernels/' + encodeURIComponent(language) + '/' + action,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  return payload;
}

function renderNotebookWorkspace() {
  const workspace = create('section', 'notebook-workspace');
  const tabs = create('div', 'notebook-language-tabs');
  const body = create('div', 'notebook-body');
  const statuses = labState?.kernels ?? [];
  for (const language of ['python', 'r']) {
    const status = statuses.find((item) => item.language === language) ?? {
      language, available: false, recorded_execution_count: 0, live: false
    };
    const button = create('button', activeKernelLanguage === language ? 'active' : '');
    button.type = 'button';
    const label = language === 'python' ? 'Python' : 'R';
    const state = status.live ? 'LIVE' : status.available ? 'READY' : 'MISSING';
    button.append(create('strong', '', label),
      create('span', '', String(status.recorded_execution_count ?? 0) + ' cells · ' + state));
    button.addEventListener('click', () => {
      activeKernelLanguage = language;
      for (const item of tabs.querySelectorAll('button')) item.classList.remove('active');
      button.classList.add('active');
      loadNotebookWorkspace(body, language);
    });
    tabs.append(button);
  }
  workspace.append(tabs, body);
  loadNotebookWorkspace(body, activeKernelLanguage);
  return workspace;
}

async function loadNotebookWorkspace(container, language, selectedCellId = null) {
  const requestId = String((Number(container.dataset.notebookRequestId) || 0) + 1);
  container.dataset.notebookRequestId = requestId;
  container.replaceChildren(create('div', 'notebook-loading', 'Inspecting ' + language + ' kernel…'));
  try {
    const { payload } = await fetchJson('/api/kernels/' + encodeURIComponent(language));
    if (!container.isConnected || container.dataset.notebookRequestId !== requestId) return;
    const { status, record } = payload;
    container.replaceChildren();
    const header = create('header', 'notebook-runtime-header');
    const heading = create('div');
    heading.append(create('span', 'section-kicker', language.toUpperCase() + ' PROJECT KERNEL'),
      create('h2', '', language === 'python' ? 'Python scientific notebook' : 'R scientific notebook'),
      create('p', '', status.available
        ? 'Local runtime · ' + (status.runtime?.source ?? 'recorded runtime') +
          (status.language_version ? ' · ' + status.language_version : '')
        : 'Runtime unavailable · ' + (status.runtime?.error ?? 'not installed')));
    const statePill = statusPill(status.busy ? 'running' : status.live ? 'completed' :
      status.available ? 'queued' : 'attention');
    statePill.textContent = status.busy ? 'BUSY' : status.live ? 'LIVE' :
      status.available ? 'STOPPED' : 'MISSING';
    header.append(heading, statePill);

    const controls = create('div', 'notebook-runtime-controls');
    const restore = create('button', 'secondary-button', 'Restore recorded state');
    const fresh = create('button', 'secondary-button', status.live ? 'Restart clean' : 'Start clean kernel');
    const interrupt = create('button', 'quiet-button', 'Interrupt');
    const refresh = create('button', 'quiet-button', 'Refresh');
    restore.type = fresh.type = interrupt.type = refresh.type = 'button';
    restore.disabled = !status.available || !status.recorded_execution_count ||
      (status.live && status.history_loaded) || status.busy;
    fresh.disabled = !status.available || status.busy;
    interrupt.disabled = !status.busy;
    controls.append(restore, fresh, interrupt, refresh);

    const facts = create('div', 'notebook-runtime-facts');
    const factValues = [
      ['Recorded cells', status.recorded_execution_count ?? 0],
      ['State', status.state_mode ?? 'empty'],
      ['Restored through', status.restored_through ?? 0],
      ['Integrity', status.verification?.ok === false ? 'attention' : status.recorded ? 'verified' : 'new']
    ];
    for (const [label, value] of factValues) {
      const fact = create('span');
      fact.append(create('small', '', label), create('strong', '', String(value)));
      facts.append(fact);
    }
    container.append(header, controls, facts);

    if (status.recorded_execution_count && !status.live) {
      const warning = create('div', 'notebook-replay-warning');
      warning.append(create('strong', '', 'Recorded history is not loaded.'),
        create('p', '', 'Restore explicitly re-executes verified completed cells and may repeat code side effects. Start clean opens a new live namespace without replaying prior cells; both choices preserve old records.'));
      container.append(warning);
    }
    if (!status.available) {
      const missing = create('div', 'notebook-replay-warning unavailable');
      missing.append(create('strong', '', language === 'r' ? 'Rscript is optional and was not found.' : 'Python runtime unavailable.'),
        create('p', '', language === 'r'
          ? 'Install R and ensure Rscript is on PATH, then refresh. Existing R records remain inspectable.'
          : 'Set up the ScienceCode compute runtime, then refresh.'));
      container.append(missing);
    }

    const layout = create('div', 'notebook-layout');
    const work = create('section', 'notebook-work-area');
    const composer = create('div', 'notebook-cell-composer');
    const prompt = create('span', 'notebook-prompt', 'In [ ]');
    const editor = create('textarea', 'notebook-editor');
    editor.maxLength = 65536;
    editor.spellcheck = false;
    editor.placeholder = language === 'python'
      ? '# Python cell\nimport numpy as np\nvalues = np.arange(10)\nvalues.mean()'
      : '# R cell\nvalues <- 1:10\nmean(values)';
    const cellToolbar = create('div', 'notebook-cell-toolbar');
    const timeout = create('select');
    timeout.setAttribute('aria-label', 'Cell timeout');
    for (const [label, value] of [['30 s', 30000], ['2 min', 120000], ['10 min', 600000], ['30 min', 1800000]]) {
      const option = create('option', '', label);
      option.value = String(value);
      if (value === 120000) option.selected = true;
      timeout.append(option);
    }
    const run = create('button', 'run-button', 'Run cell');
    run.type = 'button';
    run.disabled = !status.live || status.busy;
    const runHint = create('span', 'notebook-run-hint', status.live
      ? 'Ctrl/⌘+Enter · cell is immutable after execution'
      : 'Start or restore the kernel before running a cell');
    cellToolbar.append(timeout, runHint, run);
    composer.append(prompt, editor, cellToolbar);
    work.append(composer);

    const inspector = create('div', 'notebook-cell-inspector');
    inspector.append(create('div', 'notebook-empty-cell', record?.cells?.length
      ? 'Select a recorded cell to inspect its output and variables.'
      : 'Run the first cell to create an inspectable scientific record.'));
    work.append(inspector);

    const history = create('aside', 'notebook-history');
    history.append(create('header', '', 'CELL HISTORY'));
    const cells = record?.cells ?? [];
    if (!cells.length) {
      history.append(create('p', 'notebook-history-empty', 'No recorded cells'));
    } else {
      for (const cell of [...cells].reverse()) {
        const button = create('button', 'notebook-history-item' +
          ((selectedCellId ?? cells.at(-1).cell_id) === cell.cell_id ? ' active' : ''));
        button.type = 'button';
        const top = create('span');
        top.append(create('strong', '', 'In [' + cell.execution_count + ']'), statusPill(cell.status));
        button.append(top, create('small', '', compact(cell.result_preview ?? cell.error?.message ??
          cell.code_sha256, 86)), create('time', '', formatDuration(cell.duration_ms)));
        button.addEventListener('click', () => {
          for (const item of history.querySelectorAll('.notebook-history-item')) item.classList.remove('active');
          button.classList.add('active');
          renderNotebookCell(inspector, editor, language, cell.cell_id);
        });
        history.append(button);
      }
    }
    layout.append(work, history);
    container.append(layout);

    const reload = async (cellId = null) => {
      await loadState(false, true);
      await loadNotebookWorkspace(container, language, cellId);
    };
    restore.addEventListener('click', async () => {
      restore.disabled = true;
      restore.textContent = 'Restoring…';
      try {
        await mutateKernel(language, 'restore');
        await reload();
        showNotice('Verified kernel history restored into a live process.');
      } catch (error) {
        showNotice(error.message);
        restore.disabled = false;
        restore.textContent = 'Restore recorded state';
      }
    });
    fresh.addEventListener('click', async () => {
      fresh.disabled = true;
      try {
        await mutateKernel(language, 'restart', { restore: false });
        await reload();
        showNotice('Clean live kernel started. Earlier cells remain immutable and unloaded.');
      } catch (error) {
        showNotice(error.message);
        fresh.disabled = false;
      }
    });
    interrupt.addEventListener('click', async () => {
      try {
        await mutateKernel(language, 'interrupt');
        await reload();
      } catch (error) { showNotice(error.message); }
    });
    refresh.addEventListener('click', () => reload(selectedCellId));

    const execute = async () => {
      if (!editor.value.trim() || run.disabled) return;
      run.disabled = true;
      run.textContent = 'Running…';
      try {
        const executed = await mutateKernel(language, 'execute', {
          code: editor.value,
          timeout_ms: Number(timeout.value),
          chat_id: selectedChat ?? undefined
        });
        if (selectedChat) {
          await shareNotebookCell(language, executed.cell, '', 'cell.executed', true);
        }
        editor.value = '';
        await reload(executed.cell.manifest.cell_id);
        showNotice(selectedChat
          ? 'Cell recorded, verified, and added to the next AI turn’s context.'
          : 'Cell recorded and verified. Select a conversation to share notebook state with AI.');
      } catch (error) {
        showNotice(error.message);
        run.disabled = !status.live;
        run.textContent = 'Run cell';
      }
    };
    run.addEventListener('click', execute);
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        execute();
      }
    });
    if (cells.length) {
      renderNotebookCell(inspector, editor, language, selectedCellId ?? cells.at(-1).cell_id);
    }
  } catch (error) {
    if (container.dataset.notebookRequestId !== requestId) return;
    container.replaceChildren(create('div', 'notebook-loading error', error.message));
  }
}

async function renderNotebookCell(container, editor, language, cellId) {
  const requestId = String((Number(container.dataset.cellRequestId) || 0) + 1);
  container.dataset.cellRequestId = requestId;
  container.replaceChildren(create('div', 'notebook-empty-cell', 'Loading ' + cellId + '…'));
  try {
    const { payload } = await fetchJson(
      '/api/kernels/' + encodeURIComponent(language) + '/cells/' + encodeURIComponent(cellId)
    );
    if (!container.isConnected || container.dataset.cellRequestId !== requestId) return;
    const { cell, verification } = payload;
    container.replaceChildren();
    const header = create('header', 'notebook-cell-header');
    const title = create('div');
    title.append(create('span', 'section-kicker', 'IMMUTABLE CELL · IN [' + cell.manifest.execution_count + ']'),
      create('h3', '', cell.manifest.cell_id),
      create('p', '', formatDate(cell.manifest.finished_at) + ' · ' +
        formatDuration(cell.manifest.duration_ms) + ' · ' +
        (verification.ok ? 'verified ' + verification.manifest_sha256.slice(0, 12) + '…' : 'integrity warning')));
    header.append(title, statusPill(verification.ok ? cell.manifest.status : 'attention'));
    container.append(header);

    const source = create('section', 'notebook-output-block source');
    const sourceHead = create('header');
    const load = create('button', 'quiet-button', 'Load as new draft');
    load.type = 'button';
    load.addEventListener('click', () => {
      editor.value = cell.source;
      editor.focus();
      scrollElementIntoView(editor, 'center');
    });
    sourceHead.append(create('strong', '', 'SOURCE · ' + cell.manifest.code_sha256.slice(0, 12) + '…'), load);
    source.append(sourceHead, create('pre', 'notebook-code', cell.source));
    container.append(source);

    if (cell.stdout) {
      const output = create('section', 'notebook-output-block');
      output.append(create('header', '', 'STDOUT'), create('pre', 'notebook-stream stdout', cell.stdout));
      container.append(output);
    }
    if (cell.stderr) {
      const output = create('section', 'notebook-output-block error');
      output.append(create('header', '', 'STDERR'), create('pre', 'notebook-stream stderr', cell.stderr));
      container.append(output);
    }
    if (cell.result.result?.visible || cell.result.error) {
      const result = create('section', 'notebook-output-block result');
      result.append(create('header', '', cell.result.error ? 'ERROR' : 'RESULT'));
      if (cell.result.error) {
        result.append(create('strong', 'notebook-error-name', cell.result.error.type),
          create('pre', 'notebook-stream stderr', cell.result.error.message +
            (cell.result.error.traceback ? '\n\n' + cell.result.error.traceback : '')));
      } else {
        result.append(create('small', '', cell.result.result.type ?? 'value'),
          create('pre', 'notebook-result-value', cell.result.result.repr));
      }
      container.append(result);
    }

    const variables = cell.result.variables ?? [];
    const variableSection = create('section', 'notebook-output-block variables');
    variableSection.append(create('header', '', 'LIVE VARIABLES · ' + variables.length +
      (cell.result.variables_truncated ? '+' : '')));
    if (!variables.length) {
      variableSection.append(create('p', 'notebook-muted', 'No user variables were visible after this cell.'));
    } else {
      const table = create('div', 'notebook-variable-table');
      const tableHead = create('div', 'notebook-variable-row head');
      tableHead.append(create('span', '', 'NAME'), create('span', '', 'TYPE / SHAPE'), create('span', '', 'VALUE'));
      table.append(tableHead);
      for (const variable of variables) {
        const row = create('button', 'notebook-variable-row');
        row.type = 'button';
        const shape = Array.isArray(variable.shape) ? variable.shape.join('×') : variable.shape;
        row.append(create('strong', '', variable.name),
          create('span', '', compact(variable.type, 80) + (shape ? ' · ' + shape : '')),
          create('code', '', compact(variable.repr, 180)));
        row.title = 'Insert ' + variable.name + ' into the next cell';
        row.addEventListener('click', () => {
          const start = editor.selectionStart ?? editor.value.length;
          const end = editor.selectionEnd ?? start;
          editor.setRangeText(variable.name, start, end, 'end');
          editor.focus();
        });
        table.append(row);
      }
      variableSection.append(table);
    }
    container.append(variableSection);

    const dependencies = cell.result.dependencies ?? [];
    if (dependencies.length) {
      const dependencySection = create('section', 'notebook-output-block dependencies');
      dependencySection.append(create('header', '', 'CELL DEPENDENCIES'));
      const chips = create('div', 'notebook-dependency-chips');
      for (const dependency of dependencies) {
        chips.append(create('span', '', dependency.name + (dependency.version ? ' ' + dependency.version : '')));
      }
      dependencySection.append(chips);
      container.append(dependencySection);
    }

    const changes = cell.manifest.changes ?? {};
    if ((changes.added?.length ?? 0) + (changes.modified?.length ?? 0) + (changes.missing?.length ?? 0)) {
      const changeSection = create('section', 'notebook-output-block changes');
      changeSection.append(create('header', '', 'PROJECT FILE CHANGES'),
        create('pre', 'notebook-stream', JSON.stringify(changes, null, 2)));
      container.append(changeSection);
    }

    if (cell.artifacts?.length) {
      const artifactSection = create('section', 'notebook-output-block artifacts');
      artifactSection.append(create('header', '', 'RICH OUTPUTS'));
      const gallery = create('div', 'notebook-artifact-gallery');
      for (const artifact of cell.artifacts) {
        const figure = create('figure');
        if (artifact.media_type?.startsWith('image/')) {
          const image = create('img');
          image.src = artifact.url;
          image.alt = artifact.name;
          image.loading = 'lazy';
          figure.append(image);
        }
        const caption = create('figcaption');
        const mode = interactiveMode(artifact.name);
        if (mode) {
          const open = create('button', 'interactive-link', 'Open interactive · ' + artifact.name);
          open.type = 'button';
          open.addEventListener('click', () => openArtifactStudio(artifact, {
            kind: 'kernel',
            record_id: cell.manifest.kernel_id
          }, mode));
          caption.append(open);
        } else {
          const link = create('a', '', artifact.name);
          link.href = artifact.url;
          link.target = '_blank';
          link.rel = 'noreferrer';
          caption.append(link);
        }
        figure.append(caption);
        gallery.append(figure);
      }
      artifactSection.append(gallery);
      container.append(artifactSection);
    }

    const share = create('section', 'notebook-share');
    share.append(create('span', 'section-kicker', 'USER → AI HANDOFF'),
      create('p', '', 'Add an interpretation or request. The next AI turn receives this verified cell, its variables, result, and your direction.'));
    const note = create('textarea');
    note.maxLength = 2000;
    note.placeholder = 'Example: Compare this distribution with the previous experiment and explain the outlier.';
    const button = create('button', 'share-button', 'Share notebook state with AI');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const recorded = await shareNotebookCell(language, cell, note.value, 'state.shared');
      if (recorded) {
        note.value = '';
        button.textContent = 'Shared · ' + recorded.interaction_id;
      } else {
        button.disabled = false;
      }
    });
    share.append(note, button);
    container.append(share);
  } catch (error) {
    if (container.dataset.cellRequestId !== requestId) return;
    container.replaceChildren(create('div', 'notebook-empty-cell error', error.message));
  }
}

function defaultAnalysisContractSpec(preregistrationId = '') {
  return {
    schema_version: 2,
    name: 'Primary outcome analysis contract',
    hypothesis: 'State the falsifiable primary hypothesis before running the experiment.',
    preregistration_id: preregistrationId,
    script: 'analysis.py',
    analysis_population: 'All prespecified and integrity-verified experiment branches.',
    conditions: 'Describe the prespecified conditions, controls, and comparison.',
    missing_data_policy: 'fail',
    multiplicity_policy: 'One primary outcome; no multiplicity adjustment is applicable.',
    outcomes: [{
      outcome_id: 'primary_outcome',
      role: 'primary',
      label: 'Primary outcome',
      statistic: 'primary_outcome',
      variable: 'Define the measured variable precisely.',
      unit: { symbol: '1' },
      timepoint: 'Final recorded analysis timepoint',
      summary_measure: 'Arithmetic mean across prespecified branches',
      intercurrent_event_strategy:
        'A failed, unverified, or missing branch is treated as missing.',
      aggregation: 'mean',
      minimum_count: 1,
      filter: {},
      decision_rule: {
        operator: 'greater_than_or_equal',
        value: { value: 0, unit: '1' }
      }
    }],
    sensitivity_analyses: [
      'Describe a robustness analysis that does not silently replace the primary result.'
    ],
    exclusions: 'No post-result exclusions unless disclosed as a deviation.',
    notes: 'Threshold replay is descriptive; it does not create an inferential or causal claim.'
  };
}

function fieldLabel(text, control) {
  const label = create('label', 'analysis-field');
  label.append(create('span', '', text), control);
  return label;
}

function renderConfirmatoryWorkspace() {
  const workspace = create('section', 'analysis-workspace');
  const intro = create('header', 'analysis-workspace-head');
  intro.append(
    create('span', 'section-kicker', 'PREREGISTER BEFORE COMPUTE'),
    create('h2', '', 'Primary outcomes and decision rules'),
    create('p', '',
      'Freeze exact outcome definitions, registered units, typed thresholds, and a script before execution, then replay those rules over a verified experiment. Deviations and unit faults remain visible instead of being rewritten.')
  );
  workspace.append(intro);

  const panels = create('div', 'analysis-builder-grid');
  const preregistrationBuilder = renderPreregistrationBuilder({
    selectedChat,
    request: fetchJson,
    notify: showNotice,
    onCreated: async (created) => {
      await loadState(false, true);
      renderArchive('analysis');
      await showPreregistrationDetail({
        preregistration_id: created.record.preregistration_id
      });
    }
  });
  const contractPanel = boardCard('2 · FREEZE CONTRACT', 'Bind the plan before results');
  const preregistration = create('select', 'analysis-select');
  preregistration.setAttribute('aria-label', 'Frozen preregistration');
  const preregistrations = (labState?.preregistrations ?? [])
    .filter((record) => record.verified);
  if (!preregistrations.length) {
    const option = create('option', '', 'No frozen preregistration available');
    option.value = '';
    preregistration.append(option);
    preregistration.disabled = true;
  } else {
    for (const record of preregistrations) {
      const option = create('option', '',
        (record.name ?? record.preregistration_id) + ' · ' + compact(record.preregistration_id, 26));
      option.value = record.preregistration_id;
      preregistration.append(option);
    }
  }
  const editor = create('textarea', 'analysis-spec-editor');
  editor.rows = 20;
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'Analysis contract JSON');
  editor.value = JSON.stringify(
    defaultAnalysisContractSpec(preregistration.value),
    null,
    2
  );
  preregistration.addEventListener('change', () => {
    try {
      const value = JSON.parse(editor.value);
      value.preregistration_id = preregistration.value;
      editor.value = JSON.stringify(value, null, 2);
    } catch {
      showNotice('Fix the JSON before changing the preregistration binding.');
    }
  });
  const contractState = create('p', 'analysis-action-state',
    preregistrations.length
      ? 'Draft only · no contract is frozen yet'
      : 'Complete and freeze the preregistration above first.');
  const reset = create('button', 'quiet-button', 'Reset template');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    editor.value = JSON.stringify(
      defaultAnalysisContractSpec(preregistration.value),
      null,
      2
    );
    contractState.textContent = 'Template reset · review every field before freezing';
  });
  const freeze = create('button', 'share-button', 'Freeze analysis contract');
  freeze.type = 'button';
  freeze.disabled = !preregistrations.length;
  freeze.addEventListener('click', async () => {
    let spec;
    try {
      spec = JSON.parse(editor.value);
    } catch (error) {
      showNotice('Analysis contract JSON is invalid: ' + error.message);
      return;
    }
    freeze.disabled = true;
    contractState.textContent = 'Validating preregistration, script, outcomes, and thresholds…';
    try {
      const { payload } = await fetchJson('/api/analysis-contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: selectedChat ?? null, spec })
      });
      const detail = payload.analysis_contract;
      contractState.textContent = 'Frozen · ' + detail.manifest.analysis_contract_id;
      await loadState(false, true);
      renderArchive('analysis');
      await showAnalysisContractDetail({
        analysis_contract_id: detail.manifest.analysis_contract_id
      });
      if (payload.interaction_error) {
        showNotice('Contract froze, but AI handoff needs review: ' +
          payload.interaction_error.message);
      }
    } catch (error) {
      contractState.textContent = 'Not frozen · ' + error.message;
      showNotice(error.message);
    } finally {
      freeze.disabled = !preregistrations.length;
    }
  });
  const contractActions = create('div', 'analysis-actions');
  contractActions.append(reset, freeze);
  contractPanel.append(
    fieldLabel('Frozen preregistration', preregistration),
    create('p', 'analysis-help',
      'Schema 2 uses unit declarations such as {"symbol":"ms"} and threshold quantities such as {"value":500,"unit":"ms"}. Experiment final_statistics must use the same {value, unit} shape; compatible units are converted and incompatible dimensions become explicit missing results.'),
    editor,
    contractActions,
    contractState
  );

  const assessPanel = boardCard('3 · ASSESS EXPERIMENT', 'Replay without moving the goalposts');
  const contractSelect = create('select', 'analysis-select');
  contractSelect.setAttribute('aria-label', 'Analysis contract');
  const contracts = (labState?.analysis_contracts ?? []).filter((item) => item.verified);
  if (!contracts.length) {
    const option = create('option', '', 'No verified contracts');
    option.value = '';
    contractSelect.append(option);
    contractSelect.disabled = true;
  } else {
    for (const record of contracts) {
      const option = create('option', '', record.name + ' · ' +
        compact(record.analysis_contract_id, 24));
      option.value = record.analysis_contract_id;
      contractSelect.append(option);
    }
  }
  const experimentSelect = create('select', 'analysis-select');
  experimentSelect.setAttribute('aria-label', 'Recorded experiment');
  const experiments = (labState?.experiments ?? []).filter((item) => item.verified);
  if (!experiments.length) {
    const option = create('option', '', 'No verified experiments');
    option.value = '';
    experimentSelect.append(option);
    experimentSelect.disabled = true;
  } else {
    for (const record of experiments) {
      const binding = record.analysis_contract_id
        ? 'bound ' + compact(record.analysis_contract_id, 18)
        : 'unregistered';
      const option = create('option', '',
        (record.name ?? record.experiment_id) + ' · ' + binding);
      option.value = record.experiment_id;
      experimentSelect.append(option);
    }
  }
  const deviation = create('textarea', 'analysis-deviation');
  deviation.rows = 4;
  deviation.maxLength = 2000;
  deviation.placeholder =
    'Optional: disclose any departure from the frozen plan. This changes registration status to deviated.';
  const assessmentState = create('p', 'analysis-action-state',
    'Select an exact contract and experiment. An unbound pair will be labeled unregistered.');
  const assess = create('button', 'share-button', 'Create immutable assessment');
  assess.type = 'button';
  assess.disabled = !contracts.length || !experiments.length;
  assess.addEventListener('click', async () => {
    assess.disabled = true;
    assessmentState.textContent = 'Verifying records and replaying primary outcomes…';
    try {
      const { payload } = await fetchJson('/api/analysis-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChat ?? null,
          analysis_contract_id: contractSelect.value,
          experiment_id: experimentSelect.value,
          deviation_note: deviation.value.trim() || null
        })
      });
      const detail = payload.assessment;
      assessmentState.textContent = 'Recorded · ' +
        detail.report.registration.status + ' · ' + detail.report.status;
      deviation.value = '';
      await loadState(false, true);
      renderArchive('analysis');
      await showConfirmatoryAssessmentDetail({
        analysis_assessment_id: detail.manifest.analysis_assessment_id
      });
      if (payload.interaction_error) {
        showNotice('Assessment recorded, but AI handoff needs review: ' +
          payload.interaction_error.message);
      }
    } catch (error) {
      assessmentState.textContent = 'Not recorded · ' + error.message;
      showNotice(error.message);
    } finally {
      assess.disabled = !contracts.length || !experiments.length;
    }
  });
  assessPanel.append(
    fieldLabel('Frozen contract', contractSelect),
    fieldLabel('Verified experiment', experimentSelect),
    fieldLabel('Disclosed deviation', deviation),
    create('p', 'analysis-help',
      'A passing threshold on an unregistered or deviated experiment remains visible, but is never presented as prospective confirmatory evidence.'),
    assess,
    assessmentState
  );
  panels.append(preregistrationBuilder, contractPanel, assessPanel);
  workspace.append(panels);
  return workspace;
}

function procedureTemplateForProject() {
  const evidenceId = (labState?.evidence ?? [])
    .find((item) => item.verified)?.evidence_id ?? null;
  return defaultProcedureSpec(evidenceId);
}

function addSelectOption(select, value, label) {
  const option = create('option', '', label);
  option.value = value;
  select.append(option);
}

function renderProcedureDraftPreview(container, editor, state) {
  container.replaceChildren();
  let spec;
  try {
    spec = JSON.parse(editor.value);
  } catch (error) {
    state.textContent = 'Draft JSON is invalid: ' + error.message;
    state.className = 'analysis-action-state invalid';
    container.append(create('p', 'procedure-preview-empty',
      'Fix the JSON to restore the live dependency and resource preview.'));
    return null;
  }
  const model = procedureDraftModel(spec);
  state.className = 'analysis-action-state' + (model.valid ? '' : ' invalid');
  state.textContent =
    model.counts.steps + ' steps / ' + model.counts.hazards + ' hazards / ' +
    model.counts.controls + ' controls / ' + model.counts.sources + ' sources / ' +
    (model.valid ? 'local structure ready' : model.issues.length + ' issue(s)');
  const chips = create('div', 'procedure-preview-chips');
  chips.append(
    statusPill(model.valid ? 'pass' : 'blocked'),
    create('span', '', model.counts.sources ? 'source linked' : 'source needed'),
    create('span', '', model.counts.automation_targets + ' adapter target(s)'),
    create('span', '', 'hardware disabled')
  );
  const graph = create('ol', 'procedure-draft-graph');
  for (const step of model.steps) {
    const row = create('li');
    const body = create('div');
    body.append(
      create('strong', '', step.title),
      create('small', '',
        (step.step_id ?? 'missing ID') + ' / depends on ' +
        (step.dependencies.join(', ') || 'start'))
    );
    row.append(
      create('span', 'procedure-step-index', String(step.index).padStart(2, '0')),
      body,
      statusPill(step.operation)
    );
    graph.append(row);
  }
  if (!model.steps.length) {
    graph.append(create('li', 'procedure-preview-empty',
      'At least one structured step is required.'));
  }
  container.append(chips, graph);
  if (model.issues.length) {
    const issues = create('ul', 'procedure-draft-issues');
    for (const issue of model.issues) issues.append(create('li', '', issue));
    container.append(issues);
  }
  return { spec, model };
}

function renderProcedurePlanBuilder() {
  const card = boardCard('1 / EDITABLE PLAN', 'Design the exact procedure record');
  card.classList.add('procedure-builder');
  const editor = create('textarea', 'analysis-spec-editor procedure-spec-editor');
  editor.rows = 30;
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'Procedure plan JSON');
  editor.value = JSON.stringify(procedureTemplateForProject(), null, 2);
  const draftState = create('p', 'analysis-action-state');
  const preview = create('div', 'procedure-draft-preview');
  const updatePreview = () =>
    renderProcedureDraftPreview(preview, editor, draftState);
  let timer = null;
  editor.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(updatePreview, 120);
  });

  const reset = create('button', 'quiet-button', 'Reset template');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    editor.value = JSON.stringify(procedureTemplateForProject(), null, 2);
    updatePreview();
  });
  const currentPlans = (labState?.procedures ?? [])
    .filter((item) => item.current && item.verified);
  const revise = create('button', 'quiet-button', 'Revise current plan');
  revise.type = 'button';
  revise.disabled = !currentPlans.length;
  revise.addEventListener('click', async () => {
    const current = currentPlans.at(-1);
    if (!current) return;
    try {
      const { payload } = await fetchJson(
        '/api/procedures/' + encodeURIComponent(current.procedure_id)
      );
      editor.value = JSON.stringify({
        ...payload.procedure,
        name: payload.procedure.name + ' revision',
        supersedes_procedure_id: current.procedure_id
      }, null, 2);
      updatePreview();
      editor.focus();
    } catch (error) {
      showNotice(error.message);
    }
  });
  const validate = create('button', 'quiet-button', 'Validate draft');
  validate.type = 'button';
  validate.addEventListener('click', () => {
    const result = updatePreview();
    if (!result) return;
    draftState.textContent = result.model.valid
      ? 'Local structure passed. Freeze for authoritative server validation.'
      : result.model.issues.join(' ');
  });
  const freeze = create('button', 'share-button', 'Freeze immutable plan');
  freeze.type = 'button';
  freeze.addEventListener('click', async () => {
    if (!selectedChat) {
      showNotice('Start or select a conversation before creating an AI-visible plan.');
      return;
    }
    let spec;
    try {
      spec = JSON.parse(editor.value);
    } catch (error) {
      showNotice('Procedure JSON is invalid: ' + error.message);
      return;
    }
    freeze.disabled = true;
    draftState.textContent = 'Normalizing, checking sources, and freezing exact bytes...';
    try {
      const { payload } = await fetchJson('/api/procedures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChat,
          spec,
          note: 'Procedure plan created from the interactive Studio.'
        })
      });
      const id = payload.procedure.manifest.procedure_id;
      draftState.textContent = 'Frozen and AI-visible / ' + id;
      await loadState(false, true);
      renderArchive('procedures');
      await showProcedureDetail({ procedure_id: id });
      if (payload.interaction_error) {
        showNotice('Plan froze, but AI handoff needs review: ' +
          payload.interaction_error.message);
      }
    } catch (error) {
      draftState.textContent = 'Not frozen / ' + error.message;
      showNotice(error.message);
    } finally {
      freeze.disabled = false;
    }
  });
  const actions = create('div', 'analysis-actions procedure-actions');
  actions.append(reset, revise, validate, freeze);
  const grid = create('div', 'procedure-editor-grid');
  grid.append(editor, preview);
  card.append(
    create('p', 'analysis-help',
      'The live board is a draft aid. Server normalization rejects unknown fields, unsafe policy changes, malformed references, oversized inputs, and suspected secrets.'),
    grid,
    actions,
    draftState
  );
  updatePreview();
  return card;
}

function renderProcedureAssessmentBuilder() {
  const card = boardCard('2 / LOGICAL DRY-RUN',
    'Validate order, references, controls, and mappings');
  const select = create('select', 'analysis-select');
  select.setAttribute('aria-label', 'Frozen procedure plan');
  const plans = (labState?.procedures ?? [])
    .filter((item) => item.verified && item.current);
  if (!plans.length) {
    addSelectOption(select, '', 'No current verified plans');
    select.disabled = true;
  } else {
    for (const record of plans) {
      addSelectOption(select, record.procedure_id,
        (record.name ?? record.procedure_id) + ' / ' +
        String(record.counts?.steps ?? 0) + ' steps');
    }
  }
  const state = create('p', 'analysis-action-state',
    'Structural validation only; facility safety and physical execution remain external.');
  const assess = create('button', 'share-button', 'Create immutable dry-run');
  assess.type = 'button';
  assess.disabled = !plans.length;
  assess.addEventListener('click', async () => {
    if (!selectedChat) {
      showNotice('Start or select a conversation before creating an AI-visible dry-run.');
      return;
    }
    assess.disabled = true;
    state.textContent = 'Replaying graph, resources, hazards, and adapter mappings...';
    try {
      const { payload } = await fetchJson('/api/procedure-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChat,
          procedure_id: select.value,
          note: 'Logical dry-run created from Procedure Studio.'
        })
      });
      const id = payload.assessment.manifest.procedure_assessment_id;
      state.textContent = 'Recorded / ' + payload.assessment.report.status;
      await loadState(false, true);
      renderArchive('procedures');
      await showProcedureAssessmentDetail({ procedure_assessment_id: id });
      if (payload.interaction_error) {
        showNotice('Dry-run recorded, but AI handoff needs review: ' +
          payload.interaction_error.message);
      }
    } catch (error) {
      state.textContent = 'Not recorded / ' + error.message;
      showNotice(error.message);
    } finally {
      assess.disabled = !plans.length;
    }
  });
  card.append(
    fieldLabel('Current frozen plan', select),
    create('p', 'analysis-help',
      'Orders steps, resolves references, totals resources and durations, checks controls and hazard documentation, then previews non-executable XDL and Opentrons mappings.'),
    assess,
    state
  );
  return card;
}

function renderProcedureDecisionBuilder() {
  const card = boardCard('3 / HUMAN DECISION',
    'Record scope without granting machine authority');
  const assessment = create('select', 'analysis-select');
  assessment.setAttribute('aria-label', 'Current procedure assessment');
  const records = (labState?.procedure_assessments ?? [])
    .filter((item) =>
      item.verified && item.current_for_procedure &&
      item.status === 'ready_for_human_review');
  if (!records.length) {
    addSelectOption(assessment, '', 'No current ready assessments');
    assessment.disabled = true;
  } else {
    for (const record of records) {
      addSelectOption(assessment, record.procedure_assessment_id,
        compact(record.procedure_id, 26) + ' / ready for human review');
    }
  }
  const decision = create('select', 'analysis-select');
  addSelectOption(decision, 'approve', 'Approve within selected scope');
  addSelectOption(decision, 'reject', 'Reject / return for revision');
  const scope = create('select', 'analysis-select');
  addSelectOption(scope, 'design_review', 'Design review');
  addSelectOption(scope, 'external_dry_run', 'External vendor dry-run');
  addSelectOption(scope, 'external_physical_execution',
    'External physical execution attestation');

  const reviewer = create('input', 'analysis-input');
  reviewer.placeholder = 'Named reviewer';
  reviewer.maxLength = 240;
  const role = create('input', 'analysis-input');
  role.placeholder = 'Reviewer role and qualification';
  role.maxLength = 240;
  const organization = create('input', 'analysis-input');
  organization.placeholder = 'Organization (optional)';
  organization.maxLength = 500;
  const basis = create('textarea', 'analysis-deviation');
  basis.rows = 3;
  basis.maxLength = 4000;
  basis.placeholder =
    'What exact plan, dry-run, controls, and facility checks were reviewed?';
  const conditions = create('textarea', 'analysis-deviation');
  conditions.rows = 2;
  conditions.maxLength = 4000;
  conditions.placeholder = 'Conditions or required follow-up (optional)';
  const expiry = create('input', 'analysis-input');
  expiry.type = 'datetime-local';
  expiry.value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 16);
  const attest = create('input');
  attest.type = 'checkbox';
  const attestLabel = create('label', 'procedure-attestation');
  attestLabel.append(attest, create('span', '',
    'I understand this is a local attestation only. ScienceCode does not verify my identity or enable hardware.'));
  const state = create('p', 'analysis-action-state',
    'Physical-scope approvals require an expiry of no more than 366 days.');
  const submit = create('button', 'share-button', 'Record human decision');
  submit.type = 'button';
  submit.disabled = !records.length;
  submit.addEventListener('click', async () => {
    if (!selectedChat) {
      showNotice('Start or select a conversation before recording an AI-visible decision.');
      return;
    }
    const selected = records.find((item) =>
      item.procedure_assessment_id === assessment.value);
    if (!selected) {
      showNotice('Select a current verified assessment.');
      return;
    }
    let expiresAt = null;
    if (expiry.value) {
      const parsed = new Date(expiry.value);
      if (Number.isNaN(parsed.getTime())) {
        showNotice('Enter a valid decision expiry.');
        return;
      }
      expiresAt = parsed.toISOString();
    }
    submit.disabled = true;
    state.textContent = 'Binding the decision to exact immutable digests...';
    try {
      const { payload } = await fetchJson('/api/procedure-decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChat,
          note: 'Human decision recorded from Procedure Studio.',
          input: {
            procedure_id: selected.procedure_id,
            procedure_assessment_id: selected.procedure_assessment_id,
            decision: decision.value,
            scope: scope.value,
            reviewer_name: reviewer.value,
            reviewer_role: role.value,
            organization: organization.value || null,
            basis: basis.value,
            conditions: conditions.value || null,
            expires_at: expiresAt,
            attestation: attest.checked
          }
        })
      });
      const id = payload.decision.manifest.procedure_decision_id;
      state.textContent = 'Recorded / ' + id + ' / hardware remains disabled';
      await loadState(false, true);
      renderArchive('procedures');
      await showProcedureDecisionDetail({ procedure_decision_id: id });
      if (payload.interaction_error) {
        showNotice('Decision recorded, but AI handoff needs review: ' +
          payload.interaction_error.message);
      }
    } catch (error) {
      state.textContent = 'Not recorded / ' + error.message;
      showNotice(error.message);
    } finally {
      submit.disabled = !records.length;
    }
  });
  card.append(
    fieldLabel('Current ready assessment', assessment),
    fieldLabel('Decision', decision),
    fieldLabel('Scope', scope),
    fieldLabel('Reviewer name', reviewer),
    fieldLabel('Reviewer role', role),
    fieldLabel('Organization', organization),
    fieldLabel('Basis', basis),
    fieldLabel('Conditions', conditions),
    fieldLabel('Expiry', expiry),
    attestLabel,
    submit,
    state
  );
  return card;
}

function renderProcedureWorkspace() {
  const workspace = create('section', 'procedure-workspace');
  const intro = create('header', 'analysis-workspace-head procedure-workspace-head');
  intro.append(
    create('span', 'section-kicker', 'PLAN / DRY-RUN / HUMAN DECISION'),
    create('h2', '', 'Procedure Studio'),
    create('p', '',
      'Edit a neutral plan, freeze it immutably, inspect a deterministic non-executing dry-run, and record scoped human decisions. ScienceCode never sends commands to laboratory hardware.')
  );
  const workflow = create('div', 'procedure-workflow-grid');
  workflow.append(
    renderProcedureAssessmentBuilder(),
    renderProcedureDecisionBuilder()
  );
  workspace.append(intro, renderProcedurePlanBuilder(), workflow);
  return workspace;
}

function inferenceSelect(values, selected) {
  const select = create('select', 'inference-control');
  for (const [value, label] of values) {
    const option = create('option', '', label);
    option.value = value;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function updateInferenceLauncher(job = activeInferenceJob) {
  const ui = inferenceLauncherUi;
  if (!ui) return;
  const status = job?.status ?? 'ready';
  const active = ACTIVE_JOB_STATUSES.has(status);
  ui.status.className = 'inference-job-status ' + status;
  ui.status.textContent = job
    ? status.toUpperCase() + (job.inference_id ? ' · ' + compact(job.inference_id, 31) : '')
    : 'READY · no accelerator job is running';
  ui.submit.disabled = active;
  ui.stop.hidden = !active;
  ui.stop.disabled = status === 'cancelling';
  ui.stop.textContent = status === 'cancelling' ? 'Stopping inference' : 'Stop inference';
  for (const control of ui.lockedControls) control.disabled = active;
  if (!active) ui.syncMode();
  const events = job?.events ?? [];
  ui.events.replaceChildren();
  if (!events.length) {
    ui.events.append(create('p', 'inference-event-empty',
      'Validated runtime and worker events will appear here.'));
  } else {
    for (const event of events.slice(-6)) {
      const row = create('div', 'inference-event-row ' + (event.status ?? 'recorded'));
      row.append(
        create('span', '', event.type?.startsWith('inference') ? 'NPU' : 'JOB'),
        create('div', '', event.title ?? event.type),
        create('time', '', formatTime(event.timestamp))
      );
      ui.events.append(row);
    }
  }
}

async function pollInferenceJob(jobId) {
  if (inferencePollingJobId === jobId) return;
  inferencePollingJobId = jobId;
  let failures = 0;
  try {
    while (true) {
      try {
        const { payload: job } = await fetchJson('/api/jobs/' + encodeURIComponent(jobId));
        activeInferenceJob = job;
        failures = 0;
        updateInferenceLauncher(job);
        if (!ACTIVE_JOB_STATUSES.has(job.status)) {
          await loadState(false, true);
          if (activeView === 'inferences') {
            renderArchive('inferences');
            const item = labState?.inferences?.find((record) =>
              record.inference_id === job.inference_id
            );
            if (item) showInferenceDetail(item);
          }
          showNotice(job.status === 'completed'
            ? 'Inference completed and its immutable record verified.'
            : job.status === 'cancelled'
              ? 'Inference stopped. Partial artifacts remain recorded and incomplete.'
              : job.error?.message ?? 'Inference failed; inspect its recorded logs.');
          return job;
        }
      } catch (error) {
        failures += 1;
        if (failures >= 4) throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
  } finally {
    if (inferencePollingJobId === jobId) inferencePollingJobId = null;
  }
}

function ensureInferencePolling(job) {
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status) || inferencePollingJobId === job.job_id) return;
  void pollInferenceJob(job.job_id).catch((error) => showNotice(error.message));
}

async function startInferenceFromLauncher() {
  const ui = inferenceLauncherUi;
  if (!ui || ACTIVE_JOB_STATUSES.has(activeInferenceJob?.status)) return;
  const mode = ui.mode.value;
  if (mode === 'run' && (!ui.model.value.trim() || !ui.input.value.trim())) {
    showNotice('Choose project-relative ONNX model and input JSON paths.');
    return;
  }
  const body = {
    mode,
    device: ui.device.value,
    allow_fallback: ui.fallback.checked,
    warmup_iterations: Number(ui.warmup.value),
    iterations: Number(ui.iterations.value),
    timeout_seconds: Number(ui.timeout.value),
    chat_id: ui.share.checked ? selectedChat : null,
    note: ui.note.value.trim() || null
  };
  if (mode === 'run') {
    body.model = ui.model.value.trim();
    body.input = ui.input.value.trim();
  }
  ui.submit.disabled = true;
  ui.status.textContent = 'VALIDATING · project paths, runtime, and execution policy';
  try {
    const { payload } = await fetchJson('/api/inferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    activeInferenceJob = payload;
    updateInferenceLauncher(payload);
    ensureInferencePolling(payload);
  } catch (error) {
    ui.submit.disabled = false;
    updateInferenceLauncher(activeInferenceJob);
    showNotice(error.message);
  }
}

async function cancelInferenceJob() {
  const job = activeInferenceJob;
  if (!job || !['queued', 'running'].includes(job.status)) return;
  activeInferenceJob = { ...job, status: 'cancelling' };
  updateInferenceLauncher(activeInferenceJob);
  try {
    const { payload } = await fetchJson(
      '/api/jobs/' + encodeURIComponent(job.job_id) + '/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'inference',
          chat_id: job.chat_id
        })
      }
    );
    activeInferenceJob = payload;
    updateInferenceLauncher(payload);
    showNotice('Stopping the inference worker; partial artifacts will be preserved.');
  } catch (error) {
    activeInferenceJob = job;
    updateInferenceLauncher(job);
    showNotice(error.message);
  }
}

function renderInferenceLauncher() {
  const workspace = create('section', 'inference-launcher');
  const head = create('header', 'inference-launcher-head');
  const npuReady = Boolean(labState?.compute?.capabilities?.npu_onnx_inference?.ready);
  head.append(
    create('span', 'section-kicker', 'LOCAL ACCELERATOR EXECUTION'),
    create('h2', '', 'Run a recorded ONNX inference'),
    create('p', '',
      'Start with the deterministic smoke or select project-relative model and input files. Strict NPU mode requires profiled Vitis execution; fallback is never implicit.')
  );
  const readiness = create('span', 'inference-readiness ' + (npuReady ? 'ready' : 'attention'),
    npuReady ? 'NPU + VITIS READY' : 'NPU RUNTIME NEEDS ATTENTION');
  head.append(readiness);

  const body = create('div', 'inference-launcher-grid');
  const form = create('form', 'inference-launch-form');
  const mode = inferenceSelect([
    ['smoke', 'Deterministic hardware smoke'],
    ['run', 'Project ONNX model']
  ], 'smoke');
  const device = inferenceSelect([
    ['npu', 'Strict NPU / no silent fallback'],
    ['auto', 'Prefer NPU / record fallback'],
    ['cpu', 'CPU baseline']
  ], 'npu');
  const model = create('input', 'inference-control');
  model.type = 'text';
  model.maxLength = 4096;
  model.placeholder = 'models/candidate-ranker.onnx';
  const input = create('input', 'inference-control');
  input.type = 'text';
  input.maxLength = 4096;
  input.placeholder = 'inputs/candidate-batch.json';
  const warmup = create('input', 'inference-control');
  warmup.type = 'number';
  warmup.min = '0';
  warmup.max = '1000';
  warmup.value = '1';
  const iterations = create('input', 'inference-control');
  iterations.type = 'number';
  iterations.min = '1';
  iterations.max = '1000';
  iterations.value = '3';
  const timeout = create('input', 'inference-control');
  timeout.type = 'number';
  timeout.min = '1';
  timeout.max = '86400';
  timeout.value = '900';
  const fallback = create('input');
  fallback.type = 'checkbox';
  fallback.checked = false;
  const fallbackLabel = create('label', 'inference-check');
  fallbackLabel.append(
    fallback,
    create('span', '', 'Permit fallback, but record and label it explicitly')
  );
  const share = create('input');
  share.type = 'checkbox';
  share.checked = Boolean(selectedChat);
  share.disabled = !selectedChat;
  const shareLabel = create('label', 'inference-check');
  shareLabel.append(
    share,
    create('span', '', selectedChat
      ? 'Share the immutable result with the selected conversation'
      : 'Select a conversation to share this result with the AI')
  );
  const note = create('textarea', 'inference-control inference-note');
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = 'Optional scientific direction for the selected conversation…';
  const modelField = fieldLabel('Project model path', model);
  const inputField = fieldLabel('Project input JSON', input);
  const noteField = fieldLabel('AI-visible direction', note);
  modelField.classList.add('inference-field-wide');
  inputField.classList.add('inference-field-wide');
  noteField.classList.add('inference-field-full');
  form.append(
    fieldLabel('Execution', mode),
    fieldLabel('Accelerator policy', device),
    fieldLabel('Warmup iterations', warmup),
    modelField,
    fieldLabel('Measured iterations', iterations),
    inputField,
    fieldLabel('Timeout seconds', timeout),
    fallbackLabel,
    shareLabel,
    noteField
  );
  const actions = create('div', 'inference-launch-actions');
  const submit = create('button', 'share-button', 'Run recorded inference');
  submit.type = 'submit';
  const stop = create('button', 'stop-button', 'Stop inference');
  stop.type = 'button';
  stop.hidden = true;
  actions.append(submit, stop);
  form.append(actions);

  const monitor = create('aside', 'inference-monitor');
  monitor.append(
    create('span', 'board-label', 'LIVE ACCELERATOR JOB'),
    create('h3', '', 'Runtime and provenance trace')
  );
  const status = create('p', 'inference-job-status ready');
  const events = create('div', 'inference-events');
  monitor.append(status, events);
  body.append(form, monitor);
  workspace.append(head, body);

  const lockedControls = [mode, device, model, input, warmup, iterations, timeout, fallback, share, note];
  const syncMode = () => {
    const smoke = mode.value === 'smoke';
    model.disabled = smoke;
    input.disabled = smoke;
    fallback.disabled = device.value === 'cpu';
    share.disabled = !selectedChat;
    if (device.value === 'cpu') fallback.checked = false;
  };
  inferenceLauncherUi = {
    mode,
    device,
    model,
    input,
    warmup,
    iterations,
    timeout,
    fallback,
    share,
    note,
    submit,
    stop,
    status,
    events,
    lockedControls,
    syncMode
  };
  mode.addEventListener('change', syncMode);
  device.addEventListener('change', syncMode);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void startInferenceFromLauncher();
  });
  stop.addEventListener('click', () => void cancelInferenceJob());
  const recovered = ACTIVE_JOB_STATUSES.has(activeInferenceJob?.status)
    ? activeInferenceJob
    : labState?.inference_jobs?.find((job) => ACTIVE_JOB_STATUSES.has(job.status)) ?? null;
  if (recovered) activeInferenceJob = recovered;
  syncMode();
  updateInferenceLauncher(activeInferenceJob);
  ensureInferencePolling(activeInferenceJob);
  return workspace;
}

function renderArchive(kind) {
  elements.archiveList.replaceChildren();
  elements.recordDetail.hidden = true;
  elements.recordDetail.replaceChildren();
  if (kind === 'reproducibility') {
    elements.archiveKicker.textContent = 'AUDIT-BOUND PROJECT BASELINES';
    elements.archiveTitle.textContent = 'Reproducibility';
    elements.archiveSummary.textContent =
      'Capture immutable SHA-256 project baselines, verify their audit binding, and review strict file drift without blocking the Lab.';
    elements.archiveList.append(renderReproducibilityWorkspace({
      initialJob: labState?.project_snapshot_job,
      request: fetchJson,
      notify: showNotice,
      isActive: () => activeView === 'reproducibility',
      onJobUpdate: (job) => {
        if (!labState) return;
        labState.project_snapshot_job = job;
        renderSnapshotCount();
      },
      onSnapshotCount: (count) => {
        if (!labState?.counts) return;
        labState.counts.project_snapshots = Number(count ?? 0);
        renderSnapshotCount();
      }
    }));
    return;
  }
  if (kind === 'verification') {
    elements.archiveKicker.textContent = 'AUTHORITATIVE PROJECT RELEASE GATE';
    elements.archiveTitle.textContent = 'Verification Center';
    elements.archiveSummary.textContent =
      'Run the complete project verifier without leaving the Lab, inspect exact bounded blockers, and distinguish immutable integrity failures from explicit failed-outcome policy.';
    elements.archiveList.append(renderVerificationWorkspace({
      initialJob: labState?.project_gate_job,
      request: fetchJson,
      notify: showNotice,
      isActive: () => activeView === 'verification',
      onJobUpdate: (job) => {
        if (!labState) return;
        labState.project_gate_job = job;
        renderVerificationCount();
      }
    }));
    return;
  }
  if (kind === 'cad') {
    elements.archiveKicker.textContent = 'PARAMETRIC DESIGN + ADDITIVE MANUFACTURING';
    elements.archiveTitle.textContent = 'CAD Studio';
    elements.archiveSummary.textContent =
      'One multi-engine OpenSCAD/CadQuery environment for user and AI edits, immutable verified STL/STEP builds, interactive mesh inspection, recorded models and parameter studies, and non-transmitted slicing.';
    elements.archiveList.append(renderCadWorkspace({
      state: labState,
      selectedChat,
      request: fetchJson,
      notify: showNotice,
      refreshState: () => loadState(false, true),
      rerender: () => renderArchive('cad'),
      isActive: () => activeView === 'cad',
      saveInteraction,
      openMesh: openThreeDStudio,
      openCode: openCodeStudio,
      refreshHarness: async (chatId) => {
        if (!chatId || selectedChat !== chatId) return;
        const { payload } = await fetchJson(
          '/api/chats/' + encodeURIComponent(chatId) + '/harness'
        );
        activeHarness = payload;
        renderHarness(activeHarness);
      }
    }));
    return;
  }
  if (kind === 'campaigns') {
    elements.archiveKicker.textContent = 'CHECKPOINTED RESEARCH CAMPAIGNS';
    elements.archiveTitle.textContent = 'Research Campaigns';
    elements.archiveSummary.textContent =
      'Freeze falsifiable plans, approve bounded tasks, and watch each exact AI turn across CPU, GPU, and NPU work.';
    elements.archiveList.append(renderCampaignWorkspace({
      state: labState,
      selectedChat,
      request: fetchJson,
      notify: showNotice,
      refreshState: () => loadState(false, true),
      rerender: () => renderArchive('campaigns'),
      isActive: () => activeView === 'campaigns',
      refreshHarness: async (chatId) => {
        if (!chatId || selectedChat !== chatId) return;
        const { payload } = await fetchJson(
          '/api/chats/' + encodeURIComponent(chatId) + '/harness'
        );
        activeHarness = payload;
        renderHarness(activeHarness);
      }
    }));
    for (const item of labState?.campaigns ?? []) {
      elements.archiveList.append(archiveCard(
        item.title ?? item.campaign_id,
        'RESEARCH CAMPAIGN',
        [
          String(item.counts?.completed ?? 0) + '/' +
            String(Object.values(item.counts ?? {}).reduce((total, value) =>
              total + (Number.isFinite(value) ? value : 0), 0)) + ' task states',
          String(item.budget?.used_gpu_tasks ?? 0) + '/' +
            String(item.budget?.max_gpu_tasks ?? 0) + ' GPU · ' +
            String(item.budget?.used_npu_tasks ?? 0) + '/' +
            String(item.budget?.max_npu_tasks ?? 0) + ' NPU',
          compact(item.question ?? 'No research question recorded', 88)
        ],
        item.verified ? item.status : 'attention',
        () => void openCampaign(item.campaign_id)
      ));
    }
    return;
  }
  if (kind === 'experiments') {
    elements.archiveKicker.textContent = 'PARAMETER MATRICES';
    elements.archiveTitle.textContent = 'Experiments';
    elements.archiveSummary.textContent =
      'Hypotheses, branches, aggregate results, and deterministic review.';
    elements.archiveList.append(renderScientificComputeWorkspace({
      kind: 'experiment',
      state: labState,
      selectedChat,
      request: fetchJson,
      notify: showNotice,
      refreshState: () => loadState(false, true),
      rerender: () => renderArchive('experiments'),
      isActive: (jobKind) => activeView ===
        (jobKind === 'experiment' ? 'experiments' : 'simulations'),
      openRecord: (jobKind, recordId) => {
        const item = jobKind === 'experiment'
          ? labState?.experiments?.find((record) => record.experiment_id === recordId)
          : labState?.simulations?.find((record) => record.simulation_id === recordId);
        if (item) {
          if (jobKind === 'experiment') showExperimentDetail(item);
          else showSimulationDetail(item);
        }
      }
    }));
    const records = labState?.experiments ?? [];
    if (!records.length) {
      renderEmptyArchive(
        'No recorded experiments',
        'Configure the bounded launcher above or install a simulation starter first.'
      );
      return;
    }
    for (const item of records) {
      elements.archiveList.append(archiveCard(
        item.name ?? item.experiment_id,
        'EXPERIMENT',
        [(item.counts?.completed ?? 0) + '/' + (item.counts?.planned ?? 0) + ' branches',
          compact(item.hypothesis ?? 'No hypothesis recorded', 88)],
        item.verified ? item.status : 'attention',
        () => showExperimentDetail(item)
      ));
    }
    return;
  }
  if (kind === 'analysis') {
    elements.archiveKicker.textContent = 'PREREGISTERED OUTCOMES';
    elements.archiveTitle.textContent = 'Confirmatory analysis';
    elements.archiveSummary.textContent =
      'Freeze primary outcomes before compute, bind exact experiments, replay thresholds, and disclose deviations.';
    elements.archiveList.append(renderConfirmatoryWorkspace());
    const preregistrations = labState?.preregistrations ?? [];
    for (const item of preregistrations) {
      elements.archiveList.append(archiveCard(
        item.name ?? item.preregistration_id,
        'FROZEN PREREGISTRATION',
        [
          String(item.source_kind ?? 'project_file').replaceAll('_', ' ') + ' source',
          Number(item.bytes ?? 0).toLocaleString() + ' bytes',
          item.verified ? String(item.source_status ?? 'verified') :
            String(item.verification_errors?.[0]?.issue ?? 'integrity attention')
        ],
        item.verified ? 'completed' : 'attention',
        () => showPreregistrationDetail(item)
      ));
    }
    const contracts = labState?.analysis_contracts ?? [];
    for (const item of contracts) {
      elements.archiveList.append(archiveCard(
        item.name ?? item.analysis_contract_id,
        'FROZEN ANALYSIS CONTRACT',
        [
          String(item.counts?.primary ?? 0) + ' primary outcome(s)',
          compact(item.preregistration_id ?? 'no preregistration', 34),
          item.source_status === 'unchanged' ? 'script unchanged' :
            'script source ' + String(item.source_status ?? 'unknown')
        ],
        item.verified ? 'completed' : 'attention',
        () => showAnalysisContractDetail(item)
      ));
    }
    const assessments = labState?.confirmatory_assessments ?? [];
    for (const item of assessments) {
      const historical = Boolean(item.superseded_by);
      const card = archiveCard(
        compact(item.analysis_contract_id, 34) + ' → ' + compact(item.experiment_id, 24),
        historical
          ? 'CONFIRMATORY ASSESSMENT · HISTORICAL'
          : 'CONFIRMATORY ASSESSMENT · CURRENT',
        [
          String(item.registration_status ?? 'unknown') + ' registration',
          'primary verdict ' + String(item.outcome_verdict ?? 'unknown'),
          historical ? 'superseded by ' + compact(item.superseded_by, 28) :
            'record status ' + String(item.status)
        ],
        item.verified && (historical || item.status === 'pass') ? 'completed' : 'attention',
        () => showConfirmatoryAssessmentDetail(item)
      );
      if (historical) card.classList.add('historical');
      elements.archiveList.append(card);
    }
    if (!preregistrations.length && !contracts.length && !assessments.length) {
      const empty = create('div', 'archive-empty analysis-empty');
      empty.append(create('strong', '', 'No frozen analysis records yet'),
        create('p', '', 'Start with the structured preregistration template above.'));
      elements.archiveList.append(empty);
    }
    return;
  }
  if (kind === 'procedures') {
    elements.archiveKicker.textContent = 'STRUCTURED METHOD GOVERNANCE';
    elements.archiveTitle.textContent = 'Procedure Studio';
    elements.archiveSummary.textContent =
      'Editable neutral plans, immutable logical dry-runs, non-executable automation mappings, and scoped human decisions.';
    elements.archiveList.append(renderProcedureWorkspace());
    const plans = labState?.procedures ?? [];
    for (const item of plans) {
      const historical = !item.current;
      const card = archiveCard(
        item.name ?? item.procedure_id,
        historical ? 'PROCEDURE PLAN / HISTORICAL' : 'PROCEDURE PLAN / CURRENT',
        [
          String(item.domain ?? 'general').replaceAll('_', ' '),
          String(item.counts?.steps ?? 0) + ' steps / ' +
            String(item.counts?.hazards ?? 0) + ' hazards',
          historical ? 'superseded by ' + compact(item.superseded_by, 28) :
            'physical execution disabled'
        ],
        item.verified ? historical ? 'completed' : 'pass' : 'attention',
        () => showProcedureDetail(item)
      );
      if (historical) card.classList.add('historical');
      elements.archiveList.append(card);
    }
    const assessments = labState?.procedure_assessments ?? [];
    for (const item of assessments) {
      const historical = !item.current_for_procedure;
      const card = archiveCard(
        item.procedure_assessment_id,
        historical
          ? 'LOGICAL DRY-RUN / HISTORICAL'
          : 'LOGICAL DRY-RUN / CURRENT',
        [
          String(item.summary?.gates_passed ?? 0) + ' gates passed / ' +
            String(item.summary?.errors ?? 0) + ' blockers',
          String(item.adapters?.filter((adapter) => adapter.requested).length ?? 0) +
            ' adapter preview(s)',
          historical ? 'superseded by ' + compact(item.superseded_by, 28) :
            'physical execution disabled'
        ],
        item.verified && (historical || item.status === 'ready_for_human_review')
          ? 'completed' : 'attention',
        () => showProcedureAssessmentDetail(item)
      );
      if (historical) card.classList.add('historical');
      elements.archiveList.append(card);
    }
    const decisions = labState?.procedure_decisions ?? [];
    for (const item of decisions) {
      const historical = !item.current_for_scope;
      const card = archiveCard(
        item.procedure_decision_id,
        historical ? 'HUMAN DECISION / HISTORICAL' : 'HUMAN DECISION / CURRENT',
        [
          String(item.status) + ' / ' + String(item.scope).replaceAll('_', ' '),
          'effective state: ' + String(item.effective_status).replaceAll('_', ' '),
          item.expires_at ? 'expires ' + formatDate(item.expires_at) :
            'no expiry recorded'
        ],
        item.effective ? 'pass' :
          item.status === 'rejected' ? 'rejected' : 'attention',
        () => showProcedureDecisionDetail(item)
      );
      if (historical) card.classList.add('historical');
      elements.archiveList.append(card);
    }
    if (!plans.length && !assessments.length && !decisions.length) {
      const empty = create('div', 'archive-empty procedure-empty');
      empty.append(
        create('strong', '', 'No immutable procedure records yet'),
        create('p', '', 'Start with the editable, source-linked template above.')
      );
      elements.archiveList.append(empty);
    }
    return;
  }
  if (kind === 'inferences') {
    elements.archiveKicker.textContent = 'PROFILED LOCAL AI ACCELERATION';
    elements.archiveTitle.textContent = 'AI Inference';
    elements.archiveSummary.textContent =
      'Immutable ONNX models, exact inputs and outputs, driver/runtime provenance, and profiled provider-event attribution.';
    elements.archiveList.append(renderInferenceLauncher());
    const records = labState?.inferences ?? [];
    if (!records.length) {
      renderEmptyArchive('No recorded AI inferences');
      return;
    }
    for (const item of records) {
      const profileEventCounts = item.provider_verification?.profile_event_counts ??
        item.provider_verification?.node_counts ?? {};
      const providerEvents = profileEventCounts.VitisAIExecutionProvider ?? 0;
      elements.archiveList.append(archiveCard(
        item.model?.path ?? item.model?.source ?? item.inference_id,
        item.kind === 'hardware_smoke' ? 'NPU HARDWARE SMOKE' : 'ONNX INFERENCE',
        [
          item.provider_verification?.npu_executed
            ? String(providerEvents) + ' Vitis AI profile event(s)'
            : 'NPU execution not claimed',
          Number.isFinite(item.execution?.latency_ms?.mean)
            ? formatPlotNumber(item.execution.latency_ms.mean) + ' ms mean'
            : 'latency unavailable',
          item.provider_verification?.fallback_detected ? 'fallback detected' : 'no fallback detected'
        ],
        item.verified && item.status === 'completed' ? 'completed' : 'attention',
        () => showInferenceDetail(item)
      ));
    }
    return;
  }
  if (kind === 'simulations') {
    elements.archiveKicker.textContent = 'IMMUTABLE RUNS';
    elements.archiveTitle.textContent = 'Simulations';
    elements.archiveSummary.textContent =
      'Recorded inputs, environment, device, seed, outputs, and integrity checks.';
    elements.archiveList.append(renderScientificComputeWorkspace({
      kind: 'simulation',
      state: labState,
      selectedChat,
      request: fetchJson,
      notify: showNotice,
      refreshState: () => loadState(false, true),
      rerender: () => renderArchive('simulations'),
      isActive: (jobKind) => activeView ===
        (jobKind === 'experiment' ? 'experiments' : 'simulations'),
      openRecord: (jobKind, recordId) => {
        const item = jobKind === 'experiment'
          ? labState?.experiments?.find((record) => record.experiment_id === recordId)
          : labState?.simulations?.find((record) => record.simulation_id === recordId);
        if (item) {
          if (jobKind === 'experiment') showExperimentDetail(item);
          else showSimulationDetail(item);
        }
      }
    }));
    const records = labState?.simulations ?? [];
    if (!records.length) {
      renderEmptyArchive(
        'No recorded simulations',
        'Install an exact starter or configure a project Python model above.'
      );
      return;
    }
    for (const item of records) {
      elements.archiveList.append(archiveCard(
        item.summary?.model ?? item.simulation_id,
        'SIMULATION',
        [item.device?.name ?? item.device?.selected ?? 'device not recorded',
          'seed ' + (item.seed ?? '—'), formatDuration(item.duration_ms)],
        item.verified ? item.status : 'attention',
        () => showSimulationDetail(item)
      ));
    }
    return;
  }
  if (kind === 'notebook') {
    elements.archiveKicker.textContent = 'PERSISTENT PROJECT KERNELS';
    elements.archiveTitle.textContent = 'Notebook workspace';
    elements.archiveSummary.textContent =
      'Run inspectable Python or R cells, preserve live variables across turns, and share verified state with the AI.';
    elements.archiveList.append(renderNotebookWorkspace());
    return;
  }
  if (kind === 'reviews') {
    elements.archiveKicker.textContent = 'INDEPENDENT CONSISTENCY';
    elements.archiveTitle.textContent = 'Scientific reviewer';
    elements.archiveSummary.textContent =
      'Immutable claim, citation, number, calculation, data, and figure traceability reviews.';
    const records = labState?.reviews ?? [];
    if (!records.length) return renderEmptyArchive('No semantic reviews yet');
    for (const item of records) {
      const counts = item.counts ?? {};
      const historical = Boolean(item.superseded_by);
      elements.archiveList.append(archiveCard(
        item.target?.name ?? item.review_id,
        historical ? 'SEMANTIC REVIEW · HISTORICAL' : 'SEMANTIC REVIEW · CURRENT',
        [
          String(counts.claims ?? 0) + ' claims',
          String(counts.verified_citations ?? 0) + '/' + String(counts.citations ?? 0) + ' citations verified',
          historical
            ? 'superseded by ' + compact(item.superseded_by, 28)
            : String(counts.findings ?? 0) + ' findings · ' + String(item.status ?? 'review')
        ],
        item.verified && (historical || item.status === 'pass') ? 'completed' : 'attention',
        () => showSemanticReviewDetail(item)
      ));
    }
    return;
  }
  elements.archiveKicker.textContent = 'CLAIM SUPPORT';
  elements.archiveTitle.textContent = 'Evidence';
  elements.archiveSummary.textContent =
    'Immutable local sources with page-level text, deterministic retrieval, and AI-visible selections.';
  elements.archiveList.append(renderEvidenceTools());
  const evidence = labState?.evidence ?? [];
  if (!evidence.length) return;
  for (const item of evidence) {
    elements.archiveList.append(archiveCard(
      item.title,
      String(item.kind).toUpperCase(),
      [item.pages + ' pages', item.spans + ' spans', item.doi ?? 'local source'],
      item.verified ? 'completed' : 'attention',
      () => showEvidenceDetail(item)
    ));
  }
}

function semanticReviewArtifact(detail) {
  const manifest = detail.manifest ?? detail;
  return {
    kind: 'review',
    record_id: manifest.review_id,
    name: 'Semantic review · ' + (manifest.target?.name ?? manifest.review_id),
    url: '/api/reviews/' + encodeURIComponent(manifest.review_id)
  };
}

function semanticReviewInteractionPayload(detail, note = '') {
  const manifest = detail.manifest ?? detail;
  const report = detail.report ?? {};
  return {
    review_id: manifest.review_id,
    status: report.status ?? manifest.status,
    target_url: manifest.target?.url ?? null,
    target_sha256: manifest.target?.sha256 ?? null,
    report_sha256: manifest.report?.sha256 ?? detail.verification?.report_sha256 ?? null,
    counts: report.summary ?? manifest.counts ?? {},
    findings: (report.findings ?? []).slice(0, 24).map((finding) => ({
      finding_id: finding.finding_id,
      severity: finding.severity,
      category: finding.category,
      code: finding.code,
      claim_id: finding.claim_id,
      line_start: finding.line_start,
      message: compact(finding.message, 360)
    })),
    findings_truncated: (report.findings?.length ?? 0) > 24,
    note: note.trim() || null,
    interpretation: 'deterministic triage; inspect the exact record before changing a scientific conclusion'
  };
}

async function runSemanticReview({ artifact, revisionId } = {}) {
  if (!selectedChat) {
    showNotice('Start or select a conversation before recording a semantic review.');
    return null;
  }
  try {
    const body = { chat_id: selectedChat };
    if (revisionId) body.revision_id = revisionId;
    else body.source = artifact;
    const { payload } = await fetchJson('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    await loadState(false, true);
    await refreshHarnessAfterRevision();
    if (payload.interaction_error) {
      showNotice('Review saved, but AI handoff needs attention: ' + payload.interaction_error.message);
    } else {
      showNotice('Independent review recorded and shared with the next AI turn.');
    }
    return payload.review;
  } catch (error) {
    showNotice(error.message);
    return null;
  }
}

function reviewFindingRow(finding) {
  const row = create('article', 'semantic-finding ' + finding.severity);
  const head = create('header');
  head.append(
    create('span', 'semantic-severity', String(finding.severity ?? 'review').toUpperCase()),
    create('strong', '', String(finding.code ?? 'consistency finding').replaceAll('_', ' ')),
    create('small', '', [
      finding.category,
      finding.claim_id,
      finding.line_start ? 'line ' + finding.line_start : null
    ].filter(Boolean).join(' · '))
  );
  row.append(head, create('p', '', finding.message));
  if (finding.missing_numbers?.length) {
    row.append(create('code', 'semantic-finding-data',
      'Missing literals: ' + finding.missing_numbers.map((item) => item.raw).join(', ')));
  }
  return row;
}

function reviewTraceRow(kind, item) {
  const row = create('article', 'semantic-trace-row ' + item.status);
  const main = create('div');
  main.append(create('strong', '', item.label || item.artifact?.name || item.target),
    create('small', '', [
      kind,
      item.status,
      item.traceability,
      item.literal_number_check
    ].filter(Boolean).join(' · ')));
  if (item.url) {
    const open = create('a', 'quiet-button', 'Open');
    open.href = item.url;
    open.target = '_blank';
    open.rel = 'noreferrer';
    row.append(main, open);
  } else row.append(main);
  return row;
}

async function showSemanticReviewDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading', 'Loading independent semantic review…'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/reviews/' + encodeURIComponent(item.review_id)
    );
    const manifest = detail.manifest;
    const report = detail.report;
    const summary = report.summary ?? {};
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      item.superseded_by ? 'HISTORICAL SEMANTIC REVIEW' : 'INDEPENDENT SEMANTIC REVIEW',
      manifest.target?.name ?? manifest.review_id,
      manifest.review_id + ' · ' + formatDate(manifest.created_at)
    ));
    if (item.superseded_by) {
      const historical = boardCard('HISTORICAL RESULT', 'Newer verified review available');
      historical.classList.add('semantic-review-boundary');
      historical.append(
        create('p', '', 'A newer verified review exists for the same immutable target and conversation. This record remains replayable and unchanged.'),
        create('button', 'interactive-link', 'Open current review')
      );
      historical.lastChild.type = 'button';
      historical.lastChild.addEventListener('click', () => {
        const current = (labState?.reviews ?? []).find((review) =>
          review.review_id === item.superseded_by
        );
        if (current) showSemanticReviewDetail(current);
      });
      elements.recordDetail.append(historical);
    }
    const metrics = create('div', 'detail-metrics semantic-review-metrics');
    metrics.append(
      metric('Status', String(report.status).toUpperCase()),
      metric('Claims', summary.claims ?? 0),
      metric('Citations', (summary.verified_citations ?? 0) + '/' + (summary.citations ?? 0)),
      metric('Findings', summary.findings ?? 0),
      metric('Integrity', detail.verification.ok ? 'verified' : 'invalid')
    );
    elements.recordDetail.append(metrics);

    const actions = create('div', 'semantic-review-actions');
    const source = create('a', 'interactive-link', 'Open reviewed artifact');
    source.href = manifest.target.url;
    source.target = '_blank';
    source.rel = 'noreferrer';
    const note = create('textarea', 'semantic-review-note');
    note.rows = 2;
    note.maxLength = 2_000;
    note.placeholder = 'Optional direction: prioritize calculation errors, inspect a citation, or revise a claim.';
    const share = create('button', 'share-button', 'Share review direction with AI');
    share.type = 'button';
    share.disabled = !detail.verification.ok;
    share.addEventListener('click', async () => {
      const interaction = await saveInteraction(
        'review',
        'semantic-review.shared',
        semanticReviewArtifact(detail),
        semanticReviewInteractionPayload(detail, note.value)
      );
      if (interaction) {
        note.value = '';
        share.textContent = 'Shared · ' + interaction.interaction_id;
      }
    });
    actions.append(source, note, share);
    elements.recordDetail.append(actions);

    const epistemic = boardCard('REVIEW BOUNDARY', 'Triage, not scientific proof');
    epistemic.classList.add('semantic-review-boundary');
    epistemic.append(create('p', '',
      'The record verifies locators, hashes, literal values, explicit arithmetic, and artifact traceability. Lexical overlap does not establish support or refutation; inspect the cited passage and scientific context.'));
    elements.recordDetail.append(epistemic);

    const findingCard = boardCard('PRIORITY FINDINGS',
      String(summary.errors ?? 0) + ' errors · ' + String(summary.warnings ?? 0) + ' warnings');
    findingCard.classList.add('semantic-review-findings');
    const filters = create('div', 'semantic-review-filters');
    const findingList = create('div', 'semantic-finding-list');
    const renderFindings = (filter) => {
      findingList.replaceChildren();
      const visible = (report.findings ?? []).filter((finding) =>
        filter === 'all' || finding.severity === filter
      );
      if (!visible.length) {
        findingList.append(create('p', 'pane-placeholder', 'No ' + filter + ' findings.'));
      } else {
        for (const finding of visible) findingList.append(reviewFindingRow(finding));
      }
      for (const button of filters.querySelectorAll('button')) {
        button.classList.toggle('active', button.dataset.filter === filter);
      }
    };
    for (const [filter, label] of [
      ['all', 'All ' + String(summary.findings ?? 0)],
      ['error', 'Errors ' + String(summary.errors ?? 0)],
      ['warning', 'Warnings ' + String(summary.warnings ?? 0)],
      ['info', 'Info ' + String(summary.info ?? 0)]
    ]) {
      const button = create('button', '', label);
      button.type = 'button';
      button.dataset.filter = filter;
      button.addEventListener('click', () => renderFindings(filter));
      filters.append(button);
    }
    findingCard.append(filters, findingList);
    elements.recordDetail.append(findingCard);
    renderFindings('all');

    const claimCard = boardCard('CLAIM → EVIDENCE MAP',
      String(summary.claims_with_citations ?? 0) + '/' +
      String(summary.claims_requiring_citation ?? 0) + ' citation-bearing required claims');
    claimCard.classList.add('semantic-claim-map');
    const claims = (report.claims ?? []).slice(0, 400);
    if (!claims.length) claimCard.append(create('p', 'pane-placeholder', 'No reviewable prose claims detected.'));
    for (const claim of claims) {
      const row = create('article', 'semantic-claim');
      const head = create('header');
      head.append(create('code', '', claim.claim_id),
        create('span', '', 'lines ' + claim.line_start + '–' + claim.line_end),
        create('span', claim.requires_citation ? 'required' : 'context',
          claim.requires_citation ? 'citation expected' : 'context'));
      row.append(head, create('p', '', claim.text));
      const citations = (report.citations ?? []).filter((citation) =>
        citation.claim_id === claim.claim_id
      );
      for (const citation of citations) {
        const citationRow = create('div', 'semantic-citation ' + (citation.ok ? 'verified' : 'invalid'));
        if (!citation.ok) {
          citationRow.append(create('strong', '', 'Unresolved citation'),
            create('small', '', citation.issue ?? 'verification failed'));
        } else {
          const top = create('div');
          const open = create('button', 'semantic-citation-link',
            citation.bibliography?.title ?? citation.evidence_id);
          open.type = 'button';
          open.addEventListener('click', () => showEvidenceDetail(
            { evidence_id: citation.evidence_id },
            { page: citation.page, span_id: citation.span_id }
          ));
          top.append(open, create('span', '',
            'page ' + citation.page + ' · ' +
            String(citation.alignment?.label ?? '').replaceAll('_', ' ') + ' · ' +
            Number(citation.alignment?.score ?? 0).toFixed(2)));
          citationRow.append(top, create('blockquote', '', citation.evidence_excerpt));
        }
        row.append(citationRow);
      }
      claimCard.append(row);
    }
    if ((report.claims?.length ?? 0) > claims.length) {
      claimCard.append(create('p', 'semantic-display-limit',
        'Showing the first ' + claims.length + ' claims; the immutable report retains all bounded claims.'));
    }
    elements.recordDetail.append(claimCard);

    const calculationCard = boardCard('CALCULATIONS',
      String(summary.calculations_passed ?? 0) + '/' + String(summary.calculations ?? 0) + ' passed');
    calculationCard.classList.add('semantic-calculations');
    if (!report.calculations?.length) {
      calculationCard.append(create('p', 'pane-placeholder',
        'No explicit {{calc: expression = expected}} directives were present.'));
    }
    for (const calculation of report.calculations ?? []) {
      const row = create('article', 'semantic-calculation ' + calculation.status);
      row.append(create('code', '', calculation.raw),
        create('span', '', calculation.status === 'pass'
          ? 'Verified result ' + calculation.actual
          : calculation.status === 'mismatch'
            ? 'Computed ' + calculation.actual + '; recorded ' + calculation.expected
            : calculation.detail ?? calculation.issue));
      calculationCard.append(row);
    }
    elements.recordDetail.append(calculationCard);

    const traceCard = boardCard('ARTIFACT TRACEABILITY',
      String(report.artifacts?.counts?.verified ?? 0) + ' verified · ' +
      String(report.artifacts?.counts?.unresolved ?? 0) + ' unresolved');
    traceCard.classList.add('semantic-traces');
    for (const [kind, values] of [
      ['figure', report.artifacts?.figures ?? []],
      ['data', report.artifacts?.data ?? []],
      ['code', report.artifacts?.code ?? []]
    ]) {
      for (const value of values) traceCard.append(reviewTraceRow(kind, value));
    }
    if (!traceCard.querySelector('.semantic-trace-row')) {
      traceCard.append(create('p', 'pane-placeholder', 'No scientific artifact links were detected.'));
    }
    elements.recordDetail.append(traceCard);

    const limits = boardCard('LIMITATIONS', 'What this reviewer does not establish');
    for (const limitation of report.limitations ?? []) {
      limits.append(create('p', 'limitation', limitation));
    }
    elements.recordDetail.append(limits);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

function labeledInput(label, name, placeholder, required = false) {
  const wrapper = create('label', 'evidence-field');
  wrapper.append(create('span', '', label));
  const input = create('input');
  input.name = name;
  input.placeholder = placeholder;
  input.required = required;
  input.autocomplete = 'off';
  wrapper.append(input);
  return { wrapper, input };
}

function renderEvidenceTools() {
  const tools = create('section', 'evidence-tools');
  const head = create('div', 'evidence-tools-head');
  head.append(create('div', '', ''), create('strong', '', 'Local evidence workspace'));
  head.firstChild.append(create('span', 'section-kicker', 'INGEST + RETRIEVE'),
    create('p', '', 'Add a project-relative PDF or text source, then search its verified page spans.'));
  tools.append(head);

  const searchForm = create('form', 'evidence-search-form');
  const search = create('input');
  search.type = 'search';
  search.name = 'query';
  search.required = true;
  search.placeholder = 'Search mechanisms, methods, targets, claims…';
  search.setAttribute('aria-label', 'Search evidence');
  const searchButton = create('button', 'secondary-button', 'Search library');
  searchButton.type = 'submit';
  searchForm.append(search, searchButton);
  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    searchButton.disabled = true;
    try {
      const query = search.value.trim();
      const params = new URLSearchParams({ q: query, limit: '12' });
      const { payload } = await fetchJson('/api/evidence/search?' + params);
      renderEvidenceSearchResults(payload);
    } catch (error) {
      showNotice(error.message);
    } finally {
      searchButton.disabled = false;
    }
  });
  tools.append(searchForm);

  const details = create('details', 'evidence-ingest');
  details.append(create('summary', '', 'Add a source already in this project'));
  const form = create('form', 'evidence-ingest-form');
  const source = labeledInput('Project-relative path', 'source', 'papers/study.pdf', true);
  const title = labeledInput('Title (optional)', 'title', 'Study title');
  const doi = labeledInput('DOI (optional)', 'doi', '10.1000/example');
  const authors = labeledInput('Authors (semicolon separated)', 'authors', 'A. Researcher; B. Scientist');
  const year = labeledInput('Year (optional)', 'year', '2026');
  year.input.inputMode = 'numeric';
  const submit = create('button', 'run-button', 'Ingest immutable source');
  submit.type = 'submit';
  form.append(source.wrapper, title.wrapper, doi.wrapper, authors.wrapper, year.wrapper, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const body = {
        source: source.input.value.trim(),
        title: title.input.value.trim() || undefined,
        doi: doi.input.value.trim() || undefined,
        authors: authors.input.value.split(';').map((value) => value.trim()).filter(Boolean),
        year: year.input.value.trim() || undefined
      };
      const { payload } = await fetchJson('/api/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await loadState(false, true);
      renderArchive('evidence');
      showNotice('Evidence ingested, hashed, and added to deterministic retrieval.');
      await showEvidenceDetail({ evidence_id: payload.manifest.evidence_id });
    } catch (error) {
      showNotice(error.message);
    } finally {
      submit.disabled = false;
    }
  });
  details.append(form);
  tools.append(details);
  return tools;
}

function renderEvidenceSearchResults(search) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(detailHeader('DETERMINISTIC RETRIEVAL',
    search.results.length + ' matching span' + (search.results.length === 1 ? '' : 's'),
    'Query: ' + search.query + ' · corpus ' + compact(search.corpus_sha256, 18)));
  const list = create('div', 'evidence-search-results');
  if (!search.results.length) {
    list.append(create('p', 'pane-placeholder', 'No verified evidence spans matched this query.'));
  }
  for (const result of search.results) {
    const card = create('button', 'evidence-result');
    card.type = 'button';
    const head = create('span', 'evidence-result-head');
    head.append(create('b', '', result.rank + '. ' + result.title),
      create('em', '', 'page ' + result.page + ' · ' + result.score.toFixed(3)));
    card.append(head, create('span', 'evidence-result-copy', compact(result.text, 520)),
      create('code', '', result.span_id));
    card.addEventListener('click', () => showEvidenceDetail(result, {
      page: result.page,
      query: search.query,
      span_id: result.span_id
    }));
    list.append(card);
  }
  elements.recordDetail.append(list);
  focusRecordDetail();
}

function detailHeader(kicker, title, subtitle) {
  const head = create('header', 'detail-head');
  head.append(create('span', 'section-kicker', kicker), create('h2', '', title),
    create('p', '', subtitle));
  return head;
}

function evidenceArtifact(detail) {
  return {
    kind: 'evidence',
    record_id: detail.manifest.evidence_id,
    name: detail.manifest.bibliography?.title ?? detail.manifest.source.original_name,
    url: detail.source_url
  };
}

async function showEvidenceDetail(item, focus = {}) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading', 'Loading verified evidence record…'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/evidence/' + encodeURIComponent(item.evidence_id)
    );
    const manifest = detail.manifest;
    const bibliography = manifest.bibliography ?? {};
    const artifact = evidenceArtifact(detail);
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader('IMMUTABLE EVIDENCE',
      bibliography.title ?? manifest.source.original_name,
      [bibliography.authors?.join(', '), bibliography.year, bibliography.doi]
        .filter(Boolean).join(' · ') || manifest.source.original_name));
    const metrics = create('div', 'detail-metrics');
    metrics.append(metric('Pages', manifest.counts.pages), metric('Spans', manifest.counts.spans),
      metric('Characters', manifest.counts.characters),
      metric('Integrity', detail.verification.ok ? 'verified' : 'review'));
    elements.recordDetail.append(metrics);

    const actions = create('div', 'evidence-actions');
    const original = create('a', 'interactive-link', 'Open immutable source');
    original.href = detail.source_url;
    original.target = '_blank';
    original.rel = 'noreferrer';
    const share = create('button', 'share-button', 'Share source with AI');
    share.type = 'button';
    share.disabled = !detail.verification.ok;
    share.title = detail.verification.ok
      ? 'Save this source as context for the selected conversation'
      : 'Repair the evidence integrity record before sharing it with the AI';
    share.addEventListener('click', () => saveInteraction('evidence', 'source.selected', artifact, {
      evidence_id: manifest.evidence_id,
      page: Number(pageSelect.value) || 1,
      note: 'The user selected this verified evidence source for the next AI turn.'
    }));
    actions.append(original, share);
    elements.recordDetail.append(actions);

    const reader = boardCard('PAGE-ADDRESSABLE TEXT', 'Read and direct the AI');
    reader.classList.add('evidence-reader');
    const controls = create('div', 'evidence-page-controls');
    const pageSelect = create('select');
    pageSelect.setAttribute('aria-label', 'Evidence page');
    for (const page of detail.pages) {
      const option = create('option', '', 'Page ' + page.page + (page.preview ? ' · ' + compact(page.preview, 72) : ''));
      option.value = String(page.page);
      pageSelect.append(option);
    }
    const openPage = create('button', 'secondary-button', 'Open page');
    openPage.type = 'button';
    const pageState = create('span', 'studio-state', 'SELECT PAGE');
    controls.append(pageSelect, openPage, pageState);
    const copy = create('pre', 'evidence-page-copy', 'Select a page to load its recorded text.');
    reader.append(controls, copy);
    elements.recordDetail.append(reader);

    const direction = boardCard('USER DIRECTION', 'Tell the scientist how to use this source');
    const note = create('textarea');
    note.rows = 3;
    note.maxLength = 2_000;
    note.placeholder = 'For example: compare this method with the simulation assumptions and flag conflicts.';
    const save = create('button', 'share-button', 'Save direction for next AI turn');
    save.type = 'button';
    save.disabled = !detail.verification.ok;
    save.addEventListener('click', async () => {
      const value = note.value.trim();
      if (!value) return showNotice('Write a short evidence direction first.');
      await saveInteraction('evidence', 'source.selected', artifact, {
        page: Number(pageSelect.value),
        note: value,
        evidence_id: manifest.evidence_id
      });
    });
    direction.append(note, save);
    elements.recordDetail.append(direction);

    const loadPage = async (context = {}) => {
      const page = Number(pageSelect.value);
      openPage.disabled = true;
      pageState.textContent = 'LOADING';
      try {
        const { payload } = await fetchJson(
          '/api/evidence/' + encodeURIComponent(manifest.evidence_id) + '/pages/' + page
        );
        copy.textContent = payload.page.text || '[No extractable text on this page]';
        pageState.textContent = 'PAGE ' + page + (payload.verification.ok ? ' · VERIFIED' : ' · INTEGRITY WARNING');
        if (payload.verification.ok) {
          void saveInteraction('evidence', context.query ? 'search-result.opened' : 'page.opened', artifact, {
            evidence_id: manifest.evidence_id,
            page,
            query: context.query ?? null,
            span_id: context.span_id ?? null,
            page_sha256: payload.page.text_sha256
          }, { quiet: true });
        }
      } catch (error) {
        pageState.textContent = 'LOAD FAILED';
        copy.textContent = error.message;
      } finally {
        openPage.disabled = false;
      }
    };
    openPage.addEventListener('click', () => loadPage());
    pageSelect.addEventListener('change', () => loadPage());
    if (detail.pages.length) {
      pageSelect.value = String(focus.page ?? detail.pages[0].page);
      await loadPage(focus);
    }
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

function artifactLinks(artifacts, record) {
  const list = create('div', 'artifact-links');
  for (const artifact of artifacts ?? []) {
    const mode = interactiveMode(artifact.name);
    if (mode) {
      const labels = {
        code: 'Edit code',
        figure: 'Inspect figure',
        table: 'Edit or plot data',
        'three-d': 'Open 3D'
      };
      const button = create('button', 'interactive-link',
        (labels[mode] ?? 'Open output') + ' · ' + artifact.name);
      button.type = 'button';
      button.addEventListener('click', () => openArtifactStudio(artifact, record, mode));
      list.append(button);
      continue;
    }
    const link = create('a', '', artifact.name);
    link.href = artifact.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    list.append(link);
  }
  return list;
}

function decisionRuleText(rule = {}) {
  const labels = {
    greater_than: '>',
    greater_than_or_equal: '≥',
    less_than: '<',
    less_than_or_equal: '≤',
    between_inclusive: 'inside',
    outside_inclusive: 'outside'
  };
  const quantity = (value) => value && typeof value === 'object'
    ? String(value.value ?? '?') + ' ' + String(value.unit ?? '?')
    : String(value ?? '?');
  if (rule.operator === 'between_inclusive' || rule.operator === 'outside_inclusive') {
    return (labels[rule.operator] ?? rule.operator) + ' [' + quantity(rule.lower) + ', ' +
      quantity(rule.upper) + ']';
  }
  return (labels[rule.operator] ?? rule.operator ?? '?') + ' ' + quantity(rule.value);
}

function analysisUnitText(value) {
  return value && typeof value === 'object'
    ? String(value.symbol ?? value.unit ?? '?')
    : String(value ?? '?');
}

async function showPreregistrationDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading',
    'Loading and verifying frozen preregistration...'));
  try {
    const id = item.preregistration_id;
    const { payload: detail } = await fetchJson(
      '/api/preregistrations/' + encodeURIComponent(id)
    );
    const record = detail.record;
    const verification = detail.verification;
    let sourceText = null;
    let sourceError = null;
    if (verification.ok) {
      try {
        const response = await fetch(detail.source_url, {
          cache: 'no-store',
          headers: { Accept: 'text/markdown, text/plain;q=0.9' }
        });
        if (!response.ok) {
          throw new Error('Source request failed with status ' + response.status);
        }
        sourceText = await response.text();
      } catch (error) {
        sourceError = error.message;
      }
    }

    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      'FROZEN PREREGISTRATION',
      record.name ?? id,
      'Immutable plan recorded ' + formatDate(record.created_at)
    ));
    const metrics = create('div', 'detail-metrics');
    metrics.append(
      metric('Integrity', verification.ok ? 'verified' : 'invalid'),
      metric('Source', record.source?.kind ?? 'project file'),
      metric('Bytes', Number(record.bytes ?? 0).toLocaleString()),
      metric('Schema', record.schema_version ?? 'unknown')
    );
    elements.recordDetail.append(metrics);

    const integrity = boardCard('IMMUTABLE BINDING', id);
    integrity.append(
      create('code', 'analysis-hash', 'record ' +
        String(verification.record_sha256 ?? 'not verified')),
      create('code', 'analysis-hash', 'source ' +
        String(record.source_sha256 ?? 'not recorded')),
      create('p', 'analysis-help', verification.ok
        ? 'The audit event, record, artifact bytes, schema, and required sections replay successfully.'
        : 'Integrity verification failed. Do not bind this record to a new analysis contract.')
    );
    if (verification.errors?.length) {
      integrity.append(create('pre', 'json-preview',
        JSON.stringify(verification.errors, null, 2)));
    }
    elements.recordDetail.append(integrity);

    const source = create('section', 'preregistration-source');
    const sourceHead = create('div', 'preregistration-source-head');
    sourceHead.append(
      create('span', 'section-kicker', 'EXACT FROZEN MARKDOWN'),
      create('h3', '', record.frozen_file ?? 'Frozen source')
    );
    if (verification.ok) {
      const link = create('a', 'interactive-link', 'Open immutable source');
      link.href = detail.source_url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      sourceHead.append(link);
    }
    source.append(sourceHead);
    if (sourceText !== null) {
      source.append(create('pre', 'json-preview preregistration-source-text', sourceText));
    } else {
      source.append(create('p', 'message-error', sourceError ??
        'Source preview is withheld because integrity verification failed.'));
    }
    elements.recordDetail.append(source);

    const direction = boardCard('AI HANDOFF', 'Focus this frozen plan');
    const note = create('textarea', 'analysis-deviation');
    note.rows = 3;
    note.maxLength = 2000;
    note.placeholder =
      'Ask the AI to challenge assumptions or prepare the prespecified analysis contract...';
    const share = create('button', 'share-button', 'Share preregistration direction with AI');
    share.type = 'button';
    share.disabled = !selectedChat || !verification.ok;
    if (!selectedChat) share.title = 'Select a conversation to enable AI handoff.';
    share.addEventListener('click', async () => {
      const interaction = await saveInteraction('analysis', 'preregistration.focused', {
        kind: 'preregistration',
        record_id: id,
        name: record.name,
        url: '/api/preregistrations/' + encodeURIComponent(id)
      }, {
        schema_version: 1,
        preregistration_id: id,
        name: record.name,
        status: record.status,
        record_sha256: verification.record_sha256,
        source_sha256: record.source_sha256,
        frozen_sha256: record.frozen_sha256,
        bytes: record.bytes,
        source_kind: record.source?.kind ?? 'project_file',
        required_sections: record.source?.required_sections ?? [],
        note: note.value.trim() || null
      });
      if (interaction) {
        note.value = '';
        share.textContent = 'Shared / ' + interaction.interaction_id;
      }
    });
    direction.append(note, share);
    elements.recordDetail.append(direction);

    const exact = create('details', 'analysis-exact-record');
    exact.append(
      create('summary', '', 'Inspect exact preregistration record JSON'),
      create('pre', 'json-preview', JSON.stringify(record, null, 2))
    );
    elements.recordDetail.append(exact);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

async function showAnalysisContractDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading',
    'Loading and verifying frozen analysis contract…'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/analysis-contracts/' + encodeURIComponent(item.analysis_contract_id)
    );
    const manifest = detail.manifest;
    const contract = detail.contract;
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      'FROZEN ANALYSIS CONTRACT',
      contract.name,
      contract.hypothesis
    ));
    const metrics = create('div', 'detail-metrics');
    metrics.append(
      metric('Integrity', detail.verification.ok ? 'verified' : 'invalid'),
      metric('Primary', manifest.counts?.primary ?? 0),
      metric('Secondary', manifest.counts?.secondary ?? 0),
      metric('Units', manifest.schema_version === 2 ? 'typed v2' : 'legacy v1'),
      metric('Script source', detail.verification.source_status ?? 'unknown')
    );
    elements.recordDetail.append(metrics);

    const binding = boardCard('PROSPECTIVE BINDING', manifest.preregistration.preregistration_id);
    binding.append(
      create('p', '', 'Analysis population · ' + contract.analysis_population),
      create('p', '', 'Conditions · ' + contract.conditions),
      create('p', '', 'Missing data · ' + contract.missing_data_policy.replaceAll('_', ' ')),
      create('p', '', 'Multiplicity · ' + contract.multiplicity_policy),
      create('code', 'analysis-hash', 'contract ' + manifest.contract.sha256),
      create('code', 'analysis-hash', 'script ' + manifest.script.frozen_sha256)
    );
    elements.recordDetail.append(binding);

    const outcomes = create('section', 'analysis-outcome-list');
    outcomes.append(create('span', 'section-kicker', 'PRESPECIFIED OUTCOMES'));
    for (const outcome of contract.outcomes ?? []) {
      const card = create('article', 'analysis-outcome-card ' + outcome.role);
      const head = create('div', 'analysis-outcome-head');
      head.append(create('span', 'record-type', outcome.role.toUpperCase()),
        create('strong', '', outcome.label));
      card.append(
        head,
        create('p', '', outcome.variable + ' · ' + outcome.timepoint),
        create('p', 'analysis-measure',
          outcome.aggregation + ' of ' + outcome.statistic + ' · ' +
          analysisUnitText(outcome.unit) + ' · minimum n=' + outcome.minimum_count),
        create('strong', 'analysis-decision', decisionRuleText(outcome.decision_rule)),
        create('small', '', outcome.summary_measure),
        create('small', '', 'Intercurrent/missing strategy · ' +
          outcome.intercurrent_event_strategy)
      );
      if (Object.keys(outcome.filter ?? {}).length) {
        card.append(create('code', '', 'filter ' + JSON.stringify(outcome.filter)));
      }
      outcomes.append(card);
    }
    elements.recordDetail.append(outcomes);

    const direction = boardCard('AI HANDOFF', 'Focus this frozen contract');
    const note = create('textarea', 'analysis-deviation');
    note.rows = 3;
    note.maxLength = 2000;
    note.placeholder =
      'Ask the scientist to launch the bound experiment, challenge an assumption, or inspect a specific outcome…';
    const share = create('button', 'share-button', 'Share contract direction with AI');
    share.type = 'button';
    share.addEventListener('click', async () => {
      const record = await saveInteraction('analysis', 'contract.focused', {
        kind: 'analysis-contract',
        record_id: manifest.analysis_contract_id,
        name: manifest.name,
        url: '/api/analysis-contracts/' + encodeURIComponent(manifest.analysis_contract_id)
      }, {
        analysis_contract_id: manifest.analysis_contract_id,
        status: manifest.status,
        manifest_sha256: detail.verification.manifest_sha256,
        preregistration_id: manifest.preregistration.preregistration_id,
        script_sha256: manifest.script.frozen_sha256,
        outcome_counts: manifest.counts,
        primary_outcomes: (contract.outcomes ?? [])
          .filter((outcome) => outcome.role === 'primary')
          .map((outcome) => ({
            outcome_id: outcome.outcome_id,
            statistic: outcome.statistic,
            unit: outcome.unit,
            aggregation: outcome.aggregation,
            minimum_count: outcome.minimum_count,
            decision_rule: outcome.decision_rule
          })),
        note: note.value.trim() || null
      });
      if (record) {
        note.value = '';
        share.textContent = 'Shared · ' + record.interaction_id;
      }
    });
    direction.append(note, share);
    elements.recordDetail.append(direction);

    const exact = create('details', 'analysis-exact-record');
    exact.append(create('summary', '', 'Inspect exact normalized contract JSON'),
      create('pre', 'json-preview', JSON.stringify(contract, null, 2)));
    elements.recordDetail.append(exact);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

async function showConfirmatoryAssessmentDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading',
    'Rechecking immutable confirmatory assessment…'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/analysis-assessments/' + encodeURIComponent(item.analysis_assessment_id)
    );
    const manifest = detail.manifest;
    const report = detail.report;
    const registration = report.registration;
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      'CONFIRMATORY ASSESSMENT · ' + registration.status.toUpperCase(),
      report.summary.outcome_verdict + ' primary-outcome verdict',
      report.analysis_contract.analysis_contract_id + ' → ' + report.experiment.experiment_id
    ));
    const metrics = create('div', 'detail-metrics');
    metrics.append(
      metric('Record', report.status),
      metric('Registration', registration.status),
      metric('Primary passed',
        report.summary.primary_passed + '/' + report.summary.primary),
      metric('Integrity', detail.verification.ok ? 'verified' : 'invalid')
    );
    elements.recordDetail.append(metrics);

    const registrationCard = boardCard('REGISTRATION CHECK', registration.status);
    registrationCard.append(
      checkRow('Exact contract link', registration.linked,
        registration.linked ? 'Experiment plan carries this contract ID' : 'Pair is unregistered'),
      checkRow('Contract digest', registration.digest_match,
        registration.digest_match ? 'Exact frozen manifest matched' : 'Digest mismatch or absent'),
      checkRow('Frozen script', registration.script_match,
        registration.script_match ? 'Experiment used exact script bytes' : 'Script mismatch'),
      checkRow('Prospective timing', registration.contract_created_before_experiment,
        registration.contract_created_before_experiment
          ? 'Contract existed before experiment start'
          : 'Contract was not demonstrably prior')
    );
    for (const deviation of registration.automatic_deviations ?? []) {
      registrationCard.append(create('p', 'limitation',
        'Automatic deviation · ' + deviation.replaceAll('_', ' ')));
    }
    if (registration.disclosed_deviation) {
      registrationCard.append(create('blockquote', '', registration.disclosed_deviation));
    }
    elements.recordDetail.append(registrationCard);

    const outcomes = create('section', 'analysis-outcome-list');
    outcomes.append(create('span', 'section-kicker', 'REPLAYED OUTCOMES'));
    for (const outcome of report.outcomes ?? []) {
      const card = create('article',
        'analysis-outcome-card ' + outcome.role + ' result-' + outcome.status);
      const head = create('div', 'analysis-outcome-head');
      head.append(create('span', 'record-type', outcome.role.toUpperCase()),
        create('strong', '', outcome.label), statusPill(outcome.status));
      card.append(
        head,
        create('p', 'analysis-result-value',
          outcome.aggregate_value === null
            ? 'Indeterminate'
            : String(outcome.aggregate_value) + ' ' + analysisUnitText(outcome.unit)),
        create('p', 'analysis-measure',
          outcome.observed_count + '/' + outcome.expected_count + ' observed · ' +
          outcome.missing_count + ' missing · ' + outcome.aggregation),
        create('strong', 'analysis-decision', decisionRuleText(outcome.decision_rule))
      );
      const branches = create('div', 'analysis-branch-values');
      for (const observation of outcome.observations ?? []) {
        const observedValue = observation.converted
          ? observation.source_value + ' ' + observation.source_unit + ' → ' +
            observation.value + ' ' + observation.unit
          : observation.value + (observation.unit ? ' ' + observation.unit : '');
        branches.append(create('span', '',
          'branch ' + observation.branch_index + ' · ' + observedValue));
      }
      for (const missing of outcome.missing ?? []) {
        const unitDetail = missing.expected_unit
          ? ' · ' + String(missing.observed_unit ?? 'invalid') + ' → expected ' +
            missing.expected_unit
          : '';
        branches.append(create('span', 'missing',
          'branch ' + missing.branch_index + ' · ' + missing.reason.replaceAll('_', ' ') +
          unitDetail));
      }
      card.append(branches);
      outcomes.append(card);
    }
    elements.recordDetail.append(outcomes);

    const direction = boardCard('AI HANDOFF', 'Interpret without overstating');
    const note = create('textarea', 'analysis-deviation');
    note.rows = 3;
    note.maxLength = 2000;
    note.placeholder =
      'Ask for a sensitivity check, explain a failed threshold, or flag a conclusion that must remain exploratory…';
    const share = create('button', 'share-button', 'Share assessment focus with AI');
    share.type = 'button';
    share.addEventListener('click', async () => {
      const record = await saveInteraction('analysis', 'assessment.focused', {
        kind: 'analysis-assessment',
        record_id: manifest.analysis_assessment_id,
        name: 'Confirmatory assessment ' + manifest.analysis_assessment_id,
        url: '/api/analysis-assessments/' +
          encodeURIComponent(manifest.analysis_assessment_id)
      }, {
        analysis_assessment_id: manifest.analysis_assessment_id,
        analysis_contract_id: report.analysis_contract.analysis_contract_id,
        experiment_id: report.experiment.experiment_id,
        status: report.status,
        registration_status: registration.status,
        outcome_verdict: report.summary.outcome_verdict,
        summary: report.summary,
        primary_outcomes: (report.outcomes ?? [])
          .filter((outcome) => outcome.role === 'primary')
          .map((outcome) => ({
            outcome_id: outcome.outcome_id,
            unit: outcome.unit,
            aggregate_value: outcome.aggregate_value,
            observed_count: outcome.observed_count,
            missing_count: outcome.missing_count,
            decision_rule: outcome.decision_rule,
            status: outcome.status
          })),
        deviations: registration.automatic_deviations,
        disclosed_deviation: registration.disclosed_deviation,
        note: note.value.trim() || null
      });
      if (record) {
        note.value = '';
        share.textContent = 'Shared · ' + record.interaction_id;
      }
    });
    direction.append(note, share);
    elements.recordDetail.append(direction);

    const limits = boardCard('INTERPRETATION LIMITS', 'Threshold replay, not inference');
    for (const statement of report.interpretation ?? []) {
      limits.append(create('p', 'limitation', statement));
    }
    elements.recordDetail.append(limits);
    const exact = create('details', 'analysis-exact-record');
    exact.append(create('summary', '', 'Inspect exact replay report JSON'),
      create('pre', 'json-preview', JSON.stringify(report, null, 2)));
    elements.recordDetail.append(exact);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

function procedureArtifact(detail) {
  return {
    kind: 'procedure',
    record_id: detail.manifest.procedure_id,
    name: detail.manifest.name,
    url: '/api/procedures/' + encodeURIComponent(detail.manifest.procedure_id)
  };
}

async function showProcedureDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading',
    'Verifying immutable procedure plan...'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/procedures/' + encodeURIComponent(item.procedure_id)
    );
    const manifest = detail.manifest;
    const procedure = detail.procedure;
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      'IMMUTABLE PROCEDURE PLAN / ' + String(manifest.domain).replaceAll('_', ' '),
      manifest.name,
      procedure.objective
    ));
    const metrics = create('div', 'detail-metrics');
    metrics.append(
      metric('Steps', manifest.counts.steps),
      metric('Hazards', manifest.counts.hazards),
      metric('Controls', manifest.counts.controls),
      metric('Integrity', detail.verification.ok ? 'verified' : 'invalid')
    );
    elements.recordDetail.append(metrics);

    const policy = boardCard('EXECUTION BOUNDARY', 'External human control only');
    policy.classList.add('procedure-policy-card');
    policy.append(
      create('p', 'limitation',
        'ScienceCode stores design records and non-executable mappings. It does not schedule, authorize, or control physical hardware.'),
      create('p', 'limitation',
        String(manifest.source_evidence?.length ?? 0) +
        ' immutable source record(s) are bound to this exact plan.')
    );
    elements.recordDetail.append(policy);

    const studio = create('section', 'procedure-step-studio');
    const rail = create('nav', 'procedure-step-rail');
    rail.setAttribute('aria-label', 'Procedure steps');
    const inspector = create('article', 'procedure-step-inspector');
    let selected = procedure.steps[0] ?? null;
    const renderInspector = () => {
      inspector.replaceChildren();
      if (!selected) {
        inspector.append(create('p', 'procedure-preview-empty', 'No step selected.'));
        return;
      }
      inspector.append(
        create('span', 'section-kicker',
          String(selected.operation).replaceAll('_', ' ')),
        create('h3', '', selected.title),
        create('code', 'procedure-step-id', selected.step_id),
        create('p', 'procedure-step-instruction', selected.instruction)
      );
      const facts = create('div', 'procedure-step-facts');
      facts.append(
        metric('Depends on', selected.depends_on.join(', ') || 'start'),
        metric('Duration', selected.duration
          ? selected.duration.value + ' ' + selected.duration.unit : 'not quantified'),
        metric('Hazards', selected.hazard_ids.join(', ') || 'none linked'),
        metric('Outputs', selected.outputs.join(', ') || 'none')
      );
      inspector.append(facts);
      const details = create('div', 'procedure-step-detail-grid');
      const resources = boardCard('RESOURCES', 'Bound references');
      resources.append(
        create('p', '', 'Materials / ' +
          (selected.materials.map((entry) => entry.material_id +
            (entry.amount
              ? ' (' + entry.amount.value + ' ' + entry.amount.unit + ')' : '')
          ).join(', ') || 'none')),
        create('p', '', 'Equipment / ' +
          (selected.equipment_ids.join(', ') || 'none')),
        create('p', '', 'Parameters / ' +
          (selected.parameters.map((entry) => entry.name + '=' + entry.value +
            (entry.unit ? ' ' + entry.unit : '')).join(', ') || 'none'))
      );
      const checks = boardCard('OBSERVATION AND DEVIATION', 'Prespecified response');
      checks.append(
        create('p', '', selected.expected_observation),
        create('strong', '', selected.acceptance_criterion),
        create('blockquote', '', selected.on_deviation),
        create('p', 'limitation', selected.risk_note)
      );
      details.append(resources, checks);
      inspector.append(details);
      const handoff = boardCard('AI HANDOFF', 'Share this selected step');
      const note = create('textarea', 'analysis-deviation');
      note.rows = 2;
      note.maxLength = 2000;
      note.placeholder =
        'Ask the AI to challenge this step, trace its sources, or propose a safer revision...';
      const share = create('button', 'share-button', 'Share selected step with AI');
      share.type = 'button';
      share.addEventListener('click', async () => {
        const record = await saveInteraction(
          'procedure',
          'board.focused',
          procedureArtifact(detail),
          {
            procedure_id: manifest.procedure_id,
            step_id: selected.step_id,
            operation: selected.operation,
            dependencies: selected.depends_on,
            materials: selected.materials,
            equipment_ids: selected.equipment_ids,
            hazard_ids: selected.hazard_ids,
            acceptance_criterion: selected.acceptance_criterion,
            on_deviation: selected.on_deviation,
            physical_execution_enabled: false,
            note: note.value.trim() ||
              'Focus on step ' + selected.step_id + ' in the immutable procedure.'
          }
        );
        if (record) {
          note.value = '';
          share.textContent = 'Shared / ' + record.interaction_id;
        }
      });
      handoff.append(note, share);
      inspector.append(handoff);
    };
    for (const [index, step] of procedure.steps.entries()) {
      const button = create('button',
        step.step_id === selected?.step_id ? 'active' : '');
      button.type = 'button';
      button.append(
        create('span', 'procedure-step-index', String(index + 1).padStart(2, '0')),
        create('strong', '', step.title),
        create('small', '', step.operation + ' / ' +
          (step.depends_on.join(', ') || 'start'))
      );
      button.addEventListener('click', () => {
        selected = step;
        for (const other of rail.querySelectorAll('button')) {
          other.classList.remove('active');
        }
        button.classList.add('active');
        renderInspector();
      });
      rail.append(button);
    }
    studio.append(rail, inspector);
    elements.recordDetail.append(studio);
    renderInspector();

    const inventory = create('div', 'procedure-record-grid');
    const hazardCard = boardCard('HAZARD REGISTER',
      procedure.hazards.length + ' documented hazard(s)');
    for (const hazard of procedure.hazards) {
      const row = create('article', 'procedure-register-row');
      row.append(
        statusPill(hazard.severity),
        create('strong', '', hazard.hazard_id + ' / ' + hazard.category),
        create('p', '', hazard.description),
        create('small', '', hazard.controls.map((control) =>
          control.type + ': ' + control.description).join(' / '))
      );
      hazardCard.append(row);
    }
    const controlCard = boardCard('CONTROL STRATEGY',
      procedure.controls.length + ' explicit control(s)');
    for (const control of procedure.controls) {
      const row = create('article', 'procedure-register-row');
      row.append(
        statusPill(control.type),
        create('strong', '', control.label),
        create('p', '', control.purpose),
        create('small', '', control.acceptance_criterion)
      );
      controlCard.append(row);
    }
    inventory.append(hazardCard, controlCard);
    elements.recordDetail.append(inventory);

    const exact = create('details', 'analysis-exact-record');
    exact.append(
      create('summary', '', 'Inspect exact normalized procedure JSON'),
      create('pre', 'json-preview', JSON.stringify(procedure, null, 2))
    );
    elements.recordDetail.append(exact);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

async function showProcedureAssessmentDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading',
    'Replaying immutable logical dry-run...'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/procedure-assessments/' +
      encodeURIComponent(item.procedure_assessment_id)
    );
    const manifest = detail.manifest;
    const report = detail.report;
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      'PROCEDURE LOGICAL DRY-RUN / ' + report.status.replaceAll('_', ' '),
      report.procedure.name,
      'Structural validation over ' + report.procedure.procedure_id +
      '; no physical simulation or hardware execution.'
    ));
    const metrics = create('div', 'detail-metrics');
    metrics.append(
      metric('Blockers', report.summary.errors),
      metric('Warnings', report.summary.warnings),
      metric('Gates passed', report.summary.gates_passed),
      metric('Integrity', detail.verification.ok ? 'verified' : 'invalid')
    );
    elements.recordDetail.append(metrics);

    let focus = {
      kind: 'assessment',
      id: manifest.procedure_assessment_id,
      label: 'whole logical dry-run'
    };
    const focusState = create('p', 'procedure-focus-state',
      'Selected focus / whole logical dry-run');
    const selectFocus = (kind, id, label, element) => {
      focus = { kind, id, label };
      focusState.textContent = 'Selected focus / ' + label;
      for (const selected of elements.recordDetail.querySelectorAll(
        '.procedure-focusable.selected'
      )) selected.classList.remove('selected');
      element.classList.add('selected');
    };

    const gates = boardCard('DECISION GATES',
      report.summary.gates_passed + ' passed / ' +
      report.summary.gates_blocked + ' blocked');
    gates.classList.add('procedure-gate-board');
    for (const gate of report.gates) {
      const row = create('button', 'procedure-gate-row procedure-focusable');
      row.type = 'button';
      row.append(
        statusPill(gate.status),
        create('strong', '', gate.label),
        create('p', '', gate.detail)
      );
      row.addEventListener('click', () =>
        selectFocus('gate', gate.id, 'gate ' + gate.label, row));
      gates.append(row);
    }
    elements.recordDetail.append(gates);

    const adapters = create('div', 'procedure-record-grid');
    for (const adapter of report.adapters) {
      const card = boardCard(
        adapter.target.toUpperCase().replaceAll('_', ' '),
        adapter.label + ' / ' + adapter.status.replaceAll('_', ' ')
      );
      card.classList.add('procedure-adapter-card', 'procedure-focusable');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.append(
        create('p', 'limitation',
          adapter.requested
            ? adapter.steps.filter((step) => step.status === 'mapped').length +
              '/' + adapter.steps.length + ' steps have a named mapping.'
            : 'This adapter was not requested by the frozen plan.'),
        create('p', 'limitation',
          adapter.unmapped_step_ids.length
            ? 'Manual or unsupported / ' + adapter.unmapped_step_ids.join(', ')
            : 'No unmapped steps in this neutral preview.'),
        statusPill(adapter.execution_enabled ? 'attention' : 'completed')
      );
      const requirements = create('ul', 'procedure-adapter-requirements');
      for (const requirement of adapter.external_requirements) {
        requirements.append(create('li', '', requirement));
      }
      card.append(requirements, create('strong', 'procedure-disabled-label',
        'NON-EXECUTABLE / HARDWARE DISABLED'));
      const choose = () =>
        selectFocus('adapter', adapter.target, adapter.label + ' adapter', card);
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
      adapters.append(card);
    }
    elements.recordDetail.append(adapters);

    if (report.findings.length) {
      const findings = boardCard('FINDINGS',
        report.findings.length + ' structural observation(s)');
      findings.classList.add('procedure-findings');
      for (const finding of report.findings) {
        const row = create('button', 'procedure-finding-row procedure-focusable');
        row.type = 'button';
        row.append(
          statusPill(finding.severity),
          create('strong', '', finding.code.replaceAll('_', ' ')),
          create('p', '', finding.message)
        );
        row.addEventListener('click', () =>
          selectFocus('finding', finding.code,
            'finding ' + finding.code.replaceAll('_', ' '), row));
        findings.append(row);
      }
      elements.recordDetail.append(findings);
    }

    const resources = boardCard('DETERMINISTIC TOTALS', 'Known plan resources');
    const totals = create('div', 'detail-metrics procedure-resource-metrics');
    totals.append(
      metric('Materials', report.resources.materials),
      metric('Equipment', report.resources.equipment),
      metric('Known duration',
        report.resources.duration.total_seconds + ' seconds'),
      metric('Unknown durations', report.resources.duration.unknown_steps)
    );
    resources.append(totals);
    const materialTotals = create('div', 'procedure-preview-chips');
    for (const total of report.resources.material_totals) {
      materialTotals.append(create('span', '',
        total.material_id + ' / ' + total.value + ' ' + total.unit));
    }
    resources.append(materialTotals);
    elements.recordDetail.append(resources);

    const handoff = boardCard('AI HANDOFF', 'Share a selected gate, finding, or adapter');
    const note = create('textarea', 'analysis-deviation');
    note.rows = 3;
    note.maxLength = 2000;
    note.placeholder =
      'Ask for a revision, challenge a mapping, or explain a blocker without implying physical authorization...';
    const share = create('button', 'share-button', 'Share dry-run focus with AI');
    share.type = 'button';
    share.addEventListener('click', async () => {
      const record = await saveInteraction('procedure', 'assessment.focused', {
        kind: 'procedure-assessment',
        record_id: manifest.procedure_assessment_id,
        name: report.procedure.name + ' logical dry-run',
        url: '/api/procedure-assessments/' +
          encodeURIComponent(manifest.procedure_assessment_id)
      }, {
        procedure_assessment_id: manifest.procedure_assessment_id,
        procedure_id: report.procedure.procedure_id,
        status: report.status,
        summary: report.summary,
        gates: report.gates,
        findings: report.findings.slice(0, 24),
        adapters: report.adapters.map((adapter) => ({
          target: adapter.target,
          status: adapter.status,
          requested: adapter.requested,
          unmapped_step_ids: adapter.unmapped_step_ids
        })),
        selected_focus: focus,
        physical_execution_enabled: false,
        note: note.value.trim() || 'Focus on ' + focus.label + '.'
      });
      if (record) {
        note.value = '';
        share.textContent = 'Shared / ' + record.interaction_id;
      }
    });
    handoff.append(focusState, note, share);
    elements.recordDetail.append(handoff);

    const limits = boardCard('INTERPRETATION LIMITS',
      'Logical structure is not facility validation');
    for (const statement of report.interpretation) {
      limits.append(create('p', 'limitation', statement));
    }
    elements.recordDetail.append(limits);
    const exact = create('details', 'analysis-exact-record');
    exact.append(
      create('summary', '', 'Inspect exact deterministic dry-run JSON'),
      create('pre', 'json-preview', JSON.stringify(report, null, 2))
    );
    elements.recordDetail.append(exact);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

async function showProcedureDecisionDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(create('div', 'studio-loading',
    'Verifying scoped human decision...'));
  try {
    const { payload: detail } = await fetchJson(
      '/api/procedure-decisions/' + encodeURIComponent(item.procedure_decision_id)
    );
    const manifest = detail.manifest;
    const decision = detail.decision;
    const summary = (labState?.procedure_decisions ?? []).find((record) =>
      record.procedure_decision_id === manifest.procedure_decision_id);
    elements.recordDetail.replaceChildren();
    elements.recordDetail.append(detailHeader(
      'LOCAL HUMAN DECISION / ' + manifest.status.toUpperCase(),
      String(manifest.scope).replaceAll('_', ' '),
      manifest.procedure.procedure_id + ' / ' +
      manifest.assessment.procedure_assessment_id
    ));
    const metrics = create('div', 'detail-metrics');
    metrics.append(
      metric('Decision', manifest.status),
      metric('Effective state', summary?.effective_status ?? 'verify current list'),
      metric('Expiry', manifest.expires_at ? formatDate(manifest.expires_at) : 'none'),
      metric('Integrity', detail.verification.ok ? 'verified' : 'invalid')
    );
    elements.recordDetail.append(metrics);

    const identity = boardCard('IDENTITY AND AUTHORITY BOUNDARY',
      manifest.reviewer.name + ' / ' + manifest.reviewer.role);
    identity.classList.add('procedure-policy-card');
    identity.append(
      statusPill(manifest.reviewer.identity_verified ? 'attention' : 'required'),
      create('p', 'limitation',
        'Reviewer identity is not verified by ScienceCode. Facility authority, training, regulatory status, and hardware readiness remain external responsibilities.'),
      create('p', '', 'Organization / ' +
        (manifest.reviewer.organization ?? 'not recorded'))
    );
    elements.recordDetail.append(identity);

    const decisionGrid = create('div', 'procedure-record-grid');
    const basis = boardCard('DECISION BASIS', manifest.status);
    basis.append(
      create('blockquote', '', decision.basis),
      create('p', 'limitation',
        decision.conditions ?? 'No additional conditions were recorded.'),
      create('p', '', 'Explicit local attestation / ' +
        (decision.attestation ? 'recorded' : 'not recorded'))
    );
    const boundary = boardCard('PHYSICAL EXECUTION', 'Always disabled in ScienceCode');
    boundary.append(
      statusPill('required'),
      create('strong', 'procedure-disabled-label',
        'NO HARDWARE CONTROL / NO EXECUTION AUTHORIZATION'),
      create('p', 'limitation', manifest.interpretation),
      create('p', '', 'Policy / ' + manifest.physical_execution.policy)
    );
    decisionGrid.append(basis, boundary);
    elements.recordDetail.append(decisionGrid);

    const handoff = boardCard('AI HANDOFF', 'Use this exact scoped decision');
    const note = create('textarea', 'analysis-deviation');
    note.rows = 3;
    note.maxLength = 2000;
    note.placeholder =
      'Ask the AI to respect this scope, explain why it is stale, or plan a revision without treating it as hardware permission...';
    const share = create('button', 'share-button', 'Share decision focus with AI');
    share.type = 'button';
    share.addEventListener('click', async () => {
      const record = await saveInteraction('procedure', 'decision.focused', {
        kind: 'procedure-decision',
        record_id: manifest.procedure_decision_id,
        name: manifest.scope,
        url: '/api/procedure-decisions/' +
          encodeURIComponent(manifest.procedure_decision_id)
      }, {
        procedure_decision_id: manifest.procedure_decision_id,
        procedure_id: manifest.procedure.procedure_id,
        procedure_assessment_id:
          manifest.assessment.procedure_assessment_id,
        status: manifest.status,
        scope: manifest.scope,
        expires_at: manifest.expires_at,
        effective_status: summary?.effective_status ?? null,
        reviewer_role: manifest.reviewer.role,
        reviewer_identity_verified: false,
        physical_execution_enabled: false,
        note: note.value.trim() ||
          'Apply this exact scoped decision without implying hardware permission.'
      });
      if (record) {
        note.value = '';
        share.textContent = 'Shared / ' + record.interaction_id;
      }
    });
    handoff.append(note, share);
    elements.recordDetail.append(handoff);

    const exact = create('details', 'analysis-exact-record');
    exact.append(
      create('summary', '', 'Inspect exact normalized decision JSON'),
      create('pre', 'json-preview', JSON.stringify(decision, null, 2))
    );
    elements.recordDetail.append(exact);
    focusRecordDetail();
  } catch (error) {
    elements.recordDetail.replaceChildren(create('p', 'message-error', error.message));
  }
}

function showExperimentDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(detailHeader('EXPERIMENT', item.name ?? item.experiment_id,
    item.hypothesis ?? 'No hypothesis recorded.'));
  const metrics = create('div', 'detail-metrics');
  metrics.append(metric('Planned', item.counts?.planned ?? 0),
    metric('Completed', item.counts?.completed ?? 0),
    metric('Verified', item.counts?.verified ?? 0),
    metric('Verdict', item.review?.verdict ?? '—'));
  elements.recordDetail.append(metrics);
  if (item.review?.findings?.length) {
    const findings = boardCard('REVIEW FINDINGS', item.review.verdict ?? 'review');
    for (const finding of item.review.findings) {
      findings.append(create('p', 'limitation', compact(finding, 400)));
    }
    elements.recordDetail.append(findings);
  }
  elements.recordDetail.append(artifactLinks(item.artifacts, {
    kind: 'experiment',
    record_id: item.experiment_id
  }));
  focusRecordDetail();
}

function showSimulationDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  elements.recordDetail.append(detailHeader('SIMULATION',
    item.summary?.model ?? item.simulation_id,
    'Recorded seed ' + (item.seed ?? '—') + ' · ' + formatDuration(item.duration_ms)));
  const figures = create('div', 'detail-figures');
  for (const artifact of (item.artifacts ?? []).filter((record) => record.kind === 'image')) {
    const figure = create('figure');
    const image = create('img');
    image.src = artifact.url;
    image.alt = artifact.name;
    image.loading = 'lazy';
    figure.append(image, create('figcaption', '', artifact.name));
    figures.append(figure);
  }
  if (figures.childElementCount) elements.recordDetail.append(figures);
  if (item.summary) {
    const summary = boardCard('SUMMARY', 'Recorded result');
    summary.append(create('pre', 'json-preview', JSON.stringify(item.summary, null, 2)));
    elements.recordDetail.append(summary);
  }
  elements.recordDetail.append(artifactLinks(item.artifacts, {
    kind: 'simulation',
    record_id: item.simulation_id
  }));
  focusRecordDetail();
}

function showInferenceDetail(item) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  const model = item.model?.path ?? item.model?.source ?? item.inference_id;
  elements.recordDetail.append(detailHeader(
    item.kind === 'hardware_smoke' ? 'NPU HARDWARE SMOKE' : 'ONNX INFERENCE',
    model,
    String(item.device_request ?? 'unknown') + ' policy · ' + formatDuration(item.duration_ms)
  ));
  const profileEventCounts = item.provider_verification?.profile_event_counts ??
    item.provider_verification?.node_counts ?? {};
  const metrics = create('div', 'detail-metrics');
  metrics.append(
    metric('Status', item.status ?? 'unknown'),
    metric('Verified', item.verified ? 'yes' : 'no'),
    metric('Vitis events', profileEventCounts.VitisAIExecutionProvider ?? 0),
    metric('Mean latency', Number.isFinite(item.execution?.latency_ms?.mean)
      ? formatPlotNumber(item.execution.latency_ms.mean) + ' ms' : '—'),
    metric('Session setup', Number.isFinite(item.execution?.session_creation_ms)
      ? formatPlotNumber(item.execution.session_creation_ms) + ' ms' : '—')
  );
  elements.recordDetail.append(metrics);

  const provider = boardCard('EXECUTION PROVENANCE',
    item.provider_verification?.npu_executed ? 'NPU execution verified' : 'NPU execution not verified');
  const device = item.hardware?.devices?.[0];
  provider.append(
    create('p', 'limitation',
      'Provider: ' + String(item.runtime?.execution_provider ?? 'not recorded') +
      ' · Driver: ' + String(device?.driver_version ?? 'unknown') +
      ' · Fallback: ' + (item.provider_verification?.fallback_detected ? 'detected' : 'not detected')),
    create('pre', 'json-preview', JSON.stringify({
      active_providers: item.execution?.active_providers ?? [],
      provider_profile_event_counts: profileEventCounts,
      attribution_method: item.provider_verification?.attribution_method ?? null,
      claim: item.provider_verification?.claim ?? null,
      fallback_allowed: item.fallback_allowed
    }, null, 2))
  );
  elements.recordDetail.append(provider);

  const outputs = boardCard('OUTPUT PREVIEW', 'Exact arrays are archived as NPY');
  for (const output of item.execution?.outputs ?? []) {
    const section = create('section', 'inference-output-preview');
    section.append(
      create('strong', '', output.name ?? 'output'),
      create('p', 'limitation',
        String(output.dtype ?? 'unknown') + ' · shape ' +
        JSON.stringify(output.shape ?? []) + ' · ' + String(output.elements ?? 0) + ' elements'),
      create('pre', 'json-preview', JSON.stringify({
        minimum: output.minimum ?? null,
        maximum: output.maximum ?? null,
        mean: output.mean ?? null,
        preview: output.preview ?? []
      }, null, 2))
    );
    outputs.append(section);
  }
  if (!(item.execution?.outputs ?? []).length) {
    outputs.append(create('p', 'limitation', 'No output preview was recorded.'));
  }
  elements.recordDetail.append(outputs);
  elements.recordDetail.append(artifactLinks(item.artifacts, {
    kind: 'inference',
    record_id: item.inference_id
  }));
  focusRecordDetail();
}

function showArchive(kind, recordId) {
  showView(kind, { focus: !recordId || kind === 'campaigns' });
  if (!recordId) return;
  if (kind === 'campaigns') {
    void openCampaign(recordId);
  } else if (kind === 'simulations') {
    const item = labState?.simulations?.find((record) => record.simulation_id === recordId);
    if (item) showSimulationDetail(item);
  } else if (kind === 'inferences') {
    const item = labState?.inferences?.find((record) => record.inference_id === recordId);
    if (item) showInferenceDetail(item);
  } else if (kind === 'experiments') {
    const item = labState?.experiments?.find((record) => record.experiment_id === recordId);
    if (item) showExperimentDetail(item);
  } else if (kind === 'evidence') {
    const item = labState?.evidence?.find((record) => record.evidence_id === recordId);
    if (item) showEvidenceDetail(item);
  } else if (kind === 'reviews') {
    const item = labState?.reviews?.find((record) => record.review_id === recordId);
    if (item) showSemanticReviewDetail(item);
  } else if (kind === 'analysis') {
    const preregistration = labState?.preregistrations?.find(
      (record) => record.preregistration_id === recordId
    );
    const assessment = labState?.confirmatory_assessments?.find(
      (record) => record.analysis_assessment_id === recordId
    );
    const contract = labState?.analysis_contracts?.find(
      (record) => record.analysis_contract_id === recordId
    );
    if (preregistration) showPreregistrationDetail(preregistration);
    else if (assessment) showConfirmatoryAssessmentDetail(assessment);
    else if (contract) showAnalysisContractDetail(contract);
  } else if (kind === 'procedures') {
    const plan = labState?.procedures?.find(
      (record) => record.procedure_id === recordId
    );
    const assessment = labState?.procedure_assessments?.find(
      (record) => record.procedure_assessment_id === recordId
    );
    const decision = labState?.procedure_decisions?.find(
      (record) => record.procedure_decision_id === recordId
    );
    if (plan) showProcedureDetail(plan);
    else if (assessment) showProcedureAssessmentDetail(assessment);
    else if (decision) showProcedureDecisionDetail(decision);
  }
}

const CODE_EXTENSIONS = new Set([
  'gcode', 'js', 'json', 'log', 'py', 'r', 'scad', 'ts', 'txt', 'xdl',
  'xml', 'yaml', 'yml'
]);
const TABLE_EXTENSIONS = new Set(['csv', 'tsv', 'xlsx']);
const CHEMICAL_EXTENSIONS = new Set(['mol', 'sdf', 'smi', 'smiles']);
const GENOME_EXTENSIONS = new Set([
  'bed', 'bedgraph', 'bdg', 'fa', 'faa', 'fasta', 'ffn', 'fna', 'gff', 'gff3', 'gtf', 'vcf'
]);
const MANUSCRIPT_EXTENSIONS = new Set(['markdown', 'md', 'mdx', 'rst', 'tex']);
const THREE_D_EXTENSIONS = new Set(['obj', 'pdb', 'ply', 'stl', 'xyz']);
const FIGURE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp']);

function extensionOf(name) {
  const match = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function interactiveMode(name) {
  const extension = extensionOf(name);
  if (FIGURE_EXTENSIONS.has(extension)) return 'figure';
  if (TABLE_EXTENSIONS.has(extension)) return 'table';
  if (CHEMICAL_EXTENSIONS.has(extension)) return 'chemical';
  if (GENOME_EXTENSIONS.has(extension)) return 'genome';
  if (MANUSCRIPT_EXTENSIONS.has(extension)) return 'manuscript';
  if (THREE_D_EXTENSIONS.has(extension)) return 'three-d';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  return null;
}

function recordedPngSources() {
  const sources = [];
  const seen = new Set();
  const appendRecords = (records, kind, idKey) => {
    for (const record of records ?? []) {
      if (!record?.verified) continue;
      for (const artifact of record.artifacts ?? []) {
        if (extensionOf(artifact.name) !== 'png' || !artifact.url ||
            seen.has(artifact.url)) continue;
        seen.add(artifact.url);
        sources.push({
          artifact: {
            kind,
            record_id: record[idKey],
            name: artifact.name,
            url: artifact.url,
            sha256: artifact.sha256 ?? null
          },
          record: { kind, record_id: record[idKey] },
          selector: {
            kind,
            record_id: record[idKey],
            name: artifact.name,
            url: artifact.url,
            sha256: artifact.sha256 ?? undefined
          },
          label: kind + ' / ' + artifact.name + ' / ' + compact(record[idKey], 22)
        });
      }
    }
  };
  appendRecords(labState?.simulations, 'simulation', 'simulation_id');
  appendRecords(labState?.experiments, 'experiment', 'experiment_id');
  appendRecords(labState?.cad_builds, 'cad-build', 'build_id');
  for (const source of observedPngSources.values()) {
    if (seen.has(source.artifact.url)) continue;
    seen.add(source.artifact.url);
    sources.push(source);
  }
  for (const revision of labState?.revisions ?? []) {
    if (!revision?.verified || extensionOf(revision.name) !== 'png' ||
        !revision.url || seen.has(revision.url)) continue;
    seen.add(revision.url);
    sources.push({
      artifact: {
        kind: 'revision',
        record_id: revision.revision_id,
        name: revision.name,
        url: revision.url,
        sha256: revision.artifact_sha256 ?? null
      },
      record: { kind: 'revision', record_id: revision.revision_id },
      selector: { revision_id: revision.revision_id },
      label: 'revision / ' + revision.name + ' / ' +
        compact(revision.revision_id, 22)
    });
  }
  return sources;
}

function rememberPngSource(artifact, record) {
  if (extensionOf(artifact?.name) !== 'png' || !artifact?.url ||
      !record?.kind || !record?.record_id) return;
  observedPngSources.set(artifact.url, {
    artifact: {
      kind: record.kind,
      record_id: record.record_id,
      name: artifact.name,
      url: artifact.url,
      sha256: artifact.sha256 ?? null
    },
    record: { kind: record.kind, record_id: record.record_id },
    selector: {
      kind: record.kind,
      record_id: record.record_id,
      name: artifact.name,
      url: artifact.url,
      sha256: artifact.sha256 ?? undefined
    },
    label: record.kind + ' / ' + artifact.name + ' / ' +
      compact(record.record_id, 22)
  });
}

function recordedPngSource(url) {
  return recordedPngSources().find((source) => source.artifact.url === url) ?? null;
}

function immutableArtifactSelector(artifact) {
  if (artifact?.kind === 'revision' && artifact.record_id) {
    return { revision_id: artifact.record_id };
  }
  return {
    kind: artifact?.kind,
    record_id: artifact?.record_id,
    name: artifact?.name,
    url: artifact?.url,
    sha256: artifact?.sha256 ?? undefined
  };
}

function immutableSelectorFromText(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('revision:')) {
    return { revision_id: text.slice('revision:'.length) };
  }
  return { url: text };
}

async function saveInteraction(surface, action, artifact, payload, options = {}) {
  if (!selectedChat) {
    if (!options.quiet) {
      showNotice('Start or select a conversation before sharing workspace interactions with the AI.');
    }
    return null;
  }
  try {
    const { payload: saved } = await fetchJson(
      '/api/chats/' + encodeURIComponent(selectedChat) + '/interactions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, action, artifact, payload })
      }
    );
    const { payload: harness } = await fetchJson(
      '/api/chats/' + encodeURIComponent(selectedChat) + '/harness'
    );
    activeHarness = harness;
    renderHarness(activeHarness);
    if (!options.quiet) {
      showNotice('Saved to the research record. The next AI turn will see this interaction.');
    }
    return saved.interaction;
  } catch (error) {
    showNotice(error.message);
    return null;
  }
}

function studioFrame(mode, artifact, record) {
  elements.recordDetail.replaceChildren();
  elements.recordDetail.hidden = false;
  const frame = create('section', 'output-studio ' + mode);
  const header = create('header', 'studio-header');
  const heading = create('div');
  const kicker = {
    code: 'CODE DRAFT',
    chemical: 'MOLECULAR STRUCTURE',
    figure: 'FIGURE REVIEW',
    genome: 'GENOMIC TRACKS',
    manuscript: 'MANUSCRIPT DIFF',
    table: 'EDITABLE DATA',
    'three-d': 'INTERACTIVE 3D'
  };
  heading.append(create('span', 'section-kicker', kicker[mode] ?? 'OUTPUT WORKSPACE'),
    create('h2', '', artifact.name),
    create('p', '', 'The archived artifact remains immutable. Views become AI-visible interactions; editable outputs can also be saved as verified revisions with explicit accept/reject decisions.'));
  const badge = create('span', 'source-badge', record.kind + ' · ' + compact(record.record_id, 18));
  header.append(heading, badge);
  const body = create('div', 'studio-body');
  frame.append(header, body);
  elements.recordDetail.append(frame);
  focusRecordDetail();
  return { frame, body };
}

async function openArtifactStudio(artifact, record, mode) {
  if (mode === 'figure') rememberPngSource(artifact, record);
  const studio = studioFrame(mode, artifact, record);
  studio.body.append(create('div', 'studio-loading', 'Loading recorded artifact…'));
  try {
    const response = await fetch(artifact.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Artifact request failed with status ' + response.status);
    const length = Number(response.headers.get('content-length'));
    const maximumBytes = mode === 'figure' ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
    if (Number.isFinite(length) && length > maximumBytes) {
      throw new Error(mode === 'figure'
        ? 'Interactive figures are limited to 20 MB.'
        : 'Interactive text artifacts are limited to 5 MB.');
    }
    studio.body.replaceChildren();
    const descriptor = {
      kind: record.kind,
      record_id: record.record_id,
      name: artifact.name,
      url: artifact.url
    };
    const extension = extensionOf(artifact.name);
    if (mode === 'figure') {
      const blob = await response.blob();
      if (blob.size > maximumBytes) throw new Error('Interactive figures are limited to 20 MB.');
      await openFigureStudio(studio.body, descriptor, blob);
    } else if (mode === 'table' && extension === 'xlsx') {
      await openWorkbookStudio(studio.body, descriptor, await response.arrayBuffer());
    } else {
      const text = await response.text();
      if (mode === 'code') openCodeStudio(studio.body, descriptor, text);
      else if (mode === 'table') openTableStudio(studio.body, descriptor, text);
      else if (mode === 'chemical') openChemicalStudio(studio.body, descriptor, text, extension);
      else if (mode === 'genome') openGenomeStudio(studio.body, descriptor, text, extension);
      else if (mode === 'manuscript') openManuscriptStudio(studio.body, descriptor, text, extension);
      else openThreeDStudio(studio.body, descriptor, text, extension);
    }
  } catch (error) {
    studio.body.replaceChildren(create('div', 'studio-error', error.message));
  }
}

function downloadDraft(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MAX_PERSISTED_REVISION_BYTES = 8 * 1024 * 1024;

function revisionsForArtifact(artifact) {
  return (labState?.revisions ?? [])
    .filter((revision) => revision.source?.url === artifact.url)
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function refreshHarnessAfterRevision() {
  if (!selectedChat) return;
  try {
    const { payload } = await fetchJson(
      '/api/chats/' + encodeURIComponent(selectedChat) + '/harness'
    );
    activeHarness = payload;
    renderHarness(activeHarness);
  } catch {
    // The immutable revision is already recorded; a later refresh can rebuild the panel.
  }
}

async function persistArtifactRevision(artifact, content, {
  name = artifact.name,
  mediaType,
  note,
  ledger
} = {}) {
  if (!selectedChat) {
    showNotice('Start or select a conversation before saving an artifact revision.');
    return null;
  }
  const body = {
    chat_id: selectedChat,
    source: artifact,
    name,
    media_type: mediaType,
    note: note?.trim() || undefined
  };
  const previous = revisionsForArtifact(artifact).at(-1);
  if (previous) body.previous_revision_id = previous.revision_id;
  if (typeof content === 'string') {
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > MAX_PERSISTED_REVISION_BYTES) {
      showNotice('Persisted revisions are limited to 8 MB. Download this draft instead.');
      return null;
    }
    body.content = content;
  } else {
    const bytes = content instanceof Uint8Array
      ? content
      : new Uint8Array(content instanceof ArrayBuffer ? content : await content.arrayBuffer());
    if (bytes.length > MAX_PERSISTED_REVISION_BYTES) {
      showNotice('Persisted revisions are limited to 8 MB. Download this draft instead.');
      return null;
    }
    body.content_base64 = bytesToBase64(bytes);
  }
  try {
    const { payload } = await fetchJson('/api/revisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    await loadState(false, true);
    await refreshHarnessAfterRevision();
    ledger?.refresh();
    if (payload.interaction_error) {
      showNotice('Revision saved, but AI handoff needs attention: ' + payload.interaction_error.message);
    } else {
      showNotice('Immutable revision saved as a proposal. Accept or reject it explicitly below.');
    }
    return payload.revision;
  } catch (error) {
    showNotice(error.message);
    return null;
  }
}

async function decideRevision(revisionId, decision, note, ledger) {
  if (!selectedChat) {
    showNotice('Select a conversation before reviewing an artifact revision.');
    return null;
  }
  try {
    const { payload } = await fetchJson(
      '/api/revisions/' + encodeURIComponent(revisionId) + '/decisions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChat,
          decision,
          note: note?.trim() || undefined
        })
      }
    );
    await loadState(false, true);
    await refreshHarnessAfterRevision();
    ledger?.refresh();
    showNotice('Revision ' + decision + '. The decision is now visible to the AI and lineage graph.');
    return payload.revision;
  } catch (error) {
    showNotice(error.message);
    return null;
  }
}

function createRevisionLedger(artifact) {
  const element = create('section', 'revision-ledger');
  const header = create('header', 'revision-ledger-header');
  const heading = create('div');
  heading.append(create('span', 'section-kicker', 'IMMUTABLE OUTPUT VERSIONS'),
    create('strong', '', 'Revision review'));
  const count = create('span', 'revision-count', '0 revisions');
  header.append(heading, count);
  const explanation = create('p', 'revision-explanation',
    'Saving creates a new verified file; it never overwrites the recorded source. Only an explicitly accepted revision should be used downstream.');
  const note = create('textarea', 'revision-note');
  note.maxLength = 2000;
  note.placeholder = 'Optional rationale for this proposal or review decision';
  const history = create('div', 'revision-history');
  element.append(header, explanation, note, history);

  function refresh() {
    const revisions = revisionsForArtifact(artifact);
    count.textContent = revisions.length + ' revision' + (revisions.length === 1 ? '' : 's');
    history.replaceChildren();
    if (!revisions.length) {
      history.append(create('p', 'revision-empty', 'No persisted revision yet.'));
      return;
    }
    for (const revision of [...revisions].reverse()) {
      const row = create('article', 'revision-row ' + revision.status);
      const main = create('div', 'revision-row-main');
      const title = create('div', 'revision-row-title');
      title.append(create('strong', '', revision.name ?? revision.revision_id),
        statusPill(revision.verified ? revision.status : 'attention'));
      main.append(title,
        create('code', 'revision-id', compact(revision.revision_id, 48)),
        create('small', '', formatDate(revision.created_at) + ' · ' +
          compact(revision.artifact_sha256, 14) + '…' +
          (revision.previous_revision_id ? ' · follows prior version' : '')));
      if (revision.note) main.append(create('p', 'revision-row-note', revision.note));
      const actions = create('div', 'revision-actions');
      const open = create('a', 'quiet-button', 'Open file');
      open.href = revision.url;
      open.target = '_blank';
      open.rel = 'noreferrer';
      actions.append(open);
      if (revision.verified && revision.status === 'proposed') {
        const accept = create('button', 'revision-decision accept', 'Accept');
        const reject = create('button', 'revision-decision reject', 'Reject');
        accept.type = 'button';
        reject.type = 'button';
        accept.addEventListener('click', async () => {
          accept.disabled = true;
          reject.disabled = true;
          await decideRevision(revision.revision_id, 'accepted', note.value, api);
        });
        reject.addEventListener('click', async () => {
          accept.disabled = true;
          reject.disabled = true;
          await decideRevision(revision.revision_id, 'rejected', note.value, api);
        });
        actions.append(accept, reject);
      }
      row.append(main, actions);
      history.append(row);
    }
  }

  const api = { element, note, refresh };
  refresh();
  return api;
}

function textMediaType(extension) {
  const types = {
    bed: 'text/tab-separated-values; charset=utf-8',
    bedgraph: 'text/tab-separated-values; charset=utf-8',
    bdg: 'text/tab-separated-values; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    fa: 'text/plain; charset=utf-8',
    faa: 'text/plain; charset=utf-8',
    fasta: 'text/plain; charset=utf-8',
    ffn: 'text/plain; charset=utf-8',
    fna: 'text/plain; charset=utf-8',
    gff: 'text/tab-separated-values; charset=utf-8',
    gff3: 'text/tab-separated-values; charset=utf-8',
    gtf: 'text/tab-separated-values; charset=utf-8',
    markdown: 'text/markdown; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    mdx: 'text/markdown; charset=utf-8',
    mol: 'chemical/x-mdl-molfile; charset=utf-8',
    sdf: 'chemical/x-mdl-sdfile; charset=utf-8',
    smi: 'chemical/x-daylight-smiles; charset=utf-8',
    smiles: 'chemical/x-daylight-smiles; charset=utf-8',
    rst: 'text/x-rst; charset=utf-8',
    tex: 'application/x-tex; charset=utf-8',
    tsv: 'text/tab-separated-values; charset=utf-8',
    vcf: 'text/plain; charset=utf-8'
  };
  return types[extension] ?? 'text/plain; charset=utf-8';
}

function appendNativeSourceEditor(container, artifact, original, {
  surface,
  ledger,
  extension,
  label = 'artifact',
  onApply
}) {
  const details = create('details', 'native-source-editor');
  const summary = create('summary', '', 'Edit ' + label + ' source');
  const explanation = create('p', 'native-source-explanation',
    'Source edits stay local until shared or saved. Saving creates an immutable proposal and never changes the recorded artifact.');
  const toolbar = create('div', 'studio-toolbar native-source-toolbar');
  const state = create('span', 'studio-state', 'No source changes');
  const download = create('button', 'secondary-button', 'Download draft');
  const apply = onApply ? create('button', 'secondary-button', 'Apply draft to view') : null;
  const persist = create('button', 'revision-save-button', 'Save immutable revision');
  const share = create('button', 'share-button', 'Share source edit');
  const editor = create('textarea', 'native-source-textarea');
  editor.spellcheck = false;
  editor.maxLength = 6_000_000;
  editor.value = original;
  for (const button of [download, apply, persist, share].filter(Boolean)) button.type = 'button';
  download.addEventListener('click', () => downloadDraft(
    artifact.name.replace(/(\.[^.]+)?$/, '-draft$1'), editor.value,
    textMediaType(extension)
  ));
  if (apply) {
    apply.addEventListener('click', () => {
      try {
        onApply(editor.value);
        state.textContent = 'Draft applied to local view; not yet persisted';
        state.className = 'studio-state changed';
      } catch (error) {
        showNotice(error.message);
      }
    });
  }
  persist.addEventListener('click', async () => {
    if (editor.value === original) {
      showNotice('Change the source before saving a revision.');
      return;
    }
    persist.disabled = true;
    const previous = persist.textContent;
    persist.textContent = 'Saving revision...';
    const revision = await persistArtifactRevision(artifact, editor.value, {
      mediaType: textMediaType(extension),
      note: ledger.note.value,
      ledger
    });
    if (revision) {
      state.textContent = 'Immutable proposal saved - ' + revision.manifest.revision_id;
      state.className = 'studio-state saved';
      ledger.note.value = '';
    }
    persist.disabled = false;
    persist.textContent = previous;
  });
  share.addEventListener('click', async () => {
    if (editor.value === original) {
      showNotice('Change the source before sharing it with the AI.');
      return;
    }
    const excerpt = boundedUtf8Excerpt(editor.value);
    const interaction = await saveInteraction(surface, 'source.edited', artifact, {
      format: extension,
      changed: true,
      original_characters: original.length,
      draft_characters: editor.value.length,
      excerpt: excerpt.text,
      excerpt_truncated: excerpt.truncated
    });
    if (interaction) {
      state.textContent = 'Source edit shared - ' + interaction.interaction_id;
      state.className = 'studio-state saved';
    }
  });
  editor.addEventListener('input', () => {
    const changed = editor.value !== original;
    state.textContent = changed ? editor.value.length + ' characters - unsaved' : 'No source changes';
    state.className = changed ? 'studio-state changed' : 'studio-state';
  });
  toolbar.append(state, download);
  if (apply) toolbar.append(apply);
  toolbar.append(persist, share);
  details.append(summary, explanation, toolbar, editor);
  container.append(details);
  return { details, editor, state };
}

function boundedCellChanges(values, maxBytes = 38 * 1024) {
  const selected = [];
  let bytes = 2;
  for (const value of values) {
    const normalized = {
      ...value,
      old_value: String(value.old_value ?? '').slice(0, 2_000),
      value: String(value.value ?? '').slice(0, 2_000)
    };
    const size = new TextEncoder().encode(JSON.stringify(normalized)).length + 1;
    if (bytes + size > maxBytes) break;
    selected.push(normalized);
    bytes += size;
  }
  return selected;
}

function openCodeStudio(container, artifact, text) {
  const original = text;
  const revisions = createRevisionLedger(artifact);
  const editor = create('textarea', 'code-editor');
  editor.spellcheck = false;
  editor.maxLength = 40000;
  editor.value = text.slice(0, editor.maxLength);
  const toolbar = create('div', 'studio-toolbar');
  const state = create('span', 'studio-state',
    text.length > editor.maxLength ? 'Large file: editing first 40,000 characters' : 'No draft changes');
  const download = create('button', 'secondary-button', 'Download draft');
  download.type = 'button';
  download.addEventListener('click', () => downloadDraft(
    artifact.name.replace(/(\.[^.]+)?$/, '-draft$1'),
    editor.value,
    'text/plain'
  ));
  const save = create('button', 'share-button', 'Share edit with AI');
  save.type = 'button';
  save.disabled = text.length > editor.maxLength;
  save.addEventListener('click', async () => {
    if (new TextEncoder().encode(editor.value).length > 38 * 1024) {
      showNotice('AI-shared code drafts are limited to 38 KB. Download the full draft or share a smaller edit.');
      return;
    }
    const record = await saveInteraction('code', 'draft.saved', artifact, {
      language: extensionOf(artifact.name),
      content: editor.value,
      original_bytes: new TextEncoder().encode(original).length,
      changed: editor.value !== original
    });
    if (record) {
      state.textContent = 'Saved · ' + record.interaction_id;
      state.className = 'studio-state saved';
    }
  });
  const persist = create('button', 'revision-save-button', 'Save immutable revision');
  persist.type = 'button';
  persist.disabled = text.length > editor.maxLength;
  persist.addEventListener('click', async () => {
    if (editor.value === original) {
      showNotice('Change the draft before saving a revision.');
      return;
    }
    persist.disabled = true;
    const previous = persist.textContent;
    persist.textContent = 'Saving revision…';
    const revision = await persistArtifactRevision(artifact, editor.value, {
      mediaType: 'text/plain; charset=utf-8',
      note: revisions.note.value,
      ledger: revisions
    });
    if (revision) {
      state.textContent = 'Immutable proposal saved · ' + revision.manifest.revision_id;
      state.className = 'studio-state saved';
      revisions.note.value = '';
    }
    persist.disabled = false;
    persist.textContent = previous;
  });
  editor.addEventListener('input', () => {
    state.textContent = editor.value === original ? 'No draft changes' :
      editor.value.length + ' characters · unsaved';
    state.className = 'studio-state changed';
  });
  toolbar.append(state, download, persist, save);
  container.append(toolbar, revisions.element, editor);
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function columnLabel(index) {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function quoteCell(value, delimiter) {
  const text = String(value ?? '');
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? '"' + text.replaceAll('"', '""') + '"'
    : text;
}

function serializeTable(rows, delimiter) {
  return rows.map((row) => row.map((value) => quoteCell(value, delimiter)).join(delimiter)).join('\n') + '\n';
}

function openDataPlotStudio(container, artifact, rowsProvider, metadataProvider = () => ({})) {
  const getRows = typeof rowsProvider === 'function' ? rowsProvider : () => rowsProvider;
  const controls = create('div', 'plot-controls');
  const xSelect = create('select');
  const ySelect = create('select');
  xSelect.setAttribute('aria-label', 'Plot horizontal axis');
  ySelect.setAttribute('aria-label', 'Plot vertical axis');
  const xField = create('label', 'plot-field');
  const yField = create('label', 'plot-field');
  xField.append(create('span', '', 'X AXIS'), xSelect);
  yField.append(create('span', '', 'Y AXIS'), ySelect);
  const reset = create('button', 'secondary-button', 'Reset view');
  reset.type = 'button';
  const share = create('button', 'share-button', 'Share plot with AI');
  share.type = 'button';
  controls.append(xField, yField, reset, share);

  const viewer = create('div', 'plot-viewer');
  const canvas = create('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive data plot for ' + artifact.name +
    '. Drag to pan, use the wheel to zoom, and click a point to select it.');
  const overlay = create('div', 'viewer-overlay');
  overlay.append(create('span', '', 'DRAG PAN'), create('span', '', 'WHEEL ZOOM'),
    create('span', '', 'CLICK SELECT'), create('span', '', 'R RESET'));
  viewer.append(canvas, overlay);
  const readout = create('div', 'selection-readout', 'Choose numeric axes to inspect recorded data.');
  const direction = create('textarea', 'plot-direction');
  direction.maxLength = 1000;
  direction.rows = 2;
  direction.placeholder = 'Optional direction for the AI: compare this region, revise the axis, explain the selected point…';
  direction.setAttribute('aria-label', 'Plot direction for the AI');
  const note = create('p', 'studio-note',
    'Plot state is a review layer over the loaded draft. Sharing records the axes, viewport, selection, and direction; it does not replace the archived data.');
  container.append(controls, viewer, readout, direction, note);

  let series = buildPlotSeries([]);
  let view = fitPlotView(series.bounds);
  let selected = null;
  let drag = null;

  function rounded(value) {
    return Number.isFinite(value) ? Number(value.toPrecision(9)) : null;
  }

  function canvasSize() {
    const bounds = canvas.getBoundingClientRect();
    return {
      width: Math.max(320, Math.round(bounds.width || 760)),
      height: Math.max(260, Math.round(bounds.height || 460))
    };
  }

  function prepareCanvas() {
    const size = canvasSize();
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (canvas.width !== Math.round(size.width * ratio) ||
        canvas.height !== Math.round(size.height * ratio)) {
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, ...size };
  }

  function draw() {
    if (!canvas.isConnected) return;
    const { context, width, height } = prepareCanvas();
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#080b0d';
    context.fillRect(0, 0, width, height);
    const left = 58;
    const right = width - 22;
    const top = 24;
    const bottom = height - 48;
    context.strokeStyle = 'rgba(112, 128, 139, 0.15)';
    context.fillStyle = '#758087';
    context.font = '9px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.lineWidth = 1;
    for (let tick = 0; tick <= 5; tick += 1) {
      const ratio = tick / 5;
      const x = left + ratio * (right - left);
      const y = top + ratio * (bottom - top);
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      const xValue = view.x_min + ratio * (view.x_max - view.x_min);
      const yValue = view.y_max - ratio * (view.y_max - view.y_min);
      context.textAlign = 'center';
      context.fillText(formatPlotNumber(xValue), x, bottom + 18);
      context.textAlign = 'right';
      context.fillText(formatPlotNumber(yValue), left - 8, y + 3);
    }
    context.strokeStyle = 'rgba(155, 171, 180, 0.45)';
    context.beginPath();
    context.moveTo(left, top);
    context.lineTo(left, bottom);
    context.lineTo(right, bottom);
    context.stroke();
    context.save();
    context.beginPath();
    context.rect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    context.clip();
    if (series.points.length > 1) {
      context.beginPath();
      series.points.forEach((point, index) => {
        const position = plotToCanvas(point, view, width, height);
        if (index === 0) context.moveTo(position.x, position.y);
        else context.lineTo(position.x, position.y);
      });
      context.strokeStyle = 'rgba(115, 168, 255, 0.72)';
      context.lineWidth = 1.4;
      context.stroke();
    }
    for (const point of series.points) {
      const position = plotToCanvas(point, view, width, height);
      context.beginPath();
      context.arc(position.x, position.y, point === selected ? 5.5 : 2.6, 0, Math.PI * 2);
      context.fillStyle = point === selected ? '#e8b86a' : '#78dba9';
      context.fill();
      if (point === selected) {
        context.strokeStyle = 'rgba(232, 184, 106, 0.45)';
        context.lineWidth = 4;
        context.stroke();
      }
    }
    context.restore();
    context.fillStyle = '#9aa5ab';
    context.textAlign = 'center';
    context.fillText(series.x_label, (left + right) / 2, height - 10);
    context.save();
    context.translate(13, (top + bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(series.y_label, 0, 0);
    context.restore();
    if (!series.points.length) {
      context.fillStyle = '#89949a';
      context.textAlign = 'center';
      context.font = '11px system-ui, sans-serif';
      context.fillText('No finite numeric pairs for these axes', width / 2, height / 2);
    }
  }

  function updateReadout() {
    if (!series.points.length) {
      readout.textContent = 'No plottable numeric values were found for the selected axes.';
      share.disabled = true;
      return;
    }
    share.disabled = false;
    if (!selected) {
      readout.textContent = series.source_point_count + ' source points · ' + series.points.length +
        ' rendered · click a point to inspect its source row';
      return;
    }
    readout.textContent = 'Row ' + selected.row + ' · ' + series.x_label + ' ' +
      formatPlotNumber(selected.x) + ' · ' + series.y_label + ' ' + formatPlotNumber(selected.y);
  }

  function populateAxes(forceDefaults = false) {
    const probe = buildPlotSeries(getRows());
    const columns = probe.layout.numeric_columns;
    const previousX = xSelect.value;
    const previousY = ySelect.value;
    xSelect.replaceChildren();
    const indexOption = create('option', '', 'Row index');
    indexOption.value = 'index';
    xSelect.append(indexOption);
    for (const column of columns) {
      const option = create('option', '', column.label);
      option.value = String(column.index);
      xSelect.append(option);
    }
    ySelect.replaceChildren();
    for (const column of columns) {
      const option = create('option', '', column.label);
      option.value = String(column.index);
      ySelect.append(option);
    }
    const numericValues = new Set(columns.map((column) => String(column.index)));
    xSelect.value = !forceDefaults && (previousX === 'index' || numericValues.has(previousX))
      ? previousX
      : String(columns[0]?.index ?? 'index');
    ySelect.value = !forceDefaults && numericValues.has(previousY)
      ? previousY
      : String(columns[1]?.index ?? columns[0]?.index ?? '');
  }

  function refresh(resetView = false, rebuildAxes = false) {
    const selectedRow = selected?.row;
    if (rebuildAxes || !ySelect.childElementCount) populateAxes(rebuildAxes);
    series = buildPlotSeries(getRows(), { xColumn: xSelect.value, yColumn: ySelect.value });
    selected = selectedRow ? series.points.find((point) => point.row === selectedRow) ?? null : null;
    if (resetView) view = fitPlotView(series.bounds);
    updateReadout();
    draw();
  }

  xSelect.addEventListener('change', () => refresh(true));
  ySelect.addEventListener('change', () => refresh(true));
  reset.addEventListener('click', () => {
    view = fitPlotView(series.bounds);
    selected = null;
    updateReadout();
    draw();
  });
  share.addEventListener('click', async () => {
    const payload = {
      ...metadataProvider(),
      plot_type: 'line-scatter',
      x_column: series.x_column,
      y_column: series.y_column,
      x_label: series.x_label,
      y_label: series.y_label,
      point_count: series.source_point_count,
      rendered_points: series.points.length,
      view: Object.fromEntries(Object.entries(view).map(([key, value]) => [key, rounded(value)])),
      selected: selected ? {
        row: selected.row,
        x: rounded(selected.x),
        y: rounded(selected.y),
        source_x: selected.source_x,
        source_y: selected.source_y
      } : null,
      instruction: direction.value.trim() || null
    };
    const record = await saveInteraction('plot', 'view.saved', artifact, payload);
    if (record) {
      readout.textContent = 'Plot review saved · ' + record.interaction_id;
      readout.className = 'selection-readout saved';
    }
  });

  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.hypot(deltaX, deltaY) > 1) drag.moved = true;
    const size = canvasSize();
    view = panPlotView(view, deltaX, deltaY, size.width, size.height);
    drag.x = event.clientX;
    drag.y = event.clientY;
    draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved) {
      const bounds = canvas.getBoundingClientRect();
      selected = nearestPlotPoint(series.points, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      }, view, bounds.width, bounds.height, 20);
      updateReadout();
      draw();
    }
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const anchor = canvasToPlot({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    }, view, bounds.width, bounds.height);
    view = zoomPlotView(view, anchor, event.deltaY < 0 ? 0.84 : 1.19);
    draw();
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const size = canvasSize();
    if (event.key.toLowerCase() === 'r') {
      view = fitPlotView(series.bounds);
      selected = null;
    } else if (event.key === '+' || event.key === '=') {
      view = zoomPlotView(view, null, 0.82);
    } else if (event.key === '-') {
      view = zoomPlotView(view, null, 1.22);
    } else if (event.key.startsWith('Arrow')) {
      const deltaX = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0;
      const deltaY = event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0;
      view = panPlotView(view, deltaX, deltaY, size.width, size.height);
    } else {
      return;
    }
    event.preventDefault();
    updateReadout();
    draw();
  });

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!container.isConnected) return observer.disconnect();
      draw();
    });
    observer.observe(viewer);
  }
  populateAxes(true);
  refresh(true);
  return { draw, refresh };
}

function openTableStudio(container, artifact, text) {
  const delimiter = extensionOf(artifact.name) === 'tsv' ? '\t' : ',';
  const rows = parseDelimited(text, delimiter);
  const totalColumns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const visibleRows = Math.min(rows.length, 200);
  const visibleColumns = Math.min(totalColumns, 40);
  const changes = new Map();
  const revisions = createRevisionLedger(artifact);
  let plotStudio = null;
  const toolbar = create('div', 'studio-toolbar');
  const state = create('span', 'studio-state',
    rows.length + ' rows · ' + visibleColumns + ' visible columns');
  const download = create('button', 'secondary-button', 'Download draft');
  download.type = 'button';
  download.addEventListener('click', () => downloadDraft(
    artifact.name.replace(/(\.[^.]+)?$/, '-draft$1'),
    serializeTable(rows, delimiter),
    delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv'
  ));
  const save = create('button', 'share-button', 'Share cells with AI');
  save.type = 'button';
  save.addEventListener('click', async () => {
    const values = boundedCellChanges([...changes.values()]);
    if (!values.length) return;
    const record = await saveInteraction('table', 'cells.saved', artifact, {
      format: delimiter === '\t' ? 'tsv' : 'csv',
      changes: values,
      total_rows: rows.length,
      visible_rows: visibleRows
    });
    if (record) {
      state.textContent = values.length + ' cell changes saved';
      state.className = 'studio-state saved';
    }
  });
  const persist = create('button', 'revision-save-button', 'Save immutable revision');
  persist.type = 'button';
  persist.addEventListener('click', async () => {
    if (!changes.size) {
      showNotice('Change at least one cell before saving a revision.');
      return;
    }
    persist.disabled = true;
    const previous = persist.textContent;
    persist.textContent = 'Saving revision…';
    const revision = await persistArtifactRevision(artifact, serializeTable(rows, delimiter), {
      mediaType: delimiter === '\t'
        ? 'text/tab-separated-values; charset=utf-8'
        : 'text/csv; charset=utf-8',
      note: revisions.note.value,
      ledger: revisions
    });
    if (revision) {
      state.textContent = changes.size + ' cell changes persisted · ' +
        revision.manifest.revision_id;
      state.className = 'studio-state saved';
      revisions.note.value = '';
    }
    persist.disabled = false;
    persist.textContent = previous;
  });
  toolbar.append(state, download, persist, save);
  const viewport = create('div', 'sheet-viewport');
  const table = create('table', 'sheet-table');
  const head = create('thead');
  const headRow = create('tr');
  headRow.append(create('th', 'row-number', ''));
  for (let column = 0; column < visibleColumns; column += 1) {
    headRow.append(create('th', '', columnLabel(column)));
  }
  head.append(headRow);
  const body = create('tbody');
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex += 1) {
    const rowElement = create('tr');
    rowElement.append(create('th', 'row-number', String(rowIndex + 1)));
    for (let column = 0; column < visibleColumns; column += 1) {
      const cell = create('td');
      const input = create('input');
      input.maxLength = 2000;
      const original = rows[rowIndex]?.[column] ?? '';
      input.value = original;
      input.setAttribute('aria-label', 'Cell ' + columnLabel(column) + (rowIndex + 1));
      input.addEventListener('input', () => {
        if (!rows[rowIndex]) rows[rowIndex] = [];
        rows[rowIndex][column] = input.value;
        const cellName = columnLabel(column) + (rowIndex + 1);
        if (input.value === original) changes.delete(cellName);
        else changes.set(cellName, {
          cell: cellName,
          row: rowIndex + 1,
          column: column + 1,
          old_value: original,
          value: input.value
        });
        state.textContent = changes.size + ' unsaved cell changes';
        state.className = 'studio-state changed';
        if (!plotHost.hidden) plotStudio?.refresh(false);
      });
      cell.append(input);
      rowElement.append(cell);
    }
    body.append(rowElement);
  }
  table.append(head, body);
  viewport.append(table);
  const switcher = create('div', 'studio-switcher');
  const dataButton = create('button', 'active', 'Data');
  const plotButton = create('button', '', 'Plot');
  dataButton.type = 'button';
  plotButton.type = 'button';
  dataButton.setAttribute('aria-pressed', 'true');
  plotButton.setAttribute('aria-pressed', 'false');
  switcher.append(dataButton, plotButton);
  const dataHost = create('div', 'studio-mode-pane');
  const plotHost = create('div', 'studio-mode-pane plot-mode');
  plotHost.hidden = true;
  dataHost.append(viewport);
  if (rows.length > visibleRows || totalColumns > visibleColumns) {
    dataHost.append(create('p', 'studio-note',
      'For responsiveness, this editor shows the first 200 rows and 40 columns. Download preserves the loaded table.'));
  }
  container.append(toolbar, revisions.element, switcher, dataHost, plotHost);
  plotStudio = openDataPlotStudio(plotHost, artifact, () => rows, () => ({
    format: delimiter === '\t' ? 'tsv' : 'csv'
  }));
  function selectMode(mode) {
    const plotting = mode === 'plot';
    dataHost.hidden = plotting;
    plotHost.hidden = !plotting;
    dataButton.classList.toggle('active', !plotting);
    plotButton.classList.toggle('active', plotting);
    dataButton.setAttribute('aria-pressed', String(!plotting));
    plotButton.setAttribute('aria-pressed', String(plotting));
    if (plotting) window.requestAnimationFrame(() => {
      plotStudio.refresh(false);
      plotStudio.draw();
    });
  }
  dataButton.addEventListener('click', () => selectMode('data'));
  plotButton.addEventListener('click', () => selectMode('plot'));
}

async function openWorkbookStudio(container, artifact, buffer) {
  const { loadXlsxWorkbook } = await import('/xlsx.js');
  const workbook = await loadXlsxWorkbook(buffer);
  const changes = new Map();
  const originals = new Map();
  let sheetIndex = 0;
  let plotStudio = null;
  let plotNeedsAxes = true;
  const revisions = createRevisionLedger(artifact);

  const toolbar = create('div', 'studio-toolbar workbook-toolbar');
  const state = create('span', 'studio-state',
    workbook.worksheets.length + ' worksheet' + (workbook.worksheets.length === 1 ? '' : 's') +
    ' · no draft changes');
  const sheetSelect = create('select', 'workbook-sheet-select');
  sheetSelect.setAttribute('aria-label', 'Workbook sheet');
  workbook.worksheets.forEach((sheet, index) => {
    const option = create('option', '', sheet.name);
    option.value = String(index);
    sheetSelect.append(option);
  });
  const download = create('button', 'secondary-button', 'Download .xlsx draft');
  download.type = 'button';
  download.addEventListener('click', async () => {
    download.disabled = true;
    const previous = download.textContent;
    download.textContent = 'Building workbook…';
    try {
      const output = await workbook.writeBuffer();
      downloadDraft(
        artifact.name.replace(/\.xlsx$/i, '-draft.xlsx'),
        output,
        workbook.mimeType
      );
      state.textContent = 'Workbook draft downloaded · archive unchanged';
      state.className = 'studio-state saved';
    } catch (error) {
      showNotice(error.message);
    } finally {
      download.disabled = false;
      download.textContent = previous;
    }
  });
  const share = create('button', 'share-button', 'Share cells with AI');
  share.type = 'button';
  share.addEventListener('click', async () => {
    const selected = boundedCellChanges([...changes.values()]);
    if (!selected.length) return;
    const record = await saveInteraction('table', 'workbook.cells.saved', artifact, {
      format: 'xlsx',
      workbook: artifact.name,
      worksheet_count: workbook.worksheets.length,
      changes: selected,
      total_changes: changes.size,
      omitted_changes: Math.max(0, changes.size - selected.length)
    });
    if (record) {
      state.textContent = selected.length + ' workbook cell changes saved for AI' +
        (selected.length < changes.size ? ' (' + (changes.size - selected.length) + ' omitted by size limit)' : '');
      state.className = 'studio-state saved';
    }
  });
  const persist = create('button', 'revision-save-button', 'Save immutable .xlsx');
  persist.type = 'button';
  persist.addEventListener('click', async () => {
    if (!changes.size) {
      showNotice('Change at least one workbook cell before saving a revision.');
      return;
    }
    persist.disabled = true;
    const previous = persist.textContent;
    persist.textContent = 'Building revision…';
    try {
      const output = await workbook.writeBuffer();
      const revision = await persistArtifactRevision(artifact, output, {
        mediaType: workbook.mimeType,
        note: revisions.note.value,
        ledger: revisions
      });
      if (revision) {
        state.textContent = changes.size + ' workbook changes persisted · ' +
          revision.manifest.revision_id;
        state.className = 'studio-state saved';
        revisions.note.value = '';
      }
    } catch (error) {
      showNotice(error.message);
    } finally {
      persist.disabled = false;
      persist.textContent = previous;
    }
  });
  toolbar.append(state, sheetSelect, download, persist, share);
  const sheetHost = create('div', 'workbook-sheet-host');
  const switcher = create('div', 'studio-switcher');
  const dataButton = create('button', 'active', 'Workbook');
  const plotButton = create('button', '', 'Plot');
  dataButton.type = 'button';
  plotButton.type = 'button';
  dataButton.setAttribute('aria-pressed', 'true');
  plotButton.setAttribute('aria-pressed', 'false');
  switcher.append(dataButton, plotButton);
  const plotHost = create('div', 'studio-mode-pane plot-mode');
  plotHost.hidden = true;
  container.append(toolbar, revisions.element, switcher, sheetHost, plotHost);

  function currentSheetRows() {
    const sheet = workbook.worksheets[sheetIndex];
    const rows = Math.min(Math.max(sheet.maxRow, 0), 5001);
    const columns = Math.min(Math.max(sheet.maxColumn, 0), 80);
    return Array.from({ length: rows }, (_, rowIndex) =>
      Array.from({ length: columns }, (_, columnIndex) =>
        sheet.getValue(rowIndex + 1, columnIndex + 1)
      )
    );
  }

  function renderSheet() {
    const sheet = workbook.worksheets[sheetIndex];
    const visibleRows = Math.min(Math.max(sheet.maxRow, 20), 200);
    const visibleColumns = Math.min(Math.max(sheet.maxColumn, 10), 40);
    const viewport = create('div', 'sheet-viewport workbook-viewport');
    const table = create('table', 'sheet-table');
    const head = create('thead');
    const headRow = create('tr');
    headRow.append(create('th', 'row-number', ''));
    for (let column = 1; column <= visibleColumns; column += 1) {
      headRow.append(create('th', '', columnLabel(column - 1)));
    }
    head.append(headRow);
    const body = create('tbody');
    for (let row = 1; row <= visibleRows; row += 1) {
      const rowElement = create('tr');
      rowElement.append(create('th', 'row-number', String(row)));
      for (let column = 1; column <= visibleColumns; column += 1) {
        const cellName = columnLabel(column - 1) + row;
        const changeKey = sheetIndex + '!' + cellName;
        const cell = create('td');
        const input = create('input');
        input.maxLength = 2000;
        input.dataset.row = String(row);
        input.dataset.column = String(column);
        const current = sheet.getValue(row, column);
        if (!originals.has(changeKey)) originals.set(changeKey, current);
        input.value = current;
        input.setAttribute('aria-label', sheet.name + ' cell ' + cellName);
        input.addEventListener('input', () => {
          sheet.setValue(row, column, input.value);
          const original = originals.get(changeKey) ?? '';
          if (input.value === original) {
            changes.delete(changeKey);
          } else {
            changes.set(changeKey, {
              sheet: sheet.name,
              cell: cellName,
              row,
              column,
              old_value: original,
              value: input.value
            });
          }
          state.textContent = changes.size + ' unsaved workbook cell change' +
            (changes.size === 1 ? '' : 's');
          state.className = 'studio-state changed';
          if (!plotHost.hidden) plotStudio?.refresh(false);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          viewport.querySelector(
            'input[data-row="' + Math.min(visibleRows, row + 1) + '"][data-column="' + column + '"]'
          )?.focus();
        });
        cell.append(input);
        rowElement.append(cell);
      }
      body.append(rowElement);
    }
    table.append(head, body);
    viewport.append(table);
    sheetHost.replaceChildren(viewport);
    if (sheet.maxRow > visibleRows || sheet.maxColumn > visibleColumns) {
      sheetHost.append(create('p', 'studio-note',
        'This sheet uses ' + sheet.maxRow + ' rows and ' + sheet.maxColumn +
        ' columns. The interactive editor shows the first 200 rows and 40 columns; download preserves the rest.'));
    }
  }

  sheetSelect.addEventListener('change', () => {
    sheetIndex = Number(sheetSelect.value);
    renderSheet();
    if (plotHost.hidden) plotNeedsAxes = true;
    else {
      plotStudio?.refresh(true, true);
      plotNeedsAxes = false;
    }
  });
  renderSheet();
  plotStudio = openDataPlotStudio(plotHost, artifact, currentSheetRows, () => ({
    format: 'xlsx',
    workbook: artifact.name,
    worksheet: workbook.worksheets[sheetIndex].name,
    worksheet_index: sheetIndex
  }));
  plotNeedsAxes = false;
  function selectMode(mode) {
    const plotting = mode === 'plot';
    sheetHost.hidden = plotting;
    plotHost.hidden = !plotting;
    dataButton.classList.toggle('active', !plotting);
    plotButton.classList.toggle('active', plotting);
    dataButton.setAttribute('aria-pressed', String(!plotting));
    plotButton.setAttribute('aria-pressed', String(plotting));
    if (plotting) window.requestAnimationFrame(() => {
      plotStudio.refresh(plotNeedsAxes, plotNeedsAxes);
      plotNeedsAxes = false;
      plotStudio.draw();
    });
  }
  dataButton.addEventListener('click', () => selectMode('data'));
  plotButton.addEventListener('click', () => selectMode('plot'));
}

async function decodeFigure(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // The data-URL fallback below supports browsers or formats without ImageBitmap decoding.
    }
  }
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('The figure could not be decoded.')));
    reader.readAsDataURL(blob);
  });
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('The figure could not be decoded.')));
    image.src = source;
  });
}

function figureComparisonsForArtifact(artifact) {
  return (labState?.figure_comparisons ?? []).filter((comparison) =>
    comparison.baseline?.url === artifact.url ||
    comparison.candidate?.url === artifact.url
  ).sort((left, right) => String(right.created_at ?? '').localeCompare(
    String(left.created_at ?? '')
  ));
}

function figureRegistrationsForArtifact(artifact) {
  return (labState?.figure_registrations ?? []).filter((registration) =>
    registration.figure?.url === artifact.url
  ).sort((left, right) => String(right.created_at ?? '').localeCompare(
    String(left.created_at ?? '')
  ));
}

function figureVisualsForArtifact(artifact) {
  const registrationIds = new Set(figureRegistrationsForArtifact(artifact)
    .map((registration) => registration.figure_registration_id));
  return (labState?.figure_visuals ?? []).filter((visual) =>
    registrationIds.has(visual.figure_registration_id)
  ).sort((left, right) => String(right.created_at ?? '').localeCompare(
    String(left.created_at ?? '')
  ));
}

function expandedFigureVisualDomain(minimum, maximum, scale) {
  const low = Number(minimum);
  const high = Number(maximum);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return scale === 'log10'
      ? { minimum: 0.1, maximum: 10 }
      : { minimum: 0, maximum: 1 };
  }
  if (scale === 'log10') {
    const logLow = Math.log10(low);
    const logHigh = Math.log10(high);
    const span = logHigh > logLow ? logHigh - logLow : 1;
    return {
      minimum: 10 ** (logLow - span * 0.05),
      maximum: 10 ** (logHigh + span * 0.05)
    };
  }
  const span = high > low ? high - low : Math.max(Math.abs(low), 1);
  return {
    minimum: low - span * 0.05,
    maximum: high + span * 0.05
  };
}

function figureVisualColor(index) {
  const levels = [32, 96, 160, 224];
  return {
    red: levels[index % levels.length],
    green: levels[Math.floor(index / levels.length) % levels.length],
    blue: levels[Math.floor(index / (levels.length ** 2)) % levels.length]
  };
}

function suggestedFigureVisualProfile(registration) {
  const report = registration.report ?? {};
  const contract = report.contract ?? registration.manifest?.contract ?? {};
  const replay = report.expected?.replay ?? {};
  const seriesRanges = replay.series ?? [];
  const yMinimum = Math.min(...seriesRanges.map((series) =>
    Number(series.minimum)).filter(Number.isFinite));
  const yMaximum = Math.max(...seriesRanges.map((series) =>
    Number(series.maximum)).filter(Number.isFinite));
  const chartType = contract.chart_type ?? 'line_scatter';
  const drawsLine = ['line', 'line_scatter'].includes(chartType);
  const drawsMarkers = ['scatter', 'line_scatter'].includes(chartType);
  return {
    schema_version: 1,
    plot_area: { left: 0.12, top: 0.08, right: 0.96, bottom: 0.9 },
    x_domain: expandedFigureVisualDomain(
      replay.x_axis?.minimum,
      replay.x_axis?.maximum,
      contract.x_axis?.scale
    ),
    y_domain: expandedFigureVisualDomain(
      yMinimum,
      yMaximum,
      contract.y_axis?.scale
    ),
    background_color: { red: 255, green: 255, blue: 255 },
    axis_color: { red: 0, green: 0, blue: 0 },
    axis_width_pixels: 1,
    series: (contract.series ?? []).map((series, index) => ({
      id: series.id,
      color: figureVisualColor(index),
      line_width_pixels: drawsLine ? 2 : 0,
      marker_radius_pixels: drawsMarkers ? 3 : 0
    })),
    color_tolerance: 12,
    position_tolerance_pixels: 3,
    minimum_axis_coverage: 0.8,
    minimum_series_coverage: 0.8,
    maximum_unexpected_series_fraction: 0.05,
    minimum_background_fraction: 0.95
  };
}

function visualMetricValue(value) {
  return Number.isFinite(value) ? (value * 100).toFixed(2) + '%' : 'n/a';
}

function renderFigureVisualResult(container, visual) {
  const manifest = visual.manifest;
  const report = visual.report;
  const resultHeader = create('header', 'figure-comparison-result-head');
  const heading = create('div');
  heading.append(
    create('span', 'section-kicker', 'DECODED-PIXEL VALIDATION'),
    create('h4', '', manifest.name ?? manifest.figure_visual_id),
    create('p', '',
      String(report.visual_status).replaceAll('_', ' ') + ' / ' +
      (visual.verification?.ok ? 'integrity verified' : 'integrity attention'))
  );
  resultHeader.append(heading, statusPill(visual.verification?.ok
    ? report.status : 'attention'));

  const metricGrid = create('div', 'figure-comparison-metrics');
  for (const [label, value] of [
    ['Outcome', String(report.visual_status).replaceAll('_', ' ')],
    ['Checks', String(report.summary?.passed_checks ?? 0) + ' pass / ' +
      String(report.summary?.failed_checks ?? 0) + ' fail'],
    ['Mark samples', String(report.summary?.matched_mark_samples ?? 0) + ' / ' +
      String(report.summary?.expected_mark_samples ?? 0)],
    ['Unexpected pixels', String(report.summary?.unexpected_series_pixels ?? 0) +
      ' / ' + String(report.summary?.actual_series_pixels ?? 0)],
    ['Horizontal axis', visualMetricValue(report.axes?.horizontal?.coverage)],
    ['Vertical axis', visualMetricValue(report.axes?.vertical?.coverage)],
    ['Background', visualMetricValue(report.background?.matching_fraction)],
    ['Plot pixels', report.figure?.plot_area_pixels
      ? report.figure.plot_area_pixels.width + ' × ' +
        report.figure.plot_area_pixels.height : 'n/a']
  ]) metricGrid.append(metric(label, value));

  const checks = create('div', 'gate-list figure-semantic-checks');
  for (const item of report.checks ?? []) {
    const row = create('div', 'gate-row');
    const copy = create('div');
    copy.append(
      create('strong', '', String(item.name).replaceAll('_', ' ')),
      create('small', '', visualMetricValue(item.observed) + ' / ' +
        String(item.comparison ?? 'minimum') + ' ' +
        visualMetricValue(item.threshold))
    );
    row.append(copy, statusPill(item.status));
    checks.append(row);
  }
  const series = create('details', 'figure-comparison-provenance');
  series.append(
    create('summary', '', 'Per-series decoded-pixel evidence'),
    create('pre', 'json-preview', JSON.stringify(report.series ?? [], null, 2))
  );
  const provenance = create('details', 'figure-comparison-provenance');
  provenance.append(
    create('summary', '', 'Frozen profile, semantic binding, and hashes'),
    create('pre', 'json-preview', JSON.stringify({
      figure_visual_id: manifest.figure_visual_id,
      figure_registration: manifest.figure_registration,
      profile: report.profile,
      profile_sha256: report.profile_sha256,
      figure: report.figure,
      semantic: report.semantic
    }, null, 2))
  );
  container.replaceChildren(
    resultHeader,
    metricGrid,
    checks,
    create('p', 'studio-note', report.interpretation + ' ' + report.limitations),
    series,
    provenance
  );
  container.hidden = false;
}

function renderFigureRegistrationResult(container, registration) {
  const manifest = registration.manifest;
  const report = registration.report;
  const resultHeader = create('header', 'figure-comparison-result-head');
  const heading = create('div');
  heading.append(
    create('span', 'section-kicker', 'SEMANTIC REGISTRATION'),
    create('h4', '', manifest.name ?? manifest.figure_registration_id),
    create('p', '',
      String(report.registration_status).replaceAll('_', ' ') + ' / ' +
      (registration.verification?.ok ? 'integrity verified' : 'integrity attention'))
  );
  resultHeader.append(heading, statusPill(registration.verification?.ok
    ? report.status : 'attention'));

  const metricGrid = create('div', 'figure-comparison-metrics');
  for (const [label, value] of [
    ['Binding', String(report.registration_status).replaceAll('_', ' ')],
    ['Checks', String(report.summary?.passed_checks ?? 0) + ' pass / ' +
      String(report.summary?.failed_checks ?? 0) + ' fail'],
    ['Source rows', report.summary?.source_rows ?? 'n/a'],
    ['Complete rows', report.summary?.complete_rows ?? 'n/a'],
    ['Plotted points', report.summary?.plotted_points ?? 'n/a'],
    ['Series', report.summary?.series ?? 'n/a'],
    ['Unit conversions', report.summary?.converted_axes ?? 'n/a'],
    ['Sampling', report.summary?.sampled ? 'evenly sampled' : 'all points']
  ]) metricGrid.append(metric(label, value));

  const checks = create('div', 'gate-list figure-semantic-checks');
  for (const item of report.checks ?? []) {
    const row = create('div', 'gate-row');
    const copy = create('div');
    copy.append(
      create('strong', '', String(item.name).replaceAll('_', ' ')),
      item.detail ? create('small', '', item.detail) : document.createTextNode('')
    );
    row.append(copy, statusPill(item.status));
    checks.append(row);
  }
  const provenance = create('details', 'figure-comparison-provenance');
  provenance.append(
    create('summary', '', 'Frozen contract, source profile, and replay hashes'),
    create('pre', 'json-preview', JSON.stringify({
      figure_registration_id: manifest.figure_registration_id,
      figure: manifest.figure,
      source: manifest.source,
      sidecar: manifest.sidecar,
      contract: report.contract,
      contract_sha256: report.contract_sha256,
      replay_sha256: report.expected?.replay_sha256,
      replay: report.expected?.replay,
      mismatches: report.mismatches
    }, null, 2))
  );
  container.replaceChildren(
    resultHeader,
    metricGrid,
    checks,
    create('p', 'studio-note', report.interpretation + ' ' + report.limitations),
    provenance
  );
  container.hidden = false;
}

function renderFigureComparisonResult(container, comparison) {
  const manifest = comparison.manifest;
  const report = comparison.report;
  const artifacts = comparison.artifacts ?? {};
  const compatible = Boolean(report.dimensions?.compatible);
  const metrics = report.metrics;
  const baselineDimensions = report.dimensions?.baseline ?? {};
  const resultHeader = create('header', 'figure-comparison-result-head');
  const heading = create('div');
  heading.append(
    create('span', 'section-kicker', 'IMMUTABLE COMPARISON'),
    create('h4', '', manifest.name ?? manifest.figure_comparison_id),
    create('p', '',
      String(report.reproduction_status).replaceAll('_', ' ') + ' / ' +
      (comparison.verification?.ok ? 'integrity verified' : 'integrity attention'))
  );
  resultHeader.append(heading, statusPill(comparison.verification?.ok
    ? report.status : 'attention'));

  const metricGrid = create('div', 'figure-comparison-metrics');
  const changedFraction = metrics?.tolerance_exceeding_fraction;
  const structuralSimilarity =
    metrics?.structural_similarity?.mean_structural_similarity;
  const minimumStructuralSimilarity =
    report.settings?.minimum_structural_similarity;
  for (const [label, value] of [
    ['Outcome', String(report.reproduction_status).replaceAll('_', ' ')],
    ['Changed pixels', metrics
      ? metrics.tolerance_exceeding_pixels + ' / ' + metrics.pixel_count : 'n/a'],
    ['Changed fraction', Number.isFinite(changedFraction)
      ? (changedFraction * 100).toFixed(6) + '%' : 'n/a'],
    ['RGBA MAE', Number.isFinite(metrics?.mean_absolute_error_rgba)
      ? formatPlotNumber(metrics.mean_absolute_error_rgba) : 'n/a'],
    ['RGBA RMSE', Number.isFinite(metrics?.root_mean_square_error_rgba)
      ? formatPlotNumber(metrics.root_mean_square_error_rgba) : 'n/a'],
    ['Maximum delta', Number.isFinite(metrics?.maximum_channel_delta)
      ? metrics.maximum_channel_delta : 'n/a'],
    ['Block luminance SSIM', Number.isFinite(structuralSimilarity)
      ? structuralSimilarity.toFixed(8) : 'n/a'],
    ['SSIM rule', Number.isFinite(minimumStructuralSimilarity)
      ? (report.summary?.structural_similarity_rule_pass ? 'pass' : 'fail') +
        ' / min ' + minimumStructuralSimilarity
      : Number.isFinite(structuralSimilarity) ? 'diagnostic only' : 'n/a']
  ]) metricGrid.append(metric(label, value));

  const toolbar = create('div', 'figure-comparison-view-toolbar');
  const modeGroup = create('div', 'figure-comparison-modes');
  const modeButtons = new Map();
  for (const [mode, label] of [
    ['baseline', 'Baseline'],
    ['blend', 'Blend'],
    ['candidate', 'Candidate'],
    ['difference', 'Difference']
  ]) {
    const button = create('button', 'secondary-button', label);
    button.type = 'button';
    button.dataset.mode = mode;
    button.disabled = mode === 'difference' && !artifacts['pixel-difference.png'];
    modeButtons.set(mode, button);
    modeGroup.append(button);
  }
  const blendLabel = create('label', 'figure-comparison-range');
  const blendInput = create('input');
  blendInput.type = 'range';
  blendInput.min = '0';
  blendInput.max = '100';
  blendInput.step = '1';
  blendInput.value = '50';
  blendInput.setAttribute('aria-label', 'Candidate blend percentage');
  const blendValue = create('output', '', '50%');
  blendLabel.append(create('span', '', 'CANDIDATE BLEND'), blendInput, blendValue);
  const gainLabel = create('label', 'figure-comparison-range');
  const gainInput = create('input');
  gainInput.type = 'range';
  gainInput.min = '1';
  gainInput.max = '12';
  gainInput.step = '0.5';
  gainInput.value = '4';
  gainInput.setAttribute('aria-label', 'Difference display gain');
  const gainValue = create('output', '', '4x');
  gainLabel.append(create('span', '', 'DIFFERENCE GAIN'), gainInput, gainValue);
  toolbar.append(modeGroup, blendLabel, gainLabel);

  const viewer = create('div', 'figure-comparison-viewer');
  viewer.tabIndex = 0;
  viewer.setAttribute('aria-label', compatible
    ? 'Figure comparison. Drag to select a pixel region.'
    : 'Figure comparison with incompatible dimensions; region selection is disabled.');
  const baselineImage = create('img', 'comparison-layer baseline');
  baselineImage.src = artifacts['baseline.png']?.url ?? '';
  baselineImage.alt = 'Recorded baseline';
  const candidateImage = create('img', 'comparison-layer candidate');
  candidateImage.src = artifacts['candidate.png']?.url ?? '';
  candidateImage.alt = 'Recorded rerun candidate';
  const differenceImage = create('img', 'comparison-layer difference');
  if (artifacts['pixel-difference.png']?.url) {
    differenceImage.src = artifacts['pixel-difference.png'].url;
  }
  differenceImage.alt = 'Absolute pixel difference';
  const selection = create('div', 'comparison-region');
  selection.hidden = true;
  const overlay = create('div', 'viewer-overlay');
  overlay.append(
    create('span', '', compatible ? 'DRAG REGION' : 'DIMENSIONS DIFFER'),
    create('span', '', 'B BASELINE'),
    create('span', '', 'C CANDIDATE'),
    create('span', '', 'D DIFFERENCE')
  );
  viewer.append(baselineImage, candidateImage, differenceImage, selection, overlay);

  const readout = create('div', 'selection-readout', compatible
    ? 'No pixel region selected / blend view'
    : 'Region selection unavailable because image dimensions differ');
  const inspection = create('div', 'figure-comparison-inspection');
  const note = create('textarea');
  note.rows = 2;
  note.maxLength = 600;
  note.placeholder = 'Optional direction about the selected region or observed difference...';
  note.setAttribute('aria-label', 'Figure comparison inspection note');
  const clear = create('button', 'secondary-button', 'Clear region');
  clear.type = 'button';
  clear.disabled = true;
  const share = create('button', 'share-button', 'Save inspected view for AI');
  share.type = 'button';
  inspection.append(note, clear, share);

  const provenance = create('details', 'figure-comparison-provenance');
  const provenanceSummary = create('summary', '', 'Source hashes and frozen comparator');
  provenance.append(provenanceSummary, create('pre', 'json-preview', JSON.stringify({
    figure_comparison_id: manifest.figure_comparison_id,
    baseline: manifest.baseline,
    candidate: manifest.candidate,
    settings: report.settings,
    changed_bounding_box: metrics?.changed_bounding_box ?? null,
    channel_deltas: metrics?.channels ?? null,
    structural_similarity: metrics?.structural_similarity ?? null,
    report_sha256: comparison.verification?.report_sha256 ?? null
  }, null, 2)));
  container.replaceChildren(resultHeader, metricGrid, toolbar, viewer, readout,
    inspection, provenance);
  container.hidden = false;

  let mode = compatible ? 'blend' : 'baseline';
  let selectedRegion = null;
  let dragStart = null;

  function applyMode() {
    const blend = Number(blendInput.value) / 100;
    const gain = Number(gainInput.value);
    baselineImage.style.opacity = mode === 'baseline' || mode === 'blend' ? '1' : '0';
    candidateImage.style.opacity = mode === 'candidate' ? '1' :
      mode === 'blend' ? String(blend) : '0';
    differenceImage.style.opacity = mode === 'difference' ? '1' : '0';
    differenceImage.style.filter = 'brightness(' + gain + ')';
    blendInput.disabled = mode !== 'blend';
    gainInput.disabled = mode !== 'difference';
    for (const [buttonMode, button] of modeButtons) {
      const active = buttonMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    blendValue.value = blendInput.value + '%';
    gainValue.value = gainInput.value + 'x';
    readout.textContent = selectedRegion
      ? 'Pixel region x=' + selectedRegion.x + ', y=' + selectedRegion.y +
        ', width=' + selectedRegion.width + ', height=' + selectedRegion.height +
        ' / ' + mode + ' view'
      : compatible ? 'No pixel region selected / ' + mode + ' view'
        : 'Region selection unavailable / ' + mode + ' view';
  }

  function imageBox() {
    const bounds = viewer.getBoundingClientRect();
    const width = Number(baselineDimensions.width);
    const height = Number(baselineDimensions.height);
    if (!width || !height || !bounds.width || !bounds.height) return null;
    const scale = Math.min(bounds.width / width, bounds.height / height);
    const renderedWidth = width * scale;
    const renderedHeight = height * scale;
    return {
      left: (bounds.width - renderedWidth) / 2,
      top: (bounds.height - renderedHeight) / 2,
      width: renderedWidth,
      height: renderedHeight,
      sourceWidth: width,
      sourceHeight: height,
      bounds
    };
  }

  function eventPixel(event) {
    const box = imageBox();
    if (!box) return null;
    const localX = Math.max(0, Math.min(box.width - 0.0001,
      event.clientX - box.bounds.left - box.left));
    const localY = Math.max(0, Math.min(box.height - 0.0001,
      event.clientY - box.bounds.top - box.top));
    return {
      x: Math.floor(localX / box.width * box.sourceWidth),
      y: Math.floor(localY / box.height * box.sourceHeight)
    };
  }

  function regionFromPoints(first, last) {
    const x = Math.min(first.x, last.x);
    const y = Math.min(first.y, last.y);
    return {
      x,
      y,
      width: Math.abs(first.x - last.x) + 1,
      height: Math.abs(first.y - last.y) + 1
    };
  }

  function drawRegion() {
    if (!selectedRegion) {
      selection.hidden = true;
      clear.disabled = true;
      applyMode();
      return;
    }
    const box = imageBox();
    if (!box) return;
    selection.hidden = false;
    selection.style.left = box.left + selectedRegion.x /
      box.sourceWidth * box.width + 'px';
    selection.style.top = box.top + selectedRegion.y /
      box.sourceHeight * box.height + 'px';
    selection.style.width = selectedRegion.width /
      box.sourceWidth * box.width + 'px';
    selection.style.height = selectedRegion.height /
      box.sourceHeight * box.height + 'px';
    clear.disabled = false;
    applyMode();
  }

  for (const [buttonMode, button] of modeButtons) {
    button.addEventListener('click', () => {
      mode = buttonMode;
      applyMode();
    });
  }
  blendInput.addEventListener('input', applyMode);
  gainInput.addEventListener('input', applyMode);
  clear.addEventListener('click', () => {
    selectedRegion = null;
    drawRegion();
  });
  viewer.addEventListener('pointerdown', (event) => {
    if (!compatible) return;
    dragStart = eventPixel(event);
    if (!dragStart) return;
    selectedRegion = regionFromPoints(dragStart, dragStart);
    viewer.setPointerCapture(event.pointerId);
    drawRegion();
  });
  viewer.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    const point = eventPixel(event);
    if (!point) return;
    selectedRegion = regionFromPoints(dragStart, point);
    drawRegion();
  });
  viewer.addEventListener('pointerup', (event) => {
    if (dragStart) {
      const point = eventPixel(event);
      if (point) selectedRegion = regionFromPoints(dragStart, point);
    }
    dragStart = null;
    if (viewer.hasPointerCapture(event.pointerId)) viewer.releasePointerCapture(event.pointerId);
    drawRegion();
  });
  viewer.addEventListener('pointercancel', () => { dragStart = null; });
  viewer.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'b') mode = 'baseline';
    else if (key === 'c') mode = 'candidate';
    else if (key === 'd' && artifacts['pixel-difference.png']) mode = 'difference';
    else if (key === 'm') mode = 'blend';
    else if (key === 'escape') selectedRegion = null;
    else return;
    event.preventDefault();
    drawRegion();
  });
  share.addEventListener('click', async () => {
    const interaction = await saveInteraction('figure', 'comparison.inspected', {
      kind: 'figure-comparison',
      record_id: manifest.figure_comparison_id,
      name: manifest.name ?? manifest.figure_comparison_id,
      url: '/api/figure-comparisons/' +
        encodeURIComponent(manifest.figure_comparison_id)
    }, {
      figure_comparison_id: manifest.figure_comparison_id,
      status: report.status,
      reproduction_status: report.reproduction_status,
      baseline_url: manifest.baseline?.url ?? null,
      baseline_sha256: manifest.baseline?.sha256 ?? null,
      candidate_url: manifest.candidate?.url ?? null,
      candidate_sha256: manifest.candidate?.sha256 ?? null,
      settings: report.settings,
      dimensions: report.dimensions,
      metrics: report.metrics,
      selected_region: selectedRegion,
      view_mode: mode,
      blend: Number(blendInput.value) / 100,
      difference_gain: Number(gainInput.value),
      note: note.value.trim() || null,
      interpretation: 'mechanical pixel and optional structural-similarity check only; inspect source data, code, environment, labels, and scientific meaning separately'
    });
    if (interaction) {
      readout.textContent = 'Inspected view saved / ' + interaction.interaction_id;
      readout.classList.add('saved');
    }
  });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!viewer.isConnected) return observer.disconnect();
      drawRegion();
    });
    observer.observe(viewer);
  }
  applyMode();
}

function appendFigureComparisonStudio(container, artifact) {
  const section = create('section', 'figure-comparison-studio');
  const header = create('header', 'figure-comparison-head');
  const heading = create('div');
  heading.append(
    create('span', 'section-kicker', 'REPRODUCIBILITY CHECK'),
    create('h3', '', 'Baseline versus rerun'),
    create('p', '',
      'Create an immutable decoded-pixel and optional structural-similarity comparison, inspect the overlay or absolute difference, then share the selected region with the AI.')
  );
  const integrity = create('span', 'source-badge', 'PNG / RGBA + SSIM');
  header.append(heading, integrity);

  const controls = create('div', 'figure-comparison-controls');
  const candidateLabel = create('label', 'figure-comparison-field wide');
  const candidate = create('select');
  candidate.setAttribute('aria-label', 'Rerun candidate PNG');
  candidateLabel.append(create('span', '', 'RERUN CANDIDATE'), candidate);
  const toleranceLabel = create('label', 'figure-comparison-field');
  const tolerance = create('input');
  tolerance.type = 'number';
  tolerance.min = '0';
  tolerance.max = '255';
  tolerance.step = '1';
  tolerance.value = '0';
  tolerance.setAttribute('aria-label', 'RGBA channel tolerance');
  toleranceLabel.append(create('span', '', 'RGBA TOLERANCE'), tolerance);
  const fractionLabel = create('label', 'figure-comparison-field');
  const fraction = create('input');
  fraction.type = 'number';
  fraction.min = '0';
  fraction.max = '1';
  fraction.step = '0.0001';
  fraction.value = '0';
  fraction.setAttribute('aria-label', 'Maximum changed pixel fraction');
  fractionLabel.append(create('span', '', 'MAX CHANGED FRACTION'), fraction);
  const structuralLabel = create('label', 'figure-comparison-field');
  const structural = create('input');
  structural.type = 'number';
  structural.min = '0';
  structural.max = '1';
  structural.step = '0.0001';
  structural.placeholder = 'optional';
  structural.setAttribute('aria-label', 'Minimum block luminance structural similarity');
  structuralLabel.append(create('span', '', 'MIN BLOCK SSIM'), structural);
  const nameLabel = create('label', 'figure-comparison-field wide');
  const name = create('input');
  name.type = 'text';
  name.maxLength = 240;
  name.value = artifact.name + ' rerun comparison';
  name.setAttribute('aria-label', 'Figure comparison name');
  nameLabel.append(create('span', '', 'COMPARISON NAME'), name);
  const noteLabel = create('label', 'figure-comparison-field full');
  const note = create('textarea');
  note.rows = 2;
  note.maxLength = 2000;
  note.placeholder = 'Optional rerun context, expected differences, or interpretation...';
  note.setAttribute('aria-label', 'Figure comparison note');
  noteLabel.append(create('span', '', 'RESEARCH NOTE'), note);
  const compare = create('button', 'primary-button figure-compare-button', 'Compare rerun');
  compare.type = 'button';
  controls.append(candidateLabel, toleranceLabel, fractionLabel, structuralLabel, nameLabel,
    noteLabel, compare);

  const historyBar = create('div', 'figure-comparison-history');
  const historyLabel = create('label');
  const history = create('select');
  history.setAttribute('aria-label', 'Recorded figure comparison history');
  historyLabel.append(create('span', '', 'RECORDED COMPARISONS'), history);
  const load = create('button', 'quiet-button', 'Open record');
  load.type = 'button';
  historyBar.append(historyLabel, load);
  const result = create('div', 'figure-comparison-result');
  result.hidden = true;
  section.append(header, controls, historyBar, result,
    create('p', 'studio-note',
      'The comparator decodes bounded, non-interlaced 8-bit PNGs to RGBA. Optional block-luminance SSIM is computed in linear light over a white matte. Neither rule proves the data, code, labels, environment, or scientific conclusion are valid.'));
  container.append(section);

  if (extensionOf(artifact.name) !== 'png') {
    candidate.append(create('option', '', 'Pixel comparison requires a PNG source'));
    for (const input of [candidate, tolerance, fraction, structural, name, note, compare]) {
      input.disabled = true;
    }
    historyBar.hidden = true;
    return;
  }

  let candidates = [];
  let busy = false;

  function populateCandidates() {
    candidates = recordedPngSources().filter((source) =>
      source.artifact.url !== artifact.url
    );
    candidate.replaceChildren();
    const prompt = create('option', '', candidates.length
      ? 'Choose a verified PNG rerun...'
      : 'No other verified PNG is available');
    prompt.value = '';
    candidate.append(prompt);
    candidates.forEach((source, index) => {
      const option = create('option', '', source.label);
      option.value = String(index);
      candidate.append(option);
    });
    compare.disabled = !candidates.length || busy;
  }

  function populateHistory(selectedId = '') {
    const comparisons = figureComparisonsForArtifact(artifact);
    history.replaceChildren();
    const prompt = create('option', '', comparisons.length
      ? 'Choose a comparison record...'
      : 'No comparison recorded for this figure');
    prompt.value = '';
    history.append(prompt);
    for (const comparison of comparisons) {
      const option = create('option', '',
        String(comparison.reproduction_status).replaceAll('_', ' ') +
        ' / ' + (comparison.name ?? comparison.figure_comparison_id));
      option.value = comparison.figure_comparison_id;
      history.append(option);
    }
    if (selectedId && comparisons.some((comparison) =>
      comparison.figure_comparison_id === selectedId)) history.value = selectedId;
    load.disabled = !history.value;
    historyBar.classList.toggle('empty', !comparisons.length);
    return comparisons;
  }

  async function openComparison(comparisonId) {
    if (!comparisonId) return;
    load.disabled = true;
    result.hidden = false;
    result.replaceChildren(create('div', 'studio-loading',
      'Verifying and loading comparison record...'));
    try {
      const { payload } = await fetchJson('/api/figure-comparisons/' +
        encodeURIComponent(comparisonId));
      renderFigureComparisonResult(result, payload);
    } catch (error) {
      result.replaceChildren(create('div', 'studio-error', error.message));
    } finally {
      load.disabled = !history.value;
    }
  }

  history.addEventListener('change', () => {
    load.disabled = !history.value;
    if (history.value) void openComparison(history.value);
  });
  load.addEventListener('click', () => void openComparison(history.value));
  compare.addEventListener('click', async () => {
    const selected = candidate.value === ''
      ? null
      : candidates[Number(candidate.value)];
    if (!selected) {
      showNotice('Choose a verified PNG rerun to compare.');
      candidate.focus();
      return;
    }
    busy = true;
    compare.disabled = true;
    compare.textContent = 'Comparing figure...';
    try {
      const { payload } = await fetchJson('/api/figure-comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: selectedChat ?? undefined,
          baseline: immutableArtifactSelector(artifact),
          candidate: selected.selector,
          name: name.value.trim() || undefined,
          note: note.value.trim() || undefined,
          pixel_tolerance: tolerance.value,
          maximum_changed_fraction: fraction.value,
          minimum_structural_similarity:
            structural.value === '' ? undefined : structural.value
        })
      });
      await loadState(false, true);
      if (selectedChat) {
        try {
          const { payload: harness } = await fetchJson('/api/chats/' +
            encodeURIComponent(selectedChat) + '/harness');
          activeHarness = harness;
          renderHarness(activeHarness);
        } catch {
          // The comparison is immutable; the next refresh can rebuild the board.
        }
      }
      populateCandidates();
      populateHistory(payload.comparison.figure_comparison_id);
      renderFigureComparisonResult(result, payload.comparison);
      result.hidden = false;
      showNotice(payload.interaction_error
        ? 'Comparison recorded; the AI interaction needs attention.'
        : selectedChat
          ? 'Comparison recorded and shared with the AI.'
          : 'Comparison recorded. Select a conversation to share an inspected region.');
    } catch (error) {
      showNotice(error.message);
    } finally {
      busy = false;
      compare.textContent = 'Compare rerun';
      compare.disabled = !candidates.length;
    }
  });

  populateCandidates();
  const comparisons = populateHistory();
  if (comparisons[0]) {
    history.value = comparisons[0].figure_comparison_id;
    load.disabled = false;
    void openComparison(history.value);
  }
}

function appendFigureRegistrationStudio(container, artifact) {
  const section = create('section', 'figure-comparison-studio figure-semantic-studio');
  const header = create('header', 'figure-comparison-head');
  const heading = create('div');
  heading.append(
    create('span', 'section-kicker', 'REGISTERED SEMANTICS'),
    create('h3', '', 'Source-to-figure contract'),
    create('p', '',
      'Bind this exact PNG to a producer-emitted semantic sidecar and immutable CSV/TSV source, then independently replay columns, units, scales, row policy, and plotted-data hashes.')
  );
  header.append(heading, create('span', 'source-badge', 'SIDECAR / DATA REPLAY'));

  const controls = create('div', 'figure-comparison-controls');
  const sourceLabel = create('label', 'figure-comparison-field full');
  const source = create('input');
  source.type = 'text';
  source.maxLength = 600;
  source.placeholder = '/experiment-artifact/…/summary.csv';
  source.setAttribute('aria-label', 'Immutable CSV or TSV source URL');
  sourceLabel.append(create('span', '', 'IMMUTABLE DATA URL'), source);
  const sidecarLabel = create('label', 'figure-comparison-field full');
  const sidecar = create('input');
  sidecar.type = 'text';
  sidecar.maxLength = 600;
  sidecar.placeholder = '/artifact/…/figure.semantic.json';
  sidecar.setAttribute('aria-label', 'Immutable semantic sidecar URL');
  sidecarLabel.append(create('span', '', 'PRODUCER SIDECAR URL'), sidecar);
  const nameLabel = create('label', 'figure-comparison-field full');
  const name = create('input');
  name.type = 'text';
  name.maxLength = 240;
  name.value = artifact.name + ' semantic registration';
  name.setAttribute('aria-label', 'Figure semantic registration name');
  nameLabel.append(create('span', '', 'REGISTRATION NAME'), name);
  const contractLabel = create('label', 'figure-comparison-field full');
  const contractInput = create('textarea');
  contractInput.rows = 18;
  contractInput.setAttribute('aria-label', 'Expected figure semantic contract JSON');
  contractInput.value = JSON.stringify({
    chart_type: 'line_scatter',
    title: artifact.name,
    x_axis: {
      column: 'x',
      label: 'X',
      source_unit: { symbol: '1' },
      display_unit: { symbol: '1' },
      scale: 'linear'
    },
    y_axis: {
      label: 'Y',
      display_unit: { symbol: '1' },
      scale: 'linear'
    },
    series: [{
      id: 'series_1',
      column: 'y',
      label: 'Series 1',
      source_unit: { symbol: '1' }
    }],
    missing_value_policy: 'error',
    row_order: 'source',
    duplicate_x_policy: 'error',
    sampling: { method: 'all' },
    aggregation: 'none'
  }, null, 2);
  contractLabel.append(create('span', '', 'EXPECTED CONTRACT JSON'), contractInput);
  const noteLabel = create('label', 'figure-comparison-field full');
  const note = create('textarea');
  note.rows = 2;
  note.maxLength = 2000;
  note.placeholder = 'Optional interpretation or expected binding context…';
  note.setAttribute('aria-label', 'Figure semantic registration note');
  noteLabel.append(create('span', '', 'RESEARCH NOTE'), note);
  const register = create('button', 'primary-button figure-compare-button',
    'Register semantics');
  register.type = 'button';
  controls.append(sourceLabel, sidecarLabel, nameLabel, contractLabel, noteLabel,
    register);

  const historyBar = create('div', 'figure-comparison-history');
  const historyLabel = create('label');
  const history = create('select');
  history.setAttribute('aria-label', 'Recorded semantic figure registrations');
  historyLabel.append(create('span', '', 'RECORDED REGISTRATIONS'), history);
  const load = create('button', 'quiet-button', 'Open record');
  load.type = 'button';
  historyBar.append(historyLabel, load);
  const result = create('div', 'figure-comparison-result');
  result.hidden = true;
  section.append(
    header,
    controls,
    historyBar,
    result,
    create('p', 'studio-note',
      'Generate the sidecar before archival with “sciencecode figure semantic sidecar”. Registration verifies that declaration against immutable artifacts; it cannot prove that pixels visually encode the declaration.')
  );
  container.append(section);

  if (extensionOf(artifact.name) !== 'png') {
    for (const input of [source, sidecar, name, contractInput, note, register]) {
      input.disabled = true;
    }
    historyBar.hidden = true;
    return;
  }

  let busy = false;
  function populateHistory(selectedId = '') {
    const registrations = figureRegistrationsForArtifact(artifact);
    history.replaceChildren();
    const prompt = create('option', '', registrations.length
      ? 'Choose a semantic registration…'
      : 'No semantic registration recorded for this figure');
    prompt.value = '';
    history.append(prompt);
    for (const registration of registrations) {
      const option = create('option', '',
        String(registration.registration_status).replaceAll('_', ' ') + ' / ' +
        (registration.name ?? registration.figure_registration_id));
      option.value = registration.figure_registration_id;
      history.append(option);
    }
    if (selectedId && registrations.some((registration) =>
      registration.figure_registration_id === selectedId)) history.value = selectedId;
    load.disabled = !history.value;
    historyBar.classList.toggle('empty', !registrations.length);
    return registrations;
  }

  async function openRegistration(registrationId) {
    if (!registrationId) return;
    load.disabled = true;
    result.hidden = false;
    result.replaceChildren(create('div', 'studio-loading',
      'Verifying and loading semantic registration…'));
    try {
      const { payload } = await fetchJson('/api/figure-registrations/' +
        encodeURIComponent(registrationId));
      renderFigureRegistrationResult(result, payload);
    } catch (error) {
      result.replaceChildren(create('div', 'studio-error', error.message));
    } finally {
      load.disabled = !history.value;
    }
  }

  history.addEventListener('change', () => {
    load.disabled = !history.value;
    if (history.value) void openRegistration(history.value);
  });
  load.addEventListener('click', () => void openRegistration(history.value));
  register.addEventListener('click', async () => {
    if (!source.value.trim() || !sidecar.value.trim()) {
      showNotice('Provide immutable source and sidecar URLs.');
      (!source.value.trim() ? source : sidecar).focus();
      return;
    }
    let semanticContract;
    try {
      semanticContract = JSON.parse(contractInput.value);
    } catch (error) {
      showNotice('Contract JSON is invalid: ' + error.message);
      contractInput.focus();
      return;
    }
    busy = true;
    register.disabled = true;
    register.textContent = 'Replaying semantics…';
    try {
      const { payload } = await fetchJson('/api/figure-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_version: 1,
          chat_id: selectedChat ?? undefined,
          name: name.value.trim() || undefined,
          note: note.value.trim() || undefined,
          figure: immutableArtifactSelector(artifact),
          source: immutableSelectorFromText(source.value),
          sidecar: immutableSelectorFromText(sidecar.value),
          contract: semanticContract
        })
      });
      await loadState(false, true);
      if (selectedChat) {
        try {
          const { payload: harness } = await fetchJson('/api/chats/' +
            encodeURIComponent(selectedChat) + '/harness');
          activeHarness = harness;
          renderHarness(activeHarness);
        } catch {
          // The immutable registration remains available on the next refresh.
        }
      }
      populateHistory(payload.registration.figure_registration_id);
      renderFigureRegistrationResult(result, payload.registration);
      result.hidden = false;
      showNotice(payload.interaction_error
        ? 'Semantic registration recorded; the AI interaction needs attention.'
        : selectedChat
          ? 'Semantic registration recorded and shared with the AI.'
          : 'Semantic registration recorded.');
    } catch (error) {
      showNotice(error.message);
    } finally {
      busy = false;
      register.disabled = false;
      register.textContent = 'Register semantics';
    }
  });

  const registrations = populateHistory();
  if (registrations[0]) {
    history.value = registrations[0].figure_registration_id;
    load.disabled = false;
    void openRegistration(history.value);
  }
}

function appendFigureVisualStudio(container, artifact) {
  const section = create('section',
    'figure-comparison-studio figure-visual-studio');
  const header = create('header', 'figure-comparison-head');
  const heading = create('div');
  heading.append(
    create('span', 'section-kicker', 'DECODED-PIXEL VALIDATION'),
    create('h3', '', 'Marks and axes against the data'),
    create('p', '',
      'Start from a matched semantic registration, declare the actual plot rectangle, domains, flat colors, and stroke sizes, then check the decoded PNG pixels against projected data points.')
  );
  header.append(heading, create('span', 'source-badge', 'PIXELS / DATA PROJECTION'));

  const controls = create('div', 'figure-comparison-controls');
  const registrationLabel = create('label', 'figure-comparison-field full');
  const registration = create('select');
  registration.setAttribute('aria-label', 'Matched semantic figure registration');
  registrationLabel.append(create('span', '', 'MATCHED SEMANTIC REGISTRATION'),
    registration);
  const nameLabel = create('label', 'figure-comparison-field full');
  const name = create('input');
  name.type = 'text';
  name.maxLength = 240;
  name.value = artifact.name + ' pixel validation';
  name.setAttribute('aria-label', 'Figure visual validation name');
  nameLabel.append(create('span', '', 'VALIDATION NAME'), name);
  const profileLabel = create('label', 'figure-comparison-field full');
  const profile = create('textarea');
  profile.rows = 22;
  profile.spellcheck = false;
  profile.setAttribute('aria-label', 'Figure visual validation profile JSON');
  profileLabel.append(create('span', '', 'VISUAL PROFILE JSON'), profile);
  const profileActions = create('div', 'analysis-actions full');
  const resetProfile = create('button', 'quiet-button',
    'Reset from semantic ranges');
  resetProfile.type = 'button';
  profileActions.append(resetProfile);
  const noteLabel = create('label', 'figure-comparison-field full');
  const note = create('textarea');
  note.rows = 2;
  note.maxLength = 2000;
  note.placeholder = 'Optional rendering context or interpretation…';
  note.setAttribute('aria-label', 'Figure visual validation note');
  noteLabel.append(create('span', '', 'RESEARCH NOTE'), note);
  const validate = create('button', 'primary-button figure-compare-button',
    'Validate drawn pixels');
  validate.type = 'button';
  const actionState = create('p', 'analysis-action-state full',
    'Choose a matched semantic registration, then align the suggested profile with the renderer.');
  actionState.setAttribute('role', 'status');
  actionState.setAttribute('aria-live', 'polite');
  controls.append(
    registrationLabel,
    nameLabel,
    profileLabel,
    profileActions,
    noteLabel,
    validate,
    actionState
  );

  const historyBar = create('div', 'figure-comparison-history');
  const historyLabel = create('label');
  const history = create('select');
  history.setAttribute('aria-label', 'Recorded figure visual validations');
  historyLabel.append(create('span', '', 'RECORDED PIXEL VALIDATIONS'), history);
  const load = create('button', 'quiet-button', 'Open record');
  load.type = 'button';
  historyBar.append(historyLabel, load);
  const result = create('div', 'figure-comparison-result');
  result.hidden = true;
  result.setAttribute('aria-live', 'polite');
  section.append(
    header,
    controls,
    historyBar,
    result,
    create('p', 'studio-note',
      'The suggested ranges include a small margin, but plot bounds and colors are renderer-specific and must be checked before recording. This constrained validator does not OCR titles, tick labels, legends, or annotations; it does not support error bars or certify scientific meaning.')
  );
  container.append(section);

  if (extensionOf(artifact.name) !== 'png') {
    for (const input of [registration, name, profile, resetProfile, note, validate]) {
      input.disabled = true;
    }
    historyBar.hidden = true;
    return;
  }

  let busy = false;
  let selectedRegistrationDetail = null;

  function matchedRegistrations() {
    return figureRegistrationsForArtifact(artifact).filter((item) =>
      item.verified && item.status === 'pass' &&
      item.registration_status === 'matched'
    );
  }

  function populateRegistrations(selectedId = '') {
    const registrations = matchedRegistrations();
    registration.replaceChildren();
    const prompt = create('option', '', registrations.length
      ? 'Choose a matched registration…'
      : 'Record a matched semantic registration first');
    prompt.value = '';
    registration.append(prompt);
    for (const item of registrations) {
      const option = create('option', '',
        (item.name ?? item.figure_registration_id) + ' / ' +
        String(item.summary?.plotted_points ?? 0) + ' points');
      option.value = item.figure_registration_id;
      registration.append(option);
    }
    if (selectedId && registrations.some((item) =>
      item.figure_registration_id === selectedId)) registration.value = selectedId;
    registration.disabled = !registrations.length;
    resetProfile.disabled = !registration.value;
    validate.disabled = !registration.value || busy;
    return registrations;
  }

  function populateHistory(selectedId = '') {
    const visuals = figureVisualsForArtifact(artifact);
    history.replaceChildren();
    const prompt = create('option', '', visuals.length
      ? 'Choose a pixel validation…'
      : 'No pixel validation recorded for this figure');
    prompt.value = '';
    history.append(prompt);
    for (const visual of visuals) {
      const option = create('option', '',
        String(visual.visual_status).replaceAll('_', ' ') + ' / ' +
        (visual.name ?? visual.figure_visual_id));
      option.value = visual.figure_visual_id;
      history.append(option);
    }
    if (selectedId && visuals.some((visual) =>
      visual.figure_visual_id === selectedId)) history.value = selectedId;
    load.disabled = !history.value;
    historyBar.classList.toggle('empty', !visuals.length);
    return visuals;
  }

  async function loadRegistrationProfile(registrationId) {
    if (!registrationId) {
      selectedRegistrationDetail = null;
      profile.value = '';
      resetProfile.disabled = true;
      validate.disabled = true;
      actionState.textContent =
        'Choose a matched semantic registration before declaring pixel rules.';
      return;
    }
    resetProfile.disabled = true;
    validate.disabled = true;
    actionState.textContent = 'Loading verified semantic ranges and series…';
    try {
      const { payload } = await fetchJson('/api/figure-registrations/' +
        encodeURIComponent(registrationId));
      if (!payload.verification?.ok || payload.report?.status !== 'pass' ||
          payload.report?.registration_status !== 'matched') {
        throw new Error('The selected semantic registration is not matched and verified.');
      }
      selectedRegistrationDetail = payload;
      profile.value = JSON.stringify(suggestedFigureVisualProfile(payload), null, 2);
      actionState.textContent =
        'Suggested from converted data ranges · confirm the renderer’s plot bounds and exact flat colors';
    } catch (error) {
      selectedRegistrationDetail = null;
      profile.value = '';
      actionState.textContent = 'Profile unavailable · ' + error.message;
      showNotice(error.message);
    } finally {
      resetProfile.disabled = !selectedRegistrationDetail;
      validate.disabled = !selectedRegistrationDetail || busy;
    }
  }

  async function openVisual(visualId) {
    if (!visualId) return;
    load.disabled = true;
    result.hidden = false;
    result.replaceChildren(create('div', 'studio-loading',
      'Replaying decoded-pixel validation…'));
    try {
      const { payload } = await fetchJson('/api/figure-visuals/' +
        encodeURIComponent(visualId));
      renderFigureVisualResult(result, payload);
    } catch (error) {
      result.replaceChildren(create('div', 'studio-error', error.message));
    } finally {
      load.disabled = !history.value;
    }
  }

  registration.addEventListener('change', () => {
    void loadRegistrationProfile(registration.value);
  });
  resetProfile.addEventListener('click', () => {
    if (selectedRegistrationDetail) {
      profile.value = JSON.stringify(
        suggestedFigureVisualProfile(selectedRegistrationDetail),
        null,
        2
      );
      actionState.textContent =
        'Suggested profile restored · confirm the renderer’s exact geometry and colors';
    }
  });
  history.addEventListener('change', () => {
    load.disabled = !history.value;
    if (history.value) void openVisual(history.value);
  });
  load.addEventListener('click', () => void openVisual(history.value));
  validate.addEventListener('click', async () => {
    if (!registration.value || !selectedRegistrationDetail) {
      showNotice('Choose and load a matched semantic registration first.');
      registration.focus();
      return;
    }
    let visualProfile;
    try {
      visualProfile = JSON.parse(profile.value);
    } catch (error) {
      showNotice('Visual profile JSON is invalid: ' + error.message);
      profile.focus();
      return;
    }
    busy = true;
    validate.disabled = true;
    registration.disabled = true;
    validate.textContent = 'Decoding and checking pixels…';
    actionState.textContent =
      'Projecting converted data and inspecting bounded PNG pixels…';
    try {
      const { payload } = await fetchJson('/api/figure-visuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_version: 1,
          chat_id: selectedChat ?? undefined,
          name: name.value.trim() || undefined,
          note: note.value.trim() || undefined,
          figure_registration_id: registration.value,
          profile: visualProfile
        })
      });
      await loadState(false, true);
      if (selectedChat) {
        try {
          const { payload: harness } = await fetchJson('/api/chats/' +
            encodeURIComponent(selectedChat) + '/harness');
          activeHarness = harness;
          renderHarness(activeHarness);
        } catch {
          // The immutable visual validation remains available on refresh.
        }
      }
      populateRegistrations(payload.visual.manifest.figure_registration
        .figure_registration_id);
      populateHistory(payload.visual.figure_visual_id);
      renderFigureVisualResult(result, payload.visual);
      result.hidden = false;
      actionState.textContent = 'Recorded · ' +
        String(payload.visual.report.visual_status).replaceAll('_', ' ');
      showNotice(payload.interaction_error
        ? 'Pixel validation recorded; the AI interaction needs attention.'
        : selectedChat
          ? 'Pixel validation recorded and shared with the AI.'
          : 'Pixel validation recorded.');
    } catch (error) {
      actionState.textContent = 'Not recorded · ' + error.message;
      showNotice(error.message);
    } finally {
      busy = false;
      registration.disabled = !matchedRegistrations().length;
      validate.disabled = !selectedRegistrationDetail;
      validate.textContent = 'Validate drawn pixels';
    }
  });

  const registrations = populateRegistrations();
  const visuals = populateHistory();
  if (registrations[0]) {
    registration.value = registrations[0].figure_registration_id;
    void loadRegistrationProfile(registration.value);
  }
  if (visuals[0]) {
    history.value = visuals[0].figure_visual_id;
    load.disabled = false;
    void openVisual(history.value);
  }
}

async function openFigureStudio(container, artifact, blob) {
  const image = await decodeFigure(blob);
  const imageWidth = image.width ?? image.naturalWidth;
  const imageHeight = image.height ?? image.naturalHeight;
  if (!imageWidth || !imageHeight) throw new Error('The figure has no readable dimensions.');

  const toolbar = create('div', 'studio-toolbar');
  const state = create('span', 'studio-state',
    imageWidth + ' × ' + imageHeight + ' pixels · no annotations');
  const reset = create('button', 'secondary-button', 'Reset view');
  reset.type = 'button';
  const shareView = create('button', 'share-button', 'Share view with AI');
  shareView.type = 'button';
  toolbar.append(state, reset, shareView);

  const viewer = create('div', 'figure-viewer');
  const canvas = create('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive figure review for ' + artifact.name +
    '. Drag to pan, use the wheel to zoom, and click to position an annotation.');
  const overlay = create('div', 'viewer-overlay');
  overlay.append(create('span', '', 'DRAG PAN'), create('span', '', 'WHEEL ZOOM'),
    create('span', '', 'CLICK MARK'), create('span', '', 'R RESET'));
  viewer.append(canvas, overlay);

  const readout = create('div', 'selection-readout');
  const editor = create('div', 'annotation-editor');
  const category = create('select');
  category.setAttribute('aria-label', 'Annotation category');
  for (const value of ['observation', 'question', 'revision']) {
    const option = create('option', '', value[0].toUpperCase() + value.slice(1));
    option.value = value;
    category.append(option);
  }
  const xInput = create('input');
  const yInput = create('input');
  for (const [input, label] of [[xInput, 'Horizontal image position percent'], [yInput, 'Vertical image position percent']]) {
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '0.1';
    input.value = '50';
    input.setAttribute('aria-label', label);
  }
  const noteInput = create('textarea');
  noteInput.rows = 2;
  noteInput.maxLength = 1200;
  noteInput.placeholder = 'Describe the observation, question, or requested revision at this point…';
  noteInput.setAttribute('aria-label', 'Figure annotation note');
  const add = create('button', 'secondary-button', 'Add annotation');
  add.type = 'button';
  const shareAnnotations = create('button', 'share-button', 'Share annotations with AI');
  shareAnnotations.type = 'button';
  shareAnnotations.disabled = true;
  const coordinateFields = create('div', 'annotation-coordinates');
  const xLabel = create('label');
  const yLabel = create('label');
  xLabel.append(create('span', '', 'X %'), xInput);
  yLabel.append(create('span', '', 'Y %'), yInput);
  coordinateFields.append(category, xLabel, yLabel, add, shareAnnotations);
  editor.append(coordinateFields, noteInput);
  const annotationList = create('ol', 'annotation-list');
  const guidance = create('p', 'studio-note',
    'Annotations use normalized image coordinates, so they remain attached when the figure is resized. Sharing links the notes and view to this immutable source artifact.');
  container.append(toolbar, viewer, readout, editor, annotationList, guidance);
  appendFigureComparisonStudio(container, artifact);
  appendFigureRegistrationStudio(container, artifact);
  appendFigureVisualStudio(container, artifact);

  const view = { zoom: 1, pan_x: 0, pan_y: 0 };
  let selected = { x: 0.5, y: 0.5 };
  let annotations = [];
  let dirtyAnnotations = false;
  let drag = null;

  function rounded(value) {
    return Number.isFinite(value) ? Number(value.toPrecision(8)) : null;
  }

  function canvasSize() {
    const bounds = canvas.getBoundingClientRect();
    return {
      width: Math.max(320, Math.round(bounds.width || 760)),
      height: Math.max(300, Math.round(bounds.height || 520))
    };
  }

  function imageLayout(width, height) {
    return figureLayout({
      imageWidth,
      imageHeight,
      canvasWidth: width,
      canvasHeight: height,
      view
    });
  }

  function prepareCanvas() {
    const size = canvasSize();
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (canvas.width !== Math.round(size.width * ratio) ||
        canvas.height !== Math.round(size.height * ratio)) {
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, ...size };
  }

  function pointToCanvas(point, layout) {
    return figurePointToCanvas(point, layout);
  }

  function pointFromCanvas(point, layout) {
    return canvasToFigurePoint(point, layout);
  }

  function categoryColor(value) {
    if (value === 'revision') return '#e8b86a';
    if (value === 'question') return '#73a8ff';
    return '#78dba9';
  }

  function drawMarker(context, position, color, label) {
    context.beginPath();
    context.arc(position.x, position.y, 8, 0, Math.PI * 2);
    context.fillStyle = 'rgba(7, 10, 12, 0.78)';
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = color;
    context.font = 'bold 8px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, position.x, position.y + 0.5);
  }

  function draw() {
    if (!canvas.isConnected) return;
    const { context, width, height } = prepareCanvas();
    const layout = imageLayout(width, height);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#07090a';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, layout.left, layout.top, layout.width, layout.height);
    context.strokeStyle = 'rgba(155, 171, 180, 0.35)';
    context.lineWidth = 1;
    context.strokeRect(layout.left, layout.top, layout.width, layout.height);
    annotations.forEach((annotation, index) => {
      drawMarker(context, pointToCanvas(annotation, layout),
        categoryColor(annotation.category), String(index + 1));
    });
    const position = pointToCanvas(selected, layout);
    context.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(position.x - 11, position.y);
    context.lineTo(position.x + 11, position.y);
    context.moveTo(position.x, position.y - 11);
    context.lineTo(position.x, position.y + 11);
    context.stroke();
  }

  function updateReadout() {
    readout.textContent = 'Marker ' + (selected.x * 100).toFixed(1) + '%, ' +
      (selected.y * 100).toFixed(1) + '% · zoom ' + view.zoom.toFixed(2) + '× · ' +
      annotations.length + ' annotation' + (annotations.length === 1 ? '' : 's');
    xInput.value = (selected.x * 100).toFixed(1);
    yInput.value = (selected.y * 100).toFixed(1);
  }

  function renderAnnotations() {
    annotationList.replaceChildren();
    annotations.forEach((annotation, index) => {
      const item = create('li');
      const marker = create('span', 'annotation-marker', String(index + 1));
      marker.style.color = categoryColor(annotation.category);
      const copy = create('div');
      copy.append(create('strong', '', annotation.category + ' · ' +
        (annotation.x * 100).toFixed(1) + '%, ' + (annotation.y * 100).toFixed(1) + '%'),
        create('p', '', annotation.note));
      const remove = create('button', 'quiet-button', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        annotations = annotations.filter((candidate) => candidate.id !== annotation.id);
        dirtyAnnotations = true;
        shareAnnotations.disabled = false;
        state.textContent = annotations.length + ' local annotation' +
          (annotations.length === 1 ? '' : 's') + ' · not shared';
        state.className = 'studio-state changed';
        renderAnnotations();
        updateReadout();
        draw();
      });
      item.append(marker, copy, remove);
      annotationList.append(item);
    });
    annotationList.hidden = !annotations.length;
  }

  function resetView() {
    view.zoom = 1;
    view.pan_x = 0;
    view.pan_y = 0;
    selected = { x: 0.5, y: 0.5 };
    updateReadout();
    draw();
  }

  function zoomAt(factor, anchor) {
    const size = canvasSize();
    Object.assign(view, zoomFigureView(view, factor, anchor, {
      imageWidth,
      imageHeight,
      canvasWidth: size.width,
      canvasHeight: size.height
    }));
    updateReadout();
    draw();
  }

  function interactionView() {
    return {
      zoom: rounded(view.zoom),
      pan_x: rounded(view.pan_x),
      pan_y: rounded(view.pan_y)
    };
  }

  reset.addEventListener('click', resetView);
  shareView.addEventListener('click', async () => {
    const record = await saveInteraction('figure', 'view.saved', artifact, {
      image: { width: imageWidth, height: imageHeight },
      view: interactionView(),
      selected: { x: rounded(selected.x), y: rounded(selected.y) }
    });
    if (record) {
      state.textContent = 'Figure view saved · ' + record.interaction_id;
      state.className = 'studio-state saved';
    }
  });
  add.addEventListener('click', () => {
    const note = noteInput.value.replace(/\s+/g, ' ').trim();
    if (!note) {
      showNotice('Add an observation, question, or revision note first.');
      noteInput.focus();
      return;
    }
    if (annotations.length >= 24) {
      showNotice('A figure review is limited to 24 annotations. Share or remove notes before adding more.');
      return;
    }
    annotations.push({
      id: 'annotation-' + Date.now() + '-' + annotations.length,
      category: category.value,
      x: rounded(selected.x),
      y: rounded(selected.y),
      note
    });
    noteInput.value = '';
    dirtyAnnotations = true;
    shareAnnotations.disabled = false;
    state.textContent = annotations.length + ' local annotation' +
      (annotations.length === 1 ? '' : 's') + ' · not shared';
    state.className = 'studio-state changed';
    renderAnnotations();
    updateReadout();
    draw();
  });
  shareAnnotations.addEventListener('click', async () => {
    if (!dirtyAnnotations) return;
    const action = annotations.length ? 'annotations.saved' : 'annotations.cleared';
    const record = await saveInteraction('figure', action, artifact, {
      image: { width: imageWidth, height: imageHeight },
      view: interactionView(),
      annotations: annotations.map(({ category: kind, x, y, note }) => ({
        category: kind, x, y, note
      }))
    });
    if (record) {
      dirtyAnnotations = false;
      shareAnnotations.disabled = true;
      state.textContent = annotations.length
        ? annotations.length + ' annotation' + (annotations.length === 1 ? '' : 's') +
          ' saved · ' + record.interaction_id
        : 'Annotation set cleared · ' + record.interaction_id;
      state.className = 'studio-state saved';
    }
  });
  function updatePointFromInputs() {
    selected = clampUnitPoint({
      x: Number(xInput.value) / 100,
      y: Number(yInput.value) / 100
    });
    updateReadout();
    draw();
  }
  xInput.addEventListener('change', updatePointFromInputs);
  yInput.addEventListener('change', updatePointFromInputs);

  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.hypot(deltaX, deltaY) > 1) drag.moved = true;
    view.pan_x += deltaX;
    view.pan_y += deltaY;
    drag.x = event.clientX;
    drag.y = event.clientY;
    draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved) {
      const bounds = canvas.getBoundingClientRect();
      const layout = imageLayout(bounds.width, bounds.height);
      selected = pointFromCanvas({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      }, layout);
      updateReadout();
      draw();
    }
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.16 : 0.86, {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    });
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r') resetView();
    else if (event.key === '+' || event.key === '=') zoomAt(1.16);
    else if (event.key === '-') zoomAt(0.86);
    else if (event.key === 'ArrowLeft') view.pan_x -= 24;
    else if (event.key === 'ArrowRight') view.pan_x += 24;
    else if (event.key === 'ArrowUp') view.pan_y -= 24;
    else if (event.key === 'ArrowDown') view.pan_y += 24;
    else if (event.key === 'Enter') return noteInput.focus();
    else return;
    event.preventDefault();
    updateReadout();
    draw();
  });

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!container.isConnected) return observer.disconnect();
      draw();
    });
    observer.observe(viewer);
  }
  renderAnnotations();
  updateReadout();
  draw();
}

function openManuscriptStudio(container, artifact, text, extension) {
  const original = text;
  const ledger = createRevisionLedger(artifact);
  const selectedChanges = new Map();
  let currentDiff = diffManuscript(original, original);
  let renderTimer = null;
  const toolbar = create('div', 'studio-toolbar manuscript-toolbar');
  const state = create('span', 'studio-state', 'No manuscript changes');
  const wrap = create('button', 'secondary-button', 'Wrap lines');
  const download = create('button', 'secondary-button', 'Download draft');
  const reviewSource = create('button', 'secondary-button semantic-review-button', 'Review archived source');
  const reviewDraft = create('button', 'semantic-review-button primary', 'Save + review draft');
  const persist = create('button', 'revision-save-button', 'Save immutable revision');
  const share = create('button', 'share-button', 'Share diff with AI');
  for (const button of [wrap, download, reviewSource, reviewDraft, persist, share]) button.type = 'button';
  share.disabled = true;
  toolbar.append(state, wrap, download, reviewSource, reviewDraft, persist, share);
  const reviewPanel = create('section', 'manuscript-review-result');
  reviewPanel.hidden = true;
  const workspace = create('div', 'manuscript-workspace');
  const editorPane = create('section', 'manuscript-pane manuscript-editor-pane');
  const editorHeader = create('header', 'manuscript-pane-header');
  editorHeader.append(create('strong', '', 'Editable draft'),
    create('small', '', 'Original remains immutable'));
  const editor = create('textarea', 'manuscript-editor');
  editor.spellcheck = true;
  editor.maxLength = 6_000_000;
  editor.value = original;
  editorPane.append(editorHeader, editor);
  const diffPane = create('section', 'manuscript-pane manuscript-diff-pane');
  const diffHeader = create('header', 'manuscript-pane-header');
  const diffTitle = create('strong', '', 'Live line diff');
  const diffStats = create('div', 'manuscript-diff-stats');
  diffHeader.append(diffTitle, diffStats);
  const diffBody = create('div', 'manuscript-diff-body');
  diffPane.append(diffHeader, diffBody);
  workspace.append(editorPane, diffPane);
  const limitation = create('p', 'native-studio-limitation',
    'The line diff is an editing view. The independent reviewer verifies recorded locators, literals, calculations, and artifact links, while explicitly leaving scientific entailment and validity to qualified inspection.');
  container.append(toolbar, ledger.element, reviewPanel, workspace, limitation);

  function renderReviewResult(review) {
    reviewPanel.hidden = false;
    reviewPanel.replaceChildren();
    const report = review.report;
    const head = create('header');
    const heading = create('div');
    heading.append(create('span', 'section-kicker', 'INDEPENDENT REVIEW RECORDED'),
      create('strong', '', String(report.status).toUpperCase() + ' · ' + review.manifest.review_id));
    const open = create('button', 'interactive-link', 'Open full claim map');
    open.type = 'button';
    open.addEventListener('click', () => showArchive('reviews', review.manifest.review_id));
    head.append(heading, open);
    const metrics = create('div', 'manuscript-review-metrics');
    metrics.append(metric('Claims', report.summary.claims),
      metric('Citations', report.summary.verified_citations + '/' + report.summary.citations),
      metric('Calculations', report.summary.calculations_passed + '/' + report.summary.calculations),
      metric('Findings', report.summary.findings));
    reviewPanel.append(head, metrics);
    for (const finding of (report.findings ?? []).slice(0, 6)) {
      reviewPanel.append(reviewFindingRow(finding));
    }
    if ((report.findings?.length ?? 0) > 6) {
      reviewPanel.append(create('p', 'semantic-display-limit',
        'Open the full claim map for ' + (report.findings.length - 6) + ' additional findings.'));
    }
  }

  async function withReviewButtons(callback) {
    reviewSource.disabled = true;
    reviewDraft.disabled = true;
    const sourceLabel = reviewSource.textContent;
    const draftLabel = reviewDraft.textContent;
    try {
      return await callback();
    } finally {
      reviewSource.disabled = false;
      reviewDraft.disabled = false;
      reviewSource.textContent = sourceLabel;
      reviewDraft.textContent = draftLabel;
    }
  }

  reviewSource.addEventListener('click', () => withReviewButtons(async () => {
    reviewSource.textContent = 'Reviewing archived source…';
    const review = await runSemanticReview({ artifact });
    if (review) renderReviewResult(review);
  }));

  reviewDraft.addEventListener('click', () => withReviewButtons(async () => {
    reviewDraft.textContent = 'Saving review target…';
    let revisionId = null;
    if (editor.value !== original) {
      const revision = await persistArtifactRevision(artifact, editor.value, {
        mediaType: textMediaType(extension),
        note: ledger.note.value,
        ledger
      });
      if (!revision) return;
      revisionId = revision.manifest?.revision_id ?? revision.revision_id;
      ledger.note.value = '';
    }
    reviewDraft.textContent = 'Running independent review…';
    const review = await runSemanticReview(revisionId ? { revisionId } : { artifact });
    if (review) {
      state.textContent = 'Semantic review recorded · ' + review.manifest.review_id;
      state.className = review.report.status === 'pass' ? 'studio-state saved' : 'studio-state changed';
      renderReviewResult(review);
    }
  }));

  function changeKey(line) {
    return [line.type, line.old_line ?? '-', line.new_line ?? '-', line.text].join(':');
  }

  function renderDiff() {
    currentDiff = diffManuscript(original, editor.value);
    const { added, deleted, changed_hunks: hunks } = currentDiff.stats;
    const changed = added + deleted;
    for (const key of [...selectedChanges.keys()]) {
      if (!currentDiff.lines.some((line) => line.type !== 'equal' && changeKey(line) === key)) {
        selectedChanges.delete(key);
      }
    }
    diffStats.replaceChildren();
    for (const [className, label] of [
      ['added', '+' + added], ['deleted', '-' + deleted], ['hunks', hunks + ' hunks']
    ]) diffStats.append(create('span', className, label));
    diffBody.replaceChildren();
    if (!changed) {
      diffBody.append(create('div', 'manuscript-no-diff', 'Draft matches the recorded manuscript.'));
      state.textContent = 'No manuscript changes';
      state.className = 'studio-state';
      share.disabled = true;
      return;
    }
    const rendered = manuscriptHunks(currentDiff, { context: 3, maxHunks: 120, maxLines: 2_400 });
    for (let hunkIndex = 0; hunkIndex < rendered.hunks.length; hunkIndex += 1) {
      const hunk = rendered.hunks[hunkIndex];
      const block = create('section', 'manuscript-hunk');
      block.append(create('header', '', '@@ -' + (hunk.old_start ?? 0) + ' +' +
        (hunk.new_start ?? 0) + ' @@'));
      for (const line of hunk.lines) {
        const row = create('button', 'manuscript-diff-line ' + line.type);
        row.type = 'button';
        const key = changeKey(line);
        if (selectedChanges.has(key)) row.classList.add('selected');
        row.disabled = line.type === 'equal';
        const oldNumber = create('span', 'diff-line-number', line.old_line ?? '');
        const newNumber = create('span', 'diff-line-number', line.new_line ?? '');
        const marker = create('span', 'diff-marker', line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ');
        const copy = create('code', '', line.text || ' ');
        row.append(oldNumber, newNumber, marker, copy);
        if (line.type !== 'equal') {
          row.disabled = false;
          row.title = 'Select this change for the next AI turn';
          row.addEventListener('click', () => {
            if (selectedChanges.has(key)) selectedChanges.delete(key);
            else if (selectedChanges.size >= 80) {
              showNotice('Select at most 80 diff lines for one AI handoff.');
              return;
            } else selectedChanges.set(key, line);
            row.classList.toggle('selected', selectedChanges.has(key));
            state.textContent = selectedChanges.size
              ? selectedChanges.size + ' change line' + (selectedChanges.size === 1 ? '' : 's') + ' selected for AI'
              : changed + ' changed lines - select lines or share the bounded diff';
          });
        }
        block.append(row);
      }
      diffBody.append(block);
    }
    if (rendered.truncated || !currentDiff.exact) {
      diffBody.append(create('p', 'manuscript-diff-limit',
        currentDiff.exact
          ? 'The visible diff was truncated; saving still preserves the exact complete draft.'
          : 'The manuscripts exceeded the exact display budget; the changed middle is shown as a bounded replacement. Saving still preserves exact draft bytes.'));
    }
    state.textContent = '+' + added + ' / -' + deleted + ' lines - ' +
      (currentDiff.exact ? 'exact line diff' : 'bounded large-document diff');
    state.className = 'studio-state changed';
    share.disabled = false;
  }

  editor.addEventListener('input', () => {
    state.textContent = 'Recalculating diff...';
    state.className = 'studio-state changed';
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderDiff, 120);
  });
  wrap.addEventListener('click', () => {
    const wrapped = workspace.classList.toggle('wrap-lines');
    wrap.textContent = wrapped ? 'No wrap' : 'Wrap lines';
  });
  download.addEventListener('click', () => downloadDraft(
    artifact.name.replace(/(\.[^.]+)?$/, '-draft$1'),
    editor.value,
    textMediaType(extension)
  ));
  persist.addEventListener('click', async () => {
    if (editor.value === original) {
      showNotice('Change the manuscript before saving a revision.');
      return;
    }
    persist.disabled = true;
    const previous = persist.textContent;
    persist.textContent = 'Saving revision...';
    const revision = await persistArtifactRevision(artifact, editor.value, {
      mediaType: textMediaType(extension),
      note: ledger.note.value,
      ledger
    });
    if (revision) {
      state.textContent = 'Immutable manuscript proposal saved - ' + revision.manifest.revision_id;
      state.className = 'studio-state saved';
      ledger.note.value = '';
    }
    persist.disabled = false;
    persist.textContent = previous;
  });
  share.addEventListener('click', async () => {
    if (editor.value === original) return;
    const selected = [...selectedChanges.values()];
    const fallback = boundedManuscriptChanges(currentDiff, { maxChanges: 80, maxBytes: 24_000 });
    const changes = selected.length ? selected.map((line) => ({
      type: line.type,
      old_line: line.old_line,
      new_line: line.new_line,
      text: String(line.text ?? '').slice(0, 2_000)
    })) : fallback.changes;
    const interaction = await saveInteraction('manuscript', 'diff.shared', artifact, {
      format: extension,
      stats: currentDiff.stats,
      exact: currentDiff.exact,
      algorithm: currentDiff.algorithm,
      selection_mode: selected.length ? 'user-selected' : 'bounded-all-changes',
      changes,
      changes_truncated: selected.length ? false : fallback.truncated
    });
    if (interaction) {
      state.textContent = changes.length + ' diff line' + (changes.length === 1 ? '' : 's') +
        ' shared - ' + interaction.interaction_id;
      state.className = 'studio-state saved';
    }
  });
  renderDiff();
}

function formatGenomeCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  if (Math.abs(number) >= 1_000_000) return (number / 1_000_000).toFixed(2).replace(/\.00$/, '') + ' Mb';
  if (Math.abs(number) >= 1_000) return (number / 1_000).toFixed(2).replace(/\.00$/, '') + ' kb';
  return String(Math.round(number));
}

function openGenomeStudio(container, artifact, text, extension) {
  let genome = parseGenomeDocument(text, extension);
  let view = fitGenomeView(genome);
  let enabledTypes = new Set(genome.stats.types);
  let selected = null;
  let hitBoxes = [];
  let drag = null;
  let wheelTimer = null;
  let keyboardTimer = null;
  const ledger = createRevisionLedger(artifact);
  const toolbar = create('div', 'studio-toolbar genome-toolbar');
  const state = create('span', 'studio-state');
  const contigSelect = create('select', 'workbook-sheet-select');
  contigSelect.setAttribute('aria-label', 'Genome contig');
  const startInput = create('input', 'genome-region-input');
  const endInput = create('input', 'genome-region-input');
  startInput.type = 'number';
  endInput.type = 'number';
  startInput.min = '0';
  endInput.min = '1';
  startInput.setAttribute('aria-label', 'Zero-based region start');
  endInput.setAttribute('aria-label', 'Half-open region end');
  const go = create('button', 'secondary-button', 'Go');
  const reset = create('button', 'secondary-button', 'Whole contig');
  const share = create('button', 'share-button', 'Share region');
  for (const button of [go, reset, share]) button.type = 'button';
  toolbar.append(state, contigSelect, startInput, endInput, go, reset, share);
  const typeFilters = create('div', 'genome-type-filters');
  const viewer = create('div', 'genome-viewer');
  const canvas = create('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive genomic tracks for ' + artifact.name);
  const overlay = create('div', 'viewer-overlay');
  overlay.append(create('span', '', 'Drag to pan'), create('span', '', 'Wheel to zoom'),
    create('span', '', 'Click a feature'), create('span', '', 'Arrows / +/- / R'));
  viewer.append(canvas, overlay);
  const readout = create('div', 'genome-readout');
  const selection = create('div', 'genome-selection', 'No feature selected');
  const limitation = create('p', 'native-studio-limitation',
    'Track coordinates retain their recorded format semantics. Display navigation does not call variants, align reads, or infer biological significance.');
  container.append(toolbar, ledger.element, typeFilters, viewer, readout, selection, limitation);
  const context = canvas.getContext('2d');

  function contig() {
    return genome.contigs.find((item) => item.name === view.contig) ?? genome.contigs[0];
  }

  function updateInputs() {
    startInput.value = String(Math.max(0, Math.floor(view.start)));
    endInput.value = String(Math.max(1, Math.ceil(view.end)));
  }

  function renderContigs() {
    contigSelect.replaceChildren();
    for (const item of genome.contigs) {
      const option = create('option', '', item.name + ' - ' + formatGenomeCoordinate(item.length));
      option.value = item.name;
      contigSelect.append(option);
    }
    contigSelect.value = view.contig;
  }

  function renderFilters() {
    typeFilters.replaceChildren();
    if (!genome.stats.types.length) {
      typeFilters.append(create('span', 'genome-filter-empty', 'Sequence track'));
      return;
    }
    for (const type of genome.stats.types.slice(0, 32)) {
      const label = create('label', 'genome-filter');
      const input = create('input');
      input.type = 'checkbox';
      input.checked = enabledTypes.has(type);
      input.addEventListener('change', () => {
        if (input.checked) enabledTypes.add(type);
        else enabledTypes.delete(type);
        selected = null;
        draw();
        recordGenome('tracks.filtered');
      });
      label.append(input, create('span', '', type));
      typeFilters.append(label);
    }
    if (genome.stats.types.length > 32) {
      typeFilters.append(create('span', 'genome-filter-empty', '+' + (genome.stats.types.length - 32) + ' more types shown as data only'));
    }
  }

  function featureColor(type) {
    const palette = ['#73a8ff', '#78dba9', '#e8b86a', '#bc9cff', '#ef8585', '#65c9c2', '#d8cf70'];
    let hash = 0;
    for (const character of String(type)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }

  function drawSequence(current, width, axisY) {
    const span = view.end - view.start;
    if (!current?.sequence || span > 140) return;
    const start = Math.max(0, Math.floor(view.start));
    const end = Math.min(current.sequence.length, Math.ceil(view.end));
    context.font = '600 10px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const colors = { A: '#78dba9', C: '#73a8ff', G: '#e8b86a', T: '#ef8585', U: '#ef8585', N: '#929ba1' };
    for (let position = start; position < end; position += 1) {
      const left = genomePositionToCanvas(position, view, width);
      const right = genomePositionToCanvas(position + 1, view, width);
      const base = current.sequence[position] ?? 'N';
      context.fillStyle = colors[base] ?? '#bc9cff';
      context.fillText(base, (left + right) / 2, axisY + 42);
    }
  }

  function draw() {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || 900);
    const height = Math.max(1, bounds.height || 460);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const axisY = 52;
    context.strokeStyle = 'rgba(174, 187, 195, 0.34)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(48, axisY);
    context.lineTo(width - 48, axisY);
    context.stroke();
    context.font = '9px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.fillStyle = '#929ba1';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    for (const tick of genomeTicks(view, Math.max(3, Math.floor(width / 150)))) {
      const x = genomePositionToCanvas(tick, view, width);
      context.beginPath();
      context.moveTo(x, axisY - 4);
      context.lineTo(x, axisY + 5);
      context.stroke();
      context.fillText(formatGenomeCoordinate(tick), x, axisY - 7);
    }
    const visible = visibleGenomeFeatures(genome, view, enabledTypes);
    const laneTypes = [...new Set(visible.map((feature) => feature.type))].slice(0, 12);
    const laneHeight = Math.max(24, Math.min(42, (height - 94) / Math.max(1, laneTypes.length)));
    hitBoxes = [];
    for (let laneIndex = 0; laneIndex < laneTypes.length; laneIndex += 1) {
      const type = laneTypes[laneIndex];
      const y = axisY + 32 + laneIndex * laneHeight;
      context.fillStyle = '#737f86';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText(type, 8, y);
      const items = visible.filter((feature) => feature.type === type).slice(0, 5_000);
      for (const feature of items) {
        const left = Math.max(48, genomePositionToCanvas(feature.start, view, width));
        const right = Math.min(width - 48, genomePositionToCanvas(feature.end, view, width));
        const itemWidth = Math.max(3, right - left);
        const selectedFeature = selected?.index === feature.index && selected?.row === feature.row;
        const color = featureColor(type);
        if (type === 'variant') {
          context.beginPath();
          context.moveTo(left, y - 9);
          context.lineTo(left - 5, y + 7);
          context.lineTo(left + 5, y + 7);
          context.closePath();
          context.fillStyle = selectedFeature ? '#ffffff' : color;
          context.fill();
          hitBoxes.push({ x: left - 7, y: y - 11, width: 14, height: 20, feature });
        } else {
          const signalHeight = feature.value === null ? 12 : Math.max(3, Math.min(22, Math.abs(feature.value) * 3));
          context.fillStyle = selectedFeature ? '#ffffff' : color;
          context.globalAlpha = selectedFeature ? 1 : 0.76;
          context.fillRect(left, y - signalHeight / 2, itemWidth, signalHeight);
          context.globalAlpha = 1;
          hitBoxes.push({ x: left, y: y - Math.max(10, signalHeight / 2), width: itemWidth, height: Math.max(20, signalHeight), feature });
        }
      }
    }
    drawSequence(contig(), width, axisY);
    const span = view.end - view.start;
    state.textContent = view.contig + ':' + Math.floor(view.start) + '-' + Math.ceil(view.end) +
      ' - ' + formatGenomeCoordinate(span) + ' span - ' + visible.length + ' visible feature' +
      (visible.length === 1 ? '' : 's');
    state.className = 'studio-state';
    readout.textContent = genome.stats.feature_count + ' recorded feature' +
      (genome.stats.feature_count === 1 ? '' : 's') + ' across ' + genome.stats.contig_count +
      ' contig' + (genome.stats.contig_count === 1 ? '' : 's') +
      (genome.stats.truncated ? ' - display input truncated at the safe parser limit' : '');
    updateInputs();
  }

  function renderSelection() {
    if (!selected) {
      selection.textContent = 'No feature selected';
      return;
    }
    selection.replaceChildren();
    selection.append(create('strong', '', selected.name || selected.type),
      create('span', '', selected.contig + ':' + selected.start + '-' + selected.end +
        ' - ' + selected.type + (selected.strand ? ' - strand ' + selected.strand : '') +
        (selected.ref ? ' - ' + selected.ref + '>' + selected.alt.join(',') : '')));
  }

  async function recordGenome(action, quiet = true) {
    const interaction = await saveInteraction('genome', action, artifact, {
      format: extension,
      contig: view.contig,
      region: { start: Math.floor(view.start), end: Math.ceil(view.end), coordinate_system: 'zero-based-half-open' },
      enabled_types: [...enabledTypes].slice(0, 32),
      visible_feature_count: visibleGenomeFeatures(genome, view, enabledTypes).length,
      selection: selected ? {
        row: selected.row,
        type: selected.type,
        name: selected.name,
        contig: selected.contig,
        start: selected.start,
        end: selected.end,
        strand: selected.strand,
        ref: selected.ref,
        alt: selected.alt,
        filter: selected.filter
      } : null
    }, { quiet });
    if (interaction) {
      state.textContent = 'Genome view saved - AI context updated';
      state.className = 'studio-state saved';
    }
  }

  function setContig(name) {
    view = fitGenomeView(genome, name);
    selected = null;
    contigSelect.value = view.contig;
    renderSelection();
    draw();
  }

  contigSelect.addEventListener('change', () => {
    setContig(contigSelect.value);
    recordGenome('contig.selected');
  });
  go.addEventListener('click', () => {
    const start = Math.max(0, Math.floor(Number(startInput.value)));
    const end = Math.min(view.length, Math.ceil(Number(endInput.value)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      showNotice('Genome region must use a valid zero-based start and larger half-open end.');
      return;
    }
    view = { ...view, start, end };
    selected = null;
    renderSelection();
    draw();
    recordGenome('region.entered');
  });
  reset.addEventListener('click', () => {
    setContig(view.contig);
    recordGenome('view.reset');
  });
  share.addEventListener('click', () => recordGenome('view.shared', false));
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, start: { ...view }, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    drag.moved ||= Math.abs(dx) > 2;
    const width = Math.max(1, canvas.getBoundingClientRect().width - 96);
    view = panGenomeView(drag.start, -dx / width * (drag.start.end - drag.start.start));
    draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const bounds = canvas.getBoundingClientRect();
    if (!drag.moved) {
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      selected = [...hitBoxes].reverse().find((box) =>
        x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height)?.feature ?? null;
      renderSelection();
      draw();
      recordGenome(selected ? 'feature.selected' : 'selection.cleared');
    } else recordGenome('view.panned');
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const anchor = canvasToGenomePosition(event.clientX - bounds.left, view, bounds.width);
    view = zoomGenomeView(view, event.deltaY < 0 ? 0.78 : 1.28, anchor);
    draw();
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => recordGenome('view.zoomed'), 400);
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const span = view.end - view.start;
    let handled = true;
    if (event.key === 'ArrowLeft') view = panGenomeView(view, -span * 0.08);
    else if (event.key === 'ArrowRight') view = panGenomeView(view, span * 0.08);
    else if (event.key === '+' || event.key === '=') view = zoomGenomeView(view, 0.78);
    else if (event.key === '-' || event.key === '_') view = zoomGenomeView(view, 1.28);
    else if (event.key.toLowerCase() === 'r') view = fitGenomeView(genome, view.contig);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    draw();
    window.clearTimeout(keyboardTimer);
    keyboardTimer = window.setTimeout(() => recordGenome('view.keyboard'), 350);
  });
  const resize = new ResizeObserver(() => {
    if (!canvas.isConnected) return resize.disconnect();
    draw();
  });
  resize.observe(viewer);
  appendNativeSourceEditor(container, artifact, text, {
    surface: 'genome', ledger, extension, label: 'genomic',
    onApply(value) {
      genome = parseGenomeDocument(value, extension);
      enabledTypes = new Set(genome.stats.types);
      view = fitGenomeView(genome);
      selected = null;
      renderContigs();
      renderFilters();
      renderSelection();
      draw();
    }
  });
  renderContigs();
  renderFilters();
  renderSelection();
  draw();
}

function openChemicalStudio(container, artifact, text, extension) {
  let documentModel = parseChemicalDocument(text, extension);
  let currentSource = text;
  let moleculeIndex = 0;
  let selectedAtom = null;
  let view = null;
  let drag = null;
  let wheelTimer = null;
  let keyboardTimer = null;
  let threeDLoaded = false;
  const ledger = createRevisionLedger(artifact);
  const toolbar = create('div', 'studio-toolbar');
  const state = create('span', 'studio-state');
  const moleculeSelect = create('select', 'workbook-sheet-select');
  moleculeSelect.setAttribute('aria-label', 'Molecule');
  const reset = create('button', 'secondary-button', 'Reset view');
  const toggleThreeD = ['mol', 'sdf'].includes(extension)
    ? create('button', 'secondary-button', '3D coordinates') : null;
  const share = create('button', 'share-button', 'Share structure view');
  reset.type = 'button';
  if (toggleThreeD) toggleThreeD.type = 'button';
  share.type = 'button';
  toolbar.append(state, moleculeSelect, reset);
  if (toggleThreeD) toolbar.append(toggleThreeD);
  toolbar.append(share);
  const workspace = create('div', 'chemical-workspace');
  const viewer = create('div', 'chemical-viewer');
  const canvas = create('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive two-dimensional chemical depiction of ' + artifact.name);
  const overlay = create('div', 'viewer-overlay');
  overlay.append(create('span', '', 'Drag to pan'), create('span', '', 'Wheel to zoom'),
    create('span', '', 'Click an atom'), create('span', '', 'Arrows / +/- / R'));
  viewer.append(canvas, overlay);
  const inspector = create('aside', 'chemical-inspector');
  const title = create('h3', '', 'Structure summary');
  const metrics = create('div', 'chemical-metrics');
  const selection = create('div', 'chemical-selection', 'No atom selected');
  const properties = create('div', 'chemical-properties');
  const limitation = create('p', 'native-studio-limitation',
    'Connectivity depiction only. ScienceCode does not infer stereochemistry, protonation, aromaticity, or chemical validity beyond the recorded format.');
  inspector.append(title, metrics, selection, properties, limitation);
  workspace.append(viewer, inspector);
  const threeDHost = create('div', 'chemical-three-d-host');
  threeDHost.hidden = true;
  container.append(toolbar, ledger.element, workspace, threeDHost);
  const context = canvas.getContext('2d');

  function molecule() {
    return documentModel.molecules[moleculeIndex] ?? documentModel.molecules[0];
  }

  function threeDSource() {
    if (extension !== 'sdf') return currentSource;
    const blocks = currentSource.replace(/\r/g, '').split(/^\$\$\$\$\s*$/m)
      .filter((block) => block.trim());
    return (blocks[moleculeIndex] ?? blocks[0] ?? currentSource).replace(/^\n/, '');
  }

  function invalidateThreeD() {
    if (!threeDLoaded) return;
    threeDHost.replaceChildren();
    threeDLoaded = false;
    if (!threeDHost.hidden) {
      openThreeDStudio(threeDHost, artifact, threeDSource(), extension);
      threeDLoaded = true;
    }
  }

  function canvasSize() {
    const bounds = canvas.getBoundingClientRect();
    return {
      bounds,
      width: Math.max(1, bounds.width || 760),
      height: Math.max(1, bounds.height || 520)
    };
  }

  function resetView() {
    const { width, height } = canvasSize();
    view = fitChemicalView(molecule(), width, height);
    selectedAtom = null;
    renderInspector();
    draw();
  }

  function renderMoleculeOptions() {
    moleculeSelect.replaceChildren();
    for (const item of documentModel.molecules) {
      const option = create('option', '', (item.index + 1) + '. ' + item.name);
      option.value = String(item.index);
      moleculeSelect.append(option);
    }
    moleculeSelect.value = String(moleculeIndex);
  }

  function renderInspector() {
    const current = molecule();
    const summary = current.summary;
    title.textContent = current.name;
    metrics.replaceChildren();
    for (const [label, value] of [
      ['Explicit formula', summary.formula || 'not derived'],
      ['Atoms', summary.atom_count],
      ['Bonds', summary.bond_count],
      ['Explicit-atom mass', summary.approximate_mass ?? 'not derived']
    ]) {
      const row = create('div');
      row.append(create('small', '', label), create('strong', '', String(value)));
      metrics.append(row);
    }
    if (Number.isInteger(selectedAtom)) {
      const atom = current.atoms[selectedAtom];
      selection.textContent = atom
        ? 'Atom ' + (atom.index + 1) + ': ' + atom.label +
          (atom.charge ? ' - charge ' + (atom.charge > 0 ? '+' : '') + atom.charge : '') +
          (atom.aromatic ? ' - aromatic token' : '')
        : 'No atom selected';
    } else selection.textContent = 'No atom selected';
    properties.replaceChildren();
    const entries = Object.entries(current.properties ?? {}).slice(0, 16);
    if (entries.length) {
      properties.append(create('strong', '', 'Recorded properties'));
      for (const [key, value] of entries) {
        const row = create('div', 'chemical-property');
        row.append(create('span', '', key), create('code', '', compact(value, 180)));
        properties.append(row);
      }
    }
    state.textContent = documentModel.molecules.length + ' molecule' +
      (documentModel.molecules.length === 1 ? '' : 's') + ' - ' + summary.atom_count +
      ' atoms - ' + summary.bond_count + ' bonds';
    state.className = 'studio-state';
  }

  function bondLine(a, b, bond, selected) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const offsetX = -dy / length * 3;
    const offsetY = dx / length * 3;
    context.strokeStyle = selected ? '#f2c879' : 'rgba(205, 215, 222, 0.72)';
    context.lineWidth = selected ? 2.3 : 1.7;
    context.setLineDash(bond.order === 1.5 ? [5, 4] : []);
    const count = bond.order >= 3 ? 3 : bond.order >= 2 ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const shift = count === 1 ? 0 : (index - (count - 1) / 2) * 2;
      context.beginPath();
      context.moveTo(a.x + offsetX * shift, a.y + offsetY * shift);
      context.lineTo(b.x + offsetX * shift, b.y + offsetY * shift);
      context.stroke();
    }
    context.setLineDash([]);
  }

  function draw() {
    if (!view) return;
    const { bounds, width, height } = canvasSize();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const current = molecule();
    const points = current.atoms.map((atom) => chemicalPointToCanvas(atom, view, width, height));
    for (const bond of current.bonds) {
      const a = points[bond.from];
      const b = points[bond.to];
      if (a && b) bondLine(a, b, bond, bond.from === selectedAtom || bond.to === selectedAtom);
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 12px ui-monospace, SFMono-Regular, Consolas, monospace';
    for (const atom of current.atoms) {
      const point = points[atom.index];
      const selected = atom.index === selectedAtom;
      const showLabel = atom.element !== 'C' || selected || atom.charge || current.atoms.length <= 3;
      if (selected || showLabel) {
        context.beginPath();
        context.arc(point.x, point.y, selected ? 14 : 11, 0, Math.PI * 2);
        context.fillStyle = selected ? 'rgba(232, 184, 106, 0.25)' : 'rgba(10, 14, 17, 0.94)';
        context.fill();
        if (selected) {
          context.lineWidth = 1.5;
          context.strokeStyle = '#e8b86a';
          context.stroke();
        }
      }
      if (showLabel) {
        const colors = { C: '#b8c0c6', N: '#79a7ff', O: '#f18484', S: '#e4cf64', P: '#e7a96b', F: '#7ee2a8', Cl: '#7ee2a8', Br: '#c78c67' };
        context.fillStyle = colors[atom.element] ?? '#d5c0ff';
        const label = atom.element + (atom.charge ? (atom.charge > 0 ? '+' : '') + atom.charge : '');
        context.fillText(label, point.x, point.y);
      }
    }
    if (!current.atoms.length) context.fillText('No atoms to display', bounds.width / 2, bounds.height / 2);
  }

  async function recordChemical(action, quiet = true) {
    const current = molecule();
    const atom = Number.isInteger(selectedAtom) ? current.atoms[selectedAtom] : null;
    const interaction = await saveInteraction('chemical', action, artifact, {
      format: extension,
      molecule: { index: moleculeIndex, name: current.name, ...current.summary },
      view: {
        zoom: Number(view.zoom.toFixed(4)),
        pan_x: Number(view.pan_x.toFixed(2)),
        pan_y: Number(view.pan_y.toFixed(2))
      },
      selection: atom ? {
        index: atom.index,
        element: atom.element,
        label: atom.label,
        charge: atom.charge,
        aromatic: atom.aromatic
      } : null
    }, { quiet });
    if (interaction) {
      state.textContent = 'Structure view saved - AI context updated';
      state.className = 'studio-state saved';
    }
  }

  moleculeSelect.addEventListener('change', () => {
    moleculeIndex = Number(moleculeSelect.value) || 0;
    resetView();
    invalidateThreeD();
    recordChemical('molecule.selected');
  });
  reset.addEventListener('click', () => {
    resetView();
    recordChemical('view.reset');
  });
  if (toggleThreeD) {
    toggleThreeD.addEventListener('click', () => {
      const opening = threeDHost.hidden;
      workspace.hidden = opening;
      threeDHost.hidden = !opening;
      toggleThreeD.textContent = opening ? '2D depiction' : '3D coordinates';
      if (opening && !threeDLoaded) {
        openThreeDStudio(threeDHost, artifact, threeDSource(), extension);
        threeDLoaded = true;
      }
    });
  }
  share.addEventListener('click', () => recordChemical('view.shared', false));
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved ||= Math.hypot(dx, dy) > 2;
    view = panChemicalView(view, dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
    draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const { bounds, width, height } = canvasSize();
    if (!drag.moved) {
      const nearest = nearestChemicalAtom(molecule(), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      }, view, width, height);
      selectedAtom = nearest?.atom.index ?? null;
      renderInspector();
      draw();
      recordChemical(selectedAtom === null ? 'selection.cleared' : 'atom.selected');
    } else recordChemical('view.panned');
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const { bounds, width, height } = canvasSize();
    view = zoomChemicalView(view, event.deltaY < 0 ? 1.15 : 0.87, {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    }, width, height);
    draw();
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => recordChemical('view.zoomed'), 400);
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    let handled = true;
    if (event.key === 'ArrowLeft') view = panChemicalView(view, 24, 0);
    else if (event.key === 'ArrowRight') view = panChemicalView(view, -24, 0);
    else if (event.key === 'ArrowUp') view = panChemicalView(view, 0, 24);
    else if (event.key === 'ArrowDown') view = panChemicalView(view, 0, -24);
    else if (event.key === '+' || event.key === '=') view = zoomChemicalView(view, 1.15, null, canvasSize().width, canvasSize().height);
    else if (event.key === '-' || event.key === '_') view = zoomChemicalView(view, 0.87, null, canvasSize().width, canvasSize().height);
    else if (event.key.toLowerCase() === 'r') resetView();
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    draw();
    window.clearTimeout(keyboardTimer);
    keyboardTimer = window.setTimeout(() => recordChemical('view.keyboard'), 350);
  });
  const resize = new ResizeObserver(() => {
    if (!canvas.isConnected) return resize.disconnect();
    if (!view) resetView();
    else draw();
  });
  resize.observe(viewer);
  appendNativeSourceEditor(container, artifact, text, {
    surface: 'chemical', ledger, extension, label: 'chemical',
    onApply(value) {
      currentSource = value;
      documentModel = parseChemicalDocument(value, extension);
      moleculeIndex = 0;
      renderMoleculeOptions();
      resetView();
      invalidateThreeD();
    }
  });
  renderMoleculeOptions();
  renderInspector();
  resetView();
}

function openThreeDStudio(container, artifact, text, extension) {
  const geometry = parseThreeD(text, extension);
  if (!geometry.vertices.length) {
    container.append(create('div', 'studio-error',
      'No supported 3D coordinates were found. Supported text formats: PDB, MOL/SDF, XYZ, OBJ, ASCII PLY, and ASCII STL.'));
    return;
  }
  const scalarField = geometry.scalar ?? null;
  const toolbar = create('div', 'studio-toolbar');
  const stateLabel = create('span', 'studio-state',
    geometry.vertices.length + ' vertices · ' + geometry.edges.length +
      ' edges' + (geometry.faces.length
        ? ' · ' + geometry.faces.length + ' triangles' : '') +
      (scalarField ? ' · field ' + scalarField.name : ''));
  const reset = create('button', 'secondary-button', 'Reset view');
  reset.type = 'button';
  const spin = create('button', 'secondary-button', 'Auto spin');
  spin.type = 'button';
  const share = create('button', 'share-button', 'Share view with AI');
  share.type = 'button';
  toolbar.append(stateLabel, reset, spin, share);
  const viewer = create('div', 'three-d-viewer');
  const canvas = create('canvas');
  canvas.setAttribute('aria-label', 'Interactive 3D rendering of ' + artifact.name);
  canvas.tabIndex = 0;
  const overlay = create('div', 'viewer-overlay');
  overlay.append(create('span', '', 'Drag to rotate'), create('span', '', 'Wheel to zoom'),
    create('span', '', 'Click a point to select'), create('span', '', 'Arrows / +/- / R'));
  viewer.append(canvas, overlay);
  if (scalarField) {
    const legend = create('div', 'scalar-field-legend');
    const heading = create('strong', '', scalarField.name.replaceAll('_', ' '));
    const scale = create('i', 'scalar-field-scale');
    const values = create('span', 'scalar-field-values');
    values.append(
      create('b', '', Number(scalarField.minimum).toPrecision(5) +
        (scalarField.unit ? ' ' + scalarField.unit : '')),
      create('b', '', Number(scalarField.maximum).toPrecision(5) +
        (scalarField.unit ? ' ' + scalarField.unit : ''))
    );
    legend.append(heading, scale, values);
    viewer.append(legend);
  }
  const selection = create('div', 'selection-readout', 'No point selected');
  container.append(toolbar, viewer, selection);

  const source = geometry.vertices;
  const meshMode = geometry.faces.length > 0;
  const center = source.reduce((sum, vertex) => ({
    x: sum.x + vertex.x / source.length,
    y: sum.y + vertex.y / source.length,
    z: sum.z + vertex.z / source.length
  }), { x: 0, y: 0, z: 0 });
  const radius = Math.max(0.0001, ...source.map((vertex) =>
    Math.hypot(vertex.x - center.x, vertex.y - center.y, vertex.z - center.z)));
  const vertices = source.map((vertex) => ({
    ...vertex,
    nx: (vertex.x - center.x) / radius,
    ny: (vertex.y - center.y) / radius,
    nz: (vertex.z - center.z) / radius
  }));
  const colors = {
    H: '#e8e8e8', C: '#7f8b92', N: '#6f9fff', O: '#ef7373',
    F: '#7ee2a8', CL: '#7ee2a8', P: '#e7a96b', S: '#e4cf64'
  };
  function scalarColor(value, brightness = 1) {
    const minimum = Number(scalarField?.minimum);
    const maximum = Number(scalarField?.maximum);
    const finiteValue = Number(value);
    const normalized = Number.isFinite(finiteValue) && maximum > minimum
      ? Math.max(0, Math.min(1, (finiteValue - minimum) / (maximum - minimum)))
      : 0.5;
    const stops = [
      [0, 32, 87, 206],
      [0.33, 0, 210, 255],
      [0.66, 255, 225, 65],
      [1, 244, 65, 54]
    ];
    let right = stops.findIndex((stop) => stop[0] >= normalized);
    if (right <= 0) right = 1;
    const left = stops[right - 1];
    const upper = stops[Math.min(right, stops.length - 1)];
    const position = (normalized - left[0]) / Math.max(0.000001, upper[0] - left[0]);
    const light = Math.max(0.2, Math.min(1, brightness));
    return [1, 2, 3].map((index) =>
      Math.round((left[index] + (upper[index] - left[index]) * position) * light)
    );
  }
  const view = { yaw: -0.55, pitch: 0.35, zoom: 1.15, selected: null, spinning: false };
  let projected = [];
  let frame = 0;
  const context = canvas.getContext('2d');

  function draw() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const cosineYaw = Math.cos(view.yaw);
    const sineYaw = Math.sin(view.yaw);
    const cosinePitch = Math.cos(view.pitch);
    const sinePitch = Math.sin(view.pitch);
    const scale = Math.min(bounds.width, bounds.height) * 1.12 * view.zoom;
    projected = vertices.map((vertex, index) => {
      const x1 = vertex.nx * cosineYaw + vertex.nz * sineYaw;
      const z1 = -vertex.nx * sineYaw + vertex.nz * cosineYaw;
      const y2 = vertex.ny * cosinePitch - z1 * sinePitch;
      const z2 = vertex.ny * sinePitch + z1 * cosinePitch;
      const perspective = 1 / (3.4 - z2 * 0.55);
      return {
        index,
        x: bounds.width / 2 + x1 * scale * perspective,
        y: bounds.height / 2 - y2 * scale * perspective,
        z: z2,
        rx: x1,
        ry: y2,
        rz: z2,
        perspective,
        element: vertex.element,
        scalar: vertex.scalar
      };
    });
    if (meshMode) {
      const light = [0.35, -0.45, 0.82];
      const faces = geometry.faces.map((face, index) => {
        const points = face.map((vertexIndex) => projected[vertexIndex]);
        if (points.some((point) => !point)) return null;
        const ab = [
          points[1].rx - points[0].rx,
          points[1].ry - points[0].ry,
          points[1].rz - points[0].rz
        ];
        const ac = [
          points[2].rx - points[0].rx,
          points[2].ry - points[0].ry,
          points[2].rz - points[0].rz
        ];
        const normal = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0]
        ];
        const length = Math.hypot(...normal) || 1;
        const diffuse = Math.abs(
          (normal[0] * light[0] + normal[1] * light[1] +
            normal[2] * light[2]) / length
        );
        return {
          index,
          points,
          depth: points.reduce((sum, point) => sum + point.z, 0) / 3,
          brightness: 0.24 + diffuse * 0.68,
          scalar: scalarField
            ? points.reduce((sum, point) => sum + Number(point.scalar), 0) / 3
            : null
        };
      }).filter(Boolean).sort((left, right) => left.depth - right.depth);
      for (const face of faces) {
        context.beginPath();
        context.moveTo(face.points[0].x, face.points[0].y);
        context.lineTo(face.points[1].x, face.points[1].y);
        context.lineTo(face.points[2].x, face.points[2].y);
        context.closePath();
        const alpha = Math.max(0.3, Math.min(0.96, face.brightness));
        if (scalarField) {
          const [red, green, blue] = scalarColor(
            face.scalar, 0.46 + face.brightness * 0.54
          );
          context.fillStyle = 'rgba(' + red + ', ' + green + ', ' + blue +
            ', ' + alpha.toFixed(3) + ')';
        } else {
          context.fillStyle = 'rgba(166, 123, 255, ' + alpha.toFixed(3) + ')';
        }
        context.fill();
        context.lineWidth = 0.55;
        context.strokeStyle = scalarField
          ? 'rgba(240, 248, 255, 0.18)'
          : 'rgba(231, 221, 255, 0.24)';
        context.stroke();
      }
    }
    if (!meshMode) {
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(148, 156, 162, 0.32)';
      context.beginPath();
      for (const [left, right] of geometry.edges) {
        const a = projected[left];
        const b = projected[right];
        if (!a || !b) continue;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
      context.stroke();
    }
    const visiblePoints = meshMode
      ? projected.filter((point) => point.index === view.selected)
      : projected;
    for (const point of [...visiblePoints].sort((left, right) => left.z - right.z)) {
      const selected = point.index === view.selected;
      const radiusValue = Math.max(1.6, 4.8 * point.perspective) + (selected ? 2.5 : 0);
      context.beginPath();
      context.arc(point.x, point.y, radiusValue, 0, Math.PI * 2);
      if (scalarField) {
        const [red, green, blue] = scalarColor(point.scalar);
        context.fillStyle = 'rgb(' + red + ', ' + green + ', ' + blue + ')';
      } else {
        context.fillStyle = colors[point.element] ?? '#bc9cff';
      }
      context.fill();
      if (selected) {
        context.lineWidth = 2;
        context.strokeStyle = '#ffffff';
        context.stroke();
      }
    }
  }

  async function recordView(action, quiet = true) {
    const selected = Number.isInteger(view.selected) ? vertices[view.selected] : null;
    const interaction = await saveInteraction(
      artifact.kind === 'cad-project' || artifact.kind === 'cad-build'
        ? 'cad' : 'three-d',
      action,
      artifact,
      {
        format: extension,
        view: {
          yaw: Number(view.yaw.toFixed(4)),
          pitch: Number(view.pitch.toFixed(4)),
          zoom: Number(view.zoom.toFixed(4))
        },
        selection: selected ? {
          index: view.selected,
          element: selected.element,
          x: selected.x,
          y: selected.y,
          z: selected.z,
          ...(scalarField && Number.isFinite(selected.scalar)
            ? {
                scalar_name: scalarField.name,
                scalar_value: selected.scalar,
                scalar_unit: scalarField.unit
              }
            : {})
        } : null,
        geometry: {
          vertices: geometry.vertices.length,
          edges: geometry.edges.length,
          triangles: geometry.faces.length
        },
        field: scalarField ? {
          name: scalarField.name,
          unit: scalarField.unit,
          minimum: scalarField.minimum,
          maximum: scalarField.maximum,
          finite_vertices: scalarField.finite_vertices
        } : null
      },
      { quiet }
    );
    if (interaction) {
      stateLabel.textContent = 'View saved · AI context updated';
      stateLabel.className = 'studio-state saved';
    }
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
    view.yaw = drag.yaw + dx * 0.009;
    view.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + dy * 0.009));
    stateLabel.textContent = 'View changed · saving for AI';
    stateLabel.className = 'studio-state changed';
    draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    if (!drag.moved) {
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const nearest = projected.reduce((best, point) => {
        const distance = Math.hypot(point.x - x, point.y - y);
        return !best || distance < best.distance ? { point, distance } : best;
      }, null);
      if (nearest?.distance < 14) {
        view.selected = nearest.point.index;
        const vertex = vertices[view.selected];
        selection.textContent = 'Selected ' + vertex.element + ' #' + (view.selected + 1) +
          ' · (' + [vertex.x, vertex.y, vertex.z].map((value) => value.toFixed(3)).join(', ') + ')' +
          (scalarField && Number.isFinite(vertex.scalar)
            ? ' · ' + scalarField.name + ' ' + Number(vertex.scalar).toPrecision(7) +
              (scalarField.unit ? ' ' + scalarField.unit : '')
            : '');
        draw();
        recordView('point.selected');
      }
    } else {
      recordView('view.rotated');
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  let keyboardTimer;
  canvas.addEventListener('keydown', (event) => {
    let handled = true;
    if (event.key === 'ArrowLeft') view.yaw -= 0.08;
    else if (event.key === 'ArrowRight') view.yaw += 0.08;
    else if (event.key === 'ArrowUp') view.pitch = Math.max(-1.5, view.pitch - 0.08);
    else if (event.key === 'ArrowDown') view.pitch = Math.min(1.5, view.pitch + 0.08);
    else if (event.key === '+' || event.key === '=') view.zoom = Math.min(4, view.zoom * 1.08);
    else if (event.key === '-' || event.key === '_') view.zoom = Math.max(0.35, view.zoom / 1.08);
    else if (event.key.toLowerCase() === 'r') {
      Object.assign(view, { yaw: -0.55, pitch: 0.35, zoom: 1.15, selected: null });
      selection.textContent = 'No point selected';
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    stateLabel.textContent = 'Keyboard view changed · saving for AI';
    stateLabel.className = 'studio-state changed';
    draw();
    window.clearTimeout(keyboardTimer);
    keyboardTimer = window.setTimeout(() => recordView('view.keyboard'), 350);
  });
  let wheelTimer;
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    view.zoom = Math.max(0.35, Math.min(4, view.zoom * Math.exp(-event.deltaY * 0.001)));
    stateLabel.textContent = 'Zoom changed · saving for AI';
    stateLabel.className = 'studio-state changed';
    draw();
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => recordView('view.zoomed'), 450);
  }, { passive: false });
  reset.addEventListener('click', () => {
    Object.assign(view, { yaw: -0.55, pitch: 0.35, zoom: 1.15, selected: null });
    selection.textContent = 'No point selected';
    draw();
    recordView('view.reset');
  });
  spin.addEventListener('click', () => {
    view.spinning = !view.spinning;
    spin.textContent = view.spinning ? 'Stop spin' : 'Auto spin';
    if (view.spinning) animate();
    else recordView('view.spun');
  });
  share.addEventListener('click', () => recordView('view.shared', false));
  function animate() {
    if (!view.spinning || !canvas.isConnected) return;
    view.yaw += 0.008;
    draw();
    frame = window.requestAnimationFrame(animate);
  }
  const observer = new ResizeObserver(() => {
    if (!canvas.isConnected) {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      return;
    }
    draw();
  });
  observer.observe(viewer);
  draw();
}

async function selectChat(chatId, { force = false } = {}) {
  if ((chatBusy || stateBusy) && !force) return;
  const previous = {
    selectedChat,
    activeChat,
    activeHarness,
    draftConversation
  };
  setStateBusy(true);
  selectedChat = chatId;
  draftConversation = false;
  updateChatUrl(chatId);
  renderChatList();
  setConnection('loading', 'Loading');
  try {
    const [chatResult, harnessResult] = await Promise.all([
      fetchJson('/api/chats/' + encodeURIComponent(chatId)),
      fetchJson('/api/chats/' + encodeURIComponent(chatId) + '/harness')
    ]);
    activeChat = chatResult.payload;
    activeHarness = harnessResult.payload;
    elements.agentSelect.value = activeChat.manifest.agent ?? 'scientist';
    renderConversation();
    renderHarness(activeHarness);
    if (activeView === 'lineage') void renderLineageWorkspace(chatId);
    setIntegrityConnection();
  } catch (error) {
    if (previous.activeChat) {
      selectedChat = previous.selectedChat;
      activeChat = previous.activeChat;
      activeHarness = previous.activeHarness;
      draftConversation = previous.draftConversation;
    } else {
      selectedChat = null;
      activeChat = null;
      activeHarness = null;
      draftConversation = true;
    }
    updateChatUrl(selectedChat);
    elements.agentSelect.value = activeChat?.manifest?.agent ?? 'scientist';
    renderChatList();
    renderConversation();
    if (activeHarness) renderHarness(activeHarness);
    else emptyHarness();
    setConnection('error', 'Unavailable');
    showNotice(error.message);
  } finally {
    setStateBusy(false);
  }
}

function beginNewConversation() {
  if (chatBusy || stateBusy || !stateReady) return;
  selectedChat = null;
  activeChat = null;
  activeHarness = null;
  activeJob = null;
  draftConversation = true;
  updateChatUrl(null);
  elements.agentSelect.value = 'scientist';
  renderChatList();
  renderConversation();
  emptyHarness();
  showView('chat');
  syncInteractionControls();
  elements.chatInput.focus();
}

async function createConversation() {
  const { payload } = await fetchJson('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: elements.agentSelect.value })
  });
  selectedChat = payload.manifest.chat_id;
  activeChat = payload;
  draftConversation = false;
  updateChatUrl(selectedChat);
  return payload;
}

async function pollJob(jobId) {
  let failures = 0;
  while (true) {
    try {
      const { payload: job } = await fetchJson('/api/jobs/' + encodeURIComponent(jobId));
      activeJob = job;
      failures = 0;
      renderHarness(activeHarness, job);
      updatePendingResponse(job);
      if (!ACTIVE_JOB_STATUSES.has(job.status)) return job;
    } catch (error) {
      failures += 1;
      if (failures >= 4) throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 650));
  }
}

async function cancelActiveJob() {
  const job = activeJob;
  if (!job || !selectedChat || !['queued', 'running'].includes(job.status)) return;
  job.status = 'cancelling';
  setChatBusy(true, 'Stopping');
  renderHarness(activeHarness, job);
  updatePendingResponse(job);
  try {
    const { payload } = await fetchJson(
      '/api/jobs/' + encodeURIComponent(job.job_id) + '/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: selectedChat })
      }
    );
    activeJob = payload;
    renderHarness(activeHarness, activeJob);
    updatePendingResponse(activeJob);
    showNotice(payload.cancellation_interaction_error
      ? 'Stopping the turn. The cancellation could not be added to AI context.'
      : 'Stopping the turn. Partial output and provenance will be preserved.');
  } catch (error) {
    showNotice(error.message);
    activeJob = job;
    updateJobControls(job);
  }
}

async function sendCurrentMessage() {
  const message = elements.chatInput.value;
  if (!message.trim() || chatBusy || stateBusy || !stateReady) return;
  setChatBusy(true, 'Planning');
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';
  renderPendingMessage(message);
  setHarnessTab('activity');
  try {
    if (!selectedChat) await createConversation();
    const { response, payload } = await fetchJson(
      '/api/chats/' + encodeURIComponent(selectedChat) + '/messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
        body: JSON.stringify({ message, async: true })
      }
    );
    if (response.status === 202) {
      activeJob = payload;
      setChatBusy(true, 'Harness running');
      renderHarness(activeHarness, activeJob);
      updatePendingResponse(activeJob);
      const finished = await pollJob(payload.job_id);
      if (finished.status === 'failed') {
        throw new Error(finished.error?.message ?? 'The recorded research turn failed.');
      }
      if (finished.status === 'cancelled') {
        showNotice('Turn stopped. Partial output and its provenance were preserved.');
      }
    }
    await loadState(false, true);
    await selectChat(selectedChat, { force: true });
  } catch (error) {
    showNotice(error.message);
    if (selectedChat) {
      try { await selectChat(selectedChat, { force: true }); } catch { /* preserve the original error */ }
    } else {
      renderConversation();
    }
  } finally {
    activeJob = null;
    setChatBusy(false);
    elements.chatInput.focus();
  }
}

async function loadState(refresh = false, preserveSelection = false) {
  setConnection('loading', 'Loading');
  setStateBusy(true);
  try {
    const { payload } = await fetchJson('/api/state' + (refresh ? '?refresh=1' : ''));
    labState = payload;
    stateReady = true;
    stateCurrent = true;
    elements.version.textContent = labState.sciencecode_version ?? 'unknown';
    const resumedInference = labState.inference_jobs?.find((job) =>
      ACTIVE_JOB_STATUSES.has(job.status)
    );
    if (resumedInference) {
      activeInferenceJob = resumedInference;
      ensureInferencePolling(resumedInference);
    }
    resumeScientificComputeJob({
      state: labState,
      request: fetchJson,
      notify: showNotice,
      refreshState: () => loadState(false, true),
      rerender: (jobKind) => renderArchive(
        jobKind === 'experiment' ? 'experiments' : 'simulations'
      ),
      isActive: (jobKind) => activeView ===
        (jobKind === 'experiment' ? 'experiments' : 'simulations'),
      openRecord: (jobKind, recordId) => {
        const item = jobKind === 'experiment'
          ? labState?.experiments?.find((record) => record.experiment_id === recordId)
          : labState?.simulations?.find((record) => record.simulation_id === recordId);
        if (item) {
          if (jobKind === 'experiment') showExperimentDetail(item);
          else showSimulationDetail(item);
        }
      }
    });
    renderSidebar();
    setIntegrityConnection();
    if (!preserveSelection && !draftConversation) {
      const exists = labState.chats.some((chat) => chat.chat_id === selectedChat);
      selectedChat = exists ? selectedChat : labState.chats[0]?.chat_id ?? null;
    }
    if (!selectedChat) {
      renderConversation();
      emptyHarness();
    }
    return true;
  } catch (error) {
    stateCurrent = false;
    setConnection('error', 'Offline');
    if (!stateReady) renderInitialStateFailure(error.message);
    showNotice(error.message);
    return false;
  } finally {
    setStateBusy(false);
  }
}

elements.refresh.addEventListener('click', async () => {
  const loaded = await loadState(true, true);
  if (!loaded) return;
  if (selectedChat) await selectChat(selectedChat);
  if (activeView === 'lineage') await renderLineageWorkspace(selectedChat);
  else if (activeView !== 'chat') renderArchive(activeView);
});
elements.newChat.addEventListener('click', beginNewConversation);
elements.stop.addEventListener('click', cancelActiveJob);
elements.backToChat.addEventListener('click', () => showView('chat', { focus: true }));
elements.chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendCurrentMessage();
});
elements.chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendCurrentMessage();
  }
});
elements.chatInput.addEventListener('input', () => {
  elements.chatInput.style.height = 'auto';
  elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 190) + 'px';
});
for (const button of elements.starterActions.querySelectorAll('[data-prompt]')) {
  button.addEventListener('click', () => {
    elements.chatInput.value = button.dataset.prompt;
    elements.chatInput.dispatchEvent(new Event('input'));
    elements.chatInput.focus();
  });
}
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => showView(button.dataset.view, { focus: true }));
}
const harnessTabs = [...document.querySelectorAll('[data-harness-tab]')];
for (const button of harnessTabs) {
  button.addEventListener('click', () => setHarnessTab(button.dataset.harnessTab));
  button.addEventListener('keydown', (event) => {
    const index = harnessTabs.indexOf(button);
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = harnessTabs[(index + 1) % harnessTabs.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = harnessTabs[(index - 1 + harnessTabs.length) % harnessTabs.length];
    } else if (event.key === 'Home') {
      next = harnessTabs[0];
    } else if (event.key === 'End') {
      next = harnessTabs[harnessTabs.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    setHarnessTab(next.dataset.harnessTab);
    next.focus();
  });
}

const loaded = await loadState();
if (loaded && stateReady) {
  if (selectedChat) await selectChat(selectedChat);
  else beginNewConversation();
}
