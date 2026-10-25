# ScienceCode

ScienceCode is a standalone, reproducibility-first research workbench powered
by a pinned OpenCode engine. Its goal is to bring science-focused capabilities
to an agentic coding environment: explicit hypotheses, source-aware literature
work, reproducible computation, falsification, preregistration, independent
review, and tamper-evident local provenance.

Version 0.41 makes preregistered decisions inferential and grounds them all
the way down. Analysis contract schema 3 lets an outcome declare a one-sample
Student or two-sample Welch t-test with sidedness, alpha, a typed null value,
and a frozen Bonferroni or Holm-Bonferroni correction whose family is the set
of primary declared inferences — so missing data can never shrink the
preregistered multiplier. A pinned deterministic statistics engine
(`sciencecode-inferential-t`) replays every test, adjusted p-value, and
sidedness-matched confidence interval bit-for-bit at verification,
and two new mathematics-layer principles plus a `statistical_inference`
domain pack derive the engine's claims down to the axioms. The release also
adds frozen Crossref, OpenAlex, and PubMed literature metadata records —
`sciencecode literature fetch` is the product's only network access, one
explicit HTTPS GET whose exact response bytes, request descriptor, and
deterministically parsed bibliography freeze into an audited record that
verifies fully offline — and five SciPy/numpy simulation templates
(orbital mechanics, stiff chemical kinetics, SEIR, Lennard-Jones NVE
molecular dynamics, spectral signal analysis), each cross-checked against an
independent reference and emitting typed statistics that inferential
contracts can bind directly. Everything reaches the AI harness, interaction
prompts, lineage graph, project gate, and Lab with honest scope statements:
normality and independence are assumed, not checked; a literature record is
registry metadata at retrieval time, not the work's content; template
diagnostics bound numerical fidelity, not physical realism.

Version 0.40 gives the harness a foundational knowledge layer and a
biomolecular design workflow. Eighty-two principles compile into a directed
acyclic graph over five ordered layers - mathematics, physics, chemistry,
biology, and applied biomedicine - each carrying its kind, dependencies,
epistemic confidence, scope, stated limits, and primary references. Two
invariants are checked at load: no principle may depend on a layer above its
own, and no principle may claim more confidence than the weakest principle it
rests on. A base that violates either cannot be read at all - every query fails
closed - while `knowledge verify` and `doctor` name the exact violation. Every applied
claim therefore derives back down to mathematics, and `sciencecode knowledge
derive` prints that chain with the layers crossed, the weakest supporting link,
and every stated limit. Drug discovery, nucleic-acid design, protein
engineering, vaccine design, evidence appraisal, and measurement resolve to
their full support trees, the biomolecular packs carry a dual-use governance
principle, and goals naming DNA, guides, codons, constructs, epitopes,
antigens, immunogens, or protein design enter a biomolecular design workflow
with an explicit biosafety stage. The base is textbook grounding for reasoning,
not a source of experimental fact and not authorization for physical work.

Version 0.39 adds a constrained renderer-independent check of what a registered
plot actually drew. Starting only from an integrity-verified, semantically
matched figure registration, ScienceCode projects the exact converted and
sampled source values through frozen linear or log domains into a declared plot
rectangle, alpha-composites the bounded PNG over its declared background, and
checks flat-color bottom/left axes plus line and filled-circle mark position and
pixel support. Unexpected series-color pixels and undeclared plot-background
pixels are measured too. The strict profile, deterministic report, semantic
parent hashes, audit event, negative outcomes, CLI/API/Lab workflow, AI handoff,
harness, lineage, and project gate are all immutable and replay-verifiable. This
is deliberately not OCR, general chart understanding, renderer certification,
or scientific validation.

Version 0.38 adds replayable semantic figure registration without pretending
to read scientific meaning from image pixels. A producer sidecar now binds an
exact PNG and bounded UTF-8 CSV/TSV source to explicit column mappings,
registered source/display units, unit conversions, linear or log scales,
missing-row and duplicate-x policies, row order, and all/even sampling. The
CLI can generate a canonical sidecar before archival; registration then
independently parses the immutable table and compares figure, source, contract,
and plotted-data digests. Passing and mismatching results are both immutable,
audit-linked, replay-verified, visible in the Lab, harness, lineage, project
gate, API, and AI interaction context, and constrained by an explicit warning:
the sidecar contract does not prove that the renderer drew its declaration.

Version 0.37 makes units executable parts of prospective analysis rather than
free-text annotations. Analysis-contract schema 2 requires registered outcome
units and typed threshold quantities; bound experiments require typed
`final_statistics`; and confirmatory replay dimension-checks and converts every
observation into the frozen outcome unit before aggregation. The bounded unit
engine supports explicit compound expressions, SI scaling, percent and
concentration units, and affine absolute-temperature conversion while keeping
`K`/`degC` distinct from `delta_K`/`delta_degC`. Unit-engine identity is bound
into immutable contracts and experiments, malformed or incompatible values are
reported as missing rather than guessed, schema-1 numeric contracts retain
their original engine-1 replay, and `sciencecode unit` exposes the same parser
and converter for inspection.

Version 0.36 adds a governed external benchmark workflow without weakening the
built-in release gate. `sciencecode benchmark inspect` binds held-out input
text without opening labels or baseline runs; `benchmark predict` applies the
production citation-requirement reviewer only inside a declared blind window
and exclusively writes a frozen run; and `benchmark score` opens expert labels
only after their declared unseal time. Strict manifests bind governance,
cases, labels, prospective thresholds, and at least one published baseline by
SHA-256. Deterministic reports include case-level outcomes, abstentions,
confusion counts, per-stratum results, 95% Wilson intervals, paired baseline
comparisons, limitations, and a whole-report fingerprint. The workflow makes
external evidence reviewable; its independence, expertise, and blinding
statements remain externally auditable attestations rather than facts the
software can prove.

Version 0.35 adds an executable product-accuracy gate. `sciencecode evaluate`
runs the same built-in suite twice across labeled reviewer precision/recall,
citation resolution and triage, safe arithmetic directives, rerun determinism,
shipped scientific-safety contracts, and agent-role separation. The report
binds normalized hashes for every evaluated implementation, agent, command,
and skill source, publishes per-category metrics and a deterministic
fingerprint, and fails unless every declared case and threshold passes. The
suite is part of `npm run check`; its 55 fixture cases are regression evidence,
not a claim of open-ended model intelligence, citation entailment, or domain
validity.

Version 0.34 makes long comparative CAD studies safely stoppable. CAD Studio
now runs a matrix through the shared asynchronous experiment finalizer, exposes
branch-level progress and a dedicated **Stop study** control, and keeps the Lab
responsive while a model branch is active. A whole matrix retains its 24-hour
ceiling in addition to each branch timeout. Cancellation is bound to the exact
job, operation, CAD project, build, and optional chat; it terminates the active
model process, preserves completed and interrupted branch artifacts, marks
untouched branches `not_run`, recomputes the review, hashes and audits the
cancelled experiment, and leaves failed-outcome policy explicit. Reloaded Lab
state recovers the active stop control, and partial studies remain inspectable,
shareable with the AI, visible in lineage, and integrity-verifiable without
being mislabeled as passing studies.

Version 0.33 makes project baselines a native Lab workflow. The responsive
**Reproducibility** workspace captures an audit-bound SHA-256 manifest in a
cancellable package-local worker, lists managed snapshots, downloads their
exact JSON, and compares current files under strict or addition-tolerant
policy. Reports separate immutable-record integrity from added, modified,
missing, and unreadable paths, redact and bound diagnostics, recover active
jobs after view reload, and keep the loopback server responsive. Snapshot
record tampering now blocks the whole-project gate; expected later project
drift remains a comparison result and does not rewrite or invalidate history.

Version 0.32 brings the authoritative whole-project release gate into the Lab.
The responsive **Verification** workspace runs the same verifier as
`sciencecode gate` in a cancellable bounded child process, so large checks do
not freeze the loopback server. It distinguishes non-waivable integrity
failures from explicitly accepted failed outcomes, preserves audit and lineage
anchors, redacts and bounds diagnostics, and keeps the latest state summary
compact. Strict mode remains the default; any accepted failed run, simulation,
CAD build or slice, inference, experiment, notebook cell, or campaign task is
still counted and disclosed.

Version 0.31 closes the preregistration dead end in the Confirmatory Lab. A
responsive structured-Markdown editor now checks nine required study-planning
sections and UTF-8 size locally, then replays the same bounded validation on
the server before writing an immutable schema-v2 artifact, record hashes, and
audit event. Verified registrations have native archive, exact-source, API,
lineage, and optional AI-handoff views. Freezing a registration, analysis
contract, or assessment no longer requires a conversation; selecting one only
adds a separate secret-scanned interaction. Existing schema-v1 project-file
registrations remain verifiable, while metadata, registry, record, source, and
frozen-artifact filesystem links fail closed.

Version 0.30 makes recorded simulations and experiments directly authorable in
the Lab. The responsive launchers cover project scripts, deterministic seeds,
CPU/CUDA policy, timeouts, typed parameters, declared inputs and arguments,
verified CAD parents, bounded experiment variations, hypotheses, and optional
prospective analysis contracts. Same-origin asynchronous jobs expose sanitized
status and provenance events, recover after a view reload, serialize standalone
compute, and can be stopped through exact job bindings. Cancellation preserves
a verifiable partial simulation or experiment with explicit unrun branches;
scripts and inputs that escape through a junction or symlink are rejected
before any record is created. Optional AI handoffs remain separate,
secret-scanned interaction records.

Version 0.29 gives the CLI and Lab one shared, tested error contract. Invalid
input and malformed identifiers now consistently return CLI usage status 2 and
HTTP 400, while well-formed missing records remain operational CLI failures and
HTTP 404. Payload limits, state conflicts, unavailable runtimes, explicit route
statuses, secret refusal, missing executables, and unknown internal failures
retain distinct fail-closed outcomes. Coverage exercises the real campaign,
figure, review, inference, simulation, experiment, preregistration, and run
commands plus their Lab detail routes, preventing newer tools from silently
falling back to misleading generic failures.

Version 0.28 makes the Lab shell honest and keyboard-complete during real
project loading. The workbench now presents an explicit verification state,
keeps actions disabled until state is usable, recovers coherently from failed
conversation selection, and preserves fresh, reused, stale, or failed integrity
status after chat loading and on narrow screens. Workspace views expose current
state and restore focus, the scientific harness implements the standard tab
keyboard model, a skip link bypasses the workspace rail, reduced-motion users
do not receive forced smooth scrolling, and every mobile view stays on one
horizontal rail. Compact JSON reduces the measured artifact-rich state response
from 461,769 to 311,810 bytes without changing its schema or adding loopback
compression overhead.

Version 0.27 makes verified Lab state responsive on artifact-rich projects.
The server preloads immutable file digests with bounded parallel I/O, reuses
file and audit work only while exact filesystem identity metadata remains
unchanged, and reuses a complete verified state snapshot only after a fresh
project metadata walk. Same-origin mutations, audit changes, ordinary external
edits, and same-size edits with restored modification time invalidate reuse;
projects containing links in watched state roots do not use the whole-state
cache. The API and title bar distinguish a fresh verification from an unchanged
verified snapshot. Windows NPU discovery now reads structured native PnP XML
and performs a targeted Windows ML package lookup instead of scanning every
signed driver, while manual Refresh still forces a hardware probe. These are
local responsiveness caches, not protection against a privileged actor able to
forge all filesystem identity metadata.

