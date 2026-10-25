# ScienceCode capability research

Research date: 2026-08-11

This note records the primary-source review used to choose ScienceCode's
product direction. It is a design input, not a claim that ScienceCode is
affiliated with or equivalent to any referenced project.

## Claude Science product design

Anthropic describes Claude Science as a scientific workbench rather than a new
model. The official product page makes the interactive design concrete:

- the scientist starts from a prompt and continues inside one research project;
- figures, tables, and notebooks retain the exact code, environment, and
  conversation that produced them;
- a background reviewer checks citations, numbers, and code/figure agreement;
- figures can be discussed and revised in plain language;
- local GPUs, remote/HPC compute, and persistent Python/R kernels remain part
  of the same session; and
- skills and connectors bring existing scripts, databases, ELNs, and pipelines
  into the workbench instead of replacing them.

This is the central design reference for ScienceCode's interaction model. The
conversation is not decorative UI: it is the control surface for research and
part of the reproducibility record.

Primary sources:

- [Claude Science product page](https://claude.com/product/claude-science)
- [Claude Science, an AI workbench for scientists](https://www.anthropic.com/news/claude-science-ai-workbench)

ScienceCode adopts the product principles—not Anthropic implementation code:
one local conversational scientific environment, specialist workflows,
reviewer separation, compute access, rich artifacts, and exact provenance.

Version 0.10 makes the provenance principle directly inspectable. A derived
graph connects source spans, retrievals, notebook cells, code/data inputs,
turns, runs, experiment branches, artifacts, and user-authored revisions. The
graph is read-only and digestible; selecting a trace becomes explicit context
for the next conversation turn. This implements inspectable record lineage,
not the full Claude Science background reviewer: semantic claim extraction and
independent code/number/figure agreement checks remain evaluation targets.

Version 0.11 makes revision semantics concrete. Editable output is no longer
limited to an ephemeral browser draft or a compact interaction summary: the
exact replacement bytes can become an immutable derived artifact linked to the
verified producing file and an optional prior proposal. Acceptance and
rejection are separate append-only review decisions. This follows the product
principle that figures, tables, code, environment, conversation, and revisions
remain connected, while avoiding the scientifically unsafe behavior of
silently replacing an archived result after an AI or user edit.

Version 0.12 applies the same provenance principle to domain-native output
inspection. Chemical graphs, genomic coordinate tracks, and manuscript changes
are local interactive views over verified immutable artifacts. A selected atom,
feature, region, or changed line becomes explicit user-authored context rather
than an invisible browser gesture. Source edits use the 0.11 revision workflow,
so richer visualization does not weaken the source/replacement boundary.

Version 0.13 implements the first independent consistency-review layer. The
official Claude Science description specifically separates a reviewer agent
that checks citations and calculations and flags incorrect citations,
untraceable numbers, and figures that disagree with underlying code. ScienceCode
implements an original deterministic first pass plus a separate read-only AI
critic. The deterministic report preserves exact immutable inputs and useful
triage signals; the critic and a qualified human must still inspect scientific
support, scope, methods, and interpretation.

Version 0.14 implements the prospective-outcome control that the workbench was
still missing. The scientist can freeze a preregistration-linked analysis
contract, bind its exact digest and script to an experiment matrix, replay the
fixed decision rules afterward, and inspect registration status independently
from the threshold result. The interactive contract and assessment views are
part of the same Lab/harness/lineage/AI record rather than a detached form.

Version 0.15 applies the same exact-record principle to procedure development.
The scientist can edit a neutral structured plan, freeze its provenance and
supersession link, run a deterministic non-executing logical dry-run, inspect
adapter gaps, and record a separate scoped human decision. Plan steps, gates,
findings, adapters, and decision limits are interactive workspace state that
can be handed to the next AI turn without changing the immutable source.

Version 0.16 makes the local accelerator boundary explicit. CUDA/PyTorch
remains the simulation and training path, while a separate Windows ML runtime
handles bounded ONNX inference on the AMD NPU. Models, inputs, arrays, profiles,
fallback policy, provider evidence, and user-facing output previews remain in
the same immutable Lab, harness, lineage, audit, and conversation record.

Version 0.19 applies the same workbench principle to engineering artifacts.
Parametric sources, rendered meshes, model inputs, printability screens,
slices, editable G-code proposals, interactive mesh state, and user direction
remain in one inspectable environment. A dedicated CAD specialist can act on
that state, but every derived claim still points to the exact immutable mesh
and tool record.

## Parametric CAD, mesh simulation, and slicing

OpenSCAD is a strong initial source format for an LLM-facing CAD environment
because its designs are programs made from explicit parameters, modules,
includes, uses, and imports. Its official command-line interface exports STL
and 3MF and can emit JSON summaries; recent releases include the Manifold
geometry engine. ScienceCode therefore keeps editable multi-file SCAD as the
authoritative design, runs a console render with hard warnings, and archives
both the exact source tree and mesh rather than treating an opaque STL as the
only design record.

Primary sources:

- [OpenSCAD repository](https://github.com/openscad/openscad/)
- [OpenSCAD user manual](https://files.openscad.org/documentation/manual/OpenSCAD_User_Manual.pdf)
- [OpenSCAD releases](https://github.com/openscad/openscad/releases)

CadQuery provides a complementary Pythonic boundary-representation and
assembly model. Its official documentation supports isolated pip/conda
installation on modern Python, direct Workplane/Shape export to STL and STEP,
and assembly export. ScienceCode therefore treats it as an optional, pinned
compute profile rather than a mandatory base dependency or a system-Python
package. A declared Python entry returns a Workplane, Shape, or Assembly from
`build(parameters)` or `result`; ScienceCode exports a common ASCII STL and a
STEP interchange file while keeping the complete Python tree as the
authoritative editable source.

STEP improves mechanical interchange but does not preserve arbitrary Python
source semantics. For reproducible evidence, the adapter records CadQuery,
OCP, and Python versions plus object/solid/face summaries, uses explicit
tessellation tolerances, exports assembly compound geometry in stable name
order, and canonicalizes the volatile STEP `FILE_NAME` timestamp. The build
rehashes its entire source snapshot after Python exits. This detects a model
that rewrites declared inputs, but dependency isolation is not an OS/network
sandbox and cannot reverse external side effects.

Primary sources:

- [CadQuery repository](https://github.com/CadQuery/cadquery)
- [CadQuery installation](https://cadquery.readthedocs.io/en/stable/installation.html)
- [CadQuery import and export](https://cadquery.readthedocs.io/en/latest/importexport.html)
- [CadQuery file formats](https://cadquery.readthedocs.io/en/latest/fileformat.html)
- [CadQuery assemblies](https://cadquery.readthedocs.io/en/latest/assy.html)
- [CadQuery releases](https://github.com/CadQuery/cadquery/releases)

PrusaSlicer exposes a complete console route for loading meshes and profiles
and exporting G-code. CuraEngine similarly separates mesh slicing from a
front-end and documents a command-line slicing pipeline. These projects make a
local slicer practical, but G-code is physical machine-control data: a
successful export does not establish printer compatibility, reachable motion,
thermal safety, material suitability, firmware behavior, or operator safety.
ScienceCode consequently defaults to a no-extrusion, zero-temperature preview,
rejects slicer post-process hooks, isolates slicer state, and contains no
printer transmission feature.

Primary sources:

- [PrusaSlicer repository](https://github.com/prusa3d/PrusaSlicer)
- [PrusaSlicer command-line interface](https://github.com/prusa3d/PrusaSlicer/wiki/Command-Line-Interface)
- [CuraEngine repository](https://github.com/Ultimaker/CuraEngine)
- [CuraEngine slicing pipeline](https://github.com/Ultimaker/CuraEngine/wiki/Slicing)

Blender exposes a rigid-body world API, which is useful for visual/dynamic
scene work but is not evidence of structural FEA. This supports a two-layer
design: ScienceCode may offer a fast deterministic geometry screen and
optional visualization adapters, while structural, thermal, fluid, collision,
or other physics claims require an explicit recorded solver, material model,
loads, constraints, discretization, convergence study, and benchmark.

Primary source:

- [Blender rigid-body API](https://docs.blender.org/api/3.6/bpy.types.RigidBodyWorld.html)

The implemented CPU/GPU bridge follows that distinction. Any project Python
model can consume a verified immutable STL as a declared input. The model and
its equations determine the scientific meaning; ScienceCode contributes
containment, exact parent hashes, runtime/device records, outputs, audit, and
lineage. The supplied PyTorch template is only an independent geometry
calculation. The NPU remains an ONNX inference path and would be appropriate
for a separately validated surrogate model, not as an automatic replacement
for a mechanics solver.

## Procedure and laboratory-automation harness design

XDL 2.0 is explicitly designed as a hardware-independent executable
description. Its standard separates reagents, a hardware graph, and procedure
steps, and its implementation repository keeps the standard and execution
machinery distinct. That makes XDL a useful target vocabulary, but not evidence
that an abstract ScienceCode step can safely run on a particular platform.

Opentrons Protocol Designer organizes protocols around robot hardware,
instruments, labware, liquids, and ordered steps. The Python API simulation
reference runs a protocol against virtual hardware and returns a run log, but
simulation still depends on an exact API version and platform configuration.
ScienceCode therefore maps neutral operations only. It does not invent deck
slots, wells, labware definitions, modules, volumes, or platform commands.

CDC's BMBL guidance emphasizes protocol-driven biological risk assessment
rather than treating a generic biosafety level as a complete determination.
OSHA's laboratory Chemical Hygiene Plan materials similarly require
laboratory-specific hazards, controls, training, emergency planning, and
conditions requiring prior approval. These sources support a visible
plan/assessment/decision split: structural completeness can be checked
deterministically, while facility authority and safety judgment cannot.

Primary sources:

- [XDL 2.0 standard](https://croningroup.gitlab.io/chemputer/xdl/standard/index.html)
- [Cronin Group XDL 2.0 implementation repository](https://gitlab.com/croningroup/chemputer/xdl/-/tree/v2.0.0)
- [Opentrons Protocol Designer documentation](https://docs.opentrons.com/protocol-designer/about/)
- [Opentrons Python API simulation reference](https://docs.opentrons.com/python-api/reference/execute-simulate/)
- [Opentrons open-source repository](https://github.com/opentrons/opentrons)
- [CDC Biosafety in Microbiological and Biomedical Laboratories](https://www.cdc.gov/labs/bmbl/index.html)
- [OSHA Laboratory Safety: Chemical Hygiene Plan](https://obis.osha.gov/Publications/laboratory/OSHAfactsheet-laboratory-safety-chemical-hygiene-plan.html)
- [OSHA 1910.1450 Appendix A](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1450AppA)

ScienceCode's design consequences are:

- keep one strict vendor-neutral plan as the immutable scientific object;
- make graph/reference/resource replay deterministic and versioned;
- expose XDL and Opentrons output only as non-executable mapping previews;
- require explicit evidence, controls, hazards, training, emergency response,
  stop conditions, and waste handling for laboratory domains;
- keep local human decisions separate from the plan and assessment;
- never claim reviewer identity, facility authority, regulatory validity, or
  physical execution; and
- invalidate effective decisions when their assessment or plan is no longer
  current.

## Preregistration and confirmatory-analysis design

OSF registrations provide the important record semantics: a registration is a
frozen, timestamped version of a project, later changes require a new record,
and embargo or immediate public release does not change the frozen content.
The National Academies open-science toolkit likewise describes preregistration
as specifying the research plan before data collection or analysis and keeping
confirmatory and exploratory work distinguishable.

SPIRIT-Outcomes requires each outcome to identify its domain, measurement
variable, participant-level metric, aggregation method, and timepoint. FDA
E9(R1) adds the estimand attributes ScienceCode needs to surface explicitly:
population, treatment/condition, variable, handling of intercurrent events,
and population-level summary, together with sensitivity analysis. CONSORT 2025
reinforces transparent reporting of trial registration, protocol access,
prespecified outcomes and analyses, and deviations. These sources concern
clinical research; ScienceCode adopts the clarity and provenance principles
for computational experiments without claiming clinical or regulatory
compliance.

Primary sources:

- [OSF Guide to Registrations](https://help.osf.io/article/330-welcome-to-registrations)
- [National Academies Open Science Toolkit](https://www.ncbi.nlm.nih.gov/books/NBK575041/)
- [SPIRIT-Outcomes 2022 checklist](https://www.spirit-statement.org/wp-content/uploads/Fillable-SPIRIT-Outcomes-2022-Checklist-with-SPIRIT-2013.pdf)
- [FDA E9(R1) estimands and sensitivity-analysis guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/e9r1-statistical-principles-clinical-trials-addendum-estimands-and-sensitivity-analysis-clinical)
- [CONSORT 2025 explanation and elaboration](https://pmc.ncbi.nlm.nih.gov/articles/PMC11995452/)

ScienceCode therefore stores operational definitions instead of only a prose
hypothesis: exact script bytes, population and conditions, missing-data and
multiplicity policies, outcome role, statistic key, variable, unit, timepoint,
summary measure, intercurrent-event strategy, exact branch filter,
aggregation, minimum count, threshold, exclusions, and sensitivity analyses.
The deterministic engine deliberately stops at threshold replay. A pass is not
a p-value, confidence interval, causal effect, clinically meaningful benefit,
or regulatory conclusion; those require a prespecified statistical design,
appropriate data-generating assumptions, and qualified review beyond this
engine.

## Native scientific artifact design

Daylight's official SMILES theory defines atoms, bonds, branches, ring
closures, disconnected components, aromatic tokens, charges, hydrogens, and
isomeric notation. ScienceCode 0.12 intentionally implements only bounded
connectivity depiction: it retains explicit graph information but does not
claim canonicalization, full valence/aromaticity perception, stereochemical
interpretation, or a complete hydrogen-derived molecular formula. MOL/SDF is
similarly limited to bounded V2000 records and recorded coordinates/properties.

The GA4GH `hts-specs` repository is the primary maintained source for VCF and
BED specifications. UCSC's BED documentation confirms the required first three
fields and the excluded `chromEnd`; Sequence Ontology defines GFF3's nine-column
feature model. The JBrowse 2 paper reinforces the useful interaction pattern:
linear coordinate navigation, typed tracks, toggling, selection, and detail
inspection. ScienceCode adopts those small-file interaction semantics without
embedding JBrowse code or implying support for indexed BAM/CRAM/BigWig-scale
analysis.

Primary sources:

- [Daylight SMILES theory](https://www.daylight.com/dayhtml/doc/theory/theory.smiles.html)
- [GA4GH maintained VCF and BED specifications](https://github.com/samtools/hts-specs)
- [UCSC BED format reference](https://genome.ucsc.edu/FAQ/FAQformat#format1)
- [Sequence Ontology GFF3 specification](https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md)
- [JBrowse 2: a modular genome browser](https://doi.org/10.1186/s13059-023-02914-z)

Manuscript review needs a different boundary. A textual diff can identify what
the user changed and preserve exact line provenance, but it cannot establish
that a citation supports a claim or that a reported number agrees with code.
ScienceCode therefore labels its bounded exact/coarse line comparison as an
editing surface; semantic claim/evidence review remains the next capability.

## Persistent language-session design

Jupyter's official messaging specification separates kernel lifecycle from a
client UI and defines execution requests, busy/idle state, monotonic execution
counts, display data, inspection, interrupt, restart, and shutdown semantics.
Its kernel documentation also makes clear that a kernel is a long-running
language process with retained state. These are the relevant product semantics;
ScienceCode does not need to expose a Jupyter TCP connection to implement them.

Python's `code` module documents the stable interpreter-namespace model, while
the `sys` audit-hook documentation explicitly warns that Python-level audit
hooks are not a sandbox. Python's subprocess documentation reinforces the
separate-process lifecycle and timeout boundary. Base R's `source` documentation
describes parsing and evaluating expressions in a chosen environment, which
supports an analogous persistent R namespace.

Primary sources:

- [Jupyter Client kernel lifecycle](https://jupyter-client.readthedocs.io/en/stable/kernels.html)
- [Jupyter messaging protocol](https://jupyter-client.readthedocs.io/en/latest/messaging.html)
- [Python interactive interpreter objects](https://docs.python.org/3/library/code.html)
- [Python subprocess management](https://docs.python.org/3/library/subprocess.html)
- [Python audit hooks and their security limitation](https://docs.python.org/3.12/library/sys.html)
- [R base `source`](https://stat.ethz.ch/R-manual/R-devel/library/base/help/source.html)

ScienceCode therefore uses one project-owned child process per live language,
a private stdin/file protocol, an append-only execution counter, explicit busy,
interrupt, restart, and shutdown states, and no unauthenticated local network
socket. Restart restoration is a deliberate user action because replaying code
can repeat external side effects. The record verifies reproducibility facts; it
does not claim to confine arbitrary code.

## Windows ML and AMD Ryzen AI NPU execution

Microsoft positions Windows ML as the Windows App SDK path for discovering,
acquiring, registering, and selecting ONNX Runtime execution providers. Its NPU
guidance distinguishes a physical NPU from the software stack needed to target
it, and the supported-provider table identifies Vitis AI for AMD hardware.
Provider readiness can require package acquisition through
`EnsureReadyAsync`; that is a state-changing setup operation, not an inference
side effect.

AMD's Windows ML documentation uses the Vitis AI execution provider for Ryzen
AI deployment and describes model compatibility and provider selection as
deployment concerns. The official examples reinforce that an available device
or registered provider does not prove a particular model ran there. ONNX
Runtime profiling does provide provider labels on executed events, which is
the bounded evidence ScienceCode archives.

Primary sources:

- [Windows ML overview](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview)
- [Windows NPU development guide](https://learn.microsoft.com/en-us/windows/ai/npu-devices/)
- [Windows ML supported execution providers](https://learn.microsoft.com/en-ie/windows/ai/new-windows-ml/supported-execution-providers)
- [Windows ML execution-provider initialization](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/initialize-execution-providers)
- [AMD Windows ML overview](https://ryzenai.docs.amd.com/en/latest/winml/winml_overview.html)
- [AMD Windows ML model deployment](https://ryzenai.docs.amd.com/en/latest/winml/model_deployment.html)
- [AMD Ryzen AI software examples](https://github.com/amd/RyzenAI-SW)
- [Microsoft Windows ML samples](https://github.com/microsoft/WindowsAppSDK-Samples/tree/main/Samples/WindowsML)

ScienceCode therefore keeps GPU and NPU environments independent, permits
provider acquisition only during explicit setup, and treats `--device npu` as a
strict provenance claim. A successful record requires at least one archived
Vitis provider profile event; explicit fallback remains visible and cannot be
relabeled as NPU execution. Event counts are not represented as unique graph
nodes. Device enumeration is kept independent from AppX inventory, and a
degraded catalog may reuse only the exact previously recorded provider DLL
inside the protected Microsoft AMD WindowsApps package; that recovery does not
authorize acquisition and does not replace execution-profile evidence. This is
an ONNX inference adapter, not a claim of universal operator
coverage, model conversion, training, energy efficiency, or performance
superiority.

## OpenCode

OpenCode provides the replaceable agent engine. Its repository and current
documentation define project-local skills, primary/subagents, permissions,
and on-demand skill loading. The project is MIT-licensed.

Primary sources:

- [OpenCode repository](https://github.com/anomalyco/opencode)
- [OpenCode server and programmatic API](https://opencode.ai/docs/server/)
- [OpenCode agents](https://opencode.ai/docs/agents/)
- [OpenCode agent skills](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/skills.mdx)
- [OpenCode specialized agents](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/agents.mdx)

ScienceCode keeps this engine pinned and isolated. Scientific behavior,
compute, provenance formats, experiment review, and Lab UX belong to
ScienceCode rather than to a user's existing OpenCode installation.
OpenCode supports programmatic prompting and persistent sessions; ScienceCode
uses those session semantics while keeping every browser turn inside its own
recorded-run and audit lifecycle.

## Agent Skills

Anthropic's public skills repository demonstrates self-contained `SKILL.md`
packages with instructions, scripts, and resources loaded for specialized
tasks. Its repository explicitly contains mixed licensing: many examples are
Apache-2.0, while document skills are source-available reference material.

Primary source:

- [Anthropic Agent Skills repository](https://github.com/anthropics/skills)

ScienceCode uses the interoperable skill pattern and writes original
science-specific protocols. Source-available skill implementations must not be
copied into this MIT project without a compatible license.

## PaperQA2

FutureHouse's PaperQA2 focuses on grounded scientific-document answers with
in-text citations, metadata-aware retrieval, reranking/contextual summaries,
agentic query refinement, and reusable local full-text indexes. It supports
multiple document formats and model providers. The repository is Apache-2.0.

Primary source:

- [FutureHouse PaperQA2](https://github.com/Future-House/paper-qa)

The useful pattern for ScienceCode is a local evidence index whose answers
retain page/chunk provenance, document metadata, and exact retrieval settings.
PaperQA2 should be evaluated as an optional adapter rather than copied or made
a mandatory dependency of the base GPU runtime.

## Scientific claim verification and metadata resolution

SciFact frames scientific claim verification as both a label and an evidence-
rationale problem. That separation supports ScienceCode's decision to expose
the exact cited span and a triage signal without relabeling lexical overlap as
support or refutation. Crossref's REST API provides canonical scholarly DOI
metadata, but live metadata changes would weaken replayability if fetched while
verifying an archived manuscript. Version 0.13 therefore resolves DOI citations
only against metadata already frozen in a ScienceCode evidence record; a future
network adapter must ingest and hash its response before review.

Primary sources:

- [SciFact paper](https://arxiv.org/abs/2004.14974)
- [Crossref REST API documentation](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

## Robin

FutureHouse's Robin demonstrates a multi-agent scientific-discovery workflow
that generates/ranks experimental assays and therapeutic candidates, can feed
experimental analysis back into candidate generation, uses Jupyter as an
inspection surface, and recommends container isolation. The repository is
Apache-2.0, but some analysis features require the separate Edison service.

Primary source:

- [FutureHouse Robin](https://github.com/Future-House/robin)

ScienceCode takes the inspectable workflow and role-separation pattern. It
must not make a paid external scientific service a hidden requirement.

## Scientific-agent harnesses and biomedical discovery

Google's AI co-scientist uses a supervisor to allocate specialized generation,
reflection, ranking, evolution, proximity, and meta-review processes. Its
reported biomedical evaluations also keep expert review and experimental
validation in the loop. Stanford's Biomni combines retrieval-augmented
planning, executable code, biomedical tools, and a protocol/know-how library;
its documentation explicitly warns that generated code is not inherently safe.

Primary sources:

- [Google Research: AI co-scientist](https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/)
- [Stanford SNAP: Biomni](https://github.com/snap-stanford/Biomni)
- [FutureHouse: Robin](https://github.com/Future-House/robin)

The key ScienceCode design decision is a visible, evidence-derived work queue:
supervision, evidence, hypothesis, method, computation, review, and recording
are distinct responsibilities, but the UI only marks a lane active or complete
when an actual job, tool event, transcript, or verified artifact supports it.
The base product remains provider-neutral and does not require a proprietary
biomedical service.

## Tool-grounded laboratory and chemistry agents

Coscientist demonstrated a modular planner with literature/document search,
code execution, and laboratory-device APIs for experimental design and
optimization. ChemCrow demonstrated a chemistry agent grounded in a set of
expert chemistry tools for synthesis, discovery, and materials work. XDL 2.0
defines a hardware-independent, machine-readable chemical procedure language;
later chemputation work demonstrates a literature-to-XDL-to-simulation-to-
hardware validation path.

Primary sources:

- [Nature: Autonomous chemical research with large language models](https://www.nature.com/articles/s41586-023-06792-0)
- [Nature Machine Intelligence: ChemCrow](https://www.nature.com/articles/s42256-024-00832-8)
- [XDL 2.0 standard](https://croningroup.gitlab.io/chemputer/xdl/standard/index.html)
- [Communications Chemistry: automated chemical procedure development](https://doi.org/10.1038/s42004-026-01993-w)

ScienceCode therefore treats procedures as versioned scientific objects with
inputs, equipment, parameters, expected observations, controls, acceptance
criteria, hazards, stop conditions, and provenance. XDL and instrument-specific
formats are adapters, not proof that a procedure is executable. Physical work
requires compatibility validation, a simulation or dry run, safety review, and
named human approval.

## Drug-development AI credibility

The FDA's January 2026 Guiding Principles of Good AI Practice in Drug
Development emphasize human-centered design, a risk-based approach, a clear
context of use, data governance and provenance, performance assessment,
lifecycle management, and understandable limitations. The FDA's credibility
framework for AI used in regulatory decision-making organizes assessment around
the question of interest, context of use, model risk, a credibility plan,
execution, deviation documentation, and adequacy. Although that draft framework
does not make discovery-stage software regulatory-ready, its structure is a
useful conservative pattern for consequential scientific decisions.

Primary sources:

- [FDA: Guiding Principles of Good AI Practice in Drug Development](https://www.fda.gov/media/189581/download)
- [FDA: AI Model Credibility Assessment Framework](https://www.fda.gov/media/184830/download)

ScienceCode applies these as workflow controls: every discovery board states
its context of use and risk, model scores remain decision support rather than
biological or clinical proof, validation evidence stays visible, and physical
or clinical authorization is outside the product's autonomous authority.

## Open scientific compute adapters

The intended discovery stack favors established, inspectable open interfaces:
RDKit for cheminformatics, DeepChem for scientific machine learning, OpenMM for
molecular simulation, and ChEMBL's documented API for bioactivity data. These
are capability targets, not undeclared dependencies of the 0.12 base runtime.

Primary sources:

- [RDKit documentation](https://www.rdkit.org/docs/Overview.html)
- [DeepChem](https://deepchem.io/about/)
- [OpenMM user guide](https://docs.openmm.org/latest/userguide/introduction.html)
- [ChEMBL data web services](https://www.ebi.ac.uk/chembl/api/data/docs)

## The AI Scientist and AI Scientist v2

Sakana AI's projects organize scientific automation around structured
ideation, literature novelty checks, experiment execution, paper generation,
and review. Version 2 uses best-first agentic tree search with multiple workers,
seeds, debugging depth, and separate writing/citation/review phases. Its
documentation also warns about executing model-written code and CUDA memory.
AI Scientist v2 uses a custom Responsible-AI-derived source-code license with
mandatory disclosure for generated manuscripts, not a permissive MIT/Apache
license.

Primary sources:

- [The AI Scientist](https://github.com/SakanaAI/AI-Scientist)
- [The AI Scientist v2](https://github.com/SakanaAI/AI-Scientist-v2)

ScienceCode implements original bounded experiment matrices and reviewer
checks. It does not incorporate AI Scientist code. Future autonomous branching
must be opt-in, budgeted, sandboxed, human-reviewable, and disclose AI
involvement in research outputs.

## Decisions implemented through 0.39.0

1. Preserve the standalone product boundary and pinned local OpenCode engine.
2. Provide an isolated, manifest-pinned Python/CUDA scientific runtime.
3. Treat simulations as append-only experiments with source, input, runtime,
   seed, device, output, hash, and audit provenance.
4. Freeze hypotheses and complete multi-seed parameter matrices before
   execution; link every child simulation to the parent plan.
5. Generate aggregate CSV and deterministic calculation/coverage review, then
   independently cross-check plan, aggregate, reviewer, and child records.
6. Give the agent stack a simulation specialist, experiment workflow, and
   separate read-only experiment reviewer.
7. Provide a loopback-only Lab for compute, matrices, figures, artifacts, and
   verification evidence.
8. Make chat the primary workbench interaction. Continue one isolated OpenCode
   session across turns and preserve every prompt/response as a hash-linked
   transcript.
9. Cross-link each conversation turn to its recorded run and to simulations,
   experiments, preregistrations, or nested runs created while handling it.
10. Permit mutations only through narrow same-origin JSON chat routes with
    secret preflight, request bounds, serialized turns, and the existing
    scientist-agent destructive-operation guardrails.
11. Run Lab turns asynchronously and expose a bounded activity trace built
    from safe tool metadata, never raw tool inputs or outputs.
12. Classify research goals into drug-discovery, procedure, computational,
    evidence, or general workflows with explicit context-of-use, risk, review,
    and physical-execution gates.
13. Provide specialist discovery, procedure, safety, methodology, evidence,
    computation, review, and recorder lanes while deriving visible status only
    from real jobs and verified records.
14. Make generated code, CSV/TSV, and `.xlsx` outputs editable and
    molecular/mesh text artifacts directly rotatable, zoomable, and selectable
    in the local Lab.
15. Preserve archived artifacts and store user edits, table changes, 3D view
    state, selections, and board direction as a separate hash-chained record
    that becomes context for the next AI turn.
16. Give CSV, TSV, and active `.xlsx` worksheets a native bounded plot view
    whose axes, viewport, selected source row, and plain-language direction can
    be shared with the AI without changing the archived data.
17. Give manifest-bound raster figures an annotation workspace with pan,
    anchored zoom, normalized coordinates, observations, questions, revision
    requests, and explicit superseding annotation clears.
18. Keep plot and figure math dependency-free and testable, cap rendered plots
    at 5,000 evenly sampled points, and retain the producing record link in each
    interaction.
19. Add a project-local immutable evidence library for PDF, Markdown,
    reStructuredText, and text sources with bibliography, page, span, artifact,
    manifest, and audit hashes.
20. Use exact-pinned Mozilla PDF.js in a bounded child process for text-layer
    extraction; document that scanned image-only sources require OCR first.
21. Make retrieval deterministic and inspectable with versioned Unicode
    tokenization, stop words, BM25 parameters, exact corpus manifest hashes,
    ranked span hashes, and raw-query omission from retrieval records.
22. Quote evidence to the model as bounded JSONL data with explicit
    prompt-injection handling and stable evidence-ID/page citations.
23. Replay each chat turn's ranking against its historical corpus during
    verification, so cited-source tampering fails while later additive evidence
    does not invalidate prior work.
24. Give the Lab same-origin evidence ingestion, search, bibliography,
    immutable-source, and page-reader controls; record source/page selection and
    user direction as interaction context for the next AI turn.
25. Add persistent Python and optional R project kernels with one live namespace
    per language, monotonic cell numbering, bounded streams/results/variables,
    dependency identity, Matplotlib figure capture, and project-file diffs.
26. Store every attempted cell as append-only source, outputs, result, artifacts,
    runtime/process identity, previous-cell link, independent digest, and audit
    event; failed, timed-out, and interrupted cells remain verifiable but fail
    the default outcome gate.
27. Make restore explicit, verify the complete cell chain before replay, refuse
    histories containing non-completed cells, and offer a clean namespace that
    preserves but does not load older records.
28. Add a first-class Lab Notebook workspace with editable new cells, immutable
    history, variable insertion, dependency and file-change inspection, rich
    outputs, interruption, runtime status, and responsive Python/R tabs.
29. Link cells to conversations and combine verified recent notebook state with
    user-authored notebook interactions in the next engine prompt. Treat values
    as untrusted JSONL data and revalidate exact context during transcript
    verification.
30. Add same-origin kernel APIs, lifecycle cleanup on Lab shutdown, project-lock
    and realpath escape defenses, `sciencecode kernel` inspection/execution
    commands, and explicit failed-cell project-gate policy.
31. Derive one stable scientific lineage graph from the normal integrity
    verifiers rather than maintaining a second mutable provenance database.
32. Represent evidence citations, turns, engine runs, notebook cells,
    code/data inputs, experiments, simulation branches, artifacts, and user
    revisions as namespaced nodes with explicit directed relationships.
33. Sort and hash scope, nodes, edges, and deterministic review findings so an
    unchanged record set produces the same graph digest; fail the project gate
    on broken or unverified lineage while keeping valid failed outcomes as
    visible warnings.
34. Add a dependency-free Lab graph with pan/zoom, filtering, inspection,
    upstream/downstream focus, and AI handoff. Record each selected/shared trace
    as bounded hash-chained user context without mutating archived artifacts.
35. Persist exact replacement code, delimited data, workbook, or other bounded
    bytes as a new immutable record linked to a manifest-verified source URL,
    source record digest, source artifact digest, creation chat, and audit event.
36. Treat each saved replacement as a proposal. Store accept/reject review in a
    separate hash chain with its own audit links; derive current status from the
    latest verified decision and never rewrite the proposal manifest.
37. Link repeated proposals through verified prior-revision manifest and
    artifact hashes, cap ancestry at 256, and keep audit-referenced records
    discoverable when a directory is removed or replaced by a filesystem link.
38. Add same-origin bounded text/binary APIs, CLI create/list/show/verify/decide,
    and inline code/CSV/XLSX revision ledgers with exact file access and explicit
    acceptance controls.
39. Give the next AI turn exact immutable manifest and replacement-file paths
    plus status semantics, and instruct it never to substitute a rejected
    revision. Record proposal and decision handoffs through the existing
    interaction chain.
40. Extend lineage with revision and decision nodes plus source derivation,
    prior-version, review, production, containment, and interaction links.
41. Route SMILES, MOL, and SDF artifacts into a dependency-free chemical
    depiction studio with molecule switching, atom selection, anchored zoom,
    panning, recorded properties, explicit-atom summaries, and optional reuse
    of the rotatable 3D coordinate viewer.
42. Bound chemical parsing by molecule, atom, bond, and character counts;
    support graph-level branches, ring closures, disconnections, charges, and
    aromatic bonds while explicitly declining canonicalization, implicit-
    hydrogen, stereochemical, valence, reaction, and chemical-validity claims.
43. Route BED/bedGraph, GFF/GTF, VCF, and FASTA-family artifacts into a linear
    genomic studio with contig/region navigation, typed track filters, feature
    selection, signal bars, coordinate ticks, and close-zoom sequence letters.
44. Normalize BED, GFF/GTF, and VCF positions into a labeled zero-based
    half-open viewport without rewriting source bytes; cap features, contigs,
    sequence retention, drawn features, and AI payloads rather than pretending
    to provide an indexed large-cohort genome browser.
45. Give Markdown/MDX, TeX, and reStructuredText artifacts a split editor with
    selectable line changes, exact LCS diffs inside a fixed cell budget, and an
    explicitly coarse middle-replacement display beyond that budget. Always
    download and revision the exact draft, never a reconstruction from the
    display diff.
46. Put chemical, genomic, and manuscript selections plus bounded source edits
    into the existing secret-scanned interaction chain, and put complete edits
    into immutable revision proposals. Serve every parser locally with explicit
    MIME types and no CDN or third-party upload.
47. Review only a verified immutable manuscript artifact or exact saved
    revision. Preserve the reviewer as a separate hashed report and manifest,
    and deterministically replay the complete analysis during verification.
48. Extract bounded prose claims with source-line and text-hash locators while
    skipping code fences and bibliography sections. Resolve only ScienceCode
    evidence IDs, spans, pages, and DOI metadata already frozen at ingestion.
49. Record lexical overlap, literal-number agreement, and negation mismatch as
    deterministic prioritization signals, never support/refutation labels.
    Preserve exact excerpts so an independent critic can inspect scope.
50. Evaluate only explicit arithmetic directives through a small finite parser
    with no dynamic evaluation. Keep variable equations, units, statistics,
    rounding policy, and domain assumptions outside deterministic claims.
51. Resolve data, code, and figure links through the existing manifest-bound
    record verifiers. Do not fetch external figures or infer that nearby code
    produced matching pixels; expose those limits as report findings.
52. Add one read-only semantic-reviewer agent whose job is to verify the record,
    inspect exact cited and linked artifacts, recalculate load-bearing values,
    and propose the smallest safe correction without rewriting the manuscript.
53. Add a Reviewer workspace and manuscript review actions that expose
    claim-level evidence, calculations, artifact traces, limits, and user
    direction. Save changed drafts as immutable revisions before reviewing them.
54. Put reviews into the harness, lineage graph, AI interaction context, CLI,
    Lab API, and project gate while keeping scientific attention status distinct
    from provenance integrity failure.
55. Freeze a strict normalized analysis contract only after its linked
    preregistration, preserving exact script bytes plus population, conditions,
    missingness, multiplicity, outcome roles, operational definitions, branch
    filters, aggregations, minimum counts, thresholds, exclusions, and
    sensitivities.
56. Bind the contract, preregistration, script, and manifest digests directly
    into experiment plan and manifest before any branch runs; refuse execution
    when the source script no longer matches.
57. Replay thresholds only over integrity-verified planned branch results and
    keep outcome verdict, prospective/deviated/unregistered status, automatic
    deviations, and disclosed deviations as separate report fields.
58. Store contracts and assessments through exclusive staging and atomic
    publication with deterministic whole-record replay, audit-backed deletion
    discovery, filesystem-link containment, and immutable current/historical
    assessment semantics.
59. Add the editable Confirmatory Lab workspace, branch-level result cards,
    same-origin API, CLI lifecycle, harness gates, lineage relationships,
    project integrity counts, and bounded user direction for the next AI turn.
60. Add a confirmatory-analysis skill, `/confirmatory` workflow, and read-only
    confirmatory-reviewer while explicitly declining p-value, confidence-
    interval, causal, clinical, or regulatory conclusions from threshold replay.

61. Normalize one strict vendor-neutral procedure schema with immutable
    evidence links, explicit supersession, bounded resources, controls, hazards,
    dependency-linked steps, acceptance/deviation rules, and the mandatory
    external-human-control policy.
62. Publish plans exclusively through staging and atomic rename, bind canonical
    request/procedure bytes and evidence or prior-plan digests, and discover
    removed records from audit history.
63. Replay a versioned deterministic logical dry-run for graph order, cycles,
    references, material totals, known duration, domain controls, hazard
    hierarchy, training, emergency, stop, and source gates.
64. Map only named neutral operations to XDL 2.0 and Opentrons concepts. Label
    every preview non-executable and list the exact platform binding and vendor
    validation still required.
65. Store each dry-run as a separate immutable assessment. Derive newest
    verified assessment per exact plan and keep older results inspectable.
66. Store human decisions separately with exact plan and assessment digests,
    scope, reviewer-provided role, basis, conditions, attestation, and optional
    expiry. Never mark identity verified or enable physical execution.
67. Reject approval of blocked assessments, require expiry for external
    physical scope, cap it at 366 days, and make a decision ineffective after
    expiry, a newer assessment, a scope decision, or plan supersession.
68. Add Procedure Studio with editable JSON, live draft graph, revision
    loading, immutable freeze, dry-run and decision forms, selectable
    steps/gates/findings/adapters, exact JSON, and bounded AI handoff.
69. Replace the harness placeholder with current plan, assessment, gate,
    adapter, decision, and limitation state; add the same records to lineage,
    chat links, interactions, CLI, same-origin APIs, and project verification.
70. Give bundled agents the exact record workflow and prohibit them from
    fabricating a human decision or turning a mapping preview into hardware
    instructions.
71. Keep CUDA/PyTorch and Windows ML/ONNX in separate isolated, pinned runtimes
    so adding the NPU does not disturb the GPU stack or system Python.
72. Detect the Windows NPU, driver, and provider packages without claiming
    execution; allow provider acquisition only during explicit NPU setup.
73. Require archived ONNX Runtime Vitis provider events for a strict NPU claim.
    Call them profile events rather than inferring a unique graph-node count.
74. Preserve exact ONNX models, name-keyed inputs, NPY outputs, bounded previews,
    latency, profiles, runtime/device state, fallback policy, hashes, and audit
    links in a backward-verifiable immutable inference record.
75. Put NPU readiness, recorded inference outcomes, output inspection,
    manifest-bound downloads, lineage, project gates, and chat links in the
    existing visible workbench instead of a detached hardware utility.
76. Make Lab turns cancellable through a same-origin, chat-bound request;
    preserve partial run/transcript evidence and give the next AI turn the
    hash-chained user stop as incomplete-work context.
77. Project completed OpenCode text-part events into a separate ephemeral live
    response contract: opt-in only, re-redacted, UTF-8 bounded, rolling-window
    capped, repeated-part aware, absent from recorded activity, cancellation
    preserving, and explicitly labeled as block output rather than token
    streaming.
78. Make recorded NPU inference actionable inside the primary workbench rather
    than leaving it as a read-only archive: use one shared sync/async immutable
    recorder, a strict same-origin and bounded launch contract, canonical
    project paths, one active accelerator job, owned-worker cancellation with
    verified partial records, visible runtime/provenance events, and separate
    hash-chained conversation interactions. Require the bundled AI workflow to
    distinguish provider registration from profiled execution and keep
    fallback explicit.
79. Represent CAD as a bounded normalized contract with one entry file, up to
    256 declared source/assets, named parts, transforms, parameters, units,
    build volume, simulation assumptions, and a no-hardware policy.
80. Permit only static declared OpenSCAD references. Reject absolute or parent
    paths, dynamic imports, undeclared files, links, oversize trees, secrets,
    and descriptor drift before invoking a CAD tool.
81. Preserve conflict-safe source revisions separately from immutable builds.
    Snapshot the complete source tree, tool identity/output, JSON summary, STL,
    independent topology/geometry report, manifest, and audit link.
82. Keep the native CAD screen explicitly limited to geometry and printability
    triage. Bind recorded CPU/GPU solver scripts to the verified immutable mesh
    when model equations and validation evidence are required.
83. Default slicing to a no-extrusion, zero-temperature preview; require a
    separate physical-risk acknowledgement for project profiles, reject
    post-process hooks, analyze the resulting G-code, and provide no printer
    transport.
84. Give Lab a responsive multi-file editor, shaded rotatable/selectable mesh,
    geometry reports, job provenance, model/slice history, and editable G-code.
    Persist relevant user gestures and directions for the next AI turn.
85. Give the bundled Scientist a dedicated CAD specialist, skill, and command,
    while preserving the hard distinction among record integrity, geometry
    screening, physics validity, slice generation, and physical authorization.
86. Make CAD-linked CPU/GPU models launchable from the same interactive
    workspace as their verified mesh, with a strict bounded request and one
    active operation per CAD project.
87. Share simulation preparation and finalization between synchronous CLI and
    asynchronous Lab execution. A user stop must terminate the owned process
    tree, preserve partial evidence in a verified cancelled record, remain a
    failed outcome by default, and require exact project/build/chat binding.
88. Refresh NVIDIA memory before Lab auto/CUDA dispatch and refuse launch below
    a bounded reserve. Treat the probe as denial-of-service mitigation, never a
    scheduler, reservation, or guarantee of future memory availability.
89. Add an explicit engine discriminator while retaining schema-v1 OpenSCAD
    verification: omitted historical engine fields normalize to `openscad`,
    while new projects bind entry type, editable source type, and output
    expectations to `openscad` or `cadquery`.
90. Install CadQuery only in a dedicated `python-cad-v1` environment under
    `SCIENCECODE_HOME`. Hash both pinned requirements and the packaged adapter
    into its manifest, report stale definitions as not ready, and require an
    explicit refresh that preserves the prior runtime until replacement.
91. Execute CadQuery with isolated Python, bytecode writes disabled, bounded
    output/timeout, explicit JSON parameters, and fixed linear/angular
    tessellation. Accept only a Workplane, Shape, or Assembly build result.
92. Export every CadQuery build to the same independently analyzed ASCII STL
    contract used downstream by OpenSCAD, plus a manifest-bound STEP artifact
    for mechanical interchange. Canonicalize only volatile STEP timestamp
    metadata and require repeat-build byte equality in the real smoke.
93. Rehash the complete declared source snapshot after any CAD engine exits.
    Fail a build that adds, removes, or mutates source, preserve the failed
    record, and state plainly that this detects but does not undo Python side
    effects.
94. Keep source editing engine-aware and conflict-safe: SCAD and Python are
    editable with immutable revisions, while binary CAD assets are readable as
    metadata but never decoded as text.
95. Route CadQuery through the existing verified mesh screen, recorded
    CPU/GPU model, PrusaSlicer, harness, interaction, lineage, and project-gate
    contracts rather than creating a second unverifiable CAD product.
96. Show the chosen engine, editable many-file tree, rotatable STL, verified
    STL/STEP downloads, reports, jobs, slices, model outcomes, and user
    interactions in Lab so both the user and next AI turn see the real state.
97. Treat CadQuery files as arbitrary Python with user OS permissions.
    Runtime/package isolation is not filesystem, process, or network
    containment; retain this residual risk in product, security, and LLM
    guidance.
98. Permit immutable declared STEP/IGES/BREP assets to participate in a
    CadQuery program through `SCIENCECODE_SOURCE_ROOT`. Bind the exact binary
    hash, require a new output rather than source overwrite, and exercise a real
    STEP import plus measurable transform in the reusable smoke.
99. Add a backward-compatible campaign schema v2 with one immutable ordered
    hypothesis tree. Require roots or earlier parents and label every child as
    an alternative, refinement, mechanism, or rebuttal.
100. Bind each hypothesis branch to its own task-attempt, GPU-task, and NPU-task
    ceiling inside a global attempt, accelerator, and wall-clock budget. Gate
    every dispatch against the task DAG and all active linked branches.
101. Derive campaign state only from the immutable plan and an append-only,
    sequence-numbered, previous-hash event ledger with a separately verified
    head and audit links. Preserve attempts, retries, stops, and task outcomes.
102. Store hypothesis verdict and branch resource decision as separate
    superseding local-user events. Allow only completed task links declared for
    the branch; prohibit automatic pruning and the contradictory combination
    of a falsified verdict with promotion.
103. Make final assessment result-relative: if relevant work completes or is
    skipped after the latest verdict, label the prior verdict stale and require
    a fresh assessment before an active settled branch can complete.
104. Let the AI propose task plans and verdict recommendations but never submit
    the canonical assessment action. Add Scientist command denial and explicit
    disclosure that this local workflow boundary is not authenticated identity.
105. Add Campaigns Studio, main-harness next-action readout, one-turn live task
    execution, task and branch controls, assessment evidence selection, event
    ledger, interaction context, lineage relations, CLI/API, and project counts
    over the same replayed state.
106. Verify schema-v1 replay, tree/policy/task validation, global and branch
    budget refusal, retry and cancellation, stale assessment, task-link
    semantics, engine config, Lab origin contracts, tampering, lineage, and the
    project gate without model-provider cost in the default suite.
107. Install packaged CAD simulation templates only through a fixed-name,
     fixed-destination, same-origin route. Reuse an exact regular file, reject a
     differing destination, and never let the request choose an overwrite path.
108. Add one bounded native `cad-surface-heat` model over the verified STL:
     deduplicated surface vertices, unique triangle edges, normalized explicit
     graph diffusion, fixed hot/cold face bands, strict parameters and mesh caps,
     and refusal when the dimensionless stability number exceeds 0.45.
109. Preserve the equation, units, mesh scale, integration state, boundary and
     component counts, exact parent hashes, runtime device, and finite, pinning,
     and maximum-principle checks beside immutable JSON, CSV history, and
     per-vertex temperature PLY outputs.
110. Make scalar PLY results native interactive workbench artifacts: bounded
     property-aware parsing, a labeled color legend, rotatable mesh, selected
     vertex/value readout, and hash-chained range/value context for the next AI
     turn, harness, lineage, and project gate.
111. Dispatch the model through the existing fresh CPU/CUDA hardware gate and
     record the actual device. Do not present Windows ML NPU readiness as general
     PyTorch solver execution, and do not crowd or terminate unrelated GPU work
     merely to produce an accelerator result.
112. Let a bounded experiment optionally bind one verified CAD build. Freeze
     the exact build manifest and mesh hashes in its plan, manifest, audits,
     every child simulation, verification replay, and direct lineage edge so a
     comparison cannot silently mix geometry revisions.
113. Reuse the existing sorted-seed Cartesian planner and 64-run ceiling for
     CAD studies. Validate strict Lab JSON, serialized size and secrets, then
     initially run the matrix in the isolated CAD worker with a bounded overall
     timeout and fresh free-VRAM refusal for auto/CUDA. Decisions 160-164 move
     Lab orchestration to the cancellation-safe async experiment finalizer.
114. Extract comparable scalar statistics at the experiment recorder rather
     than changing an already installable simulation template. This keeps
     fixed-destination exact-byte reuse backward compatible while allowing the
     nested surface-thermal final state to participate in deterministic CSV and
     reviewer replay.
115. Put study authoring and outcomes inside CAD Studio: fixed values,
     variations, seeds, hypothesis, aggregate cards, branch parameters, direct
     opening of rotatable scalar fields, immutable links, and an explicit share
     action whose bounded counts and aggregates reach the next AI turn and main
     harness board.
116. Do not expose study cancellation until a coherent immutable experiment
     ledger can be guaranteed under interruption. Decisions 160-164 satisfy
     that condition with completed/cancelled/`not_run` replay. Preserve the hard
     distinction between sensitivity comparison and model/FEA validation, and
     never claim NPU execution for a PyTorch CPU/CUDA CAD model.
117. Compare only two distinct manifest-verified PNG artifacts or immutable PNG
     revisions. Resolve them through the existing source verifiers, retain exact
     source copies and record hashes, and never fetch an external or mutable
     image for a reproducibility claim.
118. Use a dependency-free bounded PNG decoder that verifies chunk CRC and
     structure, caps source bytes/chunks/dimensions/pixels/decompression, accepts
     a declared non-interlaced 8-bit color subset, implements all five row
     filters, and canonicalizes every source to RGBA before comparison.
119. Freeze comparator/version, integer RGBA tolerance, accepted changed-pixel
     fraction, dimensions, source digests, and settings digest. Record exact and
     thresholded changes, RGBA MAE/RMSE, per-channel and maximum deltas, changed
     bounding box, deterministic report, and an exact absolute-difference PNG.
120. Re-resolve originals and recompute the entire report during verification;
     compare decoded difference pixels rather than relying on compressor byte
     identity. Keep a scientific `different` outcome integrity-valid and visible
     as attention, while any record/source/report/audit mutation fails closed.
121. Put comparison create/list/show/verify in CLI and same-origin Lab APIs,
     project counts/gate, harness activity/design/validation, and lineage with
     baseline/candidate and produced-artifact relationships.
122. Add one interactive figure surface for baseline, candidate, adjustable
     blend, gain-adjusted difference, and exact drag-selected pixel region.
     Preserve the source images; send the comparison metrics, hashes, region,
     view, and bounded user note through the existing hash-chained AI interaction
     context with an explicit pixel-only scientific limitation.
123. Do not let a failing AppX inventory query erase independently discovered
     NPU hardware. Preserve the inventory error, accept a provider fallback only
     from the runtime manifest's fixed Microsoft AMD WindowsApps DLL path with
     equivalent Node/Python validation, forbid acquisition during status or
     inference, and continue to require profiled Vitis execution for a claim.
124. Version the figure comparator while replaying schema-v1 pixel-only reports
     exactly. For version 2, alpha-composite decoded RGBA over a frozen white
     matte in linear-light sRGB, convert to Rec. 709 luminance, and compute a
     sample-weighted mean of deterministic fixed 8x8 SSIM blocks.
125. Record mean/minimum similarity, worst-block coordinates, luminance errors,
     and an optional minimum score. When that score is configured, require both
     the existing pixel rule and the structural rule to pass; surface both rules
     through CLI, same-origin Lab, interactions, harness, lineage, and gate
     counts.
126. Label block-luminance SSIM as a narrow mechanical diagnostic. Do not claim
     registration, learned perceptual equivalence, semantic plot agreement,
     source-data validity, or a domain-valid scientific threshold.
127. Keep Lab responsiveness subordinate to record integrity. Preload regular
     project-file SHA-256 digests with bounded parallel I/O, but let the existing
     synchronous verifiers decide every result and discard any preload that
     observes a file changing during the read.
128. Reuse file digests, audit parses, and audit verification only while device,
     inode, mode, size, nanosecond modification time, and change time match.
     Bound retained entries, invalidate audit state on append, and rehash a
     same-size edit even if its modification time is restored.
129. Reuse a complete default-provider Lab state only after a fresh deterministic
     `.sciencecode` plus `cad` metadata fingerprint matches. Invalidate accepted
     mutations, confirm the fingerprint after building, retry one moving
     snapshot, disable reuse around filesystem links, and disclose cache state
     and verification time to both API and UI.
130. Replace Windows-wide signed-driver enumeration with structured native PnP
     XML, a narrow registry service read, and an exact Windows ML package query.
     Cache ordinary hardware display state for five minutes while preserving an
     explicit forced refresh and the separate profiled-execution requirement.
131. Treat verified Lab state as a prerequisite for state-dependent interaction.
     Show explicit initial progress, mark the workspace busy, and keep mutation
     and navigation controls disabled until a usable state exists. On initial
     failure, preserve an actionable error rather than presenting a blank ready
     conversation.
132. Keep conversation selection atomic in the UI. If chat or harness retrieval
     fails, restore the prior selected chat, URL, content, and harness; when no
     prior chat is loaded, return to a coherent draft state. Do not allow a
     selection request to overwrite or hide the latest integrity status.
133. Make workbench state perceivable without color or pointer use: retain the
     integrity label on narrow screens, expose current workspace state, move
     focus after hiding its source view, implement the harness tab keyboard
     model, provide a skip target, and honor reduced-motion scrolling.
134. Optimize the loopback wire format only when measurement supports it.
     Compact JSON removes indentation without changing values or schema. Do not
     enable per-response gzip merely for smaller byte counts when local timing
     shows the compression CPU makes unchanged state requests slower.
135. Translate stable domain error codes through one shared boundary module.
     Keep the CLI and Lab from maintaining independent tables that silently
     diverge as simulation, experiment, inference, review, figure, and campaign
     tools are added.
136. Preserve actionable distinctions: malformed or invalid input is CLI usage
     status 2 and HTTP 400; a well-formed absent record is CLI operational
     status 1 and HTTP 404; payload, conflict, runtime, secret, and executable
     failures retain their specific outcomes. Honor explicit HTTP status first
     and fail unknown codes closed as HTTP 500 or CLI status 1.
137. Test error semantics at the real dispatch boundaries, not only as a unit
     table. Exercise malformed and absent identifiers across current command
     families and Lab detail routes, and include the shared module in the
     package syntax gate.
138. Make the Simulations and Experiments archives native authoring surfaces,
     not read-only ledgers. Expose scripts, runtime policy, typed parameters,
     seeds, inputs, CAD parents, hypotheses, variation matrices, and prospective
     analysis contracts through bounded accessible controls.
139. Give experiments an asynchronous execution path that shares synchronous
     preparation and finalization. On cancellation, retain completed and active
     branch evidence, mark undispatched branches `not_run`, and finish the
     parent review, manifest, audit, and verification record.
140. Serialize standalone Lab simulations and experiments through one local
     active-job boundary. Publish only bounded status/events and redacted
     request shape; keep values, notes, raw logs, and artifacts out of the job
     projection, and require exact kind/chat bindings for a stop.
141. Recover active scientific-compute monitoring from verified Lab state,
     preserve cross-view job handoff, disable mutable controls while active,
     announce state and matrix validity, and collapse launch forms to one
     column on phones. Keep live browser and accessibility inspection as a
     separate release-machine obligation.
142. Resolve simulation and experiment scripts and declared inputs through the
     real filesystem before creating records. A lexically project-relative
     junction or symlink that targets outside the project must fail closed.
143. Make preregistration authoring native to the Confirmatory Lab. Require a
     structured Markdown plan with nine explicit planning sections and local
     completeness feedback, while treating the server replay as authoritative.
144. Freeze native plans as schema-v2 inline Markdown with exact bytes, hashes,
     required-section contract, exclusive record creation, and audit binding.
     Continue verifying schema-v1 project-file registrations and reporting
     their mutable-source drift.
145. Keep scientific record creation independent from chat. Registration,
     contract, and assessment creation must work without a conversation; an
     optional selected conversation receives only a separate bounded,
     secret-scanned interaction.
146. Expose verified registration list, detail, and exact-source routes plus
     Lab archive and lineage links. Refuse invalid frozen bytes rather than
     presenting them as source, and keep Markdown display text-only.
147. Validate the metadata root, preregistration registry, JSON record, mutable
     source, and frozen artifact through the real filesystem. Reject link or
     non-directory storage before writing and never parse a link-replaced
     record.
148. Put whole-project verification in the Lab without creating a competing
     implementation. `verifyProject` remains the single CLI/API authority; a
     separate module only normalizes policy and projects its result for local
     display.
149. Run the synchronous verifier in an owned cancellable child process. Permit
     one active gate, bound request, runtime, output, retained issues, per-issue
     bytes, jobs, and events, and keep the loopback event loop available for
     state, cancellation, and other reads.
150. Treat only the eight existing `failed_*` outcome classes as reviewable
     policy. Hash, schema, record, audit-chain, reference, registry, and lineage
     findings are integrity blockers and have no UI or API waiver. Count and
     disclose accepted failures even when the selected policy passes.
151. Expose a compact latest-gate summary in project state and the complete
     bounded report only through the process-local job detail. Redact issue
     values, include audit/lineage anchors and deterministic fingerprints, and
     make omission or truncation explicit rather than silently dropping data.
152. Make Verification a keyboard-native responsive workspace with native
     fieldset/checkbox/disclosure controls, live status, busy state, exact job
     cancellation, terminal focus, textual categories, and reload recovery.
     Static and loopback tests do not replace live release-machine browser,
     accessibility-tree, keyboard, and visual overflow QA.
153. Treat managed project snapshots as immutable historical baselines, not as
     a requirement that an evolving project remain forever equal to its latest
     capture. Whole-project verification checks manifest structure, digest,
     unique audit binding, registry containment, and audit integrity; explicit
     snapshot verification owns current-file drift policy.
154. Reuse `snapshot` and `verifySnapshot` as the only project-byte authorities.
     The managed layer may bound, publish, audit-bind, redact, categorize, and
     project their results, but must not implement a second hashing or drift
     algorithm. Preserve schema-1/legacy CLI manifest compatibility.
155. Run capture and verification in one owned cancellable child process at a
     time. Bound entry count, declared bytes, manifest bytes, request, runtime,
     worker output, retained findings, per-finding bytes, registry summaries,
     jobs, and events so large projects do not block the loopback server or
     create unbounded browser payloads.
156. Make capture two-phase: write only an exact job-bound pending manifest,
     immediately compare it under strict policy, independently rehash it in the
     parent, publish it with exclusive creation, remove the pending file, then
     append the exact audit binding. A cancelled job removes only its own
     uncommitted pending file; a committed manifest is never silently rolled
     back if a later audit append fails.
157. Require normal contained snapshot-store directories and manifest files,
     validate IDs and portable entry paths before access, and reject links,
     traversal, malformed metadata, unsupported schemas/algorithms, unsafe
     types/sizes/digests, missing/ambiguous audit bindings, and manifest tamper.
158. Expose create/list/exact-download/verify through strict same-origin JSON
     APIs with exact kind/ID/operation cancellation. Keep `/api/state` compact;
     return complete bounded diagnostics only from the process-local job, with
     secret redaction, explicit omissions, audit anchors, and deterministic
     fingerprints that exclude wall-clock generation time.
159. Make Reproducibility a keyboard-native responsive workspace with native
     strict-policy input and disclosures, live and busy status, cancellation,
     reload recovery, terminal focus, audit-binding labels, exact download,
     categorized textual drift, and phone layouts. Live browser,
     accessibility-tree, keyboard, cancellation/reload, and overflow QA remain
     a separate release-machine gate when no browser session is available.
160. Route Lab CAD parameter studies through the shared asynchronous experiment
     finalizer instead of treating the complete matrix as one non-interruptible
     CAD-worker transaction. Keep build, geometry-screen, and slicer provenance
     workers unchanged.
161. Bind CAD cancellation to the exact job, operation, project, build, and
     optional chat. Abort only the active simulation process; retain completed
     and interrupted child records and mark every undispatched branch `not_run`.
     Retain a cleared 24-hour whole-matrix timer in addition to branch timeouts;
     route its distinct reason through the same finalizer.
162. Finalize a cancelled study as an immutable experiment: recompute the
     deterministic review, results CSV/JSON, counts, manifest digest, audit
     finish binding, CAD-parent replay, and lineage. Integrity success does not
     waive the default failed-outcome gate.
163. Show bounded branch-start/finish progress, recover the active job after a
     Lab state reload, provide separate model and study stop controls, announce
     status through a polite live region, and label partial study sharing so the
     next AI turn cannot mistake it for a completed comparison.
164. Test cancellation inside a deliberately blocked second branch so one
     completed, one cancelled, and one unrun outcome prove coherent partial
     finalization, responsiveness, exact binding, artifact retention, retry,
     harness counts, lineage, and whole-project policy.
165. Treat bundled agents, commands, and skills as executable product contracts.
     CAD-facing guidance must describe the same cancellable partial-ledger
     behavior as Lab: stop only the active branch, preserve completed and
     interrupted artifacts, mark undispatched branches `not_run`, finalize and
     verify the partial experiment, and never label a partial aggregate complete.
     Compatibility tests reject the superseded non-cancellable instruction.
166. Make product accuracy an executable release gate, not an informal claim.
     Provide one versioned `sciencecode-core` suite covering reviewer detection,
     citation behavior, numerical review, reproducible reruns, scientific-safety
     instructions, and agent-role separation through the public CLI and
     `npm run check`.
167. Use exact prospectively declared expectations and a 1.0 threshold for this
     deterministic contract suite. Publish reviewer confusion counts, precision,
     recall, per-category accuracy, every expected/observed case, and failures.
     Never generalize fixture metrics to external documents or model quality.
168. Exercise production review primitives rather than parallel test-only logic.
     Citation cases ingest one fixed temporary evidence source and cover record,
     page, exact-span, DOI, missing locator, weak overlap, numeric style, number,
     and negation behavior; numerical cases use the bounded production parser.
169. Run every evaluation projection twice and require identical digests. Exclude
     random fixture identifiers and temporary paths from the report so two
     independent suite runs have the same fingerprint for the same normalized
     product sources.
170. Bind every evaluated implementation, agent, command, and skill as a contained
     regular UTF-8 source no larger than 1 MiB. Normalize newlines for portable
     hashes, reread bindings between executions, and fail on missing, linked,
     moving, oversized, non-UTF-8, weakened-policy, or role-drifted sources.
171. Treat the evaluation report as deterministic release evidence, not a project
     provenance record. Make no provider or network call, do not inspect or mutate
     the research project, clean only the owned temporary fixture, return nonzero
     on failure, and publish a definition hash, source-binding hash, limitations,
     and whole-report fingerprint.
172. Extend the loopback Lab server's reusable-connection lifetime beyond Node's
     five-second default so a meaningful POST after a long synchronous local
     verification does not race an idle-socket close under load. Keep both
     deadlines finite, require the header deadline to exceed keep-alive, and
     exercise the policy alongside CAD, evaluation, and Lab tests.
173. Keep external accuracy evidence separate from the exact built-in release
     contract. A user-supplied threshold or baseline may extend evidence but
     must never replace, waive, or lower `sciencecode evaluate`.
174. Freeze one strict held-out benchmark manifest with exact case/label counts
     and hashes, prospective accuracy/precision/recall/abstention thresholds,
     at least one published baseline, and bounded statements for independent
     creation, expert labeling, adjudication, blinding, licensing, source,
     limitations, corpus freeze, and label unsealing.
175. Make blind-phase separation executable: inspection and ScienceCode
     prediction read only the manifest and case file and must work when labels
     and baselines are physically absent. Permit production-reviewer prediction
     only after corpus freeze and before label unsealing; create, never replace,
     a run bound to the declared case and label hashes.
176. Validate candidate and baseline runs before checking the scoring clock, and
     never open labels before the declared unseal time. After unsealing, require
     exactly one label per case, both task classes, exact allowed prediction or
     explicit abstention, canonical prediction digests, and distinct baseline
     identity.
177. Treat every bundle as untrusted bounded local data. Require stable regular
     UTF-8 files, portable paths, real bundle containment, no link/junction
     traversal, fixed manifest/case/label/run/text/baseline ceilings, strict
     unknown-field rejection, and fail-closed count/hash/timeline/encoding/
     overwrite behavior.
178. Report case-level replay without raw input text or local absolute paths.
     Publish confusion counts, accuracy, coverage, abstention, precision,
     recall, specificity, F1, strata, fixed 95% Wilson intervals, prospective
     threshold checks, paired baseline outcomes, source bindings, limitations,
     and a timestamp-free deterministic fingerprint.
179. State the epistemic boundary directly: file separation and declared times
     do not authenticate identity or prove blinding, independence, expertise,
     label truth, or corpus representativeness. The packaged synthetic tests
     validate tooling only; real generalization evidence requires an externally
     operated expert corpus.
180. Add analysis-contract schema 2 without rewriting schema 1. An explicit
     `schema_version: 2` selects registered unit declarations and typed decision
     quantities; requests without it retain the legacy normalized shape, binding,
     assessment schema, and confirmatory engine 1 replay.
181. Use one bounded deterministic unit engine across contracts, experiments,
     assessments, CLI, and Lab. Limit expressions to 64 characters, 12 explicit
     factors, absolute exponents of 12, registered case-sensitive atoms, and
     explicit `*`, `/`, and `^`; reject implicit multiplication, parentheses,
     unknown symbols, invalid objects, non-finite values, and overflow.
182. Model compatibility with a fixed dimension vector and distinguish absolute
     `K`/`degC` from linear `delta_K`/`delta_degC`. Permit affine conversion only
     for a standalone absolute-temperature unit so compound-unit arithmetic
     cannot silently apply an offset.
183. Require each schema-2 outcome to freeze a normalized `{symbol, dimension,
     canonical_unit}` descriptor and each decision bound to supply `{value,
     unit}`. Convert compatible bounds into the outcome unit before publication,
     and bind unit-engine name/version into the immutable manifest and experiment
     binding.
184. Put contract-bound experiments in typed-quantity review mode. Preserve raw
     branch summaries, require every present statistic to have exactly `value`
     and `unit`, reject inconsistent dimensions, and publish deterministic
     canonical count/min/max/mean/sample-standard-deviation aggregates with
     explicit source and spread units.
185. Make confirmatory engine 2 convert each valid observation into the frozen
     outcome unit before mean/median/minimum/maximum and exact threshold replay.
     Preserve raw and converted values; make bare, malformed, unknown-unit, and
     incompatible results explicit missing reasons subject to the frozen
     missing-data policy rather than guessing a unit.
186. Expose identical inspection and conversion semantics through `sciencecode
     unit list|inspect|convert`, a schema-2 CLI/template contract, accessible Lab
     authoring guidance, converted branch display, and bounded AI-interaction
     summaries.
187. Treat dimensional correctness as a narrow mechanical claim. It does not
     prove that code measured the declared quantity, that values are physically
     plausible, that the outcome/statistic/multiplicity policy is valid, or that
     a threshold supports inferential, causal, clinical, or regulatory meaning.
188. Keep semantic figure registration separate from pixel comparison and
     manuscript review. It consumes a producer declaration and authoritative
     structured data; it never guesses axes, labels, series, units, or values
     from pixels.
189. Freeze a strict schema-1 contract for line/scatter figures: one numeric x
     column, one through 16 numeric series, registered source/display units, a
     shared y display unit, linear/log scale, explicit missing and duplicate-x
     policies, source or x-ascending order, no aggregation, and all or
     deterministic evenly spaced sampling.
190. Treat CSV/TSV and sidecars as hostile bounded inputs. Require strict UTF-8,
     correct quoted-field transitions, exact row width, normalized trimmed
     unique headers, strict finite selected decimals, 8-MiB/100,000-row/
     128-column table ceilings, a 1-MiB sidecar ceiling, and unknown-field
     rejection.
191. Reuse the versioned unit engine to convert x and series values from their
     declared source units into frozen display units. Reject dimensional
     mismatch, conversion overflow, nonpositive log values, forbidden duplicate
     converted x values, missing required columns, and policy-disallowed blanks.
192. Hash replay input as versioned JSONL containing source-row identity and
     converted decimal strings. Bind table header, selected series, ranges,
     counts, row/order/sampling outcome, per-series data, and whole plotted data
     without copying arbitrary unselected cell contents into the report.
193. Generate a canonical sidecar before archival, then register exact immutable
     PNG, table, and sidecar selectors against an independently supplied
     contract. Compare sidecar schema, PNG digest/dimensions, table digest/
     format, normalized contract, and full replay. Preserve mismatch as a valid
     negative result rather than confusing scientific disagreement with record
     corruption.
194. Copy all three inputs and the report through exclusive staging, bind their
     original records and report/contract/replay digests into the manifest and
     audit, and fully recompute verification. Surface the same record through
     CLI, API, Lab, interaction context, harness, lineage, state, and project
     gate.
195. State the epistemic boundary in every user-facing path: a self-consistent
     producer sidecar can accompany a misleading or defective rendering.
     Semantic registration is not OCR, visual mark extraction, renderer
     certification, statistical validation, or scientific interpretation.
196. Add renderer-independent pixel checking as a child of, not a replacement
     for, semantic registration. Creation requires the exact parent to verify
     and report `pass`/`matched`; the visual record binds parent manifest,
     report, PNG, source, contract, and replay hashes.
197. Freeze a strict schema-1 visual profile for one normalized plot rectangle:
     increasing x/y domains containing all converted points; a uniform
     background; bottom and left axes; exact ordered series IDs; flat RGB
     colors; chart-type-appropriate line widths and filled-circle radii; and
     bounded color, position, coverage, unexpected-pixel, and background rules.
198. Require every declared background/axis/series color to remain pairwise
     distinguishable at twice the channel tolerance. Restrict minimum coverage
     to at least 0.8, unexpected-series fraction to at most 0.1, channel
     tolerance to 48, and positional tolerance to eight pixels so a profile
     cannot disable the check through nominally valid extremes.
199. Project only the semantic engine's independently parsed, selected,
     unit-converted, ordered, and sampled points. Apply the frozen linear or
     log10 transforms and declared domains after alpha-compositing the decoded
     PNG over its declared background.
200. Separate position evidence from nominal pixel-support evidence. Check
     bottom/left axis paths and stroke support; line centerlines and footprint
     support; marker centers and filled-circle support; same-series pixels
     outside accepted envelopes; and background pixels outside all accepted
     foreground envelopes. This prevents a nearby one-pixel trace from passing
     a wider declaration solely through position tolerance.
201. Bound the independent engine at 4,194,304 decoded pixels, 4,096 semantic
     points, and 1,000,000 projected path/footprint samples. Bound profiles,
     requests, reports, manifests, and project registries; reject unsafe links
     and realpath escapes before writes or reads.
202. Preserve conforming and nonconforming results as immutable scientific
     records. Publish through exclusive staging and atomic rename; audit-bind
     parent, PNG, profile, replay, report, status, and manifest; discover
     deletion from audit identity; and rerun the complete parent and visual
     verification deterministically.
203. Expose one contract through `figure visual register|list|show|verify`,
     same-origin Lab APIs and the **Marks and axes against the data** workspace,
     bounded AI interactions, harness, lineage, state summaries, project gate,
     templates, and shared error semantics.
204. Treat the visual profile itself as a reviewable user claim. ScienceCode
     cannot prove that bounds, domains, colors, widths, radii, tolerances, or
     thresholds came prospectively from renderer configuration; a profile can
     be tuned after seeing the image. Without OCR it cannot cross-check domains
     against tick labels or colors against legends.
205. Keep the result narrow: one uniform-background, bottom/left-axis,
     flat-color line/scatter plot. Do not claim titles, ticks, legends,
     annotations, error bars, grid interpretation, hidden/overlapping marks,
     categorical/faceted layouts, statistics, scientific validity, or general
     renderer certification.

## Next capability targets

1. Notebook and remote compute adapters: Jupyter kernels, R, containers, SSH,
   schedulers, and HPC login nodes while preserving the same record schema.
2. Opt-in container or VM execution for campaign tasks so filesystem/process/
   network restrictions become OS-enforced rather than prompt policy, while
   preserving the current event, budget, transcript, and assessment schemas.
3. Externally authored and operated multi-domain benchmark corpora using the
   governed blind workflow, with public expert-label protocols, real baseline
   artifacts, calibration analysis, and independent reproduction. ScienceCode
   cannot manufacture evidence of independence about its own evaluation set.
4. Versioned inferential-statistical contracts; broader categorical, faceted,
   uncertainty-mark, and renderer-native visual profiles; and frozen Crossref/
   PubMed/OpenAlex ingestion adapters.
5. Richer chemical stereochemistry/reaction support and indexed genomic
   adapters only through well-tested libraries or isolated services whose
   provenance and licensing are compatible with the standalone product.
