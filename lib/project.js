import { verifyAudit } from './audit.js';
import { listAnalysisContracts, verifyAnalysisContract } from './analysis-contracts.js';
import { listChats, verifyChat } from './chats.js';
import { listCampaigns, verifyCampaign } from './campaigns.js';
import {
  listCadBuilds,
  listCadProjects,
  listCadSimulations,
  listCadSlices,
  verifyCadBuild,
  verifyCadSimulation,
  verifyCadSlice
} from './cad.js';
import {
  listConfirmatoryAssessments,
  verifyConfirmatoryAssessment
} from './confirmatory.js';
import {
  listEvidence,
  listEvidenceRetrievals,
  verifyEvidence,
  verifyEvidenceRetrieval
} from './evidence.js';
import { listExperiments, verifyExperiment } from './experiments.js';
import { listLiteratureRecords, verifyLiteratureRecord } from './literature.js';
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
import { listKernels, verifyKernel } from './kernels.js';
import { buildLineageGraph } from './lineage.js';
import { listPreregistrations, verifyPreregistration } from './preregistration.js';
import {
  MAX_PROJECT_SNAPSHOT_RECORDS,
  listProjectSnapshots,
  verifyProjectSnapshotRecord
} from './project-snapshots.js';
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

export function verifyProject(cwd, options = {}) {
  const audit = verifyAudit(cwd);
  const campaignIntegrity = listCampaigns(cwd).map((campaign) => ({
    campaign_id: campaign.campaign_id,
    status: campaign.status,
    verification: verifyCampaign(cwd, campaign.campaign_id)
  }));
  const procedureIntegrity = listProcedures(cwd).map((procedure) => ({
    procedure_id: procedure.procedure_id,
    status: procedure.status,
    current: procedure.current,
    superseded_by: procedure.superseded_by,
    verification: verifyProcedure(cwd, procedure.procedure_id)
  }));
  const procedureAssessmentIntegrity = listProcedureAssessments(cwd).map((assessment) => ({
    procedure_assessment_id: assessment.procedure_assessment_id,
    procedure_id: assessment.procedure_id,
    status: assessment.status,
    current_for_procedure: assessment.current_for_procedure,
    superseded_by: assessment.superseded_by,
    verification: verifyProcedureAssessment(cwd, assessment.procedure_assessment_id)
  }));
  const procedureDecisionIntegrity = listProcedureDecisions(cwd).map((decision) => ({
    procedure_decision_id: decision.procedure_decision_id,
    procedure_id: decision.procedure_id,
    status: decision.status,
    scope: decision.scope,
    current_for_scope: decision.current_for_scope,
    effective: decision.effective,
    effective_status: decision.effective_status,
    superseded_by: decision.superseded_by,
    verification: verifyProcedureDecision(cwd, decision.procedure_decision_id)
  }));
  const currentProcedures = procedureIntegrity.filter((procedure) => procedure.current);
  const currentProcedureAssessments = procedureAssessmentIntegrity
    .filter((assessment) => assessment.current_for_procedure);
  const currentProcedureDecisions = procedureDecisionIntegrity
    .filter((decision) => decision.current_for_scope);
  const analysisContractIntegrity = listAnalysisContracts(cwd).map((contract) => ({
    analysis_contract_id: contract.analysis_contract_id,
    status: contract.status,
    schema_version: contract.schema_version,
    verification: verifyAnalysisContract(cwd, contract.analysis_contract_id)
  }));
  const confirmatoryAssessmentIntegrity = listConfirmatoryAssessments(cwd).map((assessment) => ({
    analysis_assessment_id: assessment.analysis_assessment_id,
    status: assessment.status,
    schema_version: assessment.schema_version,
    outcome_verdict: assessment.outcome_verdict,
    registration_status: assessment.registration_status,
    current_for_pair: assessment.current_for_pair,
    superseded_by: assessment.superseded_by,
    verification: verifyConfirmatoryAssessment(cwd, assessment.analysis_assessment_id)
  }));
  const currentConfirmatoryAssessmentIntegrity = confirmatoryAssessmentIntegrity
    .filter((assessment) => assessment.current_for_pair);
  const runSummaries = listRuns(cwd);
  const runIntegrity = runSummaries.map((run) => ({
    run_id: run.run_id,
    status: run.status,
    verification: verifyRun(cwd, run.run_id)
  }));
  const chatIntegrity = listChats(cwd).map((chat) => ({
    chat_id: chat.chat_id,
    status: chat.status,
    verification: verifyChat(cwd, chat.chat_id)
  }));
  const preregistrationIntegrity = listPreregistrations(cwd).map((record) => ({
    preregistration_id: record.preregistration_id,
    verification: verifyPreregistration(cwd, record.preregistration_id)
  }));
  let projectSnapshotListing;
  try {
    projectSnapshotListing = listProjectSnapshots(cwd, {
      limit: MAX_PROJECT_SNAPSHOT_RECORDS
    });
  } catch (error) {
    projectSnapshotListing = {
      snapshots: [],
      summary: { total: 0, returned: 0, omitted: 0, registry_issues: 1 },
      issues: [{ issue: error.code ?? 'snapshot_registry_failed', detail: error.message }]
    };
  }
  const projectSnapshotIntegrity = projectSnapshotListing.snapshots.map((record) => ({
    snapshot_id: record.snapshot_id,
    verification: verifyProjectSnapshotRecord(cwd, record.snapshot_id)
  }));
  const simulationSummaries = listSimulations(cwd);
  const simulationIntegrity = simulationSummaries.map((simulation) => ({
    simulation_id: simulation.simulation_id,
    status: simulation.status,
    verification: verifySimulation(cwd, simulation.simulation_id)
  }));
  const cadProjects = listCadProjects(cwd);
  const cadBuildSummaries = listCadBuilds(cwd);
  const cadBuildIntegrity = cadBuildSummaries.map((build) => ({
    build_id: build.build_id,
    cad_project_id: build.cad_project_id,
    status: build.status,
    verification: verifyCadBuild(cwd, build.build_id)
  }));
  const cadSimulationSummaries = listCadSimulations(cwd);
  const cadSimulationIntegrity = cadSimulationSummaries.map((simulation) => ({
    simulation_id: simulation.simulation_id,
    cad_project_id: simulation.cad_project_id,
    build_id: simulation.build_id,
    status: simulation.status,
    verification: verifyCadSimulation(cwd, simulation.simulation_id)
  }));
  const cadSliceSummaries = listCadSlices(cwd);
  const cadSliceIntegrity = cadSliceSummaries.map((slice) => ({
    slice_id: slice.slice_id,
    cad_project_id: slice.cad_project_id,
    build_id: slice.build_id,
    status: slice.status,
    mode: slice.mode,
    verification: verifyCadSlice(cwd, slice.slice_id)
  }));
  const inferenceSummaries = listInferences(cwd);
  const inferenceIntegrity = inferenceSummaries.map((inference) => ({
    inference_id: inference.inference_id,
    status: inference.status,
    npu_executed: inference.npu_executed,
    verification: verifyInference(cwd, inference.inference_id)
  }));
  const experimentSummaries = listExperiments(cwd);
  const experimentIntegrity = experimentSummaries.map((experiment) => ({
    experiment_id: experiment.experiment_id,
    status: experiment.status,
    verification: verifyExperiment(cwd, experiment.experiment_id)
  }));
  const evidenceIntegrity = listEvidence(cwd).map((record) => ({
    evidence_id: record.evidence_id,
    verification: verifyEvidence(cwd, record.evidence_id)
  }));
  const retrievalIntegrity = listEvidenceRetrievals(cwd).map((retrievalId) => ({
    retrieval_id: retrievalId,
    verification: verifyEvidenceRetrieval(cwd, retrievalId)
  }));
  const literatureIntegrity = listLiteratureRecords(cwd).map((record) => ({
    literature_id: record.literature_id,
    source: record.source,
    verification: verifyLiteratureRecord(cwd, record.literature_id)
  }));
  const kernelIntegrity = listKernels(cwd).map((kernel) => ({
    kernel_id: kernel.kernel_id,
    language: kernel.language,
    verification: verifyKernel(cwd, kernel.language)
  }));
  const revisionSummaries = listArtifactRevisions(cwd);
  const revisionIntegrity = revisionSummaries.map((revision) => ({
    revision_id: revision.revision_id,
    status: revision.status,
    verification: verifyArtifactRevision(cwd, revision.revision_id)
  }));
  const figureComparisonIntegrity = listFigureComparisons(cwd).map(
    (comparison) => ({
      figure_comparison_id: comparison.figure_comparison_id,
      status: comparison.status,
      reproduction_status: comparison.reproduction_status,
      verification: verifyFigureComparison(
        cwd,
        comparison.figure_comparison_id
      )
    })
  );
  const figureRegistrationIntegrity = listFigureRegistrations(cwd).map(
    (registration) => ({
      figure_registration_id: registration.figure_registration_id,
      status: registration.status,
      registration_status: registration.registration_status,
      verification: verifyFigureRegistration(
        cwd,
        registration.figure_registration_id
      )
    })
  );
  const figureVisualIntegrity = listFigureVisuals(cwd).map((visual) => ({
    figure_visual_id: visual.figure_visual_id,
    status: visual.status,
    visual_status: visual.visual_status,
    verification: verifyFigureVisual(cwd, visual.figure_visual_id)
  }));
  const reviewSummaries = listSemanticReviews(cwd);
  const reviewIntegrity = reviewSummaries.map((review) => ({
    review_id: review.review_id,
    status: review.status,
    current_for_target: review.current_for_target,
    superseded_by: review.superseded_by,
    verification: verifySemanticReview(cwd, review.review_id)
  }));
  const currentReviewIntegrity = reviewIntegrity.filter((review) => review.current_for_target);
  let lineage;
  try {
    lineage = buildLineageGraph(cwd);
  } catch (error) {
    lineage = {
      integrity: { ok: false, graph_sha256: null },
      summary: { nodes: 0, edges: 0, errors: 1, warnings: 0 },
      findings: [{ severity: 'error', code: error.code ?? 'lineage_error', message: error.message }]
    };
  }
  const failedRuns = runSummaries
    .filter((run) => run.status !== 'completed')
    .map((run) => ({ run_id: run.run_id, status: run.status }));
  const failedSimulations = simulationSummaries
    .filter((simulation) => simulation.status !== 'completed')
    .map((simulation) => ({
      simulation_id: simulation.simulation_id,
      status: simulation.status
    }));
  const failedCadBuilds = cadBuildSummaries
    .filter((build) => build.status !== 'completed')
    .map((build) => ({ build_id: build.build_id, status: build.status }));
  const failedCadSlices = cadSliceSummaries
    .filter((slice) => slice.status === 'failed')
    .map((slice) => ({ slice_id: slice.slice_id, status: slice.status }));
  const failedInferences = inferenceSummaries
    .filter((inference) => inference.status !== 'completed')
    .map((inference) => ({
      inference_id: inference.inference_id,
      status: inference.status
    }));
  const failedExperiments = experimentSummaries
    .filter((experiment) => experiment.status !== 'completed')
    .map((experiment) => ({
      experiment_id: experiment.experiment_id,
      status: experiment.status
    }));
  const failedKernelCells = kernelIntegrity.flatMap((kernel) =>
    kernel.verification.cells
      .filter((cell) => cell.status !== 'completed')
      .map((cell) => ({ kernel_id: kernel.kernel_id, cell_id: cell.cell_id, status: cell.status }))
  );
  const failedCampaignTasks = campaignIntegrity.flatMap((campaign) =>
    (campaign.verification.state?.tasks ?? [])
      .filter((task) => task.status === 'failed')
      .map((task) => ({
        campaign_id: campaign.campaign_id,
        task_id: task.task_id,
        status: task.status,
        attempts: task.attempts
      }))
  );
  const errors = [];
  if (!audit.ok) errors.push({ issue: 'audit_invalid', errors: audit.errors });
  for (const campaign of campaignIntegrity) {
    if (!campaign.verification.ok) {
      errors.push({
        issue: 'campaign_invalid',
        campaign_id: campaign.campaign_id,
        errors: campaign.verification.errors
      });
    }
  }
  for (const procedure of procedureIntegrity) {
    if (!procedure.verification.ok) {
      errors.push({
        issue: 'procedure_invalid',
        procedure_id: procedure.procedure_id,
        errors: procedure.verification.errors
      });
    }
  }
  for (const assessment of procedureAssessmentIntegrity) {
    if (!assessment.verification.ok) {
      errors.push({
        issue: 'procedure_assessment_invalid',
        procedure_assessment_id: assessment.procedure_assessment_id,
        errors: assessment.verification.errors
      });
    }
  }
  for (const decision of procedureDecisionIntegrity) {
    if (!decision.verification.ok) {
      errors.push({
        issue: 'procedure_decision_invalid',
        procedure_decision_id: decision.procedure_decision_id,
        errors: decision.verification.errors
      });
    }
  }
  for (const run of runIntegrity) {
    if (!run.verification.ok) {
      errors.push({ issue: 'run_invalid', run_id: run.run_id, errors: run.verification.errors });
    }
  }
  for (const chat of chatIntegrity) {
    if (!chat.verification.ok) {
      errors.push({
        issue: 'chat_invalid',
        chat_id: chat.chat_id,
        errors: chat.verification.errors
      });
    }
  }
  for (const preregistration of preregistrationIntegrity) {
    if (!preregistration.verification.ok) {
      errors.push({
        issue: 'preregistration_invalid',
        preregistration_id: preregistration.preregistration_id,
        errors: preregistration.verification.errors
      });
    }
  }
  for (const issue of projectSnapshotListing.issues) {
    errors.push({ issue: 'snapshot_registry_invalid', errors: [issue] });
  }
  if (projectSnapshotListing.summary.omitted > 0) {
    errors.push({
      issue: 'snapshot_registry_limit_exceeded',
      maximum: MAX_PROJECT_SNAPSHOT_RECORDS,
      actual: projectSnapshotListing.summary.total
    });
  }
  for (const record of projectSnapshotIntegrity) {
    if (!record.verification.ok) {
      errors.push({
        issue: 'project_snapshot_invalid',
        snapshot_id: record.snapshot_id,
        errors: record.verification.errors
      });
    }
  }
  for (const simulation of simulationIntegrity) {
    if (!simulation.verification.ok) {
      errors.push({
        issue: 'simulation_invalid',
        simulation_id: simulation.simulation_id,
        errors: simulation.verification.errors
      });
    }
  }
  for (const cadProject of cadProjects) {
    if (!cadProject.healthy) {
      errors.push({
        issue: 'cad_project_invalid',
        cad_project_id: cadProject.cad_project_id,
        error: cadProject.issue
      });
    }
  }
  for (const build of cadBuildIntegrity) {
    if (!build.verification.ok) {
      errors.push({
        issue: 'cad_build_invalid',
        build_id: build.build_id,
        errors: build.verification.errors
      });
    }
  }
  for (const simulation of cadSimulationIntegrity) {
    if (!simulation.verification.ok) {
      errors.push({
        issue: 'cad_simulation_invalid',
        simulation_id: simulation.simulation_id,
        errors: simulation.verification.errors
      });
    }
  }
  for (const slice of cadSliceIntegrity) {
    if (!slice.verification.ok) {
      errors.push({
        issue: 'cad_slice_invalid',
        slice_id: slice.slice_id,
        errors: slice.verification.errors
      });
    }
  }
  for (const inference of inferenceIntegrity) {
    if (!inference.verification.ok) {
      errors.push({
        issue: 'inference_invalid',
        inference_id: inference.inference_id,
        errors: inference.verification.errors
      });
    }
  }
  for (const experiment of experimentIntegrity) {
    if (!experiment.verification.ok) {
      errors.push({
        issue: 'experiment_invalid',
        experiment_id: experiment.experiment_id,
        errors: experiment.verification.errors
      });
    }
  }
  for (const evidence of evidenceIntegrity) {
    if (!evidence.verification.ok) {
      errors.push({
        issue: 'evidence_invalid',
        evidence_id: evidence.evidence_id,
        errors: evidence.verification.errors
      });
    }
  }
  for (const retrieval of retrievalIntegrity) {
    if (!retrieval.verification.ok) {
      errors.push({
        issue: 'evidence_retrieval_invalid',
        retrieval_id: retrieval.retrieval_id,
        errors: retrieval.verification.errors
      });
    }
  }
  for (const literature of literatureIntegrity) {
    if (!literature.verification.ok) {
      errors.push({
        issue: 'literature_invalid',
        literature_id: literature.literature_id,
        errors: literature.verification.errors
      });
    }
  }
  for (const kernel of kernelIntegrity) {
    if (!kernel.verification.ok) {
      errors.push({
        issue: 'kernel_invalid',
        kernel_id: kernel.kernel_id,
        errors: kernel.verification.errors
      });
    }
  }
  for (const revision of revisionIntegrity) {
    if (!revision.verification.ok) {
      errors.push({
        issue: 'artifact_revision_invalid',
        revision_id: revision.revision_id,
        errors: revision.verification.errors
      });
    }
  }
  for (const comparison of figureComparisonIntegrity) {
    if (!comparison.verification.ok) {
      errors.push({
        issue: 'figure_comparison_invalid',
        figure_comparison_id: comparison.figure_comparison_id,
        errors: comparison.verification.errors
      });
    }
  }
  for (const registration of figureRegistrationIntegrity) {
    if (!registration.verification.ok) {
      errors.push({
        issue: 'figure_registration_invalid',
        figure_registration_id: registration.figure_registration_id,
        errors: registration.verification.errors
      });
    }
  }
  for (const visual of figureVisualIntegrity) {
    if (!visual.verification.ok) {
      errors.push({
        issue: 'figure_visual_invalid',
        figure_visual_id: visual.figure_visual_id,
        errors: visual.verification.errors
      });
    }
  }
  for (const review of reviewIntegrity) {
    if (!review.verification.ok) {
      errors.push({
        issue: 'semantic_review_invalid',
        review_id: review.review_id,
        errors: review.verification.errors
      });
    }
  }
  for (const contract of analysisContractIntegrity) {
    if (!contract.verification.ok) {
      errors.push({
        issue: 'analysis_contract_invalid',
        analysis_contract_id: contract.analysis_contract_id,
        errors: contract.verification.errors
      });
    }
  }
  for (const assessment of confirmatoryAssessmentIntegrity) {
    if (!assessment.verification.ok) {
      errors.push({
        issue: 'confirmatory_assessment_invalid',
        analysis_assessment_id: assessment.analysis_assessment_id,
        errors: assessment.verification.errors
      });
    }
  }
  if (!lineage.integrity.ok) {
    errors.push({
      issue: 'lineage_invalid',
      graph_sha256: lineage.integrity.graph_sha256,
      findings: lineage.findings.filter((finding) => finding.severity === 'error')
    });
  }
  if (!options.allowFailedRuns && failedRuns.length) {
    errors.push({ issue: 'failed_runs', runs: failedRuns });
  }
  if (!options.allowFailedSimulations && failedSimulations.length) {
    errors.push({ issue: 'failed_simulations', simulations: failedSimulations });
  }
  if (!options.allowFailedCadBuilds && failedCadBuilds.length) {
    errors.push({ issue: 'failed_cad_builds', builds: failedCadBuilds });
  }
  if (!options.allowFailedCadSlices && failedCadSlices.length) {
    errors.push({ issue: 'failed_cad_slices', slices: failedCadSlices });
  }
  if (!options.allowFailedInferences && failedInferences.length) {
    errors.push({ issue: 'failed_inferences', inferences: failedInferences });
  }
  if (!options.allowFailedExperiments && failedExperiments.length) {
    errors.push({ issue: 'failed_experiments', experiments: failedExperiments });
  }
  if (!options.allowFailedKernelCells && failedKernelCells.length) {
    errors.push({ issue: 'failed_kernel_cells', cells: failedKernelCells });
  }
  if (!options.allowFailedCampaignTasks && failedCampaignTasks.length) {
    errors.push({
      issue: 'failed_campaign_tasks',
      campaign_tasks: failedCampaignTasks
    });
  }
  return {
    ok: errors.length === 0,
    audit,
    counts: {
      runs: runIntegrity.length,
      chats: chatIntegrity.length,
      campaigns: campaignIntegrity.length,
      verified_campaigns: campaignIntegrity.filter((campaign) =>
        campaign.verification.ok).length,
      active_campaigns: campaignIntegrity.filter((campaign) =>
        ['ready', 'running', 'waiting_checkpoint', 'waiting_hypothesis'].includes(
          campaign.verification.state?.status
        )).length,
      completed_campaigns: campaignIntegrity.filter((campaign) =>
        campaign.verification.state?.status === 'completed').length,
      campaign_tasks: campaignIntegrity.reduce((total, campaign) =>
        total + (campaign.verification.state?.tasks?.length ?? 0), 0),
      completed_campaign_tasks: campaignIntegrity.reduce((total, campaign) =>
        total + (campaign.verification.state?.counts?.completed ?? 0), 0),
      campaign_hypotheses: campaignIntegrity.reduce((total, campaign) =>
        total + (campaign.verification.state?.hypothesis_counts?.total ?? 0), 0),
      assessed_campaign_hypotheses: campaignIntegrity.reduce((total, campaign) =>
        total + (campaign.verification.state?.hypothesis_counts?.assessed ?? 0), 0),
      current_campaign_hypothesis_assessments: campaignIntegrity.reduce(
        (total, campaign) => total +
          (campaign.verification.state?.hypothesis_counts?.assessment_current ?? 0),
        0
      ),
      stale_campaign_hypothesis_assessments: campaignIntegrity.reduce(
        (total, campaign) => total +
          (campaign.verification.state?.hypothesis_counts?.assessment_stale ?? 0),
        0
      ),
      campaign_hypotheses_requiring_assessment: campaignIntegrity.reduce(
        (total, campaign) => total +
          (campaign.verification.state?.hypothesis_counts?.assessment_required ?? 0),
        0
      ),
      pruned_campaign_hypotheses: campaignIntegrity.reduce((total, campaign) =>
        total + (campaign.verification.state?.hypothesis_counts?.pruned ?? 0), 0),
      falsified_campaign_hypotheses: campaignIntegrity.reduce((total, campaign) =>
        total + (campaign.verification.state?.hypothesis_counts?.falsified ?? 0), 0),
      failed_campaign_tasks: failedCampaignTasks.length,
      cancelled_campaign_attempts: campaignIntegrity.reduce(
        (total, campaign) => total +
          (campaign.verification.state?.tasks ?? []).reduce(
            (taskTotal, task) => taskTotal +
              task.attempts.filter((attempt) => attempt.status === 'cancelled').length,
            0
          ),
        0
      ),
      campaigns_needing_attention: campaignIntegrity.filter((campaign) =>
        ['blocked', 'budget_exhausted'].includes(
          campaign.verification.state?.status
        )).length,
      interactions: chatIntegrity.reduce(
        (total, chat) => total + (chat.verification.interactions?.count ?? 0),
        0
      ),
      simulations: simulationIntegrity.length,
      cad_projects: cadProjects.length,
      healthy_cad_projects: cadProjects.filter((project) => project.healthy).length,
      cad_builds: cadBuildIntegrity.length,
      completed_cad_builds: cadBuildIntegrity.filter((build) =>
        build.status === 'completed').length,
      cad_simulations: cadSimulationIntegrity.length,
      cad_simulations_needing_attention: cadSimulationIntegrity.filter((simulation) =>
        ['review', 'fail'].includes(simulation.status)).length,
      cad_slices: cadSliceIntegrity.length,
      safe_preview_slices: cadSliceIntegrity.filter((slice) =>
        slice.status === 'completed_preview').length,
      printer_profile_slices: cadSliceIntegrity.filter((slice) =>
        slice.mode === 'printer-profile').length,
      inferences: inferenceIntegrity.length,
      npu_verified_inferences: inferenceIntegrity.filter((inference) =>
        inference.npu_executed && inference.verification.ok).length,
      experiments: experimentIntegrity.length,
      evidence: evidenceIntegrity.length,
      evidence_retrievals: retrievalIntegrity.length,
      literature: literatureIntegrity.length,
      verified_literature: literatureIntegrity.filter(
        (record) => record.verification.ok
      ).length,
      kernels: kernelIntegrity.length,
      kernel_cells: kernelIntegrity.reduce((total, kernel) => total + kernel.verification.cells.length, 0),
      preregistrations: preregistrationIntegrity.length,
      project_snapshots: projectSnapshotIntegrity.length,
      verified_project_snapshots: projectSnapshotIntegrity.filter(
        (record) => record.verification.ok
      ).length,
      procedures: procedureIntegrity.length,
      current_procedures: currentProcedures.length,
      procedure_assessments: procedureAssessmentIntegrity.length,
      current_procedure_assessments: currentProcedureAssessments.length,
      procedure_decisions: procedureDecisionIntegrity.length,
      current_procedure_decisions: currentProcedureDecisions.length,
      effective_procedure_approvals: currentProcedureDecisions.filter(
        (decision) => decision.effective
      ).length,
      effective_external_physical_approvals: currentProcedureDecisions.filter(
        (decision) => decision.effective &&
          decision.scope === 'external_physical_execution'
      ).length,
      procedures_needing_attention: currentProcedures.filter((procedure) => {
        const assessment = currentProcedureAssessments.find(
          (item) => item.procedure_id === procedure.procedure_id
        );
        return !assessment || assessment.status !== 'ready_for_human_review';
      }).length,
      analysis_contracts: analysisContractIntegrity.length,
      verified_analysis_contracts: analysisContractIntegrity.filter((contract) =>
        contract.verification.ok).length,
      inferential_analysis_contracts: analysisContractIntegrity.filter((contract) =>
        (contract.schema_version ?? 1) >= 3).length,
      confirmatory_assessments: confirmatoryAssessmentIntegrity.length,
      inferential_confirmatory_assessments: confirmatoryAssessmentIntegrity.filter(
        (assessment) => (assessment.schema_version ?? 1) >= 3
      ).length,
      indeterminate_confirmatory_assessments: currentConfirmatoryAssessmentIntegrity.filter(
        (assessment) => assessment.outcome_verdict === 'indeterminate'
      ).length,
      current_confirmatory_assessments: currentConfirmatoryAssessmentIntegrity.length,
      prospective_confirmatory_assessments: currentConfirmatoryAssessmentIntegrity.filter(
        (assessment) => assessment.registration_status === 'prospective'
      ).length,
      confirmatory_assessments_needing_attention: currentConfirmatoryAssessmentIntegrity.filter(
        (assessment) => assessment.status !== 'pass'
      ).length,
      artifact_revisions: revisionIntegrity.length,
      proposed_artifact_revisions: revisionIntegrity.filter((revision) =>
        revision.status === 'proposed').length,
      accepted_artifact_revisions: revisionIntegrity.filter((revision) =>
        revision.status === 'accepted').length,
      rejected_artifact_revisions: revisionIntegrity.filter((revision) =>
        revision.status === 'rejected').length,
      figure_comparisons: figureComparisonIntegrity.length,
      verified_figure_comparisons: figureComparisonIntegrity.filter(
        (comparison) => comparison.verification.ok
      ).length,
      exact_figure_comparisons: figureComparisonIntegrity.filter(
        (comparison) => comparison.verification.ok &&
          comparison.reproduction_status === 'exact'
      ).length,
      structural_figure_comparisons: figureComparisonIntegrity.filter(
        (comparison) => comparison.verification.ok &&
          Number.isFinite(
            comparison.verification.report?.summary
              ?.minimum_structural_similarity
          )
      ).length,
      structural_figure_comparisons_passing:
        figureComparisonIntegrity.filter(
          (comparison) => comparison.verification.ok &&
            comparison.verification.report?.summary
              ?.structural_similarity_rule_pass === true
        ).length,
      figure_comparisons_needing_attention: figureComparisonIntegrity.filter(
        (comparison) => comparison.verification.ok &&
          ['different', 'incompatible_dimensions'].includes(
            comparison.reproduction_status
          )
      ).length,
      figure_registrations: figureRegistrationIntegrity.length,
      verified_figure_registrations: figureRegistrationIntegrity.filter(
        (registration) => registration.verification.ok
      ).length,
      matched_figure_registrations: figureRegistrationIntegrity.filter(
        (registration) => registration.verification.ok &&
          registration.registration_status === 'matched'
      ).length,
      figure_registrations_needing_attention: figureRegistrationIntegrity.filter(
        (registration) => registration.verification.ok &&
          registration.registration_status === 'mismatch'
      ).length,
      figure_visuals: figureVisualIntegrity.length,
      verified_figure_visuals: figureVisualIntegrity.filter(
        (visual) => visual.verification.ok
      ).length,
      conforming_figure_visuals: figureVisualIntegrity.filter(
        (visual) => visual.verification.ok && visual.visual_status === 'conforming'
      ).length,
      figure_visuals_needing_attention: figureVisualIntegrity.filter(
        (visual) => visual.verification.ok && visual.visual_status === 'nonconforming'
      ).length,
      semantic_reviews: reviewIntegrity.length,
      current_semantic_reviews: currentReviewIntegrity.length,
      semantic_review_claims: reviewIntegrity.reduce(
        (total, review) => total + (review.verification.report?.summary?.claims ?? 0), 0
      ),
      semantic_review_findings: reviewIntegrity.reduce(
        (total, review) => total + (review.verification.report?.summary?.findings ?? 0), 0
      ),
      current_semantic_review_findings: currentReviewIntegrity.reduce(
        (total, review) => total + (review.verification.report?.summary?.findings ?? 0), 0
      ),
      semantic_reviews_needing_attention: currentReviewIntegrity.filter((review) =>
        ['review', 'fail'].includes(review.status)).length,
      lineage_nodes: lineage.summary.nodes,
      lineage_edges: lineage.summary.edges,
      failed_runs: failedRuns.length,
      cancelled_runs: failedRuns.filter((run) => run.status === 'cancelled').length,
      failed_simulations: failedSimulations.length,
      cancelled_simulations: failedSimulations.filter(
        (simulation) => simulation.status === 'cancelled'
      ).length,
      failed_cad_builds: failedCadBuilds.length,
      failed_cad_slices: failedCadSlices.length,
      failed_inferences: failedInferences.length,
      cancelled_inferences: failedInferences.filter(
        (inference) => inference.status === 'cancelled'
      ).length,
      failed_experiments: failedExperiments.length,
      cancelled_experiments: failedExperiments.filter(
        (experiment) => experiment.status === 'cancelled'
      ).length,
      failed_kernel_cells: failedKernelCells.length
    },
    runs: runIntegrity,
    chats: chatIntegrity,
    campaigns: campaignIntegrity,
    simulations: simulationIntegrity,
    cad_projects: cadProjects,
    cad_builds: cadBuildIntegrity,
    cad_simulations: cadSimulationIntegrity,
    cad_slices: cadSliceIntegrity,
    inferences: inferenceIntegrity,
    experiments: experimentIntegrity,
    evidence: evidenceIntegrity,
    evidence_retrievals: retrievalIntegrity,
    literature: literatureIntegrity,
    kernels: kernelIntegrity,
    preregistrations: preregistrationIntegrity,
    procedures: procedureIntegrity,
    procedure_assessments: procedureAssessmentIntegrity,
    procedure_decisions: procedureDecisionIntegrity,
    analysis_contracts: analysisContractIntegrity,
    confirmatory_assessments: confirmatoryAssessmentIntegrity,
    artifact_revisions: revisionIntegrity,
    figure_comparisons: figureComparisonIntegrity,
    figure_registrations: figureRegistrationIntegrity,
    figure_visuals: figureVisualIntegrity,
    semantic_reviews: reviewIntegrity,
    lineage: {
      integrity: lineage.integrity,
      summary: lineage.summary,
      findings: lineage.findings
    },
    errors
  };
}
