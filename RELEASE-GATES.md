# Release gates

ScienceCode 0.41 is a local preview. Passing the local test suite is necessary
but not sufficient for a commercial or regulated release.

The active development priority is the local scientific workbench and its
research capabilities. The deployment/enterprise gates later in this document
are preserved as future constraints, not current feature priorities.

## Preview build gates

All preview builds should satisfy:

1. The engine is an exact dependency and `sciencecode paths` shows no global
   OpenCode fallback.
2. Isolated-state tests prove existing OpenCode/XDG config is not loaded.
3. Unit, integration, security, CLI, and real-engine tests pass.
4. Windows, macOS, and Linux CI pass on supported Node versions.
5. `npm pack --dry-run` contains only intended runtime/product files.
6. `npm audit` reports no known production dependency vulnerability at build
   time.
7. A separately authenticated model-backed workbench conversation completes,
   a follow-up continues the same engine session, and its transcript, runs,
   audit, and project gate verify.
8. `sciencecode compute status` validates the isolated Python/CUDA and Windows
   ML/ONNX runtimes on each supported GPU and NPU class.
9. A real recorded GPU simulation, multi-branch experiment, strict NPU smoke,
   and user-model ONNX inference complete. Their provider/device evidence,
   outputs, parents/children, reviewers, audit, and project gates all verify.
10. Lab tests cover loopback binding, CSP/security headers, state/detail APIs,
    same-origin chat creation and continuation, cross-origin/media-type/body
    rejection, figure and aggregate serving, traversal, symlink containment,
    method rejection, and unrecorded-file rejection.
11. Transcript tests cover session continuation, message/run reciprocity,
    turn-hash chaining, generated-record links, tampering, and secret preflight.
12. Harness tests cover async polling, safe event projection, opt-in live
    response blocks, archive/activity separation, credential redaction, UTF-8
    and aggregate response limits, repeated-part replacement, truthful stage
    derivation, job bounds, failure and cancellation preservation, abort
    delivery, same-origin/chat-bound stop requests, AI-visible cancellation
    context, and no raw tool input/output disclosure in the visible activity
    record.
13. Interaction tests cover code/table/plot/figure/3D/design records, chain and
    audit links, secret and size rejection, tampering, transcript context
    cross-checks, superseding annotation clears, and proof that the next engine
    prompt receives saved user state.
14. Evidence tests cover real PDF and text extraction, project and realpath
    containment, manifest/artifact/page/span/audit tampering, deterministic
    ranking and historical replay, raw-query omission, CLI and Lab APIs,
    prompt data isolation, and evidence-selection context for the AI.
15. Kernel tests cover real Python namespace continuity, explicit verified
    restore, clean state, immutable cell chains, visible results, variables,
    dependencies, figures, chat context, CLI and Lab lifecycles, timeouts,
    interruption, error preservation, failed-cell gates, tampering, path/junction
    escape, origin rejection, optional-R absence, lock cleanup, and no orphaned
    worker or Lab process.
16. Lineage tests cover stable graph digests, all record and artifact node
    classes, directed cross-links, conversation scoping, upstream/downstream
    traversal, interaction-to-turn consumption, pending state, missing links,
    tampering, project-gate failure, CLI output, Lab API, UI module delivery,
    and bounded AI trace handoff.
17. Revision tests cover canonical simulation/experiment/evidence/kernel
    sources, exact text and binary replacement bytes, source and prior-version
    hashes, exclusive writes, secret/size/path/symlink/deletion/tamper failure,
    accept/reject chains and audit links, project-gate failure, CLI/API serving,
    AI-visible proposal/decision context, lineage nodes/edges, and bounded UI
    history controls.
18. Native-studio tests cover SMILES branches/rings/components/charges/
    aromatic bonds, MOL/SDF V2000 coordinates/properties, BED/GFF/VCF
    coordinate normalization, bedGraph signals, bounded FASTA retention,
    contig/feature limits, reversible chemical/genomic viewport transforms,
    exact and coarse manuscript diffs, local module/MIME delivery, AI-visible
    domain selections, source editing, and immutable revision controls.
19. Semantic-review tests cover original artifacts and immutable revisions,
    exact source lines/hashes, evidence IDs/spans/pages and ingested DOI
    metadata, missing/unresolved citations, literal numbers, negation signals,
    explicit arithmetic, data/code/figure links, external/untracked artifacts,
    fixed limits, secret/path/symlink/source forgery, deterministic replay,
    tampering/deletion, CLI and same-origin Lab APIs, Reviewer/manuscript UI,
    AI context, harness, current/historical reruns and supersession lineage,
    audit, and project-gate separation between scientific attention and
    integrity failure.