Version 0.26 adds optional frozen structural evidence to immutable PNG rerun
comparisons. Alongside exact and thresholded RGBA deltas, ScienceCode now
computes a deterministic fixed-block luminance SSIM score after linear-light
white-matte compositing. A user can freeze a minimum score; when present, both
the pixel rule and structural rule must pass. The score, worst block,
luminance errors, settings, hashes, Lab view, CLI/API output, AI context,
harness, lineage, and project gate all replay from the immutable record.
Schema-v1 pixel-only comparisons remain verifiable. This is a bounded
mechanical diagnostic, not registration, semantic plot interpretation, or a
domain-valid acceptance criterion.

Version 0.25 added immutable figure rerun comparison. Any two distinct verified
PNG artifacts or PNG revisions can be decoded through a dependency-free,
resource-bounded RGBA comparator with frozen channel tolerance and accepted
changed-pixel fraction. ScienceCode preserves exact source copies, numerical
metrics, a pixel-difference image, hashes, audit links, lineage, project-gate
status, CLI/API access, and a Lab overlay with baseline, candidate, blend,
difference gain, draggable pixel-region selection, and next-turn AI handoff.
This is a pixel reproducibility check, not validation of the generating data,
code, labels, environment, or scientific interpretation.

Version 0.24 adds verified comparative studies directly to CAD Studio. A user
or the Scientist can hold one immutable OpenSCAD/CadQuery build fixed, define
bounded JSON fixed parameters, variation arrays, and seeds, then launch up to
64 sequential model branches through the bounded experiment recorder. The Lab compares
scalar outcomes, opens each branch's interactive 3D field, exposes the study
on the harness board and lineage graph, and shares the selected comparison
with the next AI turn. Fresh VRAM refusal applies to auto/CUDA studies; these
comparisons inherit the model's assumptions and are not FEA validation.

Version 0.23 adds a native bounded CAD surface-thermal path. A user or the
Scientist can install the exact packaged solver without overwriting project
code, run it over any verified OpenSCAD or CadQuery STL on CPU or an eligible
CUDA device, inspect immutable numerical checks and history, rotate the
temperature-colored PLY, select a vertex, and give the exact field range/value
back to the AI. It is deliberately surface-graph diffusion, not volumetric FEA
or thermal-safety certification.

Version 0.22 adds bounded hypothesis-tree campaigns. The Scientist and user
can freeze competing root, alternative, refinement, mechanism, and rebuttal
branches; assign per-branch and global task/GPU/NPU/wall-clock ceilings; and
execute one recorded task at a time behind explicit checkpoints. The Lab now
shows the live task graph, branch budgets, verdict freshness, event ledger,
and next required human action. Human verdicts are append-only, superseding
local-user assessments; later completed or skipped work makes an earlier
verdict stale instead of silently treating it as final.

Version 0.21 makes the CAD environment multi-engine. The Scientist and user
can create, read, and conflict-safely edit many-file OpenSCAD or CadQuery
projects in one workspace. CadQuery runs in a definition-hashed isolated
Python environment and produces independently verified STL plus STEP artifacts;
the same interactive mesh, geometry-screen, recorded-model, slicing, harness,
lineage, and project-gate paths work for either engine. Source snapshots are
checked again after Python execution so a build cannot silently rewrite its
declared inputs.

Version 0.20 closes the interactive CAD-to-model loop. A user or Scientist can
launch a project-relative CPU/GPU model directly from the selected immutable
mesh in Lab, supply bounded JSON parameters, arguments, inputs, seed, device,
and timeout, watch the live provenance job, or stop it. Completion and
cancellation both produce hash-verified simulation records; cancellation
preserves partial artifacts. Fresh GPU-memory checks prevent CUDA or automatic
device selection from crowding an occupied accelerator.

Version 0.19 adds a native multi-file parametric CAD environment. The Scientist
can create or import declared SCAD/CAD trees, make conflict-safe source
revisions, render immutable OpenSCAD meshes, rotate and inspect them in the
Lab, run bounded geometry checks, bind the verified mesh to arbitrary recorded
CPU/GPU model scripts, and create non-transmitted PrusaSlicer previews. CAD
gestures, edits, builds, model results, slices, and user directions remain
visible to the AI harness and scientific lineage.

Version 0.18 makes the NPU an actionable part of the ScienceCode workbench.
The Inferences view can now launch a deterministic smoke or project ONNX model
as an asynchronous recorded job, show its live runtime/provenance trace, stop
it without losing partial evidence, open the verified result, and share the
immutable record with the selected AI conversation. Strict NPU mode never
silently falls back, and the same recorder remains available through the CLI.

Version 0.17 makes the conversational harness visibly interactive while work
is still running. Completed OpenCode JSON text parts now appear as a redacted,
bounded live response in the chat beside the real activity trace. The preview
is capped independently, survives cancellation, and is replaced by the
verified recorded transcript at completion; it is block-level engine output,
not simulated token streaming.

Version 0.16 added a separate isolated Windows ML/ONNX NPU runtime alongside
the CUDA/PyTorch GPU runtime, strict profiled NPU inference records, dual-
accelerator status, interactive inference outputs, and cancellable turns with
partial-output provenance.

Version 0.15 adds Procedure Studio: strict source-linked procedure plans,
deterministic logical dry-runs, non-executable XDL 2.0 and Opentrons mapping
previews, expiring scoped human decisions, and interactive plan/gate/adapter
inspectors whose selections reach the next AI turn. The Lab harness exposes
the exact current plan, assessment blockers, adapter gaps, decision scope, and
the permanent rule that ScienceCode does not control or authorize hardware.

Version 0.14 added prospective analysis contracts and replayable confirmatory
assessments. A contract binds one frozen preregistration, the exact Python
script, operational outcome definitions, branch filters, missing-data rules,
aggregation, minimum counts, and numeric decision thresholds before an
experiment starts. The experiment carries that digest, and the assessment
replays it over verified branch results while keeping prospective, deviated,
and unregistered status separate from the primary outcome verdict. The Lab
**Confirmatory** workspace, harness, lineage graph, CLI, project gate, bundled
AI skill, and read-only reviewer all expose the same immutable records.

Version 0.13 adds an independent semantic consistency reviewer for immutable
manuscripts and saved revisions. It maps bounded claims to exact ScienceCode
evidence spans, pages, and ingested DOI metadata; checks literal numbers and
explicit arithmetic; verifies manifest-bound data, code, and figure links; and
publishes an immutable claim-level report into the Reviewer workspace, lineage
graph, harness board, project gate, and next AI turn. Its lexical and literal
checks are deliberately labeled as triage, never proof of scientific support.

Version 0.12 added the domain-native chemical, genomic, and manuscript studios.
Every saved view, selection, diff, source revision, or reviewer direction is a
bounded, hash-chained interaction that the next AI turn can inspect; recorded
source artifacts are never overwritten.

ScienceCode is its own product. It does **not** wrap, reconfigure, or fall back
to an existing user installation of OpenCode.

## Runtime boundary

- `opencode-ai@1.18.15` is installed as a project-local runtime dependency.
- ScienceCode resolves only that package-local engine binary; it never searches
  `PATH` for a global `opencode`.
- OpenCode config, auth, sessions, cache, and state are redirected into a
  ScienceCode-only application directory.
- Existing `OPENCODE_CONFIG*` and `XDG_*` values are replaced for the child
  engine, and global Claude-compatible config discovery is disabled.
- Provider environment variables may still be inherited intentionally. Files
  and credentials from an existing OpenCode data directory are not.

Default ScienceCode state locations:

- Windows: `%LOCALAPPDATA%\ScienceCode`
- macOS: `~/Library/Application Support/ScienceCode`
- Linux: `$XDG_DATA_HOME/sciencecode` or `~/.local/share/sciencecode`

Set `SCIENCECODE_HOME` to use a different isolated state root. Run
`sciencecode paths` to see the exact engine, config, state, and cache paths.

## Install from this checkout

Prerequisite: Node.js 20.16 or newer.

```powershell
npm install
npm run check
node bin\sciencecode.js doctor
```

The OpenCode dependency uses a postinstall step to select the platform binary,
so do not install ScienceCode with lifecycle scripts disabled.

Optionally expose only the `sciencecode` command:

```powershell
npm link
sciencecode doctor
```

This does not replace or link the `opencode` command.

## First research session

From a research project directory:

```powershell
sciencecode init
sciencecode lab
```

Open `http://127.0.0.1:4311` and start a recorded conversation with the
scientist. The workbench continues one isolated OpenCode session across turns
and links the transcript to exact runs, file changes, simulations, experiments,
audit records, user workspace interactions, and their verified lineage. The right-side harness shows
the real work queue, safe tool progress, design gates, evidence, validation, and
recorded outcomes while a turn runs. Completed assistant response blocks appear
in the conversation as OpenCode emits them; the final verified transcript
replaces that bounded preview when the turn finishes.

Open **Verification** at any time to run the complete project gate without a
terminal. Integrity failures can never be waived; optional outcome checkboxes
only acknowledge selected recorded failed or cancelled outcomes for that run.
The view remains usable while the isolated worker runs and can cancel only its
own exact gate job.

The first ScienceCode session may ask you to connect a model provider. Run
`sciencecode tui` and use `/connect` if the workbench reports that no model
is configured.
That connection is stored under `SCIENCECODE_HOME`, separately from any
existing OpenCode provider connection.

## Persistent project notebooks

Open **Notebook** in `sciencecode lab`, choose Python or R, and start a clean
kernel. Cells share one live namespace until the Lab exits, the kernel is
restarted, a timeout occurs, or the user interrupts it. The workspace exposes
cell history, source, stdout/stderr, visible results, variables, shapes,
dependencies, project-file changes, and manifest-bound figure outputs. Source
from an old cell can be loaded as a new editable draft; the archived cell is
never overwritten.

When a conversation is selected, a cell can be linked directly to that chat.
Running or sharing the cell also appends a notebook interaction containing the
user's interpretation or request. The next AI turn receives a bounded,
verified JSONL description of linked cells and user interactions, clearly
labeled as untrusted data. Transcript verification rechecks those cell records.

The same archive is inspectable from the CLI:

```powershell
sciencecode kernel status
sciencecode kernel list
sciencecode kernel exec python analysis.py
sciencecode kernel exec python followup.py --restore
sciencecode kernel show python cell-000002
sciencecode kernel verify python
```

Each CLI `exec` owns one process lifecycle and then shuts it down. If history
already exists, `--restore` explicitly replays verified completed cells before
the new cell; `--fresh` starts without replay. R is optional and appears as
unavailable until `Rscript` is installed and discoverable on `PATH`.

## Scientific lineage and AI-visible workspace state

Open **Lineage** in `sciencecode lab` to inspect the current conversation or
the whole project. The graph supports pointer panning, wheel zoom, keyboard
node selection, record/integrity filters, and upstream, downstream, or combined
traces. Its inspector exposes exact record IDs, hashes, metadata, relationships,
and deterministic review findings. Selecting a node is quietly recorded for
the active conversation; **Share trace with AI** adds an optional direction for
the next turn.

The graph is also available without the browser:

```powershell
sciencecode lineage show --json
sciencecode lineage show --chat CHAT_ID --json
sciencecode lineage verify
```

