# Developing ScienceCode

## Product boundary

ScienceCode is a standalone application that uses `opencode-ai` as a pinned
engine dependency. Do not add a fallback to a global `opencode` command or a
user OpenCode state directory. Runtime-isolation behavior belongs in
`lib/runtime.js` and must remain covered by `tests/runtime.test.mjs` and
`tests/opencode.compat.test.mjs`.

## Repository map

- `bin/sciencecode.js` — minimal executable entry point
- `lib/cli.js` — command parsing and user-facing output
- `lib/error-semantics.js` — shared CLI exit and Lab HTTP classification for
  stable domain error codes
- `lib/runtime.js` — bundled-engine resolution and state isolation
- `lib/runs.js` — recorded engine execution and run verification
- `lib/chats.js` — persistent engine sessions, hash-linked turns, and
  conversation/run/artifact cross-verification
- `lib/snapshot.js` — safe project hashing and snapshot verification
- `lib/audit.js` — sequenced hash-chain and head consistency checks
- `lib/preregistration.js` — schema-v1 file and schema-v2 structured-Markdown
  preregistration freeze, replay verification, safe source resolution, and
  interaction contracts
- `lib/campaigns.js` — immutable versioned hypothesis trees, append-only
  task/checkpoint/assessment events, branch budgets, replay, and verification
- `lib/project.js` — project-wide verification gate
- `lib/project-gate.js` — strict failed-outcome policy normalization plus the
  redacted, byte- and count-bounded Lab report projection
- `lib/project-gate-worker.js` — cancellable child-process bridge that keeps
  full synchronous project verification off the Lab event loop
- `lib/security.js` — prompt scanning and captured-output redaction
- `lib/doctor.js` — environment and engine compatibility checks
- `opencode/` — ScienceCode agents, skills, commands, and engine config
- `templates/` — research, preregistration, and review artifacts
- `tests/` — unit, integration, Windows, and real-engine compatibility tests

Snapshot-workflow modules:

- `lib/project-snapshots.js` - managed snapshot registry, pending/commit
  lifecycle, audit binding, bounded report projection, and record verification
- `lib/project-snapshot-worker.js` - cancellable capture/verify bridge that
  keeps complete project hashing off the Lab event loop
- `lab/reproducibility.js` - accessible baseline capture/list/download,
  strict drift verification, polling, cancellation, and bounded finding UI

Additional scientific-compute modules:

- lib/cad.js — normalized multi-engine CAD contracts, source revisions,
  immutable OpenSCAD/CadQuery STL and STEP builds, screens, slices, and verification
- lib/cad-worker.js — bounded child-process bridge for responsive Lab CAD jobs
- lib/mesh.js — bounded ASCII STL topology/geometry and G-code safety analysis
- lab/cad.js and lab/cad.css — multi-file editor, CAD reports, linked models,
  slicer controls, job provenance, and responsive workspace
- lab/campaign.js and lab/campaign.css — hypothesis-tree planner, one-task
  execution, branch assessment, budget, event-ledger, and responsive workspace
- templates/simulations/cad-mesh-validation.py — independent CPU/GPU geometry
  validation over a verified CAD parent
- `templates/simulations/cad-surface-heat.py` - bounded CPU/CUDA surface-graph
  heat diffusion over a verified CAD parent with immutable scalar-field outputs
- scripts/cad-live-smoke.mjs — real OpenSCAD, PrusaSlicer, lineage, and gate
  smoke
- scripts/cadquery-live-smoke.mjs — real isolated CadQuery, reproducible
  STL/STEP, source-integrity, Lab job/artifact, PrusaSlicer, lineage, and gate smoke
- scripts/cad-model-live-smoke.mjs — real CAD-linked model launch through the
  Lab API, lineage/gate verification, GPU-memory guard, and server cleanup
- `scripts/cad-thermal-live-smoke.mjs` - exact packaged-template installation,
  real CAD surface simulation, scalar PLY parsing, AI-visible point selection,
  lineage/gate verification, device guard, and server cleanup