20. Confirmatory-analysis tests cover strict normalization, preregistration and
    exact-script binding, experiment plan/manifest digests, branch filters,
    missing-data rules, all supported aggregations and thresholds, primary vs
    secondary/exploratory control, prospective/deviated/unregistered status,
    disclosed deviations, whole-report replay, current/historical reruns,
    source drift, tampering/deletion, timestamp and path/junction rejection,
    CLI and same-origin Lab APIs, interactive UI contracts, AI context,
    harness, lineage, audit, and project-gate integrity/outcome separation.
21. Procedure Studio tests cover strict unknown-field and secret rejection,
    resource/reference/cycle checks, domain controls, hazard-control hierarchy,
    deterministic totals and whole-report replay, non-executable XDL/Opentrons
    mappings, immutable plan/assessment/decision creation, supersession and
    currentness, blocked approval, attestation and expiry rules, reviewer
    identity labeling, tamper/deletion/timestamp/path/junction failure, CLI and
    same-origin Lab APIs, interactive plan/step/gate/finding/adapter/decision
    UI, AI context, harness, lineage, audit, and project-gate behavior.
22. Browser QA exercises live response-block transitions, bounded-preview
    labeling, cancellation, scroll behavior, code editing, notebook execution/history/variable
    insertion/AI handoff, table and workbook editing, plot axis/
    pan/zoom/selection, figure annotation, semantic sidecar registration,
    decoded-pixel profile editing/result inspection, and binding-detail
    inspection, 3D rotate/zoom/select, design/outcome
    direction, chemical molecule/atom/2D/3D controls, genomic contig/region/
    track/feature/base controls, manuscript editing/diff selection, evidence
    ingestion/search/page selection, lineage pan/zoom/
    filtering/node selection/upstream/downstream/AI handoff, NPU inference
    launch/status/stop/result handoff, responsive layout, and keyboard
    accessibility.
23. Drug-discovery and procedure QA confirms context-of-use, model-credibility,
    safety, validation/dry-run, and named-human-approval gates remain visible.
24. Documentation states limitations and does not imply unsupported compliance,
    reviewer verification, facility safety, or laboratory hardware authority.
25. NPU tests distinguish device discovery, provider readiness, provider
    registration, and profiled provider execution; verify strict no-fallback
    behavior, immutable model/input/output/profile records, schema-v1 replay,
    large-file hashing, degraded-AppX device preservation, exact protected
    WindowsApps DLL allowlisting in both launch layers, and no provider
    acquisition outside explicit setup.
26. Async inference tests cover the shared sync/async immutable finalizer,
    same-origin and schema rejection, model/input realpath containment, one-job
    serialization, safe public payloads, bounded lifecycle events, linked AI
    interactions and lineage, AbortSignal delivery, verified partial
    cancellation, failed-outcome gates, and a real strict-NPU Lab smoke.
27. CAD tests cover strict engine/entry normalization, schema-v1 OpenSCAD
    compatibility, 256-file/512-part and byte ceilings, both starters and
    manifest import, nested static OpenSCAD references, binary CAD assets,
    traversal/absolute/dynamic/undeclared/link/secret rejection, conflict-safe
    empty SCAD/Python edits, immutable revisions, source snapshots, descriptor/
    record/audit tampering, incomplete directories, CLI output, and gates.
28. Build/mesh/model tests cover bounded ASCII STL topology, duplicate/
    degenerate/watertight indicators, dimensions/area/volume/centroid/overhang,
    immutable OpenSCAD and CadQuery builds, isolated-runtime definition
    freshness, adapter result types, explicit tessellation, verified STEP,
    post-execution source-mutation failure, deterministic geometry screens,
    verified CAD parents for CPU/GPU scripts, environment/input linkage,
    modeled_by lineage, parent tampering, templates, and real engine smokes.
29. Slicer tests cover both engines' common verified STL, safe preview
    arguments, relative/absolute coordinates and extrusion modes, heater/
    homing/leveling/spindle/fan indicators, output limits, profile containment,
    explicit physical-risk acknowledgement, post-process rejection, isolated
    slicer state, immutable artifacts, no printer transport, and a real
    PrusaSlicer preview whose no-extrusion invariants pass.