Code, CSV/TSV, and `.xlsx` drafts, plot selections, figure annotations and
rerun inspections,
notebook state, evidence selections, 3D camera/point state, chemical atom/view
state, genomic regions/features, and manuscript diffs remain separate
hash-chained interactions. They do not overwrite the producing artifact. The
next AI turn receives a bounded, clearly labeled summary of those user actions,
and lineage shows whether each action has already informed a completed turn or
is still pending.

## Foundational knowledge

Scientific reasoning in the harness rests on an explicit, checkable base rather
than on whatever the model recalls. `lib/knowledge.js` compiles 82 principles
into a directed acyclic graph over five ordered layers:

| Tier | Layer | Warrant |
| --- | --- | --- |
| 0 | mathematics | deductive |
| 1 | physics | mathematised-empirical |
| 2 | chemistry | physical-model |
| 3 | biology | mechanistic-historical |
| 4 | applied biomedicine | decision-support |

Each principle declares its kind (axiom, definition, theorem, law, model,
approximation, empirical regularity, heuristic, governance), its statement, the
principles it rests on, its epistemic status and confidence, the scope where it
holds, the conditions under which it breaks down, and primary references.

Two invariants are enforced when the module loads. Compilation records every
violation instead of throwing, so an unsound base stays diagnosable: no query
can read it, and `knowledge verify` and `doctor` report exactly what is wrong.

- **Layer purity.** A principle may never depend on a layer above its own.
  Chemistry may rest on physics; physics may never rest on chemistry.
- **Confidence monotonicity.** A principle may never claim more confidence than
  the weakest principle it rests on. This is what makes the tree more strongly
  warranted the further down you go: mathematics is definitional, physical law
  is very high, chemical and biological models are high to moderate, and
  applied biomedical practice is provisional.

Axioms are admissible only in the mathematics layer, every principle above
tier 0 must derive back down to mathematics, and every principle must state
scope, limits, and at least one reference.

```bash
sciencecode knowledge layers
sciencecode knowledge derive bioeng.vaccine.antigen_selection
sciencecode knowledge domain vaccine_design
sciencecode knowledge ground biomolecular_design
sciencecode knowledge verify
```

`derive` prints the complete support chain in dependency order together with
the layers crossed, the weakest supporting claim, and its stated limits. Domain
packs - drug discovery, nucleic-acid design, protein engineering, vaccine
design, evidence appraisal, and measurement - resolve to their full transitive
support trees, and each biomolecular pack carries the
`bioeng.biosafety.dual_use` governance principle. Every harness view reports
the grounding for its workflow, the Lab context card shows the layer span and
provisional claims, and `sciencecode doctor` fails when the base does not
verify.

The base is textbook-level grounding for reasoning. It is not a source of
experimental fact, not a substitute for primary literature, not a chemistry or
structure prediction engine, and not authorization for synthesis, editing,
immunisation, or any other physical or clinical work.

## Biomolecular design

Goals naming DNA, RNA, primers, CRISPR guides, codons, plasmids, constructs,
epitopes, antigens, immunogens, vaccines, antibodies, or protein design enter
the `biomolecular_design` workflow ahead of drug discovery. Its stages are
scope, evidence, **grounding**, design, compute, **biosafety**, review,
approval, and outcome, adding `biomolecular-designer` and `biosafety` agent
lanes to the existing supervisor, evidence, scientist, methodologist, compute,
reviewer, and recorder lanes.

The biosafety stage does not pass silently. A conversation that has produced an
outcome without visible biosafety, biosecurity, or dual-use screening raises
that stage to attention and records the gap as a stated limitation of the view.
Sequence-level design support is not synthesis, editing, immunisation, or
institutional biosafety authorization, and specificity and off-target results
are computational predictions only.

## Domain-native scientific studios

Manifest-bound outputs open locally without a CDN, upload, or external viewer:

- `.smi`/`.smiles` supports bounded SMILES atoms, bonds, branches, ring
  closures, disconnected components, formal charges, and aromatic bonds.
  `.mol`/`.sdf` supports bounded V2000 records, recorded coordinates, bond
  orders, and properties. The 2D view supports pointer/keyboard pan and zoom,
  molecule switching, and atom selection; MOL/SDF coordinates can also open in
  the existing draggable, spinning 3D viewer. Formula and mass labels cover
  explicit recorded atoms only. ScienceCode does not canonicalize structures,
  infer omitted hydrogens or stereochemistry, or certify chemical validity.
- `.bed`, `.bedgraph`/`.bdg`, `.gff`/`.gff3`, `.gtf`, `.vcf`, and FASTA-family
  files support contig switching, ruler navigation, anchored zoom, panning,
  type filters, feature selection, and base letters at close sequence zoom.
  BED stays zero-based half-open; GFF/GTF and VCF positions are normalized to a
  clearly labeled zero-based half-open viewport without changing source text.
  This is inspection, not variant calling, alignment, annotation inference, or
  a replacement for a full indexed genome browser.
- `.md`, `.markdown`, `.mdx`, `.tex`, and `.rst` use an editable split view.
  Changed lines can be selected for the AI, downloaded, or saved exactly as an
  immutable revision. Diff computation is exact within its bounded matrix and
  explicitly switches to a coarse middle-replacement view for very large,
  divergent documents; exact draft bytes are still used for download and
  revision storage.

Chemical and genomic studios include a collapsible source editor. Applying a
draft changes only the local visualization. **Share** writes a bounded,
secret-scanned interaction; **Save immutable revision** records the complete
replacement through the verified revision workflow. Mouse-wheel, drag,
selection, and keyboard navigation are recorded only when a conversation is
selected, and the visible status confirms when AI context was updated.

One chemical document is capped at 128 displayed molecules, 5,000 atoms, and
10,000 bonds. Genomic parsing is capped at 50,000 features, 10,000 contigs, and
5,000,000 retained sequence characters. Manuscript comparison considers at
most 20,000 lines per side and 1,500,000 dynamic-programming cells before using
the labeled coarse fallback. These are local preview safety limits, not format
completeness claims.

## Immutable figure rerun comparison

Open any manifest-bound PNG in Lab to use **Baseline versus rerun**. The picker
offers only other verified immutable PNG artifacts and revisions. Freeze an
integer RGBA channel tolerance from 0 through 255 and a maximum changed-pixel
fraction from 0 through 1. Optionally freeze a minimum block-luminance SSIM
from 0 through 1; configured pixel and structural rules must both pass. The
result shows exact, within-tolerance, different, or incompatible-dimensions
status; exact and thresholded changed-pixel counts; changed fraction; RGBA
MAE/RMSE; maximum and per-channel deltas; changed bounding box; mean/minimum
structural similarity; worst block; and luminance errors.

The comparison canvas switches among baseline, candidate, adjustable blend,
and gain-adjusted absolute difference. Dragging selects an exact source-pixel
rectangle. **Save inspected view for AI** adds that region, view, blend,
difference gain, frozen settings, metrics, source hashes, and a bounded note to
the selected conversation without changing either figure. Creating a
chat-linked comparison also records its outcome automatically on the harness
board.

The same immutable lifecycle is available from the CLI:

```powershell
sciencecode figure compare /artifact/BASELINE_ID/figure.png /artifact/RERUN_ID/figure.png --chat CHAT_ID --pixel-tolerance 0 --max-changed-fraction 0 --min-structural-similarity 0.995
sciencecode figure compare revision:BASELINE_REVISION revision:RERUN_REVISION
sciencecode figure list --chat CHAT_ID --json
sciencecode figure show FIGURE_COMPARISON_ID
sciencecode figure verify FIGURE_COMPARISON_ID
```

The decoder accepts a bounded non-interlaced 8-bit PNG subset (grayscale,
indexed, RGB, grayscale-alpha, and RGBA), verifies every chunk CRC, caps source
bytes, dimensions, pixels, chunks, and decompressed output, and canonicalizes
pixels to RGBA. The pixel comparator deliberately does not apply color-management
profiles, spatial registration, resampling, Gaussian/windowed or learned
perceptual models, plot semantics, or domain-specific scientific acceptance
rules; semantic registration is the separate producer-sidecar workflow below. The fixed-block
score uses a recorded white matte and linear-light luminance so it can be
replayed; it is a narrow mechanical diagnostic, not general perceptual
equivalence.

## Registered figure semantics

Use a semantic registration when a plotting process can emit a declaration
alongside its PNG and source table. Start from
`templates/figure-semantic-contract.json`. Schema 1 requires a numeric x
column, one through 16 numeric series columns, explicit source and display
units, one shared y display unit, linear or base-10-log axes, a missing-value
policy, a duplicate-x policy, source or x-ascending order, no aggregation, and
either all points or deterministic evenly spaced sampling. Column names are
case-sensitive and must resolve uniquely in a normalized header.

Generate the sidecar while the exact output files still exist:

```powershell
sciencecode figure semantic sidecar templates/figure-semantic-contract.json outputs/figure.png outputs/data.csv --output outputs/figure.semantic.json
```

Archive the PNG, table, and sidecar together in a simulation, experiment,
kernel cell, evidence record, CAD record, or immutable revision. Then replace
the selectors in `templates/figure-registration.json` with their manifest-bound
Lab URLs and register the expected contract:

```powershell
sciencecode figure semantic register figure-registration.json --chat CHAT_ID
sciencecode figure semantic list --status pass --json
sciencecode figure semantic show FIGURE_REGISTRATION_ID
sciencecode figure semantic verify FIGURE_REGISTRATION_ID
```

The replay parser accepts at most 8 MiB, 100,000 data rows, and 128 columns. It
uses strict UTF-8 and CSV/TSV quoting, rejects duplicate or ambiguous headers,
malformed/non-finite selected values, incompatible units, nonpositive log-axis
values, and forbidden duplicate x values, converts selected measurements
through the versioned unit engine, and hashes source-row/converted-value JSONL.
The immutable report checks the sidecar schema, exact PNG digest and dimensions,
exact table digest and format, normalized contract, and full deterministic data
replay. A mismatch is a valid negative result, not an integrity failure; later
tampering with any record component is an integrity failure.

In Lab, open a recorded PNG and use **Source-to-figure contract**. Paste the
immutable data and sidecar URLs, edit the expected contract, and select
**Register semantics**. The result exposes every binding check, source and
plotted counts, conversion count, replay hashes, and the frozen contract. It is
also placed on the selected conversation's harness and passed to the next AI
turn as a bounded interaction summary.

This mechanism verifies agreement between a producer-emitted declaration and
ScienceCode's independent tabular replay. By itself it does not prove that the
renderer drew that declaration. The optional decoded-pixel layer below can
check a deliberately narrow class of flat-color axes and line/scatter marks;
neither layer performs OCR, general chart understanding, domain-validity
inference, or scientific review.

## Decoded-pixel figure validation

Use this second layer only after semantic registration reports `matched` with
valid integrity. Start with `templates/figure-visual-registration.json` (or the
profile-only `templates/figure-visual-profile.json`) and replace its parent ID.
The profile must declare one normalized plot rectangle, increasing x/y domains,
the plot background and axis colors, a nominal axis width, and exactly one
flat RGB color plus the chart-type-appropriate line width and marker radius for
each semantic series. Colors must remain distinguishable at the declared
tolerance, and every converted plotted value must lie inside the domains.

```powershell
sciencecode figure visual register templates/figure-visual-registration.json --chat CHAT_ID
sciencecode figure visual list --registration FIGURE_REGISTRATION_ID --status pass --json
sciencecode figure visual show FIGURE_VISUAL_ID
sciencecode figure visual verify FIGURE_VISUAL_ID
```

