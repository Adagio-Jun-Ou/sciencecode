import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERSION,
  abandonCampaignTask,
  analysisContractInteractionArtifact,
  analysisContractInteractionPayload,
  appendAudit,
  buildLineageGraph,
  buildCadProject,
  cadInteractionArtifact,
  cadInteractionPayload,
  campaignInteractionArtifact,
  campaignInteractionPayload,
  createArtifactRevision,
  createCampaign,
  createAnalysisContract,
  createConfirmatoryAssessment,
  createProcedure,
  createProcedureAssessment,
  createProcedureDecision,
  createFigureComparison,
  createFigureRegistration,
  createFigureSemanticSidecarFile,
  createFigureVisual,
  createSemanticReview,
  convertQuantity,
  createCadProjectFromSpecFile,
  computeStatus,
  createKernelManager,
  decideArtifactRevision,
  detectCadToolchain,
  doctor,
  describeUnit,
  ensureScienceDir,
  freezePreregistration,
  formatScienceCodeBenchmark,
  formatScienceCodeEvaluation,
  getEvidenceRecord,
  getCadBuild,
  getCadProject,
  getCadSimulation,
  getCadSlice,
  getCampaign,
  getKernelCell,
  getKernelRecord,
  getExperimentManifest,
  getInferenceManifest,
  getPreregistration,
  getProcedure,
  getProcedureAssessment,
  getProcedureDecision,
  getArtifactRevision,
  getAnalysisContract,
  getConfirmatoryAssessment,
  getFigureComparison,
  getFigureRegistration,
  getFigureVisual,
  getSemanticReview,
  getRunManifest,
  getSimulationManifest,
  initializeSimulationTemplate,
  initializeCadProject,
  ingestEvidence,
  INFERENCE_SIDEDNESS,
  STATISTICS_ENGINE_NAME,
  STATISTICS_ENGINE_VERSION,
  adjustPValues,
  doseResponseFit,
  effectSize,
  mannWhitneyUTest,
  oneSampleTTest,
  pairedTTest,
  tostPValue,
  studentTQuantile,
  tConfidenceInterval,
  welchTTest,
  wilcoxonSignedRankTest,
  LITERATURE_FETCH_TIMEOUT_MS,
  getLiteratureRecord,
  importLiteratureResponse,
  ingestLiteratureResponse,
  listLiteratureRecords,
  literatureRequestUrl,
  normalizeLiteratureIdentifier,
  normalizeLiteratureSource,
  verifyLiteratureRecord,
  inspectScienceCodeBenchmark,
  isPathInside,
  launchOpenCode,
  listExperiments,
  listCadBuilds,
  listCadProjects,
  listCadSimulations,
  listCadSlices,
  listCampaigns,
  listInferences,
  listEvidence,
  listKernels,
  listPreregistrations,
  listProcedureAssessments,
  listProcedureDecisions,
  listProcedures,
  listArtifactRevisions,
  listAnalysisContracts,
  listConfirmatoryAssessments,
  listFigureComparisons,
  listFigureRegistrations,
  listFigureVisuals,
  MAX_FIGURE_VISUAL_SPEC_BYTES,
  listSemanticReviews,
  listRuns,
  listSimulations,
  listSupportedUnits,
  listKnowledgeDomains,
  listKnowledgeLayers,
  listPrinciples,
  derivePrinciple,
  getPrinciple,
  groundDomain,
  knowledgeGroundingForWorkflow,
  verifyKnowledgeBase,
  makeRunId,
  parseExperimentSeeds,
  parseExperimentVariation,
  parseSimulationParameter,
  readAuditRecords,
  readCadFile,
  recordCampaignDecision,
  recordHypothesisAssessment,
  recordInteraction,
  readJson,
  relativePortable,
  revisionInteractionArtifact,
  revisionInteractionPayload,
  semanticReviewInteractionArtifact,
  semanticReviewInteractionPayload,
  confirmatoryAssessmentInteractionArtifact,
  confirmatoryAssessmentInteractionPayload,
  figureComparisonInteractionArtifact,
  figureComparisonInteractionPayload,
  figureRegistrationInteractionArtifact,
  figureRegistrationInteractionPayload,
  figureVisualInteractionArtifact,
  figureVisualInteractionPayload,
  procedureAssessmentInteractionArtifact,
  procedureAssessmentInteractionPayload,
  procedureDecisionInteractionArtifact,
  procedureDecisionInteractionPayload,
  procedureInteractionArtifact,
  procedureInteractionPayload,
  resolveInsideRoot,
  runtimePaths,
  scoreScienceCodeBenchmark,
  runExperiment,
  runScienceCodeEvaluation,
  runInference,
  runCommandSync,
  runCampaignTask,
  runOpenCode,
  runSimulation,
  simulateCadBuild,
  sliceCadBuild,
  safeInit,
  searchEvidence,
  setupCadRuntime,
  setupComputeRuntime,
  setupNpuRuntime,
  sha256File,
  snapshot,
  captureProjectSnapshotPending,
  commitProjectSnapshotPending,
  discardProjectSnapshotPending,
  startLab,
  stopCampaign,
  verifyAudit,
  verifyCadBuild,
  verifyCadSimulation,
  verifyCadSlice,
  verifyCampaign,
  verifyEvidence,
  verifyExperiment,
  verifyInference,
  verifyKernel,
  verifyPreregistration,
  verifyProcedure,
  verifyProcedureAssessment,
  verifyProcedureDecision,
  verifyArtifactRevision,
  verifyAnalysisContract,
  verifyConfirmatoryAssessment,
  verifyFigureComparison,
  verifyFigureRegistration,
  normalizeFigureRegistrationSpec,
  normalizeFigureVisualSpec,
  verifyFigureVisual,
  verifySemanticReview,
  verifyProject,
  verifyRun,
  verifySimulation,
  verifySnapshot,
  writeCadFile,
  writeJsonExclusive,
  writeScienceCodeBenchmarkRun
} from './core.js';
import { cliExitCodeForError } from './error-semantics.js';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CAD_USAGE = [
  'ScienceCode multi-file CAD and print-preparation workspace',
  '',
  'Usage:',
  '  sciencecode cad init [--name NAME] [--id cad-project-id] [--engine openscad|cadquery]',
  '  sciencecode cad create SPEC.json',
  '  sciencecode cad list [--json]',
  '  sciencecode cad show CAD_PROJECT_ID',
  '  sciencecode cad read CAD_PROJECT_ID FILE',
  '  sciencecode cad write CAD_PROJECT_ID FILE --from SOURCE [--expected SHA256] [--actor NAME]',
  '  sciencecode cad build CAD_PROJECT_ID [--timeout SECONDS]',
  '  sciencecode cad simulate CAD_BUILD_ID [--density G_PER_CM3]',
  '  sciencecode cad physics CAD_BUILD_ID FILE [simulation options] [-- SCRIPT_ARGS...]',
  '  sciencecode cad study CAD_BUILD_ID FILE [experiment options] [-- SCRIPT_ARGS...]',
  '  sciencecode cad slice CAD_BUILD_ID [options]',
  '  sciencecode cad verify CAD_BUILD_OR_SIM_OR_SLICE_ID',
  '  sciencecode cad toolchain',
  '',
  'Slice options:',
  '  --mode preview|printer-profile  Safe no-extrusion preview is the default',
  '  --profile FILE                 Project-relative PrusaSlicer .ini/.config',
  '  --acknowledge-physical-risk    Required for printer-profile G-code',
  '  --layer-height MM              Preview layer height (default: 0.2)',
  '  --nozzle-diameter MM           Preview nozzle diameter (default: 0.4)',
  '  --filament-diameter MM         Preview filament diameter (default: 1.75)',
  '  --infill PERCENT               Preview infill percentage (default: 15)',
  '  --threads N                    Preview slicer threads (default: 2)',
  '  --timeout SECONDS              Build/slice wall-clock limit',
  '',
  'Every render, geometry screen, and slice snapshots its declared source tree into',
  'an immutable, hash-verified record. ScienceCode never transmits G-code or runs',
  'printer hardware. Slicer post-processing hooks are disabled.'
].join('\n');

export const USAGE = `ScienceCode ${VERSION}

Usage:
  sciencecode init
  sciencecode doctor [--json]
  sciencecode compute status [--json]
  sciencecode compute setup [--profile gpu|npu|cad|all] [--refresh]
  sciencecode inference [smoke|run|list|show|verify]
  sciencecode campaign [create|list|show|verify|decide|advance|stop|abandon]
  sciencecode cad [init|create|list|show|read|write|build|simulate|physics|study|slice|verify|toolchain]
  sciencecode lab [--host 127.0.0.1] [--port 4311]
  sciencecode tui [opencode args...]
  sciencecode web [opencode args...]
  sciencecode serve [opencode args...]
  sciencecode run [options] [--] PROMPT
  sciencecode simulate [list|init|run|show|verify]
  sciencecode experiment [list|run|show|verify]
  sciencecode analysis [contract|assess|assessment]
  sciencecode unit [inspect|convert|list]
  sciencecode stats [ttest|ranktest|tost|quantile|adjust]
  sciencecode potency [fit]
  sciencecode knowledge [layers|list|show|derive|domain|ground|verify]
  sciencecode procedure [create|list|show|verify|assess|assessment|decide|decision]
  sciencecode evidence [add|list|show|search|verify]
  sciencecode literature [fetch|import|list|show|verify]
  sciencecode kernel [status|list|exec|show|verify]
  sciencecode lineage [show|verify] [--chat CHAT_ID] [--json]
  sciencecode revision [list|create|show|verify|decide]
  sciencecode review [list|run|show|verify]
  sciencecode figure [compare|list|show|verify]
  sciencecode evaluate [--json]
  sciencecode benchmark [inspect|predict|score]
  sciencecode snapshot [FILE]
  sciencecode verify SNAPSHOT.json [--strict]
  sciencecode runs [--json]
  sciencecode show RUN_ID
  sciencecode verify-run RUN_ID
  sciencecode preregister freeze FILE [--name NAME]
  sciencecode preregister [list|show ID|verify ID]
  sciencecode audit [verify|show]
  sciencecode gate [--allow-failed-runs] [--allow-failed-simulations] [--allow-failed-cad-builds] [--allow-failed-cad-slices] [--allow-failed-inferences] [--allow-failed-experiments] [--allow-failed-kernel-cells] [--allow-failed-campaign-tasks]
  sciencecode config
  sciencecode paths

ScienceCode records non-interactive runs under .sciencecode/runs/ and never
offers a delete command. Use "sciencecode run --help" for run options.`;

export const EVALUATION_USAGE = [
  'ScienceCode deterministic product evaluation',
  '',
  'Usage:',
  '  sciencecode evaluate [--json]',
  '',
  'Runs the built-in labeled release suite twice across reviewer precision/recall,',
  'citation resolution, numerical review, reproducibility, scientific safety, and',
  'agent-role separation. A pass is a regression result for the declared fixtures,',
  'not evidence of open-ended model intelligence or domain-valid conclusions.'
].join('\n');

export const BENCHMARK_USAGE = [
  'ScienceCode governed external benchmark workflow',
  '',
  'Usage:',
  '  sciencecode benchmark inspect MANIFEST.json [--json]',
  '  sciencecode benchmark predict MANIFEST.json --output RUN.json [--json]',
  '  sciencecode benchmark score MANIFEST.json --predictions RUN.json [--json]',
  '',
  'Inspect verifies the frozen held-out inputs without opening labels or baselines.',
  'Predict runs the production deterministic citation-requirement reviewer only',
  'inside the declared blind window and writes a new, never-overwritten run file.',
  'Score opens expert labels only after the declared unseal time, reports 95%',
  'Wilson intervals and paired baseline results, and enforces frozen thresholds.',
  '',
  'Governance metadata and timestamps are reviewable self-attestations, not proof',
  'of independence, expert qualifications, blinding, or scientific validity.',
  'External benchmarks never replace or weaken "sciencecode evaluate".'
].join('\n');

export const EVIDENCE_USAGE = `ScienceCode immutable evidence library

Usage:
  sciencecode evidence add FILE [options]
  sciencecode evidence list [--json]
  sciencecode evidence show EVIDENCE_ID
  sciencecode evidence search QUERY [--limit N] [--json]
  sciencecode evidence verify EVIDENCE_ID

Add options:
  --title TITLE         Source title (defaults to the file name)
  --doi DOI             Canonical DOI or doi.org URL
  --author NAME         Author name; may be repeated
  --year YYYY           Publication year
  --help, -h            Show this help

PDF, Markdown, reStructuredText, and plain text files inside the project are
copied into an immutable record. Page text and retrieval spans are hashed.`;

export const POTENCY_USAGE = [
  'Usage:',
  '  sciencecode potency fit --concentrations N,... --responses N,... [options]',
  '',
  'Options:',
  '  --model NAME          four_parameter_logistic (default) or three_parameter_logistic',
  '  --bottom N            Fixed bottom plateau, required by the three-parameter model',
  '  --level N             Confidence level for the interval (default 0.95)',
  '  --unit SYMBOL         Concentration unit to record, checked against the registry',
  '',
  'Fits a dose-response curve and reports the half-maximal concentration',
  '(IC50/EC50) with a confidence interval on the log10 scale. Concentrations',
  'must be strictly positive; a vehicle control belongs in the bottom plateau,',
  'not as a zero dose. The fit is deterministic: identical input replays to',
  'identical bits.'
].join('\n');

const STATS_USAGE = `ScienceCode deterministic statistics calculator

Usage:
  sciencecode stats ttest --values N,N,... --null N [options]
  sciencecode stats ttest --group-a N,N,... --group-b N,N,... [--paired] [options]
  sciencecode stats ranktest --group-a N,... --group-b N,... [--paired] [options]
  sciencecode stats tost --values N,... [--lower N] [--upper N] [options]
  sciencecode stats quantile P DF
  sciencecode stats adjust P,P,... --correction NAME [--family N]

Options:
  --sidedness KIND      two_sided, greater, or less (default: two_sided)
  --alpha N             Confidence-interval alpha strictly in (0, 1) (default: 0.05)
  --lower N, --upper N  Margin bounds for tost; one alone tests non-inferiority
                        or non-superiority, both test equivalence
  --correction NAME     none, bonferroni, or holm_bonferroni
  --family N            Preregistered family size (default: the p-value count)
  --help, -h            Show this help

The ranktest action runs Mann-Whitney U, or Wilcoxon signed-rank with --paired. These
use only the ordering of the observations, so they carry no normality
assumption, and they test a shift in location rather than a difference in
means. Small untied samples use the exact null distribution; ties or larger
samples fall back to a tie-corrected normal approximation, and the result says
which was used.

Runs the exact pinned statistics engine used by inferential analysis
contracts, so a hand check reproduces a frozen assessment bit for bit. This
is a calculator over the numbers you provide: it records nothing, corrects
nothing you did not declare, and makes no claim that the inputs satisfy the
normality and independence assumptions the tests state.`;

export const LITERATURE_USAGE = `ScienceCode frozen literature metadata records

Usage:
  sciencecode literature fetch --source SOURCE --id IDENTIFIER [--json]
  sciencecode literature import --source SOURCE --id IDENTIFIER FILE [--json]
  sciencecode literature list [--source SOURCE] [--json]
  sciencecode literature show LITERATURE_ID
  sciencecode literature verify LITERATURE_ID

Sources:
  crossref              Crossref works API; IDENTIFIER is a DOI
  openalex              OpenAlex works API; IDENTIFIER is a DOI
  pubmed                PubMed esummary API; IDENTIFIER is a numeric PMID

fetch performs a single explicit HTTPS GET - the only network access in
ScienceCode - and freezes the exact response bytes, request descriptor, and a
deterministically parsed bibliography into an immutable audited record.
import freezes a previously saved API response file without any network
access. Verification replays the parse from the frozen bytes. A record is a
snapshot of a third-party registry at retrieval time, not a claim that the
registry is correct.`;

export const KERNEL_USAGE = `ScienceCode persistent project kernels

Usage:
  sciencecode kernel status [python|r] [--json]
  sciencecode kernel list [--json]
  sciencecode kernel exec LANGUAGE FILE [options]
  sciencecode kernel show LANGUAGE [CELL_ID]
  sciencecode kernel verify LANGUAGE

Exec options:
  --restore              Explicitly replay verified completed history first
  --fresh                Start a clean namespace without replaying prior cells
  --timeout SECONDS      Wall-clock limit, 1 through 3600 (default: 120)
  --chat CHAT_ID         Link the cell to a recorded conversation
  --help, -h             Show this help

Lab keeps each language process alive across conversation turns. A CLI exec is
one isolated lifecycle; use --restore to reconstruct recorded state explicitly.
Cells, outputs, variables, dependencies, file changes, artifacts, and runtime
identity are immutable and hash-linked under .sciencecode/kernels/.`;

export const RUN_USAGE = `ScienceCode recorded run

Usage:
  sciencecode run [options] [--] PROMPT

Options:
  --agent NAME          ScienceCode/OpenCode agent (default: scientist)
  --model ID, -m ID     OpenCode provider/model
  --format FORMAT       json event capture (default) or default text
  --file FILE, -f FILE  Attach a file; may be repeated
  --title TITLE         OpenCode session title
  --variant NAME        Provider-specific model variant
  --thinking            Ask OpenCode to emit reasoning events
  --continue, -c        Continue the most recent OpenCode session
  --session ID, -s ID   Continue a specific OpenCode session
  --fork                Fork when continuing a session
  --no-store-prompt     Store only the prompt digest in the run record
  --help, -h            Show this help

Sharing, auto-approval, remote attach credentials, and arbitrary OpenCode
flags are intentionally not accepted by recorded runs. They remain available
for explicit interactive use through "sciencecode tui".`;

export const SIMULATE_USAGE = `ScienceCode recorded GPU simulation

Usage:
  sciencecode compute status [--json]
  sciencecode compute setup [--profile gpu|npu|cad|all] [--refresh]
  sciencecode simulate init [reaction-diffusion] [FILE]
  sciencecode simulate run FILE [options] [-- SCRIPT_ARGS...]
  sciencecode simulate list [--json]
  sciencecode simulate show SIMULATION_ID
  sciencecode simulate verify SIMULATION_ID

Built-in templates:
  reaction-diffusion    General recorded simulation example
  orbital-mechanics     Two-body orbit via SciPy DOP853 with analytic Kepler cross-check
  chemical-kinetics     Robertson stiff kinetics via SciPy BDF with LSODA cross-check
  dose-response         Four-parameter logistic potency recovery, TRF vs Nelder-Mead
  epidemic-seir         SEIR dynamics via SciPy DOP853 with final-size cross-check
  molecular-dynamics    Lennard-Jones NVE with conservation and time-reversal checks
  signal-analysis       SciPy spectral estimation validated on a known synthetic signal
  cad-mesh-validation  Independent geometry calculation on a verified CAD mesh
  cad-surface-heat      Bounded surface graph diffusion with scalar PLY output

Run options:
  --seed N              Deterministic seed, 0 through 4294967295 (default: 0)
  --device DEVICE       auto, cpu, cuda, or cuda:N (default: auto)
  --timeout SECONDS     Wall-clock limit, 1 through 86400 (default: 3600)
  --param NAME=VALUE    Typed JSON parameter; may be repeated
  --input FILE          Declared input to hash and drift-check; may be repeated
  --help, -h            Show this help

The script receives SCIENCECODE_OUTPUT_DIR, SCIENCECODE_DEVICE,
SCIENCECODE_SEED, and SCIENCECODE_PARAMETERS_JSON. Save generated figures,
arrays, tables, and summaries under SCIENCECODE_OUTPUT_DIR.`;

export const INFERENCE_USAGE = `ScienceCode recorded ONNX inference

Usage:
  sciencecode inference smoke [options]
  sciencecode inference run MODEL.onnx --input INPUT.json [options]
  sciencecode inference list [--json]
  sciencecode inference show INFERENCE_ID
  sciencecode inference verify INFERENCE_ID

Options:
  --device npu|cpu|auto       Explicit execution policy (default: npu)
  --allow-fallback            Permit and record fallback when NPU execution is not verified
  --warmup N                  Warmup iterations from 0 through 1000 (default: 1)
  --iterations N              Recorded iterations from 1 through 1000 (default: 3)
  --timeout SECONDS           Limit from 1 through 86400 seconds (default: 900)
`;