30. CAD Lab QA covers OpenSCAD/CadQuery creation and selection, multi-file
    SCAD/Python editing, binary-file read-only state, stale-write recovery,
    AI-visible edits and mesh gestures, responsive worker-backed job progress,
    shaded STL rotate/zoom/select, verified STL/STEP download and rehash,
    reports/histories, editable/versioned G-code, linked model display, harness/
    lineage/state counts, same-origin/traversal rejection, and clean shutdown.
    Live visual browser QA remains separate from HTTP/source-contract checks.
31. CAD-linked model QA covers the strict project-relative launch schema,
    safe parameter names and byte/count bounds, exact immutable mesh binding
    independent of source engine, shared sync/async finalization, completed/
    failed/cancelled runs and partial artifacts, project/build/chat cancellation
    binding, failed-outcome gates, AI-visible lifecycle, modeled_by lineage,
    fresh free-VRAM refusal, a real CPU Lab-path smoke, and clean shutdown.
32. The real CadQuery gate creates a many-file assembly, builds it twice,
    requires byte-identical STL and STEP plus unchanged source snapshots, runs
    a second declared environment that imports the exact STEP hash and verifies
    a parametric geometric transform without source mutation, then runs
    geometry and PrusaSlicer checks, launches a worker-backed Lab build on an
    ephemeral loopback port, downloads and rehashes both artifacts, verifies
    engine-aware state and the whole-project gate, and closes the server.
33. Campaign QA covers strict schema-v2 tree, relation, DAG, policy, secret,
    and unknown-field validation; schema-v1 replay; immutable plan/event/head/
    audit verification; one-task dispatch; retries and cancellation; global
    and per-branch CPU/GPU/NPU/attempt/wall-clock gates; shared, paused,
    promoted, and pruned branch state; completed-task assessment links;
    supersession and post-work stale-verdict replay; disabled automatic
    pruning; canonical Scientist assessment-command denial; CLI and same-origin
    Lab APIs; responsive tree/task/ledger/assessment UI; main harness next
    action; AI interaction context; lineage relations; project counts/gate;
    malformed-event and tamper failure; and a separately authorized real-model
    smoke that leaves no Lab or engine process.
34. Native CAD surface-thermal QA covers fixed-destination exact-template
    installation and reuse without overwrite; strict same-origin request and
    parameter schemas; verified immutable STL binding; bounded ASCII-STL
    vertices, triangles, edges, and connected components; separated face-band
    boundaries; explicit graph-diffusion stability refusal; finite, pinned, and
    maximum-principle checks; deterministic CPU outputs; exact summary, history,
    and temperature-PLY manifests; scalar-property parsing and legend display;
    rotatable point selection; AI-visible range/value context; harness, audit,
    lineage, and gate integration; CPU/CUDA dispatch guards; a real Lab-path
    smoke on available hardware; explicit surface-model/non-FEA labeling; and
    clean server/process shutdown.
35. Comparative CAD-study QA covers strict fixed/variation/seed schemas; the
    shared 64-branch Cartesian bound; one verified immutable build in plan,
    manifest, audit, every child, and direct lineage; nested thermal-statistic
    extraction; deterministic CSV/reviewer replay; same-origin asynchronous
    Lab jobs; exact operation/project/build/chat-bound cancellation; active
    branch process termination; completed/cancelled/`not_run` partial ledgers;
    artifact, review, manifest, audit, and verification replay; responsive
    state reads and reload recovery during a blocked branch; the 24-hour
    whole-matrix and per-branch bounds; current free-VRAM
    refusal; separate accessible model/study stop controls; interactive
    branch-field opening;
    bounded next-turn AI context; harness/state counts; parent tampering;
    a real three-branch CPU Lab smoke; NPU/CAD runtime reporting without false
    execution claims; whole-project verification; and clean server shutdown.
36. Figure-rerun QA covers canonical manifest-bound simulation, experiment,
    CAD, kernel, and immutable-revision PNG selectors; distinct-source refusal;
    PNG signature/chunk/order/CRC/palette/transparency/filter decoding and all
    fixed byte/chunk/dimension/pixel/decompression bounds; exact, tolerated,
    different, and incompatible-dimension outcomes; deterministic metric and
    difference-pixel replay; copied-source/report/manifest/audit tampering;
    same-origin/body/path/artifact API enforcement; CLI lifecycle; interactive
    baseline/candidate/blend/difference/region controls; bounded next-turn AI
    context; harness/state/lineage/project-gate integration; a real recorded
    simulation-figure smoke; and clean Lab/process shutdown.