The engine decodes the exact parent PNG, composites alpha over the declared
background, applies the semantic contract's linear or base-10-log transforms,
and projects the independently replayed points. It measures coverage and pixel
support for the bottom horizontal and left vertical axes, line paths, and
filled-circle markers; the fraction of each series color outside its accepted
mark envelope; and background conformance outside accepted foreground
envelopes. Minimum coverage thresholds are restricted to 0.8 through 1,
unexpected series pixels to at most 0.1, RGB-channel tolerance to at most 48,
and positional tolerance to at most eight pixels. A nonconforming image is an
integrity-valid negative record, not a storage failure.

Analysis is capped at 4,194,304 decoded pixels, 4,096 semantic plotted points,
and 1,000,000 projected path/footprint samples; each project may retain at most
10,000 visual-validation records. Records bind the exact semantic-registration
manifest/report, PNG, source, contract, replay, normalized profile, report, and
audit hashes. Verification revalidates the parent and deterministically reruns
the decoded-pixel engine, so parent mutation, deletion, profile/report changes,
unsafe links, and audit drift fail closed.

In Lab, open a registered PNG and use **Marks and axes against the data**. The
picker includes only matched, verified semantic registrations. Lab derives an
editable starting profile from converted data ranges and chart type; the plot
bounds, axis domains, colors, and sizes remain explicit renderer-specific user
claims that must be checked before recording. Results expose every rule,
per-series evidence, hashes, and limitations and can be shared with the selected
AI conversation without changing the figure.

This checker handles one plot rectangle with a uniform declared background,
bottom/left axes, and flat-color line and/or filled-circle marks. It does not
OCR or validate titles, tick labels, legends, annotations, error bars, hidden
or overlapping marks, statistical meaning, or scientific validity. Unsupported
styling should remain an explicit human or renderer-specific review rather than
being coerced into a passing profile.

## Independent semantic consistency review

Open **Reviewer** in `sciencecode lab` to inspect immutable manuscript reviews.
From a manuscript studio, **Review archived source** reviews the verified
producing artifact. **Save + review draft** first creates an immutable revision
and then reviews those exact bytes. The report provides source line locators,
claim-to-evidence traces with excerpts, literal-number signals, explicit
calculation results, linked data/code/figure checks, filters, limitations, and
a direction box that can be shared with the selected AI conversation.

The same lifecycle is available from the CLI:

```powershell
sciencecode review run ARTIFACT_URL --chat CHAT_ID
sciencecode review run --revision REVISION_ID --chat CHAT_ID
sciencecode review list --chat CHAT_ID
sciencecode review show REVIEW_ID
sciencecode review verify REVIEW_ID
```

Review creation accepts Markdown/MDX, reStructuredText, TeX, and plain text up
to 8 MiB. It resolves only already ingested evidence and immutable local
artifacts, so a later network response cannot silently change an archived
verdict. Calculations run only inside explicit
`{{calc: arithmetic = expected}}` directives using a bounded arithmetic parser;
manuscript text is never evaluated as code.

A verified report proves that ScienceCode reproduced its deterministic checks
over the same immutable inputs. It does not prove citation entailment,
statistical validity, or correct units or transformations. Figure mechanical
agreement is a separate explicit `sciencecode figure` record rather than an
inference made from nearby manuscript code. Load-bearing findings should be handed to the
read-only `semantic-reviewer` agent for exact-source inspection and qualified
human review. Rerunning the same exact target in one conversation marks the
newest verified report current; earlier engine results stay replayable,
visible, and linked as historical without inflating current attention counts.

## Immutable artifact revisions

Editable code, CSV/TSV, workbook, chemical-source, genomic-source, and
manuscript studios include **Save immutable revision**. The editor stores the
exact replacement text or workbook bytes in
`.sciencecode/revisions/`, links them to the verified source artifact, and
shows the version history inline. Saving another proposal links it to the
previous revision while retaining every earlier file.

A proposal remains `proposed` until a user chooses **Accept** or **Reject**.
Decisions form their own append-only hash chain and never mutate either the
source or revision manifest. Acceptance is a review signal, not an automatic
rewrite of an experiment, notebook cell, report, or project file. The next AI
turn receives the exact manifest and replacement-file paths plus the latest
decision; it is explicitly told not to substitute a rejected proposal.

The same workflow is available from the CLI. `ARTIFACT_URL` is a
manifest-bound route copied from a Lab output, and `FILE` must be a regular
project file outside `.sciencecode`:

```powershell
sciencecode revision create ARTIFACT_URL revised.csv `
  --chat CHAT_ID `
  --note "Corrected the selected rows"

sciencecode revision list --source ARTIFACT_URL
sciencecode revision show REVISION_ID
sciencecode revision verify REVISION_ID
sciencecode revision decide REVISION_ID `
  --chat CHAT_ID `
  --decision accepted `
  --note "Approved after source comparison"
```

Revision uploads are same-origin JSON mutations and are limited to 8 MiB of
replacement bytes. Larger files can still be edited and downloaded locally,
but are not silently persisted as provenance records.

## Immutable evidence library

Add a PDF, Markdown, reStructuredText, or plain-text file that is already
inside the research project:

```powershell
sciencecode evidence add papers\study.pdf `
  --title "Primary assay study" `
  --doi "10.1234/example" `
  --author "A. Researcher" `
  --year 2026

