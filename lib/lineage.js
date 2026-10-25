import path from 'node:path';
import { listAnalysisContracts, verifyAnalysisContract } from './analysis-contracts.js';
import { listLiteratureRecords, verifyLiteratureRecord } from './literature.js';
import { getCampaign, listCampaigns, verifyCampaign } from './campaigns.js';
import {
  listCadBuilds,
  listCadProjects,
  listCadSimulations,
  listCadSlices,
  verifyCadBuild,
  verifyCadSimulation,
  verifyCadSlice
} from './cad.js';
import { getChatSession, listChats, verifyChat } from './chats.js';
import {
  listConfirmatoryAssessments,
  verifyConfirmatoryAssessment
} from './confirmatory.js';
import {
  getEvidenceManifest,
  listEvidence,
  listEvidenceRetrievals,
  verifyEvidence,
  verifyEvidenceRetrieval
} from './evidence.js';
import { listExperiments, verifyExperiment } from './experiments.js';
import {
  listFigureComparisons,
  verifyFigureComparison
} from './figure-comparisons.js';
import {
  listFigureRegistrations,
  verifyFigureRegistration
} from './figure-registrations.js';
import { listFigureVisuals, verifyFigureVisual } from './figure-visuals.js';
import { listInferences, verifyInference } from './inferences.js';
import { sha256Json } from './hash.js';
import { listInteractions, verifyInteractions } from './interactions.js';
import { listKernels, verifyKernel } from './kernels.js';
import { listPreregistrations, verifyPreregistration } from './preregistration.js';
import {
  listProcedureAssessments,
  listProcedureDecisions,
  listProcedures,
  verifyProcedure,
  verifyProcedureAssessment,
  verifyProcedureDecision
} from './procedures.js';
import { listArtifactRevisions, verifyArtifactRevision } from './revisions.js';
import { listSemanticReviews, verifySemanticReview } from './reviews.js';
import { listRuns, verifyRun } from './runs.js';
import { listSimulations, verifySimulation } from './simulations.js';

export const LINEAGE_SCHEMA_VERSION = 1;
export const MAX_LINEAGE_NODES = 10_000;
export const MAX_LINEAGE_EDGES = 24_000;

const STATUS_WARNING = new Set([
  'failed', 'invalid', 'launch_error', 'not_run', 'interrupted', 'cancelled',
  'blocked', 'budget_exhausted', 'stopped'
]);
const TYPE_ORDER = new Map([
  ['evidence', 0], ['citation', 1], ['retrieval', 2], ['preregistration', 3],
  ['procedure', 4], ['procedure-assessment', 5], ['procedure-decision', 6],
  ['analysis-contract', 7], ['input', 8], ['chat', 9], ['turn', 10], ['run', 11],
  ['kernel', 12], ['cell', 13], ['experiment', 14], ['simulation', 15],
  ['inference', 16], ['artifact', 17], ['revision', 18], ['decision', 19],
  ['figure-comparison', 20], ['figure-registration', 21], ['figure-visual', 22],
  ['review', 23], ['analysis-assessment', 24], ['campaign', 25],
  ['hypothesis', 26], ['campaign-task', 27], ['cad-project', 28],
  ['cad-build', 29], ['cad-simulation', 30], ['cad-slice', 31],
  ['interaction', 32],
  ['missing', 99]
]);

function compact(value, limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
}