37. Structural figure QA covers schema-v1 pixel-only replay; linear-light
    white-matte compositing; fixed 8x8 block boundaries including partial edge
    blocks; exact, structural-only failure, relaxed, disabled, and invalid
    thresholds; mean/minimum/worst-block and luminance-error replay; combined
    pixel-and-structural acceptance; audit/settings/report tampering; CLI and
    same-origin Lab input; interactive score/rule/provenance display; bounded
    AI context; state/harness/lineage/project-gate counts; and explicit refusal
    to describe the score as registration, semantic equivalence, or scientific
    validation.
38. Lab-state responsiveness QA covers bounded concurrent digest preload,
    bounded LRU reuse, duplicate audit parse/verification reuse, append
    invalidation, same-size tampering with restored modification time, cold and
    unchanged HTTP measurements on an artifact-rich local project, explicit
    fresh-versus-reused API/UI status, accepted-mutation invalidation, moving
    snapshot confirmation/retry, and whole-state cache refusal when a watched
    root contains a filesystem link. Under concurrent CAD, evaluation, and Lab
    load, a meaningful POST after synchronous verification must also survive the
    finite 65-second keep-alive policy; the 70-second header deadline must remain
    longer. Windows NPU QA must also prove structured
    native device/driver discovery, targeted package inventory, degraded
    inventory preservation, and explicit forced refresh. Documentation must
    retain the privileged-metadata-forgery trust boundary.
39. Lab-shell QA covers explicit initial busy/error state, disabled actions
    before usable state, atomic chat-selection rollback, fresh/reused/stale/
    failed integrity labels that survive chat loading and narrow layouts,
    compact schema-identical JSON, skip and destination focus, workspace
    `aria-current`, harness tab/tabpanel selection and arrow/Home/End keyboard
    behavior, reduced-motion scrolling, and one-row access to every mobile
    workspace view. HTTP/source contracts must be supplemented by live browser
    screenshots, accessibility-tree inspection, keyboard traversal, and
    horizontal/vertical overflow checks at desktop, tablet, and phone widths.
40. Boundary-error QA keeps CLI exit and Lab HTTP classification in one shared
    module; preserves explicit HTTP statuses, payload/conflict/runtime/secret/
    executable outcomes, and fail-closed unknowns; and exercises malformed
    versus well-formed absent identifiers through real campaign, figure
    comparison, semantic figure registration, decoded-pixel figure validation,
    review, inference, simulation, experiment, preregistration, and run command
    dispatch plus the corresponding Lab detail routes.
41. Standalone-compute QA covers strict same-origin simulation and experiment
    creation; unknown fields, typed and byte bounds, the 64-branch ceiling,
    secret refusal, project realpath/junction containment, one shared active-job
    slot, sanitized public requests, bounded events, exact kind/chat cancellation
    bindings, async branch callbacks, immutable partial records with explicit
    unrun branches, verification, AI interactions, project counts/gates, reload
    recovery, accessible busy/live/form semantics, and one-column phone layout.
    Source and loopback contracts must be supplemented by live browser
    screenshots, accessibility-tree inspection, keyboard traversal, and
    completion/cancellation/reload exercises on a release machine.
42. Native-preregistration QA covers the exact nine-section schema, Markdown
    fence handling, placeholders, duplicates, empty/missing sections, UTF-8
    byte and secret ceilings before state, schema-v2 whole-content replay,
    schema-v1 source-drift compatibility, exclusive immutable records, audit
    binding, list/detail/exact-source APIs, no-chat downstream contract binding,
    optional AI context, lineage artifacts, tamper refusal, malformed/absent
    IDs, and metadata/registry/record/source/artifact link containment. Source
    and loopback contracts must be supplemented by live browser screenshots,
    accessibility-tree inspection, keyboard traversal, screen-reader status
    announcements, and desktop/tablet/phone overflow checks on a release
    machine.
43. Verification Center QA proves the Lab invokes the authoritative
    `verifyProject` implementation in a cancellable child process; remains
    responsive while a gate is active; allows only the eight canonical boolean
    outcome-policy fields; never waives integrity; preserves accepted-failure
    counts; classifies real tampered-audit findings as integrity blockers;
    redacts secrets; bounds findings, per-finding bytes, worker output, time,
    jobs, and events; fingerprints reports deterministically; keeps state
    compact; rejects cross-origin, wrong-media, unknown, non-boolean, concurrent,
    and mismatched-cancellation requests; recovers after cancellation; and
    cleans up on shutdown. Source and loopback contracts must be supplemented
    by live desktop/tablet/phone screenshots, keyboard traversal, disclosure
    interaction, focus/status accessibility-tree inspection, strict/relaxed
    policy runs, cancellation, and reload recovery on a release machine.