- `scripts/cad-study-live-smoke.mjs` - real asynchronous three-branch CAD
  matrix, cancellable-job contract, aggregate review, AI context, harness,
  lineage, gate, hardware readiness, and server cleanup
- `scripts/lab-state-benchmark.mjs` - cold and unchanged verified `/api/state`
  timing against an artifact-rich local project
- lib/procedures.js — strict procedure normalization, immutable plan,
  deterministic logical assessment, scoped local decision, replay, currentness,
  and interaction contracts
- lab/procedure.js — browser-side editable template and bounded live draft model
- `lab/preregistration.js` — required-section template, byte/completeness
  inspection, accessible native authoring form, and optional AI handoff
- `lib/compute.js` — isolated GPU, NPU, and CadQuery runtime setup and health probes
- `lib/simulations.js` — synchronous/asynchronous recorded simulation
  execution, cancellation finalization, realpath containment, and verification
- `lib/experiments.js` — bounded matrices, synchronous/asynchronous execution,
  partial-branch cancellation, aggregate review, and verification
- `lib/analysis-contracts.js` — strict preregistration/script/outcome contract
  normalization, immutable records, bindings, and replay verification
- `lib/confirmatory.js` — deterministic branch/outcome assessment, registration
  status, immutable report history, and whole-report replay
- `lib/units.js` — bounded registered-unit parsing, dimensional compatibility,
  affine conversion, typed quantity normalization, and CLI inspection data
- `lib/figure-registrations.js` — strict semantic-figure contracts, bounded
  CSV/TSV replay, unit-aware converted data digests, producer-sidecar creation,
  immutable registration records, and whole-record verification
- `lib/figure-visuals.js` — matched-registration-only PNG projection,
  strict renderer profile normalization, bounded flat-color axis/mark masks,
  immutable decoded-pixel reports, and deterministic whole-record verification
- `lib/evidence.js` — immutable source/page/span records, BM25 retrieval,
  prompt grounding, historical replay, and verification
- `lib/pdf-extract-worker.js` — bounded package-local Mozilla PDF.js text
  extraction process
- `lib/lab.js` — loopback-only conversational API, verified state, and
  manifest-bound artifact server
- `lib/harness.js` — evidence-derived workflow, stage, lane, activity, design,
  validation, and outcome views
- `lib/interactions.js` — append-only user output/view/edit records and the
  bounded context supplied to later AI turns
- `lib/lineage.js` — deterministic verified record/artifact graph, findings,
  scoping, digest, and upstream/downstream traversal
- `lib/revisions.js` — immutable derived-artifact bytes, verified source and
  prior-version links, append-only accept/reject decisions, and audit-backed
  registry verification
- `lib/reviews.js` — immutable manuscript consistency reports, bounded claim/
  citation/calculation/artifact analysis, deterministic replay verification,
  AI interaction payloads, and audit-backed registry discovery
- `lib/kernels.js` — persistent Python/R workers, immutable cell archives,
  explicit replay, verification, chat context, and project locks
- `lib/kernel-cli-worker.js` — bounded one-lifecycle CLI bridge for async
  kernel execution
- `lib/events.js` — OpenCode event parsing plus the safe public activity
  projection that excludes tool inputs and outputs
- `runtime/` — deterministic simulation launcher, pinned requirements,
  CadQuery export adapter, and private Python/R project-kernel workers
- `lab/app.js` — dependency-free conversational workbench, harness panels, and
  editable output studios
- `lab/compute.js` — accessible simulation/experiment authoring, typed bounded
  form parsing, shared-job monitoring, cancellation, and reload recovery
- `lab/verification.js` — accessible project-gate policy, polling,
  cancellation, categorized blocker inspection, and exact bounded report UI
- `lab/chemistry.js` — bounded SMILES and MOL/SDF V2000 connectivity parsing,
  explicit-atom summaries, and deterministic depiction transforms
- `lab/genomics.js` — bounded BED/bedGraph, GFF/GTF, VCF, and FASTA parsing
  plus zero-based half-open viewport transforms
