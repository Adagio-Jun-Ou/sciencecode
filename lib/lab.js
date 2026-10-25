import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { VERSION } from './constants.js';
import { httpStatusForError } from './error-semantics.js';
import {
  MAX_ANALYSIS_SPEC_BYTES,
  analysisContractInteractionArtifact,
  analysisContractInteractionPayload,
  createAnalysisContract,
  getAnalysisContract,
  listAnalysisContracts
} from './analysis-contracts.js';
import { computeStatus } from './compute.js';
import {
  getLiteratureRecord,
  importLiteratureResponse,
  listLiteratureRecords,
  literatureInteractionArtifact,
  literatureInteractionPayload,
  verifyLiteratureRecord
} from './literature.js';
import { createAuditCache, verifyAudit, withAuditCache } from './audit.js';
import {
  MAX_CAMPAIGN_SPEC_BYTES,
  abandonCampaignTask,
  campaignInteractionArtifact,
  campaignInteractionPayload,
  createCampaign,
  getCampaign,
  listCampaigns,
  recordCampaignDecision,
  recordHypothesisAssessment,
  runCampaignTaskAsync,
  stopCampaign
} from './campaigns.js';
import {
  MAX_CAD_FILE_BYTES,
  buildCadProject,
  cadInteractionArtifact,
  cadInteractionPayload,
  detectCadToolchain,
  getCadBuild,
  getCadProject,
  getCadSimulation,
  getCadSlice,
  initializeCadProject,
  listCadBuilds,
  listCadProjects,
  listCadSimulations,
  listCadSlices,
  readCadFile,
  resolveCadArtifact,
  simulateCadBuild,
  sliceCadBuild,
  verifyCadBuild,
  verifyCadSimulation,
  verifyCadSlice,
  writeCadFile
} from './cad.js';
import {
  createChatSession,
  getChatSession,
  listChats,
  sendChatMessage,
  sendChatMessageAsync,
  verifyChat
} from './chats.js';
import {
  confirmatoryAssessmentInteractionArtifact,
  confirmatoryAssessmentInteractionPayload,
  createConfirmatoryAssessment,
  getConfirmatoryAssessment,
  listConfirmatoryAssessments
} from './confirmatory.js';
import { buildHarnessView } from './harness.js';
import {
  getEvidencePage,
  getEvidenceRecord,
  ingestEvidence,
  listEvidence,
  resolveEvidenceSourceFile,
  searchEvidence
} from './evidence.js';
import {
  listInteractions,
  recordInteraction,
  verifyInteractions
} from './interactions.js';
import {
  createFigureComparison,
  figureComparisonInteractionArtifact,
  figureComparisonInteractionPayload,
  getFigureComparison,
  listFigureComparisons,
  resolveFigureComparisonArtifact
} from './figure-comparisons.js';
import {
  createFigureRegistration,
  figureRegistrationInteractionArtifact,
  figureRegistrationInteractionPayload,
  getFigureRegistration,
  listFigureRegistrations,
  normalizeFigureRegistrationSpec,
  resolveFigureRegistrationArtifact
} from './figure-registrations.js';
import {
  createFigureVisual,
  figureVisualInteractionArtifact,
  figureVisualInteractionPayload,
  getFigureVisual,
  listFigureVisuals,
  MAX_FIGURE_VISUAL_SPEC_BYTES,
  normalizeFigureVisualSpec,
  resolveFigureVisualArtifact
} from './figure-visuals.js';
import { buildLineageGraph } from './lineage.js';
import {
  MAX_ARTIFACT_REVISION_BYTES,
  createArtifactRevision,
  decideArtifactRevision,
  getArtifactRevision,
  listArtifactRevisions,
  resolveArtifactRevision,
  revisionInteractionArtifact,
  revisionInteractionPayload
} from './revisions.js';
import {
  createSemanticReview,
  getSemanticReview,
  listSemanticReviews,
  semanticReviewInteractionArtifact,
  semanticReviewInteractionPayload
} from './reviews.js';
import {
  createKernelManager,
  getKernelCell,
  getKernelRecord,
  listKernels,
  resolveKernelArtifact,
  verifyKernelCell
} from './kernels.js';
import {
  buildExperimentBranches,
  getExperimentManifest,
  listExperiments,
  resolveExperimentDirectory,
  runExperimentAsync,
  verifyExperiment
} from './experiments.js';
import {
  getInferenceManifest,
  listInferences,
  resolveInferenceDirectory,
  runInferenceAsync,
  verifyInference
} from './inferences.js';
import { publicOpenCodeEvent } from './events.js';
import {
  createFileHashCache,
  preloadFileHashCache,
  withFileHashCache
} from './hash.js';
import { runCommand } from './process.js';
import {
  PROJECT_GATE_POLICIES,
  PROJECT_GATE_SCHEMA_VERSION,
  normalizeProjectGatePolicy
} from './project-gate.js';
import {
  PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION,
  commitProjectSnapshotPending,
  countProjectSnapshots,
  discardProjectSnapshotPending,
  listProjectSnapshots,
  makeProjectSnapshotId,
  normalizeProjectSnapshotId,
  resolveProjectSnapshotFile
} from './project-snapshots.js';
import {
  getSimulationManifest,
  initializeSimulationTemplate,
  listSimulations,
  resolveSimulationDirectory,
  runSimulationAsync,
  verifySimulation
} from './simulations.js';
import {
  MAX_PREREGISTRATION_BYTES,
  MAX_PREREGISTRATION_NAME_CHARS,
  freezePreregistrationContent,
  getPreregistration,
  listPreregistrations,
  preregistrationInteractionArtifact,
  preregistrationInteractionPayload,
  resolvePreregistrationArtifact,
  verifyPreregistration
} from './preregistration.js';
import {
  MAX_PROCEDURE_SPEC_BYTES,
  createProcedure,
  createProcedureAssessment,
  createProcedureDecision,
  getProcedure,
  getProcedureAssessment,
  getProcedureDecision,
  listProcedureAssessments,
  listProcedureDecisions,
  listProcedures,
  procedureAssessmentInteractionArtifact,
  procedureAssessmentInteractionPayload,
  procedureDecisionInteractionArtifact,
  procedureDecisionInteractionPayload,
  procedureInteractionArtifact,
  procedureInteractionPayload
} from './procedures.js';
import { redactText, scanSecrets } from './security.js';
import {
  INTERNAL_DIR,
  isPathInside,
  readJson,
  relativePortable,
  resolveInsideRoot
} from './storage.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const STATIC_ASSETS = new Set([
  'index.html', 'app.js', 'campaign.js', 'campaign.css', 'chemistry.js', 'genomics.js',
  'cad.js', 'cad.css', 'compute.js', 'geometry.js', 'lineage.js', 'manuscript.js',
  'preregistration.js', 'procedure.js', 'reproducibility.js', 'styles.css', 'verification.js',
  'visualization.js', 'xlsx.js'
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.bed', 'text/tab-separated-values; charset=utf-8'],
  ['.bedgraph', 'text/tab-separated-values; charset=utf-8'],
  ['.bdg', 'text/tab-separated-values; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gcode', 'text/x.gcode; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.log', 'text/plain; charset=utf-8'],
  ['.fa', 'text/plain; charset=utf-8'],
  ['.faa', 'text/plain; charset=utf-8'],
  ['.fasta', 'text/plain; charset=utf-8'],
  ['.ffn', 'text/plain; charset=utf-8'],
  ['.fna', 'text/plain; charset=utf-8'],
  ['.gff', 'text/tab-separated-values; charset=utf-8'],
  ['.gff3', 'text/tab-separated-values; charset=utf-8'],
  ['.gtf', 'text/tab-separated-values; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.markdown', 'text/markdown; charset=utf-8'],
  ['.mdx', 'text/markdown; charset=utf-8'],
  ['.mol', 'chemical/x-mdl-molfile; charset=utf-8'],
  ['.npz', 'application/octet-stream'],
  ['.obj', 'model/obj; charset=utf-8'],
  ['.pdb', 'chemical/x-pdb; charset=utf-8'],
  ['.ply', 'model/ply; charset=utf-8'],
  ['.png', 'image/png'],
  ['.pdf', 'application/pdf'],
  ['.py', 'text/x-python; charset=utf-8'],
  ['.r', 'text/plain; charset=utf-8'],
  ['.rst', 'text/x-rst; charset=utf-8'],
  ['.sdf', 'chemical/x-mdl-sdfile; charset=utf-8'],
  ['.scad', 'text/plain; charset=utf-8'],
  ['.smi', 'chemical/x-daylight-smiles; charset=utf-8'],
  ['.smiles', 'chemical/x-daylight-smiles; charset=utf-8'],
  ['.tex', 'application/x-tex; charset=utf-8'],
  ['.stl', 'model/stl; charset=utf-8'],
  ['.3mf', 'model/3mf'],
  ['.ts', 'text/plain; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.vcf', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.xdl', 'application/xml; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xyz', 'chemical/x-xyz; charset=utf-8'],
  ['.yaml', 'application/yaml; charset=utf-8'],
  ['.yml', 'application/yaml; charset=utf-8']
]);
const INTERACTIVE_TEXT_EXTENSIONS = new Set([
  '.bdg', '.bed', '.bedgraph', '.csv', '.fa', '.faa', '.fasta', '.ffn', '.fna',
  '.gff', '.gff3', '.gtf', '.json', '.log', '.markdown', '.md', '.mdx', '.mol',
  '.obj', '.pdb', '.ply', '.py', '.r', '.rst', '.sdf', '.smi', '.smiles', '.tex',
  '.ts', '.txt', '.vcf', '.xdl', '.xlsx', '.xml', '.xyz', '.yaml', '.yml'
]);

const DEFAULT_CHAT_PROVIDER = {
  list({ cwd }) {
    return listChats(cwd);
  },
  create({ cwd, title, agent }) {
    const created = createChatSession({ cwd, title, agent });
    return {
      manifest: created.manifest,
      turns: [],
      verification: verifyChat(cwd, created.manifest.chat_id)
    };
  },
  get({ cwd, chatId }) {
    return {
      ...getChatSession(cwd, chatId),
      verification: verifyChat(cwd, chatId)
    };
  },
  send(options) {
    return sendChatMessage(options);
  },
  sendAsync(options) {
    return sendChatMessageAsync(options);
  }
};

const DEFAULT_KERNEL_PROVIDER = {
  list({ cwd }) {
    return listKernels(cwd).map((record) => ({
      ...record,
      available: null,
      recorded: true,
      recorded_execution_count: record.execution_count,
      live: false,
      busy: false,
      state_mode: 'unloaded',
      restored_through: 0,
      history_loaded: false
    }));
  }
};

const DEFAULT_INFERENCE_PROVIDER = {
  run(options) {
    return runInferenceAsync(options);
  }
};

const DEFAULT_SIMULATION_PROVIDER = {
  run(options) {
    return runSimulationAsync(options);
  }
};

const DEFAULT_EXPERIMENT_PROVIDER = {
  run(options) {
    return runExperimentAsync(options);
  }
};

const DEFAULT_CAMPAIGN_PROVIDER = {
  list({ cwd, chatId }) {
    return listCampaigns(cwd, { chatId });
  },
  get({ cwd, campaignId }) {
    return getCampaign(cwd, campaignId);
  },
  create(options) {
    return createCampaign(options);
  },
  decide(options) {
    return recordCampaignDecision(options);
  },
  assess(options) {
    return recordHypothesisAssessment(options);
  },
  stop(options) {
    return stopCampaign(options);
  },
  abandon(options) {
    return abandonCampaignTask(options);
  },
  runAsync(options) {
    return runCampaignTaskAsync(options);
  }
};

const MAX_LAB_JOBS = 64;
const MAX_JOB_EVENTS = 240;
const MAX_CAD_STUDY_WALL_CLOCK_MS = 24 * 60 * 60 * 1_000;
const MAX_LIVE_RESPONSE_BLOCKS = 32;
const MAX_LIVE_RESPONSE_BYTES = 48 * 1024;
const MAX_PROJECT_GATE_WORKER_BYTES = 4 * 1024 * 1024;
const PROJECT_GATE_TIMEOUT_MS = 5 * 60_000;
const MAX_PROJECT_SNAPSHOT_WORKER_BYTES = 4 * 1024 * 1024;
const PROJECT_SNAPSHOT_TIMEOUT_MS = 5 * 60_000;
const COMPUTE_CACHE_TTL_MS = 5 * 60_000;
const LAB_KEEP_ALIVE_TIMEOUT_MS = 65_000;
const LAB_HEADERS_TIMEOUT_MS = 70_000;
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancelling']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function labStateFingerprint(project) {
  const hash = crypto.createHash('sha256');
  const files = [];
  let cacheable = true;
  const visit = (root, relative = '') => {
    const target = relative ? path.join(root, relative) : root;
    const stat = fs.lstatSync(target, { bigint: true, throwIfNoEntry: false });
    const portable = relativePortable(project, target);
    if (!stat) {
      hash.update(JSON.stringify([portable, 'missing']) + '\n');
      return;
    }
    if (stat.isSymbolicLink()) cacheable = false;
    hash.update(JSON.stringify([
      portable,
      stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
      String(stat.dev),
      String(stat.ino),
      String(stat.mode),
      String(stat.size),
      String(stat.mtimeNs),
      String(stat.ctimeNs)
    ]) + '\n');
    if (!stat.isDirectory()) {
      if (stat.isFile()) files.push(target);
      return;
    }
    const entries = fs.readdirSync(target, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visit(root, relative ? path.join(relative, entry.name) : entry.name);
    }
  };
  visit(path.join(project, INTERNAL_DIR));
  visit(path.join(project, 'cad'));
  return {
    fingerprint: cacheable ? hash.digest('hex') : null,
    files: cacheable ? files : []
  };
}

function makeJobId() {
  return 'job-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function publicJobResponse(job) {
  const blocks = (job.response_blocks ?? []).map((block) => ({
    sequence: block.sequence,
    timestamp: block.timestamp,
    content: block.content,
    content_bytes: block.content_bytes,
    truncated: block.truncated,
    ...(block.part_id ? { part_id: block.part_id } : {}),
    ...(block.message_id ? { message_id: block.message_id } : {})
  }));
  return {
    transport: 'opencode_json_text_parts',
    granularity: 'completed_text_block',
    token_streaming: false,
    complete: TERMINAL_JOB_STATUSES.has(job.status),
    received_block_count: job.response_received_blocks ?? 0,
    retained_block_count: blocks.length,
    retained_bytes: job.response_retained_bytes ?? 0,
    omitted_block_count: job.response_omitted_blocks ?? 0,
    omitted_bytes: job.response_omitted_bytes ?? 0,
    truncated: Boolean(
      job.response_omitted_blocks ||
      blocks.some((block) => block.truncated)
    ),
    blocks
  };
}

function publicJob(job) {
  return {
    job_id: job.job_id,
    kind: job.kind ?? 'chat',
    chat_id: job.chat_id ?? null,
    inference_id: job.inference_id ?? null,
    campaign_id: job.campaign_id ?? null,
    task_id: job.task_id ?? null,
    operation: job.operation ?? null,
    cad_project_id: job.cad_project_id ?? null,
    build_id: job.build_id ?? null,
    simulation_id: job.simulation_id ?? null,
    experiment_id: job.experiment_id ?? null,
    snapshot_id: job.snapshot_id ?? null,
    slice_id: job.slice_id ?? null,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
    cancel_requested_at: job.cancel_requested_at ?? null,
    cancelled_at: job.cancelled_at ?? null,
    timed_out: job.timed_out === true,
    can_cancel: job.interruptible !== false && ['queued', 'running'].includes(job.status),
    cancellation_interaction_id: job.cancellation_interaction_id ?? null,
    cancellation_interaction_error: job.cancellation_interaction_error ?? null,
    interaction_id: job.interaction_id ?? null,
    interaction_error: job.interaction_error ?? null,
    events: job.events,
    response: ['chat', 'campaign'].includes(job.kind ?? 'chat')
      ? publicJobResponse(job)
      : null,
    request: job.request ?? null,
    result: job.result ?? null,
    error: job.error ?? null
  };
}

function publicProjectGateState(job) {
  if (!job) return null;
  const report = job.result;
  return {
    job_id: job.job_id,
    kind: 'gate',
    operation: 'verify',
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
    can_cancel: job.interruptible !== false &&
      ['queued', 'running'].includes(job.status),
    policy: job.request ?? {},
    result: report ? {
      schema_version: report.schema_version,
      generated_at: report.generated_at,
      ok: report.ok,
      fingerprint: report.fingerprint,
      summary: report.summary,
      anchors: report.anchors
    } : null,
    error: job.error ?? null
  };
}

function publicProjectSnapshotState(job) {
  if (!job) return null;
  const report = job.result;
  return {
    job_id: job.job_id,
    kind: 'snapshot',
    operation: job.operation,
    snapshot_id: job.snapshot_id,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
    can_cancel: job.interruptible !== false &&
      ['queued', 'running'].includes(job.status),
    request: job.request ?? null,
    result: report ? {
      schema_version: report.schema_version,
      operation: report.operation,
      generated_at: report.generated_at,
      ok: report.ok,
      fingerprint: report.fingerprint,
      snapshot: report.snapshot,
      strict: report.strict,
      record_integrity: report.record_integrity,
      workspace: report.workspace,
      summary: report.summary,
      anchors: report.anchors
    } : null,
    error: job.error ?? null
  };
}

function normalizeProjectGateLaunch(body) {
  const allowed = new Set(PROJECT_GATE_POLICIES.map((entry) => entry.request));
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw Object.assign(
      new Error('Unknown project gate request field: ' + unknown[0]),
      { code: 'INVALID_PROJECT_GATE_REQUEST' }
    );
  }
  return normalizeProjectGatePolicy(body).request;
}

function normalizeProjectSnapshotCreate(body) {
  const unknown = Object.keys(body);
  if (unknown.length) {
    throw Object.assign(
      new Error('Unknown project snapshot request field: ' + unknown[0]),
      { code: 'INVALID_PROJECT_SNAPSHOT_REQUEST' }
    );
  }
  return {};
}

function normalizeProjectSnapshotVerification(body) {
  const unknown = Object.keys(body).filter((name) => name !== 'strict');
  if (unknown.length ||
      (Object.hasOwn(body, 'strict') && typeof body.strict !== 'boolean')) {
    throw Object.assign(
      new Error(unknown.length
        ? 'Unknown project snapshot verification field: ' + unknown[0]
        : 'Project snapshot strict mode must be a boolean.'),
      { code: 'INVALID_PROJECT_SNAPSHOT_REQUEST' }
    );
  }
  return { strict: body.strict !== false };
}