sciencecode evidence list
sciencecode evidence search "vehicle-controlled assay"
sciencecode evidence show EVIDENCE_ID
sciencecode evidence verify EVIDENCE_ID
```

ScienceCode copies the original source into `.sciencecode/evidence/`, extracts
normalized page text with pinned Mozilla PDF.js for PDFs, creates overlapping
hashed spans, and records source, bibliography, extraction, chunking, and
retrieval settings in an immutable manifest. PDF extraction is text-layer
extraction; scanned image-only PDFs require OCR before ingestion.

When a chat request matches verified spans, ScienceCode records the query
digest, exact corpus manifest hashes, retrieval settings, ranked span hashes,
and audit link under `.sciencecode/retrievals/`. Only a bounded JSONL-quoted
evidence context is sent to the engine, with an explicit instruction to treat
source text as data rather than instructions. Chat verification replays the
ranking against the historical corpus, so later source additions do not
invalidate earlier turns.

Inside the TUI, the primary agent is `scientist`. The bundled workflows are:

- `/research` — end-to-end reproducible investigation
- `/literature` — source-critical literature review
- `/analyze` — reproducible data analysis
- `/reproduce` — independent reproduction/audit
- `/compare-figure` — immutable baseline/rerun PNG comparison and audit
- `/challenge` — adversarial falsification and alternative explanations
- `/design` — experiment or observational-study design
- `/audit-citations` — claim-by-claim primary-source verification
- `/write-report` — traceable versioned scientific reporting

ScienceCode also adds `/simulate` for recorded CPU/GPU work and `/experiment`
for hypothesis-driven multi-seed parameter matrices with independent review.
Use `/confirmatory` to freeze a preregistration-linked outcome contract, bind
the exact matrix, assess it, and request an independent confirmatory review.
Use `/discover` for a stage-gated drug-discovery question and `/procedure` for
a versioned method with controls, hazards, dry-run requirements, and human
approval gates.

## Frozen literature metadata records

Freeze bibliographic metadata for a DOI or PMID from Crossref, OpenAlex, or
PubMed. `literature fetch` is the only network access in ScienceCode — one
explicit HTTPS GET through a bounded subprocess worker — and `literature
import` freezes a previously saved API response with no network at all:

```powershell
sciencecode literature fetch --source crossref --id 10.1234/example
sciencecode literature import --source pubmed --id 12345678 saved-esummary.json
sciencecode literature list
sciencecode literature show LITERATURE_ID
sciencecode literature verify LITERATURE_ID
```

The record freezes the exact response bytes, the request URL, HTTP status,
retrieval time, and transport, plus a deterministically parsed bounded
bibliography. Verification re-hashes every file and replays the pinned parser
over the frozen bytes fully offline, and the record joins the audit chain,
lineage graph (linked to evidence sharing the same DOI), project gate, Lab,
and AI harness. A literature record is a snapshot of a third-party registry
at retrieval time — not the work's content and not a claim the registry is
correct.

## Isolated scientific compute

ScienceCode manages a separate Python runtime under `SCIENCECODE_HOME`; it
does not modify the system Python environment.

```powershell
sciencecode compute status
sciencecode compute setup --profile all
```

The GPU profile pins the scientific package set and a CUDA-enabled PyTorch
build. The Windows NPU profile is separate and pins Windows ML, ONNX Runtime,
ONNX, and NumPy for Vitis AI execution on supported AMD Ryzen AI hardware. The
CAD profile is a third isolated runtime with pinned CadQuery and an
adapter-definition digest; it does not install into system Python. Use
`--profile gpu`, `--profile npu`, or `--profile cad` when only one runtime is
wanted. `compute status` reports all three runtime identities, definition
freshness, devices, drivers, provider packages, and capabilities. Rebuild an
outdated profile explicitly with `compute setup --profile cad --refresh`.

Windows device discovery and AppX package inventory are reported separately.
If AppX inventory is degraded after a provider was successfully installed and
recorded, ScienceCode may register only the exact prior Vitis DLL whose path is
manifest-bound, still exists under the protected
`Microsoft.WinML.AMD.NPU.EP.2` WindowsApps package, and matches the fixed DLL
name. This recovery path never calls provider acquisition; the inventory error
remains visible, and a strict NPU result still requires archived Vitis profile
events from the actual inference.

Run the deterministic NPU smoke or a project-confined ONNX model:

```powershell
sciencecode inference smoke --device npu --warmup 1 --iterations 5
sciencecode inference run models\classifier.onnx --input inputs\sample.json --device npu
sciencecode inference list
sciencecode inference verify INFERENCE_ID
```

Input JSON is an object keyed by exact model input name, optionally under an
`inputs` property. `--device npu` is strict: ScienceCode requires a profiled
`VitisAIExecutionProvider` execution event and otherwise records a failed
inference. `--allow-fallback` makes fallback explicit and auditable; `auto`
expresses a preference rather than a strict NPU claim. Inference records archive
the exact model/input bytes, NPY arrays, JSON output previews, latency, profile,
runtime and driver state, logs, hashes, audit links, and fallback decision.
The NPU path is bounded ONNX inference, not arbitrary Python acceleration or
NPU training; CUDA remains the simulation/training path.

The same operation is available in **ScienceCode Lab → Inferences**. The
launcher exposes smoke/model mode, strict NPU/auto/CPU policy, fallback,
warmup, iteration, timeout, optional AI direction, and an explicit
conversation link. Its live monitor is a process-local bounded job view; the
immutable inference archive is authoritative. Only one accelerator inference
runs through a Lab process at a time. Stopping it preserves a verified
`cancelled` record whose partial outputs remain scientifically incomplete.

Inside the bundled conversational engine, `/inference` activates the
NPU-inference protocol. It requires compute readiness, exact project-relative
inputs, profiled Vitis attribution for an NPU claim, explicit fallback, and
verification of the returned inference ID.

Create and run the bundled Gray-Scott template:

```powershell
sciencecode simulate init reaction-diffusion
sciencecode simulate run simulations\reaction-diffusion.py --device cuda --seed 42 --param width=512 --param height=512 --param steps=1200
sciencecode simulate list
sciencecode simulate verify SIMULATION_ID
```

Five SciPy/numpy templates ship alongside it, each cross-checked against an
independent reference and emitting typed final statistics that typed and
inferential analysis contracts can bind directly: `orbital-mechanics`
(DOP853 vs analytic Kepler plus conservation drift), `chemical-kinetics`
(Robertson stiff network, BDF with analytic Jacobian vs LSODA),
`epidemic-seir` (DOP853 vs LSODA vs the implicit final-size equation),
`molecular-dynamics` (Lennard-Jones NVE with energy, momentum, and
time-reversal diagnostics), and `signal-analysis` (Welch and periodogram
estimation validated on a self-constructed signal with a Parseval residual).
Their diagnostics bound numerical fidelity, not physical, chemical, or
epidemiological realism. They require a Python with numpy, scipy, and
matplotlib; `sciencecode doctor` reports whether that stack is available.

Each simulation archives its exact source, runtime manifest, deterministic
settings, declared inputs, logs, snapshots, GPU metadata, generated files,
artifact hashes, and linked audit events.

## Parametric CAD, simulation, and 3D-print preparation

The CAD workspace supports two explicit parametric engines in the same
provenance contract: declarative multi-file OpenSCAD and Python-based CadQuery.
Both produce a verified ASCII STL for interactive inspection, simulation, and
slicing. CadQuery builds also produce a verified STEP interchange artifact.
PrusaSlicer remains the local, non-transmitting slice engine. Detect the
installed tools and isolated runtime, then create either starter assembly:

~~~powershell
sciencecode cad toolchain
sciencecode compute setup --profile cad
sciencecode cad init --name "Fixture assembly" --id cad-fixture-assembly --engine openscad
sciencecode cad init --name "STEP fixture" --id cad-step-fixture --engine cadquery
sciencecode cad list
sciencecode cad show cad-step-fixture
sciencecode cad read cad-step-fixture parts/base.py
~~~

To save an LLM- or user-edited source, write the draft somewhere in the normal
project tree and supply the SHA-256 that was returned when the source was
opened:

~~~powershell
sciencecode cad write cad-fixture-assembly parts/base.scad --from drafts/base.scad --expected OPENED_SHA256
~~~

The expected digest prevents a stale AI or browser draft from overwriting a
newer edit. Every changed SCAD or Python source also creates immutable
before/after revision artifacts. To create a larger environment, place a
descriptor beside its source
tree and import it:

~~~json
{
  "cad_project_id": "cad-enclosure",
  "name": "Instrument enclosure",
  "engine": "openscad",
  "entry": "assembly.scad",
  "files": [
    "assembly.scad",
    "parts/base.scad",
    "parts/lid.scad",
    "assets/connector.stl"
  ],
  "parts": [
    {"id": "base", "source": "parts/base.scad", "module": "base"},
    {"id": "lid", "source": "parts/lid.scad", "module": "lid"}
  ],
  "build_volume_mm": [250, 210, 220]
}
~~~

~~~powershell
sciencecode cad create designs/enclosure/project.json
~~~

A CadQuery descriptor uses an engine of `cadquery`, a declared `.py` entry,
optional named `symbol` metadata for parts, and deterministic tessellation
tolerances:

~~~json
{
  "cad_project_id": "cad-instrument-frame",
  "name": "Instrument frame",
  "engine": "cadquery",
  "entry": "assembly.py",
  "files": ["assembly.py", "parts/__init__.py", "parts/frame.py"],
  "parts": [
    {"id": "frame", "source": "parts/frame.py", "symbol": "make_frame"}
  ],
  "parameters": {"width_mm": 80, "height_mm": 40},
  "tessellation": {
    "linear_tolerance_mm": 0.05,
    "angular_tolerance_rad": 0.1
  },
  "build_volume_mm": [250, 210, 220]
}
~~~

CadQuery source can also read and transform a declared STEP/CAD asset without
overwriting it. Resolve assets from the injected immutable snapshot root and
return a new model:

~~~python
import cadquery as cq
from pathlib import Path

def build(parameters):
    source = Path(SCIENCECODE_SOURCE_ROOT) / "assets" / "input.step"
    model = cq.importers.importStep(str(source))
    return model.translate((float(parameters.get("offset_x_mm", 0)), 0, 0))
~~~

The specification directory may contain up to 256 declared source or CAD files
and 512 named parts. Supported assets include SCAD, Python, STL, STEP/STP,
IGES/IGS, BREP, 3MF, OBJ, OFF, AMF, DXF, SVG, and JSON. ScienceCode copies
them into one project-owned CAD environment and rejects absolute paths, parent
traversal, undeclared OpenSCAD references, links, oversized files, and secrets.
OpenSCAD references must be statically discoverable. CadQuery Python can import
from the declared source snapshot for reproducibility, but it still runs with
the user's OS permissions and is not a network or filesystem sandbox.

Render, inspect, screen, and slice a verified build. A CadQuery build returns
both `assembly.stl` and `assembly.step`; every artifact is hash-addressed in the
immutable manifest:

~~~powershell
sciencecode cad build cad-enclosure
sciencecode cad verify CAD_BUILD_ID
sciencecode cad simulate CAD_BUILD_ID
sciencecode cad slice CAD_BUILD_ID
sciencecode cad verify CAD_SLICE_ID
~~~

The built-in CAD screen is intentionally a geometry and printability
screen: topology, dimensions, volume, mass estimate, build-volume fit, and
orientation-dependent overhang. It is not FEA or structural, stress, thermal,
fluid, fatigue, tolerance, collision, support, material, or printer-safety
validation.

For a recorded model, initialize the independent mesh example, the bounded
surface-thermal example, or provide a project-relative Python solver.
ScienceCode automatically supplies and verifies the immutable STL as a
declared input and records the exact CAD parent:

~~~powershell
sciencecode simulate init cad-mesh-validation
sciencecode cad physics CAD_BUILD_ID simulations/cad-mesh-validation.py --device cpu --seed 17 --param density_g_cm3=1.24
sciencecode simulate init cad-surface-heat
sciencecode cad physics CAD_BUILD_ID simulations/cad-surface-heat.py --device cpu --seed 23 --param hot_face=x_min --param cold_face=x_max --param hot_temperature_c=80 --param cold_temperature_c=20 --param thermal_diffusivity_mm2_s=0.1 --param duration_s=10 --param steps=200
sciencecode cad study CAD_BUILD_ID simulations/cad-surface-heat.py --name "Surface thermal sensitivity" --hypothesis "Normalized diffusivity changes the final mean field." --seeds 23 --device cpu --param hot_face=x_min --param cold_face=x_max --param hot_temperature_c=80 --param cold_temperature_c=20 --param duration_s=10 --param steps=200 --vary thermal_diffusivity_mm2_s=[0.05,0.1,0.2]
~~~

The Lab CAD simulation panel runs the same recorder without leaving the
workspace. Its guided Surface thermal field preset can install or verify the
exact packaged template without overwriting a different project file. Select a
verified build, choose the preset or another project-relative Python script,
CPU/auto/CUDA device, deterministic seed, timeout, JSON parameters, JSON
script arguments, and any additional declared project inputs, then launch the
model. Its live job and immutable result remain attached to that build. Stop
terminates the owned process tree and finalizes a verified cancelled record
with available logs and partial artifacts; the project gate still treats that
outcome as incomplete.

Expand **Comparative parameter study** to run the same script, device policy,
timeout, arguments, and declared inputs over a fixed-parameter/variation/seed
matrix. ScienceCode freezes the complete Cartesian plan before execution,
limits it to 64 branches, binds every child to the same verified mesh hash,
and writes results JSON, aggregate CSV, deterministic reviewer checks, and a
direct CAD-build-to-experiment lineage edge. Branch fields can be opened in
the same rotatable scalar viewer. **Share comparison with AI** records only
the bounded branch counts, varied names, reviewer verdict, and numeric
aggregates as next-turn context. **Stop study** terminates the active branch,
preserves completed and partial branch evidence, writes explicit `not_run`
rows for untouched branches, and finalizes one verified cancelled experiment
ledger. The same safe finalization runs if the bounded whole-matrix clock
expires. The default project gate still treats that incomplete outcome as a
failure unless failed experiments and simulations are explicitly accepted.

`cad-surface-heat` performs an explicit normalized diffusion step over the
bounded triangle-mesh vertex graph. It rejects unknown parameters, more than
20,000 unique vertices or triangles, more than 60,000 edges, overlapping
boundary bands, invalid values, and a diffusion number above 0.45. It records
`summary.json`, convergence history, and an ASCII PLY whose
`temperature_c` field is rendered as a blue-to-red surface. Rotate or zoom
the result, select a vertex, and share the exact range/value with the next AI
turn. This is exploratory surface-graph diffusion—not volumetric conduction,
FEA, a validated material model, or thermal-safety evidence.

Lab refreshes NVIDIA memory immediately before an auto or CUDA launch and
requires at least 2,048 MiB free by default. The reserve is adjustable from
256 through 16,384 MiB; choose CPU if another workload owns the card. The
reusable live check exercises this exact UI/API path and closes its transient
server:

~~~powershell
npm run smoke:cad-model -- E:\path\to\project --build CAD_BUILD_ID --device cpu --home E:\path\to\ScienceCodeHome
npm run smoke:cad-thermal -- E:\path\to\project --build CAD_BUILD_ID --device cpu --home E:\path\to\ScienceCodeHome
npm run smoke:cad-study -- E:\path\to\project --build CAD_BUILD_ID --device cpu --home E:\path\to\ScienceCodeHome
~~~

Use device cuda only after checking free GPU memory. A physics solver remains
responsible for material data, governing equations, loads, constraints,
boundary conditions, mesh convergence, validation, and uncertainty. The NPU
path remains bounded ONNX inference; it is not a general CAD or thermal solver.

Preview slicing is the default and is configured for zero extrusion and zero
temperature. ScienceCode records and scans the G-code for extrusion, heater,
homing/leveling, spindle, fan, bounds, and relative/absolute motion. A
project-relative printer profile requires explicit physical-risk
acknowledgement; slicer post-processing, printer upload, network/serial/USB
transmission, and printer control remain disabled. G-code is always physical
machine-control data that needs independent printer, material, motion, thermal,
operator, and site review.

Open CAD in ScienceCode Lab to choose OpenSCAD or CadQuery, edit every declared
text source, inspect binary assets and hashes, download verified STL/STEP
outputs, watch build/screen/model/slice jobs, stop a model without losing its
partial record, rotate/zoom/select the shaded STL, read topology and
printability reports, inspect editable G-code, and hand the exact selection,
gesture, edit, outcome, or direction to the next Scientist turn. Use `/cad`
inside the bundled engine to invoke the dedicated multi-engine workflow.

## Hypothesis-driven experiment matrices

```powershell
sciencecode experiment run simulations\reaction-diffusion.py `
  --name "Feed-rate sensitivity" `
  --hypothesis "Changing feed rate changes the final activator distribution." `
  --seeds 101,202 `
  --device cuda `
  --param width=256 `
  --param height=256 `
  --param steps=400 `
  --vary "feed=[0.045,0.06]"