- `lab/manuscript.js` — bounded exact/coarse line diffs, review hunks, and
  AI-safe change extraction
- `lab/xlsx.js` — local bounded ZIP/XML workbook parser and rewrite engine
- `lab/geometry.js` — bounded XYZ/PDB/MOL/SDF/OBJ/ASCII-PLY geometry parser
- `lab/visualization.js` — bounded plot sampling, coordinate transforms,
  selection, and normalized figure viewport math
- `lab/lineage.js` — dependency-free graph filtering, traversal, and layout

## Local workflow

```powershell
npm install
npm run check
npm run evaluate
npm run test:coverage
npm run pack:check
```

Exercise a real independently supplied benchmark bundle in its declared phases:

```powershell
sciencecode benchmark inspect benchmark.json --json
sciencecode benchmark predict benchmark.json --output sciencecode-run.json --json
sciencecode benchmark score benchmark.json --predictions sciencecode-run.json --json
```

Prediction must occur before the manifest's label-unseal time; scoring must
occur afterward. Do not copy labels into the prediction environment merely to
make a local smoke test convenient.

Measure real Lab state assembly separately from correctness tests:

```powershell
npm run bench:lab-state -- E:\path\to\science-project 3
npm run bench:lab-state -- E:\path\to\science-project 3 --skip-compute
```

The default includes hardware discovery. `--skip-compute` isolates project
metadata, hashing, audit, verification, serialization, and HTTP costs. The
command exits nonzero if any response or audit verification fails and reports
each response's disclosed verified-state cache status.

For Lab shell changes, run the focused semantic/source contracts as well as the
server suite:

```powershell
node --test tests/lab-shell-ui.test.mjs tests/lab.test.mjs
```

Then use a real browser at desktop, tablet, and phone widths. Verify the initial
busy and failure surfaces, persistent integrity status, one-row horizontal
workspace rail, skip link, destination focus, harness arrow/Home/End tab
navigation, reduced motion, and both horizontal and vertical overflow. Static
contracts deliberately do not substitute for accessibility-tree and screenshot
inspection.

For project-gate or Verification Center changes, run the projection, real
worker/API, UI, shell, and shared-error contracts together:

```powershell
node --test tests/project-gate.test.mjs tests/project-gate-lab.test.mjs `
  tests/project-gate-ui.test.mjs tests/lab-shell-ui.test.mjs `
  tests/error-semantics.test.mjs
```

Keep `verifyProject` as the sole authority. The Lab projection may redact,
categorize, hash, and truncate diagnostics, but must never reinterpret a failed
integrity result as accepted. Use a real browser to check strict and relaxed
policy runs, cancellation, reload recovery, result focus, screen-reader status,
disclosure keyboard behavior, and overflow at desktop, tablet, and phone widths.

For snapshot primitives or the Reproducibility workspace, run the legacy CLI,
managed-domain, real worker/API, UI, project-gate, shell, and shared-error
contracts together:

```powershell
node --test tests/core.test.mjs tests/cli.test.mjs `
  tests/project-snapshots.test.mjs tests/project-snapshot-lab.test.mjs `
  tests/project-snapshot-ui.test.mjs tests/project-gate.test.mjs `
  tests/lab-shell-ui.test.mjs tests/error-semantics.test.mjs