function portable(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

function encodedPath(value) {
  return portable(value).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function nodeId(type, ...parts) {
  return type + ':' + parts.map((part) => encodeURIComponent(String(part))).join(':');
}

function issueSummary(errors) {
  return (errors ?? []).slice(0, 12).map((error) => ({
    issue: compact(error?.issue ?? error?.code ?? 'verification_error', 80),
    file: compact(error?.file, 160),
    detail: compact(error?.detail, 240)
  }));
}

function statusOf(value, fallback = 'recorded') {
  return compact(value, 48)?.toLowerCase() ?? fallback;
}

function createBuilder(project) {
  const nodes = new Map();
  const edges = new Map();
  const findings = [];
  const pendingEdges = [];
  const artifactByUrl = new Map();
  const artifactByOwnerAndName = new Map();
  const recordNodes = new Map();

  function finding(severity, code, message, values = {}) {
    findings.push({ severity, code, message: compact(message, 500), ...values });
  }

  function addNode(value) {
    if (!value?.id || !value?.type) throw new Error('Lineage nodes require an ID and type.');
    if (nodes.has(value.id)) {
      finding('error', 'duplicate_node', 'Two records resolved to the same lineage node.', {
        node_id: value.id
      });
      return nodes.get(value.id);
    }
    if (nodes.size >= MAX_LINEAGE_NODES) {
      throw Object.assign(new Error('Lineage graph exceeds the safe node limit.'), {
        code: 'LINEAGE_TOO_LARGE'
      });
    }
    const node = {
      id: value.id,
      type: value.type,
      label: compact(value.label, 180) ?? value.id,
      detail: compact(value.detail, 300),
      status: statusOf(value.status),
      verified: value.verified === true,
      created_at: value.created_at ?? null,
      record_id: value.record_id ?? null,
      hash: value.hash ?? null,
      url: value.url ?? null,
      metadata: value.metadata ?? {}
    };
    nodes.set(node.id, node);
    if (value.record_key) recordNodes.set(value.record_key, node.id);
    if (!node.verified) {
      finding('error', 'record_unverified', node.label + ' failed integrity verification.', {
        node_id: node.id,
        record_type: node.type
      });
    }
    if (STATUS_WARNING.has(node.status)) {
      finding('warning', 'record_not_completed', node.label + ' has status ' + node.status + '.', {
        node_id: node.id,
        record_type: node.type
      });
    }
    return node;
  }

  function queueEdge(source, target, relation, metadata = {}) {
    pendingEdges.push({ source, target, relation, metadata });
  }

  function addEdge(source, target, relation, metadata = {}) {
    if (edges.size >= MAX_LINEAGE_EDGES) {
      throw Object.assign(new Error('Lineage graph exceeds the safe edge limit.'), {
        code: 'LINEAGE_TOO_LARGE'
      });
    }
    const id = 'edge:' + sha256Json([source, relation, target]).slice(0, 24);
    if (!edges.has(id)) edges.set(id, { id, source, target, relation, metadata });
  }

  function addArtifact({ owner, ownerType, recordId, name, descriptor = {}, role = 'output', url = null }) {
    const id = nodeId('artifact', owner, name);
    const verified = nodes.get(owner)?.verified === true;
    addNode({
      id,
      type: 'artifact',
      label: path.posix.basename(portable(name)),
      detail: portable(name),
      status: role === 'input' ? 'input' : 'recorded',
      verified,
      record_id: recordId,
      hash: descriptor?.sha256 ?? null,
      url,
      metadata: {
        owner_id: owner,
        owner_type: ownerType,
        name: portable(name),
        role,
        bytes: descriptor?.bytes ?? null,
        sha256: descriptor?.sha256 ?? null
      }
    });
    queueEdge(role === 'input' ? id : owner, role === 'input' ? owner : id,
      role === 'input' ? 'input_to' : 'produced');
    artifactByOwnerAndName.set(owner + '\n' + portable(name), id);
    artifactByOwnerAndName.set(owner + '\n' + path.posix.basename(portable(name)), id);
    if (url) artifactByUrl.set(url, id);
    return id;
  }

  function addInput(owner, value, kind = 'data') {
    if (!value?.sha256 && !value?.path) return null;
    const label = value.path ?? value.file ?? kind + ' input';
    const id = nodeId('input', value.sha256 ?? owner, label);
    if (!nodes.has(id)) {
      addNode({
        id,
        type: 'input',
        label: path.posix.basename(portable(label)),
        detail: portable(label),
        status: kind,
        verified: Boolean(value.sha256),
        hash: value.sha256 ?? null,
        metadata: { kind, path: portable(label), sha256: value.sha256 ?? null, bytes: value.bytes ?? null }
      });
    }
    queueEdge(id, owner, 'input_to', { kind });
    return id;
  }

  function finalizeEdges() {
    for (const edge of pendingEdges) {
      for (const [side, id] of [['source', edge.source], ['target', edge.target]]) {
        if (nodes.has(id)) continue;
        addNode({ id, type: 'missing', label: 'Missing record', detail: id, status: 'missing', verified: false });
        finding('error', 'dangling_' + side, 'A lineage edge references a missing ' + side + ' record.', {
          node_id: side === 'source' ? id : edge.source,
          target_id: side === 'target' ? id : edge.target,
          relation: edge.relation
        });
      }
      addEdge(edge.source, edge.target, edge.relation, edge.metadata);
    }
  }

  return {
    project, nodes, edges, findings, artifactByUrl, artifactByOwnerAndName, recordNodes,
    addNode, queueEdge, addArtifact, addInput, finding, finalizeEdges
  };
}

function addEvidence(builder) {
  for (const summary of listEvidence(builder.project)) {
    const id = nodeId('evidence', summary.evidence_id);
    const verification = verifyEvidence(builder.project, summary.evidence_id);
    const manifest = verification.manifest ?? (() => {
      try { return getEvidenceManifest(builder.project, summary.evidence_id); } catch { return null; }
    })();
    builder.addNode({
      id,
      type: 'evidence',
      label: summary.title ?? summary.evidence_id,
      detail: [summary.authors?.slice(0, 3).join(', '), summary.year, summary.doi].filter(Boolean).join(' · '),
      status: summary.kind ?? 'evidence',
      verified: verification.ok,
      created_at: summary.created_at,
      record_id: summary.evidence_id,
      hash: verification.manifest_sha256,
      record_key: 'evidence:' + summary.evidence_id,
      url: '/api/evidence/' + encodeURIComponent(summary.evidence_id),
      metadata: {
        pages: summary.pages ?? 0,
        spans: summary.spans ?? 0,
        doi: summary.doi ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    if (manifest?.source) {
      const source = builder.addArtifact({
        owner: id,
        ownerType: 'evidence',
        recordId: summary.evidence_id,
        name: manifest.source.file,
        descriptor: manifest.source,
        role: 'input',
        url: '/evidence-source/' + encodeURIComponent(summary.evidence_id)
      });
      builder.queueEdge(source, id, 'ingested_as');
    }
  }

  for (const retrievalId of listEvidenceRetrievals(builder.project)) {
    const verification = verifyEvidenceRetrieval(builder.project, retrievalId);
    const record = verification.record;
    const id = nodeId('retrieval', retrievalId);
    builder.addNode({
      id,
      type: 'retrieval',
      label: 'Evidence retrieval ' + retrievalId.replace(/^retrieval-/, ''),
      detail: (record?.results?.length ?? 0) + ' ranked evidence span(s)',
      status: verification.ok ? 'recorded' : 'invalid',
      verified: verification.ok,
      created_at: record?.created_at,
      record_id: retrievalId,
      hash: verification.retrieval_sha256,
      record_key: 'retrieval:' + retrievalId,
      metadata: {
        result_count: record?.results?.length ?? 0,
        query_sha256: record?.query_sha256 ?? null,
        corpus_sha256: record?.corpus_sha256 ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    for (const result of record?.results ?? []) {
      const citationId = nodeId('citation', retrievalId, result.rank);
      builder.addNode({
        id: citationId,
        type: 'citation',
        label: 'Page ' + result.page + ' · ' + result.span_id,
        detail: 'Rank ' + result.rank + ' from ' + result.evidence_id,
        status: 'ranked',
        verified: verification.ok,
        record_id: result.span_id,
        hash: result.text_sha256,
        url: '/api/evidence/' + encodeURIComponent(result.evidence_id) + '/pages/' + encodeURIComponent(result.page),
        metadata: {
          retrieval_id: retrievalId,
          evidence_id: result.evidence_id,
          rank: result.rank,
          page: result.page,
          span_id: result.span_id,
          score: result.score ?? null,
          text_sha256: result.text_sha256
        }
      });
      builder.queueEdge(nodeId('evidence', result.evidence_id), citationId, 'contains');
      builder.queueEdge(citationId, id, 'ranked_in', { rank: result.rank });
    }
  }
}

function addRuns(builder) {
  for (const summary of listRuns(builder.project)) {
    const verification = verifyRun(builder.project, summary.run_id);
    const manifest = verification.manifest;
    const id = nodeId('run', summary.run_id);
    builder.addNode({
      id,
      type: 'run',
      label: (manifest?.agent ?? summary.agent ?? 'agent') + ' run',
      detail: summary.run_id,
      status: summary.status,
      verified: verification.ok,
      created_at: summary.started_at,
      record_id: summary.run_id,
      hash: verification.manifest_sha256,
      record_key: 'run:' + summary.run_id,
      metadata: {
        agent: manifest?.agent ?? summary.agent,
        exit_code: manifest?.exit_code ?? summary.exit_code,
        prompt_sha256: manifest?.prompt_sha256 ?? null,
        duration_ms: manifest?.duration_ms ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      const role = name === 'request.md' || name === 'snapshot-before.json' ? 'input' : 'output';
      builder.addArtifact({ owner: id, ownerType: 'run', recordId: summary.run_id, name, descriptor, role });
    }
    if (manifest?.chat?.chat_id && manifest?.chat?.turn_index) {
      builder.queueEdge(nodeId('turn', manifest.chat.chat_id, manifest.chat.turn_index), id, 'executed_as');
    }
  }
}

function addKernels(builder) {
  for (const summary of listKernels(builder.project)) {
    const verification = verifyKernel(builder.project, summary.language);
    const manifest = verification.manifest;
    const id = nodeId('kernel', summary.kernel_id);
    builder.addNode({
      id,
      type: 'kernel',
      label: summary.language + ' notebook',
      detail: summary.execution_count + ' recorded cell(s)',
      status: summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.kernel_id,
      hash: manifest?.cell_head_sha256,
      record_key: 'kernel:' + summary.kernel_id,
      url: '/api/kernels/' + encodeURIComponent(summary.language),
      metadata: {
        language: summary.language,
        execution_count: summary.execution_count,
        failed_cells: summary.failed_cells,
        issues: issueSummary(verification.errors)
      }
    });
    let previous = null;
    for (const cell of verification.cells ?? []) {
      const detail = cell.verification;
      const cellManifest = detail?.manifest;
      const cellNode = nodeId('cell', summary.kernel_id, cell.cell_id);
      builder.addNode({
        id: cellNode,
        type: 'cell',
        label: summary.language + ' ' + cell.cell_id,
        detail: 'Execution ' + (cellManifest?.execution_count ?? '?'),
        status: cell.status,
        verified: detail?.ok === true,
        created_at: cellManifest?.started_at,
        record_id: cell.cell_id,
        hash: cell.manifest_sha256,
        record_key: 'cell:' + summary.kernel_id + ':' + cell.cell_id,
        url: '/api/kernels/' + encodeURIComponent(summary.language) + '/cells/' + encodeURIComponent(cell.cell_id),
        metadata: {
          kernel_id: summary.kernel_id,
          language: summary.language,
          execution_count: cellManifest?.execution_count ?? null,
          code_sha256: cellManifest?.code_sha256 ?? null,
          duration_ms: cellManifest?.duration_ms ?? null,
          chat_id: cellManifest?.context?.chat_id ?? null,
          issues: issueSummary(detail?.errors)
        }
      });
      builder.queueEdge(id, cellNode, 'contains');
      if (previous) builder.queueEdge(previous, cellNode, 'precedes');
      previous = cellNode;
      if (cellManifest?.source) {
        builder.addArtifact({
          owner: cellNode,
          ownerType: 'cell',
          recordId: cell.cell_id,
          name: cellManifest.source.file,
          descriptor: cellManifest.source,
          role: 'input'
        });
      }
      for (const [name, descriptor] of Object.entries(cellManifest?.artifacts ?? {})) {
        const relative = name.replace(/^artifacts\//, '');
        builder.addArtifact({
          owner: cellNode,
          ownerType: 'cell',
          recordId: cell.cell_id,
          name,
          descriptor,
          url: '/kernel-artifact/' + encodeURIComponent(summary.language) + '/' +
            encodeURIComponent(cell.cell_id) + '/' + encodedPath(relative)
        });
      }
      if (cellManifest?.context?.chat_id) {
        builder.queueEdge(nodeId('chat', cellManifest.context.chat_id), cellNode, 'authored_in');
      }
    }
  }
}

function addSimulations(builder) {
  for (const summary of listSimulations(builder.project)) {
    const verification = verifySimulation(builder.project, summary.simulation_id);
    const manifest = verification.manifest;
    const id = nodeId('simulation', summary.simulation_id);
    builder.addNode({
      id,
      type: 'simulation',
      label: path.posix.basename(portable(manifest?.script?.path ?? summary.script ?? summary.simulation_id)),
      detail: 'Seed ' + String(manifest?.seed ?? '—') + ' · ' +
        String(manifest?.context?.device?.selected ?? manifest?.device_request ?? 'device unknown'),
      status: summary.status,
      verified: verification.ok,
      created_at: summary.started_at,
      record_id: summary.simulation_id,
      hash: verification.manifest_sha256,
      record_key: 'simulation:' + summary.simulation_id,
      url: '/api/simulations/' + encodeURIComponent(summary.simulation_id),
      metadata: {
        seed: manifest?.seed ?? null,
        device: manifest?.context?.device?.selected ?? manifest?.device_request ?? null,
        duration_ms: manifest?.duration_ms ?? null,
        experiment_id: manifest?.experiment?.experiment_id ?? null,
        branch_index: manifest?.experiment?.branch_index ?? null,
        cad_build_id: manifest?.cad_parent?.build_id ?? null,
        cad_project_id: manifest?.cad_parent?.cad_project_id ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    builder.addInput(id, manifest?.script, 'code');
    for (const input of manifest?.inputs ?? []) builder.addInput(id, input, 'data');
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      const relative = name.startsWith('artifacts/') ? name.slice('artifacts/'.length) : null;
      const url = relative
        ? '/artifact/' + encodeURIComponent(summary.simulation_id) + '/' + encodedPath(relative)
        : null;
      const role = ['source.py', 'runtime-manifest.json', 'snapshot-before.json'].includes(name)
        ? 'input'
        : 'output';
      builder.addArtifact({
        owner: id,
        ownerType: 'simulation',
        recordId: summary.simulation_id,
        name,
        descriptor,
        role,
        url
      });
    }
    if (manifest?.experiment?.experiment_id) {
      builder.queueEdge(nodeId('experiment', manifest.experiment.experiment_id), id, 'branched_to', {
        branch_index: manifest.experiment.branch_index
      });
    }
    if (manifest?.cad_parent?.build_id) {
      builder.queueEdge(
        nodeId('cad-build', manifest.cad_parent.build_id),
        id,
        'modeled_by',
        { mesh_sha256: manifest.cad_parent.mesh_sha256 ?? null }
      );
    }
  }
}

function addCad(builder) {
  for (const project of listCadProjects(builder.project)) {
    const id = nodeId('cad-project', project.cad_project_id);
    builder.addNode({
      id,
      type: 'cad-project',
      label: project.name,
      detail: String(project.file_count) + ' files · ' +
        String(project.part_count) + ' declared parts',
      status: project.healthy ? 'editable' : 'invalid',
      verified: project.healthy,
      created_at: project.created_at,
      record_id: project.cad_project_id,
      hash: project.source_sha256,
      record_key: 'cad-project:' + project.cad_project_id,
      url: '/api/cad/projects/' + encodeURIComponent(project.cad_project_id),
      metadata: {
        project_path: project.project_path,
        file_count: project.file_count,
        part_count: project.part_count,
        source_sha256: project.source_sha256,
        issue: project.issue
      }
    });
  }
  for (const summary of listCadBuilds(builder.project)) {
    const verification = verifyCadBuild(builder.project, summary.build_id);
    const manifest = verification.manifest;
    const id = nodeId('cad-build', summary.build_id);
    builder.addNode({
      id,
      type: 'cad-build',
      label: summary.build_id,
      detail: String(manifest?.mesh?.triangles ?? 0) + ' triangles · OpenSCAD',
      status: summary.status,
      verified: verification.ok,
      created_at: summary.created_at,
      record_id: summary.build_id,
      hash: verification.manifest_sha256,
      record_key: 'cad-build:' + summary.build_id,
      url: '/api/cad/builds/' + encodeURIComponent(summary.build_id),
      metadata: {
        cad_project_id: summary.cad_project_id,
        source_sha256: manifest?.source_sha256 ?? null,
        topology: manifest?.mesh?.topology ?? null,
        geometry: manifest?.mesh?.geometry ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    builder.queueEdge(nodeId('cad-project', summary.cad_project_id), id, 'rendered_to');
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      const role = name.startsWith('source/') ? 'input' : 'output';
      builder.addArtifact({
        owner: id,
        ownerType: 'cad-build',
        recordId: summary.build_id,
        name,
        descriptor,
        role,
        url: role === 'output'
          ? '/api/cad/artifacts/build/' + encodeURIComponent(summary.build_id) +
            '/' + encodedPath(name)
          : null
      });
    }
  }
  for (const summary of listCadSimulations(builder.project)) {
    const verification = verifyCadSimulation(builder.project, summary.simulation_id);
    const manifest = verification.manifest;
    const id = nodeId('cad-simulation', summary.simulation_id);
    builder.addNode({
      id,
      type: 'cad-simulation',
      label: 'Geometry screen ' + summary.simulation_id,
      detail: 'Deterministic printability screen · ' + String(summary.status),
      status: summary.status,
      verified: verification.ok,
      created_at: summary.created_at,
      record_id: summary.simulation_id,
      hash: verification.manifest_sha256,
      record_key: 'cad-simulation:' + summary.simulation_id,
      url: '/api/cad/simulations/' + encodeURIComponent(summary.simulation_id),
      metadata: {
        cad_project_id: summary.cad_project_id,
        build_id: summary.build_id,
        verdict: summary.status,
        limitations: manifest?.report?.limitations ?? [],
        issues: issueSummary(verification.errors)
      }
    });
    builder.queueEdge(nodeId('cad-build', summary.build_id), id, 'screened_by');
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      builder.addArtifact({
        owner: id,
        ownerType: 'cad-simulation',
        recordId: summary.simulation_id,
        name,
        descriptor,
        url: '/api/cad/artifacts/simulation/' +
          encodeURIComponent(summary.simulation_id) + '/' + encodedPath(name)
      });
    }
  }
  for (const summary of listCadSlices(builder.project)) {
    const verification = verifyCadSlice(builder.project, summary.slice_id);
    const manifest = verification.manifest;
    const id = nodeId('cad-slice', summary.slice_id);
    builder.addNode({
      id,
      type: 'cad-slice',
      label: String(summary.mode ?? 'preview') + ' slice',
      detail: String(manifest?.analysis?.layers ?? 0) + ' layers · printer transmission disabled',
      status: summary.status,
      verified: verification.ok,
      created_at: summary.created_at,
      record_id: summary.slice_id,
      hash: verification.manifest_sha256,
      record_key: 'cad-slice:' + summary.slice_id,
      url: '/api/cad/slices/' + encodeURIComponent(summary.slice_id),
      metadata: {
        cad_project_id: summary.cad_project_id,
        build_id: summary.build_id,
        mode: summary.mode,
        preview_invariants: manifest?.analysis?.preview_only_invariants ?? null,
        printer_transmission: manifest?.printer_transmission ?? 'disabled',
        issues: issueSummary(verification.errors)
      }
    });
    builder.queueEdge(nodeId('cad-build', summary.build_id), id, 'sliced_to');
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      const role = name.startsWith('input/') ? 'input' : 'output';
      builder.addArtifact({
        owner: id,
        ownerType: 'cad-slice',
        recordId: summary.slice_id,
        name,
        descriptor,
        role,
        url: role === 'output'
          ? '/api/cad/artifacts/slice/' + encodeURIComponent(summary.slice_id) +
            '/' + encodedPath(name)
          : null
      });
    }
  }
}

function addInferences(builder) {
  for (const summary of listInferences(builder.project)) {
    const verification = verifyInference(builder.project, summary.inference_id);
    const manifest = verification.manifest;
    const id = nodeId('inference', summary.inference_id);
    const modelLabel = manifest?.model?.path ?? manifest?.model?.source ?? summary.model ??
      summary.inference_id;
    builder.addNode({
      id,
      type: 'inference',
      label: path.posix.basename(portable(modelLabel)),
      detail: String(manifest?.device_request ?? 'device unknown') + ' · ' +
        (manifest?.provider_verification?.npu_executed ? 'NPU verified' : 'NPU not claimed'),
      status: summary.status,
      verified: verification.ok,
      created_at: summary.started_at,
      record_id: summary.inference_id,
      hash: verification.manifest_sha256,
      record_key: 'inference:' + summary.inference_id,
      url: '/api/inferences/' + encodeURIComponent(summary.inference_id),
      metadata: {
        kind: manifest?.kind ?? null,
        device_request: manifest?.device_request ?? null,
        execution_provider: manifest?.runtime?.execution_provider ?? null,
        npu_executed: manifest?.provider_verification?.npu_executed === true,
        provider_profile_event_counts:
          manifest?.provider_verification?.profile_event_counts ??
          manifest?.provider_verification?.node_counts ??
          {},
        fallback_detected: manifest?.provider_verification?.fallback_detected ?? null,
        mean_latency_ms: manifest?.execution?.latency_ms?.mean ?? null,
        duration_ms: manifest?.duration_ms ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    builder.addInput(id, manifest?.model, 'model');
    builder.addInput(id, manifest?.input, 'data');
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      const relative = name.startsWith('artifacts/') ? name.slice('artifacts/'.length) : null;
      const url = relative
        ? '/inference-artifact/' + encodeURIComponent(summary.inference_id) + '/' +
          encodedPath(relative)
        : null;
      const role = [
        'artifacts/model.onnx',
        'artifacts/input.json',
        'artifacts/smoke-model.onnx',
        'artifacts/smoke-input.json',
        'runtime-manifest.json'
      ].includes(name) ? 'input' : 'output';
      builder.addArtifact({
        owner: id,
        ownerType: 'inference',
        recordId: summary.inference_id,
        name,
        descriptor,
        role,
        url
      });
    }
  }
}

function addExperiments(builder) {
  for (const summary of listExperiments(builder.project)) {
    const verification = verifyExperiment(builder.project, summary.experiment_id);
    const manifest = verification.manifest;
    const id = nodeId('experiment', summary.experiment_id);
    builder.addNode({
      id,
      type: 'experiment',
      label: manifest?.name ?? summary.name ?? 'Experiment matrix',
      detail: compact(manifest?.hypothesis ?? summary.hypothesis ?? 'No hypothesis recorded', 260),
      status: summary.status,
      verified: verification.ok,
      created_at: summary.started_at,
      record_id: summary.experiment_id,
      hash: verification.manifest_sha256,
      record_key: 'experiment:' + summary.experiment_id,
      url: '/api/experiments/' + encodeURIComponent(summary.experiment_id),
      metadata: {
        hypothesis: compact(manifest?.hypothesis, 500),
        branch_count: manifest?.branch_count ?? 0,
        completed: manifest?.counts?.completed ?? 0,
        review_verdict: manifest?.review?.verdict ?? null,
        cad_build_id: manifest?.cad_parent?.build_id ?? null,
        cad_project_id: manifest?.cad_parent?.cad_project_id ?? null,
        cad_mesh_sha256: manifest?.cad_parent?.mesh_sha256 ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    if (!compact(manifest?.hypothesis)) {
      builder.finding('warning', 'hypothesis_missing', 'Experiment has no recorded hypothesis.', {
        node_id: id
      });
    }
    if (manifest?.analysis_contract?.analysis_contract_id) {
      builder.queueEdge(
        nodeId('analysis-contract', manifest.analysis_contract.analysis_contract_id),
        id,
        'governs',
        {
          contract_sha256: manifest.analysis_contract.contract_sha256,
          script_sha256: manifest.analysis_contract.script_sha256
        }
      );
    }
    if (manifest?.cad_parent?.build_id) {
      builder.queueEdge(
        nodeId('cad-build', manifest.cad_parent.build_id),
        id,
        'modeled_by',
        {
          study: true,
          mesh_sha256: manifest.cad_parent.mesh_sha256 ?? null
        }
      );
    }
    builder.addInput(id, manifest?.script, 'code');
    for (const simulation of manifest?.simulations ?? []) {
      if (simulation.simulation_id) {
        builder.queueEdge(id, nodeId('simulation', simulation.simulation_id), 'branched_to', {
          branch_index: simulation.branch_index
        });
      }
    }
    for (const [name, descriptor] of Object.entries(manifest?.artifacts ?? {})) {
      builder.addArtifact({
        owner: id,
        ownerType: 'experiment',
        recordId: summary.experiment_id,
        name,
        descriptor,
        url: '/experiment-artifact/' + encodeURIComponent(summary.experiment_id) + '/' + encodedPath(name)
      });
    }
  }
}

function addPreregistrations(builder) {
  for (const summary of listPreregistrations(builder.project)) {
    const verification = verifyPreregistration(builder.project, summary.preregistration_id);
    const record = verification.record;
    const id = nodeId('preregistration', summary.preregistration_id);
    builder.addNode({
      id,
      type: 'preregistration',
      label: summary.name ?? summary.preregistration_id,
      detail: summary.source_file
        ? portable(summary.source_file)
        : String(summary.source_kind ?? 'inline').replaceAll('_', ' '),
      status: summary.status,
      verified: verification.ok,
      created_at: summary.created_at,
      record_id: summary.preregistration_id,
      hash: verification.record_sha256,
      record_key: 'preregistration:' + summary.preregistration_id,
      url: '/api/preregistrations/' + encodeURIComponent(summary.preregistration_id),
      metadata: {
        schema_version: summary.schema_version ?? record?.schema_version ?? null,
        source_kind: summary.source_kind ?? record?.source?.kind ?? 'project_file',
        bytes: summary.bytes ?? record?.bytes ?? null,
        source_status: verification.source_status,
        source_sha256: record?.source_sha256 ?? null,
        frozen_sha256: record?.frozen_sha256 ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    if (record?.frozen_file) {
      builder.addArtifact({
        owner: id,
        ownerType: 'preregistration',
        recordId: summary.preregistration_id,
        name: record.frozen_file,
        descriptor: { sha256: record.frozen_sha256, bytes: record.bytes },
        role: 'input',
        url: '/api/preregistrations/' +
          encodeURIComponent(summary.preregistration_id) + '/source'
      });
    }
  }
}

function addLiterature(builder, evidenceByDoi) {
  for (const summary of listLiteratureRecords(builder.project)) {
    const verification = verifyLiteratureRecord(builder.project, summary.literature_id);
    const manifest = verification.manifest;
    const bibliography = verification.record?.bibliography ?? manifest?.bibliography ?? {};
    const id = nodeId('literature', summary.literature_id);
    builder.addNode({
      id,
      type: 'literature',
      label: bibliography.title ?? summary.identifier ?? summary.literature_id,
      detail: [
        summary.source,
        (bibliography.authors ?? []).slice(0, 3).join(', '),
        bibliography.year,
        bibliography.doi
      ].filter(Boolean).join(' · '),
      status: manifest?.request?.transport ?? 'literature',
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.literature_id,
      hash: verification.manifest_sha256,
      record_key: 'literature:' + summary.literature_id,
      url: '/api/literature/' + encodeURIComponent(summary.literature_id),
      metadata: {
        source: summary.source ?? null,
        identifier: summary.identifier ?? null,
        doi: bibliography.doi ?? null,
        year: bibliography.year ?? null,
        transport: manifest?.request?.transport ?? null,
        retrieved_at: manifest?.request?.retrieved_at ?? null,
        interpretation: 'registry metadata frozen at retrieval time; not the work\'s content',
        issues: issueSummary(verification.errors)
      }
    });
    const doi = String(bibliography.doi ?? '').toLowerCase();
    const evidenceId = doi ? evidenceByDoi.get(doi) : undefined;
    if (evidenceId) {
      builder.queueEdge(id, nodeId('evidence', evidenceId), 'describes');
    }
  }
}

function addAnalysisContracts(builder) {
  for (const summary of listAnalysisContracts(builder.project)) {
    const verification = verifyAnalysisContract(builder.project, summary.analysis_contract_id);
    const manifest = verification.manifest;
    const contract = verification.contract;
    const id = nodeId('analysis-contract', summary.analysis_contract_id);
    builder.addNode({
      id,
      type: 'analysis-contract',
      label: manifest?.name ?? summary.name ?? 'Analysis contract',
      detail: compact(contract?.hypothesis ?? 'Frozen confirmatory analysis rules', 300),
      status: manifest?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.analysis_contract_id,
      hash: verification.manifest_sha256,
      record_key: 'analysis-contract:' + summary.analysis_contract_id,
      url: '/api/analysis-contracts/' + encodeURIComponent(summary.analysis_contract_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        preregistration_id: manifest?.preregistration?.preregistration_id ?? null,
        script: manifest?.script ?? null,
        counts: manifest?.counts ?? {},
        missing_data_policy: contract?.missing_data_policy ?? null,
        multiplicity_policy: contract?.multiplicity_policy ?? null,
        schema_version: manifest?.schema_version ?? null,
        multiplicity_correction: contract?.multiplicity_correction ?? null,
        statistics_engine: manifest?.statistics_engine ?? null,
        source_status: verification.source_status,
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    builder.queueEdge(
      nodeId('preregistration', manifest.preregistration.preregistration_id),
      id,
      'constrains'
    );
    if (manifest.chat_id) builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'authored_in');
    builder.addInput(id, {
      path: manifest.script?.source_path,
      sha256: manifest.script?.frozen_sha256,
      bytes: manifest.script?.bytes
    }, 'code');
    builder.addArtifact({
      owner: id,
      ownerType: 'analysis-contract',
      recordId: summary.analysis_contract_id,
      name: manifest.script?.frozen_file ?? 'script.py',
      descriptor: {
        sha256: manifest.script?.frozen_sha256,
        bytes: manifest.script?.bytes
      },
      role: 'input'
    });
  }
}

function auditTarget(link) {
  if (link?.campaign_id) return nodeId('campaign', link.campaign_id);
  if (link?.procedure_decision_id) {
    return nodeId('procedure-decision', link.procedure_decision_id);
  }
  if (link?.procedure_assessment_id) {
    return nodeId('procedure-assessment', link.procedure_assessment_id);
  }
  if (link?.procedure_id) return nodeId('procedure', link.procedure_id);
  if (link?.analysis_assessment_id) {
    return nodeId('analysis-assessment', link.analysis_assessment_id);
  }
  if (link?.analysis_contract_id) return nodeId('analysis-contract', link.analysis_contract_id);
  if (link?.simulation_id) return nodeId('simulation', link.simulation_id);
  if (link?.inference_id) return nodeId('inference', link.inference_id);
  if (link?.experiment_id) return nodeId('experiment', link.experiment_id);
  if (link?.retrieval_id) return nodeId('retrieval', link.retrieval_id);
  if (link?.preregistration_id) return nodeId('preregistration', link.preregistration_id);
  if (link?.run_id) return nodeId('run', link.run_id);
  return null;
}

function addCampaigns(builder) {
  for (const summary of listCampaigns(builder.project)) {
    const verification = verifyCampaign(builder.project, summary.campaign_id);
    const manifest = verification.manifest;
    const plan = verification.plan;
    const state = verification.state;
    let campaignEvents = [];
    try {
      campaignEvents = getCampaign(builder.project, summary.campaign_id).events;
    } catch {
      // The campaign verifier below carries the integrity finding.
    }
    const campaignNode = nodeId('campaign', summary.campaign_id);
    builder.addNode({
      id: campaignNode,
      type: 'campaign',
      label: manifest?.title ?? summary.title ?? summary.campaign_id,
      detail: compact(manifest?.question ?? summary.question, 300),
      status: state?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at ?? summary.created_at,
      record_id: summary.campaign_id,
      hash: verification.manifest_sha256,
      record_key: 'campaign:' + summary.campaign_id,
      url: '/api/campaigns/' + encodeURIComponent(summary.campaign_id),
      metadata: {
        chat_id: manifest?.chat_id ?? summary.chat_id,
        classification: manifest?.classification ?? summary.classification,
        ai_disclosure: manifest?.ai_disclosure ?? null,
        event_count: verification.event_count ?? 0,
        event_head_sha256: verification.event_head_sha256 ?? null,
        budget: state?.budget ?? summary.budget ?? null,
        counts: state?.counts ?? summary.counts ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    if (manifest?.plan) {
      builder.addArtifact({
        owner: campaignNode,
        ownerType: 'campaign',
        recordId: summary.campaign_id,
        name: manifest.plan.file ?? 'plan.json',
        descriptor: manifest.plan,
        role: 'input'
      });
    }
    if (manifest?.chat_id) {
      builder.queueEdge(
        campaignNode,
        nodeId('chat', manifest.chat_id),
        'executed_in'
      );
    }
    if (!plan || !state) continue;
    const hypothesisNodes = new Map();
    for (const hypothesis of plan.hypotheses) {
      const hypothesisState = state.hypotheses?.find((candidate) =>
        candidate.hypothesis_id === hypothesis.id) ?? null;
      const hypothesisNode = nodeId(
        'hypothesis',
        summary.campaign_id,
        hypothesis.id
      );
      hypothesisNodes.set(hypothesis.id, hypothesisNode);
      builder.addNode({
        id: hypothesisNode,
        type: 'hypothesis',
        label: hypothesis.id,
        detail: compact(hypothesis.statement, 300),
        status: hypothesisState?.verdict ?? 'proposed',
        verified: verification.ok,
        created_at: manifest.created_at,
        record_id: hypothesis.id,
        hash: sha256Json(hypothesis),
        metadata: {
          campaign_id: summary.campaign_id,
          priority: hypothesis.priority,
          parent_id: hypothesis.parent_id ?? null,
          relation: hypothesis.relation ?? 'root',
          falsification: hypothesis.falsification,
          rationale: hypothesis.rationale,
          decision: hypothesisState?.decision ?? 'continue',
          effective_status: hypothesisState?.effective_status ?? 'active',
          inherited_from: hypothesisState?.inherited_from ?? null,
          assessment_count: hypothesisState?.assessment_count ?? 0,
          latest_assessment: hypothesisState?.latest_assessment ?? null,
          budget: hypothesisState?.budget ?? hypothesis.budget ?? null,
          task_counts: hypothesisState?.task_counts ?? null
        }
      });
      builder.queueEdge(campaignNode, hypothesisNode, 'contains');
      if (hypothesis.parent_id) {
        builder.queueEdge(
          nodeId('hypothesis', summary.campaign_id, hypothesis.parent_id),
          hypothesisNode,
          hypothesis.relation ?? 'branches_to'
        );
      }
    }
    for (const task of plan.tasks) {
      const taskState = state.tasks.find((candidate) =>
        candidate.task_id === task.id);
      const taskNode = nodeId('campaign-task', summary.campaign_id, task.id);
      builder.addNode({
        id: taskNode,
        type: 'campaign-task',
        label: task.title,
        detail: compact(task.objective, 300),
        status: taskState?.status ?? 'pending',
        verified: verification.ok,
        created_at: manifest.created_at,
        record_id: task.id,
        hash: sha256Json({
          campaign_sha256: verification.manifest_sha256,
          task
        }),
        metadata: {
          campaign_id: summary.campaign_id,
          lane: task.lane,
          compute: task.compute,
          risk: task.risk,
          checkpoint: task.checkpoint,
          max_attempts: task.max_attempts,
          attempts: taskState?.attempts ?? [],
          expected_outputs: task.expected_outputs,
          reason: taskState?.reason ?? null
        }
      });
      builder.queueEdge(campaignNode, taskNode, 'contains');
      for (const dependency of task.depends_on) {
        builder.queueEdge(
          nodeId('campaign-task', summary.campaign_id, dependency),
          taskNode,
          'precedes'
        );
      }
      for (const hypothesisId of task.hypothesis_ids) {
        const hypothesisNode = hypothesisNodes.get(hypothesisId);
        if (hypothesisNode) builder.queueEdge(hypothesisNode, taskNode, 'tested_by');
      }
      for (const attempt of taskState?.attempts ?? []) {
        if (attempt.turn_index) {
          builder.queueEdge(
            taskNode,
            nodeId('turn', manifest.chat_id, attempt.turn_index),
            'executed_as',
            { attempt: attempt.attempt, status: attempt.status }
          );
        }
        if (attempt.run_id) {
          builder.queueEdge(
            taskNode,
            nodeId('run', attempt.run_id),
            'executed_as',
            { attempt: attempt.attempt, status: attempt.status }
          );
        }
      }
      const terminalEvents = campaignEvents.filter((event) =>
        event.payload?.task_id === task.id &&
        ['task.completed', 'task.failed', 'task.cancelled'].includes(event.type));
      for (const event of terminalEvents) {
        for (const link of event.payload?.linked_records ?? []) {
          const target = auditTarget(link);
          if (target) {
            builder.queueEdge(taskNode, target, 'created', {
              attempt: event.payload.attempt,
              event_id: event.event_id,
              event_type: link.type
            });
          }
        }
      }
    }
  }
}

function addChats(builder) {
  const turnRecords = new Map();
  for (const summary of listChats(builder.project)) {
    const verification = verifyChat(builder.project, summary.chat_id);
    let detail = null;
    try {
      detail = getChatSession(builder.project, summary.chat_id);
    } catch {
      // The verifier finding represents an unreadable transcript.
    }
    const manifest = detail?.manifest;
    const chatNode = nodeId('chat', summary.chat_id);
    builder.addNode({
      id: chatNode,
      type: 'chat',
      label: manifest?.title ?? summary.title ?? 'Research conversation',
      detail: (manifest?.agent ?? summary.agent ?? 'scientist') + ' · ' +
        (manifest?.turn_count ?? summary.turn_count ?? 0) + ' turn(s)',
      status: summary.status,
      verified: verification.ok,
      created_at: manifest?.started_at ?? summary.started_at,
      record_id: summary.chat_id,
      hash: manifest?.turn_head_sha256,
      record_key: 'chat:' + summary.chat_id,
      url: '/api/chats/' + encodeURIComponent(summary.chat_id),
      metadata: {
        agent: manifest?.agent ?? summary.agent,
        turn_count: manifest?.turn_count ?? summary.turn_count,
        session_consistent: detail?.turns?.every((turn) => turn.session_consistent !== false) ?? null,
        issues: issueSummary(verification.errors)
      }
    });
    let previous = null;
    for (const turn of detail?.turns ?? []) {
      const turnNode = nodeId('turn', summary.chat_id, turn.turn_index);
      builder.addNode({
        id: turnNode,
        type: 'turn',
        label: 'Turn ' + turn.turn_index,
        detail: compact(turn.user?.text, 260),
        status: turn.status,
        verified: verification.ok,
        created_at: turn.started_at,
        record_id: String(turn.turn_index),
        hash: manifest?.turns?.[turn.turn_index - 1]?.sha256 ?? null,
        record_key: 'turn:' + summary.chat_id + ':' + turn.turn_index,
        metadata: {
          chat_id: summary.chat_id,
          turn_index: turn.turn_index,
          agent: turn.agent,
          run_id: turn.run_id,
          user_sha256: turn.user?.sha256 ?? null,
          assistant_sha256: turn.assistant?.sha256 ?? null,
          evidence_retrieval_id: turn.evidence_context?.retrieval_id ?? null,
          notebook_cells: turn.kernel_context?.count ?? 0,
          interaction_count: turn.interaction_context?.count ?? 0,
          session_consistent: turn.session_consistent
        }
      });
      builder.queueEdge(chatNode, turnNode, 'contains');
      if (previous) builder.queueEdge(previous, turnNode, 'precedes');
      previous = turnNode;
      if (turn.run_id) builder.queueEdge(turnNode, nodeId('run', turn.run_id), 'executed_as');
      if (turn.evidence_context?.retrieval_id) {
        builder.queueEdge(nodeId('retrieval', turn.evidence_context.retrieval_id), turnNode, 'grounded');
      }
      for (const cell of turn.kernel_context?.cells ?? []) {
        builder.queueEdge(nodeId('cell', cell.kernel_id, cell.cell_id), turnNode, 'informed');
      }
      for (const link of turn.linked_records ?? []) {
        const target = auditTarget(link);
        if (target) {
          builder.queueEdge(turnNode, target, 'created', {
            event_type: link.type,
            sequence: link.sequence
          });
        }
      }
      const recordedInputs = (turn.evidence_context ? 1 : 0) +
        (turn.kernel_context?.count ?? 0) +
        (turn.interaction_context?.count ?? 0) +
        (turn.linked_records?.length ?? 0);
      if (turn.status === 'completed' && recordedInputs === 0) {
        builder.finding('warning', 'turn_without_recorded_scientific_inputs',
          'This completed AI turn has no recorded evidence retrieval, notebook cell, user workspace state, or linked scientific record.', {
            node_id: turnNode
          });
      }
      turnRecords.set(turnNode, turn);
    }
  }
  return turnRecords;
}

function interactionTarget(builder, record) {
  if (record.surface === 'lineage' && builder.nodes.has(record.payload?.node_id)) {
    return record.payload.node_id;
  }
  if (record.surface === 'notebook' && record.payload?.kernel_id && record.payload?.cell_id) {
    const cell = builder.recordNodes.get(
      'cell:' + record.payload.kernel_id + ':' + record.payload.cell_id
    );
    if (cell) return cell;
  }
  const artifact = record.artifact;
  if (!artifact) return null;
  if (artifact.url && builder.artifactByUrl.has(artifact.url)) {
    return builder.artifactByUrl.get(artifact.url);
  }
  const recordKey = artifact.kind && artifact.record_id
    ? artifact.kind + ':' + artifact.record_id
    : null;
  const owner = recordKey ? builder.recordNodes.get(recordKey) : null;
  if (!owner) return null;
  if (artifact.name) {
    return builder.artifactByOwnerAndName.get(owner + '\n' + portable(artifact.name)) ??
      builder.artifactByOwnerAndName.get(owner + '\n' + path.posix.basename(portable(artifact.name))) ??
      owner;
  }
  return owner;
}

function addInteractions(builder, turnRecords) {
  for (const chat of listChats(builder.project)) {
    let records = [];
    let verification;
    try {
      verification = verifyInteractions(builder.project, chat.chat_id);
      records = listInteractions(builder.project, chat.chat_id);
    } catch (error) {
      builder.finding('error', 'interaction_log_unreadable', error.message, {
        node_id: nodeId('chat', chat.chat_id)
      });
      continue;
    }
    const recordByHash = new Map(records.map((record, index) => [record.hash, index]));
    const consumed = new Set();
    for (const record of records) {
      const id = nodeId('interaction', record.interaction_id);
      builder.addNode({
        id,
        type: 'interaction',
        label: record.surface + ' · ' + record.action,
        detail: record.artifact?.name ?? record.artifact?.record_id ?? 'workspace state',
        status: 'user-authored',
        verified: verification.ok,
        created_at: record.ts,
        record_id: record.interaction_id,
        hash: record.hash,
        record_key: 'interaction:' + record.interaction_id,
        metadata: {
          chat_id: record.chat_id,
          surface: record.surface,
          action: record.action,
          artifact: record.artifact,
          payload_sha256: record.payload_sha256,
          issues: issueSummary(verification.errors)
        }
      });
      builder.queueEdge(nodeId('chat', chat.chat_id), id, 'contains');
      const target = interactionTarget(builder, record);
      if (target) builder.queueEdge(target, id, 'revised_as');
      else if (record.artifact) {
        builder.finding('warning', 'interaction_source_unresolved',
          'The source artifact for this user interaction could not be resolved.', { node_id: id });
      }
    }
    for (const [turnNode, turn] of turnRecords) {
      if (turn.chat_id !== chat.chat_id || !turn.interaction_context?.head_hash) continue;
      const head = recordByHash.get(turn.interaction_context.head_hash);
      if (!Number.isInteger(head)) continue;
      const count = Math.max(0, Number(turn.interaction_context.count) || 0);
      for (const record of records.slice(Math.max(0, head - count + 1), head + 1)) {
        const interactionNode = nodeId('interaction', record.interaction_id);
        builder.queueEdge(interactionNode, turnNode, 'informed');
        consumed.add(record.interaction_id);
      }
    }
    for (const record of records) {
      if (!consumed.has(record.interaction_id)) {
        builder.finding('info', 'interaction_pending_ai_turn',
          'This user-authored workspace state has not yet been included in a completed AI turn.', {
            node_id: nodeId('interaction', record.interaction_id)
          });
      }
    }
  }
}

function addArtifactRevisions(builder) {
  for (const summary of listArtifactRevisions(builder.project)) {
    const verification = verifyArtifactRevision(builder.project, summary.revision_id);
    const manifest = verification.manifest;
    const id = nodeId('revision', summary.revision_id);
    builder.addNode({
      id,
      type: 'revision',
      label: (manifest?.artifact?.name ?? summary.revision_id) + ' revision',
      detail: manifest?.note ?? 'Immutable derived artifact proposal',
      status: verification.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.revision_id,
      hash: verification.manifest_sha256,
      record_key: 'revision:' + summary.revision_id,
      url: '/api/revisions/' + encodeURIComponent(summary.revision_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        source: manifest?.source ?? null,
        artifact: manifest?.artifact ?? null,
        previous_revision_id: manifest?.previous_revision?.revision_id ?? null,
        decision_count: verification.decisions.length,
        decision_head_hash: verification.decision_head_hash,
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'contains');
    const source = builder.artifactByUrl.get(manifest.source?.url);
    if (source) {
      builder.queueEdge(source, id, 'derived_as', {
        source_sha256: manifest.source.sha256,
        artifact_sha256: manifest.artifact?.sha256 ?? null
      });
    } else {
      const missing = nodeId('missing', 'revision-source', summary.revision_id);
      builder.queueEdge(missing, id, 'derived_as');
      builder.finding('error', 'revision_source_unresolved',
        'The immutable source artifact for this revision could not be resolved.', { node_id: id });
    }
    const previousId = manifest.previous_revision?.revision_id;
    if (previousId) {
      builder.queueEdge(nodeId('revision', previousId), id, 'revised_as');
    }
    builder.addArtifact({
      owner: id,
      ownerType: 'revision',
      recordId: summary.revision_id,
      name: manifest.artifact?.name ?? 'revision.bin',
      descriptor: manifest.artifact,
      role: 'output',
      url: '/revision-artifact/' + encodeURIComponent(summary.revision_id)
    });
    if (verification.ok && verification.status === 'proposed') {
      builder.finding('warning', 'revision_pending_decision',
        'This derived artifact revision has not been explicitly accepted or rejected.', {
          node_id: id
        });
    }
    for (const decision of verification.decisions) {
      const decisionNode = nodeId('decision', summary.revision_id, decision.decision_id);
      builder.addNode({
        id: decisionNode,
        type: 'decision',
        label: 'Revision ' + decision.decision,
        detail: decision.note ?? summary.revision_id,
        status: decision.decision,
        verified: verification.ok,
        created_at: decision.ts,
        record_id: decision.decision_id,
        hash: decision.hash,
        record_key: 'decision:' + decision.decision_id,
        metadata: {
          revision_id: summary.revision_id,
          chat_id: decision.chat_id,
          decision: decision.decision,
          note: decision.note ?? null
        }
      });
      builder.queueEdge(id, decisionNode, 'reviewed_as');
      builder.queueEdge(nodeId('chat', decision.chat_id), decisionNode, 'contains');
    }
  }
}

function addSemanticReviews(builder) {
  for (const summary of listSemanticReviews(builder.project)) {
    const verification = verifySemanticReview(builder.project, summary.review_id);
    const manifest = verification.manifest;
    const report = verification.report;
    const id = nodeId('review', summary.review_id);
    builder.addNode({
      id,
      type: 'review',
      label: 'Semantic review · ' + (manifest?.target?.name ?? summary.review_id),
      detail: report
        ? String(report.summary?.claims ?? 0) + ' claims · ' +
          String(report.summary?.findings ?? 0) + ' findings'
        : 'Unreadable semantic review',
      status: manifest?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.review_id,
      hash: verification.manifest_sha256,
      record_key: 'review:' + summary.review_id,
      url: '/api/reviews/' + encodeURIComponent(summary.review_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        target: manifest?.target ?? null,
        report_sha256: verification.report_sha256 ?? null,
        current_for_target: summary.current_for_target,
        superseded_by: summary.superseded_by,
        reviewer: summary.reviewer ?? null,
        counts: report?.summary ?? {},
        priority_findings: (report?.findings ?? []).slice(0, 12).map((finding) => ({
          severity: finding.severity,
          category: finding.category,
          code: finding.code,
          claim_id: finding.claim_id,
          line_start: finding.line_start
        })),
        interpretation: 'deterministic triage; not proof of scientific entailment',
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'requested');
    if (summary.superseded_by) {
      builder.queueEdge(id, nodeId('review', summary.superseded_by), 'superseded_by');
    }
    const target = builder.artifactByUrl.get(manifest.target?.url);
    if (target) {
      builder.queueEdge(target, id, 'reviewed_by', {
        target_sha256: manifest.target.sha256,
        report_sha256: verification.report_sha256 ?? null
      });
    } else {
      builder.finding('error', 'semantic_review_target_unresolved',
        'The immutable artifact reviewed by this record could not be resolved.', { node_id: id });
    }
    const evidenceIds = [...new Set((report?.citations ?? [])
      .filter((citation) => citation.ok && citation.evidence_id)
      .map((citation) => citation.evidence_id))];
    for (const evidenceId of evidenceIds) {
      builder.queueEdge(nodeId('evidence', evidenceId), id, 'examined_by');
    }
    if (verification.ok && summary.superseded_by) {
      builder.finding('info', 'semantic_review_superseded',
        'A newer verified review exists for the same immutable target and conversation.', {
          node_id: id,
          superseded_by: summary.superseded_by
        });
    } else if (verification.ok && report?.summary?.errors) {
      builder.finding('warning', 'semantic_review_failed',
        'The reviewer found ' + report.summary.errors +
        ' high-priority claim, citation, calculation, or artifact consistency issue(s).', {
          node_id: id
        });
    } else if (verification.ok && report?.summary?.warnings) {
      builder.finding('info', 'semantic_review_attention',
        'The reviewer recorded ' + report.summary.warnings + ' item(s) for qualified inspection.', {
          node_id: id
        });
    }
  }
}

function addFigureComparisons(builder) {
  for (const summary of listFigureComparisons(builder.project)) {
    const verification = verifyFigureComparison(
      builder.project,
      summary.figure_comparison_id
    );
    const manifest = verification.manifest;
    const report = verification.report;
    const id = nodeId(
      'figure-comparison',
      summary.figure_comparison_id
    );
    builder.addNode({
      id,
      type: 'figure-comparison',
      label: manifest?.name ?? summary.figure_comparison_id,
      detail: report
        ? String(report.reproduction_status) + ' · ' +
          String(report.metrics?.tolerance_exceeding_pixels ?? 'n/a') +
          ' changed pixel(s)' +
          (Number.isFinite(
            report.metrics?.structural_similarity
              ?.mean_structural_similarity
          )
            ? ' / SSIM ' +
              report.metrics.structural_similarity
                .mean_structural_similarity.toFixed(6)
            : '')
        : 'Unreadable figure comparison',
      status: manifest?.reproduction_status ?? summary.reproduction_status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.figure_comparison_id,
      hash: verification.manifest_sha256,
      record_key: 'figure-comparison:' + summary.figure_comparison_id,
      url: '/api/figure-comparisons/' +
        encodeURIComponent(summary.figure_comparison_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        status: manifest?.status ?? summary.status,
        reproduction_status:
          manifest?.reproduction_status ?? summary.reproduction_status,
        baseline: manifest?.baseline ?? null,
        candidate: manifest?.candidate ?? null,
        summary: report?.summary ?? manifest?.summary ?? {},
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    if (manifest.chat_id) {
      builder.queueEdge(
        nodeId('chat', manifest.chat_id),
        id,
        'authored_in'
      );
    }
    for (const [role, source] of [
      ['baseline', manifest.baseline],
      ['candidate', manifest.candidate]
    ]) {
      const sourceNode = builder.artifactByUrl.get(source?.url);
      if (sourceNode) {
        builder.queueEdge(sourceNode, id, 'compared_by', {
          role,
          source_sha256: source.sha256
        });
      } else {
        const missing = nodeId(
          'missing',
          'figure-comparison-' + role,
          summary.figure_comparison_id
        );
        builder.queueEdge(missing, id, 'compared_by', { role });
        builder.finding(
          'error',
          'figure_comparison_' + role + '_unresolved',
          'The immutable ' + role +
            ' artifact for this figure comparison could not be resolved.',
          { node_id: id }
        );
      }
    }
    for (const [name, descriptor] of Object.entries(
      manifest.artifacts ?? {}
    )) {
      builder.addArtifact({
        owner: id,
        ownerType: 'figure-comparison',
        recordId: summary.figure_comparison_id,
        name,
        descriptor,
        role: ['baseline.png', 'candidate.png'].includes(name)
          ? 'input' : 'output',
        url: '/figure-comparison-artifact/' +
          encodeURIComponent(summary.figure_comparison_id) + '/' +
          encodeURIComponent(name)
      });
    }
    if (verification.ok && manifest.status !== 'pass') {
      builder.finding(
        'warning',
        'figure_reproduction_attention',
        'The verified figure comparison did not satisfy its frozen pixel and optional structural-similarity rules.',
        { node_id: id, reproduction_status: manifest.reproduction_status }
      );
    }
  }
}

function addFigureRegistrations(builder) {
  for (const summary of listFigureRegistrations(builder.project)) {
    const verification = verifyFigureRegistration(
      builder.project,
      summary.figure_registration_id
    );
    const manifest = verification.manifest;
    const report = verification.report;
    const id = nodeId('figure-registration', summary.figure_registration_id);
    builder.addNode({
      id,
      type: 'figure-registration',
      label: manifest?.name ?? summary.figure_registration_id,
      detail: report
        ? String(report.registration_status) + ' · ' +
          String(report.summary?.plotted_points ?? 0) + ' plotted point(s) · ' +
          String(report.summary?.series ?? 0) + ' series'
        : 'Unreadable semantic figure registration',
      status: manifest?.registration_status ?? summary.registration_status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.figure_registration_id,
      hash: verification.manifest_sha256,
      record_key: 'figure-registration:' + summary.figure_registration_id,
      url: '/api/figure-registrations/' +
        encodeURIComponent(summary.figure_registration_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        status: manifest?.status ?? summary.status,
        registration_status:
          manifest?.registration_status ?? summary.registration_status,
        figure: manifest?.figure ?? null,
        source: manifest?.source ?? null,
        sidecar: manifest?.sidecar ?? null,
        contract_sha256: manifest?.contract_sha256 ?? null,
        summary: report?.summary ?? manifest?.summary ?? {},
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    if (manifest.chat_id) {
      builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'authored_in');
    }
    for (const [role, source] of [
      ['figure', manifest.figure],
      ['source', manifest.source],
      ['sidecar', manifest.sidecar]
    ]) {
      const sourceNode = builder.artifactByUrl.get(source?.url);
      if (sourceNode) {
        builder.queueEdge(sourceNode, id, 'registered_by', {
          role,
          source_sha256: source.sha256
        });
      } else {
        const missing = nodeId(
          'missing',
          'figure-registration-' + role,
          summary.figure_registration_id
        );
        builder.queueEdge(missing, id, 'registered_by', { role });
        builder.finding(
          'error',
          'figure_registration_' + role + '_unresolved',
          'The immutable ' + role +
            ' artifact for this semantic figure registration could not be resolved.',
          { node_id: id }
        );
      }
    }
    const artifacts = manifest.artifacts &&
      typeof manifest.artifacts === 'object' &&
      !Array.isArray(manifest.artifacts)
      ? manifest.artifacts : {};
    for (const [name, descriptor] of Object.entries(artifacts)) {
      builder.addArtifact({
        owner: id,
        ownerType: 'figure-registration',
        recordId: summary.figure_registration_id,
        name,
        descriptor,
        role: ['figure.png', 'source.csv', 'source.tsv', 'sidecar.json'].includes(name)
          ? 'input' : 'output',
        url: '/figure-registration-artifact/' +
          encodeURIComponent(summary.figure_registration_id) + '/' +
          encodeURIComponent(name)
      });
    }
    if (verification.ok && manifest.status !== 'pass') {
      builder.finding(
        'warning',
        'figure_semantic_registration_attention',
        'The verified semantic figure record did not match its frozen PNG, ' +
          'source, contract, and replay bindings.',
        { node_id: id, registration_status: manifest.registration_status }
      );
    }
  }
}

function addFigureVisuals(builder) {
  for (const summary of listFigureVisuals(builder.project)) {
    const verification = verifyFigureVisual(
      builder.project,
      summary.figure_visual_id
    );
    const manifest = verification.manifest;
    const report = verification.report;
    const id = nodeId('figure-visual', summary.figure_visual_id);
    builder.addNode({
      id,
      type: 'figure-visual',
      label: manifest?.name ?? summary.figure_visual_id,
      detail: report
        ? String(report.visual_status) + ' · ' +
          String(report.summary?.matched_mark_samples ?? 0) + '/' +
          String(report.summary?.expected_mark_samples ?? 0) +
          ' expected mark sample(s) · ' +
          String(report.summary?.failed_checks ?? 0) + ' failed check(s)'
        : 'Unreadable decoded-pixel figure validation',
      status: manifest?.visual_status ?? summary.visual_status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.figure_visual_id,
      hash: verification.manifest_sha256,
      record_key: 'figure-visual:' + summary.figure_visual_id,
      url: '/api/figure-visuals/' + encodeURIComponent(summary.figure_visual_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        status: manifest?.status ?? summary.status,
        visual_status: manifest?.visual_status ?? summary.visual_status,
        figure_registration_id:
          manifest?.figure_registration?.figure_registration_id ??
          summary.figure_registration_id ?? null,
        figure_sha256:
          manifest?.figure_registration?.figure_sha256 ??
          summary.figure_sha256 ?? null,
        profile_sha256: manifest?.profile_sha256 ?? summary.profile_sha256 ?? null,
        engine: manifest?.engine ?? null,
        summary: report?.summary ?? manifest?.summary ?? {},
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    if (manifest.chat_id) {
      builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'authored_in');
    }
    const registrationId = manifest.figure_registration?.figure_registration_id;
    if (registrationId) {
      const parentId = nodeId('figure-registration', registrationId);
      if (builder.nodes.has(parentId)) {
        builder.queueEdge(parentId, id, 'visually_validated_by', {
          parent_manifest_sha256:
            manifest.figure_registration?.manifest_sha256 ?? null,
          figure_sha256: manifest.figure_registration?.figure_sha256 ?? null
        });
      } else {
        const missing = nodeId(
          'missing',
          'figure-visual-registration',
          summary.figure_visual_id
        );
        builder.queueEdge(missing, id, 'visually_validated_by');
        builder.finding(
          'error',
          'figure_visual_registration_unresolved',
          'The semantic figure registration for this visual validation could not be resolved.',
          { node_id: id }
        );
      }
    }
    const visualArtifacts = manifest.artifacts &&
      typeof manifest.artifacts === 'object' &&
      !Array.isArray(manifest.artifacts)
      ? manifest.artifacts : {};
    for (const [name, descriptor] of Object.entries(visualArtifacts)) {
      builder.addArtifact({
        owner: id,
        ownerType: 'figure-visual',
        recordId: summary.figure_visual_id,
        name,
        descriptor,
        role: 'output',
        url: '/figure-visual-artifact/' +
          encodeURIComponent(summary.figure_visual_id) + '/' +
          encodeURIComponent(name)
      });
    }
    if (verification.ok && manifest.status !== 'pass') {
      builder.finding(
        'warning',
        'figure_visual_attention',
        'The verified decoded-pixel figure record did not satisfy its frozen axis, mark, unexpected-pixel, or background rules.',
        { node_id: id, visual_status: manifest.visual_status }
      );
    }
  }
}

function addProcedures(builder) {
  for (const summary of listProcedures(builder.project)) {
    const verification = verifyProcedure(builder.project, summary.procedure_id);
    const manifest = verification.manifest;
    const procedure = verification.procedure;
    const id = nodeId('procedure', summary.procedure_id);
    builder.addNode({
      id,
      type: 'procedure',
      label: manifest?.name ?? summary.name ?? 'Procedure plan',
      detail: compact(procedure?.objective ?? 'Immutable structured procedure', 300),
      status: manifest?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.procedure_id,
      hash: verification.manifest_sha256,
      record_key: 'procedure:' + summary.procedure_id,
      url: '/api/procedures/' + encodeURIComponent(summary.procedure_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        domain: manifest?.domain ?? summary.domain,
        counts: manifest?.counts ?? summary.counts ?? {},
        source_evidence_count: manifest?.source_evidence?.length ?? 0,
        automation_targets: manifest?.automation_targets ?? [],
        physical_execution_enabled: false,
        current: summary.current,
        superseded_by: summary.superseded_by,
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    if (manifest.chat_id) builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'authored_in');
    for (const source of manifest.source_evidence ?? []) {
      builder.queueEdge(
        nodeId('evidence', source.evidence_id),
        id,
        'informs',
        { manifest_sha256: source.manifest_sha256 }
      );
    }
    builder.addArtifact({
      owner: id,
      ownerType: 'procedure',
      recordId: summary.procedure_id,
      name: manifest.procedure?.file ?? 'procedure.json',
      descriptor: manifest.procedure,
      url: '/api/procedures/' + encodeURIComponent(summary.procedure_id)
    });
    if (summary.superseded_by) {
      builder.queueEdge(id, nodeId('procedure', summary.superseded_by), 'superseded_by');
      if (verification.ok) {
        builder.finding(
          'info',
          'procedure_superseded',
          'A newer immutable procedure version supersedes this plan.',
          { node_id: id, superseded_by: summary.superseded_by }
        );
      }
    }
  }
}

function addProcedureAssessments(builder) {
  for (const summary of listProcedureAssessments(builder.project)) {
    const verification = verifyProcedureAssessment(
      builder.project, summary.procedure_assessment_id);
    const manifest = verification.manifest;
    const report = verification.report;
    const id = nodeId('procedure-assessment', summary.procedure_assessment_id);
    builder.addNode({
      id,
      type: 'procedure-assessment',
      label: 'Procedure logical dry-run',
      detail: report
        ? String(report.summary?.gates_passed ?? 0) + ' gates passed / ' +
          String(report.summary?.errors ?? 0) + ' blockers'
        : 'Unreadable procedure assessment',
      status: manifest?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.procedure_assessment_id,
      hash: verification.manifest_sha256,
      record_key: 'procedure-assessment:' + summary.procedure_assessment_id,
      url: '/api/procedure-assessments/' +
        encodeURIComponent(summary.procedure_assessment_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        procedure_id: manifest?.procedure?.procedure_id ?? summary.procedure_id,
        current_for_procedure: summary.current_for_procedure,
        superseded_by: summary.superseded_by,
        summary: report?.summary ?? {},
        adapter_status: (report?.adapters ?? []).map((item) => ({
          target: item.target,
          requested: item.requested,
          status: item.status
        })),
        physical_execution_enabled: false,
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    builder.queueEdge(
      nodeId('procedure', manifest.procedure.procedure_id),
      id,
      'validated_by'
    );
    if (manifest.chat_id) builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'requested');
    builder.addArtifact({
      owner: id,
      ownerType: 'procedure-assessment',
      recordId: summary.procedure_assessment_id,
      name: manifest.report?.file ?? 'report.json',
      descriptor: manifest.report,
      url: '/api/procedure-assessments/' +
        encodeURIComponent(summary.procedure_assessment_id)
    });
    if (summary.superseded_by) {
      builder.queueEdge(
        id,
        nodeId('procedure-assessment', summary.superseded_by),
        'superseded_by'
      );
    }
    if (verification.ok && summary.current_for_procedure &&
        report?.status === 'blocked') {
      builder.finding(
        'warning',
        'procedure_assessment_blocked',
        'The current procedure logical dry-run has unresolved structural, source, control, or hazard blockers.',
        {
          node_id: id,
          blockers: report.summary?.errors ?? 0
        }
      );
    } else if (verification.ok && summary.superseded_by) {
      builder.finding(
        'info',
        'procedure_assessment_superseded',
        'A newer verified dry-run assessment exists for this exact procedure.',
        { node_id: id, superseded_by: summary.superseded_by }
      );
    }
  }
}

function addProcedureDecisions(builder, now) {
  for (const summary of listProcedureDecisions(builder.project, { now })) {
    const verification = verifyProcedureDecision(
      builder.project, summary.procedure_decision_id);
    const manifest = verification.manifest;
    const decision = verification.decision;
    const id = nodeId('procedure-decision', summary.procedure_decision_id);
    builder.addNode({
      id,
      type: 'procedure-decision',
      label: (manifest?.status ?? summary.status) + ' ' +
        (manifest?.scope ?? summary.scope ?? 'procedure decision'),
      detail: compact(decision?.basis ?? 'Local human procedure attestation', 300),
      status: manifest?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.procedure_decision_id,
      hash: verification.manifest_sha256,
      record_key: 'procedure-decision:' + summary.procedure_decision_id,
      url: '/api/procedure-decisions/' +
        encodeURIComponent(summary.procedure_decision_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        procedure_id: manifest?.procedure?.procedure_id ?? summary.procedure_id,
        procedure_assessment_id:
          manifest?.assessment?.procedure_assessment_id ??
          summary.procedure_assessment_id,
        scope: manifest?.scope ?? summary.scope,
        reviewer_role: manifest?.reviewer?.role ?? null,
        reviewer_identity_verified: false,
        expires_at: manifest?.expires_at ?? null,
        current_for_scope: summary.current_for_scope,
        effective: summary.effective,
        effective_status: summary.effective_status,
        superseded_by: summary.superseded_by,
        physical_execution_enabled: false,
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    builder.queueEdge(
      nodeId('procedure', manifest.procedure.procedure_id),
      id,
      'governed_by'
    );
    builder.queueEdge(
      nodeId('procedure-assessment', manifest.assessment.procedure_assessment_id),
      id,
      'basis_for'
    );
    if (manifest.chat_id) builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'requested');
    builder.addArtifact({
      owner: id,
      ownerType: 'procedure-decision',
      recordId: summary.procedure_decision_id,
      name: manifest.decision?.file ?? 'decision.json',
      descriptor: manifest.decision,
      url: '/api/procedure-decisions/' +
        encodeURIComponent(summary.procedure_decision_id)
    });
    if (summary.superseded_by) {
      builder.queueEdge(
        id,
        nodeId('procedure-decision', summary.superseded_by),
        'superseded_by'
      );
    }
    if (verification.ok && summary.effective &&
        summary.scope === 'external_physical_execution') {
      builder.finding(
        'info',
        'external_physical_attestation_recorded',
        'A current local human attestation exists, but ScienceCode does not verify identity, facility authority, training, or hardware readiness.',
        { node_id: id, expires_at: manifest.expires_at }
      );
    } else if (verification.ok && summary.expired) {
      builder.finding(
        'info',
        'procedure_decision_expired',
        'This scoped procedure decision is expired.',
        { node_id: id, expires_at: manifest.expires_at }
      );
    } else if (verification.ok && summary.superseded_by) {
      builder.finding(
        'info',
        'procedure_decision_superseded',
        'A newer decision exists for the same procedure and scope.',
        { node_id: id, superseded_by: summary.superseded_by }
      );
    }
  }
}

function addConfirmatoryAssessments(builder) {
  for (const summary of listConfirmatoryAssessments(builder.project)) {
    const verification = verifyConfirmatoryAssessment(
      builder.project,
      summary.analysis_assessment_id
    );
    const manifest = verification.manifest;
    const report = verification.report;
    const id = nodeId('analysis-assessment', summary.analysis_assessment_id);
    builder.addNode({
      id,
      type: 'analysis-assessment',
      label: 'Confirmatory assessment',
      detail: report
        ? String(report.summary?.primary_passed ?? 0) + '/' +
          String(report.summary?.primary ?? 0) + ' primary outcomes passed / ' +
          String(report.registration?.status ?? 'unknown')
        : 'Unreadable confirmatory assessment',
      status: manifest?.status ?? summary.status,
      verified: verification.ok,
      created_at: manifest?.created_at,
      record_id: summary.analysis_assessment_id,
      hash: verification.manifest_sha256,
      record_key: 'analysis-assessment:' + summary.analysis_assessment_id,
      url: '/api/analysis-assessments/' + encodeURIComponent(summary.analysis_assessment_id),
      metadata: {
        chat_id: manifest?.chat_id ?? null,
        analysis_contract_id: manifest?.analysis_contract?.analysis_contract_id ?? null,
        experiment_id: manifest?.experiment?.experiment_id ?? null,
        registration_status: report?.registration?.status ?? null,
        outcome_verdict: report?.summary?.outcome_verdict ?? null,
        current_for_pair: summary.current_for_pair,
        superseded_by: summary.superseded_by,
        summary: report?.summary ?? {},
        deviations: report?.registration?.automatic_deviations ?? [],
        schema_version: manifest?.schema_version ?? null,
        inference: report?.inference ?? null,
        interpretation: (manifest?.schema_version ?? 1) >= 3
          ? 'deterministic replay of preregistered hypothesis tests under stated, unchecked assumptions; not causal proof'
          : 'deterministic threshold replay; not inferential or causal proof',
        issues: issueSummary(verification.errors)
      }
    });
    if (!manifest) continue;
    builder.queueEdge(
      nodeId('analysis-contract', manifest.analysis_contract.analysis_contract_id),
      id,
      'evaluated_by'
    );
    builder.queueEdge(
      nodeId('experiment', manifest.experiment.experiment_id),
      id,
      'assessed_by'
    );
    if (manifest.chat_id) builder.queueEdge(nodeId('chat', manifest.chat_id), id, 'requested');
    if (summary.superseded_by) {
      builder.queueEdge(
        id,
        nodeId('analysis-assessment', summary.superseded_by),
        'superseded_by'
      );
    }
    if (verification.ok && summary.superseded_by) {
      builder.finding('info', 'confirmatory_assessment_superseded',
        'A newer verified assessment exists for the same contract and experiment.', {
          node_id: id,
          superseded_by: summary.superseded_by
        });
    } else if (verification.ok && summary.current_for_pair && report?.status !== 'pass') {
      builder.finding('warning', 'confirmatory_assessment_attention',
        report?.registration?.status === 'prospective'
          ? 'The current prospective assessment did not produce a passing primary-outcome verdict.'
          : 'The current assessment is not eligible to be presented as prospective confirmatory evidence.', {
          node_id: id,
          status: report?.status ?? null,
          registration_status: report?.registration?.status ?? null
        });
    }
  }
}

function graphScope(nodes, edges, chatId) {
  if (!chatId) return new Set(nodes.keys());
  const start = nodeId('chat', chatId);
  if (!nodes.has(start)) {
    throw Object.assign(new Error('Chat not found for lineage scope: ' + chatId), {
      code: 'CHAT_NOT_FOUND'
    });
  }
  const adjacent = new Map();
  for (const edge of edges.values()) {
    if (!adjacent.has(edge.source)) adjacent.set(edge.source, []);
    if (!adjacent.has(edge.target)) adjacent.set(edge.target, []);
    adjacent.get(edge.source).push(edge.target);
    adjacent.get(edge.target).push(edge.source);
  }
  const selected = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacent.get(current) ?? []) {
      if (selected.has(next)) continue;
      selected.add(next);
      queue.push(next);
    }
  }
  return selected;
}

function sortedNodes(values) {
  return [...values].sort((left, right) =>
    (TYPE_ORDER.get(left.type) ?? 98) - (TYPE_ORDER.get(right.type) ?? 98) ||
    String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')) ||
    left.id.localeCompare(right.id)
  );
}

function sortedEdges(values) {
  return [...values].sort((left, right) =>
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    left.relation.localeCompare(right.relation)
  );
}

function sortedFindings(values) {
  const order = { error: 0, warning: 1, info: 2 };
  return [...values].sort((left, right) =>
    (order[left.severity] ?? 9) - (order[right.severity] ?? 9) ||
    String(left.node_id ?? '').localeCompare(String(right.node_id ?? '')) ||
    left.code.localeCompare(right.code)
  );
}

export function buildLineageGraph(cwd, { chatId = null, now = new Date() } = {}) {
  const project = path.resolve(cwd);
  const builder = createBuilder(project);
  addEvidence(builder);
  const evidenceByDoi = new Map();
  for (const record of listEvidence(builder.project)) {
    const doi = String(record.doi ?? '').toLowerCase();
    if (doi && !evidenceByDoi.has(doi)) evidenceByDoi.set(doi, record.evidence_id);
  }
  addLiterature(builder, evidenceByDoi);
  addRuns(builder);
  addKernels(builder);
  addSimulations(builder);
  addCad(builder);
  addInferences(builder);
  addExperiments(builder);
  addPreregistrations(builder);
  addProcedures(builder);
  addProcedureAssessments(builder);
  addProcedureDecisions(builder, now);
  addAnalysisContracts(builder);
  addArtifactRevisions(builder);
  addFigureComparisons(builder);
  addFigureRegistrations(builder);
  addFigureVisuals(builder);
  addSemanticReviews(builder);
  addConfirmatoryAssessments(builder);
  addCampaigns(builder);
  const turns = addChats(builder);
  addInteractions(builder, turns);
  builder.finalizeEdges();

  const selected = graphScope(builder.nodes, builder.edges, chatId);
  const nodes = sortedNodes([...builder.nodes.values()].filter((node) => selected.has(node.id)));
  const edges = sortedEdges([...builder.edges.values()].filter((edge) =>
    selected.has(edge.source) && selected.has(edge.target)
  ));
  const findings = sortedFindings(builder.findings.filter((finding) =>
    !finding.node_id || selected.has(finding.node_id) || selected.has(finding.target_id)
  ));
  const types = [...new Set(nodes.map((node) => node.type))].sort();
  const relations = [...new Set(edges.map((edge) => edge.relation))].sort();
  const countsByType = Object.fromEntries(types.map((type) => [
    type,
    nodes.filter((node) => node.type === type).length
  ]));
  const countsByRelation = Object.fromEntries(relations.map((relation) => [
    relation,
    edges.filter((edge) => edge.relation === relation).length
  ]));
  const digestValue = {
    schema_version: LINEAGE_SCHEMA_VERSION,
    scope: { chat_id: chatId },
    nodes,
    edges,
    findings
  };
  const graphSha256 = sha256Json(digestValue);
  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  return {
    schema_version: LINEAGE_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    project: { name: path.basename(project) },
    scope: { chat_id: chatId },
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      verified_nodes: nodes.filter((node) => node.verified).length,
      unverified_nodes: nodes.filter((node) => !node.verified).length,
      findings: findings.length,
      errors: errorCount,
      warnings: warningCount,
      status: errorCount ? 'invalid' : warningCount ? 'review' : 'ready',
      by_type: countsByType,
      by_relation: countsByRelation
    },
    integrity: {
      ok: errorCount === 0,
      graph_sha256: graphSha256,
      basis: 'Derived from immutable ScienceCode records and their integrity verifiers.'
    },
    nodes,
    edges,
    findings
  };
}

export function traceLineage(graph, node, { direction = 'both', depth = 8, limit = 512 } = {}) {
  if (!graph?.nodes?.some((candidate) => candidate.id === node)) {
    throw Object.assign(new Error('Lineage node not found: ' + String(node ?? '')), {
      code: 'LINEAGE_NODE_NOT_FOUND'
    });
  }
  if (!['upstream', 'downstream', 'both'].includes(direction)) {
    throw Object.assign(new Error('Lineage direction must be upstream, downstream, or both.'), {
      code: 'INVALID_LINEAGE_DIRECTION'
    });
  }
  const maximumDepth = Number.isInteger(depth) ? Math.max(0, Math.min(32, depth)) : 8;
  const maximum = Number.isInteger(limit) ? Math.max(1, Math.min(2048, limit)) : 512;
  const selected = new Set([node]);
  const queue = [{ id: node, depth: 0 }];
  while (queue.length && selected.size < maximum) {
    const current = queue.shift();
    if (current.depth >= maximumDepth) continue;
    for (const edge of graph.edges) {
      const next = direction === 'upstream'
        ? (edge.target === current.id ? edge.source : null)
        : direction === 'downstream'
          ? (edge.source === current.id ? edge.target : null)
          : edge.source === current.id
            ? edge.target
            : edge.target === current.id ? edge.source : null;
      if (!next || selected.has(next)) continue;
      selected.add(next);
      queue.push({ id: next, depth: current.depth + 1 });
      if (selected.size >= maximum) break;
    }
  }
  return {
    node_id: node,
    direction,
    node_ids: [...selected],
    truncated: selected.size >= maximum,
    graph_sha256: graph.integrity?.graph_sha256 ?? null
  };
}