function normalizeInferenceLaunch(body) {
  const allowed = new Set([
    'mode', 'model', 'input', 'device', 'allow_fallback', 'warmup_iterations',
    'iterations', 'timeout_seconds', 'chat_id', 'note'
  ]);
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw Object.assign(new Error('Unknown inference request field: ' + unknown[0]), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  const mode = body.mode ?? 'smoke';
  const device = body.device ?? 'npu';
  const allowFallback = body.allow_fallback ?? false;
  const warmup = body.warmup_iterations ?? 1;
  const iterations = body.iterations ?? 3;
  const timeoutSeconds = body.timeout_seconds ?? 900;
  if (!['smoke', 'run'].includes(mode)) {
    throw Object.assign(new Error('Inference mode must be smoke or run.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if (!['npu', 'cpu', 'auto'].includes(device)) {
    throw Object.assign(new Error('Inference device must be npu, cpu, or auto.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if (typeof allowFallback !== 'boolean') {
    throw Object.assign(new Error('allow_fallback must be a boolean.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if (!Number.isSafeInteger(warmup) || warmup < 0 || warmup > 1_000) {
    throw Object.assign(new Error('warmup_iterations must be from 0 through 1000.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1_000) {
    throw Object.assign(new Error('iterations must be from 1 through 1000.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86_400) {
    throw Object.assign(new Error('timeout_seconds must be from 1 through 86400.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  for (const field of ['model', 'input', 'chat_id', 'note']) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      typeof body[field] !== 'string'
    ) {
      throw Object.assign(new Error(field + ' must be a string when provided.'), {
        code: 'INVALID_INFERENCE_REQUEST'
      });
    }
  }
  const model = typeof body.model === 'string' ? body.model.trim() : null;
  const input = typeof body.input === 'string' ? body.input.trim() : null;
  if (mode === 'run' && (!model || !input)) {
    throw Object.assign(new Error('Model and input project paths are required for inference run mode.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if (mode === 'smoke' && (model || input)) {
    throw Object.assign(new Error('Smoke mode generates its own model and input.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  if ((model && model.length > 4_096) || (input && input.length > 4_096)) {
    throw Object.assign(new Error('Inference project paths are limited to 4096 characters.'), {
      code: 'INVALID_INFERENCE_REQUEST'
    });
  }
  const chatId = body.chat_id === undefined || body.chat_id === null || body.chat_id === ''
    ? null
    : body.chat_id;
  const note = body.note === undefined || body.note === null ? null : body.note.trim();
  if (note && (note.length > 2_000 || scanSecrets(note).length)) {
    throw Object.assign(new Error(note.length > 2_000
      ? 'Inference direction is limited to 2000 characters.'
      : 'Potential secret detected in inference direction.'), {
      code: note.length > 2_000 ? 'INVALID_INFERENCE_REQUEST' : 'SECRET_DETECTED'
    });
  }
  return {
    mode,
    smoke: mode === 'smoke',
    model,
    input,
    device,
    allowFallback,
    warmup,
    iterations,
    timeoutMs: timeoutSeconds * 1_000,
    timeoutSeconds,
    chatId,
    note
  };
}

function normalizeScientificComputeLaunch(body, kind) {
  const experiment = kind === 'experiment';
  const code = experiment ? 'INVALID_EXPERIMENT_REQUEST' : 'INVALID_SIMULATION_REQUEST';
  const fail = (message) => {
    throw Object.assign(new Error(message), { code });
  };
  const allowed = new Set([
    'script', 'device', 'timeout_seconds', 'parameters', 'script_arguments',
    'inputs', 'cad_build_id', 'chat_id', 'note',
    ...(experiment
      ? ['name', 'hypothesis', 'seeds', 'variations', 'analysis_contract_id']
      : ['seed'])
  ]);
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) fail('Unknown ' + kind + ' request field: ' + unknown[0]);

  const text = (name, { required = false, maximum = 4_096 } = {}) => {
    const value = body[name];
    if (value === undefined || value === null || value === '') {
      if (required) fail(name + ' is required.');
      return null;
    }
    if (typeof value !== 'string') fail(name + ' must be a string.');
    const normalized = value.trim();
    if ((required && !normalized) || normalized.length > maximum) {
      fail(name + ' must contain ' + (required ? '1 to ' : 'at most ') +
        maximum + ' characters.');
    }
    return normalized || null;
  };
  const boundedStrings = (name, maximumItems) => {
    const values = body[name] ?? [];
    if (!Array.isArray(values) || values.length > maximumItems ||
        values.some((value) => typeof value !== 'string' || value.length > 4_096)) {
      fail(name + ' must contain at most ' + maximumItems +
        ' strings, each at most 4096 characters.');
    }
    return values;
  };
  const object = (name) => {
    const value = body[name] ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(name + ' must be a JSON object.');
    }
    return value;
  };

  const script = text('script', { required: true });
  const device = body.device ?? 'auto';
  if (typeof device !== 'string' || !/^(?:auto|cpu|cuda(?::\d+)?)$/.test(device)) {
    fail('device must be auto, cpu, cuda, or cuda:N.');
  }
  const timeoutSeconds = body.timeout_seconds ?? 3_600;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 ||
      timeoutSeconds > 86_400) {
    fail('timeout_seconds must be an integer from 1 through 86400.');
  }
  const parameters = object('parameters');
  const variations = experiment ? object('variations') : {};
  const parameterNames = [...Object.keys(parameters), ...Object.keys(variations)];
  if (parameterNames.length > 128 || parameterNames.some((name) =>
    !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name) ||
    ['__proto__', 'prototype', 'constructor'].includes(name))) {
    fail('parameters may contain at most 128 safe named values.');
  }
  const scriptArgs = boundedStrings('script_arguments', 128);
  const inputs = boundedStrings('inputs', 64);
  const chatId = text('chat_id', { maximum: 160 });
  const note = text('note', { maximum: 2_000 });
  const cadBuildId = text('cad_build_id', { maximum: 160 });
  const seed = experiment ? null : body.seed ?? 0;
  if (!experiment && (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    fail('seed must be an integer from 0 through 4294967295.');
  }
  const seeds = experiment ? body.seeds ?? [0] : [seed];
  let branches = null;
  if (experiment) {
    try {
      branches = buildExperimentBranches({ seeds, parameters, variations });
    } catch (error) {
      fail(error.message);
    }
  }
  const name = experiment ? text('name', { maximum: 200 }) : null;
  const hypothesis = experiment ? text('hypothesis', { maximum: 4_000 }) : null;
  const analysisContractId = experiment
    ? text('analysis_contract_id', { maximum: 160 })
    : null;
  let persisted;
  try {
    persisted = JSON.stringify({
      script,
      device,
      seed,
      seeds,
      parameters,
      variations,
      script_arguments: scriptArgs,
      inputs,
      name,
      hypothesis,
      analysis_contract_id: analysisContractId,
      cad_build_id: cadBuildId
    });
  } catch (error) {
    fail('Compute configuration must be JSON serializable: ' + error.message);
  }
  if (Buffer.byteLength(persisted) > 64 * 1024) {
    fail('Compute parameters, variations, arguments, and inputs are limited to 64 KiB.');
  }
  const findings = scanSecrets(persisted + '\n' + (note ?? ''));
  if (findings.length) {
    throw Object.assign(new Error(
      'Potential secret detected in ' + kind + ' inputs; refusing to persist it.'
    ), { code: 'SECRET_DETECTED', findings });
  }
  return {
    script,
    device,
    seed,
    seeds,
    timeoutMs: timeoutSeconds * 1_000,
    timeoutSeconds,
    parameters,
    variations,
    scriptArgs,
    inputs,
    name,
    hypothesis,
    analysisContractId,
    cadBuildId,
    branchCount: experiment ? branches.length : 1,
    chatId,
    note
  };
}

function campaignRequest(body, operation) {
  const allowedByOperation = {
    create: new Set(['spec', 'chat_id', 'note']),
    decide: new Set(['task_id', 'decision', 'note']),
    assess: new Set(['verdict', 'decision', 'rationale', 'task_ids']),
    advance: new Set(['task_id']),
    stop: new Set(['reason']),
    abandon: new Set(['task_id', 'reason'])
  };
  const allowed = allowedByOperation[operation];
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw Object.assign(
      new Error('Unknown campaign ' + operation + ' field: ' + unknown[0]),
      { code: 'INVALID_CAMPAIGN' }
    );
  }
  const text = (name, { required = false, maximum = 2_000 } = {}) => {
    const value = body[name];
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw Object.assign(new Error(name + ' is required.'), {
          code: 'INVALID_CAMPAIGN'
        });
      }
      return null;
    }
    if (typeof value !== 'string') {
      throw Object.assign(new Error(name + ' must be a string.'), {
        code: 'INVALID_CAMPAIGN'
      });
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum) {
      throw Object.assign(
        new Error(name + ' must contain 1 to ' + maximum + ' characters.'),
        { code: 'INVALID_CAMPAIGN' }
      );
    }
    const findings = scanSecrets(normalized);
    if (findings.length) {
      throw Object.assign(new Error('Potential secret detected in ' + name + '.'), {
        code: 'SECRET_DETECTED',
        findings
      });
    }
    return normalized;
  };
  if (operation === 'create') {
    if (!body.spec || typeof body.spec !== 'object' || Array.isArray(body.spec)) {
      throw Object.assign(new Error('Campaign create requires an object spec.'), {
        code: 'INVALID_CAMPAIGN'
      });
    }
    return {
      spec: body.spec,
      chatId: text('chat_id', { required: true, maximum: 160 }),
      note: text('note')
    };
  }
  if (operation === 'decide') {
    const decision = text('decision', { required: true, maximum: 16 });
    if (!['approved', 'rejected', 'skipped'].includes(decision)) {
      throw Object.assign(
        new Error('decision must be approved, rejected, or skipped.'),
        { code: 'INVALID_CAMPAIGN' }
      );
    }
    return {
      taskId: text('task_id', { required: true, maximum: 48 }),
      decision,
      note: text('note')
    };
  }
  if (operation === 'assess') {
    const verdict = text('verdict', { required: true, maximum: 24 });
    const decision = text('decision', { required: true, maximum: 16 });
    if (!['supported', 'challenged', 'falsified', 'inconclusive'].includes(verdict)) {
      throw Object.assign(new Error(
        'verdict must be supported, challenged, falsified, or inconclusive.'
      ), { code: 'INVALID_CAMPAIGN' });
    }
    if (!['continue', 'pause', 'prune', 'promote'].includes(decision)) {
      throw Object.assign(new Error(
        'decision must be continue, pause, prune, or promote.'
      ), { code: 'INVALID_CAMPAIGN' });
    }
    const taskIds = body.task_ids ?? [];
    if (!Array.isArray(taskIds) || taskIds.length > 32 ||
        new Set(taskIds).size !== taskIds.length ||
        taskIds.some((taskId) =>
          typeof taskId !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(taskId))) {
      throw Object.assign(
        new Error('task_ids must contain up to 32 unique campaign task IDs.'),
        { code: 'INVALID_CAMPAIGN' }
      );
    }
    return {
      verdict,
      decision,
      rationale: text('rationale', { required: true, maximum: 4_000 }),
      taskIds
    };
  }
  if (operation === 'advance') {
    return { taskId: text('task_id', { maximum: 48 }) };
  }
  if (operation === 'stop') {
    return { reason: text('reason', { required: true }) };
  }
  return {
    taskId: text('task_id', { required: true, maximum: 48 }),
    reason: text('reason', { required: true })
  };
}

function cadRequest(body, operation) {
  const allowedByOperation = {
    create: new Set(['name', 'cad_project_id', 'engine', 'chat_id', 'note']),
    write: new Set(['content', 'expected_sha256', 'actor', 'chat_id', 'note']),
    build: new Set(['timeout_seconds', 'chat_id', 'note']),
    simulate: new Set([
      'density_g_cm3', 'maximum_severe_overhang_fraction', 'chat_id', 'note'
    ]),
    model: new Set([
      'script', 'device', 'seed', 'parameters', 'script_args', 'inputs',
      'timeout_seconds', 'minimum_free_gpu_mib', 'chat_id', 'note'
    ]),
    study: new Set([
      'script', 'device', 'seeds', 'parameters', 'variations', 'script_args',
      'inputs', 'name', 'hypothesis', 'timeout_seconds',
      'minimum_free_gpu_mib', 'chat_id', 'note'
    ]),
    slice: new Set([
      'mode', 'profile_path', 'acknowledge_physical_risk', 'settings',
      'timeout_seconds', 'chat_id', 'note'
    ])
  };
  const allowed = allowedByOperation[operation];
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw Object.assign(
      new Error('Unknown CAD ' + operation + ' field: ' + unknown[0]),
      { code: 'INVALID_CAD_REQUEST' }
    );
  }
  const string = (name, { required = false, maximum = 2_000, trim = true } = {}) => {
    const value = body[name];
    if (value === undefined || value === null || value === '') {
      if (required) {
        throw Object.assign(new Error(name + ' is required.'), {
          code: 'INVALID_CAD_REQUEST'
        });
      }
      return null;
    }
    if (typeof value !== 'string') {
      throw Object.assign(new Error(name + ' must be a string.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    const normalized = trim ? value.trim() : value;
    if ((required && !normalized) || normalized.length > maximum) {
      throw Object.assign(new Error(name + ' exceeds its bounded length.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    return normalized;
  };
  const chatId = string('chat_id', { maximum: 160 });
  const note = string('note');
  if (note && scanSecrets(note).length) {
    throw Object.assign(new Error('Potential secret detected in CAD direction.'), {
      code: 'SECRET_DETECTED'
    });
  }
  if (operation === 'create') {
    const engine = string('engine', { maximum: 24 }) ?? 'openscad';
    if (!['openscad', 'cadquery'].includes(engine)) {
      throw Object.assign(new Error('engine must be openscad or cadquery.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    return {
      name: string('name', { maximum: 240 }) ?? 'Parametric assembly',
      cadProjectId: string('cad_project_id', { maximum: 80 }),
      engine,
      chatId,
      note
    };
  }
  if (operation === 'write') {
    if (typeof body.content !== 'string') {
      throw Object.assign(new Error('content must be a string.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    if (body.content.length > MAX_CAD_FILE_BYTES ||
        Buffer.byteLength(body.content) > MAX_CAD_FILE_BYTES) {
      throw Object.assign(new Error('content exceeds its bounded length.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    return {
      content: body.content,
      expectedSha256: string('expected_sha256', { maximum: 64 }),
      actor: string('actor', { maximum: 80 }) ?? 'lab-user',
      chatId,
      note
    };
  }
  const isModelOperation = operation === 'model' || operation === 'study';
  const timeoutSeconds = body.timeout_seconds ?? (isModelOperation ? 3_600 : 300);
  const maximumTimeout = isModelOperation ? 86_400 : 1_800;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 ||
      timeoutSeconds > maximumTimeout) {
    throw Object.assign(new Error(
      'timeout_seconds must be an integer from 1 through ' + maximumTimeout + '.'
    ), {
      code: 'INVALID_CAD_REQUEST'
    });
  }
  if (operation === 'build') {
    return { timeoutMs: timeoutSeconds * 1_000, chatId, note };
  }
  if (operation === 'simulate') {
    for (const name of ['density_g_cm3', 'maximum_severe_overhang_fraction']) {
      if (body[name] !== undefined && !Number.isFinite(body[name])) {
        throw Object.assign(new Error(name + ' must be a finite number.'), {
          code: 'INVALID_CAD_REQUEST'
        });
      }
    }
    return {
      densityGcm3: body.density_g_cm3,
      maximumSevereOverhangFraction: body.maximum_severe_overhang_fraction,
      chatId,
      note
    };
  }
  if (isModelOperation) {
    const device = string('device', { maximum: 24 }) ?? 'cpu';
    if (!/^(?:auto|cpu|cuda(?::\d+)?)$/.test(device)) {
      throw Object.assign(new Error('device must be auto, cpu, cuda, or cuda:N.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    const seed = operation === 'model' ? body.seed ?? 0 : null;
    if (operation === 'model' &&
        (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) {
      throw Object.assign(new Error('seed must be an integer from 0 through 4294967295.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    const parameters = body.parameters ?? {};
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      throw Object.assign(new Error('parameters must be a JSON object.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    const variations = operation === 'study' ? body.variations ?? {} : {};
    if (!variations || typeof variations !== 'object' || Array.isArray(variations)) {
      throw Object.assign(new Error('variations must be a JSON object.'), {
        code: 'INVALID_CAD_REQUEST'
      });
    }
    const parameterNames = [...Object.keys(parameters), ...Object.keys(variations)];
    if (parameterNames.length > 128 ||
        parameterNames.some((name) =>
          !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name) ||
          ['__proto__', 'prototype', 'constructor'].includes(name))) {
      throw Object.assign(new Error(
        'parameters may contain at most 128 safe named values.'
      ), { code: 'INVALID_CAD_REQUEST' });
    }
    const boundedStrings = (name, maximumItems) => {
      const values = body[name] ?? [];
      if (!Array.isArray(values) || values.length > maximumItems ||
          values.some((value) => typeof value !== 'string' || value.length > 4_096)) {
        throw Object.assign(new Error(
          name + ' must contain at most ' + maximumItems +
          ' strings, each at most 4096 characters.'
        ), { code: 'INVALID_CAD_REQUEST' });
      }
      return values;
    };
    const scriptArgs = boundedStrings('script_args', 128);
    const inputs = boundedStrings('inputs', 64);
    const minimumFreeGpuMib = body.minimum_free_gpu_mib ?? 2_048;
    if (!Number.isSafeInteger(minimumFreeGpuMib) ||
        minimumFreeGpuMib < 256 || minimumFreeGpuMib > 16_384) {
      throw Object.assign(new Error(
        'minimum_free_gpu_mib must be an integer from 256 through 16384.'
      ), { code: 'INVALID_CAD_REQUEST' });
    }
    const seeds = operation === 'study' ? body.seeds ?? [0] : [seed];
    let branches = null;
    try {
      branches = buildExperimentBranches({ seeds, parameters, variations });
    } catch (error) {
      throw Object.assign(new Error(error.message), { code: 'INVALID_CAD_REQUEST' });
    }
    const name = operation === 'study'
      ? string('name', { maximum: 200 }) ?? 'CAD parameter study'
      : null;
    const hypothesis = operation === 'study'
      ? string('hypothesis', { maximum: 4_000 })
      : null;
    const persisted = JSON.stringify({
      parameters,
      variations,
      seeds,
      script_args: scriptArgs,
      inputs,
      name,
      hypothesis
    });
    if (Buffer.byteLength(persisted) > 64 * 1024) {
      throw Object.assign(new Error(
        'Model or study parameters, arguments, and inputs are limited to 64 KiB.'
      ), { code: 'INVALID_CAD_REQUEST' });
    }
    const findings = scanSecrets(persisted);
    if (findings.length) {
      throw Object.assign(new Error(
        'Potential secret detected in CAD model inputs; refusing to persist it.'
      ), { code: 'SECRET_DETECTED', findings });
    }
    return {
      script: string('script', { required: true, maximum: 1_024 }),
      device,
      seed,
      seeds,
      parameters,
      variations,
      scriptArgs,
      inputs,
      name,
      hypothesis,
      branchCount: branches.length,
      minimumFreeGpuMib,
      timeoutMs: timeoutSeconds * 1_000,
      chatId,
      note
    };
  }
  const mode = body.mode ?? 'preview';
  if (!['preview', 'printer-profile'].includes(mode)) {
    throw Object.assign(new Error('CAD slice mode must be preview or printer-profile.'), {
      code: 'INVALID_CAD_REQUEST'
    });
  }
  if (body.acknowledge_physical_risk !== undefined &&
      typeof body.acknowledge_physical_risk !== 'boolean') {
    throw Object.assign(new Error('acknowledge_physical_risk must be a boolean.'), {
      code: 'INVALID_CAD_REQUEST'
    });
  }
  if (body.settings !== undefined &&
      (!body.settings || typeof body.settings !== 'object' ||
       Array.isArray(body.settings))) {
    throw Object.assign(new Error('CAD slice settings must be an object.'), {
      code: 'INVALID_CAD_REQUEST'
    });
  }
  return {
    mode,
    profilePath: string('profile_path', { maximum: 600 }),
    acknowledgePhysicalRisk: body.acknowledge_physical_risk === true,
    settings: body.settings ?? {},
    timeoutMs: timeoutSeconds * 1_000,
    chatId,
    note
  };
}

function simulationTemplateRequest(body) {
  const allowed = new Set(['chat_id', 'note']);
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw Object.assign(
      new Error('Unknown simulation template request field: ' + unknown[0]),
      { code: 'INVALID_SIMULATION_TEMPLATE_REQUEST' }
    );
  }
  const optionalText = (name, maximum) => {
    const value = body[name];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > maximum) {
      throw Object.assign(
        new Error(name + ' must be a string of at most ' + maximum + ' characters.'),
        { code: 'INVALID_SIMULATION_TEMPLATE_REQUEST' }
      );
    }
    return value.trim();
  };
  const chatId = optionalText('chat_id', 160);
  const note = optionalText('note', 2_000);
  if (note && scanSecrets(note).length) {
    throw Object.assign(new Error('Potential secret detected in template direction.'), {
      code: 'SECRET_DETECTED'
    });
  }
  return { chatId, note };
}

function preregistrationRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Preregistration request must be an object.'), {
      code: 'INVALID_PREREGISTRATION_REQUEST'
    });
  }
  const allowed = new Set(['name', 'content', 'chat_id', 'note']);
  const unknown = Object.keys(body).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw Object.assign(
      new Error('Unknown preregistration request field: ' + unknown[0]),
      { code: 'INVALID_PREREGISTRATION_REQUEST' }
    );
  }
  if (typeof body.name !== 'string' || !body.name.trim() ||
      body.name.trim().length > MAX_PREREGISTRATION_NAME_CHARS) {
    throw Object.assign(
      new Error('name must be a non-empty string of at most ' +
        MAX_PREREGISTRATION_NAME_CHARS + ' characters.'),
      { code: 'INVALID_PREREGISTRATION_REQUEST' }
    );
  }
  if (typeof body.content !== 'string' || !body.content.trim()) {
    throw Object.assign(
      new Error('content must be non-empty Markdown.'),
      { code: 'INVALID_PREREGISTRATION_REQUEST' }
    );
  }
  if (Buffer.byteLength(body.content) > MAX_PREREGISTRATION_BYTES) {
    throw Object.assign(
      new Error('Preregistration content exceeds the ' +
        MAX_PREREGISTRATION_BYTES + '-byte limit.'),
      { code: 'PREREGISTRATION_TOO_LARGE' }
    );
  }
  const optionalText = (name, maximum) => {
    const value = body[name];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
      throw Object.assign(
        new Error(name + ' must be a non-empty string of at most ' + maximum +
          ' characters when provided.'),
        { code: 'INVALID_PREREGISTRATION_REQUEST' }
      );
    }
    return value.trim();
  };
  const chatId = optionalText('chat_id', 160);
  const note = optionalText('note', 2_000);
  if (note && scanSecrets(note).length) {
    throw Object.assign(new Error('Potential secret detected in preregistration direction.'), {
      code: 'SECRET_DETECTED'
    });
  }
  return {
    name: body.name.trim(),
    content: body.content,
    chatId,
    note
  };
}

function responseHeaders(contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value) + '\n';
  response.writeHead(status, {
    ...responseHeaders('application/json; charset=utf-8'),
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, status, message) {
  const body = String(message) + '\n';
  response.writeHead(status, {
    ...responseHeaders('text/plain; charset=utf-8'),
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function errorValue(error) {
  return {
    code: error.code ?? 'LAB_ERROR',
    message: redactText(error.message)
  };
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_REVISION_JSON_BODY_BYTES = Math.ceil(MAX_ARTIFACT_REVISION_BYTES * 4 / 3) + 64 * 1024;
const MAX_ANALYSIS_JSON_BODY_BYTES = MAX_ANALYSIS_SPEC_BYTES + 64 * 1024;
const MAX_PREREGISTRATION_JSON_BODY_BYTES = MAX_PREREGISTRATION_BYTES + 32 * 1024;
const MAX_PROCEDURE_JSON_BODY_BYTES = MAX_PROCEDURE_SPEC_BYTES + 64 * 1024;
const MAX_CAMPAIGN_JSON_BODY_BYTES = MAX_CAMPAIGN_SPEC_BYTES + 64 * 1024;
const MAX_CAD_JSON_BODY_BYTES = MAX_CAD_FILE_BYTES + 128 * 1024;

const LOOPBACK_HOST_HEADER = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

// The Lab only ever binds to loopback, so a request naming any other Host did
// not reach it by a route the user chose. Enforcing this on reads as well as
// writes is what closes DNS rebinding: a rebound page is same-origin to the
// browser, so nothing else on the request distinguishes it.
function untrustedHostError(request) {
  if (LOOPBACK_HOST_HEADER.test(String(request.headers.host ?? ''))) return null;
  return Object.assign(new Error('ScienceCode Lab requires a loopback Host header.'), {
    code: 'UNTRUSTED_CHAT_ORIGIN',
    status: 403
  });
}

function mutationRequestError(request) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return Object.assign(new Error('Lab mutation requests require application/json.'), {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      status: 415
    });
  }
  const hostError = untrustedHostError(request);
  if (hostError) return hostError;
  const host = String(request.headers.host ?? '');
  const origin = request.headers.origin;
  if (origin && origin !== 'http://' + host) {
    return Object.assign(new Error('Cross-origin Lab mutation requests are denied.'), {
      code: 'UNTRUSTED_CHAT_ORIGIN',
      status: 403
    });
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return Object.assign(new Error('Cross-site Lab mutation requests are denied.'), {
      code: 'UNTRUSTED_CHAT_ORIGIN',
      status: 403
    });
  }
  return null;
}

function readJsonRequest(request, maximumBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (overflow) {
        reject(Object.assign(new Error('Lab request body is too large.'), {
          code: 'REQUEST_TOO_LARGE',
          status: 413
        }));
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const value = text ? JSON.parse(text) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('JSON body must be an object.');
        }
        resolve(value);
      } catch (error) {
        reject(Object.assign(new Error('Invalid JSON body: ' + error.message), {
          code: 'INVALID_JSON',
          status: 400
        }));
      }
    });
  });
}

function revisionContent(body) {
  const hasText = typeof body.content === 'string';
  const hasBase64 = typeof body.content_base64 === 'string';
  if (hasText === hasBase64) {
    throw Object.assign(new Error('Revision request requires exactly one of content or content_base64.'), {
      code: 'INVALID_REVISION'
    });
  }
  if (hasText) return body.content;
  const encoded = body.content_base64;
  if (!encoded || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw Object.assign(new Error('Revision content_base64 is malformed.'), {
      code: 'INVALID_REVISION'
    });
  }
  const value = Buffer.from(encoded, 'base64');
  if (value.length > MAX_ARTIFACT_REVISION_BYTES || value.toString('base64') !== encoded) {
    throw Object.assign(new Error(value.length > MAX_ARTIFACT_REVISION_BYTES
      ? 'Revision artifact exceeds the upload limit.'
      : 'Revision content_base64 is not canonical.'), {
      code: value.length > MAX_ARTIFACT_REVISION_BYTES ? 'REVISION_TOO_LARGE' : 'INVALID_REVISION'
    });
  }
  return value;
}

function artifactUrl(simulationId, relative) {
  const segments = String(relative).split('/').map((value) => encodeURIComponent(value));
  return '/artifact/' + encodeURIComponent(simulationId) + '/' + segments.join('/');
}

function experimentArtifactUrl(experimentId, relative) {
  const segments = String(relative).split('/').map((value) => encodeURIComponent(value));
  return '/experiment-artifact/' + encodeURIComponent(experimentId) + '/' + segments.join('/');
}

function inferenceArtifactUrl(inferenceId, relative) {
  const segments = String(relative).split('/').map((value) => encodeURIComponent(value));
  return '/inference-artifact/' + encodeURIComponent(inferenceId) + '/' + segments.join('/');
}

function readSimulationSummary(directory, manifest) {
  if (!manifest.artifacts?.['artifacts/summary.json']) return null;
  try {
    return readJson(path.join(directory, 'artifacts', 'summary.json'));
  } catch {
    return null;
  }
}

function simulationState(cwd, summary) {
  const manifest = getSimulationManifest(cwd, summary.simulation_id);
  const directory = resolveSimulationDirectory(cwd, summary.simulation_id);
  const verification = verifySimulation(cwd, summary.simulation_id);
  const artifacts = Object.entries(manifest.artifacts ?? {})
    .filter(([name]) => name.startsWith('artifacts/'))
    .map(([name, metadata]) => {
      const relative = name.slice('artifacts/'.length);
      const extension = path.extname(relative).toLowerCase();
      return {
        name: relative,
        bytes: metadata.bytes ?? null,
        sha256: metadata.sha256,
        kind: IMAGE_EXTENSIONS.has(extension) ? 'image' : extension === '.json' ? 'json' : 'file',
        url: artifactUrl(summary.simulation_id, relative)
      };
    });
  return {
    simulation_id: summary.simulation_id,
    status: manifest.status,
    verified: verification.ok,
    verification_errors: verification.errors,
    script: manifest.script?.path ?? null,
    started_at: manifest.started_at ?? null,
    finished_at: manifest.finished_at ?? null,
    duration_ms: manifest.duration_ms ?? null,
    exit_code: manifest.exit_code ?? null,
    seed: manifest.seed ?? null,
    device: manifest.context?.device ?? null,
    parameters: manifest.parameters ?? {},
    cad_parent: manifest.cad_parent ?? null,
    runtime: manifest.runtime?.probe ?? null,
    summary: readSimulationSummary(directory, manifest),
    artifacts
  };
}

function inferenceState(cwd, summary) {
  const manifest = getInferenceManifest(cwd, summary.inference_id);
  const verification = verifyInference(cwd, summary.inference_id);
  const artifacts = Object.entries(manifest.artifacts ?? {})
    .filter(([name]) => name.startsWith('artifacts/'))
    .map(([name, metadata]) => {
      const relative = name.slice('artifacts/'.length);
      const extension = path.extname(relative).toLowerCase();
      return {
        name: relative,
        bytes: metadata.bytes ?? null,
        sha256: metadata.sha256,
        kind: extension === '.json' ? 'json' :
          extension === '.onnx' ? 'model' :
            extension === '.npy' ? 'array' : 'file',
        url: inferenceArtifactUrl(summary.inference_id, relative)
      };
    });
  return {
    inference_id: summary.inference_id,
    kind: manifest.kind,
    status: manifest.status,
    verified: verification.ok,
    verification_errors: verification.errors,
    device_request: manifest.device_request,
    fallback_allowed: manifest.fallback_allowed,
    model: manifest.model,
    input: manifest.input,
    started_at: manifest.started_at ?? null,
    finished_at: manifest.finished_at ?? null,
    duration_ms: manifest.duration_ms ?? null,
    runtime: manifest.runtime,
    hardware: manifest.hardware_after ?? manifest.hardware_before ?? null,
    execution: manifest.execution,
    provider_verification: manifest.provider_verification,
    artifacts
  };
}

function experimentState(cwd, summary) {
  const manifest = getExperimentManifest(cwd, summary.experiment_id);
  const directory = resolveExperimentDirectory(cwd, summary.experiment_id);
  const verification = verifyExperiment(cwd, summary.experiment_id);
  const readArtifact = (name) => {
    if (!manifest.artifacts?.[name]) return null;
    try {
      return readJson(path.join(directory, name));
    } catch {
      return null;
    }
  };
  return {
    experiment_id: summary.experiment_id,
    status: manifest.status,
    verified: verification.ok,
    verification_errors: verification.errors,
    name: manifest.name ?? null,
    hypothesis: manifest.hypothesis ?? null,
    cad_parent: manifest.cad_parent ?? null,
    analysis_contract_id: manifest.analysis_contract?.analysis_contract_id ?? null,
    script: manifest.script?.path ?? null,
    started_at: manifest.started_at ?? null,
    finished_at: manifest.finished_at ?? null,
    duration_ms: manifest.duration_ms ?? null,
    cancellation: manifest.cancellation ?? null,
    counts: manifest.counts ?? {},
    review: readArtifact('review.json'),
    results: readArtifact('results.json')?.results ?? [],
    artifacts: Object.entries(manifest.artifacts ?? {}).map(([name, metadata]) => ({
      name,
      bytes: metadata.bytes ?? null,
      sha256: metadata.sha256,
      kind: path.extname(name).toLowerCase() === '.json' ? 'json' : 'file',
      url: experimentArtifactUrl(summary.experiment_id, name)
    }))
  };
}

function cadBuildState(cwd, summary) {
  const verification = verifyCadBuild(cwd, summary.build_id);
  const manifest = verification.manifest ?? summary;
  return {
    build_id: summary.build_id,
    cad_project_id: manifest.cad_project_id ?? summary.cad_project_id ?? null,
    status: manifest.status ?? 'invalid',
    verified: verification.ok,
    verification_errors: verification.errors,
    created_at: manifest.created_at ?? null,
    finished_at: manifest.finished_at ?? null,
    source_sha256: manifest.source_sha256 ?? null,
    engine: manifest.engine ?? 'openscad',
    entry: manifest.entry ?? null,
    toolchain: manifest.toolchain ?? null,
    mesh: manifest.mesh ?? null,
    openscad_summary: manifest.openscad_summary ?? null,
    cadquery_report: manifest.cadquery_report ?? null,
    failure: manifest.failure ?? null,
    artifacts: Object.entries(manifest.artifacts ?? {}).map(([name, descriptor]) => ({
      name,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      url: '/api/cad/artifacts/build/' + encodeURIComponent(summary.build_id) +
        '/' + name.split('/').map(encodeURIComponent).join('/')
    })),
    mesh_url: manifest.status === 'completed' && manifest.artifacts?.['assembly.stl']
      ? '/api/cad/artifacts/build/' + encodeURIComponent(summary.build_id) +
        '/assembly.stl'
      : null,
    interchange_url: manifest.status === 'completed' && manifest.artifacts?.['assembly.step']
      ? '/api/cad/artifacts/build/' + encodeURIComponent(summary.build_id) +
        '/assembly.step'
      : null
  };
}

function cadSimulationState(cwd, summary) {
  const verification = verifyCadSimulation(cwd, summary.simulation_id);
  const manifest = verification.manifest ?? summary;
  return {
    simulation_id: summary.simulation_id,
    cad_project_id: manifest.cad_project_id ?? summary.cad_project_id ?? null,
    build_id: manifest.build_id ?? summary.build_id ?? null,
    status: manifest.status ?? 'invalid',
    verified: verification.ok,
    verification_errors: verification.errors,
    created_at: manifest.created_at ?? null,
    report: manifest.report ?? null,
    url: '/api/cad/simulations/' + encodeURIComponent(summary.simulation_id)
  };
}

function cadSliceState(cwd, summary) {
  const verification = verifyCadSlice(cwd, summary.slice_id);
  const manifest = verification.manifest ?? summary;
  return {
    slice_id: summary.slice_id,
    cad_project_id: manifest.cad_project_id ?? summary.cad_project_id ?? null,
    build_id: manifest.build_id ?? summary.build_id ?? null,
    status: manifest.status ?? 'invalid',
    verified: verification.ok,
    verification_errors: verification.errors,
    created_at: manifest.created_at ?? null,
    mode: manifest.mode ?? null,
    printer_transmission: manifest.printer_transmission ?? 'disabled',
    post_process: manifest.post_process ?? 'disabled',
    profile: manifest.profile ?? null,
    analysis: manifest.analysis ?? null,
    warning: manifest.warning ?? null,
    gcode_url: manifest.artifacts?.['preview.gcode']
      ? '/api/cad/artifacts/slice/' + encodeURIComponent(summary.slice_id) +
        '/preview.gcode'
      : null,
    url: '/api/cad/slices/' + encodeURIComponent(summary.slice_id)
  };
}

function preregistrationState(cwd, summary) {
  const verification = verifyPreregistration(
    cwd, summary.preregistration_id
  );
  return {
    ...summary,
    verified: verification.ok,
    source_status: verification.source_status ?? 'invalid',
    record_sha256: verification.record_sha256 ?? null,
    source_url: '/api/preregistrations/' +
      encodeURIComponent(summary.preregistration_id) + '/source',
    verification_errors: verification.errors ?? []
  };
}

export function buildLabState(options) {
  return withAuditCache(() => withFileHashCache(() => buildLabStateSnapshot(options)));
}

function buildLabStateSnapshot({
  cwd,
  env = process.env,
  computeProvider = computeStatus,
  chatProvider = DEFAULT_CHAT_PROVIDER,
  campaignProvider = DEFAULT_CAMPAIGN_PROVIDER,
  kernelProvider = DEFAULT_KERNEL_PROVIDER
}) {
  const project = path.resolve(cwd);
  let compute;
  try {
    compute = computeProvider({ env });
  } catch (error) {
    compute = { ok: false, error: errorValue(error), gpu: null, runtime: null };
  }
  const simulations = listSimulations(project).map((item) => {
    try {
      return simulationState(project, item);
    } catch (error) {
      return {
        simulation_id: item.simulation_id,
        status: 'invalid',
        verified: false,
        verification_errors: [errorValue(error)],
        artifacts: []
      };
    }
  });
  const cadProjects = listCadProjects(project);
  const cadBuilds = listCadBuilds(project).map((item) => cadBuildState(project, item));
  const cadSimulations = listCadSimulations(project)
    .map((item) => cadSimulationState(project, item));
  const cadSlices = listCadSlices(project).map((item) => cadSliceState(project, item));
  const inferences = listInferences(project).map((item) => {
    try {
      return inferenceState(project, item);
    } catch (error) {
      return {
        inference_id: item.inference_id,
        status: 'invalid',
        verified: false,
        verification_errors: [errorValue(error)],
        provider_verification: {
          npu_executed: false,
          profile_event_counts: {},
          node_counts: {}
        },
        artifacts: []
      };
    }
  });
  const experiments = listExperiments(project).map((item) => {
    try {
      return experimentState(project, item);
    } catch (error) {
      return {
        experiment_id: item.experiment_id,
        status: 'invalid',
        verified: false,
        verification_errors: [errorValue(error)],
        artifacts: [],
        results: []
      };
    }
  });
  let chats;
  try {
    chats = chatProvider.list({ cwd: project });
  } catch (error) {
    chats = [{
      chat_id: 'invalid',
      title: 'Conversation records unavailable',
      status: 'invalid',
      turn_count: 0,
      error: error.message
    }];
  }
  let campaigns;
  try {
    campaigns = campaignProvider.list({ cwd: project });
  } catch (error) {
    campaigns = [{
      campaign_id: 'invalid',
      title: 'Campaign records unavailable',
      status: 'invalid',
      verified: false,
      error: error.message
    }];
  }
  const evidence = listEvidence(project).map((record) => ({
    ...record,
    source_url: '/evidence-source/' + encodeURIComponent(record.evidence_id)
  }));
  let kernels;
  try {
    kernels = kernelProvider.list({ cwd: project });
  } catch (error) {
    kernels = [{
      kernel_id: 'kernel-invalid',
      language: 'unknown',
      available: false,
      recorded: false,
      live: false,
      busy: false,
      error: errorValue(error)
    }];
  }
  let revisions;
  try {
    revisions = listArtifactRevisions(project);
  } catch (error) {
    revisions = [{
      revision_id: 'invalid', status: 'invalid', verified: false,
      errors: [errorValue(error)]
    }];
  }
  let figureComparisons;
  try {
    figureComparisons = listFigureComparisons(project);
  } catch (error) {
    figureComparisons = [{
      figure_comparison_id: 'invalid',
      status: 'invalid',
      reproduction_status: 'invalid',
      verified: false,
      verification_errors: [errorValue(error)],
      summary: {}
    }];
  }
  let figureRegistrations;
  try {
    figureRegistrations = listFigureRegistrations(project);
  } catch (error) {
    figureRegistrations = [{
      figure_registration_id: 'invalid',
      status: 'invalid',
      registration_status: 'invalid',
      verified: false,
      verification_errors: [errorValue(error)],
      summary: {}
    }];
  }
  let figureVisuals;
  try {
    figureVisuals = listFigureVisuals(project);
  } catch (error) {
    figureVisuals = [{
      figure_visual_id: 'invalid',
      status: 'invalid',
      visual_status: 'invalid',
      verified: false,
      verification_errors: [errorValue(error)],
      summary: {}
    }];
  }
  let reviews;
  try {
    reviews = listSemanticReviews(project);
  } catch (error) {
    reviews = [{
      review_id: 'invalid', status: 'invalid', verified: false,
      verification_errors: [errorValue(error)], counts: {}
    }];
  }
  let preregistrations;
  try {
    preregistrations = listPreregistrations(project).map(
      (summary) => preregistrationState(project, summary)
    );
  } catch (error) {
    preregistrations = [{
      preregistration_id: 'invalid',
      status: 'invalid',
      verified: false,
      source_status: 'invalid',
      record_sha256: null,
      source_url: null,
      verification_errors: [errorValue(error)]
    }];
  }
  let analysisContracts;
  try {
    analysisContracts = listAnalysisContracts(project);
  } catch (error) {
    analysisContracts = [{
      analysis_contract_id: 'invalid', status: 'invalid', verified: false,
      errors: [errorValue(error)], counts: {}
    }];
  }
  let confirmatoryAssessments;
  try {
    confirmatoryAssessments = listConfirmatoryAssessments(project);
  } catch (error) {
    confirmatoryAssessments = [{
      analysis_assessment_id: 'invalid', status: 'invalid', verified: false,
      errors: [errorValue(error)], summary: {}
    }];
  }
  let literature;
  try {
    literature = listLiteratureRecords(project);
  } catch (error) {
    literature = [{
      literature_id: 'invalid', source: null, verified: false,
      errors: [errorValue(error)]
    }];
  }
  let procedures;
  try {
    procedures = listProcedures(project);
  } catch (error) {
    procedures = [{
      procedure_id: 'invalid', status: 'invalid', verified: false,
      current: false, errors: [errorValue(error)], counts: {}
    }];
  }
  let procedureAssessments;
  try {
    procedureAssessments = listProcedureAssessments(project);
  } catch (error) {
    procedureAssessments = [{
      procedure_assessment_id: 'invalid', status: 'invalid', verified: false,
      current_for_procedure: false, summary: {}, errors: [errorValue(error)]
    }];
  }
  let procedureDecisions;
  try {
    procedureDecisions = listProcedureDecisions(project);
  } catch (error) {
    procedureDecisions = [{
      procedure_decision_id: 'invalid', status: 'invalid', verified: false,
      current_for_scope: false, effective: false, errors: [errorValue(error)]
    }];
  }
  let projectSnapshotRegistry;
  try {
    projectSnapshotRegistry = countProjectSnapshots(project);
  } catch {
    projectSnapshotRegistry = { count: 0, registry_issues: 1 };
  }
  return {
    sciencecode_version: VERSION,
    generated_at: new Date().toISOString(),
    project: {
      name: path.basename(project),
      path: project
    },
    compute,
    audit: verifyAudit(project),
    counts: {
      simulations: simulations.length,
      cad_projects: cadProjects.length,
      healthy_cad_projects: cadProjects.filter((item) => item.healthy).length,
      cad_builds: cadBuilds.length,
      verified_cad_builds: cadBuilds.filter((item) => item.verified).length,
      completed_cad_builds: cadBuilds.filter((item) =>
        item.status === 'completed').length,
      cad_simulations: cadSimulations.length,
      cad_simulations_needing_attention: cadSimulations.filter((item) =>
        ['review', 'fail'].includes(item.status)).length,
      cad_slices: cadSlices.length,
      safe_preview_slices: cadSlices.filter((item) =>
        item.status === 'completed_preview').length,
      printer_profile_slices: cadSlices.filter((item) =>
        item.mode === 'printer-profile').length,
      verified: simulations.filter((item) => item.verified).length,
      failed: simulations.filter((item) => item.status !== 'completed').length,
      cancelled_simulations: simulations.filter((item) =>
        item.status === 'cancelled').length,
      inferences: inferences.length,
      verified_inferences: inferences.filter((item) => item.verified).length,
      npu_verified_inferences: inferences.filter((item) =>
        item.verified && item.provider_verification?.npu_executed).length,
      failed_inferences: inferences.filter((item) => item.status !== 'completed').length,
      cancelled_inferences: inferences.filter((item) => item.status === 'cancelled').length,
      experiments: experiments.length,
      verified_experiments: experiments.filter((item) => item.verified).length,
      cancelled_experiments: experiments.filter(
        (item) => item.status === 'cancelled'
      ).length,
      evidence: evidence.length,
      verified_evidence: evidence.filter((item) => item.verified).length,
      kernels: kernels.filter((item) => item.recorded).length,
      kernel_cells: kernels.reduce((total, item) => total + (item.recorded_execution_count ?? item.execution_count ?? 0), 0),
      live_kernels: kernels.filter((item) => item.live).length,
      chats: chats.length,
      chat_turns: chats.reduce((total, chat) => total + (chat.turn_count ?? 0), 0),
      campaigns: campaigns.length,
      verified_campaigns: campaigns.filter((item) => item.verified).length,
      active_campaigns: campaigns.filter((item) =>
        ['ready', 'running', 'waiting_checkpoint', 'waiting_hypothesis']
          .includes(item.status)).length,
      completed_campaigns: campaigns.filter((item) =>
        item.status === 'completed').length,
      campaign_tasks_completed: campaigns.reduce((total, item) =>
        total + (item.counts?.completed ?? 0), 0),
      campaign_tasks_failed: campaigns.reduce((total, item) =>
        total + (item.counts?.failed ?? 0), 0),
      campaign_hypotheses: campaigns.reduce((total, item) =>
        total + (item.hypothesis_counts?.total ?? 0), 0),
      assessed_campaign_hypotheses: campaigns.reduce((total, item) =>
        total + (item.hypothesis_counts?.assessed ?? 0), 0),
      current_campaign_hypothesis_assessments: campaigns.reduce((total, item) =>
        total + (item.hypothesis_counts?.assessment_current ?? 0), 0),
      stale_campaign_hypothesis_assessments: campaigns.reduce((total, item) =>
        total + (item.hypothesis_counts?.assessment_stale ?? 0), 0),
      campaign_hypotheses_requiring_assessment: campaigns.reduce((total, item) =>
        total + (item.hypothesis_counts?.assessment_required ?? 0), 0),
      interactions: chats.reduce((total, chat) => {
        try {
          return total + listInteractions(project, chat.chat_id).length;
        } catch {
          return total;
        }
      }, 0),
      artifact_revisions: revisions.length,
      proposed_artifact_revisions: revisions.filter((item) => item.status === 'proposed').length,
      accepted_artifact_revisions: revisions.filter((item) => item.status === 'accepted').length,
      rejected_artifact_revisions: revisions.filter((item) => item.status === 'rejected').length,
      figure_comparisons: figureComparisons.length,
      verified_figure_comparisons: figureComparisons.filter(
        (item) => item.verified
      ).length,
      exact_figure_comparisons: figureComparisons.filter(
        (item) => item.verified && item.reproduction_status === 'exact'
      ).length,
      structural_figure_comparisons: figureComparisons.filter(
        (item) => item.verified &&
          Number.isFinite(item.summary?.minimum_structural_similarity)
      ).length,
      structural_figure_comparisons_passing: figureComparisons.filter(
        (item) => item.verified &&
          item.summary?.structural_similarity_rule_pass === true
      ).length,
      figure_comparisons_needing_attention: figureComparisons.filter(
        (item) => item.verified &&
          ['different', 'incompatible_dimensions'].includes(
            item.reproduction_status
          )
      ).length,
      figure_registrations: figureRegistrations.length,
      verified_figure_registrations: figureRegistrations.filter(
        (item) => item.verified
      ).length,
      matched_figure_registrations: figureRegistrations.filter(
        (item) => item.verified && item.registration_status === 'matched'
      ).length,
      figure_registrations_needing_attention: figureRegistrations.filter(
        (item) => item.verified && item.registration_status === 'mismatch'
      ).length,
      figure_visuals: figureVisuals.length,
      verified_figure_visuals: figureVisuals.filter(
        (item) => item.verified
      ).length,
      conforming_figure_visuals: figureVisuals.filter(
        (item) => item.verified && item.visual_status === 'conforming'
      ).length,
      figure_visuals_needing_attention: figureVisuals.filter(
        (item) => item.verified && item.visual_status === 'nonconforming'
      ).length,
      semantic_reviews: reviews.length,
      current_semantic_reviews: reviews.filter((item) => item.current_for_target).length,
      verified_semantic_reviews: reviews.filter((item) => item.verified).length,
      semantic_reviews_needing_attention: reviews.filter((item) =>
        item.current_for_target && ['review', 'fail'].includes(item.status)).length,
      semantic_review_findings: reviews.reduce(
        (total, item) => total + (item.counts?.findings ?? 0), 0
      ),
      current_semantic_review_findings: reviews.filter((item) => item.current_for_target).reduce(
        (total, item) => total + (item.counts?.findings ?? 0), 0
      ),
      preregistrations: preregistrations.length,
      project_snapshots: projectSnapshotRegistry.count,
      project_snapshot_registry_issues: projectSnapshotRegistry.registry_issues,
      verified_preregistrations: preregistrations.filter(
        (item) => item.verified
      ).length,
      procedures: procedures.length,
      current_procedures: procedures.filter((item) => item.current).length,
      verified_procedures: procedures.filter((item) => item.verified).length,
      procedure_assessments: procedureAssessments.length,
      current_procedure_assessments: procedureAssessments.filter(
        (item) => item.current_for_procedure).length,
      procedures_ready_for_human_review: procedureAssessments.filter(
        (item) => item.current_for_procedure &&
          item.status === 'ready_for_human_review').length,
      procedure_decisions: procedureDecisions.length,
      current_procedure_decisions: procedureDecisions.filter(
        (item) => item.current_for_scope).length,
      effective_procedure_approvals: procedureDecisions.filter(
        (item) => item.effective).length,
      analysis_contracts: analysisContracts.length,
      verified_analysis_contracts: analysisContracts.filter((item) => item.verified).length,
      confirmatory_assessments: confirmatoryAssessments.length,
      current_confirmatory_assessments: confirmatoryAssessments.filter((item) =>
        item.current_for_pair).length,
      prospective_confirmatory_assessments: confirmatoryAssessments.filter((item) =>
        item.current_for_pair && item.registration_status === 'prospective').length,
      confirmatory_assessments_needing_attention: confirmatoryAssessments.filter((item) =>
        item.current_for_pair && item.status !== 'pass').length,
      literature: literature.length,
      verified_literature: literature.filter((item) => item.verified).length
    },
    chats,
    campaigns,
    kernels,
    evidence,
    experiments,
    simulations,
    cad_projects: cadProjects,
    cad_builds: cadBuilds,
    cad_simulations: cadSimulations,
    cad_slices: cadSlices,
    inferences,
    revisions,
    figure_comparisons: figureComparisons,
    figure_registrations: figureRegistrations,
    figure_visuals: figureVisuals,
    reviews,
    preregistrations,
    procedures,
    procedure_assessments: procedureAssessments,
    procedure_decisions: procedureDecisions,
    analysis_contracts: analysisContracts,
    confirmatory_assessments: confirmatoryAssessments,
    literature
  };
}

function sendFile(response, requestMethod, file, {
  download = false,
  contentType = null
} = {}) {
  const stat = fs.statSync(file);
  const extension = path.extname(file).toLowerCase();
  const headers = {
    ...responseHeaders(contentType ??
      MIME_TYPES.get(extension) ?? 'application/octet-stream'),
    'Content-Length': stat.size
  };
  if (download) {
    const filename = path.basename(file).replace(/["\\\r\n]/g, '_');
    headers['Content-Disposition'] = 'attachment; filename="' + filename + '"';
  }
  response.writeHead(200, headers);
  if (requestMethod === 'HEAD') {
    response.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

function serveArtifact(cwd, request, response, pathname) {
  const encoded = pathname.slice('/artifact/'.length).split('/');
  if (encoded.length < 2) {
    sendText(response, 404, 'Artifact not found.');
    return;
  }
  let simulationId;
  let relative;
  try {
    simulationId = decodeURIComponent(encoded.shift());
    relative = encoded.map((value) => decodeURIComponent(value)).join('/');
  } catch {
    sendText(response, 400, 'Malformed artifact path.');
    return;
  }
  try {
    const simulationDirectory = resolveSimulationDirectory(cwd, simulationId);
    const artifactRoot = path.join(simulationDirectory, 'artifacts');
    const file = resolveInsideRoot(artifactRoot, relative);
    const manifest = getSimulationManifest(cwd, simulationId);
    const portable = relativePortable(artifactRoot, file);
    if (!manifest.artifacts?.['artifacts/' + portable]) {
      sendText(response, 404, 'Artifact is not part of the recorded manifest.');
      return;
    }
    const rootReal = fs.realpathSync(artifactRoot);
    const fileReal = fs.realpathSync(file);
    if (!isPathInside(rootReal, fileReal) || !fs.statSync(fileReal).isFile()) {
      sendText(response, 404, 'Artifact not found.');
      return;
    }
    const extension = path.extname(fileReal).toLowerCase();
    const inline = IMAGE_EXTENSIONS.has(extension) || INTERACTIVE_TEXT_EXTENSIONS.has(extension);
    sendFile(response, request.method, fileReal, { download: !inline });
  } catch (error) {
    const status = ['INVALID_PATH', 'PATH_OUTSIDE_ROOT', 'INVALID_SIMULATION_ID'].includes(error.code)
      ? 400
      : 404;
    sendJson(response, status, { error: errorValue(error) });
  }
}

function serveInferenceArtifact(cwd, request, response, pathname) {
  const encoded = pathname.slice('/inference-artifact/'.length).split('/');
  if (encoded.length < 2) {
    sendText(response, 404, 'Inference artifact not found.');
    return;
  }
  let inferenceId;
  let relative;
  try {
    inferenceId = decodeURIComponent(encoded.shift());
    relative = encoded.map((value) => decodeURIComponent(value)).join('/');
  } catch {
    sendText(response, 400, 'Malformed inference artifact path.');
    return;
  }
  try {
    const inferenceDirectory = resolveInferenceDirectory(cwd, inferenceId);
    const artifactRoot = path.join(inferenceDirectory, 'artifacts');
    const file = resolveInsideRoot(artifactRoot, relative);
    const manifest = getInferenceManifest(cwd, inferenceId);
    const portable = relativePortable(artifactRoot, file);
    if (!manifest.artifacts?.['artifacts/' + portable]) {
      sendText(response, 404, 'Artifact is not part of the recorded inference manifest.');
      return;
    }
    const rootReal = fs.realpathSync(artifactRoot);
    const fileReal = fs.realpathSync(file);
    if (!isPathInside(rootReal, fileReal) || !fs.statSync(fileReal).isFile()) {
      sendText(response, 404, 'Inference artifact not found.');
      return;
    }
    const extension = path.extname(fileReal).toLowerCase();
    const inline = INTERACTIVE_TEXT_EXTENSIONS.has(extension);
    sendFile(response, request.method, fileReal, { download: !inline });
  } catch (error) {
    const status = ['INVALID_PATH', 'PATH_OUTSIDE_ROOT', 'INVALID_INFERENCE_ID'].includes(error.code)
      ? 400
      : 404;
    sendJson(response, status, { error: errorValue(error) });
  }
}

function serveExperimentArtifact(cwd, request, response, pathname) {
  const encoded = pathname.slice('/experiment-artifact/'.length).split('/');
  if (encoded.length < 2) {
    sendText(response, 404, 'Experiment artifact not found.');
    return;
  }
  let experimentId;
  let relative;
  try {
    experimentId = decodeURIComponent(encoded.shift());
    relative = encoded.map((value) => decodeURIComponent(value)).join('/');
  } catch {
    sendText(response, 400, 'Malformed experiment artifact path.');
    return;
  }
  try {
    const experimentDirectory = resolveExperimentDirectory(cwd, experimentId);
    const file = resolveInsideRoot(experimentDirectory, relative);
    const manifest = getExperimentManifest(cwd, experimentId);
    const portable = relativePortable(experimentDirectory, file);
    if (!manifest.artifacts?.[portable]) {
      sendText(response, 404, 'Artifact is not part of the recorded experiment manifest.');
      return;
    }
    const rootReal = fs.realpathSync(experimentDirectory);
    const fileReal = fs.realpathSync(file);
    if (!isPathInside(rootReal, fileReal) || !fs.statSync(fileReal).isFile()) {
      sendText(response, 404, 'Experiment artifact not found.');
      return;
    }
    const extension = path.extname(fileReal).toLowerCase();
    const inline = INTERACTIVE_TEXT_EXTENSIONS.has(extension);
    sendFile(response, request.method, fileReal, { download: !inline });
  } catch (error) {
    const status = ['INVALID_PATH', 'PATH_OUTSIDE_ROOT', 'INVALID_EXPERIMENT_ID'].includes(error.code)
      ? 400
      : 404;
    sendJson(response, status, { error: errorValue(error) });
  }
}

export function createLabServer({
  cwd,
  packageRoot,
  env = process.env,
  computeProvider = computeStatus,
  chatProvider = DEFAULT_CHAT_PROVIDER,
  campaignProvider = DEFAULT_CAMPAIGN_PROVIDER,
  inferenceProvider = DEFAULT_INFERENCE_PROVIDER,
  simulationProvider = DEFAULT_SIMULATION_PROVIDER,
  experimentProvider = DEFAULT_EXPERIMENT_PROVIDER,
  cadWorkerRunner = runCommand,
  gateWorkerRunner = runCommand,
  snapshotWorkerRunner = runCommand,
  kernelManager
}) {
  const project = path.resolve(cwd);
  const resolvedPackageRoot = path.resolve(packageRoot);
  const assets = path.join(resolvedPackageRoot, 'lab');
  const configDir = path.join(resolvedPackageRoot, 'opencode');
  const projectKernels = kernelManager ?? createKernelManager({ cwd: project, env });
  const kernelProvider = { list: () => projectKernels.listStatus() };
  const stateFileHashCache = createFileHashCache({ maxEntries: 16_384 });
  const stateAuditCache = createAuditCache({ maxProjects: 2 });
  const stateSnapshotCaching = chatProvider === DEFAULT_CHAT_PROVIDER &&
    campaignProvider === DEFAULT_CAMPAIGN_PROVIDER && kernelManager === undefined;
  let stateRevision = 0;
  let stateSnapshot = null;
  const invalidateStateSnapshot = () => {
    stateRevision += 1;
    stateSnapshot = null;
  };
  const buildCachedLabState = async (options, retry = 0) => {
    const observed = stateSnapshotCaching
      ? labStateFingerprint(project)
      : { fingerprint: null, files: [] };
    const fingerprint = observed.fingerprint;
    const key = fingerprint ? stateRevision + ':' + fingerprint : null;
    if (key && stateSnapshot?.key === key) {
      return { state: stateSnapshot.state, cacheHit: true, fingerprint };
    }
    if (observed.files.length) {
      await preloadFileHashCache(stateFileHashCache, observed.files);
    }
    const state = withAuditCache(
      stateAuditCache,
      () => withFileHashCache(stateFileHashCache, () => buildLabState(options))
    );
    const confirmed = stateSnapshotCaching
      ? labStateFingerprint(project).fingerprint
      : null;
    const confirmedKey = confirmed && confirmed === fingerprint ? key : null;
    if (confirmedKey) stateSnapshot = { key: confirmedKey, state };
    if (fingerprint && confirmed && confirmed !== fingerprint && retry < 1) {
      return buildCachedLabState(options, retry + 1);
    }
    return { state, cacheHit: false, fingerprint: confirmed };
  };
  const busyChats = new Set();
  const busyCadProjects = new Set();
  let inferenceBusy = false;
  let scientificComputeBusy = false;
  let projectGateBusy = false;
  let projectSnapshotBusy = false;
  const jobs = new Map();
  const appendJobResponse = (job, event) => {
    const normalized = publicOpenCodeEvent({
      type: 'text',
      timestamp: event.timestamp,
      part: {
        text: event.content,
        id: event.part_id,
        messageID: event.message_id
      }
    }, { includeResponseContent: true });
    if (normalized?.type !== 'response.block') return;
    const key = normalized.part_id
      ? String(normalized.message_id ?? '') + '\u0000' + normalized.part_id
      : null;
    const existing = key
      ? job.response_blocks.findIndex((block) => block.identity === key)
      : -1;
    const block = {
      identity: key,
      sequence: existing >= 0
        ? job.response_blocks[existing].sequence
        : (job.response_sequence += 1),
      timestamp: normalized.timestamp ?? new Date().toISOString(),
      content: normalized.content,
      content_bytes: normalized.content_bytes,
      truncated: Boolean(event.truncated || normalized.truncated),
      ...(normalized.part_id ? { part_id: normalized.part_id } : {}),
      ...(normalized.message_id ? { message_id: normalized.message_id } : {})
    };
    if (existing >= 0) {
      job.response_retained_bytes -= job.response_blocks[existing].content_bytes;
      job.response_blocks[existing] = block;
    } else {
      job.response_blocks.push(block);
      job.response_received_blocks += 1;
    }
    job.response_retained_bytes += block.content_bytes;
    while (
      job.response_blocks.length > MAX_LIVE_RESPONSE_BLOCKS ||
      job.response_retained_bytes > MAX_LIVE_RESPONSE_BYTES
    ) {
      const omitted = job.response_blocks.shift();
      job.response_retained_bytes -= omitted.content_bytes;
      job.response_omitted_blocks += 1;
      job.response_omitted_bytes += omitted.content_bytes;
    }
  };
  const pushJobEvent = (job, event) => {
    if (event?.type === 'response.block' && typeof event.content === 'string') {
      appendJobResponse(job, event);
    }
    const { content: _responseContent, ...metadata } = event ?? {};
    job.events.push({
      ...metadata,
      ...(event?.type === 'response.block' ? { preview_available: true } : {}),
      timestamp: event.timestamp ?? new Date().toISOString(),
      source: event.source ?? 'live'
    });
    if (job.events.length > MAX_JOB_EVENTS) {
      job.events.splice(0, job.events.length - MAX_JOB_EVENTS);
    }
  };
  const pruneJobs = () => {
    if (jobs.size < MAX_LAB_JOBS) return;
    const removable = [...jobs.values()]
      .filter((job) => TERMINAL_JOB_STATUSES.has(job.status))
      .sort((left, right) => String(left.finished_at).localeCompare(String(right.finished_at)));
    while (jobs.size >= MAX_LAB_JOBS && removable.length) {
      jobs.delete(removable.shift().job_id);
    }
  };
  const latestJobForChat = (chatId) => [...jobs.values()]
    .filter((job) => ['chat', 'campaign', 'cad', 'simulation', 'experiment']
      .includes(job.kind ?? 'chat') &&
      job.chat_id === chatId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
  let cachedCompute = null;
  let cachedAt = 0;
  const currentCompute = (refresh = false) => {
    const now = Date.now();
    if (refresh || !cachedCompute || now - cachedAt > COMPUTE_CACHE_TTL_MS) {
      invalidateStateSnapshot();
      cachedCompute = computeProvider({ env });
      cachedAt = now;
    }
    return cachedCompute;
  };
  const preparedComputeProvider = (refresh) => {
    try {
      const value = currentCompute(refresh);
      return () => value;
    } catch (error) {
      return () => { throw error; };
    }
  };
  const cadWorker = path.join(resolvedPackageRoot, 'lib', 'cad-worker.js');
  const projectGateWorker = path.join(
    resolvedPackageRoot,
    'lib',
    'project-gate-worker.js'
  );
  const projectSnapshotWorker = path.join(
    resolvedPackageRoot,
    'lib',
    'project-snapshot-worker.js'
  );
  const queueCadOperation = ({
    operation,
    cadProjectId,
    buildId = null,
    chatId = null,
    note = null,
    request: workerRequest
  }) => {
    if (chatId) getChatSession(project, chatId);
    if (busyCadProjects.has(cadProjectId)) {
      throw Object.assign(new Error('This CAD project already has an active operation.'), {
        code: 'CAD_PROJECT_BUSY',
        status: 409
      });
    }
    pruneJobs();
    if (jobs.size >= MAX_LAB_JOBS) {
      throw Object.assign(new Error('The local harness job queue is full.'), {
        code: 'JOB_QUEUE_FULL',
        status: 503
      });
    }
    const requestedStudyTimeout = Number(workerRequest.study_timeout_ms);
    const studyTimeoutMs = operation === 'study'
      ? Number.isSafeInteger(requestedStudyTimeout) && requestedStudyTimeout > 0
        ? Math.min(requestedStudyTimeout, MAX_CAD_STUDY_WALL_CLOCK_MS)
        : MAX_CAD_STUDY_WALL_CLOCK_MS
      : null;
    const job = {
      job_id: makeJobId(),
      kind: 'cad',
      operation,
      cad_project_id: cadProjectId,
      build_id: buildId,
      experiment_id: null,
      chat_id: chatId,
      status: 'queued',
      interruptible: operation === 'study',
      created_at: new Date().toISOString(),
      controller: new AbortController(),
      events: [],
      response_blocks: [],
      response_sequence: 0,
      response_received_blocks: 0,
      response_retained_bytes: 0,
      response_omitted_blocks: 0,
      response_omitted_bytes: 0,
      request: {
        operation,
        cad_project_id: cadProjectId,
        build_id: buildId,
        mode: workerRequest.mode ?? null,
        script: workerRequest.script ?? null,
        device: workerRequest.device ?? null,
        branch_count: workerRequest.branch_count ?? null,
        wall_clock_timeout_seconds: studyTimeoutMs
          ? Math.ceil(studyTimeoutMs / 1_000)
          : null,
        chat_id: chatId,
        note
      }
    };
    pushJobEvent(job, {
      type: 'cad.' + operation + '.queued',
      status: 'queued',
      title: 'Queued bounded CAD ' + operation,
      source: 'sciencecode'
    });
    jobs.set(job.job_id, job);
    busyCadProjects.add(cadProjectId);
    let studyTimeout = null;
    setImmediate(async () => {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.cancelled_at = new Date().toISOString();
        job.finished_at = job.cancelled_at;
        pushJobEvent(job, {
          type: 'cad.' + operation + '.cancelled',
          status: 'cancelled',
          title: operation === 'study'
            ? 'CAD study cancelled before its experiment record was started'
            : 'CAD operation cancelled before launch',
          source: 'sciencecode'
        });
        busyCadProjects.delete(cadProjectId);
        invalidateStateSnapshot();
        return;
      }
      job.status = 'running';
      job.started_at = new Date().toISOString();
      pushJobEvent(job, {
        type: 'cad.' + operation + '.running',
        status: 'running',
        title: operation === 'build'
          ? 'The selected CAD engine is rendering an immutable source snapshot'
          : operation === 'simulate'
            ? 'ScienceCode is screening the verified mesh geometry'
            : operation === 'study'
              ? 'ScienceCode is running a bounded comparison on one immutable CAD build'
              : 'PrusaSlicer is preparing G-code without printer transmission',
        source: 'sciencecode'
      });
      try {
        let result;
        if (operation === 'study') {
          studyTimeout = setTimeout(() => {
            if (!['queued', 'running'].includes(job.status) ||
                job.controller.signal.aborted) return;
            job.timed_out = true;
            job.cancel_requested_at = new Date().toISOString();
            job.status = 'cancelling';
            pushJobEvent(job, {
              type: 'cad.study.timeout_requested',
              status: 'cancelling',
              title: 'CAD study reached its bounded whole-matrix time limit',
              source: 'sciencecode'
            });
            job.controller.abort('study_wall_clock_timeout');
          }, studyTimeoutMs);
          const compute = currentCompute(false);
          const gpuRuntime = compute?.runtimes?.gpu ?? compute?.runtime;
          const study = await experimentProvider.run({
            cwd: project,
            packageRoot: resolvedPackageRoot,
            script: workerRequest.script,
            seeds: workerRequest.seeds,
            device: workerRequest.device,
            timeoutMs: workerRequest.timeout_ms,
            parameters: workerRequest.parameters,
            variations: workerRequest.variations,
            scriptArgs: workerRequest.script_args,
            inputs: workerRequest.inputs,
            name: workerRequest.name,
            hypothesis: workerRequest.hypothesis,
            cadBuildId: workerRequest.build_id,
            env,
            runtime: gpuRuntime?.healthy ? gpuRuntime : null,
            signal: job.controller.signal,
            onStarted(started) {
              job.experiment_id = started.experiment_id;
              pushJobEvent(job, {
                type: 'cad.study.record.started',
                status: 'running',
                title: 'Immutable CAD study ' + started.experiment_id + ' started',
                source: 'sciencecode'
              });
            },
            onBranchStarted(branch) {
              pushJobEvent(job, {
                type: 'cad.study.branch.started',
                status: 'running',
                title: 'CAD study branch ' + (branch.branch_index + 1) + ' of ' +
                  branch.branch_count + ' started',
                branch_index: branch.branch_index,
                branch_count: branch.branch_count,
                source: 'sciencecode'
              });
            },
            onSimulationStarted(started) {
              job.simulation_id = started.simulation_id;
            },
            onBranchFinished(branch) {
              pushJobEvent(job, {
                type: 'cad.study.branch.finished',
                status: branch.status,
                title: 'CAD study branch ' + (branch.branch_index + 1) +
                  ' recorded as ' + branch.status,
                branch_index: branch.branch_index,
                branch_count: workerRequest.branch_count,
                source: 'sciencecode'
              });
            }
          });
          clearTimeout(studyTimeout);
          studyTimeout = null;
          const experimentId = study.manifest?.experiment_id;
          const verification = study.verification ??
            (experimentId ? verifyExperiment(project, experimentId) : null);
          result = {
            manifest: study.manifest,
            manifest_sha256: study.manifest_sha256,
            verification,
            review: study.review
          };
        } else {
          const encoded = Buffer.from(JSON.stringify(workerRequest)).toString('base64url');
          const child = await cadWorkerRunner(process.execPath, [cadWorker, encoded], {
            cwd: project,
            env,
            timeout: (workerRequest.timeout_ms ?? 300_000) + 30_000,
            maxBuffer: 8 * 1024 * 1024
          });
          let payload = null;
          try { payload = JSON.parse(String(child.stdout ?? '').trim()); } catch {
            payload = null;
          }
          if (!payload?.ok) {
            const detail = payload?.error ?? child.error ?? {
              code: 'CAD_WORKER_FAILED',
              message: redactText(String(child.stderr ?? '').trim()) ||
                'The CAD worker did not return a valid result.'
            };
            throw Object.assign(new Error(detail.message), {
              code: detail.code ?? 'CAD_WORKER_FAILED'
            });
          }
          result = payload.result;
        }
        job.result = result;
        job.build_id = result.manifest?.build_id ?? job.build_id;
        job.simulation_id = result.manifest?.simulation_id ?? job.simulation_id ?? null;
        job.experiment_id = result.manifest?.experiment_id ?? null;
        job.slice_id = result.manifest?.slice_id ?? null;
        const operationCancelled = operation === 'study' &&
          result.manifest?.status === 'cancelled';
        const verifiedCancellation = operationCancelled &&
          result.verification?.ok === true;
        const operationSucceeded = result.verification?.ok === true &&
          (operation === 'simulate' ||
            (operation === 'build' && result.manifest?.status === 'completed') ||
            (operation === 'study' && result.manifest?.status === 'completed') ||
            (operation === 'slice' &&
              String(result.manifest?.status).startsWith('completed')));
        job.status = verifiedCancellation
          ? 'cancelled'
          : operationSucceeded ? 'completed' : 'failed';
        if (verifiedCancellation) {
          job.cancelled_at = result.manifest?.cancellation?.cancelled_at ??
            new Date().toISOString();
        } else if (!operationSucceeded) {
          job.error = {
            code: 'CAD_OPERATION_FAILED',
            message: operationCancelled
              ? 'The cancelled CAD study failed integrity verification.'
              : 'The CAD ' + operation + ' record requires attention.'
          };
        }
        if (chatId) {
          try {
            const detail = getCadProject(project, cadProjectId);
            const interaction = recordInteraction({
              cwd: project,
              chatId,
              surface: 'cad',
              action: operation + '.' + job.status,
              artifact: cadInteractionArtifact(
                cadProjectId,
                detail.descriptor.name,
                '/api/cad/projects/' + encodeURIComponent(cadProjectId)
              ),
              payload: cadInteractionPayload({
                job_id: job.job_id,
                operation,
                cad_project_id: cadProjectId,
                engine: detail.descriptor.engine,
                build_id: job.build_id,
                simulation_id: job.simulation_id,
                experiment_id: job.experiment_id,
                slice_id: job.slice_id,
                status: result.manifest?.status ?? job.status,
                planned_branches: result.manifest?.counts?.planned ?? null,
                completed_branches: result.manifest?.counts?.completed ?? null,
                verified_branches: result.manifest?.counts?.verified ?? null,
                review_verdict: result.review?.verdict ?? null,
                numeric_aggregates: result.review?.numeric_aggregates ?? null,
                cancellation_reason: result.manifest?.cancellation?.reason ?? null,
                mode: result.manifest?.mode ?? null,
                printer_transmission: 'disabled',
                note
              })
            });
            job.interaction_id = interaction.interaction_id;
          } catch (error) {
            job.interaction_error = errorValue(error);
          }
        }
        pushJobEvent(job, {
          type: 'cad.' + operation + '.finished',
          status: job.status,
          title: job.status === 'completed'
            ? 'CAD ' + operation + ' finished and integrity-verified'
            : job.status === 'cancelled'
              ? 'CAD study stopped; completed and partial branch evidence was preserved'
              : 'CAD ' + operation + ' finished with a recorded failure',
          source: 'sciencecode'
        });
      } catch (error) {
        const cancelled = operation === 'study' && !job.experiment_id &&
          job.controller.signal.aborted &&
          (error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
        job.status = cancelled ? 'cancelled' : 'failed';
        if (cancelled) job.cancelled_at = new Date().toISOString();
        else job.error = errorValue(error);
        pushJobEvent(job, {
          type: 'cad.' + operation + (cancelled ? '.cancelled' : '.error'),
          status: job.status,
          title: cancelled
            ? 'CAD study stopped before a complete record was published'
            : redactText(error.message),
          source: 'sciencecode'
        });
      } finally {
        if (studyTimeout) clearTimeout(studyTimeout);
        job.finished_at = new Date().toISOString();
        busyCadProjects.delete(cadProjectId);
        invalidateStateSnapshot();
      }
    });
    return job;
  };

  const queueCadModelOperation = ({
    cadProjectId,
    buildId,
    chatId = null,
    note = null,
    options
  }) => {
    if (chatId) getChatSession(project, chatId);
    if (busyCadProjects.has(cadProjectId)) {
      throw Object.assign(new Error('This CAD project already has an active operation.'), {
        code: 'CAD_PROJECT_BUSY',
        status: 409
      });
    }
    pruneJobs();
    if (jobs.size >= MAX_LAB_JOBS) {
      throw Object.assign(new Error('The local harness job queue is full.'), {
        code: 'JOB_QUEUE_FULL',
        status: 503
      });
    }
    const job = {
      job_id: makeJobId(),
      kind: 'cad',
      operation: 'model',
      cad_project_id: cadProjectId,
      build_id: buildId,
      simulation_id: null,
      chat_id: chatId,
      status: 'queued',
      interruptible: true,
      created_at: new Date().toISOString(),
      controller: new AbortController(),
      events: [],
      response_blocks: [],
      response_sequence: 0,
      response_received_blocks: 0,
      response_retained_bytes: 0,
      response_omitted_blocks: 0,
      response_omitted_bytes: 0,
      request: {
        operation: 'model',
        cad_project_id: cadProjectId,
        build_id: buildId,
        script: options.script,
        device: options.device,
        seed: options.seed,
        parameters: options.parameters,
        script_args: options.scriptArgs,
        inputs: options.inputs,
        minimum_free_gpu_mib: options.minimumFreeGpuMib,
        timeout_ms: options.timeoutMs,
        chat_id: chatId,
        note
      }
    };
    pushJobEvent(job, {
      type: 'cad.model.queued',
      status: 'queued',
      title: 'Queued CAD-linked recorded model',
      source: 'sciencecode'
    });
    jobs.set(job.job_id, job);
    busyCadProjects.add(cadProjectId);
    setImmediate(async () => {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.cancelled_at = new Date().toISOString();
        job.finished_at = job.cancelled_at;
        pushJobEvent(job, {
          type: 'cad.model.finished',
          status: 'cancelled',
          title: 'CAD model cancelled before runtime launch',
          source: 'sciencecode'
        });
        busyCadProjects.delete(cadProjectId);
        return;
      }
      job.status = 'running';
      job.started_at = new Date().toISOString();
      pushJobEvent(job, {
        type: 'cad.model.running',
        status: 'running',
        title: 'Recorded model is executing against the verified immutable mesh',
        source: 'sciencecode'
      });
      try {
        const result = await simulationProvider.run({
          cwd: project,
          packageRoot: resolvedPackageRoot,
          script: options.script,
          seed: options.seed,
          device: options.device,
          timeoutMs: options.timeoutMs,
          parameters: options.parameters,
          scriptArgs: options.scriptArgs,
          inputs: options.inputs,
          cadBuildId: buildId,
          env,
          signal: job.controller.signal,
          onStarted: (started) => {
            job.simulation_id = started.simulation_id;
            pushJobEvent(job, {
              type: 'cad.model.record.started',
              status: 'running',
              title: 'Immutable simulation record ' + started.simulation_id + ' started',
              source: 'sciencecode'
            });
          }
        });
        job.simulation_id = result.manifest.simulation_id;
        const verification = verifySimulation(project, job.simulation_id);
        job.result = {
          simulation_id: job.simulation_id,
          status: result.manifest.status,
          cad_parent: result.manifest.cad_parent,
          verification: {
            ok: verification.ok,
            errors: verification.errors
          }
        };
        if (result.manifest.status === 'cancelled') {
          job.status = 'cancelled';
          job.cancelled_at = result.manifest.cancellation?.cancelled_at ??
            new Date().toISOString();
        } else {
          job.status = result.manifest.status === 'completed' && verification.ok
            ? 'completed'
            : 'failed';
        }
        if (job.status === 'failed') {
          job.error = {
            code: 'CAD_MODEL_FAILED',
            message: verification.ok
              ? 'The CAD-linked model recorded a failed outcome.'
              : 'The CAD-linked model record failed integrity verification.'
          };
        }
        pushJobEvent(job, {
          type: 'cad.model.finished',
          status: job.status,
          title: job.status === 'completed'
            ? 'CAD-linked model finished and integrity-verified'
            : job.status === 'cancelled'
              ? 'CAD-linked model stopped; partial evidence was preserved'
              : 'CAD-linked model finished with a recorded failure',
          source: 'sciencecode'
        });
      } catch (error) {
        const cancelled = job.controller.signal.aborted ||
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
        job.status = cancelled ? 'cancelled' : 'failed';
        if (cancelled) {
          job.cancelled_at = new Date().toISOString();
          job.result = {
            simulation_id: job.simulation_id,
            status: 'cancelled',
            cad_parent: null,
            verification: null
          };
        } else {
          job.error = errorValue(error);
        }
        pushJobEvent(job, {
          type: 'cad.model.error',
          status: job.status,
          title: cancelled
            ? 'CAD model cancelled before a record was created'
            : redactText(error.message),
          source: 'sciencecode'
        });
      } finally {
        job.finished_at = new Date().toISOString();
        if (chatId) {
          try {
            const detail = getCadProject(project, cadProjectId);
            const artifact = job.simulation_id
              ? {
                  kind: 'simulation',
                  record_id: job.simulation_id,
                  name: options.script,
                  url: '/api/simulations/' + encodeURIComponent(job.simulation_id)
                }
              : cadInteractionArtifact(
                  cadProjectId,
                  detail.descriptor.name,
                  '/api/cad/projects/' + encodeURIComponent(cadProjectId)
                );
            const interaction = recordInteraction({
              cwd: project,
              chatId,
              surface: 'cad',
              action: 'model.' + job.status,
              artifact,
              payload: cadInteractionPayload({
                job_id: job.job_id,
                operation: 'model',
                cad_project_id: cadProjectId,
                build_id: buildId,
                simulation_id: job.simulation_id,
                script: options.script,
                device: options.device,
                seed: options.seed,
                parameters: options.parameters,
                inputs: options.inputs,
                minimum_free_gpu_mib: options.minimumFreeGpuMib,
                status: job.result?.status ?? job.status,
                verified: job.result?.verification?.ok ?? false,
                printer_transmission: 'disabled',
                note
              })
            });
            job.interaction_id = interaction.interaction_id;
          } catch (error) {
            job.interaction_error = errorValue(error);
          }
        }
        busyCadProjects.delete(cadProjectId);
      }
    });
    return job;
  };

  const queueScientificComputeOperation = ({ kind, options }) => {
    const experiment = kind === 'experiment';
    if (options.chatId) getChatSession(project, options.chatId);
    if (scientificComputeBusy) {
      throw Object.assign(new Error(
        'Another standalone simulation or experiment is already running.'
      ), { code: 'COMPUTE_JOB_BUSY', status: 409 });
    }
    pruneJobs();
    if (jobs.size >= MAX_LAB_JOBS) {
      throw Object.assign(new Error('The local harness job queue is full.'), {
        code: 'JOB_QUEUE_FULL',
        status: 503
      });
    }
    const job = {
      job_id: makeJobId(),
      kind,
      operation: 'run',
      chat_id: options.chatId,
      simulation_id: null,
      experiment_id: null,
      status: 'queued',
      interruptible: true,
      created_at: new Date().toISOString(),
      controller: new AbortController(),
      events: [],
      response_blocks: [],
      response_sequence: 0,
      response_received_blocks: 0,
      response_retained_bytes: 0,
      response_omitted_blocks: 0,
      response_omitted_bytes: 0,
      request: {
        script: options.script,
        name: options.name,
        device: options.device,
        seed: options.seed,
        seeds: experiment ? options.seeds : null,
        branch_count: options.branchCount,
        parameter_names: Object.keys(options.parameters).sort(),
        variation_sizes: experiment
          ? Object.fromEntries(Object.entries(options.variations)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, values]) => [name, values.length]))
          : null,
        input_count: options.inputs.length,
        script_argument_count: options.scriptArgs.length,
        analysis_contract_id: options.analysisContractId,
        cad_build_id: options.cadBuildId,
        timeout_seconds: options.timeoutSeconds,
        linked_to_chat: Boolean(options.chatId)
      }
    };
    pushJobEvent(job, {
      type: kind + '.queued',
      status: 'queued',
      title: experiment
        ? 'Queued a bounded sequential experiment matrix'
        : 'Queued a recorded standalone simulation',
      source: 'sciencecode'
    });
    jobs.set(job.job_id, job);
    scientificComputeBusy = true;
    setImmediate(async () => {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled';
        job.cancelled_at = new Date().toISOString();
        job.finished_at = job.cancelled_at;
        pushJobEvent(job, {
          type: kind + '.cancelled',
          status: 'cancelled',
          title: (experiment ? 'Experiment' : 'Simulation') +
            ' cancelled before runtime launch',
          source: 'sciencecode'
        });
        scientificComputeBusy = false;
        return;
      }
      job.status = 'running';
      job.started_at = new Date().toISOString();
      pushJobEvent(job, {
        type: kind + '.running',
        status: 'running',
        title: experiment
          ? 'Executing the immutable experiment plan one branch at a time'
          : 'Executing the recorded simulation in the isolated runtime',
        source: 'sciencecode'
      });
      try {
        const compute = currentCompute(false);
        const gpuRuntime = compute?.runtimes?.gpu ?? compute?.runtime;
        const common = {
          cwd: project,
          packageRoot: resolvedPackageRoot,
          script: options.script,
          device: options.device,
          timeoutMs: options.timeoutMs,
          parameters: options.parameters,
          scriptArgs: options.scriptArgs,
          inputs: options.inputs,
          cadBuildId: options.cadBuildId,
          env,
          runtime: gpuRuntime?.healthy ? gpuRuntime : null,
          signal: job.controller.signal
        };
        const result = experiment
          ? await experimentProvider.run({
            ...common,
            seeds: options.seeds,
            variations: options.variations,
            name: options.name,
            hypothesis: options.hypothesis,
            analysisContractId: options.analysisContractId,
            onStarted(started) {
              job.experiment_id = started.experiment_id;
              pushJobEvent(job, {
                type: 'experiment.record.started',
                status: 'running',
                title: 'Immutable experiment ' + started.experiment_id + ' started',
                source: 'sciencecode'
              });
            },
            onBranchStarted(branch) {
              pushJobEvent(job, {
                type: 'experiment.branch.started',
                status: 'running',
                title: 'Branch ' + (branch.branch_index + 1) + ' of ' +
                  branch.branch_count + ' started',
                branch_index: branch.branch_index,
                branch_count: branch.branch_count,
                source: 'sciencecode'
              });
            },
            onSimulationStarted(started) {
              job.simulation_id = started.simulation_id;
            },
            onBranchFinished(branch) {
              pushJobEvent(job, {
                type: 'experiment.branch.finished',
                status: branch.status,
                title: 'Branch ' + (branch.branch_index + 1) + ' recorded as ' +
                  branch.status,
                branch_index: branch.branch_index,
                branch_count: options.branchCount,
                source: 'sciencecode'
              });
            }
          })
          : await simulationProvider.run({
            ...common,
            seed: options.seed,
            onStarted(started) {
              job.simulation_id = started.simulation_id;
              pushJobEvent(job, {
                type: 'simulation.record.started',
                status: 'running',
                title: 'Immutable simulation ' + started.simulation_id + ' started',
                source: 'sciencecode'
              });
            }
          });
        const manifest = result.manifest;
        const id = experiment ? manifest.experiment_id : manifest.simulation_id;
        if (experiment) job.experiment_id = id;
        else job.simulation_id = id;
        const verification = result.verification ?? (experiment
          ? verifyExperiment(project, id)
          : verifySimulation(project, id));
        job.status = manifest.status === 'cancelled'
          ? 'cancelled'
          : manifest.status === 'completed' && verification.ok
            ? 'completed'
            : 'failed';
        job.result = experiment
          ? {
              experiment_id: id,
              status: manifest.status,
              counts: manifest.counts ?? null,
              review_verdict: result.review?.verdict ?? manifest.review?.verdict ?? null,
              verification: { ok: verification.ok, errors: verification.errors }
            }
          : {
              simulation_id: id,
              status: manifest.status,
              exit_code: manifest.exit_code ?? null,
              verification: { ok: verification.ok, errors: verification.errors }
            };
        if (job.status === 'cancelled') {
          job.cancelled_at = manifest.cancellation?.cancelled_at ??
            new Date().toISOString();
        } else if (job.status === 'failed') {
          job.error = {
            code: experiment ? 'EXPERIMENT_RUN_FAILED' : 'SIMULATION_RUN_FAILED',
            message: verification.ok
              ? 'The recorded ' + kind + ' outcome requires attention.'
              : 'The ' + kind + ' record failed integrity verification.'
          };
        }
        pushJobEvent(job, {
          type: kind + '.finished',
          status: job.status,
          title: job.status === 'completed'
            ? (experiment ? 'Experiment matrix' : 'Simulation') +
              ' completed and integrity-verified'
            : job.status === 'cancelled'
              ? (experiment ? 'Experiment' : 'Simulation') +
                ' stopped; partial evidence was preserved'
              : (experiment ? 'Experiment' : 'Simulation') +
                ' finished with a recorded failure',
          source: 'sciencecode'
        });
      } catch (error) {
        const cancelled = job.controller.signal.aborted ||
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
        job.status = cancelled ? 'cancelled' : 'failed';
        if (cancelled) job.cancelled_at = new Date().toISOString();
        else job.error = errorValue(error);
        pushJobEvent(job, {
          type: kind + (cancelled ? '.cancelled' : '.error'),
          status: job.status,
          title: cancelled
            ? (experiment ? 'Experiment' : 'Simulation') +
              ' stopped before a complete record was published'
            : redactText(error.message),
          source: 'sciencecode'
        });
      } finally {
        job.finished_at = new Date().toISOString();
        if (options.chatId && job.status !== 'cancelled') {
          try {
            const recordId = experiment ? job.experiment_id : job.simulation_id;
            const interaction = recordInteraction({
              cwd: project,
              chatId: options.chatId,
              surface: kind,
              action: job.status === 'completed' ? 'run.completed' : 'run.failed',
              artifact: recordId ? {
                kind,
                record_id: recordId,
                name: options.name ?? options.script,
                url: '/api/' + (experiment ? 'experiments/' : 'simulations/') +
                  encodeURIComponent(recordId)
              } : null,
              payload: {
                job_id: job.job_id,
                status: job.result?.status ?? job.status,
                script: options.script,
                device: options.device,
                seed: options.seed,
                seeds: experiment ? options.seeds : null,
                parameters: options.parameters,
                variations: experiment ? options.variations : null,
                branch_count: options.branchCount,
                analysis_contract_id: options.analysisContractId,
                cad_build_id: options.cadBuildId,
                verified: job.result?.verification?.ok ?? false,
                note: options.note
              }
            });
            job.interaction_id = interaction.interaction_id;
          } catch (error) {
            job.interaction_error = errorValue(error);
          }
        }
        scientificComputeBusy = false;
        invalidateStateSnapshot();
      }
    });
    return job;
  };

  const queueProjectGate = (policy) => {
    if (projectGateBusy) {
      throw Object.assign(
        new Error('A full project gate is already running.'),
        { code: 'PROJECT_GATE_BUSY', status: 409 }
      );
    }
    pruneJobs();
    if (jobs.size >= MAX_LAB_JOBS) {
      throw Object.assign(new Error('The local harness job queue is full.'), {
        code: 'JOB_QUEUE_FULL',
        status: 503
      });
    }
    const job = {
      job_id: makeJobId(),
      kind: 'gate',
      operation: 'verify',
      chat_id: null,
      status: 'queued',
      interruptible: true,
      created_at: new Date().toISOString(),
      controller: new AbortController(),
      request: policy,
      events: [],
      response_blocks: [],
      response_sequence: 0,
      response_received_blocks: 0,
      response_retained_bytes: 0,
      response_omitted_blocks: 0,
      response_omitted_bytes: 0,
      result: null,
      error: null
    };
    jobs.set(job.job_id, job);
    projectGateBusy = true;
    pushJobEvent(job, {
      type: 'gate.queued',
      status: 'queued',
      title: 'Full project verification queued',
      source: 'sciencecode'
    });
    setImmediate(async () => {
      try {
        if (job.controller.signal.aborted) {
          job.status = 'cancelled';
          job.cancelled_at = new Date().toISOString();
          pushJobEvent(job, {
            type: 'gate.cancelled',
            status: 'cancelled',
            title: 'Project verification cancelled before launch',
            source: 'sciencecode'
          });
          return;
        }
        job.status = 'running';
        job.started_at = new Date().toISOString();
        pushJobEvent(job, {
          type: 'gate.started',
          status: 'running',
          title: 'Verifying every recorded project artifact',
          source: 'sciencecode'
        });
        const encoded = Buffer.from(JSON.stringify({
          schema_version: PROJECT_GATE_SCHEMA_VERSION,
          policy
        }), 'utf8').toString('base64url');
        const child = await gateWorkerRunner(
          process.execPath,
          [projectGateWorker, encoded],
          {
            cwd: project,
            env,
            timeout: PROJECT_GATE_TIMEOUT_MS,
            maxBuffer: MAX_PROJECT_GATE_WORKER_BYTES,
            signal: job.controller.signal
          }
        );
        if (child?.aborted || job.controller.signal.aborted) {
          job.status = 'cancelled';
          job.cancelled_at = new Date().toISOString();
          pushJobEvent(job, {
            type: 'gate.cancelled',
            status: 'cancelled',
            title: 'Project verification cancelled',
            source: 'sciencecode'
          });
          return;
        }
        if (child?.error || child?.status !== 0) {
          throw Object.assign(new Error('The project gate worker did not complete.'), {
            code: 'PROJECT_GATE_WORKER_FAILED'
          });
        }
        let payload;
        try {
          payload = JSON.parse(String(child.stdout ?? '').trim());
        } catch {
          throw Object.assign(new Error('The project gate worker returned invalid JSON.'), {
            code: 'PROJECT_GATE_WORKER_FAILED'
          });
        }
        if (!payload?.ok || !payload.report ||
            payload.report.schema_version !== PROJECT_GATE_SCHEMA_VERSION ||
            typeof payload.report.ok !== 'boolean' ||
            !Array.isArray(payload.report.issues)) {
          const failure = payload?.error;
          throw Object.assign(
            new Error(failure?.message ?? 'The project gate worker returned an invalid report.'),
            { code: 'PROJECT_GATE_WORKER_FAILED' }
          );
        }
        job.result = payload.report;
        job.status = 'completed';
        pushJobEvent(job, {
          type: 'gate.finished',
          status: 'completed',
          title: payload.report.ok
            ? 'Project gate passed'
            : 'Project gate completed with blockers',
          source: 'sciencecode'
        });
      } catch (error) {
        const cancelled = job.controller.signal.aborted ||
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
        job.status = cancelled ? 'cancelled' : 'failed';
        if (cancelled) job.cancelled_at = new Date().toISOString();
        else job.error = errorValue(error);
        pushJobEvent(job, {
          type: cancelled ? 'gate.cancelled' : 'gate.error',
          status: job.status,
          title: cancelled
            ? 'Project verification cancelled'
            : 'Project verification could not complete',
          source: 'sciencecode'
        });
      } finally {
        job.finished_at = job.finished_at ?? new Date().toISOString();
        projectGateBusy = false;
      }
    });
    return job;
  };

  const queueProjectSnapshot = ({ operation, snapshotId, strict = true }) => {
    if (!['create', 'verify'].includes(operation)) {
      throw Object.assign(new Error('Invalid project snapshot operation.'), {
        code: 'INVALID_PROJECT_SNAPSHOT_REQUEST',
        status: 400
      });
    }
    const normalizedId = normalizeProjectSnapshotId(snapshotId);
    if (operation === 'verify') resolveProjectSnapshotFile(project, normalizedId);
    if (projectSnapshotBusy) {
      throw Object.assign(
        new Error('A project snapshot operation is already running.'),
        { code: 'PROJECT_SNAPSHOT_BUSY', status: 409 }
      );
    }
    pruneJobs();
    if (jobs.size >= MAX_LAB_JOBS) {
      throw Object.assign(new Error('The local harness job queue is full.'), {
        code: 'JOB_QUEUE_FULL',
        status: 503
      });
    }
    const job = {
      job_id: makeJobId(),
      kind: 'snapshot',
      operation,
      snapshot_id: normalizedId,
      chat_id: null,
      status: 'queued',
      interruptible: true,
      created_at: new Date().toISOString(),
      controller: new AbortController(),
      request: operation === 'verify' ? { strict: Boolean(strict) } : {},
      events: [],
      response_blocks: [],
      response_sequence: 0,
      response_received_blocks: 0,
      response_retained_bytes: 0,
      response_omitted_blocks: 0,
      response_omitted_bytes: 0,
      result: null,
      error: null
    };
    jobs.set(job.job_id, job);
    projectSnapshotBusy = true;
    pushJobEvent(job, {
      type: 'snapshot.queued',
      status: 'queued',
      title: operation === 'create'
        ? 'Project baseline capture queued'
        : 'Project snapshot verification queued',
      source: 'sciencecode'
    });
    setImmediate(async () => {
      try {
        if (job.controller.signal.aborted) {
          job.status = 'cancelled';
          job.cancelled_at = new Date().toISOString();
          pushJobEvent(job, {
            type: 'snapshot.cancelled',
            status: 'cancelled',
            title: 'Project snapshot operation cancelled before launch',
            source: 'sciencecode'
          });
          return;
        }
        job.status = 'running';
        job.started_at = new Date().toISOString();
        pushJobEvent(job, {
          type: 'snapshot.started',
          status: 'running',
          title: operation === 'create'
            ? 'Hashing the current project into an immutable baseline'
            : 'Comparing the current project with the selected baseline',
          source: 'sciencecode'
        });
        const workerOperation = operation === 'create' ? 'capture' : 'verify';
        const encoded = Buffer.from(JSON.stringify({
          schema_version: PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION,
          operation: workerOperation,
          snapshot_id: normalizedId,
          ...(workerOperation === 'verify' ? { strict: Boolean(strict) } : {})
        }), 'utf8').toString('base64url');
        const child = await snapshotWorkerRunner(
          process.execPath,
          [projectSnapshotWorker, encoded],
          {
            cwd: project,
            env,
            timeout: PROJECT_SNAPSHOT_TIMEOUT_MS,
            maxBuffer: MAX_PROJECT_SNAPSHOT_WORKER_BYTES,
            signal: job.controller.signal
          }
        );
        if (child?.aborted || job.controller.signal.aborted) {
          job.status = 'cancelled';
          job.cancelled_at = new Date().toISOString();
          pushJobEvent(job, {
            type: 'snapshot.cancelled',
            status: 'cancelled',
            title: 'Project snapshot operation cancelled',
            source: 'sciencecode'
          });
          return;
        }
        let payload;
        try {
          payload = JSON.parse(String(child?.stdout ?? '').trim());
        } catch {
          throw Object.assign(
            new Error('The project snapshot worker returned invalid JSON.'),
            { code: 'PROJECT_SNAPSHOT_WORKER_FAILED' }
          );
        }
        if (!payload?.ok) {
          throw Object.assign(
            new Error(payload?.error?.message ??
              'The project snapshot worker did not complete.'),
            { code: payload?.error?.code ?? 'PROJECT_SNAPSHOT_WORKER_FAILED' }
          );
        }
        if (child?.error || child?.status !== 0) {
          throw Object.assign(
            new Error('The project snapshot worker did not complete.'),
            { code: 'PROJECT_SNAPSHOT_WORKER_FAILED' }
          );
        }
        const report = operation === 'create'
          ? commitProjectSnapshotPending(project, payload.capture)
          : payload.report;
        if (!report ||
            report.schema_version !== PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION ||
            report.operation !== operation ||
            report.snapshot?.snapshot_id !== normalizedId ||
            typeof report.ok !== 'boolean' ||
            !Array.isArray(report.findings)) {
          throw Object.assign(
            new Error('The project snapshot worker returned an invalid report.'),
            { code: 'PROJECT_SNAPSHOT_WORKER_FAILED' }
          );
        }
        job.result = report;
        job.status = 'completed';
        pushJobEvent(job, {
          type: 'snapshot.finished',
          status: 'completed',
          title: operation === 'create'
            ? report.ok
              ? 'Immutable project baseline created and verified'
              : 'Project baseline created with immediate drift'
            : report.ok
              ? 'Project still matches the selected baseline'
              : 'Project snapshot verification found drift or integrity blockers',
          source: 'sciencecode'
        });
      } catch (error) {
        const cancelled = job.controller.signal.aborted ||
          error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
        job.status = cancelled ? 'cancelled' : 'failed';
        if (cancelled) job.cancelled_at = new Date().toISOString();
        else job.error = errorValue(error);
        pushJobEvent(job, {
          type: cancelled ? 'snapshot.cancelled' : 'snapshot.error',
          status: job.status,
          title: cancelled
            ? 'Project snapshot operation cancelled'
            : 'Project snapshot operation could not complete',
          source: 'sciencecode'
        });
      } finally {
        if (operation === 'create') {
          try {
            discardProjectSnapshotPending(project, normalizedId);
          } catch {
            // A malformed pending entry remains visible only to registry QA.
          }
          invalidateStateSnapshot();
        }
        job.finished_at = job.finished_at ?? new Date().toISOString();
        projectSnapshotBusy = false;
      }
    });
    return job;
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const hostError = untrustedHostError(request);
      if (hostError) {
        sendJson(response, hostError.status, { error: errorValue(hostError) });
        return;
      }
      if (request.method === 'POST') {
        const createMatch = url.pathname === '/api/chats';
        const evidenceCreate = url.pathname === '/api/evidence';
        const inferenceCreate = url.pathname === '/api/inferences';
        const simulationCreate = url.pathname === '/api/simulations';
        const experimentCreate = url.pathname === '/api/experiments';
        const projectGateCreate = url.pathname === '/api/project-gates';
        const projectSnapshotCreate = url.pathname === '/api/project-snapshots';
        const projectSnapshotVerifyMatch = url.pathname.match(
          /^\/api\/project-snapshots\/([^/]+)\/verifications$/
        );
        const campaignCreate = url.pathname === '/api/campaigns';
        const revisionCreate = url.pathname === '/api/revisions';
        const figureComparisonCreate =
          url.pathname === '/api/figure-comparisons';
        const figureRegistrationCreate =
          url.pathname === '/api/figure-registrations';
        const figureVisualCreate = url.pathname === '/api/figure-visuals';
        const reviewCreate = url.pathname === '/api/reviews';
        const preregistrationCreate = url.pathname === '/api/preregistrations';
        const analysisContractCreate = url.pathname === '/api/analysis-contracts';
        const literatureImportCreate = url.pathname === '/api/literature';
        const confirmatoryAssessmentCreate = url.pathname === '/api/analysis-assessments';
        const procedureCreate = url.pathname === '/api/procedures';
        const procedureAssessmentCreate =
          url.pathname === '/api/procedure-assessments';
        const procedureDecisionCreate = url.pathname === '/api/procedure-decisions';
        const simulationTemplateCreateMatch =
          url.pathname.match(/^\/api\/simulation-templates\/([^/]+)$/);
        const cadProjectCreate = url.pathname === '/api/cad/projects';
        const cadFileWriteMatch =
          url.pathname.match(/^\/api\/cad\/projects\/([^/]+)\/files\/(.+)$/);
        const cadBuildCreateMatch =
          url.pathname.match(/^\/api\/cad\/projects\/([^/]+)\/builds$/);
        const cadSimulationCreateMatch =
          url.pathname.match(/^\/api\/cad\/builds\/([^/]+)\/simulations$/);
        const cadModelCreateMatch =
          url.pathname.match(/^\/api\/cad\/builds\/([^/]+)\/models$/);
        const cadStudyCreateMatch =
          url.pathname.match(/^\/api\/cad\/builds\/([^/]+)\/studies$/);
        const cadSliceCreateMatch =
          url.pathname.match(/^\/api\/cad\/builds\/([^/]+)\/slices$/);
        const revisionDecisionMatch = url.pathname.match(/^\/api\/revisions\/([^/]+)\/decisions$/);
        const campaignDecisionMatch =
          url.pathname.match(/^\/api\/campaigns\/([^/]+)\/decisions$/);
        const campaignAssessmentMatch = url.pathname.match(
          /^\/api\/campaigns\/([^/]+)\/hypotheses\/([^/]+)\/assessments$/
        );
        const campaignAdvanceMatch =
          url.pathname.match(/^\/api\/campaigns\/([^/]+)\/advance$/);
        const campaignStopMatch =
          url.pathname.match(/^\/api\/campaigns\/([^/]+)\/stop$/);
        const campaignAbandonMatch =
          url.pathname.match(/^\/api\/campaigns\/([^/]+)\/abandon$/);
        const messageMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
        const interactionMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/interactions$/);
        const jobCancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
        const kernelMutationMatch = url.pathname.match(/^\/api\/kernels\/([^/]+)\/(execute|restore|restart|interrupt)$/);
        if (!createMatch && !evidenceCreate && !inferenceCreate &&
            !projectGateCreate &&
            !projectSnapshotCreate && !projectSnapshotVerifyMatch &&
            !simulationCreate && !experimentCreate && !campaignCreate &&
            !revisionCreate && !figureComparisonCreate &&
            !figureRegistrationCreate && !figureVisualCreate && !reviewCreate &&
            !preregistrationCreate && !analysisContractCreate &&
            !confirmatoryAssessmentCreate &&
            !procedureCreate && !procedureAssessmentCreate && !procedureDecisionCreate &&
            !simulationTemplateCreateMatch &&
            !cadProjectCreate && !cadFileWriteMatch && !cadBuildCreateMatch &&
            !cadSimulationCreateMatch && !cadModelCreateMatch &&
            !cadStudyCreateMatch && !cadSliceCreateMatch &&
            !revisionDecisionMatch && !campaignDecisionMatch &&
            !campaignAssessmentMatch && !campaignAdvanceMatch &&
            !campaignStopMatch && !campaignAbandonMatch &&
            !messageMatch && !interactionMatch && !jobCancelMatch && !kernelMutationMatch) {
          response.writeHead(405, {
            ...responseHeaders('text/plain; charset=utf-8'),
            Allow: 'GET, HEAD'
          });
          response.end('Method not allowed.\n');
          return;
        }
        const trustError = mutationRequestError(request);
        if (trustError) {
          sendJson(response, trustError.status, { error: errorValue(trustError) });
          return;
        }
        const body = await readJsonRequest(request,
          revisionCreate
            ? MAX_REVISION_JSON_BODY_BYTES
            : cadFileWriteMatch ? MAX_CAD_JSON_BODY_BYTES
            : preregistrationCreate ? MAX_PREREGISTRATION_JSON_BODY_BYTES
              : analysisContractCreate ? MAX_ANALYSIS_JSON_BODY_BYTES
              : procedureCreate ? MAX_PROCEDURE_JSON_BODY_BYTES
                : campaignCreate ? MAX_CAMPAIGN_JSON_BODY_BYTES
                : figureVisualCreate ? MAX_FIGURE_VISUAL_SPEC_BYTES
                : MAX_JSON_BODY_BYTES);
        if (!projectGateCreate && !projectSnapshotVerifyMatch) invalidateStateSnapshot();
        if (jobCancelMatch) {
          const jobId = decodeURIComponent(jobCancelMatch[1]);
          const job = jobs.get(jobId);
          if (!job) {
            sendJson(response, 404, {
              error: { code: 'JOB_NOT_FOUND', message: 'Harness job not found: ' + jobId }
            });
            return;
          }
          if (job.interruptible === false) {
            sendJson(response, 409, {
              error: {
                code: 'JOB_NOT_CANCELLABLE',
                message: 'This CAD operation must finish so its provenance record is not left partial.'
              }
            });
            return;
          }
          const jobKind = job.kind ?? 'chat';
          const bindingMatches = jobKind === 'chat'
            ? String(body.chat_id ?? '') === job.chat_id
            : jobKind === 'gate'
              ? body.kind === 'gate'
            : jobKind === 'snapshot'
              ? body.kind === 'snapshot' &&
                String(body.snapshot_id ?? '') === String(job.snapshot_id ?? '') &&
                body.operation === job.operation
            : ['inference', 'simulation', 'experiment'].includes(jobKind)
              ? body.kind === jobKind &&
                String(body.chat_id ?? '') === String(job.chat_id ?? '')
              : jobKind === 'cad'
                ? body.kind === 'cad' &&
                  String(body.cad_project_id ?? '') ===
                    String(job.cad_project_id ?? '') &&
                  String(body.build_id ?? '') === String(job.build_id ?? '') &&
                  body.operation === job.operation &&
                  String(body.chat_id ?? '') === String(job.chat_id ?? '')
                : body.kind === 'campaign' &&
                  String(body.campaign_id ?? '') === String(job.campaign_id ?? '') &&
                  String(body.task_id ?? '') === String(job.task_id ?? '') &&
                  String(body.chat_id ?? '') === String(job.chat_id ?? '');
          if (!bindingMatches) {
            sendJson(response, 409, {
              error: {
                code: jobKind === 'chat' ? 'JOB_CHAT_MISMATCH' : 'JOB_BINDING_MISMATCH',
                message: 'The cancellation request does not match the job binding.'
              }
            });
            return;
          }
          if (job.status === 'cancelling') {
            sendJson(response, 202, publicJob(job));
            return;
          }
          if (!['queued', 'running'].includes(job.status)) {
            sendJson(response, 409, {
              error: {
                code: 'JOB_NOT_CANCELLABLE',
                message: 'Harness job is already ' + job.status + '.'
              }
            });
            return;
          }
          const previousStatus = job.status;
          job.cancel_requested_at = new Date().toISOString();
          job.status = 'cancelling';
          pushJobEvent(job, {
            type: jobKind === 'chat'
              ? 'harness.cancel_requested'
              : jobKind === 'gate'
                ? 'gate.cancel_requested'
              : jobKind === 'snapshot'
                ? 'snapshot.cancel_requested'
              : jobKind === 'inference'
                ? 'inference.cancel_requested'
                : jobKind === 'simulation'
                  ? 'simulation.cancel_requested'
                  : jobKind === 'experiment'
                    ? 'experiment.cancel_requested'
                : jobKind === 'cad'
                  ? 'cad.' + job.operation + '.cancel_requested'
                  : 'campaign.cancel_requested',
            status: 'cancelling',
            title: jobKind === 'chat'
              ? 'User requested that the active AI turn stop'
              : jobKind === 'gate'
                ? 'User requested that project verification stop'
              : jobKind === 'snapshot'
                ? 'User requested that the project snapshot operation stop'
              : jobKind === 'inference'
                ? 'User requested that the active inference stop'
                : jobKind === 'simulation'
                  ? 'User requested that the active simulation stop'
                  : jobKind === 'experiment'
                    ? 'User requested that the active experiment stop'
                : jobKind === 'cad'
                  ? job.operation === 'study'
                    ? 'User requested that the active CAD parameter study stop'
                    : 'User requested that the active CAD-linked model stop'
                  : 'User requested that the active campaign task stop',
            source: 'sciencecode'
          });
          if (job.chat_id) {
            try {
              const interaction = recordInteraction({
                cwd: project,
                chatId: job.chat_id,
                surface: jobKind === 'chat'
                  ? 'design'
                  : jobKind === 'inference'
                    ? 'inference'
                    : jobKind === 'simulation' || jobKind === 'experiment'
                      ? jobKind
                    : jobKind === 'cad' ? 'cad' : 'campaign',
                action: jobKind === 'chat'
                  ? 'turn.cancel_requested'
                  : jobKind === 'inference'
                    ? 'run.cancel_requested'
                    : jobKind === 'simulation' || jobKind === 'experiment'
                      ? 'run.cancel_requested'
                    : jobKind === 'cad'
                      ? job.operation === 'study'
                        ? 'study.cancel_requested'
                        : 'model.cancel_requested'
                      : 'task.cancel_requested',
                artifact: jobKind === 'inference' && job.inference_id ? {
                  kind: 'inference',
                  record_id: job.inference_id,
                  name: job.request?.model ?? 'NPU hardware smoke',
                  url: '/api/inferences/' + encodeURIComponent(job.inference_id)
                } : jobKind === 'simulation' && job.simulation_id ? {
                  kind: 'simulation',
                  record_id: job.simulation_id,
                  name: job.request?.script ?? job.simulation_id,
                  url: '/api/simulations/' + encodeURIComponent(job.simulation_id)
                } : jobKind === 'experiment' && job.experiment_id ? {
                  kind: 'experiment',
                  record_id: job.experiment_id,
                  name: job.request?.name ?? job.request?.script ?? job.experiment_id,
                  url: '/api/experiments/' + encodeURIComponent(job.experiment_id)
                } : jobKind === 'campaign' && job.campaign_id
                  ? campaignInteractionArtifact(
                    campaignProvider.get({
                      cwd: project,
                      campaignId: job.campaign_id
                    })
                  )
                  : jobKind === 'cad' && job.cad_project_id
                    ? cadInteractionArtifact(
                      job.cad_project_id,
                      getCadProject(project, job.cad_project_id).descriptor.name,
                      '/api/cad/projects/' +
                        encodeURIComponent(job.cad_project_id)
                    )
                    : null,
                payload: {
                  job_id: job.job_id,
                  campaign_id: job.campaign_id ?? null,
                  task_id: job.task_id ?? null,
                  cad_project_id: job.cad_project_id ?? null,
                  build_id: job.build_id ?? null,
                  simulation_id: job.simulation_id ?? null,
                  experiment_id: job.experiment_id ?? null,
                  script: job.request?.script ?? null,
                  device: job.request?.device ?? null,
                  prior_status: previousStatus,
                  requested_at: job.cancel_requested_at,
                  note: jobKind === 'chat'
                    ? 'The user stopped the active AI turn. Treat any partial output as incomplete and do not continue it unless asked.'
                    : jobKind === 'inference'
                      ? 'The user stopped the accelerator job. Treat its partial outputs as incomplete.'
                      : jobKind === 'simulation'
                        ? 'The user stopped this simulation. Treat its partial artifacts as incomplete and inspect the cancelled immutable record before retrying.'
                        : jobKind === 'experiment'
                          ? 'The user stopped this experiment matrix. Treat completed branches as partial evidence and inspect the cancelled immutable record before retrying.'
                      : jobKind === 'cad'
                        ? job.operation === 'study'
                          ? 'The user stopped this CAD parameter study. Treat completed branches as partial evidence, untouched branches as not run, and inspect the cancelled immutable experiment record before retrying.'
                          : 'The user stopped this CAD-linked model. Treat partial artifacts as incomplete and inspect the cancelled immutable simulation record before retrying.'
                        : 'The user stopped this campaign task. Treat partial output as incomplete and require a new checkpoint before retry.'
                }
              });
              job.cancellation_interaction_id = interaction.interaction_id;
            } catch (error) {
              job.cancellation_interaction_error = errorValue(error);
            }
          }
          job.controller.abort('user_requested');
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (projectSnapshotCreate) {
          normalizeProjectSnapshotCreate(body);
          const job = queueProjectSnapshot({
            operation: 'create',
            snapshotId: makeProjectSnapshotId(),
            strict: true
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (projectSnapshotVerifyMatch) {
          const snapshotId = decodeURIComponent(projectSnapshotVerifyMatch[1]);
          const options = normalizeProjectSnapshotVerification(body);
          const job = queueProjectSnapshot({
            operation: 'verify',
            snapshotId,
            strict: options.strict
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (projectGateCreate) {
          const policy = normalizeProjectGateLaunch(body);
          const job = queueProjectGate(policy);
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (simulationCreate || experimentCreate) {
          const kind = experimentCreate ? 'experiment' : 'simulation';
          const options = normalizeScientificComputeLaunch(body, kind);
          const job = queueScientificComputeOperation({ kind, options });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (simulationTemplateCreateMatch) {
          const name = decodeURIComponent(simulationTemplateCreateMatch[1]);
          const options = simulationTemplateRequest(body);
          if (options.chatId) getChatSession(project, options.chatId);
          const initialized = initializeSimulationTemplate(project, name, {
            packageRoot: resolvedPackageRoot,
            reuseExact: true
          });
          const relativeFile = relativePortable(project, initialized.file);
          let interaction = null;
          let interactionError = null;
          if (options.chatId) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: options.chatId,
                surface: name.startsWith('cad-') ? 'cad' : 'simulation',
                action: name.startsWith('cad-')
                  ? initialized.created
                    ? 'model.template.installed'
                    : 'model.template.reused'
                  : initialized.created
                    ? 'template.installed'
                    : 'template.reused',
                artifact: {
                  kind: 'project-file',
                  record_id: initialized.sha256,
                  name: relativeFile,
                  url: null
                },
                payload: {
                  template: initialized.template,
                  file: relativeFile,
                  sha256: initialized.sha256,
                  created: initialized.created,
                  status: initialized.created ? 'installed' : 'already_installed',
                  note: options.note
                }
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, initialized.created ? 201 : 200, {
            template: {
              name: initialized.template,
              file: relativeFile,
              sha256: initialized.sha256,
              created: initialized.created
            },
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (cadProjectCreate) {
          const options = cadRequest(body, 'create');
          if (options.chatId) getChatSession(project, options.chatId);
          const created = initializeCadProject({
            cwd: project,
            name: options.name,
            cadProjectId: options.cadProjectId,
            engine: options.engine
          });
          let interaction = null;
          let interactionError = null;
          if (options.chatId) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: options.chatId,
                surface: 'cad',
                action: 'project.created',
                artifact: cadInteractionArtifact(
                  created.descriptor.cad_project_id,
                  created.descriptor.name,
                  '/api/cad/projects/' +
                    encodeURIComponent(created.descriptor.cad_project_id)
                ),
                payload: cadInteractionPayload({
                  cad_project_id: created.descriptor.cad_project_id,
                  status: 'editable',
                  engine: created.descriptor.engine,
                  file_count: created.files.length,
                  part_count: created.descriptor.parts.length,
                  printer_transmission: 'disabled',
                  note: options.note
                })
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            project: getCadProject(project, created.descriptor.cad_project_id),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (cadFileWriteMatch) {
          const cadProjectId = decodeURIComponent(cadFileWriteMatch[1]);
          const file = decodeURIComponent(cadFileWriteMatch[2]);
          const options = cadRequest(body, 'write');
          if (options.chatId) getChatSession(project, options.chatId);
          const result = writeCadFile({
            cwd: project,
            cadProjectId,
            file,
            content: options.content,
            expectedSha256: options.expectedSha256,
            actor: options.actor
          });
          let interaction = null;
          let interactionError = null;
          if (options.chatId && result.changed) {
            try {
              const detail = getCadProject(project, cadProjectId);
              interaction = recordInteraction({
                cwd: project,
                chatId: options.chatId,
                surface: 'cad',
                action: 'source.edited',
                artifact: cadInteractionArtifact(
                  cadProjectId,
                  detail.descriptor.name,
                  '/api/cad/projects/' + encodeURIComponent(cadProjectId)
                ),
                payload: cadInteractionPayload({
                  cad_project_id: cadProjectId,
                  file: result.file,
                  characters: result.content.length,
                  sha256: result.sha256,
                  revision_id: result.revision?.revision_id ?? null,
                  note: options.note
                })
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 200, {
            file: result,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (cadBuildCreateMatch) {
          const cadProjectId = decodeURIComponent(cadBuildCreateMatch[1]);
          getCadProject(project, cadProjectId);
          const options = cadRequest(body, 'build');
          const job = queueCadOperation({
            operation: 'build',
            cadProjectId,
            chatId: options.chatId,
            note: options.note,
            request: {
              operation: 'build',
              cad_project_id: cadProjectId,
              timeout_ms: options.timeoutMs
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (cadSimulationCreateMatch) {
          const buildId = decodeURIComponent(cadSimulationCreateMatch[1]);
          const build = getCadBuild(project, buildId).manifest;
          const options = cadRequest(body, 'simulate');
          const job = queueCadOperation({
            operation: 'simulate',
            cadProjectId: build.cad_project_id,
            buildId,
            chatId: options.chatId,
            note: options.note,
            request: {
              operation: 'simulate',
              build_id: buildId,
              density_g_cm3: options.densityGcm3,
              maximum_severe_overhang_fraction:
                options.maximumSevereOverhangFraction
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (cadModelCreateMatch) {
          const buildId = decodeURIComponent(cadModelCreateMatch[1]);
          const build = getCadBuild(project, buildId).manifest;
          const options = cadRequest(body, 'model');
          if (options.device === 'auto' || options.device.startsWith('cuda')) {
            const compute = currentCompute(true);
            const gpuIndex = options.device.includes(':')
              ? Number(options.device.split(':')[1])
              : 0;
            const gpu = compute.gpu?.devices?.find((item) =>
              Number(item.index) === gpuIndex) ?? null;
            if (options.device.startsWith('cuda') && !gpu) {
              throw Object.assign(new Error(
                'CUDA was requested but the selected NVIDIA GPU is unavailable.'
              ), { code: 'CAD_GPU_UNAVAILABLE', status: 409 });
            }
            if (gpu && (!Number.isFinite(Number(gpu.memory_free_mib)) ||
                Number(gpu.memory_free_mib) < options.minimumFreeGpuMib)) {
              throw Object.assign(new Error(
                'CAD model launch refused: GPU ' + String(gpu.index) + ' has ' +
                String(gpu.memory_free_mib ?? 'unknown') +
                ' MiB free; choose CPU or free at least ' +
                String(options.minimumFreeGpuMib) + ' MiB.'
              ), {
                code: 'CAD_GPU_MEMORY_LOW',
                status: 409,
                gpu
              });
            }
          }
          const job = queueCadModelOperation({
            cadProjectId: build.cad_project_id,
            buildId,
            chatId: options.chatId,
            note: options.note,
            options
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (cadStudyCreateMatch) {
          const buildId = decodeURIComponent(cadStudyCreateMatch[1]);
          const build = getCadBuild(project, buildId).manifest;
          const options = cadRequest(body, 'study');
          if (options.device === 'auto' || options.device.startsWith('cuda')) {
            const compute = currentCompute(true);
            const gpuIndex = options.device.includes(':')
              ? Number(options.device.split(':')[1])
              : 0;
            const gpu = compute.gpu?.devices?.find((item) =>
              Number(item.index) === gpuIndex) ?? null;
            if (options.device.startsWith('cuda') && !gpu) {
              throw Object.assign(new Error(
                'CUDA was requested but the selected NVIDIA GPU is unavailable.'
              ), { code: 'CAD_GPU_UNAVAILABLE', status: 409 });
            }
            if (gpu && (!Number.isFinite(Number(gpu.memory_free_mib)) ||
                Number(gpu.memory_free_mib) < options.minimumFreeGpuMib)) {
              throw Object.assign(new Error(
                'CAD study launch refused: GPU ' + String(gpu.index) + ' has ' +
                String(gpu.memory_free_mib ?? 'unknown') +
                ' MiB free; choose CPU or free at least ' +
                String(options.minimumFreeGpuMib) + ' MiB.'
              ), {
                code: 'CAD_GPU_MEMORY_LOW',
                status: 409,
                gpu
              });
            }
          }
          const studyTimeoutMs = Math.min(
            MAX_CAD_STUDY_WALL_CLOCK_MS,
            options.timeoutMs * options.branchCount + 60_000
          );
          const job = queueCadOperation({
            operation: 'study',
            cadProjectId: build.cad_project_id,
            buildId,
            chatId: options.chatId,
            note: options.note,
            request: {
              operation: 'study',
              build_id: buildId,
              script: options.script,
              device: options.device,
              seeds: options.seeds,
              parameters: options.parameters,
              variations: options.variations,
              script_args: options.scriptArgs,
              inputs: options.inputs,
              name: options.name,
              hypothesis: options.hypothesis,
              branch_count: options.branchCount,
              timeout_ms: options.timeoutMs,
              study_timeout_ms: studyTimeoutMs
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (cadSliceCreateMatch) {
          const buildId = decodeURIComponent(cadSliceCreateMatch[1]);
          const build = getCadBuild(project, buildId).manifest;
          const options = cadRequest(body, 'slice');
          const job = queueCadOperation({
            operation: 'slice',
            cadProjectId: build.cad_project_id,
            buildId,
            chatId: options.chatId,
            note: options.note,
            request: {
              operation: 'slice',
              build_id: buildId,
              mode: options.mode,
              profile_path: options.profilePath,
              acknowledge_physical_risk: options.acknowledgePhysicalRisk,
              settings: options.settings,
              timeout_ms: options.timeoutMs
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (campaignCreate) {
          const options = campaignRequest(body, 'create');
          const created = campaignProvider.create({
            cwd: project,
            spec: options.spec,
            chatId: options.chatId
          });
          const detail = campaignProvider.get({
            cwd: project,
            campaignId: created.manifest.campaign_id
          });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: detail.manifest.chat_id,
              surface: 'campaign',
              action: 'created',
              artifact: campaignInteractionArtifact(detail),
              payload: campaignInteractionPayload(detail, options.note)
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            campaign: detail,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (campaignDecisionMatch) {
          const campaignId = decodeURIComponent(campaignDecisionMatch[1]);
          const options = campaignRequest(body, 'decide');
          const event = campaignProvider.decide({
            cwd: project,
            campaignId,
            taskId: options.taskId,
            decision: options.decision,
            note: options.note
          });
          const detail = campaignProvider.get({ cwd: project, campaignId });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: detail.manifest.chat_id,
              surface: 'campaign',
              action: 'checkpoint.' + options.decision,
              artifact: campaignInteractionArtifact(detail),
              payload: {
                ...campaignInteractionPayload(detail, options.note),
                task_id: options.taskId,
                attempt: event.payload.attempt,
                decision: options.decision,
                event_id: event.event_id
              }
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            event,
            campaign: detail,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (campaignAssessmentMatch) {
          const campaignId = decodeURIComponent(campaignAssessmentMatch[1]);
          const hypothesisId = decodeURIComponent(campaignAssessmentMatch[2]);
          const options = campaignRequest(body, 'assess');
          const event = campaignProvider.assess({
            cwd: project,
            campaignId,
            hypothesisId,
            verdict: options.verdict,
            decision: options.decision,
            rationale: options.rationale,
            taskIds: options.taskIds
          });
          const detail = campaignProvider.get({ cwd: project, campaignId });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: detail.manifest.chat_id,
              surface: 'campaign',
              action: 'hypothesis.assessed',
              artifact: campaignInteractionArtifact(detail),
              payload: {
                ...campaignInteractionPayload(detail),
                hypothesis_id: hypothesisId,
                verdict: options.verdict,
                decision: options.decision,
                rationale: options.rationale,
                task_ids: options.taskIds,
                event_id: event.event_id,
                human_checkpoint: true,
                ai_generated: false
              }
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            event,
            campaign: detail,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (campaignStopMatch) {
          const campaignId = decodeURIComponent(campaignStopMatch[1]);
          const options = campaignRequest(body, 'stop');
          const event = campaignProvider.stop({
            cwd: project,
            campaignId,
            reason: options.reason
          });
          const detail = campaignProvider.get({ cwd: project, campaignId });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: detail.manifest.chat_id,
              surface: 'campaign',
              action: 'stopped',
              artifact: campaignInteractionArtifact(detail),
              payload: {
                ...campaignInteractionPayload(detail),
                reason: options.reason,
                event_id: event.event_id
              }
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            event,
            campaign: detail,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (campaignAbandonMatch) {
          const campaignId = decodeURIComponent(campaignAbandonMatch[1]);
          const options = campaignRequest(body, 'abandon');
          const event = campaignProvider.abandon({
            cwd: project,
            campaignId,
            taskId: options.taskId,
            reason: options.reason
          });
          const detail = campaignProvider.get({ cwd: project, campaignId });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: detail.manifest.chat_id,
              surface: 'campaign',
              action: 'task.abandoned',
              artifact: campaignInteractionArtifact(detail),
              payload: {
                ...campaignInteractionPayload(detail),
                task_id: options.taskId,
                reason: options.reason,
                event_id: event.event_id
              }
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            event,
            campaign: detail,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (campaignAdvanceMatch) {
          const campaignId = decodeURIComponent(campaignAdvanceMatch[1]);
          const options = campaignRequest(body, 'advance');
          const detail = campaignProvider.get({ cwd: project, campaignId });
          const taskId = options.taskId ?? detail.state.tasks.find(
            (task) => task.status === 'ready'
          )?.task_id ?? null;
          if (!taskId) {
            throw Object.assign(new Error('No campaign task is ready to advance.'), {
              code: 'CAMPAIGN_CHECKPOINT_REQUIRED'
            });
          }
          const task = detail.state.tasks.find((candidate) =>
            candidate.task_id === taskId);
          if (!task) {
            throw Object.assign(new Error('Campaign task not found: ' + taskId), {
              code: 'CAMPAIGN_TASK_NOT_FOUND'
            });
          }
          if (task.status !== 'ready') {
            const checkpoint = ['awaiting_approval', 'checkpoint_rejected']
              .includes(task.status);
            throw Object.assign(
              new Error(
                checkpoint
                  ? 'Campaign task requires an explicit checkpoint before advance.'
                  : 'Campaign task cannot advance while ' + task.status + '.'
              ),
              {
                code: task.status === 'running'
                  ? 'CAMPAIGN_BUSY'
                  : checkpoint
                    ? 'CAMPAIGN_CHECKPOINT_REQUIRED'
                    : 'CAMPAIGN_TASK_NOT_ACTIONABLE'
              }
            );
          }
          const chatId = detail.manifest.chat_id;
          if (busyChats.has(chatId)) {
            throw Object.assign(
              new Error('The linked campaign conversation already has an active turn.'),
              { code: 'CAMPAIGN_BUSY' }
            );
          }
          pruneJobs();
          if (jobs.size >= MAX_LAB_JOBS) {
            throw Object.assign(new Error('The local harness job queue is full.'), {
              code: 'JOB_QUEUE_FULL',
              status: 503
            });
          }
          const job = {
            job_id: makeJobId(),
            kind: 'campaign',
            campaign_id: campaignId,
            task_id: taskId,
            chat_id: chatId,
            status: 'queued',
            created_at: new Date().toISOString(),
            controller: new AbortController(),
            events: [],
            response_blocks: [],
            response_sequence: 0,
            response_received_blocks: 0,
            response_retained_bytes: 0,
            response_omitted_blocks: 0,
            response_omitted_bytes: 0,
            request: {
              campaign_id: campaignId,
              task_id: taskId,
              attempt: task.next_attempt,
              lane: task.lane,
              compute: task.compute,
              risk: task.risk
            }
          };
          pushJobEvent(job, {
            type: 'campaign.queued',
            status: 'queued',
            title: 'Queued one bounded research campaign task',
            campaign_id: campaignId,
            task_id: taskId,
            source: 'sciencecode'
          });
          jobs.set(job.job_id, job);
          busyChats.add(chatId);
          setImmediate(async () => {
            if (job.controller.signal.aborted) {
              job.status = 'cancelled';
              job.cancelled_at = new Date().toISOString();
              job.finished_at = job.cancelled_at;
              pushJobEvent(job, {
                type: 'campaign.cancelled',
                status: 'cancelled',
                title: 'Queued campaign task cancelled before engine launch',
                source: 'sciencecode'
              });
              busyChats.delete(chatId);
              return;
            }
            job.status = 'running';
            job.started_at = new Date().toISOString();
            pushJobEvent(job, {
              type: 'campaign.dispatch',
              status: 'running',
              title: 'Dispatching one task to the recorded Scientist conversation',
              campaign_id: campaignId,
              task_id: taskId,
              source: 'sciencecode'
            });
            try {
              const send = chatProvider.sendAsync ?? chatProvider.send;
              const result = await campaignProvider.runAsync({
                cwd: project,
                campaignId,
                taskId,
                packageRoot: resolvedPackageRoot,
                configDir,
                env,
                sender: send.bind(chatProvider),
                signal: job.controller.signal,
                onEvent(event) {
                  pushJobEvent(job, event);
                }
              });
              job.status = result.status === 'completed'
                ? 'completed'
                : result.status === 'cancelled' ? 'cancelled' : 'failed';
              job.result = {
                campaign_id: campaignId,
                task_id: result.task_id,
                attempt: result.attempt,
                status: result.status,
                chat_id: chatId,
                turn_index: result.turn.turn_index,
                run_id: result.turn.run_id,
                event_id: result.event.event_id,
                event_sha256: result.event.event_sha256,
                manifest_sha256: result.campaign.verification.manifest_sha256,
                campaign_status: result.campaign.state.status
              };
              if (job.status === 'cancelled') {
                job.cancelled_at = result.turn.cancellation?.cancelled_at ??
                  new Date().toISOString();
              }
              try {
                const interaction = recordInteraction({
                  cwd: project,
                  chatId,
                  surface: 'campaign',
                  action: 'task.' + result.status,
                  artifact: campaignInteractionArtifact(result.campaign),
                  payload: {
                    ...campaignInteractionPayload(result.campaign),
                    job_id: job.job_id,
                    task_id: result.task_id,
                    attempt: result.attempt,
                    run_id: result.turn.run_id,
                    turn_index: result.turn.turn_index,
                    event_id: result.event.event_id
                  }
                });
                job.interaction_id = interaction.interaction_id;
              } catch (error) {
                job.interaction_error = errorValue(error);
              }
              if (!job.events.some((event) =>
                event.type === 'campaign.task.finished')) {
                pushJobEvent(job, {
                  type: 'campaign.task.finished',
                  status: result.status,
                  title: result.status === 'completed'
                    ? 'Campaign task completed; next action requires a human'
                    : result.status === 'cancelled'
                      ? 'Campaign task stopped; partial records were preserved'
                      : 'Campaign task failed; retry requires a new checkpoint',
                  campaign_id: campaignId,
                  task_id: taskId,
                  source: 'sciencecode'
                });
              }
            } catch (error) {
              if (job.controller.signal.aborted) {
                job.status = 'cancelled';
                job.cancelled_at = new Date().toISOString();
                pushJobEvent(job, {
                  type: 'campaign.cancelled',
                  status: 'cancelled',
                  title: 'Campaign task stopped; available records were preserved',
                  source: 'sciencecode'
                });
              } else {
                job.status = 'failed';
                job.error = errorValue(error);
                pushJobEvent(job, {
                  type: 'campaign.error',
                  status: 'failed',
                  title: redactText(error.message),
                  source: 'sciencecode'
                });
              }
            } finally {
              job.finished_at = new Date().toISOString();
              busyChats.delete(chatId);
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (inferenceCreate) {
          const options = normalizeInferenceLaunch(body);
          if (options.chatId) getChatSession(project, options.chatId);
          pruneJobs();
          if (jobs.size >= MAX_LAB_JOBS) {
            throw Object.assign(new Error('The local harness job queue is full.'), {
              code: 'JOB_QUEUE_FULL',
              status: 503
            });
          }
          if (inferenceBusy) {
            throw Object.assign(new Error('Another accelerator inference is already running.'), {
              code: 'INFERENCE_BUSY'
            });
          }
          const createdAt = new Date().toISOString();
          const job = {
            job_id: makeJobId(),
            kind: 'inference',
            chat_id: options.chatId,
            inference_id: null,
            status: 'queued',
            created_at: createdAt,
            controller: new AbortController(),
            events: [],
            request: {
              mode: options.mode,
              model: options.model,
              input: options.input,
              device: options.device,
              allow_fallback: options.allowFallback,
              warmup_iterations: options.warmup,
              iterations: options.iterations,
              timeout_seconds: options.timeoutSeconds,
              linked_to_chat: Boolean(options.chatId)
            }
          };
          pushJobEvent(job, {
            type: 'inference.queued',
            status: 'queued',
            title: options.smoke
              ? 'Queued the deterministic accelerator smoke'
              : 'Queued the project ONNX model',
            source: 'sciencecode'
          });
          jobs.set(job.job_id, job);
          inferenceBusy = true;
          setImmediate(async () => {
            if (job.controller.signal.aborted) {
              job.status = 'cancelled';
              job.cancelled_at = new Date().toISOString();
              job.finished_at = job.cancelled_at;
              pushJobEvent(job, {
                type: 'inference.cancelled',
                status: 'cancelled',
                title: 'Queued inference cancelled before runtime launch',
                source: 'sciencecode'
              });
              inferenceBusy = false;
              return;
            }
            job.status = 'running';
            job.started_at = new Date().toISOString();
            pushJobEvent(job, {
              type: 'inference.dispatch',
              status: 'running',
              title: 'Dispatching the isolated ONNX inference worker',
              source: 'sciencecode'
            });
            try {
              const compute = currentCompute(false);
              const npuRuntime = compute?.runtimes?.npu;
              const result = await inferenceProvider.run({
                cwd: project,
                packageRoot: resolvedPackageRoot,
                model: options.model,
                input: options.input,
                smoke: options.smoke,
                device: options.device,
                allowFallback: options.allowFallback,
                warmup: options.warmup,
                iterations: options.iterations,
                timeoutMs: options.timeoutMs,
                env,
                runtime: npuRuntime?.healthy ? npuRuntime : null,
                signal: job.controller.signal,
                onEvent(event) {
                  if (event?.inference_id) job.inference_id = event.inference_id;
                  pushJobEvent(job, event);
                }
              });
              job.inference_id = result.manifest.inference_id;
              job.status = result.manifest.status;
              job.result = {
                inference_id: result.manifest.inference_id,
                status: result.manifest.status,
                device_request: result.manifest.device_request,
                npu_executed: result.manifest.provider_verification?.npu_executed === true,
                fallback_detected:
                  result.manifest.provider_verification?.fallback_detected ?? null,
                manifest_sha256: result.manifest_sha256 ?? null
              };
              if (!job.events.some((event) => event.type === 'inference.finished')) {
                pushJobEvent(job, {
                  type: 'inference.finished',
                  status: job.status,
                  title: job.status === 'completed'
                    ? 'Recorded accelerator inference completed'
                    : job.status === 'cancelled'
                      ? 'Inference stopped; partial artifacts were preserved'
                      : 'Inference failed; logs and partial artifacts were preserved',
                  inference_id: job.inference_id,
                  source: 'sciencecode'
                });
              }
              if (job.status === 'cancelled') {
                job.cancelled_at = result.manifest.cancellation?.cancelled_at ??
                  new Date().toISOString();
              } else if (options.chatId) {
                try {
                  const interaction = recordInteraction({
                    cwd: project,
                    chatId: options.chatId,
                    surface: 'inference',
                    action: job.status === 'completed' ? 'run.completed' : 'run.failed',
                    artifact: {
                      kind: 'inference',
                      record_id: result.manifest.inference_id,
                      name: result.manifest.model?.path ??
                        result.manifest.model?.source ??
                        result.manifest.inference_id,
                      url: '/api/inferences/' +
                        encodeURIComponent(result.manifest.inference_id)
                    },
                    payload: {
                      job_id: job.job_id,
                      status: job.status,
                      device_request: result.manifest.device_request,
                      npu_executed:
                        result.manifest.provider_verification?.npu_executed === true,
                      fallback_detected:
                        result.manifest.provider_verification?.fallback_detected ?? null,
                      note: options.note
                    }
                  });
                  job.interaction_id = interaction.interaction_id;
                } catch (error) {
                  job.interaction_error = errorValue(error);
                }
              }
            } catch (error) {
              if (job.controller.signal.aborted) {
                job.status = 'cancelled';
                job.cancelled_at = new Date().toISOString();
                pushJobEvent(job, {
                  type: 'inference.cancelled',
                  status: 'cancelled',
                  title: 'Inference stopped before a complete record was published',
                  source: 'sciencecode'
                });
              } else {
                job.status = 'failed';
                job.error = errorValue(error);
                pushJobEvent(job, {
                  type: 'inference.error',
                  status: 'failed',
                  title: redactText(error.message),
                  source: 'sciencecode'
                });
              }
            } finally {
              job.finished_at = new Date().toISOString();
              inferenceBusy = false;
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        if (procedureCreate) {
          const created = createProcedure({
            cwd: project,
            spec: body.spec,
            chatId: body.chat_id
          });
          let interaction = null;
          let interactionError = null;
          if (created.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: created.manifest.chat_id,
                surface: 'procedure',
                action: 'plan.created',
                artifact: procedureInteractionArtifact(created),
                payload: procedureInteractionPayload(created, body.note)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            procedure: getProcedure(project, created.manifest.procedure_id),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (procedureAssessmentCreate) {
          const created = createProcedureAssessment({
            cwd: project,
            procedureId: body.procedure_id,
            chatId: body.chat_id
          });
          let interaction = null;
          let interactionError = null;
          if (created.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: created.manifest.chat_id,
                surface: 'procedure',
                action: 'assessment.created',
                artifact: procedureAssessmentInteractionArtifact(created),
                payload: procedureAssessmentInteractionPayload(created, body.note)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            assessment: getProcedureAssessment(
              project, created.manifest.procedure_assessment_id),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (procedureDecisionCreate) {
          const created = createProcedureDecision({
            cwd: project,
            input: body.input,
            chatId: body.chat_id
          });
          let interaction = null;
          let interactionError = null;
          if (created.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: created.manifest.chat_id,
                surface: 'procedure',
                action: 'decision.recorded',
                artifact: procedureDecisionInteractionArtifact(created),
                payload: procedureDecisionInteractionPayload(created, body.note)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            decision: getProcedureDecision(
              project, created.manifest.procedure_decision_id),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (preregistrationCreate) {
          const options = preregistrationRequest(body);
          if (options.chatId) getChatSession(project, options.chatId);
          const created = freezePreregistrationContent(
            project,
            options.content,
            { name: options.name }
          );
          const verification = verifyPreregistration(
            project, created.preregistration_id
          );
          if (!verification.ok) {
            throw Object.assign(
              new Error('New preregistration failed integrity verification.'),
              { code: 'PREREGISTRATION_INVALID', verification }
            );
          }
          let interaction = null;
          let interactionError = null;
          if (options.chatId) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: options.chatId,
                surface: 'analysis',
                action: 'preregistration.frozen',
                artifact: preregistrationInteractionArtifact(created),
                payload: preregistrationInteractionPayload(
                  created, verification, options.note
                )
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            preregistration: {
              record: created,
              verification,
              source_url: '/api/preregistrations/' +
                encodeURIComponent(created.preregistration_id) + '/source'
            },
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (analysisContractCreate) {
          const created = createAnalysisContract({
            cwd: project,
            spec: body.spec,
            chatId: body.chat_id
          });
          let interaction = null;
          let interactionError = null;
          if (created.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: created.manifest.chat_id,
                surface: 'analysis',
                action: 'contract.frozen',
                artifact: analysisContractInteractionArtifact(created),
                payload: analysisContractInteractionPayload(created)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            analysis_contract: getAnalysisContract(
              project,
              created.manifest.analysis_contract_id
            ),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (literatureImportCreate) {
          // Offline import of a saved API response only; the Lab performs no
          // network access. Live fetches stay behind the explicit CLI command.
          const created = importLiteratureResponse({
            cwd: project,
            source: body.source,
            identifier: body.identifier,
            file: body.file
          });
          let interaction = null;
          let interactionError = null;
          if (body.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: body.chat_id,
                surface: 'literature',
                action: 'record.imported',
                artifact: literatureInteractionArtifact(created),
                payload: literatureInteractionPayload(created, body.note ?? null)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            literature: getLiteratureRecord(project, created.manifest.literature_id),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (confirmatoryAssessmentCreate) {
          const created = createConfirmatoryAssessment({
            cwd: project,
            contractId: body.analysis_contract_id,
            experimentId: body.experiment_id,
            chatId: body.chat_id,
            deviationNote: body.deviation_note
          });
          let interaction = null;
          let interactionError = null;
          if (created.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: created.manifest.chat_id,
                surface: 'analysis',
                action: 'assessment.created',
                artifact: confirmatoryAssessmentInteractionArtifact(created),
                payload: confirmatoryAssessmentInteractionPayload(created)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            assessment: getConfirmatoryAssessment(
              project,
              created.manifest.analysis_assessment_id
            ),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (figureComparisonCreate) {
          const comparison = createFigureComparison({
            cwd: project,
            chatId: body.chat_id,
            baseline: body.baseline,
            candidate: body.candidate,
            name: body.name,
            note: body.note,
            pixelTolerance: body.pixel_tolerance,
            maximumChangedFraction: body.maximum_changed_fraction,
            minimumStructuralSimilarity:
              body.minimum_structural_similarity
          });
          let interaction = null;
          let interactionError = null;
          if (comparison.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: comparison.manifest.chat_id,
                surface: 'figure',
                action: 'comparison.created',
                artifact: figureComparisonInteractionArtifact(comparison),
                payload: figureComparisonInteractionPayload(comparison)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            comparison,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (figureRegistrationCreate) {
          const { chat_id: chatId, ...rawSpec } = body;
          const spec = normalizeFigureRegistrationSpec(rawSpec);
          const registration = createFigureRegistration({
            cwd: project,
            chatId,
            figure: spec.figure,
            source: spec.source,
            sidecar: spec.sidecar,
            contract: spec.contract,
            name: spec.name,
            note: spec.note
          });
          let interaction = null;
          let interactionError = null;
          if (registration.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: registration.manifest.chat_id,
                surface: 'figure',
                action: 'registration.created',
                artifact: figureRegistrationInteractionArtifact(registration),
                payload: figureRegistrationInteractionPayload(registration)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            registration,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (figureVisualCreate) {
          const { chat_id: chatId, ...rawSpec } = body;
          const spec = normalizeFigureVisualSpec(rawSpec);
          const visual = createFigureVisual({
            cwd: project,
            chatId,
            figureRegistrationId: spec.figure_registration_id,
            profile: spec.profile,
            name: spec.name,
            note: spec.note
          });
          let interaction = null;
          let interactionError = null;
          if (visual.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd: project,
                chatId: visual.manifest.chat_id,
                surface: 'figure',
                action: 'visual.created',
                artifact: figureVisualInteractionArtifact(visual),
                payload: figureVisualInteractionPayload(visual)
              });
            } catch (error) {
              interactionError = errorValue(error);
            }
          }
          sendJson(response, 201, {
            visual,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (reviewCreate) {
          const review = createSemanticReview({
            cwd: project,
            chatId: body.chat_id,
            source: body.source,
            revisionId: body.revision_id
          });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: review.manifest.chat_id,
              surface: 'review',
              action: 'semantic-review.created',
              artifact: semanticReviewInteractionArtifact(review),
              payload: semanticReviewInteractionPayload(review)
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            review,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (revisionCreate) {
          const created = createArtifactRevision({
            cwd: project,
            chatId: body.chat_id,
            source: body.source,
            content: revisionContent(body),
            name: body.name,
            mediaType: body.media_type,
            note: body.note,
            previousRevisionId: body.previous_revision_id
          });
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: created.chat_id,
              surface: 'artifact',
              action: 'revision.proposed',
              artifact: revisionInteractionArtifact(created),
              payload: revisionInteractionPayload(created, {
                status: 'proposed', note: created.note
              })
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            revision: getArtifactRevision(project, created.revision_id),
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (revisionDecisionMatch) {
          const revisionId = decodeURIComponent(revisionDecisionMatch[1]);
          const decision = decideArtifactRevision({
            cwd: project,
            revisionId,
            chatId: body.chat_id,
            decision: body.decision,
            note: body.note
          });
          const detail = getArtifactRevision(project, revisionId);
          let interaction = null;
          let interactionError = null;
          try {
            interaction = recordInteraction({
              cwd: project,
              chatId: decision.chat_id,
              surface: 'artifact',
              action: 'revision.' + decision.decision,
              artifact: revisionInteractionArtifact(detail),
              payload: revisionInteractionPayload(detail, {
                status: decision.decision, note: decision.note
              })
            });
          } catch (error) {
            interactionError = errorValue(error);
          }
          sendJson(response, 201, {
            revision: detail,
            decision,
            interaction,
            interaction_error: interactionError
          });
          return;
        }
        if (kernelMutationMatch) {
          const language = decodeURIComponent(kernelMutationMatch[1]);
          const action = kernelMutationMatch[2];
          if (action === 'execute') {
            const executed = await projectKernels.execute({
              language,
              code: body.code,
              timeoutMs: body.timeout_ms,
              chatId: body.chat_id,
              mode: body.mode ?? 'require'
            });
            sendJson(response, 201, {
              ...executed,
              status: projectKernels.status(language)
            });
            return;
          }
          if (action === 'restore') {
            const status = await projectKernels.restore(language);
            sendJson(response, 200, { status });
            return;
          }
          if (action === 'restart') {
            const status = await projectKernels.restart(language, { restore: body.restore === true });
            sendJson(response, 200, { status });
            return;
          }
          const interrupted = projectKernels.interrupt(language);
          sendJson(response, 200, { interrupted, status: projectKernels.status(language) });
          return;
        }
        if (evidenceCreate) {
          const added = ingestEvidence({
            cwd: project,
            source: body.source,
            title: body.title,
            doi: body.doi,
            authors: body.authors ?? [],
            year: body.year
          });
          sendJson(response, 201, getEvidenceRecord(project, added.manifest.evidence_id));
          return;
        }
        if (createMatch) {
          const detail = await chatProvider.create({
            cwd: project,
            title: body.title,
            agent: body.agent ?? 'scientist'
          });
          sendJson(response, 201, detail);
          return;
        }
        if (interactionMatch) {
          const chatId = decodeURIComponent(interactionMatch[1]);
          const interaction = recordInteraction({
            cwd: project,
            chatId,
            surface: body.surface,
            action: body.action,
            artifact: body.artifact,
            payload: body.payload
          });
          sendJson(response, 201, {
            interaction,
            verification: verifyInteractions(project, chatId)
          });
          return;
        }
        const chatId = decodeURIComponent(messageMatch[1]);
        if (busyChats.has(chatId)) {
          const error = Object.assign(new Error('A turn is already running for this conversation.'), {
            code: 'CHAT_BUSY'
          });
          sendJson(response, 409, { error: errorValue(error) });
          return;
        }
        const prefersAsync = body.async === true || /(?:^|,)\s*respond-async\s*(?:,|$)/i.test(
          String(request.headers.prefer ?? '')
        );
        if (prefersAsync) {
          pruneJobs();
          if (jobs.size >= MAX_LAB_JOBS) {
            const error = Object.assign(new Error('The local harness job queue is full.'), {
              code: 'JOB_QUEUE_FULL'
            });
            sendJson(response, 503, { error: errorValue(error) });
            return;
          }
          const createdAt = new Date().toISOString();
          const job = {
            job_id: makeJobId(),
            chat_id: chatId,
            status: 'queued',
            created_at: createdAt,
            controller: new AbortController(),
            events: [],
            response_blocks: [],
            response_sequence: 0,
            response_received_blocks: 0,
            response_retained_bytes: 0,
            response_omitted_blocks: 0,
            response_omitted_bytes: 0
          };
          pushJobEvent(job, {
            type: 'harness.plan',
            status: 'queued',
            title: 'Supervisor opened the scientific work queue',
            source: 'sciencecode'
          });
          jobs.set(job.job_id, job);
          busyChats.add(chatId);
          setImmediate(async () => {
            if (job.controller.signal.aborted) {
              job.status = 'cancelled';
              job.cancelled_at = new Date().toISOString();
              job.finished_at = job.cancelled_at;
              pushJobEvent(job, {
                type: 'harness.cancelled',
                status: 'cancelled',
                title: 'Queued AI turn cancelled before engine launch',
                source: 'sciencecode'
              });
              busyChats.delete(chatId);
              return;
            }
            job.status = 'running';
            job.started_at = new Date().toISOString();
            pushJobEvent(job, {
              type: 'harness.dispatch',
              status: 'running',
              title: 'Dispatching the recorded OpenCode scientist',
              source: 'sciencecode'
            });
            try {
              const send = chatProvider.sendAsync ?? chatProvider.send;
              const result = await send({
                cwd: project,
                chatId,
                message: body.message,
                configDir,
                packageRoot: resolvedPackageRoot,
                env,
                signal: job.controller.signal,
                onEvent(event) {
                  pushJobEvent(job, event);
                }
              });
              job.status = result.turn.status === 'completed'
                ? 'completed'
                : result.turn.status === 'cancelled' ? 'cancelled' : 'failed';
              job.result = {
                chat_id: chatId,
                turn_index: result.turn.turn_index,
                run_id: result.turn.run_id,
                status: result.turn.status,
                manifest_sha256: result.manifest_sha256
              };
              if (job.status === 'cancelled') {
                job.cancelled_at = result.turn.cancellation?.cancelled_at ??
                  new Date().toISOString();
              }
              if (!job.events.some((event) => event.type === 'outcome.recorded')) {
                pushJobEvent(job, {
                  type: 'outcome.recorded',
                  status: result.turn.status,
                  title: result.turn.status === 'completed'
                    ? 'Outcome added to the design board'
                    : result.turn.status === 'cancelled'
                      ? 'Cancelled turn preserved as incomplete'
                      : 'Failed turn preserved for review',
                  source: 'sciencecode'
                });
              }
            } catch (error) {
              if (job.controller.signal.aborted) {
                job.status = 'cancelled';
                job.cancelled_at = new Date().toISOString();
                pushJobEvent(job, {
                  type: 'harness.cancelled',
                  status: 'cancelled',
                  title: 'AI turn stopped; available partial records were preserved',
                  source: 'sciencecode'
                });
              } else {
                job.status = 'failed';
                job.error = errorValue(error);
                pushJobEvent(job, {
                  type: 'harness.error',
                  status: 'failed',
                  title: redactText(error.message),
                  source: 'sciencecode'
                });
              }
            } finally {
              job.finished_at = new Date().toISOString();
              busyChats.delete(chatId);
            }
          });
          sendJson(response, 202, publicJob(job));
          return;
        }
        busyChats.add(chatId);
        try {
          const result = await chatProvider.send({
            cwd: project,
            chatId,
            message: body.message,
            configDir,
            packageRoot: resolvedPackageRoot,
            env
          });
          const detail = await chatProvider.get({ cwd: project, chatId });
          sendJson(response, 200, {
            chat: detail,
            turn: result.turn,
            manifest_sha256: result.manifest_sha256
          });
        } finally {
          busyChats.delete(chatId);
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, {
          ...responseHeaders('text/plain; charset=utf-8'),
          Allow: 'GET, HEAD'
        });
        response.end('Method not allowed.\n');
        return;
      }
      if (url.pathname === '/api/state') {
        const built = await buildCachedLabState({
          cwd: project,
          env,
          computeProvider: preparedComputeProvider(url.searchParams.get('refresh') === '1'),
          chatProvider,
          campaignProvider,
          kernelProvider
        });
        const state = {
          ...built.state,
          integrity_cache: {
            hit: built.cacheHit,
            strategy: built.fingerprint ? 'verified-state-metadata-v1' : 'disabled',
            fingerprint: built.fingerprint,
            verified_at: built.state.generated_at,
            checked_at: new Date().toISOString()
          }
        };
        state.harness = {
          running_jobs: [...jobs.values()].filter((job) =>
            ACTIVE_JOB_STATUSES.has(job.status)).length,
          retained_jobs: jobs.size,
          asynchronous: true,
          truthful_tool_trace: true
        };
        state.inference_jobs = [...jobs.values()]
          .filter((job) => job.kind === 'inference' && ACTIVE_JOB_STATUSES.has(job.status))
          .map(publicJob);
        state.simulation_jobs = [...jobs.values()]
          .filter((job) => job.kind === 'simulation' && ACTIVE_JOB_STATUSES.has(job.status))
          .map(publicJob);
        state.experiment_jobs = [...jobs.values()]
          .filter((job) => job.kind === 'experiment' && ACTIVE_JOB_STATUSES.has(job.status))
          .map(publicJob);
        state.campaign_jobs = [...jobs.values()]
          .filter((job) => job.kind === 'campaign' && ACTIVE_JOB_STATUSES.has(job.status))
          .map(publicJob);
        state.cad_jobs = [...jobs.values()]
          .filter((job) => job.kind === 'cad' && ACTIVE_JOB_STATUSES.has(job.status))
          .map(publicJob);
        const latestProjectGate = [...jobs.values()]
          .filter((job) => job.kind === 'gate')
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
        state.project_gate_job = publicProjectGateState(latestProjectGate);
        const latestProjectSnapshot = [...jobs.values()]
          .filter((job) => job.kind === 'snapshot')
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
        state.project_snapshot_job = publicProjectSnapshotState(latestProjectSnapshot);
        sendJson(response, 200, state);
        return;
      }
      if (url.pathname === '/api/project-snapshots') {
        sendJson(response, 200, listProjectSnapshots(project));
        return;
      }
      if (url.pathname === '/api/cad/toolchain') {
        sendJson(response, 200, detectCadToolchain({ env }));
        return;
      }
      if (url.pathname === '/api/cad/projects') {
        const projects = listCadProjects(project);
        sendJson(response, 200, {
          projects,
          summary: {
            count: projects.length,
            healthy: projects.filter((item) => item.healthy).length,
            files: projects.reduce((total, item) =>
              total + Number(item.file_count ?? 0), 0),
            parts: projects.reduce((total, item) =>
              total + Number(item.part_count ?? 0), 0)
          }
        });
        return;
      }
      if (url.pathname === '/api/cad/builds') {
        const cadProjectId = url.searchParams.get('project') || undefined;
        const builds = listCadBuilds(project, { cadProjectId })
          .map((item) => cadBuildState(project, item));
        sendJson(response, 200, { builds });
        return;
      }
      if (url.pathname === '/api/cad/simulations') {
        const cadProjectId = url.searchParams.get('project') || undefined;
        const buildId = url.searchParams.get('build') || undefined;
        const simulations = listCadSimulations(project, { cadProjectId, buildId })
          .map((item) => cadSimulationState(project, item));
        sendJson(response, 200, { simulations });
        return;
      }
      if (url.pathname === '/api/cad/slices') {
        const cadProjectId = url.searchParams.get('project') || undefined;
        const buildId = url.searchParams.get('build') || undefined;
        const slices = listCadSlices(project, { cadProjectId, buildId })
          .map((item) => cadSliceState(project, item));
        sendJson(response, 200, { slices });
        return;
      }
      if (url.pathname === '/api/evidence') {
        sendJson(response, 200, { evidence: listEvidence(project) });
        return;
      }
      if (url.pathname === '/api/campaigns') {
        const chatId = url.searchParams.get('chat') || null;
        const campaigns = campaignProvider.list({ cwd: project, chatId });
        sendJson(response, 200, {
          campaigns,
          summary: {
            count: campaigns.length,
            verified: campaigns.filter((item) => item.verified).length,
            active: campaigns.filter((item) =>
              ['ready', 'running', 'waiting_checkpoint', 'waiting_hypothesis']
                .includes(item.status)).length,
            completed: campaigns.filter((item) => item.status === 'completed').length,
            waiting_checkpoint: campaigns.filter((item) =>
              item.status === 'waiting_checkpoint').length,
            waiting_hypothesis: campaigns.filter((item) =>
              item.status === 'waiting_hypothesis').length,
            hypotheses_requiring_assessment: campaigns.reduce((total, item) =>
              total + (item.hypothesis_counts?.assessment_required ?? 0), 0),
            stale_hypothesis_assessments: campaigns.reduce((total, item) =>
              total + (item.hypothesis_counts?.assessment_stale ?? 0), 0),
            failed_tasks: campaigns.reduce((total, item) =>
              total + (item.counts?.failed ?? 0), 0)
          }
        });
        return;
      }
      if (url.pathname === '/api/lineage') {
        const chatId = url.searchParams.get('chat') || null;
        sendJson(response, 200, buildLineageGraph(project, { chatId }));
        return;
      }
      if (url.pathname === '/api/revisions') {
        const sourceUrl = url.searchParams.get('source') || undefined;
        const chatId = url.searchParams.get('chat') || undefined;
        const revisions = listArtifactRevisions(project, { sourceUrl, chatId });
        sendJson(response, 200, {
          revisions,
          summary: {
            count: revisions.length,
            proposed: revisions.filter((item) => item.status === 'proposed').length,
            accepted: revisions.filter((item) => item.status === 'accepted').length,
            rejected: revisions.filter((item) => item.status === 'rejected').length,
            verified: revisions.filter((item) => item.verified).length
          }
        });
        return;
      }
      if (url.pathname === '/api/figure-comparisons') {
        const chatId = url.searchParams.get('chat') || undefined;
        const baselineUrl =
          url.searchParams.get('baseline') || undefined;
        const candidateUrl =
          url.searchParams.get('candidate') || undefined;
        const comparisons = listFigureComparisons(project, {
          chatId,
          baselineUrl,
          candidateUrl
        });
        sendJson(response, 200, {
          figure_comparisons: comparisons,
          summary: {
            count: comparisons.length,
            verified: comparisons.filter((item) => item.verified).length,
            exact: comparisons.filter((item) =>
              item.verified && item.reproduction_status === 'exact'
            ).length,
            within_tolerance: comparisons.filter((item) =>
              item.verified &&
              item.reproduction_status === 'within_tolerance'
            ).length,
            structural_checked: comparisons.filter((item) =>
              item.verified && Number.isFinite(
                item.summary?.minimum_structural_similarity
              )
            ).length,
            structural_passing: comparisons.filter((item) =>
              item.verified &&
              item.summary?.structural_similarity_rule_pass === true
            ).length,
            different: comparisons.filter((item) =>
              item.verified && item.reproduction_status === 'different'
            ).length,
            incompatible: comparisons.filter((item) =>
              item.verified &&
              item.reproduction_status === 'incompatible_dimensions'
            ).length
          }
        });
        return;
      }
      if (url.pathname === '/api/figure-registrations') {
        const chatId = url.searchParams.get('chat') || undefined;
        const figureUrl = url.searchParams.get('figure') || undefined;
        const sourceUrl = url.searchParams.get('source') || undefined;
        const status = url.searchParams.get('status') || undefined;
        if (status && !['pass', 'fail'].includes(status)) {
          throw Object.assign(
            new Error('Figure registration status filter must be pass or fail.'),
            { code: 'INVALID_FIGURE_REGISTRATION' }
          );
        }
        const registrations = listFigureRegistrations(project, {
          chatId,
          figureUrl,
          sourceUrl,
          status
        });
        sendJson(response, 200, {
          figure_registrations: registrations,
          summary: {
            count: registrations.length,
            verified: registrations.filter((item) => item.verified).length,
            matched: registrations.filter((item) =>
              item.verified && item.registration_status === 'matched'
            ).length,
            mismatched: registrations.filter((item) =>
              item.verified && item.registration_status === 'mismatch'
            ).length
          }
        });
        return;
      }
      if (url.pathname === '/api/figure-visuals') {
        const chatId = url.searchParams.get('chat') || undefined;
        const figureRegistrationId =
          url.searchParams.get('registration') || undefined;
        const status = url.searchParams.get('status') || undefined;
        if (status && !['pass', 'fail'].includes(status)) {
          throw Object.assign(
            new Error('Figure visual status filter must be pass or fail.'),
            { code: 'INVALID_FIGURE_VISUAL' }
          );
        }
        const visuals = listFigureVisuals(project, {
          chatId,
          figureRegistrationId,
          status
        });
        sendJson(response, 200, {
          figure_visuals: visuals,
          summary: {
            count: visuals.length,
            verified: visuals.filter((item) => item.verified).length,
            conforming: visuals.filter((item) =>
              item.verified && item.visual_status === 'conforming'
            ).length,
            nonconforming: visuals.filter((item) =>
              item.verified && item.visual_status === 'nonconforming'
            ).length
          }
        });
        return;
      }
      if (url.pathname === '/api/reviews') {
        const chatId = url.searchParams.get('chat') || undefined;
        const targetUrl = url.searchParams.get('target') || undefined;
        const reviews = listSemanticReviews(project, { chatId, targetUrl });
        sendJson(response, 200, {
          reviews,
          summary: {
            count: reviews.length,
            current: reviews.filter((item) => item.current_for_target).length,
            superseded: reviews.filter((item) => item.superseded_by).length,
            verified: reviews.filter((item) => item.verified).length,
            passed: reviews.filter((item) => item.current_for_target && item.status === 'pass').length,
            review: reviews.filter((item) => item.current_for_target && item.status === 'review').length,
            failed: reviews.filter((item) => item.current_for_target && item.status === 'fail').length,
            findings: reviews.reduce((total, item) => total + (item.counts?.findings ?? 0), 0),
            current_findings: reviews.filter((item) => item.current_for_target).reduce(
              (total, item) => total + (item.counts?.findings ?? 0), 0
            )
          }
        });
        return;
      }
      if (url.pathname === '/api/procedures') {
        const chatId = url.searchParams.get('chat') || null;
        const domain = url.searchParams.get('domain') || null;
        const currentOnly = url.searchParams.get('current') === '1';
        let procedures = listProcedures(project);
        if (chatId) procedures = procedures.filter((item) => item.chat_id === chatId);
        if (domain) procedures = procedures.filter((item) => item.domain === domain);
        if (currentOnly) procedures = procedures.filter((item) => item.current);
        sendJson(response, 200, {
          procedures,
          summary: {
            count: procedures.length,
            current: procedures.filter((item) => item.current).length,
            verified: procedures.filter((item) => item.verified).length,
            steps: procedures.reduce(
              (total, item) => total + (item.counts?.steps ?? 0), 0)
          }
        });
        return;
      }
      if (url.pathname === '/api/procedure-assessments') {
        const procedureId = url.searchParams.get('procedure') || null;
        let assessments = listProcedureAssessments(project);
        if (procedureId) {
          assessments = assessments.filter((item) => item.procedure_id === procedureId);
        }
        sendJson(response, 200, {
          assessments,
          summary: {
            count: assessments.length,
            current: assessments.filter((item) => item.current_for_procedure).length,
            ready: assessments.filter((item) =>
              item.current_for_procedure &&
              item.status === 'ready_for_human_review').length,
            blocked: assessments.filter((item) =>
              item.current_for_procedure && item.status === 'blocked').length,
            verified: assessments.filter((item) => item.verified).length
          }
        });
        return;
      }
      if (url.pathname === '/api/procedure-decisions') {
        const procedureId = url.searchParams.get('procedure') || null;
        const scope = url.searchParams.get('scope') || null;
        let decisions = listProcedureDecisions(project);
        if (procedureId) {
          decisions = decisions.filter((item) => item.procedure_id === procedureId);
        }
        if (scope) decisions = decisions.filter((item) => item.scope === scope);
        sendJson(response, 200, {
          decisions,
          summary: {
            count: decisions.length,
            current: decisions.filter((item) => item.current_for_scope).length,
            effective: decisions.filter((item) => item.effective).length,
            expired: decisions.filter((item) => item.expired).length,
            verified: decisions.filter((item) => item.verified).length
          }
        });
        return;
      }
      if (url.pathname === '/api/preregistrations') {
        const preregistrations = listPreregistrations(project).map(
          (summary) => preregistrationState(project, summary)
        );
        sendJson(response, 200, {
          preregistrations,
          summary: {
            count: preregistrations.length,
            verified: preregistrations.filter((item) => item.verified).length,
            authored_inline: preregistrations.filter(
              (item) => item.source_kind === 'inline'
            ).length,
            bytes: preregistrations.reduce(
              (total, item) => total + (Number(item.bytes) || 0), 0
            )
          }
        });
        return;
      }
      if (url.pathname === '/api/analysis-contracts') {
        const chatId = url.searchParams.get('chat') || undefined;
        const preregistrationId = url.searchParams.get('preregistration') || undefined;
        const contracts = listAnalysisContracts(project, { chatId, preregistrationId });
        sendJson(response, 200, {
          analysis_contracts: contracts,
          summary: {
            count: contracts.length,
            verified: contracts.filter((item) => item.verified).length,
            primary_outcomes: contracts.reduce(
              (total, item) => total + (item.counts?.primary ?? 0), 0
            )
          }
        });
        return;
      }
      if (url.pathname === '/api/analysis-assessments') {
        const chatId = url.searchParams.get('chat') || undefined;
        const contractId = url.searchParams.get('contract') || undefined;
        const experimentId = url.searchParams.get('experiment') || undefined;
        const assessments = listConfirmatoryAssessments(project, {
          chatId, contractId, experimentId
        });
        sendJson(response, 200, {
          assessments,
          summary: {
            count: assessments.length,
            current: assessments.filter((item) => item.current_for_pair).length,
            prospective: assessments.filter((item) =>
              item.current_for_pair && item.registration_status === 'prospective').length,
            passed: assessments.filter((item) =>
              item.current_for_pair && item.status === 'pass').length,
            attention: assessments.filter((item) =>
              item.current_for_pair && item.status !== 'pass').length
          }
        });
        return;
      }
      if (url.pathname === '/api/literature') {
        const source = url.searchParams.get('source') || undefined;
        const records = listLiteratureRecords(project, { source });
        sendJson(response, 200, {
          literature: records,
          summary: {
            count: records.length,
            verified: records.filter((item) => item.verified).length
          }
        });
        return;
      }
      const literatureMatch = url.pathname.match(/^\/api\/literature\/([^/]+)$/);
      if (literatureMatch) {
        const literatureId = decodeURIComponent(literatureMatch[1]);
        sendJson(response, 200, {
          ...getLiteratureRecord(project, literatureId),
          verification: verifyLiteratureRecord(project, literatureId)
        });
        return;
      }
      const procedureMatch = url.pathname.match(/^\/api\/procedures\/([^/]+)$/);
      if (procedureMatch) {
        sendJson(response, 200, getProcedure(
          project, decodeURIComponent(procedureMatch[1])
        ));
        return;
      }
      const cadFileMatch =
        url.pathname.match(/^\/api\/cad\/projects\/([^/]+)\/files\/(.+)$/);
      if (cadFileMatch) {
        sendJson(response, 200, readCadFile({
          cwd: project,
          cadProjectId: decodeURIComponent(cadFileMatch[1]),
          file: decodeURIComponent(cadFileMatch[2])
        }));
        return;
      }
      const cadProjectMatch = url.pathname.match(/^\/api\/cad\/projects\/([^/]+)$/);
      if (cadProjectMatch) {
        sendJson(response, 200, getCadProject(
          project, decodeURIComponent(cadProjectMatch[1])
        ));
        return;
      }
      const cadBuildMatch = url.pathname.match(/^\/api\/cad\/builds\/([^/]+)$/);
      if (cadBuildMatch) {
        const buildId = decodeURIComponent(cadBuildMatch[1]);
        sendJson(response, 200, cadBuildState(
          project, getCadBuild(project, buildId).manifest
        ));
        return;
      }
      const cadSimulationMatch =
        url.pathname.match(/^\/api\/cad\/simulations\/([^/]+)$/);
      if (cadSimulationMatch) {
        const simulationId = decodeURIComponent(cadSimulationMatch[1]);
        sendJson(response, 200, cadSimulationState(
          project, getCadSimulation(project, simulationId).manifest
        ));
        return;
      }
      const cadSliceMatch = url.pathname.match(/^\/api\/cad\/slices\/([^/]+)$/);
      if (cadSliceMatch) {
        const sliceId = decodeURIComponent(cadSliceMatch[1]);
        sendJson(response, 200, cadSliceState(
          project, getCadSlice(project, sliceId).manifest
        ));
        return;
      }
      const cadArtifactMatch =
        url.pathname.match(/^\/api\/cad\/artifacts\/(build|simulation|slice)\/([^/]+)\/(.+)$/);
      if (cadArtifactMatch) {
        const kind = cadArtifactMatch[1];
        const id = decodeURIComponent(cadArtifactMatch[2]);
        const file = cadArtifactMatch[3].split('/').map(decodeURIComponent).join('/');
        const artifact = resolveCadArtifact(project, { kind, id, file });
        sendFile(response, request.method, artifact);
        return;
      }
      const procedureAssessmentMatch =
        url.pathname.match(/^\/api\/procedure-assessments\/([^/]+)$/);
      if (procedureAssessmentMatch) {
        sendJson(response, 200, getProcedureAssessment(
          project, decodeURIComponent(procedureAssessmentMatch[1])
        ));
        return;
      }
      const procedureDecisionMatch =
        url.pathname.match(/^\/api\/procedure-decisions\/([^/]+)$/);
      if (procedureDecisionMatch) {
        sendJson(response, 200, getProcedureDecision(
          project, decodeURIComponent(procedureDecisionMatch[1])
        ));
        return;
      }
      const preregistrationSourceMatch =
        url.pathname.match(/^\/api\/preregistrations\/([^/]+)\/source$/);
      if (preregistrationSourceMatch) {
        const id = decodeURIComponent(preregistrationSourceMatch[1]);
        const record = getPreregistration(project, id);
        sendFile(
          response,
          request.method,
          resolvePreregistrationArtifact(project, id),
          {
            contentType: record.source?.format === 'markdown'
              ? 'text/markdown; charset=utf-8'
              : 'text/plain; charset=utf-8'
          }
        );
        return;
      }
      const preregistrationMatch =
        url.pathname.match(/^\/api\/preregistrations\/([^/]+)$/);
      if (preregistrationMatch) {
        const id = decodeURIComponent(preregistrationMatch[1]);
        const record = getPreregistration(project, id);
        const verification = verifyPreregistration(project, id);
        sendJson(response, 200, {
          record,
          verification,
          source_url: '/api/preregistrations/' + encodeURIComponent(id) + '/source'
        });
        return;
      }
      const analysisContractMatch = url.pathname.match(/^\/api\/analysis-contracts\/([^/]+)$/);
      if (analysisContractMatch) {
        sendJson(response, 200, getAnalysisContract(
          project,
          decodeURIComponent(analysisContractMatch[1])
        ));
        return;
      }
      const confirmatoryAssessmentMatch =
        url.pathname.match(/^\/api\/analysis-assessments\/([^/]+)$/);
      if (confirmatoryAssessmentMatch) {
        sendJson(response, 200, getConfirmatoryAssessment(
          project,
          decodeURIComponent(confirmatoryAssessmentMatch[1])
        ));
        return;
      }
      const semanticReviewMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
      if (semanticReviewMatch) {
        sendJson(response, 200, getSemanticReview(
          project, decodeURIComponent(semanticReviewMatch[1])
        ));
        return;
      }
      const figureComparisonMatch =
        url.pathname.match(/^\/api\/figure-comparisons\/([^/]+)$/);
      if (figureComparisonMatch) {
        sendJson(response, 200, getFigureComparison(
          project,
          decodeURIComponent(figureComparisonMatch[1])
        ));
        return;
      }
      const figureRegistrationMatch =
        url.pathname.match(/^\/api\/figure-registrations\/([^/]+)$/);
      if (figureRegistrationMatch) {
        sendJson(response, 200, getFigureRegistration(
          project,
          decodeURIComponent(figureRegistrationMatch[1])
        ));
        return;
      }
      const figureVisualMatch =
        url.pathname.match(/^\/api\/figure-visuals\/([^/]+)$/);
      if (figureVisualMatch) {
        sendJson(response, 200, getFigureVisual(
          project,
          decodeURIComponent(figureVisualMatch[1])
        ));
        return;
      }
      const revisionMatch = url.pathname.match(/^\/api\/revisions\/([^/]+)$/);
      if (revisionMatch) {
        sendJson(response, 200, getArtifactRevision(project, decodeURIComponent(revisionMatch[1])));
        return;
      }
      if (url.pathname === '/api/kernels') {
        sendJson(response, 200, { kernels: projectKernels.listStatus() });
        return;
      }
      const kernelCellMatch = url.pathname.match(/^\/api\/kernels\/([^/]+)\/cells\/([^/]+)$/);
      if (kernelCellMatch) {
        const language = decodeURIComponent(kernelCellMatch[1]);
        const cellId = decodeURIComponent(kernelCellMatch[2]);
        sendJson(response, 200, {
          status: projectKernels.status(language),
          cell: getKernelCell(project, language, cellId),
          verification: verifyKernelCell(project, language, cellId)
        });
        return;
      }
      const kernelMatch = url.pathname.match(/^\/api\/kernels\/([^/]+)$/);
      if (kernelMatch) {
        const language = decodeURIComponent(kernelMatch[1]);
        const status = projectKernels.status(language);
        let record = null;
        if (status.recorded) record = getKernelRecord(project, language);
        sendJson(response, 200, { status, record });
        return;
      }
      if (url.pathname === '/api/evidence/search') {
        const result = searchEvidence(project, url.searchParams.get('q') ?? '', {
          limit: url.searchParams.has('limit') ? url.searchParams.get('limit') : undefined
        });
        sendJson(response, 200, result);
        return;
      }
      const evidencePageMatch = url.pathname.match(/^\/api\/evidence\/([^/]+)\/pages\/([^/]+)$/);
      if (evidencePageMatch) {
        const evidenceId = decodeURIComponent(evidencePageMatch[1]);
        const page = getEvidencePage(project, evidenceId, decodeURIComponent(evidencePageMatch[2]));
        const detail = getEvidenceRecord(project, evidenceId);
        sendJson(response, 200, {
          evidence_id: evidenceId,
          bibliography: detail.manifest.bibliography,
          page,
          verification: detail.verification
        });
        return;
      }
      const evidenceMatch = url.pathname.match(/^\/api\/evidence\/([^/]+)$/);
      if (evidenceMatch) {
        const evidenceId = decodeURIComponent(evidenceMatch[1]);
        const detail = getEvidenceRecord(project, evidenceId);
        detail.source_url = '/evidence-source/' + encodeURIComponent(evidenceId);
        sendJson(response, 200, detail);
        return;
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch) {
        const jobId = decodeURIComponent(jobMatch[1]);
        const job = jobs.get(jobId);
        if (!job) {
          sendJson(response, 404, {
            error: { code: 'JOB_NOT_FOUND', message: 'Harness job not found: ' + jobId }
          });
          return;
        }
        sendJson(response, 200, publicJob(job));
        return;
      }
      const interactionMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/interactions$/);
      if (interactionMatch) {
        const chatId = decodeURIComponent(interactionMatch[1]);
        sendJson(response, 200, {
          chat_id: chatId,
          interactions: listInteractions(project, chatId),
          verification: verifyInteractions(project, chatId)
        });
        return;
      }
      const harnessMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/harness$/);
      if (harnessMatch) {
        const chatId = decodeURIComponent(harnessMatch[1]);
        const chat = await chatProvider.get({ cwd: project, chatId });
        const { state } = await buildCachedLabState({
          cwd: project,
          env,
          computeProvider: preparedComputeProvider(false),
          chatProvider,
          campaignProvider,
          kernelProvider
        });
        sendJson(response, 200, buildHarnessView({
          cwd: project,
          chat,
          job: latestJobForChat(chatId),
          compute: state.compute,
          experiments: state.experiments,
          simulations: state.simulations,
          inferences: state.inferences,
          reviews: state.reviews,
          figureComparisons: state.figure_comparisons,
          figureRegistrations: state.figure_registrations,
          figureVisuals: state.figure_visuals,
          procedures: state.procedures,
          procedureAssessments: state.procedure_assessments,
          procedureDecisions: state.procedure_decisions,
          analysisContracts: state.analysis_contracts,
          confirmatoryAssessments: state.confirmatory_assessments,
          literature: state.literature,
          campaigns: state.campaigns,
          cadProjects: state.cad_projects,
          cadBuilds: state.cad_builds,
          cadSimulations: state.cad_simulations,
          cadSlices: state.cad_slices
        }));
        return;
      }
      const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
      if (chatMatch) {
        const chatId = decodeURIComponent(chatMatch[1]);
        const detail = await chatProvider.get({ cwd: project, chatId });
        sendJson(response, 200, detail);
        return;
      }
      const detailMatch = url.pathname.match(/^\/api\/simulations\/([^/]+)$/);
      if (detailMatch) {
        const simulationId = decodeURIComponent(detailMatch[1]);
        const manifest = getSimulationManifest(project, simulationId);
        const directory = resolveSimulationDirectory(project, simulationId);
        sendJson(response, 200, {
          manifest,
          verification: verifySimulation(project, simulationId),
          summary: readSimulationSummary(directory, manifest)
        });
        return;
      }
      const campaignMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)$/);
      if (campaignMatch) {
        const campaignId = decodeURIComponent(campaignMatch[1]);
        sendJson(response, 200, campaignProvider.get({ cwd: project, campaignId }));
        return;
      }
      const inferenceMatch = url.pathname.match(/^\/api\/inferences\/([^/]+)$/);
      if (inferenceMatch) {
        const inferenceId = decodeURIComponent(inferenceMatch[1]);
        sendJson(response, 200, {
          manifest: getInferenceManifest(project, inferenceId),
          verification: verifyInference(project, inferenceId)
        });
        return;
      }
      const experimentMatch = url.pathname.match(/^\/api\/experiments\/([^/]+)$/);
      if (experimentMatch) {
        const experimentId = decodeURIComponent(experimentMatch[1]);
        const manifest = getExperimentManifest(project, experimentId);
        const directory = resolveExperimentDirectory(project, experimentId);
        sendJson(response, 200, {
          manifest,
          verification: verifyExperiment(project, experimentId),
          plan: readJson(path.join(directory, 'plan.json')),
          results: readJson(path.join(directory, 'results.json')),
          review: readJson(path.join(directory, 'review.json'))
        });
        return;
      }
      if (url.pathname.startsWith('/artifact/')) {
        serveArtifact(project, request, response, url.pathname);
        return;
      }
      if (url.pathname.startsWith('/inference-artifact/')) {
        serveInferenceArtifact(project, request, response, url.pathname);
        return;
      }
      if (url.pathname.startsWith('/evidence-source/')) {
        const evidenceId = decodeURIComponent(url.pathname.slice('/evidence-source/'.length));
        const source = resolveEvidenceSourceFile(project, evidenceId);
        sendFile(response, request.method, source.file);
        return;
      }
      if (url.pathname.startsWith('/experiment-artifact/')) {
        serveExperimentArtifact(project, request, response, url.pathname);
        return;
      }
      if (url.pathname.startsWith('/kernel-artifact/')) {
        const encoded = url.pathname.slice('/kernel-artifact/'.length).split('/');
        if (encoded.length < 3) {
          sendText(response, 404, 'Kernel artifact not found.');
          return;
        }
        let language;
        let cellId;
        let relative;
        try {
          language = decodeURIComponent(encoded.shift());
          cellId = decodeURIComponent(encoded.shift());
          relative = encoded.map((value) => decodeURIComponent(value)).join('/');
        } catch {
          throw Object.assign(new Error('Malformed kernel artifact path.'), {
            code: 'INVALID_KERNEL_PATH',
            status: 400
          });
        }
        const artifact = resolveKernelArtifact(project, language, cellId, relative);
        sendFile(response, request.method, artifact.file);
        return;
      }
      if (url.pathname.startsWith('/figure-comparison-artifact/')) {
        const encoded = url.pathname
          .slice('/figure-comparison-artifact/'.length)
          .split('/');
        if (encoded.length !== 2 || encoded.some((part) => !part)) {
          sendText(response, 404, 'Figure comparison artifact not found.');
          return;
        }
        let comparisonId;
        let artifactName;
        try {
          comparisonId = decodeURIComponent(encoded[0]);
          artifactName = decodeURIComponent(encoded[1]);
        } catch {
          throw Object.assign(
            new Error('Malformed figure comparison artifact path.'),
            { code: 'INVALID_FIGURE_COMPARISON_ID', status: 400 }
          );
        }
        const artifact = resolveFigureComparisonArtifact(
          project,
          comparisonId,
          artifactName
        );
        sendFile(response, request.method, artifact.file);
        return;
      }
      if (url.pathname.startsWith('/figure-registration-artifact/')) {
        const encoded = url.pathname
          .slice('/figure-registration-artifact/'.length)
          .split('/');
        if (encoded.length !== 2 || encoded.some((part) => !part)) {
          sendText(response, 404, 'Figure registration artifact not found.');
          return;
        }
        let registrationId;
        let artifactName;
        try {
          registrationId = decodeURIComponent(encoded[0]);
          artifactName = decodeURIComponent(encoded[1]);
        } catch {
          throw Object.assign(
            new Error('Malformed figure registration artifact path.'),
            { code: 'INVALID_FIGURE_REGISTRATION_ID', status: 400 }
          );
        }
        const artifact = resolveFigureRegistrationArtifact(
          project,
          registrationId,
          artifactName
        );
        sendFile(response, request.method, artifact.file);
        return;
      }
      if (url.pathname.startsWith('/figure-visual-artifact/')) {
        const encoded = url.pathname
          .slice('/figure-visual-artifact/'.length)
          .split('/');
        if (encoded.length !== 2 || encoded.some((part) => !part)) {
          sendText(response, 404, 'Figure visual artifact not found.');
          return;
        }
        let visualId;
        let artifactName;
        try {
          visualId = decodeURIComponent(encoded[0]);
          artifactName = decodeURIComponent(encoded[1]);
        } catch {
          throw Object.assign(
            new Error('Malformed figure visual artifact path.'),
            { code: 'INVALID_FIGURE_VISUAL_ID', status: 400 }
          );
        }
        const artifact = resolveFigureVisualArtifact(
          project,
          visualId,
          artifactName
        );
        sendFile(response, request.method, artifact.file);
        return;
      }
      if (url.pathname.startsWith('/revision-artifact/')) {
        const encoded = url.pathname.slice('/revision-artifact/'.length);
        if (!encoded || encoded.includes('/')) {
          sendText(response, 404, 'Artifact revision not found.');
          return;
        }
        let revisionId;
        try {
          revisionId = decodeURIComponent(encoded);
        } catch {
          throw Object.assign(new Error('Malformed artifact revision path.'), {
            code: 'INVALID_REVISION_ID', status: 400
          });
        }
        const artifact = resolveArtifactRevision(project, revisionId);
        sendFile(response, request.method, artifact.file);
        return;
      }
      if (url.pathname.startsWith('/project-snapshot/')) {
        const encoded = url.pathname.slice('/project-snapshot/'.length);
        if (!encoded || encoded.includes('/')) {
          sendText(response, 404, 'Project snapshot not found.');
          return;
        }
        let snapshotId;
        try {
          snapshotId = decodeURIComponent(encoded);
        } catch {
          throw Object.assign(new Error('Malformed project snapshot path.'), {
            code: 'INVALID_PROJECT_SNAPSHOT_ID', status: 400
          });
        }
        const snapshotFile = resolveProjectSnapshotFile(project, snapshotId);
        sendFile(response, request.method, snapshotFile.file, {
          download: true,
          contentType: 'application/json; charset=utf-8'
        });
        return;
      }
      const assetName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!STATIC_ASSETS.has(assetName)) {
        sendText(response, 404, 'Not found.');
        return;
      }
      const file = path.join(assets, assetName);
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        sendText(response, 500, 'ScienceCode Lab asset is missing.');
        return;
      }
      sendFile(response, request.method, file);
    } catch (error) {
      sendJson(response, httpStatusForError(error), { error: errorValue(error) });
    }
  });
  // The Node default is five seconds, which can race a meaningful local POST
  // after a long synchronous verification pass closes an otherwise reusable
  // browser socket. Keep the local workbench connection warm while preserving
  // a slightly longer, finite header deadline.
  server.keepAliveTimeout = LAB_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = LAB_HEADERS_TIMEOUT_MS;
  server.on('close', () => {
    for (const job of jobs.values()) {
      if (job.interruptible !== false &&
          ACTIVE_JOB_STATUSES.has(job.status) && !job.controller.signal.aborted) {
        job.controller.abort('server_shutdown');
      }
    }
    projectKernels.shutdownAll('server_shutdown');
  });
  server.sciencecodeKernelManager = projectKernels;
  return server;
}

export function startLab({
  cwd,
  packageRoot,
  env = process.env,
  host = '127.0.0.1',
  port = 4311,
  computeProvider = computeStatus,
  chatProvider = DEFAULT_CHAT_PROVIDER,
  campaignProvider = DEFAULT_CAMPAIGN_PROVIDER,
  inferenceProvider = DEFAULT_INFERENCE_PROVIDER,
  simulationProvider = DEFAULT_SIMULATION_PROVIDER,
  experimentProvider = DEFAULT_EXPERIMENT_PROVIDER,
  cadWorkerRunner = runCommand,
  gateWorkerRunner = runCommand,
  snapshotWorkerRunner = runCommand,
  kernelManager
}) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw Object.assign(
      new Error('ScienceCode Lab is local-only; host must be 127.0.0.1, localhost, or ::1.'),
      { code: 'LAB_REMOTE_HOST_DENIED' }
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Object.assign(new Error('Lab port must be an integer from 0 through 65535.'), {
      code: 'INVALID_ARGUMENT'
    });
  }
  const server = createLabServer({
    cwd,
    packageRoot,
    env,
    computeProvider,
    chatProvider,
    campaignProvider,
    inferenceProvider,
    simulationProvider,
    experimentProvider,
    cadWorkerRunner,
    gateWorkerRunner,
    snapshotWorkerRunner,
    kernelManager
  });
  const ready = new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const actualHost = host === '::1' ? '[::1]' : host;
      resolve({
        host,
        port: address.port,
        url: 'http://' + actualHost + ':' + address.port,
        project: path.resolve(cwd)
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  return { server, ready };
}