```

Keep `snapshot` and `verifySnapshot` authoritative for project-byte capture and
comparison. Managed records may add safe registry containment, exclusive
pending/commit publication, audit binding, redaction, and output bounds, but
must not reinterpret drift or silently make a historical snapshot current.
Use a real browser to capture a baseline, run strict and relaxed comparisons,
download exact JSON, cancel and retry, reload during work, traverse every
disclosure by keyboard, inspect live/focus semantics, and check horizontal and
vertical overflow at desktop, tablet, and phone widths.

For simulation or experiment launcher changes, run both the pure UI contract
and real loopback lifecycle suites alongside the recorders:

```powershell
node --test tests/compute-ui.test.mjs tests/compute-lab.test.mjs tests/simulations.test.mjs tests/experiments.test.mjs
```

Then verify both launchers in a real browser with a selected conversation and
without one. Check template installation, matrix feedback, active cross-view
handoff, cancellation, reload recovery, detail focus, keyboard order, live
status announcements, and phone-width overflow.

When adding or changing a domain error that can reach the CLI or Lab, update
`lib/error-semantics.js` and exercise the real boundary in
`tests/error-semantics.test.mjs`. Keep malformed input distinct from a valid
identifier whose record is absent, preserve explicit route statuses, and leave
unknown internal failures fail-closed.

Run the real installed scientific-runtime smoke separately; it creates a
temporary inspectable project, executes stateful NumPy/PyTorch and Matplotlib
cells, serves the figure through Lab, verifies the project, and checks worker/
lock cleanup:

```powershell
npm run smoke:kernel -- --home C:\path\to\ScienceCodeHome
npm run smoke:kernel -- --home C:\path\to\ScienceCodeHome --require-cuda
```

The second form fails unless a real CUDA tensor executes in the live kernel.

Run the real CAD toolchain smoke in a disposable project directory:

~~~powershell
npm run smoke:cad -- E:\path\to\cad-smoke-project
~~~

It requires the OpenSCAD console and PrusaSlicer console, creates a declared
multi-file assembly, renders and verifies its mesh, runs the geometry screen,
generates a non-extruding preview, checks lineage, and runs the project gate.

Set up and exercise the independent CadQuery path as a separate release smoke:

~~~powershell
sciencecode compute setup --profile cad
$env:SCIENCECODE_HOME = 'E:\path\to\ScienceCodeHome'
npm run smoke:cadquery -- E:\path\to\cad-smoke-project
~~~

The smoke creates a multi-file Python assembly, builds twice, requires
byte-identical STL and STEP outputs, requires an unchanged source snapshot,
imports that exact STEP into a second declared environment, applies and verifies
a parametric translation without overwriting the input asset, runs geometry and
PrusaSlicer checks, starts Lab on an ephemeral loopback port,
executes a real worker-backed build, downloads and rehashes both artifacts,
runs the project gate, and closes the server.

To validate the solver bridge, initialize cad-mesh-validation in that project
and run sciencecode cad physics against the newest build. Use CPU while another
GPU workload has insufficient free memory; never stop or crowd an unrelated
process merely to satisfy a smoke test.

Exercise the same asynchronous path used by the interactive CAD model panel:

~~~powershell
npm run smoke:cad-model -- E:\path\to\cad-project --build CAD_BUILD_ID --device cpu --home E:\path\to\ScienceCodeHome
~~~

The smoke starts Lab on an ephemeral loopback port, runs the model, verifies
the CAD parent, artifacts, modeled_by lineage, and whole-project gate, then
closes the server. CUDA is opt-in and is refused before launch when the selected
GPU has less than 2,048 MiB free unless a higher bounded reserve is requested.

Exercise the native scalar-field path through the same Lab API:

~~~powershell
npm run smoke:cad-thermal -- E:\path\to\cad-project --build CAD_BUILD_ID --device cpu --home E:\path\to\ScienceCodeHome
~~~

This installs or verifies the exact packaged `cad-surface-heat.py`, runs it
against the immutable STL, checks the numerical summary, CSV history, and
temperature PLY, records a selected scalar vertex, proves that the next AI
prompt receives the field range and selected value, verifies lineage and the
project gate, and closes Lab. Use `--device cuda` only when the fresh hardware
probe satisfies the requested free-memory reserve.

Exercise the comparative path against one verified build:

~~~powershell
npm run smoke:cad-study -- E:\path\to\cad-project --build CAD_BUILD_ID --device cpu --home E:\path\to\ScienceCodeHome
~~~

The smoke runs three surface-diffusivity branches through the Lab's asynchronous
experiment finalizer,
verifies every child shares the exact CAD parent, checks nested thermal
statistics and deterministic aggregates, shares the comparison into the next
AI prompt, checks the harness board and direct lineage edge, runs the full
project gate, and closes the ephemeral server. CUDA is subject to the same
fresh free-VRAM refusal; NPU readiness is reported but never represented as
PyTorch CAD-solver execution.

OpenCode's npm package uses a postinstall script to select the platform binary.
If dependencies were installed with scripts disabled, repair the local runtime:

```powershell
npm rebuild opencode-ai
```

## Testing rules

- Tests must never depend on a global OpenCode installation or its credentials.
- Engine tests must use a temporary `SCIENCECODE_HOME`.
- Model-backed tests are opt-in; the default suite must not incur provider cost.
- GPU and NPU hardware tests are release smoke tests; unit tests inject runtime,
  process, device, and provider probes so the default suite remains
  deterministic and portable. Strict NPU tests must distinguish provider
  registration from profiled execution and must never silently install a
  provider or accept CPU fallback.
- CAD unit tests must inject tool runners. Real OpenSCAD, CadQuery, and slicer
  behavior are separate smokes. Tests must cover engine/entry matching,
  descriptor/source/reference containment,
  stale writes, immutable record completeness, mesh and G-code limits, CAD
  parent tampering, no-extrusion preview invariants, profile acknowledgement,
  post-process rejection, and the permanent absence of printer transmission.
- A CAD model script is tested under the same arbitrary-code rules as any
  simulation. Model tests must prove that the exact build-manifest and mesh
  hashes are carried into inputs, verification, audit, harness, and lineage;
  completion and cancellation share a finalizer, partial cancellation records
  verify and fail the default outcome gate, cancellation bindings cannot cross
  project/build/chat boundaries, low VRAM blocks Lab dispatch, and tests must
  not represent a geometry calculation as FEA or a GPU runtime probe as
  completed GPU execution.
- Packaged CAD simulation-template tests must prove fixed-destination,
  same-origin, strict-field behavior; exact-byte reuse; refusal to overwrite a
  differing file; and audit/interaction visibility. Surface-thermal tests must
  cover parameter allowlists and bounds, mesh/edge/component limits, explicit
  integration stability, boundary separation, finite/pinned/maximum-principle
  checks, exact parent hashes, immutable summary/history/scalar artifacts,
  scalar PLY parsing, user selection, AI context, and the explicit non-FEA
  classification.
- CAD study tests must reuse the bounded experiment planner, reject duplicate
  fixed/varied names and matrices above 64 branches, bind plan/manifest/audit
  and every child to one verified build, aggregate only finite recorded
  statistics, preserve nested surface-thermal summaries, expose Lab jobs,
  harness/AI/lineage state, refuse low-VRAM CUDA dispatch, detect parent
  tampering, and leave no server process. Cancellation tests must prove exact
  operation/project/build/chat binding, loopback responsiveness and reload
  recovery during a blocked branch, active-process abort, completed/cancelled/
  `not_run` rows, partial artifact retention, review/manifest/audit replay,
  cancelled-outcome gates, retained whole-matrix timeout, retry, and accessible
  model/study stop controls.
- Kernel tests may use an available local Python but must isolate
  `SCIENCECODE_HOME`, use temporary projects, stop every worker, and treat R as
  optional when `Rscript` is absent. Never require a model or network service.
- Filesystem tests must use OS temporary directories and validate path
  containment before destructive cleanup.
- Cross-platform behavior is required on Windows, macOS, and Linux.
- Any provenance schema change requires a schema-version decision and backward
  compatibility tests.
- Campaign changes must retain schema-v1 replay, strict tree/DAG and
  unknown-field validation, one-task dispatch, global and per-branch ceilings,
  immutable hash-chained events, completed-task/hypothesis link checks,
  superseding local-user assessments, stale-verdict replay after later settled
  work, disabled automatic pruning, explicit AI/network trust boundaries, and
  CLI/API/UI/harness/interaction/lineage/project-gate coverage.
- Revision changes must preserve source immutability, verify canonical
  manifest-bound routes and exact bytes, bound upload and ancestry depth,
  discover removed records through audit events, and test proposal plus
  accept/reject AI handoff, lineage, and project-gate behavior.
- Lineage changes must remain derived and read-only, preserve deterministic
  ordering/digests, bound nodes/edges/traces, expose missing links explicitly,
  and include tamper plus project-gate tests.
- Native scientific studio changes must keep parsing client-local and bounded,
  preserve each source format's coordinate/connectivity semantics, label any
  fallback or inference limits, provide deterministic transform tests, and
  prove that selections and edits reach the verified AI interaction chain.
- Semantic-review changes must preserve immutable target resolution,
  deterministic whole-report replay, source line/hash locators, strict claim/
  finding/byte bounds, no dynamic arithmetic evaluation or network artifact
  fetch, explicit triage limitations, adversarial tamper/path tests, and CLI/
  Lab/AI/lineage/project-gate coverage. Any deterministic extraction change
  must increment the review engine version and retain replay logic for every
  previously emitted version.
- Product-evaluation changes must keep the suite offline, project-independent,
  versioned, source-bound, and deterministic across two executions. Preserve
  all six categories, prospective thresholds, exact expected/observed cases,
  reviewer confusion metrics, contained regular UTF-8 source reads, normalized
  hashes, temporary-fixture cleanup, nonzero failure status, and explicit
  no-generalization language. Any intentional expectation change requires a
  suite-version decision; never lower a threshold merely to make a regression
  pass.
- External-benchmark changes must preserve the separation between the packaged
  release contract and user-supplied generalization evidence. Inspection and
  prediction must not resolve or read labels/baselines; prediction must reuse
  the production reviewer only inside the frozen blind window; scoring must
  validate candidate/baseline runs before opening labels after unsealing.
  Preserve strict unknown-field rejection, exact counts and canonical digests,
  stable bounded UTF-8 reads, portable realpath containment, non-link files,
  two-class expert labels, prospective thresholds, explicit abstention,
  Wilson intervals, case/stratum/baseline replay, deterministic path-free
  reports, exclusive contained outputs, adversarial timeline/hash/encoding/
  traversal tests, and self-attestation/no-generalization limitations. Never
  treat an external threshold as a waiver for `sciencecode evaluate`.
- Analysis-contract changes must preserve strict unknown-field rejection,
  preregistration and exact-script binding, prospective timestamps, deterministic
  normalization/report replay, primary-vs-nonprimary verdict semantics,
  explicit registration/deviation status, atomic immutable publication,
  audit-backed deletion discovery, and adversarial CLI/Lab/AI/lineage/gate/path
  tests. A changed deterministic engine requires a versioned replay path.

- Preregistration changes must preserve schema-v1 file compatibility and
  source-drift reporting, schema-v2 required-section replay, the 256 KiB UTF-8
  ceiling, pre-state secret rejection, exclusive immutable writes, audit and
  lineage binding, safe metadata/registry/record/source/artifact realpaths, and
  optional rather than mandatory chat interaction. Test pure browser parsing,
  same-origin API creation/list/detail/source behavior, downstream contract
  binding, tampering, malformed/absent IDs, and filesystem links together.

- Procedure changes must retain strict unknown-field rejection, mandatory
  external-human-control policy, deterministic assessment replay, immutable
  plan/assessment/decision separation, audit-backed deletion discovery,
  current-assessment and superseded-plan invalidation, unverified reviewer
  identity, non-executable adapter output, and permanent hardware disablement.
  Test CLI, API, UI, AI context, harness, lineage, audit, project gate,
  timestamps, tampering, and filesystem links together.
- Inference changes must retain project/realpath containment, model/input/output
  byte and iteration limits, isolated runtime identity, exact provider-profile
  event attribution, explicit fallback policy, immutable hashes and audit
  links, backward schema verification, and CLI/Lab/lineage/project-gate tests.
- Simulation and experiment launcher changes must retain strict same-origin and
  unknown-field rejection, typed/byte/matrix bounds, secret scanning, project
  realpath containment, sanitized public jobs, single-job serialization, exact
  cancellation bindings, partial-record verification, AI interaction
  separation, reload recovery, and responsive accessibility contracts.
- Figure-visual changes must preserve the matched semantic-parent prerequisite,
  exact parent/PNG/source/contract/replay binding, strict unknown-field and
  pairwise-palette rules, linear/log projection, alpha compositing, distinct
  position and nominal pixel-support checks, negative-result integrity,
  pixel/point/sample/file/registry bounds, audit-backed deletion discovery,
  realpath/link containment, and CLI/Lab/AI/harness/lineage/project-gate
  coverage. Tests must include misleading self-consistent sidecars, missing and
  undersized strokes/markers, unexpected colors, background drift, log scales,
  profile/parent/report/audit tampering, malformed records, limits, and legacy
  projects. Do not label this narrow user-profile conformance check as OCR,
  prospective independence, general renderer certification, or science proof.

## Version synchronization

The release number appears in `package.json`, `package-lock.json`,
`lib/constants.js`, and the Lab badge. The pinned engine version appears in
`package.json` and `lib/doctor.js`. Update each synchronized set together and
rerun the real-engine compatibility tests.

## Release checklist

1. `npm ci` from a clean checkout.
2. `npm run check` on all three operating-system families.
3. `npm run pack:check` and inspect the package file list.
4. Install the tarball in an empty directory.
5. Confirm `sciencecode paths` points only to the package-local engine and the
   ScienceCode app-data root.
6. Run `sciencecode doctor`.
7. Complete a separately authenticated model-backed workbench turn and
   follow-up; confirm both use the same engine session.
8. On a CUDA-capable release machine, run `sciencecode compute status`, then
   launch one recorded simulation and a multi-branch experiment from their Lab
   workspaces. Reload during one job, stop another, and verify the completed and
   partial records, UI status, interactions, and project gate.
9. Author and freeze a real structured preregistration in the Lab without a
   chat, inspect its exact immutable Markdown, freeze an analysis contract, run
   its exact script as a contract-bound multi-seed CUDA experiment, create the
   assessment, then select a chat and share a focus. Ask the read-only reviewer
   to challenge it and verify registration, contract, experiment, assessment,
   lineage, and project gate.
10. Ingest and search a real PDF, use one result in a recorded chat turn, and
   verify its evidence record, retrieval replay, interaction, and transcript.
11. Start Python and, when available, R notebooks; run two state-dependent
    cells, inspect variables and a figure, interrupt a long cell, explicitly
    restore completed history, share a cell with a chat, and verify all cells
    and notebook context. Confirm Lab shutdown leaves no worker or lock.
12. Persist edited code, delimited data, and a workbook as artifact revisions;
    inspect prior-version links, accept one, reject another, verify both through
    CLI/API/lineage, and confirm the next AI context distinguishes their status.
13. Review an archived manuscript and one saved draft through Lab and CLI;
    inspect exact evidence spans, calculations, data/code/figure traces, AI
    handoff, lineage, independent critic output, and deterministic verification.
14. Open recorded SMILES and MOL/SDF, BED/GFF/VCF/FASTA, and manuscript
    artifacts. Exercise molecule/atom selection, 2D and 3D navigation, contig/
    region/type/feature navigation, base zoom, source editing, selectable diffs,
    AI handoff, exact revision saving, keyboard controls, and parser-limit
    messages without loading a remote asset.
15. Start `sciencecode lab` on loopback and verify conversation creation,
    async follow-up, visible safe activity, transcript/interaction links, state,
    evidence ingestion/search/page selection, figures, code/table editing, 3D
    rotation/zoom/selection, immutable revision history and decisions, lineage
    pan/zoom/filter/trace/AI handoff, aggregate downloads, CSP, cross-origin
    rejection, traversal rejection, and unrecorded-file rejection.
16. Import or create multi-file OpenSCAD and CadQuery environments, perform
    conflict-safe SCAD/Python edits, render with real OpenSCAD and isolated
    CadQuery, require reproducible verified STL/STEP, inspect and rotate the
    shaded mesh, run the
    geometry screen, execute a CAD-linked recorded model through Lab, cancel a
    bounded second model and verify its partial record, slice a safe preview
    with real PrusaSlicer, edit/save a G-code proposal, and verify every parent,
    artifact, interaction, lineage edge, and safety invariant.
17. Confirm strict NPU inference still records a profiled Vitis provider event.
    When the GPU is genuinely free, execute the small CAD-linked template with
    device cuda and verify that the recorded context selected CUDA. Do not
    terminate or displace an unrelated workload.
18. Verify the chat, runs, campaign, simulation, experiment, analysis contract
    and assessment, kernels, evidence, retrieval, reviews, artifact revisions, and
    `sciencecode lineage verify`, then run `sciencecode gate`.
19. Create a campaign from `templates/campaign.json`, exercise checkpoint
    approval, one real model-backed task, a branch pause/prune, a preliminary
    verdict made stale by later work, a fresh final assessment, Lab/harness
    selection, event-head verification, lineage, and the whole-project gate.
20. Capture a project baseline in the Reproducibility view, download and hash
    its exact JSON, add/modify/remove files, run relaxed and strict checks,
    cancel and retry a capture, reload during verification, verify the audit
    binding and whole-project gate, and inspect desktop/tablet/phone layouts,
    keyboard traversal, focus, live status, and disclosure behavior.
21. Run `sciencecode evaluate --json`; inspect all six category metrics, source
    bindings, repeat digests, failed cases, limitations, and fingerprint. Repeat
    after packaging and fail the release on any case, threshold, binding, or
    determinism failure.
22. With a genuinely independent benchmark operator, inspect a frozen held-out
    corpus while labels and baselines are unavailable, freeze the ScienceCode
    run before unsealing, then score after unsealing. Rehash every file,
    independently review expert/adjudication/blinding claims, reproduce Wilson
    intervals and paired case outcomes, and confirm raw inputs/local paths are
    absent from reports. Do not describe the bundled synthetic tests as an
    external accuracy result.
23. Freeze a schema-2 analysis contract with typed thresholds expressed in a
    different compatible unit, run a bound multi-seed experiment whose branches
    emit at least two compatible units, and verify the canonical experiment
    aggregate plus converted confirmatory observations. Exercise `sciencecode
    unit list|inspect|convert`; then prove unknown symbols, dimensional mismatch,
    bare numeric values, absolute/difference temperature confusion, malformed
    quantities, and unit-engine tampering fail closed. Re-verify a schema-1
    contract and assessment through engine 1.
24. Generate a semantic sidecar from an exact PNG, CSV/TSV table, and contract;
    archive all three, register their manifest-bound selectors, and replay every
    figure/source/contract/data check through CLI, Lab, interaction, harness,
    lineage, and the project gate. Exercise unit conversion, row dropping,
    x-ordering, even sampling, duplicate headers/x, malformed decimals, log
    domain failure, sidecar mismatch, stored-copy tampering, path/link bounds,
    and a valid negative registration. Confirm the UI states that sidecar
    agreement is not pixel or renderer proof.
25. Starting from that matched registration, freeze the renderer's real plot
    rectangle, linear/log domains, background/axis/series colors, line widths,
    marker radii, tolerances, and thresholds; record both a conforming plot and
    a self-consistent but visually misleading negative through CLI and Lab.
    Inspect position and pixel-support checks, unexpected/background evidence,
    parent/profile/replay hashes, AI context, harness, lineage, and gate state.
    Exercise post-hoc profile skepticism, missing/undersized marks, tampering,
    deletion, path/link/count/sample bounds, cross-origin rejection, keyboard
    traversal, accessibility state, and desktop/tablet/phone overflow. Confirm
    the UI never describes the result as OCR or scientific validation.
26. Update the changelog and document remaining release gates honestly.