sciencecode experiment list
sciencecode experiment verify EXPERIMENT_ID
```

ScienceCode expands the deterministic Cartesian matrix sequentially with a
64-branch safety cap. Every branch is an independently verifiable simulation.
The parent freezes the hypothesis and plan, links every branch, exports
`summary.csv`, calculates coverage and finite-value checks plus aggregate
mean/range/sample-standard-deviation values in `review.json`, and cross-checks
the plan, aggregate, reviewer calculations, and child manifests.

Integrity and outcome status are separate: a failed numerical experiment can
be faithfully recorded and verifiable while still failing the default gate.

## Bounded hypothesis-tree campaigns

Use a campaign when a research question needs several evidence, compute, and
review tasks with explicit competing explanations. Start from the validated
GPU/NPU-capable template, edit every placeholder and budget, and bind it to an
existing ScienceCode conversation:

```powershell
Copy-Item templates\campaign.json campaign.json
sciencecode campaign create campaign.json --chat CHAT_ID
sciencecode campaign show CAMPAIGN_ID
sciencecode campaign verify CAMPAIGN_ID

sciencecode campaign decide CAMPAIGN_ID evidence-map approved `
  --note "Approve only the bounded evidence map."
sciencecode campaign advance CAMPAIGN_ID evidence-map
```

The immutable plan orders hypotheses so every child names an earlier parent
and one relation: `alternative`, `refinement`, `mechanism`, or `rebuttal`.
Each task names the hypotheses it tests, dependencies, expected outputs,
risk, compute target, attempt limit, and checkpoint. Global ceilings and every
active branch ceiling are enforced before dispatch. GPU and NPU labels are
budgets, not execution claims; the task must still use a verified ScienceCode
simulation, experiment, inference, evidence, or review record.

Open **Campaigns** in Lab to edit/freeze the plan, approve or skip a task, run
exactly one AI turn, follow its bounded live output, inspect the hash-chained
ledger, pause or prune branches, and see the next task or hypothesis
checkpoint on the main harness board. Completed tasks remain linked to their
normal conversation turns and recorded runs. Schema-v1 campaign records remain
readable and verifiable but do not silently gain version-2 assessment events.

After relevant work settles, the user records a scientific verdict and branch
decision:

```powershell
sciencecode campaign assess CAMPAIGN_ID candidate-effect supported continue `
  --rationale "The completed sensitivity and adversarial checks meet the stated rule." `
  --task evidence-map --task gpu-sensitivity --task npu-screen --task adversarial-review
```

Verdicts are `supported`, `challenged`, `falsified`, or `inconclusive`;
decisions are `continue`, `pause`, `prune`, or `promote`. Assessments never
rewrite prior events. A newer assessment supersedes the older one, and any
later completed or skipped task on that branch makes the prior verdict visibly
stale and reopens the final checkpoint. Automatic pruning is disabled.

The bundled Scientist may recommend a verdict with exact completed task IDs
but is instructed and command-denied from submitting the canonical assessment
CLI. The Lab form is an explicit local-user action. This is a workflow
boundary, not identity authentication or an OS security boundary: another
local process with project access could still forge/recompute local records.
Campaign network policy is also prompt policy, not container isolation.

## Procedure Studio

Open **Procedures** in the Lab to edit a complete JSON plan and watch its step
and dependency board update. The browser preview is only a draft aid. An
explicit freeze invokes strict server normalization, verifies linked immutable
evidence, and creates a new additive record. **Revise current plan** loads a
verified plan into the editor and sets its supersession link; it never changes
the archived plan.

Start a CLI workflow from templates/procedure.json:

~~~powershell
Copy-Item templates\procedure.json procedure.json
# Add immutable evidence IDs and replace every placeholder.
sciencecode procedure create procedure.json --chat CHAT_ID
sciencecode procedure verify PROCEDURE_ID
sciencecode procedure assess PROCEDURE_ID --chat CHAT_ID
sciencecode procedure assessment verify PROCEDURE_ASSESSMENT_ID
~~~