44. Reproducibility QA proves Lab capture and comparison reuse the authoritative
    snapshot primitives in one cancellable child process; preserve legacy CLI
    manifests; enforce the 100,000-entry, 16-GiB declared-byte, 32-MiB manifest,
    five-minute, 4-MiB worker-output, 128-finding, 12-KiB-detail, 256-list, job,
    and event bounds; independently rehash and exclusively commit a job-bound
    pending manifest before audit binding; remove only uncommitted pending work
    on cancellation; and never roll back a committed baseline after a later
    audit failure. Tests cover safe registry/download containment, traversal,
    links, malformed schema/metadata/digests, missing/ambiguous bindings,
    manifest and audit tamper, secret redaction, deterministic fingerprints,
    compact state, exact kind/ID/operation cancellation, single-flight,
    responsiveness, retry, strict versus addition-tolerant drift, whole-project
    integrity-only coverage, exact JSON download, and clean shutdown. Source
    and loopback contracts must be supplemented by live desktop/tablet/phone
    screenshots, accessibility-tree inspection, keyboard traversal, exact
    download rehash, capture/verify cancellation and retry, reload recovery,
     disclosure interaction, focus/live-status checks, and horizontal/vertical
     overflow QA on a release machine.
45. Bundled-agent compatibility QA treats agent, command, and skill text as
    executable product contracts. Every CAD-facing surface must match the
    runtime study-cancellation lifecycle: only the active branch is interrupted,
    completed and interrupted artifacts are retained, undispatched branches are
    `not_run`, partial experiments are finalized and verified, and partial
    aggregates are never presented as completed comparisons. Superseded
    non-cancellable guidance must fail the compatibility gate.
46. Product-evaluation QA runs the versioned core suite twice through the public
    CLI and `npm run check`. It covers labeled reviewer precision/recall,
    record/page/span/DOI citation behavior and adversarial locator/alignment/
    number/negation cases, bounded arithmetic and explicit directives, exact
    rerun digests, scientific-safety policy text, and primary/reviewer/authoring
    role separation. All six declared thresholds remain 1.0. Tests must prove
    deterministic cross-run fingerprints, normalized contained regular UTF-8
    source bindings, fixed source size limits, no temporary identifiers or paths
    in the report, nonzero CLI failure, and policy-drift detection. Release notes
    must state that bounded fixture metrics do not establish external accuracy,
    entailment, domain validity, model obedience, or runtime containment.
47. Governed external-benchmark QA keeps `inspect`, `predict`, and `score`
    distinct. Inspection and production-reviewer prediction must succeed with
    label and baseline files physically absent; prediction must be limited to
    the declared corpus-freeze/label-unseal window and exclusively create a
    contained run. Scoring must validate candidate and hash-bound baseline runs
    before refusing sealed labels, then require post-unseal exact two-class
    expert-label coverage. Tests cover strict unknown fields, 1 MiB manifest,
    64 MiB/50,000-case, 32 MiB label/run, 64 KiB text, and eight-baseline
    ceilings; invalid UTF-8; moving/missing/linked/outside files; count/hash/
    canonical-digest mismatch; duplicate/missing/extra cases; undeclared labels;
    late runs; baseline identity; abstentions; output traversal/overwrite;
    CLI failures; deterministic fingerprints; raw-text/absolute-path omission;
    confusion, stratum, prospective-threshold, 95% Wilson, and paired-baseline
    replay. Documentation must state that governance and timing are
    self-attested, intervals are conditional on the fixed corpus, no real
    independent corpus ships with the product, and external scores cannot waive
    the built-in release evaluation.