export const CAMPAIGN_USAGE = `ScienceCode bounded research campaigns

Usage:
  sciencecode campaign create PLAN.json --chat CHAT_ID [--note NOTE]
  sciencecode campaign list [--chat CHAT_ID] [--json]
  sciencecode campaign show CAMPAIGN_ID
  sciencecode campaign verify CAMPAIGN_ID
  sciencecode campaign decide CAMPAIGN_ID TASK_ID approved|rejected|skipped [--note NOTE]
  sciencecode campaign assess CAMPAIGN_ID HYPOTHESIS_ID VERDICT DECISION --rationale TEXT [--task TASK_ID...]
  sciencecode campaign advance CAMPAIGN_ID [TASK_ID]
  sciencecode campaign stop CAMPAIGN_ID --reason TEXT
  sciencecode campaign abandon CAMPAIGN_ID TASK_ID --reason TEXT

Plans are immutable hypothesis trees plus task DAGs with falsifiers, branch and
accelerator budgets, human assessments, checkpoints, and required AI disclosure.
Advance executes exactly one task in the linked Scientist conversation.`;

export const EXPERIMENT_USAGE = `ScienceCode recorded experiment matrix

Usage:
  sciencecode experiment run FILE [options] [-- SCRIPT_ARGS...]
  sciencecode experiment list [--json]
  sciencecode experiment show EXPERIMENT_ID
  sciencecode experiment verify EXPERIMENT_ID

Run options:
  --name TEXT           Human-readable experiment name
  --hypothesis TEXT     Hypothesis recorded in the immutable plan
  --analysis-contract ID  Bind the exact prospective analysis contract
  --cad-build ID       Bind every branch to one verified immutable CAD build
  --seeds N,N,...       Unique deterministic seeds (default: 0)
  --device DEVICE       auto, cpu, cuda, or cuda:N (default: auto)
  --timeout SECONDS     Per-branch wall-clock limit (default: 3600)
  --param NAME=VALUE    Fixed typed JSON parameter; may be repeated
  --vary NAME=[...]     JSON-array parameter sweep; may be repeated
  --input FILE          Declared input to hash and drift-check; may be repeated
  --help, -h            Show this help

ScienceCode expands the Cartesian product of --vary values across all seeds,
up to 64 sequential branches. It records every simulation independently, then
writes a verified aggregate CSV and deterministic reviewer verdict.`;

export const REVISION_USAGE = `ScienceCode immutable derived-artifact revisions

Usage:
  sciencecode revision list [--chat CHAT_ID] [--source ARTIFACT_URL] [--json]
  sciencecode revision create ARTIFACT_URL FILE --chat CHAT_ID [options]
  sciencecode revision show REVISION_ID
  sciencecode revision verify REVISION_ID
  sciencecode revision decide REVISION_ID --chat CHAT_ID --decision accepted|rejected [--note TEXT]

Create options:
  --name FILE_NAME      Name for the immutable replacement file
  --note TEXT           User rationale supplied to the next AI turn
  --previous ID         Link this proposal to the prior immutable revision

The source URL must be a manifest-bound Lab artifact route. The original and
every proposal remain immutable; accept/reject decisions append separately.`;

export const ANALYSIS_USAGE = [
  'ScienceCode preregistered confirmatory analysis',
  '',
  'Usage:',
  '  sciencecode analysis contract create SPEC.json [--chat CHAT_ID]',
  '  sciencecode analysis contract list [--json]',
  '  sciencecode analysis contract show ANALYSIS_CONTRACT_ID',
  '  sciencecode analysis contract verify ANALYSIS_CONTRACT_ID',
  '  sciencecode analysis assess ANALYSIS_CONTRACT_ID EXPERIMENT_ID [options]',
  '  sciencecode analysis assessment list [--json]',
  '  sciencecode analysis assessment show ANALYSIS_ASSESSMENT_ID',
  '  sciencecode analysis assessment verify ANALYSIS_ASSESSMENT_ID',
  '',
  'Assessment options:',
  '  --chat CHAT_ID         Share the immutable result with this conversation',
  '  --deviation TEXT       Disclose a departure from the frozen plan',
  '',
  'Contracts bind a frozen preregistration, exact Python script, primary and',
  'secondary outcomes, branch filters, missing-data handling, aggregation, and',
  'typed unit decision thresholds. Schema-2 assessments dimension-check and',
  'convert branch quantities before replay over a verified experiment. They do',
  'not infer p-values, causal effects, physical plausibility, or clinical validity.'
].join('\n');

export const UNIT_USAGE = [
  'ScienceCode bounded unit conversion',
  '',
  'Usage:',
  '  sciencecode unit inspect UNIT [--json]',
  '  sciencecode unit convert VALUE FROM_UNIT TO_UNIT [--json]',
  '  sciencecode unit list [--json]',
  '',
  'Expressions use explicit * / and ^ operators. Unit symbols are case-sensitive;',
  'implicit multiplication and unregistered symbols fail closed. Absolute K/degC',
  'are distinct from delta_K/delta_degC temperature differences.'
].join('\n');

export const KNOWLEDGE_USAGE = [
  'ScienceCode layered foundational knowledge',
  '',
  'Usage:',
  '  sciencecode knowledge layers [--json]',
  '  sciencecode knowledge list [--layer LAYER] [--kind KIND] [--domain DOMAIN] [--search TEXT] [--json]',
  '  sciencecode knowledge show PRINCIPLE_ID [--json]',
  '  sciencecode knowledge derive PRINCIPLE_ID [--json]',
  '  sciencecode knowledge domain [DOMAIN] [--json]',
  '  sciencecode knowledge ground WORKFLOW_ID [--json]',
  '  sciencecode knowledge verify [--json]',
  '',
  'Layers run mathematics, physics, chemistry, biology, biomedicine. A principle',
  'may never depend on a layer above its own and may never claim more confidence',
  'than the weakest principle it rests on; both are checked at load. Derivations',
  'report the full support tree down to axioms, the layers crossed, the weakest',
  'link, and every stated limit. The base is textbook grounding for reasoning,',
  'not a source of experimental fact, and it authorizes no physical work.'
].join('\n');

export const PROCEDURE_USAGE = [
  'ScienceCode immutable procedure design and logical dry-run',
  '',
  'Usage:',
  '  sciencecode procedure create SPEC.json [--chat CHAT_ID] [--note TEXT]',
  '  sciencecode procedure list [--current] [--domain DOMAIN] [--json]',
  '  sciencecode procedure show PROCEDURE_ID',
  '  sciencecode procedure verify PROCEDURE_ID',
  '  sciencecode procedure assess PROCEDURE_ID [--chat CHAT_ID] [--note TEXT]',
  '  sciencecode procedure assessment list [--procedure ID] [--json]',
  '  sciencecode procedure assessment show PROCEDURE_ASSESSMENT_ID',
  '  sciencecode procedure assessment verify PROCEDURE_ASSESSMENT_ID',
  '  sciencecode procedure decide PROCEDURE_ID PROCEDURE_ASSESSMENT_ID [options]',
  '  sciencecode procedure decision list [--procedure ID] [--scope SCOPE] [--json]',
  '  sciencecode procedure decision show PROCEDURE_DECISION_ID',
  '  sciencecode procedure decision verify PROCEDURE_DECISION_ID',
  '',
  'Decision options:',
  '  --decision approve|reject',
  '  --scope design_review|external_dry_run|external_physical_execution',
  '  --reviewer NAME         Local attesting reviewer name',
  '  --role ROLE             Reviewer role or responsibility',
  '  --organization TEXT     Optional organization',
  '  --basis TEXT            Decision basis',
  '  --conditions TEXT       Optional conditions',
  '  --expires ISO_TIME      Required for external physical scope approval',
  '  --attest                Confirm ScienceCode does not verify identity or execute hardware',
  '  --chat CHAT_ID          Share the immutable decision with this conversation',
  '  --note TEXT             Bounded user direction for the next AI turn',
  '',
  'The dry-run validates graph order, references, controls, hazards, totals, and',
  'non-executable XDL/Opentrons mappings. ScienceCode never runs or authorizes',
  'physical laboratory hardware; decisions are local, unverified attestations.'
].join('\n');

export const REVIEW_USAGE = [
  'ScienceCode independent semantic consistency review',
  '',
  'Usage:',
  '  sciencecode review list [--chat CHAT_ID] [--target ARTIFACT_URL] [--json]',
  '  sciencecode review run ARTIFACT_URL --chat CHAT_ID',
  '  sciencecode review run --revision REVISION_ID --chat CHAT_ID',
  '  sciencecode review show REVIEW_ID',
  '  sciencecode review verify REVIEW_ID',
  '',
  'The reviewer extracts bounded claims, resolves ingested evidence IDs/pages/spans',
  'and DOIs, checks literal numbers and explicit {{calc: expression = expected}}',
  'directives, and verifies manifest-bound data/figure/code links. Lexical overlap',
  'is recorded only as triage and never presented as proof of scientific support.'
].join('\n');

export const FIGURE_USAGE = [
  'ScienceCode immutable figure reproducibility and semantic registration',
  '',
  'Usage:',
  '  sciencecode figure compare BASELINE CANDIDATE [options]',
  '  sciencecode figure list [--chat CHAT_ID] [--baseline URL] [--candidate URL] [--json]',
  '  sciencecode figure show FIGURE_COMPARISON_ID',
  '  sciencecode figure verify FIGURE_COMPARISON_ID',
  '  sciencecode figure semantic sidecar CONTRACT.json FIGURE.png DATA.csv [--output FILE.json]',
  '  sciencecode figure semantic register SPEC.json [--chat CHAT_ID]',
  '  sciencecode figure semantic list [--chat CHAT_ID] [--figure URL] [--source URL] [--status pass|fail] [--json]',
  '  sciencecode figure semantic show FIGURE_REGISTRATION_ID',
  '  sciencecode figure semantic verify FIGURE_REGISTRATION_ID',
  '  sciencecode figure visual register SPEC.json [--chat CHAT_ID]',
  '  sciencecode figure visual list [--chat CHAT_ID] [--registration ID] [--status pass|fail] [--json]',
  '  sciencecode figure visual show FIGURE_VISUAL_ID',
  '  sciencecode figure visual verify FIGURE_VISUAL_ID',
  '',
  'Compare options:',
  '  --chat CHAT_ID                 Link and share the record with a conversation',
  '  --name TEXT                    Human-readable comparison name',
  '  --note TEXT                    Bounded interpretation or rerun note',
  '  --pixel-tolerance N            RGBA channel tolerance from 0 through 255',
  '  --max-changed-fraction N       Accepted changed-pixel fraction from 0 through 1',
  '  --min-structural-similarity N  Optional 0-through-1 block-luminance SSIM floor',
  '',
  'BASELINE and CANDIDATE are immutable Lab artifact URLs. Use revision:ID to',
  'select an immutable derived-artifact revision. Both sources must be PNG files.',
  'Configured pixel and structural-similarity rules must both pass. These are',
  'mechanical reproducibility checks, not semantic or scientific validity claims.',
  '',
  'Semantic sidecars bind an exact PNG, CSV/TSV source, explicit columns,',
  'registered source/display units, scales, row policies, sampling, and a',
  'deterministic plotted-data digest. Registration independently replays those',
  'bindings. Visual validation then inspects a matched registration\'s decoded',
  'pixels for a strict flat-color plot profile. It checks axes and projected',
  'line/filled-circle marks, but does not OCR labels, legends, or scientific meaning.'
].join('\n');

function argumentError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
}

// Shared by the statistics and potency calculators so both reject a malformed
// list identically.
function numberList(value, label) {
  // Number('') is 0, so an empty element (e.g. a trailing comma) must be
  // rejected explicitly or a typo silently injects a phantom observation.
  const parts = String(value ?? '').split(',').map((item) => item.trim());
  if (parts.some((item) => item === '')) {
    throw argumentError(label + ' contains an empty element; remove stray commas.');
  }
  const numbers = parts.map(Number);
  if (numbers.some((item) => !Number.isFinite(item))) {
    throw argumentError(label + ' must be a comma-separated list of finite numbers.');
  }
  if (numbers.length > 4_096) {
    throw argumentError(label + ' is limited to 4096 values.');
  }
  return numbers;
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value === '--') throw argumentError(`${option} requires a value.`);
  return value;
}

function figureSourceSelector(value) {
  const selector = String(value ?? '');
  if (selector.startsWith('revision:')) {
    const revisionId = selector.slice('revision:'.length);
    if (!revisionId) throw argumentError('revision: selectors require a revision ID.');
    return { revision_id: revisionId };
  }
  if (!selector.startsWith('/')) {
    throw argumentError('Figure sources must be Lab artifact URLs or revision:ID selectors.');
  }
  return { url: selector };
}

export function parseRunArguments(args) {
  const result = {
    agent: 'scientist',
    format: 'json',
    storePrompt: true,
    passthrough: [],
    prompt: '',
    help: false
  };
  const prompt = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') {
      prompt.push(...args.slice(index + 1));
      break;
    }
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--agent') {
      result.agent = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--format') {
      result.format = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--no-store-prompt') {
      result.storePrompt = false;
      continue;
    }
    const valueOptions = new Map([
      ['--model', '--model'],
      ['-m', '--model'],
      ['--file', '--file'],
      ['-f', '--file'],
      ['--title', '--title'],
      ['--variant', '--variant'],
      ['--session', '--session'],
      ['-s', '--session']
    ]);
    if (valueOptions.has(token)) {
      result.passthrough.push(valueOptions.get(token), takeValue(args, index, token));
      index += 1;
      continue;
    }
    const flagOptions = new Map([
      ['--thinking', '--thinking'],
      ['--continue', '--continue'],
      ['-c', '--continue'],
      ['--fork', '--fork']
    ]);
    if (flagOptions.has(token)) {
      result.passthrough.push(flagOptions.get(token));
      continue;
    }
    if (token.startsWith('-')) {
      throw argumentError(`Unsupported recorded-run option: ${token}. Use -- before prompt text that starts with a dash.`);
    }
    prompt.push(token);
  }
  if (!['json', 'default'].includes(result.format)) {
    throw argumentError('--format must be "json" or "default".');
  }
  result.prompt = prompt.join(' ').trim();
  return result;
}

export function parseSimulationArguments(args) {
  const result = {
    script: null,
    seed: 0,
    device: 'auto',
    timeoutMs: 3_600_000,
    parameters: {},
    inputs: [],
    scriptArgs: [],
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') {
      result.scriptArgs.push(...args.slice(index + 1));
      break;
    }
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--seed') {
      const value = Number(takeValue(args, index, token));
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw argumentError('--seed must be an integer from 0 through 4294967295.');
      }
      result.seed = value;
      index += 1;
      continue;
    }
    if (token === '--device') {
      result.device = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--timeout') {
      const seconds = Number(takeValue(args, index, token));
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
        throw argumentError('--timeout must be an integer from 1 through 86400 seconds.');
      }
      result.timeoutMs = seconds * 1000;
      index += 1;
      continue;
    }
    if (token === '--param') {
      const [name, value] = parseSimulationParameter(takeValue(args, index, token));
      if (Object.hasOwn(result.parameters, name)) {
        throw argumentError('Duplicate simulation parameter: ' + name);
      }
      result.parameters[name] = value;
      index += 1;
      continue;
    }
    if (token === '--input') {
      result.inputs.push(takeValue(args, index, token));
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw argumentError('Unknown simulation option: ' + token);
    }
    if (result.script !== null) {
      throw argumentError('simulate run accepts one script; use -- before script arguments.');
    }
    result.script = token;
  }
  return result;
}

export function parseInferenceArguments(args) {
  const result = {
    model: null,
    input: null,
    device: 'npu',
    allowFallback: false,
    warmup: 1,
    iterations: 3,
    timeoutMs: 900_000,
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--input') {
      if (result.input !== null) throw argumentError('Duplicate inference option: --input');
      result.input = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--device') {
      result.device = takeValue(args, index, token);
      if (!/^(?:npu|cpu|auto)$/.test(result.device)) {
        throw argumentError('--device must be npu, cpu, or auto.');
      }
      index += 1;
      continue;
    }
    if (token === '--allow-fallback') {
      result.allowFallback = true;
      continue;
    }
    if (token === '--warmup' || token === '--iterations') {
      const value = Number(takeValue(args, index, token));
      const minimum = token === '--warmup' ? 0 : 1;
      if (!Number.isSafeInteger(value) || value < minimum || value > 1_000) {
        throw argumentError(token + ' must be an integer from ' + minimum + ' through 1000.');
      }
      if (token === '--warmup') result.warmup = value;
      else result.iterations = value;
      index += 1;
      continue;
    }
    if (token === '--timeout') {
      const seconds = Number(takeValue(args, index, token));
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) {
        throw argumentError('--timeout must be an integer from 1 through 86400 seconds.');
      }
      result.timeoutMs = seconds * 1_000;
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw argumentError('Unknown inference option: ' + token);
    }
    if (result.model !== null) {
      throw argumentError('inference run accepts exactly one ONNX model.');
    }
    result.model = token;
  }
  return result;
}

export function parseExperimentArguments(args) {
  const result = {
    script: null,
    name: null,
    hypothesis: null,
    seeds: [0],
    device: 'auto',
    timeoutMs: 3_600_000,
    parameters: {},
    variations: {},
    inputs: [],
    scriptArgs: [],
    analysisContractId: null,
    cadBuildId: null,
    help: false
  };
  let seedsSet = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') {
      result.scriptArgs.push(...args.slice(index + 1));
      break;
    }
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--name') {
      if (result.name !== null) throw argumentError('Duplicate experiment option: --name');
      result.name = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--hypothesis') {
      if (result.hypothesis !== null) throw argumentError('Duplicate experiment option: --hypothesis');
      result.hypothesis = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--analysis-contract') {
      if (result.analysisContractId !== null) {
        throw argumentError('Duplicate experiment option: --analysis-contract');
      }
      result.analysisContractId = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--cad-build') {
      if (result.cadBuildId !== null) {
        throw argumentError('Duplicate experiment option: --cad-build');
      }
      result.cadBuildId = takeValue(args, index, token);
      index += 1;
      continue;
    }
    if (token === '--seeds') {
      if (seedsSet) throw argumentError('Duplicate experiment option: --seeds');
      result.seeds = parseExperimentSeeds(takeValue(args, index, token));
      seedsSet = true;
      index += 1;
      continue;
    }
    if (token === '--device') {
      result.device = takeValue(args, index, token);
      if (!/^(?:auto|cpu|cuda(?::\d+)?)$/.test(result.device)) {
        throw argumentError('--device must be auto, cpu, cuda, or cuda:N.');
      }
      index += 1;
      continue;
    }
    if (token === '--timeout') {
      const seconds = Number(takeValue(args, index, token));
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
        throw argumentError('--timeout must be an integer from 1 through 86400 seconds.');
      }
      result.timeoutMs = seconds * 1000;
      index += 1;
      continue;
    }
    if (token === '--param') {
      const [name, value] = parseSimulationParameter(takeValue(args, index, token));
      if (Object.hasOwn(result.parameters, name) || Object.hasOwn(result.variations, name)) {
        throw argumentError('Duplicate or conflicting experiment parameter: ' + name);
      }
      result.parameters[name] = value;
      index += 1;
      continue;
    }
    if (token === '--vary') {
      const [name, values] = parseExperimentVariation(takeValue(args, index, token));
      if (Object.hasOwn(result.variations, name) || Object.hasOwn(result.parameters, name)) {
        throw argumentError('Duplicate or conflicting experiment parameter: ' + name);
      }
      result.variations[name] = values;
      index += 1;
      continue;
    }
    if (token === '--input') {
      result.inputs.push(takeValue(args, index, token));
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw argumentError('Unknown experiment option: ' + token);
    }
    if (result.script !== null) {
      throw argumentError('experiment run accepts one script; use -- before script arguments.');
    }
    result.script = token;
  }
  return result;
}

function onlyFlags(args, allowed) {
  for (const value of args) {
    if (!allowed.includes(value)) throw argumentError(`Unknown option: ${value}`);
  }
}

function benchmarkOptions(args, valueOptions = []) {
  const positional = [];
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--json') {
      if (flags.has(value)) throw argumentError('Duplicate benchmark option: ' + value);
      flags.add(value);
      continue;
    }
    if (valueOptions.includes(value)) {
      if (values.has(value)) throw argumentError('Duplicate benchmark option: ' + value);
      const optionValue = takeValue(args, index, value);
      if (optionValue.startsWith('--')) throw argumentError(value + ' requires a value.');
      values.set(value, optionValue);
      index += 1;
      continue;
    }
    if (value.startsWith('-')) throw argumentError('Unknown option: ' + value);
    positional.push(value);
  }
  return { positional, json: flags.has('--json'), values };
}

function writeLine(stream, value = '') {
  stream.write(`${value}\n`);
}

function writeBlock(stream, value) {
  if (!value) return;
  stream.write(String(value));
  if (!String(value).endsWith('\n')) stream.write('\n');
}