The logical dry-run topologically orders steps; checks material, equipment,
hazard, and dependency references; totals known durations and material amounts;
checks source, resource, control, training, emergency, and hazard gates; and
previews neutral mappings to XDL 2.0 and Opentrons Python. It does not simulate
a facility or generate an executable robot protocol. XDL describes a
hardware-independent procedure with reagent, hardware, and step sections, while
Opentrons protocols still require exact robot, deck, labware, instruments,
wells, API version, and vendor simulation. See the
[XDL 2.0 standard](https://croningroup.gitlab.io/chemputer/xdl/standard/index.html),
[Opentrons Protocol Designer documentation](https://docs.opentrons.com/protocol-designer/about/),
and [Opentrons simulation reference](https://docs.opentrons.com/python-api/reference/execute-simulate/).

A qualified human can record a local decision in the Lab or CLI:

~~~powershell
sciencecode procedure decide PROCEDURE_ID PROCEDURE_ASSESSMENT_ID --decision approve --scope external_physical_execution --reviewer "Named reviewer" --role "Qualified facility role" --basis "Reviewed the exact frozen plan and assessment" --conditions "Facility authorization and controls remain required" --expires 2026-09-01T00:00:00Z --attest --chat CHAT_ID
sciencecode procedure decision list --procedure PROCEDURE_ID --json
sciencecode procedure decision verify PROCEDURE_DECISION_ID
~~~

This is a scoped local attestation, not identity verification, regulatory
approval, or hardware permission. An expired decision, a newer assessment, or
a superseding plan makes the older approval ineffective. A blocked assessment
cannot be approved. ScienceCode always records physical execution as disabled.

Selecting a plan step, dry-run gate, finding, adapter, or decision in the Lab
can be shared to the active conversation. That action is secret-scanned,
bounded, append-only, audit-linked, and visible in lineage. The next AI turn
receives the selected state as untrusted user context and is reminded that
physical execution remains disabled.

## Preregistered confirmatory analysis

Use a contract when the primary outcome and decision rule must be fixed before
the experiment runs. Start from `templates/analysis-contract.json`, replace
every placeholder, and keep the referenced Python script unchanged between
contract creation and execution:

In the Lab, open **Confirmatory**, complete and freeze the structured Markdown
plan, then use that verified registration in the contract editor below it. A
conversation is optional for registration, contract, and assessment creation;
when selected, it receives a separate bounded handoff rather than owning the
scientific record.

```powershell
sciencecode preregister freeze preregistration.md --name terminal-score-study
sciencecode analysis contract create analysis-contract.json --chat CHAT_ID
sciencecode analysis contract verify ANALYSIS_CONTRACT_ID

sciencecode experiment run analysis.py `
  --name terminal-score-confirmation `
  --hypothesis primary-score-meets-threshold `
  --seeds 101,202,303 `
  --device cuda `
  --analysis-contract ANALYSIS_CONTRACT_ID

sciencecode experiment verify EXPERIMENT_ID
sciencecode analysis assess ANALYSIS_CONTRACT_ID EXPERIMENT_ID --chat CHAT_ID
sciencecode analysis assessment verify ANALYSIS_ASSESSMENT_ID
```

The normalized contract records the analysis population, conditions,
missing-data and multiplicity policies, exclusions, sensitivity analyses, and
up to 32 primary, secondary, or exploratory outcomes. Each outcome has an
exact result key, variable, registered unit, timepoint, summary measure,
intercurrent-event strategy, branch filter, aggregation, minimum count, and
typed threshold. All primary outcomes control the primary verdict; secondary
and exploratory outcomes never silently replace it.

Schema 2 is explicit. A contract outcome declares its display/aggregation unit,
and every threshold carries its own unit so normalization can reject a
dimension mismatch and freeze the converted threshold. This abbreviated excerpt
shows the typed fields; the shipped template contains every required field:

```json
{
  "schema_version": 2,
  "outcomes": [{
    "outcome_id": "latency",
    "statistic": "latency",
    "unit": { "symbol": "ms" },
    "aggregation": "mean",
    "minimum_count": 3,
    "decision_rule": {
      "operator": "greater_than_or_equal",
      "value": { "value": 0.55, "unit": "s" }
    }
  }]
}
```

The bound script must emit typed values in `summary.json`. Bare numbers remain
valid only for legacy schema-1 contracts:

```json
{
  "final_statistics": {
    "latency": { "value": 0.7, "unit": "s" }
  }
}
```

Schema 3 makes a contract inferential. An outcome may declare a preregistered
one-sample Student, two-sample Welch, or paired t-test with sidedness, alpha,
and a typed null value (two-sample and paired tests also name the branch
parameter and the two arm values; a paired test additionally names the
`pair_parameter` whose shared value aligns the two arms — the seed of a
crossed experiment matrix pairs naturally), and the contract freezes one
multiplicity correction — `none`, `bonferroni`, or `holm_bonferroni` — over
the family of primary declared inferences. At least one primary inference is
required so the family cannot be empty, and a two-sample or paired outcome
needs `minimum_count` of at least 4:

```json
{
  "schema_version": 3,
  "multiplicity_correction": "holm_bonferroni",
  "outcomes": [{
    "outcome_id": "arm_difference",
    "role": "primary",
    "unit": { "symbol": "ms" },
    "minimum_count": 4,
    "decision_rule": { "operator": "greater_than_or_equal",
      "value": { "value": 0, "unit": "ms" } },
    "inference": {
      "test": "welch_t_two_sample",
      "sidedness": "two_sided",
      "alpha": 0.05,
      "null_value": { "value": 0, "unit": "ms" },
      "group_parameter": "arm",
      "group_a": "treatment",
      "group_b": "control"
    }
  }]
}
```

The assessment replays every declared test with the pinned deterministic
statistics engine, applies the frozen correction with the preregistered
family size (missing data can never shrink the multiplier), and derives each
inferential outcome's status from the corrected decision while still
reporting the threshold rule as `threshold_status`. Every computable
inference carries its statistic, degrees of freedom, raw and adjusted
p-values, and a sidedness-matched confidence interval at the unadjusted
level in the outcome's frozen unit — except an equivalence outcome, whose
interval is the 1 - 2·alpha interval that corresponds to its TOST decision.
Assumptions are stated, not checked: approximate normality and independence,
no causal, clinical, or regulatory conclusion.

Two of the declarable tests are rank-based: `mann_whitney_u` for two
independent arms and `wilcoxon_signed_rank` for paired measurements. They use
the same `group_parameter`/`pair_parameter` machinery as their parametric
counterparts, so swapping one for the other changes nothing about how the data
are collected — only what is assumed about them. A preregistered rank test
reports a distribution-free confidence interval obtained by trimming order
statistics of the pairwise differences, not a t interval, and a rank-biserial
correlation in place of Cohen's d. Because they compare orderings rather than
distances from a margin, they cannot express an equivalence claim, and the
contract refuses one rather than approximating it.

Declaring `equivalence` sidedness preregisters a margin claim instead of a
superiority one. The outcome supplies `equivalence_lower`,
`equivalence_upper`, or both, as typed quantities on the correct side of its
null. Both bounds test two-sided equivalence; a lower bound alone tests
non-inferiority and an upper bound alone non-superiority. The assessment runs
one one-sided test per declared bound and reports the largest of their
p-values, so the claim is established only when every declared bound is
cleared. Conclusions name the claim — `equivalent`, `non_inferior`,
`non_superior`, or the corresponding `not_…` — and the reported interval is
the one that matches the decision: two-sided at 1 - 2·alpha for equivalence,
one-sided at 1 - alpha for a single margin, which is why a two-bound alpha
must be below 0.5. The labels describe the *sign* of the bound, not which
direction is clinically better: an outcome where smaller values are better,
such as latency, expresses "no worse than 50 ms slower" as an upper margin
and is therefore labelled `non_superiority`. Failing to establish a margin
claim is not evidence of a difference, and
these outcomes are corrected in the same multiplicity family as every other
declared inference.

The declared `null_value` is the hypothesis actually tested, not decoration:
a one-sample test centers on it, a paired test uses it as the null mean
difference, and a two-sample test shifts the Welch statistic by it, so
preregistering a 200 ms superiority margin genuinely requires clearing that
margin rather than merely beating zero.

Each computable inference also reports a standardized effect size —
`cohens_d` for one-sample, `cohens_d_z` on within-pair differences for a
paired test with a zero null, `standardized_mean_difference_vs_null` when a
paired null is nonzero, and `cohens_d_average_variance` for Welch, which
standardizes by `sqrt((var_a + var_b) / 2)` and so does not assume equal
variances. Each carries Hedges' small-sample correction `J = 1 - 3/(4·df - 1)`
computed on the variance-estimate degrees of freedom (`n1 + n2 - 2` for
Welch), reported as `hedges_g`. Below two degrees of freedom the correction
collapses toward zero, so it and `hedges_g` are reported as `null` rather
than shrinking a real effect to nothing. Effect sizes describe magnitude
under the same stated assumptions; they are not evidence of importance.

Contracts frozen under an earlier statistics engine keep replaying under that
engine's behavior. Verification accepts any supported recorded version, and
the assessment dispatches on the version in the frozen manifest, so adding a
computation never invalidates or silently rewrites an existing record.

Hand-check any frozen assessment against the same pinned engine, or explore a
design before preregistering it:

```powershell
sciencecode stats ttest --values 1,2,3,4,5 --null 2
sciencecode stats ttest --group-a 620,655,640 --group-b 510,505,520 --null 100
sciencecode stats ttest --group-a 620,655,640,630 --group-b 510,505,520,515 --paired
sciencecode stats tost --group-a 100,102,101,99 --group-b 100,101,100,100 --lower -5 --upper 5
sciencecode stats tost --group-a 620,655,640 --group-b 510,505,520 --lower -50
sciencecode stats quantile 0.975 9
sciencecode stats adjust 0.01,0.04 --correction holm_bonferroni --family 3
sciencecode stats ranktest --group-a 12,15,9,20,7 --group-b 11,14,8,19,6
sciencecode stats ranktest --group-a 2,4,6,8,10 --group-b 1,2,3,4,5 --paired
```

The calculator runs the exact engine the contracts use, so its numbers
reproduce a frozen record bit for bit. It records nothing, corrects nothing
you did not declare, and states that normality and independence are assumed
rather than checked.

`stats ranktest` is the exception to that normality assumption. It runs
Mann-Whitney U, or Wilcoxon signed-rank with `--paired`, using only the
ordering of the observations — so a skewed or heavy-tailed outcome can be
tested without pretending it is Gaussian. These test a shift in location
rather than a difference in means, and report a Hodges-Lehmann location shift
and a rank-biserial effect size instead of a mean difference and Cohen's d.
Small untied samples use the exact null distribution; ties, dropped zero
differences, or larger samples fall back to a tie-corrected normal
approximation with a continuity correction, and the result states which was
used. Independence is still assumed.

### Dose-response potency

Fit a concentration-response curve and report the half-maximal concentration:

```powershell
sciencecode potency fit --concentrations 1,3,10,30,100,300,1000,3000,10000 `
  --responses 99.6,98.8,96.2,89.3,71.4,45.5,20,7.5,2.4 --unit nM
sciencecode potency fit --concentrations 1,10,100,1000,10000 `
  --responses 100,88,50,12,2 --model three_parameter_logistic --bottom 0
```

A four- or three-parameter logistic curve is fitted by Levenberg-Marquardt
and reported with its Hill slope, plateaus, and a confidence interval taken on
the log10 concentration scale, where the estimator is far closer to symmetric.
The fit is deterministic and order-invariant — a fixed starting rule, a fixed
Jacobian step, a fixed iteration count, and points sorted before accumulation
— so identical data replays to identical bits regardless of how it was
listed.

Concentrations must be strictly positive, because the model is logarithmic in
dose: a vehicle control belongs in the bottom plateau, not as a zero
concentration. The fit refuses input it cannot honestly model rather than
returning a number anyway.

What it reports beyond the potency matters as much as the potency. A
four-parameter fit can invent a plateau the assay never reached and then
report a confident midpoint between one measured and one imaginary asymptote,
with an r-squared above 0.999 — so `plateau_coverage`,
`lower_plateau_observed`, and `upper_plateau_observed` state whether the data
actually bracket the curve. `extrapolated` flags a potency outside the
concentrations tested, `saturated_design` flags a model with as many free
parameters as concentrations, `fit_worse_than_mean` flags a negative
r-squared, and `converged` and `stopped_early` report an optimizer that did
not settle. A potency is relative to its assay format and readout: it is
neither an affinity nor a dose, and none of this is a clinical or regulatory
conclusion.

Inspect the bounded registry or test a conversion before freezing a contract:

```powershell
sciencecode unit list
sciencecode unit inspect mg/L --json
sciencecode unit convert 0.7 s ms --json
```

Unit expressions are case-sensitive and use explicit `*`, `/`, and `^` only.
The registry covers dimensionless ratios/percent/ppm/ppb, count and arbitrary
units, common mass/length/time/amount/volume units, absolute and difference
temperature, frequency, pressure, energy, power, force, and molar units;
compatible compounds such as `mg/L`, `m/s`, and `kg/m^3` are derived. Unknown
symbols, implicit multiplication, excessive factors/exponents, non-finite
quantities, incompatible dimensions, and absolute temperatures inside compound
units fail closed. This checks declared dimensional consistency—not whether the
script measured the stated variable, whether a value is physically plausible,
or whether the selected statistic is scientifically appropriate.

The deterministic assessor reports both `outcome_verdict` and
`registration.status`. A threshold may pass while the record remains
`deviated` or `unregistered`; ScienceCode will not present that pair as
prospective confirmatory evidence. `--deviation` records a disclosed departure
as a new immutable assessment, while earlier assessments remain historical.
This threshold engine does not calculate p-values, confidence intervals,
causal effects, clinical benefit, or regulatory validity.

Open **Confirmatory** in the Lab to author the registration, edit the JSON
contract template, select an experiment, disclose a deviation, inspect exact
Markdown and branch-level replay, and optionally send a written focus to the
active AI conversation. Browser drafts remain local; freeze and assessment
actions enter the scientific audit chain, while AI visibility remains a
separate optional interaction.

## Recorded non-interactive runs

```powershell
sciencecode run --agent scientist -- "Test whether treatment A changes outcome Y in data.csv"
```

Recorded runs default to OpenCode JSON event capture. Each run creates
`.sciencecode/runs/<run-id>/` with:

- a request record or prompt digest
- a final manifest and independent manifest digest
- redacted stdout/stderr
- redacted raw JSON events
- before/after SHA-256 snapshots
- a classified file-change summary
- linked hash-chained audit events

Useful inspection commands:

```powershell
sciencecode runs
sciencecode show RUN_ID
sciencecode verify-run RUN_ID
sciencecode audit verify
sciencecode gate
```

`sciencecode gate` is suitable for local CI. It checks audit integrity, every
recorded run, simulation, experiment, analysis contract, confirmatory
assessment, kernel/cell, evidence source, evidence retrieval, semantic-review
record, immutable figure comparison, semantic figure registration, decoded-pixel
figure validation, frozen
preregistration, every CAD
project/build/screen/slice and linked
model parent, and all cross-record
lineage links, plus failed outcome status. A scientifically concerning but
untampered review remains visible without being confused with record-integrity
failure. Failed,
timed-out, or interrupted kernel cells fail the default gate unless the
explicit `--allow-failed-kernel-cells` review override is used.

The Lab's **Verification** workspace invokes this same verifier. It defaults to
the strict policy, maps all eight `--allow-failed-*` CLI choices to explicit
checkboxes, and shows integrity versus outcome blockers separately. Allowances
never suppress a digest, schema, audit, reference, or lineage failure. The
browser receives a redacted report capped at 128 findings and 12 KiB per
diagnostic body; the report fingerprint, omission count, and truncation state
make that projection explicit.

## Preregistration

The Confirmatory Lab can author a registration directly. It requires one
populated Markdown heading for each of research question, hypotheses, design
and population, primary outcomes, sample size/stopping, inclusion/exclusion/
missing data, analysis/decisions, multiplicity/sensitivity, and deviations/
risks/limitations. Bracketed `[REPLACE: ...]` prompts, duplicates, missing or
empty sections, secrets, and content above 256 KiB are refused before state is
created.

For a file-based workflow, copy `templates/preregistration.md` into a study,
complete it before inspecting confirmatory outcomes, and freeze it:

```powershell
sciencecode preregister freeze preregistration.md --name "treatment-a-study"
sciencecode preregister list
sciencecode preregister verify PREREGISTRATION_ID
```

Native authored records use schema 2 and replay the exact required-section
contract over the immutable Markdown bytes. File-based schema-1 records remain
supported; later changes to their project source are reported as drift without
altering the frozen copy. Both forms store content and record hashes plus an
audit event, and only verified frozen bytes are served back through the Lab.

## Snapshots

```powershell
sciencecode snapshot
sciencecode verify .sciencecode/snapshots/SNAPSHOT.json
sciencecode verify .sciencecode/snapshots/SNAPSHOT.json --strict
```

The default command writes an immutable schema-2 manifest under
`.sciencecode/snapshots/` through the bounded managed pending/commit lifecycle,
then appends its exact SHA-256 and file count to the audit chain. The Lab's
**Reproducibility** view discovers those CLI-created manifests and can also
capture a new one itself. It lists audit-binding state, serves an exact JSON
download, and runs verification without blocking other loopback reads.

Strict verification reports files added since capture in addition to modified,
missing, unreadable, and type-mismatched paths. Turning strict mode off ignores
only additions; captured files and record integrity are still enforced.
Snapshot paths are validated before access and cannot traverse outside the
project. Managed snapshot files and their registry directories must be normal
contained files/directories, never symlinks or junction escapes.

Managed CLI and Lab capture is limited to 100,000 entries, 16 GiB of declared
project bytes, and a 32 MiB JSON manifest. The Lab additionally uses a
five-minute, 4 MiB-output worker boundary to keep hashing off the server event
loop. The browser receives at most 128 redacted findings of 12 KiB each;
omission and truncation remain explicit. A managed capture is first written as
a job-specific pending file, independently rehashed by the committing process,
exclusively committed, and then audit-bound. Lab cancellation removes only that
uncommitted pending file.

A snapshot proves that local bytes match a locally recorded hash and audit
event. It is not an external timestamp, signature, backup, scientific
validation, or protection from an attacker who can rewrite the entire project
and audit history.

## Interactive and server modes

```powershell
sciencecode tui
sciencecode web
sciencecode serve --hostname 127.0.0.1 --port 4096
```

`web` and `serve` use the same isolated runtime. Keep servers on loopback unless
you have intentionally configured authentication and network controls.

## Local conversational workbench

```powershell
sciencecode lab
```

Open `http://127.0.0.1:4311`. Chat is the primary interaction: choose a
scientist role, ask a question, and continue the same research session. Every
turn becomes an immutable transcript record linked to its recorded engine run.
Scientific records produced during a turn appear directly in the conversation.

Turns run as local asynchronous jobs so the interface stays responsive. The
Activity tab shows an allowlisted trace of actual engine events and tool names,
statuses, titles, and timing; raw tool inputs and outputs are intentionally not
copied into the side panel. Design stages and specialist lanes are derived from
verified records rather than simulated progress.
The pending assistant message separately displays completed OpenCode JSON text
parts as they arrive. ScienceCode redacts them again at the Lab boundary, limits
each block to 8 KiB, retains at most 32 blocks and 48 KiB per job response, and
labels omitted earlier content. This is truthful block-level progress: the
pinned engine does not provide general token deltas through this transport.
The active turn can be stopped from the harness. ScienceCode aborts the engine
process, preserves bounded partial output as a cancelled record, and records
the stop as user context so a follow-up does not mistake the partial response
for a completed result.

The same workspace displays GPU and NPU health, profiled ONNX inference outputs,
persistent multi-file CAD source, rotatable verified meshes, CAD-linked
CPU/GPU model records, geometry screens, slice history, editable G-code,
persistent Python/R notebooks, experiment matrices, the editable Confirmatory
contract/assessment board, reviewer statistics, branch links, generated
figures, figure rerun records, semantic figure registrations, decoded-pixel
figure validations, runtime metadata, and artifacts.
The Reproducibility view creates and checks audit-bound project baselines in an
owned child process, exposes exact manifest downloads and categorized bounded
drift, and resumes its latest process-local job after a view reload.
The Verification view runs the complete audit/record/lineage gate in an owned
child process, exposes bounded exact diagnostics, and leaves the rest of the
local interface responsive while it works.
The Evidence view can ingest a project-relative source, search deterministic
page spans, open the immutable original, read extracted pages, and attach a
source/page direction to the selected conversation.
Code-like artifacts open in an editor; CSV/TSV and real multi-sheet `.xlsx`
artifacts open in an editable grid and a linked pan/zoom/select plot; raster
figures open in a zoomable annotation workspace with immutable baseline/rerun
pixel and optional block-luminance SSIM comparison, adjustable
overlay/difference views, region handoff, producer-sidecar semantic
registration, and matched-registration pixel validation; and
PDB, MOL/SDF, XYZ, OBJ,
and ASCII PLY files open in a draggable, zoomable, selectable 3D canvas. Draft
downloads stay local. Sharing an edit, cell set, plot selection or direction,
figure view, annotation, comparison inspection, 3D view, stage focus, or
outcome direction appends a
separate tamper-evident interaction record; the next AI turn receives that
user-authored context. Archived scientific artifacts are never silently
overwritten.

The Lineage view makes those relationships navigable. It connects source spans
to retrievals and turns, cells and saved workspace state to the turns they
informed, experiments to simulation branches and output artifacts, source
figures to immutable rerun comparisons and their difference outputs, semantic
registrations to PNG/table/sidecar inputs and replay reports, visual validations
to their semantic parents and decoded-pixel reports, and
source artifacts to later edits or views. The graph itself is read-only; selecting or
sharing a trace creates a new interaction record instead of changing history.

It binds only to loopback. Chat mutations require same-origin JSON requests,
bounded bodies, secret preflight, and one active turn per conversation.
Artifact and transcript reads reject traversal, symlink escapes, and files not
named by their manifests.

## Safety model

ScienceCode blocks common secrets before prompts, chat turns, workspace
interactions, or preregistrations are persisted, redacts captured credentials, rejects path
traversal in verification records, uses exclusive creation for immutable
artifacts, and includes cross-platform destructive-command guardrails in its
agents.

Drug-discovery and procedure work is decision support and design. ScienceCode
does not authorize clinical care or physical laboratory, chemical, biological,
or hardware execution; those workflows keep safety review, validation/dry-run,
and named human approval visible as unresolved gates.

Notebook cells and simulation scripts are arbitrary local code. They run with
the user's OS permissions; a child process and the private file/stdin protocol
are observability and failure boundaries, not a security
sandbox. Explicit restore can repeat file writes, network calls, or other side
effects from earlier cells. Review code and history before execution or replay.

OpenSCAD and slicer processes also run with the user's OS permissions.
ScienceCode confines declared source paths, snapshots inputs, disables dynamic
imports and slicer post-processing, and never transmits G-code, but those
controls do not certify geometry, materials, loads, printer motion, thermal
behavior, firmware, or operator safety.

Confirmatory assessment is deterministic threshold replay over recorded
`final_statistics`. Schema 2 checks and converts declared dimensions, but it
does not infer a missing unit, validate the scientific meaning or physical
plausibility of a declaration, estimate sampling uncertainty, calculate
p-values or confidence intervals, enforce a statistical multiplicity method,
infer causality, establish clinical relevance, or satisfy a regulator.

These are defense-in-depth controls, not a sandbox or compliance
certification. An agent that can run general code can still damage accessible
files. Keep backups, use least-privilege provider/tool credentials, review
permission prompts, and do not treat the local SHA-256 chain as an external
notarization service.

## Product accuracy evaluation

Run the deterministic release benchmark in a checkout or installed package:

```powershell
sciencecode evaluate
sciencecode evaluate --json
npm run evaluate
```

The core suite evaluates 55 labeled cases in six categories: reviewer
detection precision/recall, citation correctness, numerical review,
reproducible reruns, scientific-safety instructions, and agent-role
separation. Every threshold is prospectively fixed at 1.0 for this bounded
contract suite. It runs each evaluated projection twice, hashes the results,
binds normalized UTF-8 hashes for the implementation and prompt sources, and
returns a nonzero exit status for a case failure, threshold failure, missing or
unsafe bound source, or policy drift.

These metrics apply only to the declared fixtures. They do not establish
performance on an external corpus, statistical confidence, scientific
entailment, causal validity, clinical safety, or containment of model/tool
behavior. Use blinded expert-labeled corpora and independent review before
making broader quality claims.

## Governed external benchmarks

ScienceCode 0.36 provides a separate workflow for an independently prepared,
held-out citation-requirement corpus:

```powershell
# Blind phase: validates benchmark.json and cases.jsonl only.
sciencecode benchmark inspect benchmark.json
sciencecode benchmark inspect benchmark.json --json

# Blind phase: labels and baseline files may be physically absent.
sciencecode benchmark predict benchmark.json --output sciencecode-run.json

# After governance.labels_unsealed_at:
sciencecode benchmark score benchmark.json --predictions sciencecode-run.json
sciencecode benchmark score benchmark.json --predictions sciencecode-run.json --json
```

The schema-v1 manifest requires a `held_out_test` split, the
`sciencecode_reviewer_citation_requirement_v1` adapter, distinct positive and
negative labels, exact case and label counts/hashes, one through eight frozen
baseline runs, prospective accuracy/precision/recall/abstention thresholds,
and governance fields for independent authorship, at least two expert
labelers, expertise, labeling, adjudication, blinding, license, source,
limitations, corpus freeze, and label unsealing. Cases and labels are separate
UTF-8 JSONL files:

```json
{"case_id":"case-001","text":"The intervention increased response.","stratum":"clinical-claim"}
{"case_id":"case-001","label":"requires_citation"}
```

A manifest has this exact shape (replace the digest placeholders with hashes of
the exact file bytes):

```json
{
  "schema_version": 1,
  "benchmark_id": "independent-reviewer-corpus",
  "benchmark_version": "1.0.0",
  "title": "Independent reviewer corpus",
  "description": "A held-out corpus prepared outside ScienceCode development.",
  "split": "held_out_test",
  "task": {
    "adapter": "sciencecode_reviewer_citation_requirement_v1",
    "positive_label": "requires_citation",
    "negative_label": "does_not_require_citation"
  },
  "cases": { "file": "cases.jsonl", "sha256": "<64 lowercase hex>", "count": 100 },
  "labels": { "file": "labels.jsonl", "sha256": "<64 lowercase hex>", "count": 100 },
  "baselines": [{
    "baseline_id": "published-baseline",
    "run_file": "baseline.json",
    "run_sha256": "<64 lowercase hex>"
  }],
  "thresholds": {
    "minimum_accuracy": 0.8,
    "minimum_precision": 0.8,
    "minimum_recall": 0.8,
    "maximum_abstention_rate": 0
  },
  "governance": {
    "independent_from_sciencecode": true,
    "independent_creator": "Named independent organization",
    "independence_statement": "Who created the corpus and how conflicts were excluded.",
    "labeler_count": 3,
    "expertise_statement": "Relevant qualifications and selection criteria for the labelers.",
    "labeling_protocol": "The frozen rubric and independent labeling procedure.",
    "adjudication_protocol": "How disagreement was resolved without prediction access.",
    "blinding_protocol": "How labels stayed unavailable until prediction files were frozen.",
    "license": "SPDX identifier or exact license name",
    "source_citation": "Public citation for the corpus and protocol.",
    "limitations": "Known domain, sampling, labeling, and generalization limits.",
    "corpus_frozen_at": "2026-01-01T00:00:00.000Z",
    "labels_unsealed_at": "2026-02-01T00:00:00.000Z"
  }
}
```

Baseline and candidate runs use the same schema emitted by `benchmark predict`:

```json
{
  "schema_version": 1,
  "run_id": "published-baseline",
  "benchmark": {
    "benchmark_id": "independent-reviewer-corpus",
    "benchmark_version": "1.0.0",
    "cases_sha256": "<same cases digest>",
    "labels_sha256": "<same labels digest>"
  },
  "system": { "name": "System name", "version": "1.0.0", "adapter": "method-id" },
  "predictions_frozen_at": "2026-01-15T00:00:00.000Z",
  "label_access": "unavailable_until_predictions_frozen",
  "method": "A reviewable description of how the predictions were produced.",
  "predictions": [{ "case_id": "case-001", "label": "requires_citation" }],
  "predictions_sha256": "<SHA-256 of predictions sorted by case_id>"
}
```

The manifest's baseline ID must equal the baseline run ID. Prediction digests
are SHA-256 over compact JSON for the sorted array of `{case_id,label}` objects;
the file digest is separately calculated over exact bytes. Use PowerShell's
`Get-FileHash FILE -Algorithm SHA256` or Unix's `sha256sum FILE` for file
digests.

Prediction runs bind the benchmark ID/version and exact case/label hashes,
declare a system and method, include exactly one allowed label or explicit
`null` abstention per case, and carry a canonical prediction digest. Inspection
and ScienceCode prediction do not stat or read label/baseline content. Scoring
first validates candidate and baseline runs, refuses to proceed before the
unseal time, then reads the label file and requires both classes and exact case
coverage. Bundle references must be portable, contained regular non-link files;
the manifest is limited to 1 MiB, cases to 64 MiB/50,000 records, labels and
runs to 32 MiB, and per-case text to 64 KiB. Generated runs are written only
inside the current working directory with exclusive-create semantics.

The JSON score report omits raw input text and local absolute paths while
publishing input hashes, unsealed labels, candidate and baseline predictions,
confusion counts, stratum metrics, frozen threshold checks, and deterministic
fingerprints. Wilson intervals describe binomial uncertainty conditional on
that fixed corpus; they do not establish corpus representativeness or
scientific validity. Governance/timestamp declarations are self-attested, and
ScienceCode does not ship a genuinely independent expert corpus. External
benchmark results can extend evidence but can never replace, waive, or lower
the 55-case `sciencecode evaluate` gate.

## Development

```powershell
npm run check
npm run evaluate
npm run test:coverage
npm run pack:check
npm run smoke:kernel -- --home C:\path\to\ScienceCodeHome
```

The test suite includes real, non-model compatibility checks against the
bundled engine and a Windows regression test for command-shim argument safety.
See `DEVELOPMENT.md`, `ARCHITECTURE.md`, and `RELEASE-GATES.md`.