48. Typed-unit QA keeps analysis-contract schema 1 and confirmatory engine 1
    replayable while making schema 2 explicit. Tests cover strict `{symbol}`
    declarations and `{value, unit}` quantities, threshold normalization,
    compatible cross-unit branch aggregation, raw-to-converted observations,
    compound dimensions, percent/concentration scaling, affine Celsius/Kelvin,
    absolute-versus-difference temperature separation, aliases, case sensitivity,
    unknown/extra fields, implicit multiplication, factor/exponent/length limits,
    non-finite values, overflow, bare numeric typed results, incompatible branch
    dimensions, engine provenance, manifest tampering, CLI help/options/errors,
    Lab authoring/display, exact assessment replay, and whole-project integrity.
    Documentation must say that dimensional consistency does not prove what code
    measured, physical plausibility, statistical validity, causal meaning, or
    regulatory fitness.
49. Semantic-figure QA binds an exact supported PNG, strict UTF-8 CSV/TSV, and
    producer JSON sidecar through verified immutable selectors. Tests cover
    schema/unknown-field rejection; 8-MiB/100,000-row/128-column/16-series and
    report/sidecar/record ceilings; RFC-style quoted fields; normalized unique
    headers and exact row width; missing columns/rows; strict finite decimals;
    registered source/display units and conversions; linear/log domains;
    duplicate-x and source/x-ascending policies; all/even sampling; canonical
    source-row/converted-value digests; figure/source/contract/replay mismatch;
    valid negative records; malformed JSON; source, copy, manifest, audit, and
    engine tampering; deletion/link/path escapes; CLI sidecar/register/list/
    show/verify; same-origin Lab APIs and artifact serving; interaction context;
    state, harness, lineage, and project-gate counts; accessible responsive Lab
    controls; and legacy projects with no registration directory. Release text
    must state that a self-consistent producer sidecar does not prove that PNG
    pixels render the declared axes, labels, marks, values, or scientific
    meaning. Live browser screenshots, accessibility-tree inspection, keyboard
    traversal, and desktop/tablet/phone overflow checks remain a release-machine
    gate.
50. Decoded-pixel figure QA starts only from an integrity-valid matched semantic
    registration and binds its manifest/report/PNG/source/contract/replay
    digests. Tests cover strict schema/unknown/secret rejection; plot/domain/
    style/series-order/palette/threshold normalization; linear and log
    projection after registered conversion; alpha compositing; bottom/left axis
    position and nominal pixel support; line path/footprint and marker center/
    filled-footprint support; unexpected same-series pixels; background
    conformance; missing, shifted, undersized, extra, misleading, conforming,
    and valid-negative images; four-million-pixel, 4,096-point, one-million-
    sample, 64-KiB profile, 72-KiB spec, record/file, and 10,000-entry bounds;
    malformed records; parent/profile/report/manifest/audit tampering and
    deletion; metadata/registry/record/artifact link and path escapes; CLI
    register/list/show/verify; same-origin Lab create/list/detail/artifact
    routes; editable accessible profile/result UI; bounded AI handoff; state,
    harness, lineage parent/report edges, and project-gate counts; and legacy
    projects with no visual registry. Release text must state that geometry,
    domains, colors, sizes, tolerances, and thresholds are user-supplied and can
    be tuned post hoc; a pass is neither OCR, prospective independence, general
    renderer certification, nor scientific validity. Live browser screenshots,
    accessibility-tree inspection, keyboard traversal, and desktop/tablet/phone
    overflow checks remain a release-machine gate.

## Deferred deployment and commercial GA gates

1. **Compatibility** — supported engine/provider/model matrix, upgrade policy,
   and real end-to-end fixtures.
2. **Supply chain** — reproducible packages, SBOM, SCA/SAST/secret scanning,
   signed artifacts, provenance attestations, and release-key operations.
3. **Security** — completed threat model, sandbox/containment design,
   independent penetration test, and vulnerability-response SLA.
4. **Identity** — SSO/OIDC/SAML, RBAC, service accounts, least privilege, and
   managed policy enforcement.
5. **Data** — encryption/KMS, retention, residency, legal hold/export,
   backup/restore, and deletion policy.
6. **Tenancy** — isolation tests for storage, compute, logs, tools, caches, and
   provider credentials.
7. **Reliability** — health/readiness, timeouts, retries, cancellation,
   idempotency, load/failure testing, SLOs, alerts, and capacity plans.
8. **Audit** — externally anchored immutable export and administrator-visible
   identity, policy, and action records.
9. **Science QA** — citation validation, deterministic retrieval where
   possible, calculation/unit checks, reproducibility fixtures, benchmark
   suite, and regression thresholds.
10. **Operations/legal** — reversible migrations, upgrade/rollback playbooks,
    incident response, privacy/security documentation, customer contracts, and
    an explicit certification-claims review.