function ensureContainedOutputParent(cwd, file) {
  const project = path.resolve(cwd);
  const parent = path.dirname(path.resolve(file));
  if (!isPathInside(project, parent)) {
    throw Object.assign(new Error('Snapshot output escapes the project root.'), {
      code: 'PATH_OUTSIDE_ROOT'
    });
  }
  const relative = path.relative(project, parent);
  let current = project;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) {
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      stat = fs.lstatSync(current, { throwIfNoEntry: false });
    }
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw Object.assign(
        new Error('Snapshot output parent is not a safe project directory.'),
        { code: 'PATH_OUTSIDE_ROOT' }
      );
    }
  }
  const projectReal = fs.realpathSync(project);
  const parentReal = fs.realpathSync(parent);
  if (!isPathInside(projectReal, parentReal)) {
    throw Object.assign(new Error('Snapshot output parent escapes the project root.'), {
      code: 'PATH_OUTSIDE_ROOT'
    });
  }
}

function launchResult(result, stderr) {
  if (result.error) {
    writeLine(stderr, `Unable to start OpenCode: ${result.error.message}`);
    return result.error.code === 'ENOENT' ? 127 : 1;
  }
  return result.status ?? 1;
}

export function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  root = moduleRoot,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  const [command = 'help', ...args] = argv;
  const configDir = path.join(root, 'opencode');
  try {
    if (['help', '--help', '-h'].includes(command)) {
      writeLine(stdout, USAGE);
      return 0;
    }
    if (['version', '--version', '-v'].includes(command)) {
      writeLine(stdout, VERSION);
      return 0;
    }
    if (command === 'config') {
      onlyFlags(args, []);
      writeLine(stdout, configDir);
      return 0;
    }
    if (command === 'paths') {
      onlyFlags(args, []);
      writeLine(stdout, JSON.stringify(runtimePaths({ packageRoot: root, configDir, env }), null, 2));
      return 0;
    }
    if (command === 'benchmark' || command === 'benchmarks' || command === 'bench') {
      const action = args[0] ?? 'help';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        if (rest.length) throw argumentError('benchmark help accepts no other options.');
        writeLine(stdout, BENCHMARK_USAGE);
        return 0;
      }
      if (rest.some((value) => ['help', '--help', '-h'].includes(value))) {
        if (rest.length !== 1) throw argumentError('benchmark help accepts no other options.');
        writeLine(stdout, BENCHMARK_USAGE);
        return 0;
      }
      if (action === 'inspect') {
        const parsed = benchmarkOptions(rest);
        if (parsed.positional.length !== 1) {
          throw argumentError('benchmark inspect requires exactly one manifest file.');
        }
        const report = inspectScienceCodeBenchmark({
          manifestPath: path.resolve(cwd, parsed.positional[0])
        });
        writeLine(stdout, parsed.json
          ? JSON.stringify(report, null, 2)
          : formatScienceCodeBenchmark(report));
        return 0;
      }
      if (action === 'predict') {
        const parsed = benchmarkOptions(rest, ['--output']);
        if (parsed.positional.length !== 1 || !parsed.values.has('--output')) {
          throw argumentError('benchmark predict requires one manifest and --output RUN.json.');
        }
        const result = writeScienceCodeBenchmarkRun({
          manifestPath: path.resolve(cwd, parsed.positional[0]),
          outputPath: parsed.values.get('--output'),
          cwd
        });
        if (parsed.json) {
          writeLine(stdout, JSON.stringify(result, null, 2));
        } else {
          writeLine(stdout, 'ScienceCode benchmark predictions written: ' + result.output_file);
          writeLine(stdout, 'Run: ' + result.run.run_id);
          writeLine(stdout, 'SHA-256: ' + result.output_sha256);
        }
        return 0;
      }
      if (action === 'score') {
        const parsed = benchmarkOptions(rest, ['--predictions']);
        if (parsed.positional.length !== 1 || !parsed.values.has('--predictions')) {
          throw argumentError('benchmark score requires one manifest and --predictions RUN.json.');
        }
        const report = scoreScienceCodeBenchmark({
          manifestPath: path.resolve(cwd, parsed.positional[0]),
          predictionsPath: path.resolve(cwd, parsed.values.get('--predictions'))
        });
        writeLine(stdout, parsed.json
          ? JSON.stringify(report, null, 2)
          : formatScienceCodeBenchmark(report));
        return report.status === 'pass' ? 0 : 1;
      }
      throw argumentError('benchmark action must be "inspect", "predict", or "score".');
    }
    if (command === 'evaluate' || command === 'evaluation' || command === 'eval') {
      if (args.some((value) => ['help', '--help', '-h'].includes(value))) {
        if (args.length !== 1) throw argumentError('evaluate help accepts no other options.');
        writeLine(stdout, EVALUATION_USAGE);
        return 0;
      }
      onlyFlags(args, ['--json']);
      const report = runScienceCodeEvaluation({ packageRoot: root });
      writeLine(
        stdout,
        args.includes('--json')
          ? JSON.stringify(report, null, 2)
          : formatScienceCodeEvaluation(report)
      );
      return report.status === 'pass' ? 0 : 1;
    }
    if (command === 'cad') {
      const action = args[0] ?? 'list';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, CAD_USAGE);
        return 0;
      }
      if (action === 'toolchain') {
        onlyFlags(rest, []);
        const tools = detectCadToolchain({ env });
        writeLine(stdout, JSON.stringify(tools, null, 2));
        return (tools.openscad.available || tools.cadquery.available) && tools.slicer.available ? 0 : 1;
      }
      if (action === 'init') {
        let name = 'Parametric assembly';
        let cadProjectId = null;
        let engine = 'openscad';
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--name') {
            name = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--id') {
            cadProjectId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--engine') {
            engine = takeValue(rest, index, value);
            index += 1;
          } else {
            throw argumentError('Unknown CAD init option: ' + value);
          }
        }
        if (!['openscad', 'cadquery'].includes(engine)) {
          throw argumentError('CAD engine must be openscad or cadquery.');
        }
        const result = initializeCadProject({ cwd, name, cadProjectId, engine });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return 0;
      }
      if (action === 'create') {
        if (rest.length !== 1) {
          throw argumentError(
            'cad create requires exactly one project-relative specification file.'
          );
        }
        const result = createCadProjectFromSpecFile({
          cwd,
          specPath: rest[0]
        });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return 0;
      }
      if (action === 'list') {
        let json = false;
        let kind = 'projects';
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--json') json = true;
          else if (value === '--kind') {
            kind = takeValue(rest, index, value);
            index += 1;
          } else throw argumentError('Unknown CAD list option: ' + value);
        }
        const collections = {
          projects: () => listCadProjects(cwd),
          builds: () => listCadBuilds(cwd),
          simulations: () => listCadSimulations(cwd),
          slices: () => listCadSlices(cwd)
        };
        if (!collections[kind]) throw argumentError('CAD list kind must be projects, builds, simulations, or slices.');
        const records = collections[kind]();
        if (json) writeLine(stdout, JSON.stringify(records, null, 2));
        else if (!records.length) writeLine(stdout, 'No CAD ' + kind + ' recorded.');
        else {
          const idField = {
            projects: 'cad_project_id',
            builds: 'build_id',
            simulations: 'simulation_id',
            slices: 'slice_id'
          }[kind];
          for (const record of records) {
            writeLine(stdout, [
              record[idField],
              record.status ?? (record.healthy ? 'healthy' : 'attention'),
              record.name ?? record.mode ?? record.created_at ?? ''
            ].join('\t'));
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (rest.length !== 1) throw argumentError('cad show requires exactly one record ID.');
        const id = rest[0];
        let record;
        if (id.startsWith('cad-build-')) record = getCadBuild(cwd, id);
        else if (id.startsWith('cad-sim-')) record = getCadSimulation(cwd, id);
        else if (id.startsWith('cad-slice-')) record = getCadSlice(cwd, id);
        else record = getCadProject(cwd, id);
        writeLine(stdout, JSON.stringify(record, null, 2));
        return 0;
      }
      if (action === 'read') {
        if (rest.length !== 2) throw argumentError('cad read requires CAD_PROJECT_ID FILE.');
        const result = readCadFile({ cwd, cadProjectId: rest[0], file: rest[1] });
        writeBlock(stdout, result.content);
        return 0;
      }
      if (action === 'write') {
        if (rest.length < 2) throw argumentError('cad write requires CAD_PROJECT_ID FILE --from SOURCE.');
        const cadProjectId = rest[0];
        const file = rest[1];
        let source = null;
        let expectedSha256 = null;
        let actor = 'cli-user';
        for (let index = 2; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--from') {
            source = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--expected') {
            expectedSha256 = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--actor') {
            actor = takeValue(rest, index, value);
            index += 1;
          } else throw argumentError('Unknown CAD write option: ' + value);
        }
        if (!source) throw argumentError('cad write requires --from SOURCE.');
        const sourceFile = resolveInsideRoot(cwd, source);
        const sourceStat = fs.lstatSync(sourceFile, { throwIfNoEntry: false });
        if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) {
          throw argumentError('CAD edit source must be a regular project file.');
        }
        const result = writeCadFile({
          cwd, cadProjectId, file,
          content: fs.readFileSync(sourceFile, 'utf8'),
          expectedSha256,
          actor
        });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return 0;
      }
      if (action === 'build') {
        if (!rest.length) throw argumentError('cad build requires CAD_PROJECT_ID.');
        const cadProjectId = rest[0];
        let timeoutMs = 300_000;
        for (let index = 1; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--timeout') {
            timeoutMs = Number(takeValue(rest, index, value)) * 1_000;
            index += 1;
          } else throw argumentError('Unknown CAD build option: ' + value);
        }
        const result = buildCadProject({ cwd, cadProjectId, timeoutMs, env });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.manifest.status === 'completed' && result.verification.ok ? 0 : 1;
      }
      if (action === 'simulate') {
        if (!rest.length) throw argumentError('cad simulate requires CAD_BUILD_ID.');
        const buildId = rest[0];
        let densityGcm3;
        for (let index = 1; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--density') {
            densityGcm3 = Number(takeValue(rest, index, value));
            index += 1;
          } else throw argumentError('Unknown CAD simulation option: ' + value);
        }
        const result = simulateCadBuild({ cwd, buildId, densityGcm3 });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.verification.ok ? 0 : 1;
      }
      if (action === 'physics') {
        if (rest.length < 2) {
          throw argumentError('cad physics requires CAD_BUILD_ID and a Python model script.');
        }
        const buildId = rest[0];
        const parsed = parseSimulationArguments(rest.slice(1));
        if (parsed.help) {
          writeLine(stdout, CAD_USAGE);
          return 0;
        }
        const result = runSimulation({
          cwd,
          packageRoot: root,
          script: parsed.script,
          seed: parsed.seed,
          device: parsed.device,
          timeoutMs: parsed.timeoutMs,
          parameters: parsed.parameters,
          inputs: parsed.inputs,
          scriptArgs: parsed.scriptArgs,
          cadBuildId: buildId,
          env
        });
        writeBlock(stdout, result.displayStdout);
        writeBlock(stderr, result.displayStderr);
        writeLine(stderr, 'ScienceCode CAD-linked simulation record: ' + result.runDirectory);
        return result.manifest.exit_code;
      }
      if (action === 'study') {
        if (rest.length < 2) {
          throw argumentError('cad study requires CAD_BUILD_ID and a Python model script.');
        }
        const buildId = rest[0];
        const parsed = parseExperimentArguments(rest.slice(1));
        if (parsed.help) {
          writeLine(stdout, CAD_USAGE + '\n\n' + EXPERIMENT_USAGE);
          return 0;
        }
        if (parsed.cadBuildId !== null) {
          throw argumentError('cad study already receives its CAD build as the first argument.');
        }
        const result = runExperiment({
          cwd,
          packageRoot: root,
          script: parsed.script,
          seeds: parsed.seeds,
          device: parsed.device,
          timeoutMs: parsed.timeoutMs,
          parameters: parsed.parameters,
          variations: parsed.variations,
          inputs: parsed.inputs,
          scriptArgs: parsed.scriptArgs,
          name: parsed.name,
          hypothesis: parsed.hypothesis,
          analysisContractId: parsed.analysisContractId,
          cadBuildId: buildId,
          env
        });
        writeLine(stdout, JSON.stringify({
          experiment_id: result.manifest.experiment_id,
          cad_parent: result.manifest.cad_parent,
          status: result.manifest.status,
          counts: result.manifest.counts,
          review: result.review,
          simulations: result.manifest.simulations
        }, null, 2));
        writeLine(stderr, 'ScienceCode CAD study record: ' + result.experimentDirectory);
        return result.manifest.status === 'completed' && result.verification.ok ? 0 : 1;
      }
      if (action === 'slice') {
        if (!rest.length) throw argumentError('cad slice requires CAD_BUILD_ID.');
        const buildId = rest[0];
        let mode = 'preview';
        let profilePath = null;
        let acknowledgePhysicalRisk = false;
        let timeoutMs = 300_000;
        const settings = {};
        for (let index = 1; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--mode') {
            mode = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--profile') {
            profilePath = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--acknowledge-physical-risk') {
            acknowledgePhysicalRisk = true;
          } else if (value === '--layer-height') {
            settings.layer_height_mm = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--nozzle-diameter') {
            settings.nozzle_diameter_mm = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--filament-diameter') {
            settings.filament_diameter_mm = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--infill') {
            settings.infill_percent = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--threads') {
            settings.threads = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--timeout') {
            timeoutMs = Number(takeValue(rest, index, value)) * 1_000;
            index += 1;
          } else throw argumentError('Unknown CAD slice option: ' + value);
        }
        const result = sliceCadBuild({
          cwd, buildId, mode, profilePath, acknowledgePhysicalRisk,
          settings, timeoutMs, env
        });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.manifest.status.startsWith('completed') && result.verification.ok ? 0 : 1;
      }
      if (action === 'verify') {
        if (rest.length !== 1) throw argumentError('cad verify requires exactly one build, simulation, or slice ID.');
        const id = rest[0];
        let result;
        if (id.startsWith('cad-build-')) result = verifyCadBuild(cwd, id);
        else if (id.startsWith('cad-sim-')) result = verifyCadSimulation(cwd, id);
        else if (id.startsWith('cad-slice-')) result = verifyCadSlice(cwd, id);
        else throw argumentError('CAD verification supports build, simulation, and slice record IDs.');
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      throw argumentError('Unknown CAD action: ' + action);
    }
    if (command === 'lineage') {
      let action = 'show';
      let chatId = null;
      let json = false;
      for (let index = 0; index < args.length; index += 1) {
        const value = args[index];
        if (['show', 'verify'].includes(value) && index === 0) {
          action = value;
        } else if (value === '--chat') {
          chatId = takeValue(args, index, '--chat');
          index += 1;
        } else if (value === '--json') {
          json = true;
        } else {
          throw argumentError('Unknown lineage option: ' + value);
        }
      }
      const graph = buildLineageGraph(cwd, { chatId });
      if (action === 'verify') {
        writeLine(stdout, JSON.stringify({
          ok: graph.integrity.ok,
          integrity: graph.integrity,
          scope: graph.scope,
          summary: graph.summary,
          findings: graph.findings
        }, null, 2));
        return graph.integrity.ok ? 0 : 1;
      }
      if (json) {
        writeLine(stdout, JSON.stringify(graph, null, 2));
      } else {
        writeLine(stdout, 'Scientific lineage: ' + graph.summary.status);
        writeLine(stdout, 'Nodes: ' + graph.summary.nodes + ' (' + graph.summary.verified_nodes + ' verified)');
        writeLine(stdout, 'Edges: ' + graph.summary.edges);
        writeLine(stdout, 'Findings: ' + graph.summary.errors + ' errors, ' + graph.summary.warnings + ' warnings');
        writeLine(stdout, 'Graph SHA-256: ' + graph.integrity.graph_sha256);
      }
      return 0;
    }
    if (command === 'campaign' || command === 'campaigns') {
      const action = args[0] ?? 'list';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, CAMPAIGN_USAGE);
        return 0;
      }
      if (action === 'list') {
        let chatId = null;
        let json = false;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--json') {
            json = true;
          } else {
            throw argumentError('Unknown campaign list option: ' + value);
          }
        }
        const campaigns = listCampaigns(cwd, { chatId });
        if (json) {
          writeLine(stdout, JSON.stringify(campaigns, null, 2));
        } else if (!campaigns.length) {
          writeLine(stdout, 'No recorded campaigns.');
        } else {
          writeLine(stdout, 'CAMPAIGN ID                             STATUS              TASKS  TITLE');
          for (const campaign of campaigns) {
            const total = Object.values(campaign.counts ?? {})
              .reduce((sum, count) => sum + Number(count ?? 0), 0);
            const progress = String(campaign.counts?.completed ?? 0) + '/' + String(total);
            writeLine(stdout,
              String(campaign.campaign_id).padEnd(39) + ' ' +
              String(campaign.status).padEnd(19) + ' ' +
              progress.padEnd(6) + ' ' +
              String(campaign.title ?? '-')
            );
          }
        }
        return 0;
      }
      if (action === 'show' || action === 'verify') {
        if (rest.length !== 1) {
          throw argumentError('campaign ' + action + ' requires exactly one campaign ID.');
        }
        const result = action === 'show'
          ? getCampaign(cwd, rest[0])
          : verifyCampaign(cwd, rest[0]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return action === 'verify' && !result.ok ? 1 : 0;
      }
      if (action === 'create') {
        let chatId = null;
        let note = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown campaign create option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 1 || !chatId) {
          throw argumentError(
            'campaign create requires exactly one JSON plan and --chat CHAT_ID.'
          );
        }
        const project = path.resolve(cwd);
        const input = resolveInsideRoot(project, positional[0]);
        const relative = relativePortable(project, input);
        const stat = fs.lstatSync(input, { throwIfNoEntry: false });
        if (!stat?.isFile() || stat.isSymbolicLink() ||
            relative === '.sciencecode' || relative.startsWith('.sciencecode/')) {
          throw Object.assign(
            new Error('Campaign plan must be a regular project file outside .sciencecode.'),
            { code: 'INVALID_CAMPAIGN' }
          );
        }
        const projectReal = fs.realpathSync(project);
        const inputReal = fs.realpathSync(input);
        const realRelative = path.relative(projectReal, inputReal);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
          throw Object.assign(
            new Error('Campaign plan escapes the project through a filesystem link.'),
            { code: 'INVALID_CAMPAIGN_PATH' }
          );
        }
        const created = createCampaign({
          cwd,
          spec: readJson(inputReal),
          chatId
        });
        const detail = getCampaign(cwd, created.manifest.campaign_id);
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId,
            surface: 'campaign',
            action: 'created',
            artifact: campaignInteractionArtifact(detail),
            payload: campaignInteractionPayload(detail, note)
          });
        } catch (error) {
          interactionError = {
            code: error.code ?? 'INTERACTION_ERROR',
            message: error.message
          };
        }
        writeLine(stdout, JSON.stringify({
          campaign: detail,
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'decide') {
        let note = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown campaign decide option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 3) {
          throw argumentError(
            'campaign decide requires CAMPAIGN_ID TASK_ID approved|rejected|skipped.'
          );
        }
        const [campaignId, taskId, decision] = positional;
        const event = recordCampaignDecision({
          cwd,
          campaignId,
          taskId,
          decision,
          note
        });
        const detail = getCampaign(cwd, campaignId);
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId: detail.manifest.chat_id,
            surface: 'campaign',
            action: 'checkpoint.' + decision,
            artifact: campaignInteractionArtifact(detail),
            payload: {
              ...campaignInteractionPayload(detail, note),
              task_id: taskId,
              attempt: event.payload.attempt,
              decision
            }
          });
        } catch (error) {
          interactionError = {
            code: error.code ?? 'INTERACTION_ERROR',
            message: error.message
          };
        }
        writeLine(stdout, JSON.stringify({
          event,
          campaign: detail,
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'assess') {
        let rationale = null;
        const taskIds = [];
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--rationale') {
            rationale = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--task') {
            taskIds.push(takeValue(rest, index, value));
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown campaign assess option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 4 || !rationale) {
          throw argumentError(
            'campaign assess requires CAMPAIGN_ID HYPOTHESIS_ID VERDICT ' +
            'DECISION --rationale TEXT.'
          );
        }
        const [campaignId, hypothesisId, verdict, decision] = positional;
        const event = recordHypothesisAssessment({
          cwd,
          campaignId,
          hypothesisId,
          verdict,
          decision,
          rationale,
          taskIds
        });
        const detail = getCampaign(cwd, campaignId);
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId: detail.manifest.chat_id,
            surface: 'campaign',
            action: 'hypothesis.assessed',
            artifact: campaignInteractionArtifact(detail),
            payload: {
              ...campaignInteractionPayload(detail),
              hypothesis_id: hypothesisId,
              verdict,
              decision,
              rationale,
              task_ids: taskIds,
              event_id: event.event_id,
              human_checkpoint: true,
              ai_generated: false
            }
          });
        } catch (error) {
          interactionError = {
            code: error.code ?? 'INTERACTION_ERROR',
            message: error.message
          };
        }
        writeLine(stdout, JSON.stringify({
          event,
          campaign: detail,
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'advance') {
        if (rest.length < 1 || rest.length > 2) {
          throw argumentError('campaign advance requires CAMPAIGN_ID and optional TASK_ID.');
        }
        const campaignId = rest[0];
        const taskId = rest[1] ?? null;
        const result = runCampaignTask({
          cwd,
          campaignId,
          taskId,
          packageRoot: root,
          configDir,
          env
        });
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId: result.campaign.manifest.chat_id,
            surface: 'campaign',
            action: 'task.' + result.status,
            artifact: campaignInteractionArtifact(result.campaign),
            payload: {
              ...campaignInteractionPayload(result.campaign),
              task_id: result.task_id,
              attempt: result.attempt,
              run_id: result.turn.run_id,
              turn_index: result.turn.turn_index,
              event_id: result.event.event_id
            }
          });
        } catch (error) {
          interactionError = {
            code: error.code ?? 'INTERACTION_ERROR',
            message: error.message
          };
        }
        writeBlock(stdout, result.turn.assistant?.text);
        writeLine(stderr, 'ScienceCode campaign: ' +
          result.campaign_id + ' / ' + result.task_id + ' / ' + result.status);
        if (interactionError) {
          writeLine(stderr, 'ScienceCode interaction: ' + interactionError.message);
        }
        return result.turn.exit_code ?? (result.status === 'completed' ? 0 : 1);
      }
      if (action === 'stop') {
        let reason = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--reason') {
            reason = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown campaign stop option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 1 || !reason) {
          throw argumentError('campaign stop requires CAMPAIGN_ID --reason TEXT.');
        }
        const event = stopCampaign({ cwd, campaignId: positional[0], reason });
        const detail = getCampaign(cwd, positional[0]);
        let interaction = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId: detail.manifest.chat_id,
            surface: 'campaign',
            action: 'stopped',
            artifact: campaignInteractionArtifact(detail),
            payload: {
              ...campaignInteractionPayload(detail),
              reason,
              event_id: event.event_id
            }
          });
        } catch {
          interaction = null;
        }
        writeLine(stdout, JSON.stringify({ event, campaign: detail, interaction }, null, 2));
        return 0;
      }
      if (action === 'abandon') {
        let reason = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--reason') {
            reason = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown campaign abandon option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 2 || !reason) {
          throw argumentError(
            'campaign abandon requires CAMPAIGN_ID TASK_ID --reason TEXT.'
          );
        }
        const event = abandonCampaignTask({
          cwd,
          campaignId: positional[0],
          taskId: positional[1],
          reason
        });
        const detail = getCampaign(cwd, positional[0]);
        let interaction = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId: detail.manifest.chat_id,
            surface: 'campaign',
            action: 'task.abandoned',
            artifact: campaignInteractionArtifact(detail),
            payload: {
              ...campaignInteractionPayload(detail),
              task_id: positional[1],
              reason,
              event_id: event.event_id
            }
          });
        } catch {
          interaction = null;
        }
        writeLine(stdout, JSON.stringify({ event, campaign: detail, interaction }, null, 2));
        return 0;
      }
      throw argumentError(
        'campaign action must be create, list, show, verify, decide, advance, stop, or abandon.'
      );
    }
    if (command === 'procedure' || command === 'procedures') {
      const action = args[0] ?? 'list';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, PROCEDURE_USAGE);
        return 0;
      }
      if (action === 'list') {
        let json = false;
        let currentOnly = false;
        let domain = null;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--json') {
            json = true;
          } else if (value === '--current') {
            currentOnly = true;
          } else if (value === '--domain') {
            domain = takeValue(rest, index, value);
            index += 1;
          } else {
            throw argumentError('Unknown procedure list option: ' + value);
          }
        }
        let records = listProcedures(cwd);
        if (currentOnly) records = records.filter((item) => item.current);
        if (domain) records = records.filter((item) => item.domain === domain);
        if (json) {
          writeLine(stdout, JSON.stringify(records, null, 2));
        } else if (!records.length) {
          writeLine(stdout, 'No procedure plans.');
        } else {
          writeLine(stdout,
            'PROCEDURE ID                            DOMAIN          VERIFIED  CURRENT  STEPS');
          for (const record of records) {
            writeLine(stdout,
              String(record.procedure_id).padEnd(39) + ' ' +
              String(record.domain ?? '-').padEnd(15) + ' ' +
              String(record.verified).padEnd(9) + ' ' +
              String(record.current).padEnd(8) + ' ' +
              String(record.counts?.steps ?? 0));
          }
        }
        return 0;
      }
      if (action === 'show' || action === 'verify') {
        if (rest.length !== 1) {
          throw argumentError('procedure ' + action + ' requires exactly one procedure ID.');
        }
        const result = action === 'show'
          ? getProcedure(cwd, rest[0])
          : verifyProcedure(cwd, rest[0]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return action === 'verify' && !result.ok ? 1 : 0;
      }
      if (action === 'create') {
        let chatId = null;
        let note = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown procedure create option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 1) {
          throw argumentError('procedure create requires exactly one JSON spec file.');
        }
        const project = path.resolve(cwd);
        const input = resolveInsideRoot(project, positional[0]);
        const relative = relativePortable(project, input);
        const stat = fs.lstatSync(input, { throwIfNoEntry: false });
        if (!stat?.isFile() || stat.isSymbolicLink() ||
            relative === '.sciencecode' || relative.startsWith('.sciencecode/')) {
          throw Object.assign(
            new Error('Procedure spec must be a regular project file outside .sciencecode.'),
            { code: 'INVALID_PROCEDURE' }
          );
        }
        const projectReal = fs.realpathSync(project);
        const inputReal = fs.realpathSync(input);
        const realRelative = path.relative(projectReal, inputReal);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
          throw Object.assign(
            new Error('Procedure spec escapes the project through a filesystem link.'),
            { code: 'INVALID_PROCEDURE_PATH' }
          );
        }
        const created = createProcedure({
          cwd,
          spec: readJson(inputReal),
          chatId
        });
        let interaction = null;
        let interactionError = null;
        if (created.manifest.chat_id) {
          try {
            interaction = recordInteraction({
              cwd,
              chatId: created.manifest.chat_id,
              surface: 'procedure',
              action: 'plan.created',
              artifact: procedureInteractionArtifact(created),
              payload: procedureInteractionPayload(created, note)
            });
          } catch (error) {
            interactionError = {
              code: error.code ?? 'INTERACTION_ERROR',
              message: error.message
            };
          }
        }
        writeLine(stdout, JSON.stringify({
          procedure: getProcedure(cwd, created.manifest.procedure_id),
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'assess') {
        let chatId = null;
        let note = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown procedure assess option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 1) {
          throw argumentError('procedure assess requires exactly one procedure ID.');
        }
        const created = createProcedureAssessment({
          cwd,
          procedureId: positional[0],
          chatId
        });
        let interaction = null;
        let interactionError = null;
        if (created.manifest.chat_id) {
          try {
            interaction = recordInteraction({
              cwd,
              chatId: created.manifest.chat_id,
              surface: 'procedure',
              action: 'assessment.created',
              artifact: procedureAssessmentInteractionArtifact(created),
              payload: procedureAssessmentInteractionPayload(created, note)
            });
          } catch (error) {
            interactionError = {
              code: error.code ?? 'INTERACTION_ERROR',
              message: error.message
            };
          }
        }
        writeLine(stdout, JSON.stringify({
          assessment: getProcedureAssessment(
            cwd, created.manifest.procedure_assessment_id),
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'assessment' || action === 'assessments') {
        const nestedAction = rest[0] ?? 'list';
        const nestedRest = rest.slice(1);
        if (nestedAction === 'list') {
          let json = false;
          let procedureId = null;
          for (let index = 0; index < nestedRest.length; index += 1) {
            const value = nestedRest[index];
            if (value === '--json') {
              json = true;
            } else if (value === '--procedure') {
              procedureId = takeValue(nestedRest, index, value);
              index += 1;
            } else {
              throw argumentError('Unknown procedure assessment list option: ' + value);
            }
          }
          let records = listProcedureAssessments(cwd);
          if (procedureId) {
            records = records.filter((item) => item.procedure_id === procedureId);
          }
          if (json) {
            writeLine(stdout, JSON.stringify(records, null, 2));
          } else if (!records.length) {
            writeLine(stdout, 'No procedure assessments.');
          } else {
            writeLine(stdout,
              'ASSESSMENT ID                            STATUS                    CURRENT');
            for (const record of records) {
              writeLine(stdout,
                String(record.procedure_assessment_id).padEnd(40) + ' ' +
                String(record.status).padEnd(25) + ' ' +
                String(record.current_for_procedure));
            }
          }
          return 0;
        }
        if (nestedAction === 'show' || nestedAction === 'verify') {
          if (nestedRest.length !== 1) {
            throw argumentError('procedure assessment ' + nestedAction +
              ' requires exactly one assessment ID.');
          }
          const result = nestedAction === 'show'
            ? getProcedureAssessment(cwd, nestedRest[0])
            : verifyProcedureAssessment(cwd, nestedRest[0]);
          writeLine(stdout, JSON.stringify(result, null, 2));
          return nestedAction === 'verify' && !result.ok ? 1 : 0;
        }
        throw argumentError(
          'procedure assessment action must be list, show, or verify.');
      }
      if (action === 'decide') {
        let chatId = null;
        let note = null;
        const input = {
          decision: null,
          scope: null,
          reviewer_name: null,
          reviewer_role: null,
          organization: null,
          basis: null,
          conditions: null,
          expires_at: null,
          attestation: false
        };
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--decision') {
            input.decision = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--scope') {
            input.scope = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--reviewer') {
            input.reviewer_name = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--role') {
            input.reviewer_role = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--organization') {
            input.organization = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--basis') {
            input.basis = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--conditions') {
            input.conditions = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--expires') {
            input.expires_at = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--attest') {
            input.attestation = true;
          } else if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown procedure decide option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 2) {
          throw argumentError(
            'procedure decide requires a procedure ID and procedure assessment ID.');
        }
        input.procedure_id = positional[0];
        input.procedure_assessment_id = positional[1];
        const created = createProcedureDecision({ cwd, input, chatId });
        let interaction = null;
        let interactionError = null;
        if (created.manifest.chat_id) {
          try {
            interaction = recordInteraction({
              cwd,
              chatId: created.manifest.chat_id,
              surface: 'procedure',
              action: 'decision.recorded',
              artifact: procedureDecisionInteractionArtifact(created),
              payload: procedureDecisionInteractionPayload(created, note)
            });
          } catch (error) {
            interactionError = {
              code: error.code ?? 'INTERACTION_ERROR',
              message: error.message
            };
          }
        }
        writeLine(stdout, JSON.stringify({
          decision: getProcedureDecision(cwd, created.manifest.procedure_decision_id),
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'decision' || action === 'decisions') {
        const nestedAction = rest[0] ?? 'list';
        const nestedRest = rest.slice(1);
        if (nestedAction === 'list') {
          let json = false;
          let procedureId = null;
          let scope = null;
          for (let index = 0; index < nestedRest.length; index += 1) {
            const value = nestedRest[index];
            if (value === '--json') {
              json = true;
            } else if (value === '--procedure') {
              procedureId = takeValue(nestedRest, index, value);
              index += 1;
            } else if (value === '--scope') {
              scope = takeValue(nestedRest, index, value);
              index += 1;
            } else {
              throw argumentError('Unknown procedure decision list option: ' + value);
            }
          }
          let records = listProcedureDecisions(cwd);
          if (procedureId) {
            records = records.filter((item) => item.procedure_id === procedureId);
          }
          if (scope) records = records.filter((item) => item.scope === scope);
          if (json) {
            writeLine(stdout, JSON.stringify(records, null, 2));
          } else if (!records.length) {
            writeLine(stdout, 'No procedure decisions.');
          } else {
            writeLine(stdout,
              'DECISION ID                              STATUS     SCOPE                        EFFECTIVE');
            for (const record of records) {
              writeLine(stdout,
                String(record.procedure_decision_id).padEnd(40) + ' ' +
                String(record.status).padEnd(10) + ' ' +
                String(record.scope ?? '-').padEnd(28) + ' ' +
                String(record.effective_status));
            }
          }
          return 0;
        }
        if (nestedAction === 'show' || nestedAction === 'verify') {
          if (nestedRest.length !== 1) {
            throw argumentError('procedure decision ' + nestedAction +
              ' requires exactly one decision ID.');
          }
          const result = nestedAction === 'show'
            ? getProcedureDecision(cwd, nestedRest[0])
            : verifyProcedureDecision(cwd, nestedRest[0]);
          writeLine(stdout, JSON.stringify(result, null, 2));
          return nestedAction === 'verify' && !result.ok ? 1 : 0;
        }
        throw argumentError('procedure decision action must be list, show, or verify.');
      }
      throw argumentError(
        'procedure action must be create, list, show, verify, assess, assessment, decide, or decision.'
      );
    }
    if (command === 'unit' || command === 'units') {
      const action = args[0] ?? 'help';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action) ||
          (rest.length === 1 && ['--help', '-h'].includes(rest[0]))) {
        writeLine(stdout, UNIT_USAGE);
        return 0;
      }
      let json = false;
      const positional = [];
      for (const value of rest) {
        if (value === '--json') {
          if (json) throw argumentError('Duplicate unit option: --json');
          json = true;
        } else if (value.startsWith('--')) {
          throw argumentError('Unknown unit option: ' + value);
        } else {
          positional.push(value);
        }
      }
      if (action === 'list') {
        if (positional.length) throw argumentError('unit list does not accept positional values.');
        const units = listSupportedUnits();
        if (json) {
          writeLine(stdout, JSON.stringify(units, null, 2));
        } else {
          writeLine(stdout, 'SYMBOL          DIMENSION                 CANONICAL');
          for (const unit of units) {
            writeLine(stdout,
              unit.symbol.padEnd(15) + ' ' + unit.dimension.padEnd(25) + ' ' +
              unit.canonical_unit);
          }
        }
        return 0;
      }
      if (action === 'inspect') {
        if (positional.length !== 1) {
          throw argumentError('unit inspect requires exactly one unit expression.');
        }
        const unit = describeUnit(positional[0]);
        if (json) {
          writeLine(stdout, JSON.stringify(unit, null, 2));
        } else {
          writeLine(stdout, unit.symbol + ' · ' + unit.dimension + ' · canonical ' +
            unit.canonical_unit + ' · scale ' + unit.scale_to_canonical +
            (unit.offset_to_canonical ? ' · offset ' + unit.offset_to_canonical : ''));
        }
        return 0;
      }
      if (action === 'convert') {
        if (positional.length !== 3) {
          throw argumentError('unit convert requires VALUE, FROM_UNIT, and TO_UNIT.');
        }
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(positional[0])) {
          throw argumentError('unit convert VALUE must be a finite JSON number.');
        }
        const numeric = Number(positional[0]);
        if (!Number.isFinite(numeric)) {
          throw argumentError('unit convert VALUE must be a finite JSON number.');
        }
        const converted = convertQuantity(
          { value: numeric, unit: positional[1] },
          positional[2]
        );
        const output = {
          source: converted.source,
          result: { value: converted.value, unit: converted.unit },
          dimension: converted.dimension,
          converted: converted.converted
        };
        if (json) {
          writeLine(stdout, JSON.stringify(output, null, 2));
        } else {
          writeLine(stdout, String(output.source.value) + ' ' + output.source.unit + ' = ' +
            String(output.result.value) + ' ' + output.result.unit);
        }
        return 0;
      }
      throw argumentError('unit action must be inspect, convert, or list.');
    }
    if (command === 'knowledge') {
      const action = args[0] ?? 'help';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, KNOWLEDGE_USAGE);
        return 0;
      }
      let json = false;
      const options = {};
      const positional = [];
      for (let index = 0; index < rest.length; index += 1) {
        const value = rest[index];
        if (value === '--json') {
          if (json) throw argumentError('Duplicate knowledge option: --json');
          json = true;
        } else if (['--layer', '--kind', '--domain', '--search'].includes(value)) {
          const key = value.slice(2);
          if (options[key] !== undefined) throw argumentError('Duplicate knowledge option: ' + value);
          index += 1;
          if (index >= rest.length || rest[index].startsWith('--')) {
            throw argumentError('Knowledge option ' + value + ' requires a value.');
          }
          options[key] = rest[index];
        } else if (value.startsWith('--')) {
          throw argumentError('Unknown knowledge option: ' + value);
        } else {
          positional.push(value);
        }
      }
      // Only `list` reads the filter options; accepting them silently elsewhere
      // would let a typo look like a narrowed query.
      if (action !== 'list' && Object.keys(options).length) {
        throw argumentError(
          'knowledge ' + action + ' does not accept ' +
          Object.keys(options).map((key) => '--' + key).join(', ') + '.'
        );
      }
      const describe = (record) => record.id + '  ' + record.layer + '/' + record.kind +
        '  [' + record.epistemic.confidence + ']  ' + record.title;
      if (action === 'layers') {
        if (positional.length) throw argumentError('knowledge layers does not accept positional values.');
        const layers = listKnowledgeLayers();
        if (json) {
          writeLine(stdout, JSON.stringify(layers, null, 2));
        } else {
          for (const layer of layers) {
            writeLine(stdout, String(layer.tier) + '  ' + layer.id.padEnd(13) + ' ' +
              String(layer.principle_count).padStart(3) + ' principles  ' + layer.warrant);
            writeLine(stdout, '   ' + layer.description);
          }
        }
        return 0;
      }
      if (action === 'list') {
        if (positional.length) throw argumentError('knowledge list does not accept positional values.');
        const records = listPrinciples(options);
        if (json) {
          writeLine(stdout, JSON.stringify(records, null, 2));
        } else {
          for (const record of records) writeLine(stdout, describe(record));
          writeLine(stdout, String(records.length) + ' principles');
        }
        return 0;
      }
      if (action === 'show') {
        if (positional.length !== 1) throw argumentError('knowledge show requires exactly one principle id.');
        const record = getPrinciple(positional[0]);
        if (json) {
          writeLine(stdout, JSON.stringify(record, null, 2));
        } else {
          writeLine(stdout, record.id + ' · ' + record.layer + ' (tier ' + record.tier + ') · ' + record.kind);
          writeLine(stdout, record.title);
          writeLine(stdout, '');
          writeLine(stdout, record.statement);
          writeLine(stdout, '');
          writeLine(stdout, 'Confidence: ' + record.epistemic.confidence + ' · status ' +
            record.epistemic.status + ' · falsifiable ' + String(record.epistemic.falsifiable));
          writeLine(stdout, 'Rests on:   ' + (record.depends_on.join(', ') || 'nothing (foundational)'));
          writeLine(stdout, 'Scope:      ' + record.scope);
          writeLine(stdout, 'Limits:     ' + record.limits);
          for (const reference of record.references) writeLine(stdout, 'Reference:  ' + reference);
        }
        return 0;
      }
      if (action === 'derive') {
        if (positional.length !== 1) throw argumentError('knowledge derive requires exactly one principle id.');
        const derivation = derivePrinciple(positional[0]);
        if (json) {
          writeLine(stdout, JSON.stringify(derivation, null, 2));
        } else {
          writeLine(stdout, derivation.principle.id + ' rests on ' + String(derivation.depth - 1) +
            ' supporting principles across ' + derivation.layers_used.join(' > '));
          writeLine(stdout, '');
          for (const record of derivation.chain) {
            writeLine(stdout, '  ' + String(record.tier) + ' ' + describe(record));
          }
          writeLine(stdout, '');
          writeLine(stdout, 'Weakest link: ' + derivation.weakest_link.id + ' (' +
            derivation.weakest_link.confidence + ')');
          writeLine(stdout, '  ' + derivation.weakest_link.limits);
        }
        return 0;
      }
      if (action === 'domain') {
        if (positional.length > 1) throw argumentError('knowledge domain accepts at most one domain id.');
        if (positional.length === 0) {
          const domains = listKnowledgeDomains();
          if (json) {
            writeLine(stdout, JSON.stringify(domains, null, 2));
          } else {
            for (const domain of domains) {
              writeLine(stdout, domain.id.padEnd(22) + ' ' + String(domain.root_count).padStart(2) +
                ' roots  ' + domain.label);
              writeLine(stdout, '   ' + domain.summary);
            }
          }
          return 0;
        }
        const grounding = groundDomain(positional[0]);
        if (json) {
          writeLine(stdout, JSON.stringify(grounding, null, 2));
        } else {
          writeLine(stdout, grounding.label + ' · ' + String(grounding.principles.length) +
            ' principles across ' + grounding.layer_span.join(' > '));
          writeLine(stdout, grounding.summary);
          writeLine(stdout, '');
          for (const entry of grounding.by_layer) {
            writeLine(stdout, entry.label + ' (' + entry.principles.length + '): ' + entry.principles.join(', '));
          }
          if (grounding.provisional_claims.length) {
            writeLine(stdout, '');
            writeLine(stdout, 'Provisional claims:');
            for (const claim of grounding.provisional_claims) {
              writeLine(stdout, '  ' + claim.id + ' — ' + claim.limits);
            }
          }
        }
        return 0;
      }
      if (action === 'ground') {
        if (positional.length !== 1) throw argumentError('knowledge ground requires exactly one workflow id.');
        const grounding = knowledgeGroundingForWorkflow(positional[0]);
        if (json) {
          writeLine(stdout, JSON.stringify(grounding, null, 2));
        } else {
          writeLine(stdout, grounding.workflow + ' · ' + String(grounding.principle_count) +
            ' principles across ' + grounding.layer_span.join(' > '));
          for (const domain of grounding.domains) {
            writeLine(stdout, '  ' + domain.id.padEnd(22) + ' ' + domain.roots.join(', '));
          }
          if (grounding.governance.length) {
            writeLine(stdout, 'Governance: ' + grounding.governance.join(', '));
          }
        }
        return 0;
      }
      if (action === 'verify') {
        if (positional.length) throw argumentError('knowledge verify does not accept positional values.');
        const verification = verifyKnowledgeBase();
        if (json) {
          writeLine(stdout, JSON.stringify(verification, null, 2));
        } else {
          for (const finding of verification.findings) {
            writeLine(stdout, (finding.ok ? 'pass  ' : 'FAIL  ') + finding.check.padEnd(36) + finding.detail);
          }
          writeLine(stdout, (verification.ok ? 'ok' : 'failed') + ' · ' +
            String(verification.principle_count) + ' principles · ' +
            String(verification.layers.length) + ' layers');
        }
        return verification.ok ? 0 : 1;
      }
      throw argumentError(
        'knowledge action must be layers, list, show, derive, domain, ground, or verify.'
      );
    }
    if (command === 'analysis' || command === 'analyses') {
      const resource = args[0] ?? 'help';
      if (['help', '--help', '-h'].includes(resource)) {
        writeLine(stdout, ANALYSIS_USAGE);
        return 0;
      }
      if (resource === 'contract' || resource === 'contracts') {
        const action = args[1] ?? 'list';
        const rest = args.slice(2);
        if (action === 'list') {
          let chatId;
          let preregistrationId;
          let json = false;
          for (let index = 0; index < rest.length; index += 1) {
            const value = rest[index];
            if (value === '--chat') {
              chatId = takeValue(rest, index, value);
              index += 1;
            } else if (value === '--preregistration') {
              preregistrationId = takeValue(rest, index, value);
              index += 1;
            } else if (value === '--json') {
              json = true;
            } else {
              throw argumentError('Unknown analysis contract list option: ' + value);
            }
          }
          const contracts = listAnalysisContracts(cwd, { chatId, preregistrationId });
          if (json) {
            writeLine(stdout, JSON.stringify(contracts, null, 2));
          } else if (!contracts.length) {
            writeLine(stdout, 'No analysis contracts.');
          } else {
            writeLine(stdout,
              'ANALYSIS CONTRACT ID                     VERIFIED  PRIMARY  PREREGISTRATION');
            for (const contract of contracts) {
              writeLine(stdout,
                String(contract.analysis_contract_id).padEnd(40) + ' ' +
                String(contract.verified).padEnd(9) + ' ' +
                String(contract.counts?.primary ?? 0).padEnd(8) + ' ' +
                String(contract.preregistration_id ?? '-'));
            }
          }
          return 0;
        }
        if (action === 'show' || action === 'verify') {
          if (rest.length !== 1) {
            throw argumentError('analysis contract ' + action +
              ' requires exactly one contract ID.');
          }
          const result = action === 'show'
            ? getAnalysisContract(cwd, rest[0])
            : verifyAnalysisContract(cwd, rest[0]);
          writeLine(stdout, JSON.stringify(result, null, 2));
          return action === 'verify' && !result.ok ? 1 : 0;
        }
        if (action === 'create') {
          let chatId = null;
          const positional = [];
          for (let index = 0; index < rest.length; index += 1) {
            const value = rest[index];
            if (value === '--chat') {
              chatId = takeValue(rest, index, value);
              index += 1;
            } else if (value.startsWith('-')) {
              throw argumentError('Unknown analysis contract create option: ' + value);
            } else {
              positional.push(value);
            }
          }
          if (positional.length !== 1) {
            throw argumentError('analysis contract create requires exactly one JSON spec file.');
          }
          const project = path.resolve(cwd);
          const input = resolveInsideRoot(project, positional[0]);
          const relative = relativePortable(project, input);
          const stat = fs.lstatSync(input, { throwIfNoEntry: false });
          if (!stat?.isFile() || stat.isSymbolicLink() ||
              relative === '.sciencecode' || relative.startsWith('.sciencecode/')) {
            throw Object.assign(
              new Error('Analysis contract spec must be a regular project file outside .sciencecode.'),
              { code: 'INVALID_ANALYSIS_CONTRACT' }
            );
          }
          const projectReal = fs.realpathSync(project);
          const inputReal = fs.realpathSync(input);
          const realRelative = path.relative(projectReal, inputReal);
          if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
            throw Object.assign(
              new Error('Analysis contract spec escapes the project through a filesystem link.'),
              { code: 'INVALID_ANALYSIS_CONTRACT_PATH' }
            );
          }
          const created = createAnalysisContract({
            cwd,
            spec: readJson(inputReal),
            chatId
          });
          let interaction = null;
          let interactionError = null;
          if (created.manifest.chat_id) {
            try {
              interaction = recordInteraction({
                cwd,
                chatId: created.manifest.chat_id,
                surface: 'analysis',
                action: 'contract.frozen',
                artifact: analysisContractInteractionArtifact(created),
                payload: analysisContractInteractionPayload(created)
              });
            } catch (error) {
              interactionError = { code: error.code ?? 'INTERACTION_ERROR', message: error.message };
            }
          }
          writeLine(stdout, JSON.stringify({
            analysis_contract: getAnalysisContract(
              cwd,
              created.manifest.analysis_contract_id
            ),
            interaction,
            interaction_error: interactionError
          }, null, 2));
          return 0;
        }
        throw argumentError('analysis contract action must be create, list, show, or verify.');
      }
      if (resource === 'assess') {
        let chatId = null;
        let deviationNote = null;
        const positional = [];
        for (let index = 1; index < args.length; index += 1) {
          const value = args[index];
          if (value === '--chat') {
            chatId = takeValue(args, index, value);
            index += 1;
          } else if (value === '--deviation') {
            deviationNote = takeValue(args, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown analysis assess option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 2) {
          throw argumentError(
            'analysis assess requires an analysis contract ID and experiment ID.'
          );
        }
        const created = createConfirmatoryAssessment({
          cwd,
          contractId: positional[0],
          experimentId: positional[1],
          chatId,
          deviationNote
        });
        let interaction = null;
        let interactionError = null;
        if (created.manifest.chat_id) {
          try {
            interaction = recordInteraction({
              cwd,
              chatId: created.manifest.chat_id,
              surface: 'analysis',
              action: 'assessment.created',
              artifact: confirmatoryAssessmentInteractionArtifact(created),
              payload: confirmatoryAssessmentInteractionPayload(created)
            });
          } catch (error) {
            interactionError = { code: error.code ?? 'INTERACTION_ERROR', message: error.message };
          }
        }
        writeLine(stdout, JSON.stringify({
          assessment: getConfirmatoryAssessment(
            cwd,
            created.manifest.analysis_assessment_id
          ),
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (resource === 'assessment' || resource === 'assessments') {
        const action = args[1] ?? 'list';
        const rest = args.slice(2);
        if (action === 'list') {
          let json = false;
          let chatId;
          let contractId;
          let experimentId;
          for (let index = 0; index < rest.length; index += 1) {
            const value = rest[index];
            if (value === '--json') {
              json = true;
            } else if (value === '--chat') {
              chatId = takeValue(rest, index, value);
              index += 1;
            } else if (value === '--contract') {
              contractId = takeValue(rest, index, value);
              index += 1;
            } else if (value === '--experiment') {
              experimentId = takeValue(rest, index, value);
              index += 1;
            } else {
              throw argumentError('Unknown analysis assessment list option: ' + value);
            }
          }
          const assessments = listConfirmatoryAssessments(cwd, {
            chatId, contractId, experimentId
          });
          if (json) {
            writeLine(stdout, JSON.stringify(assessments, null, 2));
          } else if (!assessments.length) {
            writeLine(stdout, 'No confirmatory assessments.');
          } else {
            writeLine(stdout,
              'ASSESSMENT ID                            STATUS         REGISTRATION  CURRENT');
            for (const assessment of assessments) {
              writeLine(stdout,
                String(assessment.analysis_assessment_id).padEnd(40) + ' ' +
                String(assessment.status).padEnd(14) + ' ' +
                String(assessment.registration_status ?? '-').padEnd(13) + ' ' +
                String(assessment.current_for_pair));
            }
          }
          return 0;
        }
        if (action === 'show' || action === 'verify') {
          if (rest.length !== 1) {
            throw argumentError('analysis assessment ' + action +
              ' requires exactly one assessment ID.');
          }
          const result = action === 'show'
            ? getConfirmatoryAssessment(cwd, rest[0])
            : verifyConfirmatoryAssessment(cwd, rest[0]);
          writeLine(stdout, JSON.stringify(result, null, 2));
          return action === 'verify' && !result.ok ? 1 : 0;
        }
        throw argumentError('analysis assessment action must be list, show, or verify.');
      }
      throw argumentError('analysis resource must be contract, assess, or assessment.');
    }
    if (command === 'figure' || command === 'figures') {
      const action = args[0] ?? 'list';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, FIGURE_USAGE);
        return 0;
      }
      if (action === 'visual') {
        const visualAction = rest[0] ?? 'list';
        const visualArgs = rest.slice(1);
        if (['help', '--help', '-h'].includes(visualAction)) {
          writeLine(stdout, FIGURE_USAGE);
          return 0;
        }
        if (visualAction === 'register') {
          let chatId = null;
          const positional = [];
          for (let index = 0; index < visualArgs.length; index += 1) {
            const value = visualArgs[index];
            if (value === '--chat') {
              if (chatId !== null) {
                throw argumentError('Duplicate figure visual register option: --chat');
              }
              chatId = takeValue(visualArgs, index, value);
              index += 1;
            } else if (value.startsWith('-')) {
              throw argumentError('Unknown figure visual register option: ' + value);
            } else {
              positional.push(value);
            }
          }
          if (positional.length !== 1) {
            throw argumentError(
              'figure visual register requires exactly one JSON spec file.'
            );
          }
          const project = path.resolve(cwd);
          const input = resolveInsideRoot(project, positional[0]);
          const relative = relativePortable(project, input);
          const stat = fs.lstatSync(input, { throwIfNoEntry: false });
          if (!stat?.isFile() || stat.isSymbolicLink() ||
              relative === '.sciencecode' || relative.startsWith('.sciencecode/')) {
            throw Object.assign(
              new Error(
                'Figure visual spec must be a regular project file outside .sciencecode.'
              ),
              { code: 'INVALID_FIGURE_VISUAL' }
            );
          }
          if (stat.size > MAX_FIGURE_VISUAL_SPEC_BYTES) {
            throw Object.assign(
              new Error('Figure visual spec exceeds the bounded JSON size.'),
              { code: 'FIGURE_VISUAL_SPEC_TOO_LARGE' }
            );
          }
          const projectReal = fs.realpathSync(project);
          const inputReal = fs.realpathSync(input);
          const realRelative = path.relative(projectReal, inputReal);
          if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
            throw Object.assign(
              new Error('Figure visual spec escapes the project through a filesystem link.'),
              { code: 'INVALID_FIGURE_VISUAL_PATH' }
            );
          }
          const spec = normalizeFigureVisualSpec(readJson(inputReal));
          const visual = createFigureVisual({
            cwd,
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
                cwd,
                chatId: visual.manifest.chat_id,
                surface: 'figure',
                action: 'visual.created',
                artifact: figureVisualInteractionArtifact(visual),
                payload: figureVisualInteractionPayload(visual)
              });
            } catch (error) {
              interactionError = {
                code: error.code ?? 'INTERACTION_ERROR',
                message: error.message
              };
            }
          }
          writeLine(stdout, JSON.stringify({
            visual,
            interaction,
            interaction_error: interactionError
          }, null, 2));
          return 0;
        }
        if (visualAction === 'list') {
          let chatId;
          let figureRegistrationId;
          let status;
          let json = false;
          const seen = new Set();
          for (let index = 0; index < visualArgs.length; index += 1) {
            const value = visualArgs[index];
            if (seen.has(value)) {
              throw argumentError('Duplicate figure visual list option: ' + value);
            }
            if (value === '--chat') {
              seen.add(value);
              chatId = takeValue(visualArgs, index, value);
              index += 1;
            } else if (value === '--registration') {
              seen.add(value);
              figureRegistrationId = takeValue(visualArgs, index, value);
              index += 1;
            } else if (value === '--status') {
              seen.add(value);
              status = takeValue(visualArgs, index, value);
              if (!['pass', 'fail'].includes(status)) {
                throw argumentError('--status must be pass or fail.');
              }
              index += 1;
            } else if (value === '--json') {
              seen.add(value);
              json = true;
            } else {
              throw argumentError('Unknown figure visual list option: ' + value);
            }
          }
          const visuals = listFigureVisuals(cwd, {
            chatId,
            figureRegistrationId,
            status
          });
          if (json) {
            writeLine(stdout, JSON.stringify(visuals, null, 2));
          } else if (!visuals.length) {
            writeLine(stdout, 'No figure visual validations.');
          } else {
            writeLine(stdout,
              'FIGURE VISUAL ID                         STATUS   VISUAL          VERIFIED  CHECKS');
            for (const visual of visuals) {
              writeLine(stdout,
                String(visual.figure_visual_id).padEnd(40) + ' ' +
                String(visual.status).padEnd(8) + ' ' +
                String(visual.visual_status).padEnd(15) + ' ' +
                String(visual.verified).padEnd(9) + ' ' +
                String(visual.summary?.passed_checks ?? '-') + '/' +
                String((visual.summary?.passed_checks ?? 0) +
                  (visual.summary?.failed_checks ?? 0)));
            }
          }
          return 0;
        }
        if (visualAction === 'show' || visualAction === 'verify') {
          if (visualArgs.length !== 1) {
            throw argumentError('figure visual ' + visualAction +
              ' requires exactly one figure visual ID.');
          }
          const result = visualAction === 'show'
            ? getFigureVisual(cwd, visualArgs[0])
            : verifyFigureVisual(cwd, visualArgs[0]);
          writeLine(stdout, JSON.stringify(result, null, 2));
          return visualAction === 'verify' && !result.ok ? 1 : 0;
        }
        throw argumentError(
          'figure visual action must be register, list, show, or verify.'
        );
      }
      if (action === 'semantic') {
        const semanticAction = rest[0] ?? 'list';
        const semanticArgs = rest.slice(1);
        if (['help', '--help', '-h'].includes(semanticAction)) {
          writeLine(stdout, FIGURE_USAGE);
          return 0;
        }
        if (semanticAction === 'sidecar') {
          let outputFile = null;
          const positional = [];
          for (let index = 0; index < semanticArgs.length; index += 1) {
            const value = semanticArgs[index];
            if (value === '--output') {
              if (outputFile !== null) {
                throw argumentError('Duplicate figure semantic sidecar option: --output');
              }
              outputFile = takeValue(semanticArgs, index, value);
              index += 1;
            } else if (value.startsWith('-')) {
              throw argumentError('Unknown figure semantic sidecar option: ' + value);
            } else {
              positional.push(value);
            }
          }
          if (positional.length !== 3) {
            throw argumentError(
              'figure semantic sidecar requires CONTRACT.json, FIGURE.png, and DATA.csv or DATA.tsv.'
            );
          }
          const contractFile = resolveInsideRoot(cwd, positional[0]);
          const contractStat = fs.lstatSync(contractFile, { throwIfNoEntry: false });
          if (!contractStat?.isFile() || contractStat.isSymbolicLink()) {
            throw argumentError('Figure semantic contract must be a regular project JSON file.');
          }
          const projectReal = fs.realpathSync(path.resolve(cwd));
          const contractReal = fs.realpathSync(contractFile);
          const contractRelative = path.relative(projectReal, contractReal);
          if (contractRelative.startsWith('..') || path.isAbsolute(contractRelative)) {
            throw Object.assign(
              new Error(
                'Figure semantic contract escapes the project through a filesystem link.'
              ),
              { code: 'INVALID_FIGURE_REGISTRATION_PATH' }
            );
          }
          const sidecar = createFigureSemanticSidecarFile({
            cwd,
            contract: readJson(contractReal),
            figureFile: positional[1],
            sourceFile: positional[2],
            outputFile
          });
          writeLine(stdout, JSON.stringify({
            output_file: outputFile
              ? relativePortable(cwd, resolveInsideRoot(cwd, outputFile))
              : null,
            sidecar
          }, null, 2));
          return 0;
        }
        if (semanticAction === 'register') {
          let chatId = null;
          const positional = [];
          for (let index = 0; index < semanticArgs.length; index += 1) {
            const value = semanticArgs[index];
            if (value === '--chat') {
              if (chatId !== null) {
                throw argumentError('Duplicate figure semantic register option: --chat');
              }
              chatId = takeValue(semanticArgs, index, value);
              index += 1;
            } else if (value.startsWith('-')) {
              throw argumentError('Unknown figure semantic register option: ' + value);
            } else {
              positional.push(value);
            }
          }
          if (positional.length !== 1) {
            throw argumentError(
              'figure semantic register requires exactly one JSON spec file.'
            );
          }
          const project = path.resolve(cwd);
          const input = resolveInsideRoot(project, positional[0]);
          const relative = relativePortable(project, input);
          const stat = fs.lstatSync(input, { throwIfNoEntry: false });
          if (!stat?.isFile() || stat.isSymbolicLink() ||
              relative === '.sciencecode' || relative.startsWith('.sciencecode/')) {
            throw Object.assign(
              new Error(
                'Figure registration spec must be a regular project file outside .sciencecode.'
              ),
              { code: 'INVALID_FIGURE_REGISTRATION' }
            );
          }
          const projectReal = fs.realpathSync(project);
          const inputReal = fs.realpathSync(input);
          const realRelative = path.relative(projectReal, inputReal);
          if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
            throw Object.assign(
              new Error('Figure registration spec escapes the project through a filesystem link.'),
              { code: 'INVALID_FIGURE_REGISTRATION_PATH' }
            );
          }
          const spec = normalizeFigureRegistrationSpec(readJson(inputReal));
          const registration = createFigureRegistration({
            cwd,
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
                cwd,
                chatId: registration.manifest.chat_id,
                surface: 'figure',
                action: 'registration.created',
                artifact: figureRegistrationInteractionArtifact(registration),
                payload: figureRegistrationInteractionPayload(registration)
              });
            } catch (error) {
              interactionError = {
                code: error.code ?? 'INTERACTION_ERROR',
                message: error.message
              };
            }
          }
          writeLine(stdout, JSON.stringify({
            registration,
            interaction,
            interaction_error: interactionError
          }, null, 2));
          return 0;
        }
        if (semanticAction === 'list') {
          let chatId;
          let figureUrl;
          let sourceUrl;
          let status;
          let json = false;
          const seen = new Set();
          for (let index = 0; index < semanticArgs.length; index += 1) {
            const value = semanticArgs[index];
            if (seen.has(value)) {
              throw argumentError('Duplicate figure semantic list option: ' + value);
            }
            if (value === '--chat') {
              seen.add(value);
              chatId = takeValue(semanticArgs, index, value);
              index += 1;
            } else if (value === '--figure') {
              seen.add(value);
              figureUrl = takeValue(semanticArgs, index, value);
              index += 1;
            } else if (value === '--source') {
              seen.add(value);
              sourceUrl = takeValue(semanticArgs, index, value);
              index += 1;
            } else if (value === '--status') {
              seen.add(value);
              status = takeValue(semanticArgs, index, value);
              if (!['pass', 'fail'].includes(status)) {
                throw argumentError('--status must be pass or fail.');
              }
              index += 1;
            } else if (value === '--json') {
              seen.add(value);
              json = true;
            } else {
              throw argumentError('Unknown figure semantic list option: ' + value);
            }
          }
          const registrations = listFigureRegistrations(cwd, {
            chatId,
            figureUrl,
            sourceUrl,
            status
          });
          if (json) {
            writeLine(stdout, JSON.stringify(registrations, null, 2));
          } else if (!registrations.length) {
            writeLine(stdout, 'No semantic figure registrations.');
          } else {
            writeLine(stdout,
              'FIGURE REGISTRATION ID                   STATUS   BINDING    VERIFIED  POINTS  SERIES');
            for (const registration of registrations) {
              writeLine(stdout,
                String(registration.figure_registration_id).padEnd(40) + ' ' +
                String(registration.status).padEnd(8) + ' ' +
                String(registration.registration_status).padEnd(10) + ' ' +
                String(registration.verified).padEnd(9) + ' ' +
                String(registration.summary?.plotted_points ?? '-').padEnd(7) + ' ' +
                String(registration.summary?.series ?? '-'));
            }
          }
          return 0;
        }
        if (semanticAction === 'show' || semanticAction === 'verify') {
          if (semanticArgs.length !== 1) {
            throw argumentError('figure semantic ' + semanticAction +
              ' requires exactly one figure registration ID.');
          }
          const result = semanticAction === 'show'
            ? getFigureRegistration(cwd, semanticArgs[0])
            : verifyFigureRegistration(cwd, semanticArgs[0]);
          writeLine(stdout, JSON.stringify(result, null, 2));
          return semanticAction === 'verify' && !result.ok ? 1 : 0;
        }
        throw argumentError(
          'figure semantic action must be sidecar, register, list, show, or verify.'
        );
      }
      if (action === 'list') {
        let chatId;
        let baselineUrl;
        let candidateUrl;
        let json = false;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--baseline') {
            baselineUrl = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--candidate') {
            candidateUrl = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--json') {
            json = true;
          } else {
            throw argumentError('Unknown figure list option: ' + value);
          }
        }
        const comparisons = listFigureComparisons(cwd, {
          chatId, baselineUrl, candidateUrl
        });
        if (json) {
          writeLine(stdout, JSON.stringify(comparisons, null, 2));
        } else if (!comparisons.length) {
          writeLine(stdout, 'No figure comparisons.');
        } else {
          writeLine(stdout,
            'FIGURE COMPARISON ID                     STATUS   OUTCOME                 VERIFIED  CHANGED     SSIM');
          for (const comparison of comparisons) {
            const changed = comparison.summary?.tolerance_exceeding_fraction;
            const structural = comparison.summary?.structural_similarity;
            writeLine(stdout,
              String(comparison.figure_comparison_id).padEnd(40) + ' ' +
              String(comparison.status).padEnd(8) + ' ' +
              String(comparison.reproduction_status).padEnd(23) + ' ' +
              String(comparison.verified).padEnd(9) + ' ' +
              (Number.isFinite(changed)
                ? (changed * 100).toFixed(4) + '%' : '-').padEnd(11) + ' ' +
              (Number.isFinite(structural) ? structural.toFixed(6) : '-'));
          }
        }
        return 0;
      }
      if (action === 'show' || action === 'verify') {
        if (rest.length !== 1) {
          throw argumentError('figure ' + action +
            ' requires exactly one figure comparison ID.');
        }
        const result = action === 'show'
          ? getFigureComparison(cwd, rest[0])
          : verifyFigureComparison(cwd, rest[0]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return action === 'verify' && !result.ok ? 1 : 0;
      }
      if (action === 'compare') {
        let chatId;
        let name;
        let note;
        let pixelTolerance;
        let maximumChangedFraction;
        let minimumStructuralSimilarity;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--name') {
            name = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--pixel-tolerance') {
            pixelTolerance = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--max-changed-fraction') {
            maximumChangedFraction = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--min-structural-similarity') {
            minimumStructuralSimilarity = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown figure compare option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 2) {
          throw argumentError('figure compare requires BASELINE and CANDIDATE selectors.');
        }
        const comparison = createFigureComparison({
          cwd,
          chatId,
          baseline: figureSourceSelector(positional[0]),
          candidate: figureSourceSelector(positional[1]),
          name,
          note,
          pixelTolerance,
          maximumChangedFraction,
          minimumStructuralSimilarity
        });
        let interaction = null;
        let interactionError = null;
        if (comparison.manifest.chat_id) {
          try {
            interaction = recordInteraction({
              cwd,
              chatId: comparison.manifest.chat_id,
              surface: 'figure',
              action: 'comparison.created',
              artifact: figureComparisonInteractionArtifact(comparison),
              payload: figureComparisonInteractionPayload(comparison)
            });
          } catch (error) {
            interactionError = {
              code: error.code ?? 'INTERACTION_ERROR',
              message: error.message
            };
          }
        }
        writeLine(stdout, JSON.stringify({
          comparison,
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      throw argumentError('figure action must be compare, list, show, or verify.');
    }
    if (command === 'review' || command === 'reviews') {
      const action = args[0] ?? 'list';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, REVIEW_USAGE);
        return 0;
      }
      if (action === 'list') {
        let chatId;
        let targetUrl;
        let json = false;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--target') {
            targetUrl = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--json') {
            json = true;
          } else {
            throw argumentError('Unknown review list option: ' + value);
          }
        }
        const reviews = listSemanticReviews(cwd, { chatId, targetUrl });
        if (json) {
          writeLine(stdout, JSON.stringify(reviews, null, 2));
        } else if (!reviews.length) {
          writeLine(stdout, 'No semantic reviews.');
        } else {
          writeLine(stdout, 'REVIEW ID                                STATUS   CURRENT  VERIFIED  CLAIMS  FINDINGS  TARGET');
          for (const review of reviews) {
            writeLine(stdout,
              String(review.review_id).padEnd(40) + ' ' +
              String(review.status).padEnd(8) + ' ' +
              String(review.current_for_target).padEnd(8) + ' ' +
              String(review.verified).padEnd(9) + ' ' +
              String(review.counts?.claims ?? 0).padEnd(7) + ' ' +
              String(review.counts?.findings ?? 0).padEnd(9) + ' ' +
              String(review.target?.name ?? '-'));
          }
        }
        return 0;
      }
      if (action === 'show' || action === 'verify') {
        if (rest.length !== 1) {
          throw argumentError('review ' + action + ' requires exactly one review ID.');
        }
        const result = action === 'show'
          ? getSemanticReview(cwd, rest[0])
          : verifySemanticReview(cwd, rest[0]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return action === 'verify' && !result.ok ? 1 : 0;
      }
      if (action === 'run') {
        let chatId;
        let revisionId;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--revision') {
            revisionId = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown review run option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (!chatId || (revisionId ? positional.length !== 0 : positional.length !== 1)) {
          throw argumentError(
            'review run requires ARTIFACT_URL --chat CHAT_ID or --revision REVISION_ID --chat CHAT_ID.'
          );
        }
        const review = createSemanticReview({
          cwd,
          chatId,
          source: positional.length ? { url: positional[0] } : undefined,
          revisionId
        });
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId,
            surface: 'review',
            action: 'semantic-review.created',
            artifact: semanticReviewInteractionArtifact(review),
            payload: semanticReviewInteractionPayload(review)
          });
        } catch (error) {
          interactionError = { code: error.code ?? 'INTERACTION_ERROR', message: error.message };
        }
        writeLine(stdout, JSON.stringify({ review, interaction, interaction_error: interactionError }, null, 2));
        return 0;
      }
      throw argumentError('review action must be list, run, show, or verify.');
    }
    if (command === 'revision' || command === 'revisions') {
      const action = args[0] ?? 'list';
      const rest = args.slice(1);
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, REVISION_USAGE);
        return 0;
      }
      if (action === 'list') {
        let chatId;
        let sourceUrl;
        let json = false;
        for (let index = 0; index < rest.length; index += 1) {
          if (rest[index] === '--chat') {
            chatId = takeValue(rest, index, '--chat');
            index += 1;
          } else if (rest[index] === '--source') {
            sourceUrl = takeValue(rest, index, '--source');
            index += 1;
          } else if (rest[index] === '--json') {
            json = true;
          } else {
            throw argumentError('Unknown revision list option: ' + rest[index]);
          }
        }
        const revisions = listArtifactRevisions(cwd, { chatId, sourceUrl });
        if (json) {
          writeLine(stdout, JSON.stringify(revisions, null, 2));
        } else if (!revisions.length) {
          writeLine(stdout, 'No artifact revisions.');
        } else {
          writeLine(stdout, 'REVISION ID                              STATUS     VERIFIED  ARTIFACT');
          for (const revision of revisions) {
            writeLine(stdout,
              String(revision.revision_id).padEnd(40) + ' ' +
              String(revision.status).padEnd(10) + ' ' +
              String(revision.verified).padEnd(9) + ' ' +
              String(revision.name ?? '-'));
          }
        }
        return 0;
      }
      if (action === 'show' || action === 'verify') {
        if (rest.length !== 1) {
          throw argumentError('revision ' + action + ' requires exactly one revision ID.');
        }
        const result = action === 'show'
          ? getArtifactRevision(cwd, rest[0])
          : verifyArtifactRevision(cwd, rest[0]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return action === 'verify' && !result.ok ? 1 : 0;
      }
      if (action === 'create') {
        let chatId;
        let name;
        let note;
        let previousRevisionId;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--name') {
            name = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--previous') {
            previousRevisionId = takeValue(rest, index, value);
            index += 1;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown revision create option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 2 || !chatId) {
          throw argumentError('revision create requires ARTIFACT_URL FILE --chat CHAT_ID.');
        }
        const project = path.resolve(cwd);
        const input = resolveInsideRoot(project, positional[1]);
        const inputRelative = relativePortable(project, input);
        const stat = fs.lstatSync(input, { throwIfNoEntry: false });
        if (!stat?.isFile() || stat.isSymbolicLink() || inputRelative === '.sciencecode' ||
            inputRelative.startsWith('.sciencecode/')) {
          throw Object.assign(new Error('Revision input must be a regular project file outside .sciencecode.'), {
            code: 'INVALID_REVISION'
          });
        }
        const projectReal = fs.realpathSync(project);
        const inputReal = fs.realpathSync(input);
        const realRelative = path.relative(projectReal, inputReal);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
          throw Object.assign(new Error('Revision input escapes the project through a filesystem link.'), {
            code: 'INVALID_REVISION'
          });
        }
        const created = createArtifactRevision({
          cwd,
          chatId,
          source: { url: positional[0] },
          content: fs.readFileSync(inputReal),
          name: name ?? path.basename(inputReal),
          note,
          previousRevisionId
        });
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId,
            surface: 'artifact',
            action: 'revision.proposed',
            artifact: revisionInteractionArtifact(created),
            payload: revisionInteractionPayload(created, { status: 'proposed', note: created.note })
          });
        } catch (error) {
          interactionError = { code: error.code ?? 'INTERACTION_ERROR', message: error.message };
        }
        writeLine(stdout, JSON.stringify({
          revision: getArtifactRevision(cwd, created.revision_id),
          interaction,
          interaction_error: interactionError
        }, null, 2));
        return 0;
      }
      if (action === 'decide') {
        const revisionId = rest[0];
        if (!revisionId || revisionId.startsWith('-')) {
          throw argumentError('revision decide requires a revision ID.');
        }
        let chatId;
        let decision;
        let note;
        for (let index = 1; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--chat') {
            chatId = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--decision') {
            decision = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--note') {
            note = takeValue(rest, index, value);
            index += 1;
          } else {
            throw argumentError('Unknown revision decide option: ' + value);
          }
        }
        if (!chatId || !decision) {
          throw argumentError('revision decide requires --chat CHAT_ID and --decision accepted|rejected.');
        }
        const decided = decideArtifactRevision({ cwd, revisionId, chatId, decision, note });
        const detail = getArtifactRevision(cwd, revisionId);
        let interaction = null;
        let interactionError = null;
        try {
          interaction = recordInteraction({
            cwd,
            chatId,
            surface: 'artifact',
            action: 'revision.' + decided.decision,
            artifact: revisionInteractionArtifact(detail),
            payload: revisionInteractionPayload(detail, {
              status: decided.decision, note: decided.note
            })
          });
        } catch (error) {
          interactionError = { code: error.code ?? 'INTERACTION_ERROR', message: error.message };
        }
        writeLine(stdout, JSON.stringify({ revision: detail, decision: decided,
          interaction, interaction_error: interactionError }, null, 2));
        return 0;
      }
      throw argumentError('revision action must be list, create, show, verify, or decide.');
    }
    if (command === 'lab') {
      let host = '127.0.0.1';
      let port = 4311;
      for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--host') {
          host = takeValue(args, index, '--host');
          index += 1;
        } else if (args[index] === '--port') {
          port = Number(takeValue(args, index, '--port'));
          if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw argumentError('--port must be an integer from 0 through 65535.');
          }
          index += 1;
        } else {
          throw argumentError('Unknown lab option: ' + args[index]);
        }
      }
      const launched = startLab({
        cwd,
        packageRoot: root,
        env,
        host,
        port
      });
      launched.ready.then((details) => {
        writeLine(stdout, 'ScienceCode Lab: ' + details.url);
        writeLine(stdout, 'Project: ' + details.project);
        launched.server.on('error', (error) => {
          writeLine(stderr, 'ScienceCode Lab: ' + error.message);
          process.exitCode = 1;
        });
      }).catch((error) => {
        writeLine(stderr, 'ScienceCode Lab: ' + error.message);
        process.exitCode = 1;
      });
      return 0;
    }
    if (command === 'compute') {
      const action = args[0] ?? 'status';
      if (action === 'status') {
        onlyFlags(args.slice(1), ['--json']);
        const result = computeStatus({ env });
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(result, null, 2));
        } else {
          const device = result.gpu.devices[0];
          writeLine(
            stdout,
            device
              ? 'GPU: ' + device.name + ' (' + device.memory_total_mib + ' MiB, driver ' + device.driver_version + ')'
              : 'GPU: unavailable (' + (result.gpu.error ?? 'not detected') + ')'
          );
          const gpuProbe = result.runtimes.gpu.probe;
          writeLine(
            stdout,
            result.runtimes.gpu.healthy
              ? 'GPU runtime: ready (Python ' + gpuProbe.python + ', PyTorch ' + gpuProbe.torch.version +
                ', CUDA ' + gpuProbe.torch.cuda_runtime + ')'
              : 'GPU runtime: unavailable (' + (result.runtimes.gpu.error ?? 'not installed') + ')'
          );
          writeLine(stdout, 'GPU runtime path: ' + result.runtimes.gpu.paths.runtime);
          const npuDevice = result.npu.devices?.[0];
          writeLine(
            stdout,
            npuDevice
              ? 'NPU: ' + npuDevice.name + ' (driver ' + (npuDevice.driver_version || 'unknown') + ')'
              : 'NPU: unavailable (' + (result.npu.error ?? 'not detected') + ')'
          );
          const npuProvider = result.npu.execution_provider;
          writeLine(
            stdout,
            'NPU provider: ' + npuProvider.name + ' (' +
              (npuProvider.package_present ? 'Windows package present' : 'package not present') + ')'
          );
          const providerProbe = result.runtimes.npu.probe;
          writeLine(
            stdout,
            result.runtimes.npu.healthy
              ? 'NPU runtime: ready (Python ' + providerProbe.python + ', ONNX Runtime ' +
                providerProbe.onnxruntime_version + ', provider registered)'
              : 'NPU runtime: unavailable (' + (result.runtimes.npu.error ?? 'not installed') + ')'
          );
          writeLine(stdout, 'NPU runtime path: ' + result.runtimes.npu.paths.runtime);
          const cadProbe = result.runtimes.cad.probe;
          writeLine(
            stdout,
            result.runtimes.cad.healthy
              ? 'CAD runtime: ready (Python ' + cadProbe.python + ', CadQuery ' +
                cadProbe.cadquery_version + ', OCP ' + cadProbe.cadquery_ocp_version + ')'
              : 'CAD runtime: unavailable (' + (result.runtimes.cad.error ?? 'not installed') + ')'
          );
          writeLine(stdout, 'CAD runtime path: ' + result.runtimes.cad.paths.runtime);
        }
        return result.ok ? 0 : 1;
      }
      if (action === 'setup') {
        let profile = 'gpu';
        let refresh = false;
        const rest = args.slice(1);
        for (let index = 0; index < rest.length; index += 1) {
          if (rest[index] === '--profile') {
            profile = takeValue(rest, index, '--profile');
            index += 1;
          } else if (rest[index] === '--refresh') {
            refresh = true;
          } else {
            throw argumentError('Unknown compute setup option: ' + rest[index]);
          }
        }
        if (!['gpu', 'npu', 'cad', 'all'].includes(profile)) {
          throw argumentError('Compute profile must be gpu, npu, cad, or all.');
        }
        const setupOptions = {
          packageRoot: root,
          env,
          refresh,
          inheritOutput: stdout === process.stdout && stderr === process.stderr
        };
        const results = {};
        if (profile === 'gpu' || profile === 'all') {
          writeLine(stdout,
            'Creating the isolated ScienceCode GPU runtime. Existing Python environments are not modified.');
          results.gpu = setupComputeRuntime(setupOptions);
        }
        if (profile === 'npu' || profile === 'all') {
          writeLine(stdout,
            'Creating the isolated ScienceCode Windows ML NPU runtime. Existing Python environments are not modified.');
          results.npu = setupNpuRuntime(setupOptions);
        }
        if (profile === 'cad' || profile === 'all') {
          writeLine(stdout,
            'Creating the isolated ScienceCode CadQuery runtime. Existing Python environments are not modified.');
          results.cad = setupCadRuntime(setupOptions);
        }
        const result = profile === 'all' ? {
          ok: Object.values(results).every((item) => item.ok),
          profiles: results
        } : results[profile];
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      throw argumentError('compute action must be "status" or "setup".');
    }
    if (command === 'init') {
      onlyFlags(args, []);
      const initialized = safeInit(cwd);
      appendAudit(cwd, { type: 'project.initialized', ...initialized });
      writeLine(stdout, JSON.stringify({ ok: true, ...initialized }, null, 2));
      return 0;
    }
    if (command === 'kernel') {
      const action = args[0] ?? 'status';
      if (action === 'help' || action === '--help' || action === '-h') {
        writeLine(stdout, KERNEL_USAGE);
        return 0;
      }
      if (action === 'status') {
        const rest = args.slice(1);
        onlyFlags(rest.filter((value) => value.startsWith('-')), ['--json']);
        const languages = rest.filter((value) => !value.startsWith('-'));
        if (languages.length > 1) throw argumentError('kernel status accepts at most one language.');
        const manager = createKernelManager({ cwd, env });
        const statuses = languages.length ? [manager.status(languages[0])] : manager.listStatus();
        if (rest.includes('--json')) {
          writeLine(stdout, JSON.stringify(statuses, null, 2));
        } else {
          writeLine(stdout, 'LANGUAGE  RUNTIME    RECORDS  LIVE  STATE       VERSION');
          for (const status of statuses) {
            writeLine(stdout,
              String(status.language).padEnd(9) + ' ' +
              String(status.available ? 'available' : 'missing').padEnd(10) + ' ' +
              String(status.recorded_execution_count).padEnd(8) + ' ' +
              String(status.live).padEnd(5) + ' ' +
              String(status.state_mode).padEnd(11) + ' ' +
              String(status.language_version ?? '-'));
          }
        }
        return statuses.every((status) => status.available) ? 0 : 1;
      }
      if (action === 'list') {
        onlyFlags(args.slice(1), ['--json']);
        const records = listKernels(cwd);
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(records, null, 2));
        } else if (!records.length) {
          writeLine(stdout, 'No recorded project kernels.');
        } else {
          writeLine(stdout, 'KERNEL         LANGUAGE  CELLS  FAILED  VERIFIED  UPDATED');
          for (const record of records) {
            writeLine(stdout,
              String(record.kernel_id).padEnd(14) + ' ' +
              String(record.language).padEnd(9) + ' ' +
              String(record.execution_count).padEnd(6) + ' ' +
              String(record.failed_cells).padEnd(7) + ' ' +
              String(record.verified).padEnd(9) + ' ' +
              String(record.updated_at ?? '-'));
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (args.length < 2 || args.length > 3) {
          throw argumentError('kernel show requires a language and optional cell ID.');
        }
        const value = args[2]
          ? getKernelCell(cwd, args[1], args[2])
          : getKernelRecord(cwd, args[1]);
        writeLine(stdout, JSON.stringify(value, null, 2));
        return 0;
      }
      if (action === 'verify') {
        if (args.length !== 2) throw argumentError('kernel verify requires exactly one language.');
        const result = verifyKernel(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      if (action === 'exec') {
        const rest = args.slice(1);
        let language = null;
        let source = null;
        let mode = 'require';
        let timeoutMs = 120_000;
        let chatId = null;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--restore') {
            if (mode === 'fresh') throw argumentError('--restore and --fresh cannot be combined.');
            mode = 'restore';
          } else if (value === '--fresh') {
            if (mode === 'restore') throw argumentError('--restore and --fresh cannot be combined.');
            mode = 'fresh';
          } else if (value === '--timeout') {
            const seconds = Number(takeValue(rest, index, '--timeout'));
            if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
              throw argumentError('--timeout must be an integer from 1 through 3600 seconds.');
            }
            timeoutMs = seconds * 1000;
            index += 1;
          } else if (value === '--chat') {
            chatId = takeValue(rest, index, '--chat');
            index += 1;
          } else if (value === '--help' || value === '-h') {
            writeLine(stdout, KERNEL_USAGE);
            return 0;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown kernel exec option: ' + value);
          } else if (language === null) {
            language = value;
          } else if (source === null) {
            source = value;
          } else {
            throw argumentError('kernel exec accepts exactly one language and source file.');
          }
        }
        if (!language || !source) throw argumentError('kernel exec requires a language and source file.');
        resolveInsideRoot(cwd, source);
        const request = Buffer.from(JSON.stringify({
          cwd: path.resolve(cwd),
          language,
          source,
          mode,
          timeout_ms: timeoutMs,
          chat_id: chatId
        }), 'utf8').toString('base64url');
        const worker = path.join(root, 'lib', 'kernel-cli-worker.js');
        const result = runCommandSync(process.execPath, [worker, request], {
          cwd,
          env,
          timeout: timeoutMs + 180_000
        });
        writeBlock(stdout, result.stdout);
        writeBlock(stderr, result.stderr);
        if (result.error) {
          writeLine(stderr, 'ScienceCode kernel worker failed: ' + result.error.message);
          return result.error.code === 'ENOENT' ? 127 : 1;
        }
        return result.status ?? 1;
      }
      throw argumentError('kernel action must be "status", "list", "exec", "show", or "verify".');
    }
    if (command === 'evidence') {
      const action = args[0] ?? 'list';
      if (action === 'help' || action === '--help' || action === '-h') {
        writeLine(stdout, EVIDENCE_USAGE);
        return 0;
      }
      if (action === 'add') {
        const rest = args.slice(1);
        let source = null;
        const options = { authors: [] };
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--title') {
            options.title = takeValue(rest, index, '--title');
            index += 1;
          } else if (value === '--doi') {
            options.doi = takeValue(rest, index, '--doi');
            index += 1;
          } else if (value === '--author') {
            options.authors.push(takeValue(rest, index, '--author'));
            index += 1;
          } else if (value === '--year') {
            options.year = takeValue(rest, index, '--year');
            index += 1;
          } else if (value === '--help' || value === '-h') {
            writeLine(stdout, EVIDENCE_USAGE);
            return 0;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown evidence add option: ' + value);
          } else if (source === null) {
            source = value;
          } else {
            throw argumentError('evidence add accepts exactly one source file.');
          }
        }
        if (!source) throw argumentError('evidence add requires a source file.');
        const result = ingestEvidence({ cwd, source, ...options });
        writeLine(stdout, JSON.stringify({
          evidence_id: result.manifest.evidence_id,
          manifest_sha256: result.manifest_sha256,
          title: result.manifest.bibliography.title,
          kind: result.manifest.kind,
          counts: result.manifest.counts,
          directory: result.directory
        }, null, 2));
        return 0;
      }
      if (action === 'list') {
        onlyFlags(args.slice(1), ['--json']);
        const records = listEvidence(cwd);
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(records, null, 2));
        } else if (!records.length) {
          writeLine(stdout, 'No evidence records.');
        } else {
          writeLine(stdout, 'EVIDENCE ID                     TYPE   PAGES  VERIFIED  TITLE');
          for (const record of records) {
            writeLine(stdout,
              record.evidence_id.padEnd(31) + ' ' +
              String(record.kind ?? '-').padEnd(6) + ' ' +
              String(record.pages ?? 0).padEnd(6) + ' ' +
              String(Boolean(record.verified)).padEnd(9) + ' ' +
              String(record.title ?? '-'));
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (args.length !== 2) throw argumentError('evidence show requires exactly one evidence ID.');
        writeLine(stdout, JSON.stringify(getEvidenceRecord(cwd, args[1]), null, 2));
        return 0;
      }
      if (action === 'verify') {
        if (args.length !== 2) throw argumentError('evidence verify requires exactly one evidence ID.');
        const result = verifyEvidence(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      if (action === 'search') {
        const rest = args.slice(1);
        const words = [];
        let limit;
        let json = false;
        for (let index = 0; index < rest.length; index += 1) {
          if (rest[index] === '--limit') {
            limit = takeValue(rest, index, '--limit');
            index += 1;
          } else if (rest[index] === '--json') {
            json = true;
          } else if (rest[index].startsWith('-')) {
            throw argumentError('Unknown evidence search option: ' + rest[index]);
          } else {
            words.push(rest[index]);
          }
        }
        const result = searchEvidence(cwd, words.join(' '), { limit });
        if (json) {
          writeLine(stdout, JSON.stringify(result, null, 2));
        } else if (!result.results.length) {
          writeLine(stdout, 'No matching evidence spans.');
        } else {
          for (const match of result.results) {
            writeLine(stdout, '[' + match.rank + '] ' + match.title + ' · page ' + match.page + ' · ' + match.evidence_id);
            writeLine(stdout, match.text.replace(/\s+/g, ' ').slice(0, 360));
          }
        }
        return 0;
      }
      throw argumentError('evidence action must be "add", "list", "show", "search", or "verify".');
    }
    if (command === 'potency') {
      const action = args[0] ?? 'help';
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, POTENCY_USAGE);
        return 0;
      }
      if (action !== 'fit') {
        throw argumentError('potency action must be "fit".');
      }
      const rest = args.slice(1);
      let doses = null;
      let responses = null;
      let model = 'four_parameter_logistic';
      let bottom = null;
      let level = 0.95;
      let unit = null;
      for (let index = 0; index < rest.length; index += 1) {
        const value = rest[index];
        if (value === '--concentrations') {
          doses = numberList(takeValue(rest, index, value), 'Concentration');
          index += 1;
        } else if (value === '--responses') {
          responses = numberList(takeValue(rest, index, value), 'Response');
          index += 1;
        } else if (value === '--model') {
          model = takeValue(rest, index, value);
          index += 1;
        } else if (value === '--bottom') {
          bottom = Number(takeValue(rest, index, value));
          index += 1;
        } else if (value === '--level') {
          level = Number(takeValue(rest, index, value));
          index += 1;
        } else if (value === '--unit') {
          unit = takeValue(rest, index, value);
          index += 1;
        } else {
          throw argumentError('Unknown potency fit option: ' + value);
        }
      }
      if (!doses || !responses) {
        throw argumentError('potency fit requires --concentrations and --responses.');
      }
      if (bottom !== null && model !== 'three_parameter_logistic') {
        throw argumentError(
          '--bottom fixes the lower plateau and applies only to ' +
          '--model three_parameter_logistic; the four-parameter model fits it.'
        );
      }
      if (unit) {
        // Validate the unit against the bounded registry so a potency is never
        // reported in a unit the project cannot convert or freeze.
        convertQuantity({ value: 1, unit }, unit, 'Concentration unit');
      }
      const fit = doseResponseFit({
        concentrations: doses,
        responses,
        model,
        bottom,
        confidenceLevel: level
      });
      const notes = [
        'Potency is relative to this assay format and readout: it is ' +
        'neither an affinity nor a dose.',
        'Curve fitting assumes independent observations and constant variance ' +
        'across the concentration range.'
      ];
      if (fit.plateaus_observed === false) {
        const which = !fit.lower_plateau_observed && !fit.upper_plateau_observed
          ? 'Neither plateau was'
          : !fit.lower_plateau_observed ? 'The lower plateau was' : 'The upper plateau was';
        notes.unshift(which + ' NOT reached by the concentrations tested, so the ' +
          'fitted curve assumes an asymptote the assay never measured. A high ' +
          'r-squared does not make that potency reliable.');
      }
      if (fit.extrapolated) {
        notes.unshift('The fitted concentration lies OUTSIDE the range tested, ' +
          'so it is extrapolated rather than measured.');
      }
      if (fit.converged === false) {
        notes.unshift('The optimizer did not converge' +
          (fit.stopped_early ? ' and stopped early' : '') +
          '; treat these parameters as unreliable.');
      }
      if (fit.amplitude_below_observed_range) {
        notes.unshift('The fitted curve spans less than the observed responses, ' +
          'which means it has collapsed toward a step rather than describing ' +
          'the data.');
      }
      if (fit.saturated_design) {
        notes.unshift('There are no degrees of freedom left: the model has as ' +
          'many free parameters as there are concentrations, so the fit cannot ' +
          'be assessed and no interval is available. Test more concentrations.');
      }
      if (fit.fit_worse_than_mean) {
        notes.unshift('The fitted curve explains the data WORSE than a flat line ' +
          'at their mean (negative r-squared). This is a failed fit, and the ' +
          'reported potency is meaningless.');
      }
      writeLine(stdout, JSON.stringify({
        ...fit,
        ...(unit ? { concentration_unit: unit } : {}),
        interpretation: notes
      }, null, 2));
      return 0;
    }
    if (command === 'stats') {
      const action = args[0] ?? 'help';
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, STATS_USAGE);
        return 0;
      }
      const engine = { name: STATISTICS_ENGINE_NAME, version: STATISTICS_ENGINE_VERSION };
      if (action === 'quantile') {
        if (args.length !== 3) {
          throw argumentError('stats quantile requires exactly P and DF.');
        }
        const p = Number(args[1]);
        const degreesOfFreedom = Number(args[2]);
        writeLine(stdout, JSON.stringify({
          engine,
          p,
          degrees_of_freedom: degreesOfFreedom,
          quantile: studentTQuantile(p, degreesOfFreedom)
        }, null, 2));
        return 0;
      }
      if (action === 'adjust') {
        const rest = args.slice(1);
        let correction = null;
        let family = null;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--correction') {
            correction = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--family') {
            family = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value.startsWith('--')) {
            throw argumentError('Unknown stats adjust option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (positional.length !== 1 || !correction) {
          throw argumentError('stats adjust requires a p-value list and --correction.');
        }
        const pValues = numberList(positional[0], 'P-value list');
        const adjusted = adjustPValues(pValues, correction, family ?? pValues.length);
        writeLine(stdout, JSON.stringify({
          engine,
          correction,
          family_size: family ?? pValues.length,
          p_values: pValues,
          adjusted_p_values: adjusted
        }, null, 2));
        return 0;
      }
      if (action === 'ranktest') {
        const rest = args.slice(1);
        let groupA = null;
        let groupB = null;
        let paired = false;
        let sidedness = 'two_sided';
        let nullShift = 0;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--paired') {
            paired = true;
          } else if (value === '--group-a') {
            groupA = numberList(takeValue(rest, index, value), 'Group A');
            index += 1;
          } else if (value === '--group-b') {
            groupB = numberList(takeValue(rest, index, value), 'Group B');
            index += 1;
          } else if (value === '--sidedness') {
            sidedness = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--null') {
            nullShift = Number(takeValue(rest, index, value));
            index += 1;
          } else {
            throw argumentError('Unknown stats ranktest option: ' + value);
          }
        }
        if (!groupA || !groupB) {
          throw argumentError('stats ranktest requires --group-a and --group-b.');
        }
        if (sidedness === 'equivalence') {
          throw argumentError(
            'Rank tests do not support equivalence; they compare orderings, ' +
            'not distances from a margin.'
          );
        }
        if (!Number.isFinite(nullShift)) {
          throw argumentError('stats ranktest --null must be a finite number.');
        }
        // A null shift is meaningful for both: the hypothesis is that group A
        // minus the shift has the same distribution as group B.
        const result = paired
          ? wilcoxonSignedRankTest(groupA, groupB, nullShift, sidedness)
          : mannWhitneyUTest(groupA, groupB, sidedness, 0.95, nullShift);
        writeLine(stdout, JSON.stringify({
          engine,
          result,
          interpretation: [
            'Rank tests use only the ordering of the observations, so they ' +
            'assume no particular distribution shape.',
            'They test a shift in location, not a difference in means, and ' +
            'still assume independent observations.',
            result.method === 'exact'
              ? 'The exact null distribution was used.'
              : 'A tie-corrected normal approximation was used, because the ' +
                'sample carries ties, dropped zero differences, or is larger ' +
                'than the exact bound.'
          ]
        }, null, 2));
        return 0;
      }
      if (action === 'tost') {
        const rest = args.slice(1);
        let values = null;
        let groupA = null;
        let groupB = null;
        let paired = false;
        let lower = null;
        let upper = null;
        let alpha = 0.05;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--paired') {
            paired = true;
          } else if (value === '--values') {
            values = numberList(takeValue(rest, index, value), 'Sample');
            index += 1;
          } else if (value === '--group-a') {
            groupA = numberList(takeValue(rest, index, value), 'Group A');
            index += 1;
          } else if (value === '--group-b') {
            groupB = numberList(takeValue(rest, index, value), 'Group B');
            index += 1;
          } else if (value === '--lower') {
            lower = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--upper') {
            upper = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--alpha') {
            alpha = Number(takeValue(rest, index, value));
            index += 1;
          } else {
            throw argumentError('Unknown stats tost option: ' + value);
          }
        }
        if (lower === null && upper === null) {
          throw argumentError(
            'stats tost requires --lower, --upper, or both; one bound alone tests ' +
            'non-inferiority or non-superiority.'
          );
        }
        if ((lower !== null && !Number.isFinite(lower)) ||
            (upper !== null && !Number.isFinite(upper))) {
          throw argumentError('stats tost bounds must be finite numbers.');
        }
        if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
          throw argumentError('stats tost alpha must be strictly between 0 and 1.');
        }
        if (lower !== null && upper !== null && alpha >= 0.5) {
          throw argumentError(
            'Two-bound equivalence alpha must be below 0.5, because the reported ' +
            'interval is at 1 - 2*alpha.'
          );
        }
        let result;
        if (values && !groupA && !groupB) {
          result = oneSampleTTest(values, 0, 'two_sided');
        } else if (groupA && groupB && !values) {
          result = paired
            ? pairedTTest(groupA, groupB, 0, 'two_sided')
            : welchTTest(groupA, groupB, 'two_sided', 0);
        } else {
          throw argumentError('stats tost requires either --values, or --group-a with --group-b.');
        }
        if (result.degenerate) {
          writeLine(stdout, JSON.stringify({
            engine, alpha, result, tost: null,
            interpretation: 'degenerate sample; equivalence cannot be assessed'
          }, null, 2));
          return 0;
        }
        const estimate = result.mean_difference ?? result.mean;
        const tost = tostPValue({
          estimate,
          standardError: result.standard_error,
          degreesOfFreedom: result.degrees_of_freedom,
          lower,
          upper
        });
        const oneSided = tost.kind !== 'equivalence';
        writeLine(stdout, JSON.stringify({
          engine,
          alpha,
          result,
          tost,
          // A TOST decision at alpha matches the 1 - 2*alpha interval sitting
          // entirely inside the bounds.
          confidence_interval: tConfidenceInterval({
            estimate,
            standardError: result.standard_error,
            degreesOfFreedom: result.degrees_of_freedom,
            sidedness: oneSided
              ? (tost.kind === 'non_inferiority' ? 'greater' : 'less')
              : 'two_sided',
            level: oneSided ? 1 - alpha : 1 - 2 * alpha
          }),
          conclusion: {
            equivalence: ['equivalent', 'not_equivalent'],
            non_inferiority: ['non_inferior', 'not_non_inferior'],
            non_superiority: ['non_superior', 'not_non_superior']
          }[tost.kind][tost.p_value <= alpha ? 0 : 1],
          interpretation: 'one-sided tests against every declared bound; the claim requires rejecting all of them, and failing to establish it is not evidence of a difference'
        }, null, 2));
        return 0;
      }
      if (action === 'ttest') {
        const rest = args.slice(1);
        let values = null;
        let groupA = null;
        let groupB = null;
        let nullMean = null;
        let sidedness = 'two_sided';
        let alpha = 0.05;
        let paired = false;
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--paired') {
            paired = true;
          } else if (value === '--values') {
            values = numberList(takeValue(rest, index, value), 'Sample');
            index += 1;
          } else if (value === '--group-a') {
            groupA = numberList(takeValue(rest, index, value), 'Group A');
            index += 1;
          } else if (value === '--group-b') {
            groupB = numberList(takeValue(rest, index, value), 'Group B');
            index += 1;
          } else if (value === '--null') {
            nullMean = Number(takeValue(rest, index, value));
            index += 1;
          } else if (value === '--sidedness') {
            sidedness = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--alpha') {
            alpha = Number(takeValue(rest, index, value));
            index += 1;
          } else {
            throw argumentError('Unknown stats ttest option: ' + value);
          }
        }
        if (sidedness === 'equivalence') {
          throw argumentError(
            'Equivalence uses two one-sided tests; use "sciencecode stats tost" ' +
            'with --lower and --upper instead.'
          );
        }
        if (!INFERENCE_SIDEDNESS.includes(sidedness)) {
          throw argumentError('stats ttest sidedness must be one of: ' +
            INFERENCE_SIDEDNESS.filter((item) => item !== 'equivalence').join(', '));
        }
        if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
          throw argumentError('stats ttest alpha must be strictly between 0 and 1.');
        }
        let result;
        if (values && !groupA && !groupB) {
          if (paired) {
            throw argumentError('Paired stats ttest requires --group-a and --group-b.');
          }
          if (!Number.isFinite(nullMean)) {
            throw argumentError('One-sample stats ttest requires a finite --null mean.');
          }
          result = oneSampleTTest(values, nullMean, sidedness);
        } else if (groupA && groupB && !values) {
          if (paired) {
            if (nullMean !== null && !Number.isFinite(nullMean)) {
              throw argumentError('Paired stats ttest requires a finite --null difference.');
            }
            result = pairedTTest(groupA, groupB, nullMean ?? 0, sidedness);
          } else {
            if (nullMean !== null && !Number.isFinite(nullMean)) {
              throw argumentError('Two-sample stats ttest requires a finite --null difference.');
            }
            result = welchTTest(groupA, groupB, sidedness, nullMean ?? 0);
          }
        } else {
          throw argumentError('stats ttest requires either --values with --null, or --group-a with --group-b.');
        }
        const interval = result.degenerate
          ? null
          : tConfidenceInterval({
            estimate: result.mean_difference ?? result.mean,
            standardError: result.standard_error,
            degreesOfFreedom: result.degrees_of_freedom,
            sidedness,
            level: 1 - alpha
          });
        writeLine(stdout, JSON.stringify({
          engine,
          sidedness,
          alpha,
          ...(values ? { null_mean: nullMean } : { null_difference: nullMean ?? 0 }),
          result,
          confidence_interval: interval,
          effect_size: effectSize(result, nullMean ?? 0),
          interpretation: 'deterministic calculation over the provided numbers; normality and independence are assumed, not checked'
        }, null, 2));
        return 0;
      }
      throw argumentError("stats action must be \"ttest\", \"tost\", \"quantile\", or \"adjust\".");
    }
    if (command === 'literature') {
      const action = args[0] ?? 'help';
      if (['help', '--help', '-h'].includes(action)) {
        writeLine(stdout, LITERATURE_USAGE);
        return 0;
      }
      if (action === 'fetch' || action === 'import') {
        const rest = args.slice(1);
        let source = null;
        let identifier = null;
        let json = false;
        const positional = [];
        for (let index = 0; index < rest.length; index += 1) {
          const value = rest[index];
          if (value === '--source') {
            source = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--id') {
            identifier = takeValue(rest, index, value);
            index += 1;
          } else if (value === '--json') {
            json = true;
          } else if (value.startsWith('-')) {
            throw argumentError('Unknown literature ' + action + ' option: ' + value);
          } else {
            positional.push(value);
          }
        }
        if (!source || !identifier) {
          throw argumentError('literature ' + action + ' requires --source and --id.');
        }
        let result;
        if (action === 'import') {
          if (positional.length !== 1) {
            throw argumentError('literature import requires exactly one saved response file.');
          }
          result = importLiteratureResponse({ cwd, source, identifier, file: positional[0] });
        } else {
          if (positional.length) {
            throw argumentError('literature fetch takes no positional arguments.');
          }
          const normalizedSource = normalizeLiteratureSource(source);
          const normalizedIdentifier = normalizeLiteratureIdentifier(normalizedSource, identifier);
          const url = literatureRequestUrl(normalizedSource, normalizedIdentifier);
          const worker = path.join(root, 'lib', 'literature-fetch-worker.js');
          const spawned = runCommandSync(process.execPath,
            [worker, url, LITERATURE_FETCH_TIMEOUT_MS, VERSION], {
              cwd,
              env,
              timeout: LITERATURE_FETCH_TIMEOUT_MS + 30_000
            });
          if (spawned.error) {
            writeLine(stderr, 'ScienceCode literature fetch worker failed: ' + spawned.error.message);
            return 1;
          }
          if (spawned.signal) {
            writeLine(stderr, 'Literature fetch timed out or was terminated (' +
              spawned.signal + ') for ' + url);
            return 1;
          }
          let fetched;
          try {
            fetched = JSON.parse(String(spawned.stdout ?? ''));
          } catch {
            writeLine(stderr, 'Literature fetch worker exited with status ' +
              String(spawned.status) + ' and an unreadable response.');
            return 1;
          }
          if (!fetched.ok || typeof fetched.body_base64 !== 'string') {
            writeLine(stderr, 'Literature fetch failed for ' + url +
              (fetched.http_status ? ' (HTTP ' + fetched.http_status + ')' : '') +
              (fetched.error ? ': ' + fetched.error : ''));
            return 1;
          }
          result = ingestLiteratureResponse({
            cwd,
            source: normalizedSource,
            identifier: normalizedIdentifier,
            response: Buffer.from(fetched.body_base64, 'base64'),
            request: {
              url,
              retrieved_at: new Date().toISOString(),
              http_status: fetched.http_status,
              transport: 'https'
            }
          });
        }
        if (json) {
          writeLine(stdout, JSON.stringify(result, null, 2));
        } else {
          writeLine(stdout, 'Frozen literature record ' + result.manifest.literature_id);
          writeLine(stdout, '  source:     ' + result.manifest.source +
            ' (' + result.manifest.request.transport + ')');
          writeLine(stdout, '  identifier: ' + result.manifest.identifier);
          writeLine(stdout, '  title:      ' + (result.record.bibliography.title ?? '-'));
          writeLine(stdout, '  year:       ' + (result.record.bibliography.year ?? '-'));
          writeLine(stdout, '  sha256:     ' + result.manifest.response.sha256);
        }
        return 0;
      }
      if (action === 'list') {
        const rest = args.slice(1);
        let source;
        let json = false;
        for (let index = 0; index < rest.length; index += 1) {
          if (rest[index] === '--source') {
            source = takeValue(rest, index, rest[index]);
            index += 1;
          } else if (rest[index] === '--json') {
            json = true;
          } else {
            throw argumentError('Unknown literature list option: ' + rest[index]);
          }
        }
        const records = listLiteratureRecords(cwd, { source });
        if (json) {
          writeLine(stdout, JSON.stringify(records, null, 2));
        } else if (!records.length) {
          writeLine(stdout, 'No literature records.');
        } else {
          writeLine(stdout, 'LITERATURE ID                        SOURCE    VERIFIED  YEAR  TITLE');
          for (const record of records) {
            writeLine(stdout,
              String(record.literature_id).padEnd(36) + ' ' +
              String(record.source ?? '-').padEnd(9) + ' ' +
              String(record.verified).padEnd(9) + ' ' +
              String(record.year ?? '-').padEnd(5) + ' ' +
              String(record.title ?? '-').slice(0, 80));
          }
        }
        return 0;
      }
      if (action === 'show' || action === 'verify') {
        if (args.length !== 2) {
          throw argumentError('literature ' + action + ' requires exactly one literature ID.');
        }
        const result = action === 'show'
          ? getLiteratureRecord(cwd, args[1])
          : verifyLiteratureRecord(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return action === 'verify' && !result.ok ? 1 : 0;
      }
      throw argumentError('literature action must be "fetch", "import", "list", "show", or "verify".');
    }
    if (command === 'inference') {
      const action = args[0] ?? 'list';
      if (action === 'help' || action === '--help' || action === '-h') {
        writeLine(stdout, INFERENCE_USAGE);
        return 0;
      }
      if (action === 'run' || action === 'smoke') {
        const parsed = parseInferenceArguments(args.slice(1));
        if (parsed.help) {
          writeLine(stdout, INFERENCE_USAGE);
          return 0;
        }
        if (action === 'run' && !parsed.model) {
          throw argumentError('inference run requires an ONNX model.');
        }
        if (action === 'run' && !parsed.input) {
          throw argumentError('inference run requires --input INPUT.json.');
        }
        if (action === 'smoke' && (parsed.model || parsed.input)) {
          throw argumentError('inference smoke generates its own deterministic model and input.');
        }
        const result = runInference({
          cwd,
          packageRoot: root,
          model: parsed.model,
          input: parsed.input,
          smoke: action === 'smoke',
          device: parsed.device,
          allowFallback: parsed.allowFallback,
          warmup: parsed.warmup,
          iterations: parsed.iterations,
          timeoutMs: parsed.timeoutMs,
          env
        });
        writeLine(stdout, JSON.stringify({
          inference_id: result.manifest.inference_id,
          status: result.manifest.status,
          kind: result.manifest.kind,
          device_request: result.manifest.device_request,
          provider_verification: result.manifest.provider_verification,
          latency_ms: result.manifest.execution?.latency_ms ?? null,
          outputs: result.manifest.execution?.outputs ?? [],
          record_directory: result.runDirectory
        }, null, 2));
        if (result.manifest.status !== 'completed') {
          writeLine(stderr,
            'ScienceCode inference failed; preserved logs and artifacts: ' + result.runDirectory);
        }
        return result.manifest.status === 'completed' ? 0 : 1;
      }
      if (action === 'list') {
        onlyFlags(args.slice(1), ['--json']);
        const inferences = listInferences(cwd);
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(inferences, null, 2));
        } else if (!inferences.length) {
          writeLine(stdout, 'No recorded inferences.');
        } else {
          writeLine(stdout, 'INFERENCE ID                     STATUS     DEVICE   NPU   MODEL');
          for (const inference of inferences) {
            writeLine(
              stdout,
              inference.inference_id.padEnd(32) + ' ' +
                String(inference.status).padEnd(10) + ' ' +
                String(inference.device ?? '-').padEnd(8) + ' ' +
                String(inference.npu_executed ? 'yes' : 'no').padEnd(5) + ' ' +
                String(inference.model ?? '-')
            );
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (args.length !== 2) throw argumentError('inference show requires exactly one inference ID.');
        writeLine(stdout, JSON.stringify(getInferenceManifest(cwd, args[1]), null, 2));
        return 0;
      }
      if (action === 'verify') {
        if (args.length !== 2) throw argumentError('inference verify requires exactly one inference ID.');
        const result = verifyInference(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      throw argumentError('inference action must be "smoke", "run", "list", "show", or "verify".');
    }
    if (command === 'simulate') {
      const action = args[0] ?? 'list';
      if (action === 'help' || action === '--help' || action === '-h') {
        writeLine(stdout, SIMULATE_USAGE);
        return 0;
      }
      if (action === 'init') {
        const rest = args.slice(1);
        if (rest.some((value) => value.startsWith('-')) || rest.length > 2) {
          throw argumentError('simulate init accepts an optional template name and output file.');
        }
        const name = rest[0] ?? 'reaction-diffusion';
        const options = { packageRoot: root };
        if (rest[1]) options.target = rest[1];
        const result = initializeSimulationTemplate(cwd, name, options);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return 0;
      }
      if (action === 'run') {
        const parsed = parseSimulationArguments(args.slice(1));
        if (parsed.help) {
          writeLine(stdout, SIMULATE_USAGE);
          return 0;
        }
        if (!parsed.script) throw argumentError('simulate run requires a Python script.');
        const result = runSimulation({
          cwd,
          packageRoot: root,
          script: parsed.script,
          seed: parsed.seed,
          device: parsed.device,
          timeoutMs: parsed.timeoutMs,
          parameters: parsed.parameters,
          inputs: parsed.inputs,
          scriptArgs: parsed.scriptArgs,
          env
        });
        writeBlock(stdout, result.displayStdout);
        writeBlock(stderr, result.displayStderr);
        writeLine(stderr, 'ScienceCode simulation record: ' + result.runDirectory);
        return result.manifest.exit_code;
      }
      if (action === 'list') {
        onlyFlags(args.slice(1), ['--json']);
        const simulations = listSimulations(cwd);
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(simulations, null, 2));
        } else if (!simulations.length) {
          writeLine(stdout, 'No recorded simulations.');
        } else {
          writeLine(stdout, 'SIMULATION ID                    STATUS     DEVICE     SCRIPT');
          for (const simulation of simulations) {
            writeLine(
              stdout,
              simulation.simulation_id.padEnd(32) + ' ' +
                String(simulation.status).padEnd(10) + ' ' +
                String(simulation.device ?? '-').padEnd(10) + ' ' +
                String(simulation.script ?? '-')
            );
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (args.length !== 2) throw argumentError('simulate show requires exactly one simulation ID.');
        writeLine(stdout, JSON.stringify(getSimulationManifest(cwd, args[1]), null, 2));
        return 0;
      }
      if (action === 'verify') {
        if (args.length !== 2) throw argumentError('simulate verify requires exactly one simulation ID.');
        const result = verifySimulation(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      throw argumentError('simulate action must be "init", "run", "list", "show", or "verify".');
    }
    if (command === 'experiment') {
      const action = args[0] ?? 'list';
      if (action === 'help' || action === '--help' || action === '-h') {
        writeLine(stdout, EXPERIMENT_USAGE);
        return 0;
      }
      if (action === 'run') {
        const parsed = parseExperimentArguments(args.slice(1));
        if (parsed.help) {
          writeLine(stdout, EXPERIMENT_USAGE);
          return 0;
        }
        if (!parsed.script) throw argumentError('experiment run requires a Python script.');
        const result = runExperiment({
          cwd,
          packageRoot: root,
          script: parsed.script,
          seeds: parsed.seeds,
          device: parsed.device,
          timeoutMs: parsed.timeoutMs,
          parameters: parsed.parameters,
          variations: parsed.variations,
          inputs: parsed.inputs,
          scriptArgs: parsed.scriptArgs,
          name: parsed.name,
          hypothesis: parsed.hypothesis,
          analysisContractId: parsed.analysisContractId,
          cadBuildId: parsed.cadBuildId,
          env
        });
        writeLine(stdout, JSON.stringify({
          experiment_id: result.manifest.experiment_id,
          status: result.manifest.status,
          counts: result.manifest.counts,
          review: result.review,
          simulations: result.manifest.simulations
        }, null, 2));
        writeLine(stderr, 'ScienceCode experiment record: ' + result.experimentDirectory);
        return result.manifest.status === 'completed' ? 0 : 1;
      }
      if (action === 'list') {
        onlyFlags(args.slice(1), ['--json']);
        const experiments = listExperiments(cwd);
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(experiments, null, 2));
        } else if (!experiments.length) {
          writeLine(stdout, 'No recorded experiments.');
        } else {
          writeLine(stdout, 'EXPERIMENT ID                    STATUS     REVIEW   BRANCHES  NAME');
          for (const experiment of experiments) {
            writeLine(
              stdout,
              experiment.experiment_id.padEnd(32) + ' ' +
                String(experiment.status).padEnd(10) + ' ' +
                String(experiment.review_verdict ?? '-').padEnd(8) + ' ' +
                String(experiment.branch_count).padEnd(9) + ' ' +
                String(experiment.name ?? experiment.script ?? '-')
            );
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (args.length !== 2) throw argumentError('experiment show requires exactly one experiment ID.');
        writeLine(stdout, JSON.stringify(getExperimentManifest(cwd, args[1]), null, 2));
        return 0;
      }
      if (action === 'verify') {
        if (args.length !== 2) throw argumentError('experiment verify requires exactly one experiment ID.');
        const result = verifyExperiment(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      throw argumentError('experiment action must be "run", "list", "show", or "verify".');
    }
    if (command === 'doctor') {
      onlyFlags(args, ['--json']);
      const result = doctor({ env, cwd, configDir, packageRoot: root });
      if (args.includes('--json')) {
        writeLine(stdout, JSON.stringify(result, null, 2));
      } else {
        for (const check of result.checks) {
          const mark = check.ok ? '[ok]' : check.required ? '[x]' : '[-]';
          const location = check.path ? `: ${check.path}` : '';
          const version = check.version ? ` (${String(check.version).split(/\r?\n/)[0]})` : '';
          const detail = !check.ok && check.detail ? ' - ' + check.detail : '';
          const optional = !check.ok && !check.required ? ' (optional)' : '';
          writeLine(stdout, `${mark} ${check.name}${location}${version}${detail}${optional}`);
        }
      }
      if (!result.ok) writeLine(stderr, 'A required dependency or compatibility check failed.');
      return result.ok ? 0 : 1;
    }
    if (command === 'snapshot') {
      if (args.length > 1) throw argumentError('snapshot accepts at most one output file.');
      const createManagedSnapshot = (snapshotId) => {
        let report;
        try {
          report = commitProjectSnapshotPending(
            cwd,
            captureProjectSnapshotPending(cwd, snapshotId)
          );
        } finally {
          try {
            discardProjectSnapshotPending(cwd, snapshotId);
          } catch {
            // Preserve the primary capture/commit result.
          }
        }
        const target = path.join(path.resolve(cwd), ...report.snapshot.file.split('/'));
        writeLine(stdout, target);
        return target;
      };
      if (args.length === 0) {
        createManagedSnapshot(makeRunId());
        return 0;
      }
      const target = resolveInsideRoot(cwd, args[0]);
      const relative = relativePortable(cwd, target);
      const managed = relative.match(/^\.sciencecode\/snapshots\/([^/]+)\.json$/);
      if (managed) {
        createManagedSnapshot(managed[1]);
        return 0;
      }
      ensureContainedOutputParent(cwd, target);
      ensureContainedOutputParent(
        cwd,
        path.join(cwd, '.sciencecode', 'audit', 'events.jsonl')
      );
      ensureScienceDir(cwd);
      const value = snapshot(cwd);
      writeJsonExclusive(target, value);
      appendAudit(cwd, {
        type: 'snapshot.created',
        file: relativePortable(cwd, target),
        snapshot_sha256: sha256File(target),
        file_count: Object.keys(value.files).length
      });
      writeLine(stdout, target);
      return 0;
    }
    if (command === 'verify') {
      const strict = args.includes('--strict');
      const files = args.filter((value) => value !== '--strict');
      if (files.length !== 1) throw argumentError('verify requires exactly one snapshot file.');
      const file = resolveInsideRoot(cwd, files[0]);
      const result = verifySnapshot(cwd, readJson(file), { strict });
      writeLine(stdout, JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    if (command === 'audit') {
      const action = args[0] ?? 'verify';
      onlyFlags(args.slice(1), []);
      if (action === 'verify') {
        const result = verifyAudit(cwd);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      if (action === 'show') {
        writeLine(stdout, JSON.stringify(readAuditRecords(cwd), null, 2));
        return 0;
      }
      throw argumentError('audit action must be "verify" or "show".');
    }
    if (command === 'runs') {
      onlyFlags(args, ['--json']);
      const runs = listRuns(cwd);
      if (args.includes('--json')) {
        writeLine(stdout, JSON.stringify(runs, null, 2));
      } else if (!runs.length) {
        writeLine(stdout, 'No recorded runs.');
      } else {
        writeLine(stdout, 'RUN ID                           STATUS     AGENT                    EXIT');
        for (const run of runs) {
          writeLine(
            stdout,
            `${run.run_id.padEnd(32)} ${String(run.status).padEnd(10)} ${String(run.agent ?? '-').padEnd(24)} ${run.exit_code ?? '-'}`
          );
        }
      }
      return 0;
    }
    if (command === 'show') {
      if (args.length !== 1) throw argumentError('show requires exactly one run ID.');
      writeLine(stdout, JSON.stringify(getRunManifest(cwd, args[0]), null, 2));
      return 0;
    }
    if (command === 'verify-run') {
      if (args.length !== 1) throw argumentError('verify-run requires exactly one run ID.');
      const result = verifyRun(cwd, args[0]);
      writeLine(stdout, JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    if (command === 'preregister') {
      const action = args[0] ?? 'list';
      if (action === 'freeze') {
        const rest = args.slice(1);
        let source = null;
        let name;
        for (let index = 0; index < rest.length; index += 1) {
          if (rest[index] === '--name') {
            name = takeValue(rest, index, '--name');
            index += 1;
          } else if (rest[index].startsWith('-')) {
            throw argumentError(`Unknown preregistration option: ${rest[index]}`);
          } else if (source === null) {
            source = rest[index];
          } else {
            throw argumentError('preregister freeze accepts exactly one source file.');
          }
        }
        if (!source) throw argumentError('preregister freeze requires a source file.');
        const result = freezePreregistration(cwd, source, { name });
        writeLine(stdout, JSON.stringify(result, null, 2));
        return 0;
      }
      if (action === 'list') {
        onlyFlags(args.slice(1), ['--json']);
        const records = listPreregistrations(cwd);
        if (args.includes('--json')) {
          writeLine(stdout, JSON.stringify(records, null, 2));
        } else if (!records.length) {
          writeLine(stdout, 'No preregistrations.');
        } else {
          writeLine(stdout, 'PREREGISTRATION ID                                               STATUS     NAME');
          for (const record of records) {
            writeLine(
              stdout,
              `${record.preregistration_id.padEnd(65)} ${String(record.status).padEnd(10)} ${record.name ?? '-'}`
            );
          }
        }
        return 0;
      }
      if (action === 'show') {
        if (args.length !== 2) throw argumentError('preregister show requires exactly one ID.');
        writeLine(stdout, JSON.stringify(getPreregistration(cwd, args[1]), null, 2));
        return 0;
      }
      if (action === 'verify') {
        if (args.length !== 2) throw argumentError('preregister verify requires exactly one ID.');
        const result = verifyPreregistration(cwd, args[1]);
        writeLine(stdout, JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      throw argumentError('preregister action must be "freeze", "list", "show", or "verify".');
    }
    if (command === 'gate') {
      onlyFlags(args, [
        '--allow-failed-runs',
        '--allow-failed-simulations',
        '--allow-failed-cad-builds',
        '--allow-failed-cad-slices',
        '--allow-failed-inferences',
        '--allow-failed-experiments',
        '--allow-failed-kernel-cells',
        '--allow-failed-campaign-tasks'
      ]);
      const result = verifyProject(cwd, {
        allowFailedRuns: args.includes('--allow-failed-runs'),
        allowFailedSimulations: args.includes('--allow-failed-simulations'),
        allowFailedCadBuilds: args.includes('--allow-failed-cad-builds'),
        allowFailedCadSlices: args.includes('--allow-failed-cad-slices'),
        allowFailedInferences: args.includes('--allow-failed-inferences'),
        allowFailedExperiments: args.includes('--allow-failed-experiments'),
        allowFailedKernelCells: args.includes('--allow-failed-kernel-cells'),
        allowFailedCampaignTasks: args.includes('--allow-failed-campaign-tasks')
      });
      writeLine(stdout, JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }
    if (command === 'tui' || command === 'web' || command === 'serve') {
      const openCodeArgs = command === 'tui' ? args : [command, ...args];
      return launchResult(launchOpenCode({
        cwd,
        configDir,
        packageRoot: root,
        args: openCodeArgs,
        env
      }), stderr);
    }
    if (command === 'run') {
      const parsed = parseRunArguments(args);
      if (parsed.help) {
        writeLine(stdout, RUN_USAGE);
        return 0;
      }
      if (!parsed.prompt) throw argumentError('run requires a research prompt.');
      const result = runOpenCode({
        cwd,
        configDir,
        agent: parsed.agent,
        prompt: parsed.prompt,
        passthrough: parsed.passthrough,
        format: parsed.format,
        storePrompt: parsed.storePrompt,
        packageRoot: root,
        env
      });
      writeBlock(stdout, result.displayStdout);
      writeBlock(stderr, result.displayStderr);
      writeLine(stderr, `ScienceCode run record: ${result.runDir}`);
      return result.manifest.exit_code;
    }
    throw argumentError(`Unknown command: ${command}`);
  } catch (error) {
    writeLine(stderr, `ScienceCode: ${error.message}`);
    return cliExitCodeForError(error);
  }
}
