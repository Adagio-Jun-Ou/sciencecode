# ScienceCode architecture

ScienceCode is a standalone scientific workbench. It embeds a pinned OpenCode
distribution as its agent engine, but owns the product behavior, command line,
state boundary, scientific protocols, and provenance formats.

It is neither a configuration layer over the user's existing OpenCode nor a
source fork of OpenCode. A future fork remains possible if engine APIs cannot
support required scientific behavior, but the current design keeps upstream
engine upgrades replaceable and explicitly tested.

## Runtime boundary

```text
sciencecode CLI
    |
    +-- package-local opencode-ai binary (exact pinned version)
    |
    +-- bundled agents / commands / skills
    |
    +-- SCIENCECODE_HOME
            |
            +-- isolated config
            +-- isolated provider auth
            +-- isolated sessions/data
            +-- isolated cache/state
```

`lib/runtime.js` resolves the engine from the ScienceCode dependency tree.
There is deliberately no `PATH` fallback. Before each engine launch it replaces
inherited `OPENCODE_CONFIG*` and `XDG_*` values, points them into
`SCIENCECODE_HOME`, applies a final ScienceCode config overlay, and disables
global Claude-compatible prompt/skill discovery.

Project files and OS-level provider environment variables remain visible
because scientific computation and provider access require them. Existing
OpenCode config files, auth files, sessions, plugins, and cache are outside the
ScienceCode runtime boundary.

## User-facing error boundary

`lib/error-semantics.js` is the single translation layer between domain error
codes and user-facing CLI or HTTP outcomes. Domain modules keep stable codes
and optional explicit HTTP statuses; `lib/cli.js` and `lib/lab.js` do not keep
separate copies of that taxonomy.

For HTTP, explicit integer statuses take precedence. Otherwise invalid input is
400, missing records are 404, oversized payloads are 413, state conflicts are
409, unavailable local runtimes are 503, and an unclassified failure remains
500. For the CLI, input that the user can correct is status 2, ordinary missing
records and operational failures are status 1, secret refusal is status 3, and
a missing executable is status 127. Unknown codes deliberately retain the
generic server/operational failure instead of being inferred from their names.

## Scientific compute and Lab boundary

```text
sciencecode CLI
    |
    +-- isolated compute runtimes under SCIENCECODE_HOME
    |       +-- Python/scientific packages and CUDA-enabled PyTorch for GPU work
    |       +-- Windows ML/ONNX Runtime and Vitis AI for bounded NPU inference
    |       +-- definition-hashed CadQuery runtime and export adapter
    |       +-- independent manifests, requirements, and health probes
    |
    +-- recorded simulation
    |       +-- source, inputs, parameters, seed, GPU metadata
    |       +-- figures, arrays, summaries, hashes, audit links
    |
    +-- multi-file parametric CAD
    |       +-- normalized engine-neutral descriptor, declared sources/assets, parts, transforms
    |       +-- conflict-safe source edits and immutable before/after revisions
    |       +-- OpenSCAD or CadQuery source snapshots, verified STL/STEP, mesh analysis
    |       +-- geometry/printability screens and verified CPU/GPU model parents
    |       +-- bounded PrusaSlicer records; transmission and post-process disabled
    |
    +-- recorded ONNX inference
    |       +-- exact model/input, NPY outputs, JSON preview, and latency
    |       +-- runtime, driver, profile, fallback, hashes, and audit links
    |       +-- profiled provider-event evidence for strict NPU claims
    |
    +-- recorded experiment
    |       +-- immutable hypothesis and Cartesian branch plan
    |       +-- independently verifiable simulation children
    |       +-- aggregate CSV and deterministic reviewer checks
    |       +-- optional verified CAD parent shared by every branch
    |
    +-- prospective analysis contract and assessment
    |       +-- frozen preregistration, exact script, outcomes, and thresholds
    |       +-- digest-bound experiment plan and manifest
    |       +-- deterministic branch replay and explicit registration status
    |
    +-- Procedure Studio records
    |       +-- immutable neutral plans and explicit supersession
    |       +-- deterministic non-executing logical dry-run assessments
    |       +-- non-executable XDL/Opentrons mapping previews
    |       +-- scoped expiring local human decisions; hardware always disabled
    |
    +-- persistent project kernels
    |       +-- one private Python/R child process per live language
    |       +-- append-only source, streams, result, variables, figures
    |       +-- explicit verified restore or clean restart
    |
    +-- recorded conversation
    |       +-- persistent isolated OpenCode session
    |       +-- immutable prompt/response turn records
    |       +-- run, audit, simulation, experiment, and inference cross-links
    |       +-- hash-chained user workspace interactions
    |       +-- deterministic, cited evidence retrieval context
    |       +-- verified chat-linked notebook context
    |
    +-- immutable evidence library
    |       +-- manifest-bound PDF/text source and bibliographic metadata
    |       +-- page JSONL, overlapping span JSONL, and SHA-256 digests
    |       +-- versioned BM25 settings and immutable retrieval records
    |
    +-- derived scientific lineage
    |       +-- evidence/span -> retrieval -> turn grounding
    |       +-- cell/interaction -> turn context and revision links
    |       +-- experiment -> branch -> artifact production links
    |       +-- deterministic digest and integrity/review findings
    |
    +-- immutable artifact revisions
    |       +-- verified source artifact and optional prior-version hashes
    |       +-- exact bounded replacement bytes and immutable manifest
    |       +-- append-only accept/reject decision chain and audit links
    |
    +-- immutable figure comparisons
    |       +-- two distinct verified PNG artifacts or revisions
    |       +-- bounded canonical RGBA decode and frozen tolerance rule
    |       +-- exact copies, deterministic metrics, and pixel-difference image
    |       +-- audit, AI interaction, harness, lineage, and project-gate links
    |
    +-- immutable semantic figure registrations
    |       +-- exact verified PNG, UTF-8 CSV/TSV, and producer sidecar inputs
    |       +-- strict column/axis/series/unit/scale/row/sampling contract
    |       +-- independent converted plotted-data replay and digest comparison
    |       +-- negative-result preservation, audit, AI, lineage, and gate links
    |
    +-- immutable decoded-pixel figure validations
    |       +-- exact matched semantic-registration parent and normalized profile
    |       +-- bounded PNG decode, data projection, and flat-color masks
    |       +-- axis/mark coverage and support, unexpected-pixel/background rules
    |       +-- deterministic negative results, audit, AI, lineage, and gate links
    |
    +-- immutable semantic consistency reviews
    |       +-- verified manuscript artifact or exact saved revision target
    |       +-- bounded claims, citations, calculations, and artifact traces
    |       +-- deterministic report/manifest hashes and audit link
    |       +-- independent read-only AI critic handoff
    |
    +-- loopback-only Research Workbench
            +-- same-origin chat, evidence, analysis, procedure, inference, interaction, kernel, revision, figure-comparison, figure-registration, figure-visual, review, lineage, and project-gate routes
            +-- asynchronous cancellable chat/inference/compute/gate jobs, safe metadata, and bounded live response blocks or gate findings
            +-- evidence-derived activity, design, and outcome boards
            +-- editable and versioned code/CSV/XLSX, interactive plots, figure review, baseline/rerun comparison, semantic sidecar registration, and decoded-pixel mark/axis validation
            +-- 2D chemical depictions plus rotatable molecular/mesh coordinates
            +-- multi-file SCAD/Python editor plus shaded rotatable CAD meshes and G-code studio
            +-- responsive engine/build/STEP/screen/model/study/slice provenance and AI handoff
            +-- genomic track navigation and feature/base selection
            +-- split manuscript editing with selectable bounded line diffs
            +-- editable confirmatory contract and branch-level outcome replay
            +-- editable procedure plans, step/gate inspectors, dry-runs, and human-decision forms
            +-- pannable/zoomable upstream/downstream lineage workspace
            +-- interactive inference outputs plus verified state and aggregate comparison APIs
            +-- manifest-bound artifact, evidence, and transcript serving
```

The GPU and NPU Python runtimes are isolated from system Python, from one
another, and from OpenCode state. ScienceCode removes inherited virtual-
environment variables before compute launch. Simulations select CPU/CUDA
inside the deterministic launcher. ONNX inference uses the NPU runtime and an
explicit `npu`, `cpu`, or `auto` provider-selection policy. Device discovery or
provider registration alone never becomes an NPU execution claim; a strict
claim requires at least one Vitis provider event in the archived ONNX Runtime
profile.
Hardware discovery remains independent from AppX package inventory. A failed
AppX query is retained as diagnostics without hiding a ready ComputeAccelerator.
When the Windows ML catalog is degraded, the isolated runtime can reuse only a
previously recorded Vitis library path that passes matching Node and Python
guards for the protected Microsoft AMD WindowsApps package and fixed DLL name.
It does not call `EnsureReadyAsync` or download a provider on this path, and
profiled execution remains the sole basis for an NPU claim.

Lab state assembly has a separate performance boundary from record authority.
Before a cold default-provider state build, the server walks regular files under
`.sciencecode` and `cad` and preloads SHA-256 digests with bounded parallel I/O.
The normal synchronous verifiers remain authoritative: every cached digest is
accepted only after device, inode, mode, size, nanosecond modification time, and
change time match, and a file that changes during preload is not cached. Audit
lines, parsed records, and chain results use the same scoped identity checks.

After a complete state verifies, an in-memory snapshot may be reused only when
a new deterministic metadata walk matches the prior fingerprint and no accepted
same-origin mutation invalidated it. The server confirms the fingerprint after
building, retries once if the project changed mid-build, bounds all retained
entries, and disables whole-state reuse when a watched root contains a
filesystem link. The response discloses whether the state was rebuilt or reused
and when it was verified. This detects ordinary local edits, replacement, audit
append/tamper, and same-size edits whose modification time is restored because
change time and file identity also participate. It is not a defense against a
privileged actor capable of modifying content while forging every filesystem
identity field; that actor is inside the documented local trust boundary.

The loopback HTTP server keeps an otherwise reusable Lab connection alive for
65 seconds, with a slightly longer finite 70-second header deadline. This
prevents Node's five-second default from closing a browser socket just as a
meaningful POST follows a long synchronous local verification pass, while
retaining bounded idle and incomplete-header lifetimes.

The Lab shell treats verified state as an interaction prerequisite. During
initial state assembly and conversation selection, the main region reports
busy state and state-dependent controls remain disabled. A failed initial load
does not become an apparently ready empty conversation; a failed later chat
selection restores the prior selected chat and harness, or falls back to a
coherent new-conversation state. Fresh, reused, stale, and failed state labels
survive subsequent chat requests and remain visible at narrow widths. Hidden
workspace transitions move focus to the destination heading or record detail,
and the harness uses an explicit keyboard tab model. JSON response formatting
is compact on the wire, but record content, verification, and API schema are
unchanged.

Windows NPU discovery uses structured `pnputil` XML, a narrow device-service
registry read, and an exact-name Windows ML AppX query. Ordinary Lab requests
reuse hardware status for five minutes, while explicit Refresh forces a probe.
Hardware inventory remains distinct from the archived provider profile required
for an NPU execution claim.

## Lab project-gate lifecycle

1. `POST /api/project-gates` accepts only the eight canonical boolean
   failed-outcome policy fields after the normal loopback, same-origin, JSON,
   and body-size checks. Integrity has no override.
2. The Lab permits one active gate, creates a process-local cancellable job,
   and passes a small base64url JSON request as a literal argument to the
   package-local `lib/project-gate-worker.js` entry point. No shell interprets
   the request.
3. The worker runs `verifyProject` synchronously in its own process. This keeps
   the server event loop responsive while reusing the exact CLI authority
   instead of introducing a second verifier or weaker browser-only audit.
4. `lib/project-gate.js` projects the result into a deterministic redacted
   report: integrity and failed-outcome blocker counts, accepted-failure count,
   audit and lineage anchors, numeric record counts, at most 128 findings, and
   at most 12 KiB per diagnostic body. Omission and truncation are explicit;
   a SHA-256 fingerprint excludes wall-clock generation time.
5. `/api/state` contains only the latest job status and compact report summary.
   `/api/jobs/:id` holds the complete bounded report for the lifetime of the
   Lab process. Neither object is scientific evidence and neither writes an
   audit event or changes the records being checked.
6. Cancellation must bind to that exact gate job and aborts only the owned
   child process. Worker runtime/output, retained jobs, and events are bounded;
   server shutdown aborts active verification.

## Managed project-snapshot lifecycle

1. `POST /api/project-snapshots` accepts an empty JSON object after the normal
   loopback and same-origin checks. The Lab generates the identifier; callers
   cannot select a destination path or overwrite an existing manifest.
2. One snapshot operation may run per Lab process. The package-local
   `lib/project-snapshot-worker.js` receives a small literal base64url request
   and performs synchronous project walking and hashing outside the server
   event loop. Capture is bounded to 100,000 entries, 16 GiB of declared bytes,
   a 32 MiB manifest, five minutes, and 4 MiB of worker output.
3. Capture writes only `.pending-<snapshot-id>.json` in the checked snapshot
   store. It immediately compares that manifest with the current project under
   strict policy. The parent process rehashes the complete pending manifest,
   checks the worker binding, copies it to `<snapshot-id>.json` with exclusive
   creation, removes the pending file, and appends a `snapshot.created` audit
   event containing the exact manifest hash and counts. A cancelled or failed
   pre-commit job removes only its exact pending file.
4. `POST /api/project-snapshots/:id/verifications` reuses `verifySnapshot` in
   the same worker boundary. Strict mode reports later additions; relaxed mode
   ignores only additions. Both modes enforce captured paths, types, sizes,
   digests, manifest structure, safe registry containment, the unique audit
   binding, and the complete audit chain.
5. `lib/project-snapshots.js` projects record and workspace results into a
   deterministic, secret-redacted report with categorized integrity, added,
   modified, missing, and unreadable counts; at most 128 findings and 12 KiB
   per finding; digest anchors; and explicit omission/truncation. Generation
   time is excluded from the report fingerprint.
6. `GET /api/project-snapshots` reads only bounded registry summaries, and
   `/project-snapshot/:id` serves only a contained normal manifest as an exact
   attachment. `/api/state` exposes the registry count and compact latest job;
   complete findings remain only in the process-local job detail.
7. Whole-project verification checks snapshot manifest structure, digest, and
   audit binding as non-waivable integrity. It deliberately does not require a
   historical snapshot to equal the current evolving project. Workspace drift
   belongs to an explicit snapshot comparison, not record-integrity policy.

The Research Workbench is a local conversation, orchestration, and output
surface. Its mutation routes create conversations, execute recorded turns,
launch bounded recorded inference, ingest project-confined evidence, or append
user-authored workspace interactions. They require loopback Host values,
same-origin browser requests, JSON content types, bounded bodies, secret
preflight, serialized turns, and at most one accelerator inference per Lab
process. General project-file mutation remains inside the configured scientist
agent and its permission guardrails. Editing an output in the browser never
silently replaces its archived artifact.

Project kernels use project-owned child processes and a private stdin plus
project-confined file protocol; they do not open an unauthenticated Jupyter or
language-server socket. Python prefers the isolated ScienceCode compute runtime
and falls back to a discovered system Python when that runtime is absent. R is
optional and resolves `Rscript`. A live process owns one language namespace,
one busy flag, one monotonic execution counter, and one project lock. Timeouts
and interrupts terminate the worker and preserve the attempted cell as a
verified non-completed record. Process separation, the private protocol, and
output bounds are not an OS security sandbox.

## Layers

1. **Product CLI** — initialization, diagnostics, TUI/web/server launch,
   recorded runs, snapshots, preregistration, inspection, and CI gates.
2. **Engine adapter** — pinned engine resolution, isolated environment,
   cross-platform process launch, and JSON event normalization.
3. **Scientific behavior** — primary scientist plus literature, data-analysis,
   drug-discovery, procedure, safety, reproducibility, and skeptical agents.
4. **Protocols** — on-demand research, hypothesis-testing, literature,
   analysis, discovery, procedure, model-credibility, and reproducibility skills.
5. **Workflow commands** — `/research`, `/literature`, `/analyze`,
   `/reproduce`, and `/challenge`.
6. **Project provenance** — `.sciencecode` conversations, interaction chains,
   evidence/retrieval records, runs, snapshots, preregistrations, artifact
   revisions, semantic reviews, hashes, audit events, and a deterministic
   derived lineage graph.
7. **Visible harness** — research-goal classifier, stage/lane model, safe
   event projection, context-of-use and execution gates, and outcome boards.
8. **Foundational knowledge** — a load-verified layered principle graph
   (mathematics, physics, chemistry, biology, applied biomedicine) that grounds
   each workflow and reports the layers it crosses and its weakest claim.

## Recorded-run lifecycle

1. Validate project/config paths and secret-scan the request.
2. Resolve the package-local engine and construct its isolated environment.
3. Hash the research project before execution, excluding implementation and
   provenance metadata.
4. Create an exclusive run directory and append a `run.started` audit event.
5. Execute the engine with `--format json` by default.
6. Redact raw events and captured logs, then derive readable assistant output.
7. Hash the project again and classify added, modified, and missing files.
8. Hash every run artifact and the final manifest.
9. Append a `run.finished` audit event linked to the manifest digest.

The local audit chain detects accidental or unsophisticated modification and
uses a separate head record to detect truncation. It is not externally signed
or immune to an attacker who can rewrite all local provenance.

## Evidence lifecycle

1. Resolve a PDF, Markdown, reStructuredText, or text source through the
   project-root and realpath containment checks; reject unsupported or oversized
   inputs before creating a record.
2. Copy the source exclusively into a new `.sciencecode/evidence/<id>/`
   directory. PDF text extraction runs in a bounded package-local worker using
   exact-pinned `pdfjs-dist`; text files split at explicit form-feed pages.
3. Normalize page text, create bounded overlapping spans, hash every page,
   span, source, and JSONL artifact, then write a bibliographic manifest and
   independent manifest digest.
4. Append an `evidence.ingested` audit event. Verification rechecks containment,
   all file and record hashes, identities, counts, retrieval settings, and the
   audit link.
5. Search only verified records with versioned Unicode tokenization, stop words,
   and BM25 parameters. Store no raw query in an immutable retrieval record;
   retain its query digest, exact historical corpus manifest hashes, ranked
   page/span hashes, settings hash, result limit, and audit link.
6. Chat receives at most four matching spans as one-object-per-line JSON with
   source text confined to quoted fields and an explicit untrusted-data
   instruction. The archived turn retains the retrieval identity and citations.
7. Chat verification replays ranking from the original user message against
   the recorded historical corpus. New evidence can be added without changing
   an earlier turn, while modification of any cited source or span is detected.

## Project-kernel lifecycle

1. Validate language, source size, secrets, optional chat link, timeout, project
   containment, runtime availability, and the single-owner project lock before
   execution metadata is created.
2. Start one private Python or R worker. A new project starts with an empty
   namespace. Existing history requires an explicit `restore` or `fresh`
   choice; no restart silently re-executes code.
3. For restore, verify the kernel manifest, complete cell hash chain, source,
   outputs, result, artifacts, worker identity, and audit links. Refuse replay
   if any prior cell is failed, interrupted, timed out, or tampered. Re-execute
   completed sources in order and record the restored-through counter.
4. Execute a new source file in the live namespace with bounded streams,
   result representation, variables, dependencies, and figure capture. Disable
   interactive stdin. Snapshot project files before and after the cell.
5. Move the staging directory atomically into the next monotonic cell ID; write
   immutable source, stdout, stderr, result, rich artifacts, cell manifest,
   independent digest, previous-cell link, runtime/process identity, chat link,
   and matching audit event.
6. A normal Lab keeps the worker alive. CLI execution and server shutdown stop
   it and release the lock. Timeout or interrupt kills it and records the cell
   as non-completed; the default project gate then requires review.
7. Chat context includes only currently verified cells linked to that chat,
   bounded to recent records. The engine receives JSONL data and immutable
   identifiers, while transcript verification rebuilds and compares the exact
   context entry.

Replay reconstructs language state; it does not roll back or isolate external
side effects. Replaying a completed cell can repeat filesystem, network,
database, GPU, or subprocess actions and therefore remains an explicit user
decision.

## Recorded-conversation lifecycle

1. Create a conversation manifest with a fixed specialist agent and an audit
   anchor.
2. Secret-scan and bound each user message, then compose verified interaction
   summaries, chat-linked notebook state, and deterministic evidence retrieval
   before invoking the engine.
3. Start the first turn as a new isolated OpenCode session; continue later
   turns with that exact engine session ID.
4. Execute every message through the normal recorded-run lifecycle with chat
   ID and turn index embedded in the run manifest and audit events.
5. Preserve the user message, redacted assistant response, engine event
   summary, file changes, errors, and linked scientific records in an exclusive
   turn file.
6. Chain each turn to the prior turn hash, update the conversation head, and
   append a final audit event.
7. Verify the transcript digest, chain, message hashes, child runs, reciprocal
   run links, evidence replay, linked audit records, and current audit anchor.

Lab conversations use the same lifecycle asynchronously. A bounded in-memory
job record reports queued/running/completed/failed state. Engine stdout is still
archived in full after redaction, while the browser receives an allowlisted
event projection: tool name, display title, status, call identifier, and timing.
Tool inputs and outputs are intentionally absent from the live panel.

For the short-lived job response only, completed OpenCode JSON text parts are
opted into a separate response-block projection. Each part is redacted and
control-character cleaned again, capped at 8 KiB, and stripped from the
activity-event copy. The Lab replaces repeated part IDs, retains a rolling
maximum of 32 blocks and 48 KiB, and reports omitted counts and bytes. Polling
therefore shows real completed assistant blocks without claiming unavailable
token deltas. The final turn, run, transcript, snapshots, and audit records are
identical in shape to a synchronous CLI-backed turn and replace the ephemeral
preview at completion.

## User-interaction lifecycle

1. The browser loads only a manifest-bound output artifact or evidence source.
2. Code, notebook-source drafts, CSV/TSV tables, and ZIP/XML-based `.xlsx`
   worksheets are edited in memory. Table and workbook values feed a bounded
   local plot canvas with axis choice, pan, zoom, and source-row selection.
   Raster figures accept pan, anchored zoom, normalized annotations, revision
   notes, and explicit baseline/rerun selection. A verified PNG pair can open
   baseline, candidate, blend, and absolute-difference views with an exact
   source-pixel region selection. 3D output accepts rotation, zoom, and point selection.
   Chemical depictions accept molecule/atom selection and pan/zoom; genomic
   tracks accept contig/region/type/feature navigation; manuscript drafts
   produce selectable exact or explicitly coarse line diffs.
3. Downloading a draft is local browser behavior. Creating a figure comparison
   sends only immutable source selectors and bounded frozen settings. Sharing
   an edit, notebook result and direction, comparison view/region, evidence
   page, or source direction with the AI sends a same-origin JSON record capped
   at 48 KiB.
4. ScienceCode validates the chat, surface, action, artifact labels, payload
   size, and secret scan, then appends the record under
   `.sciencecode/interactions/<chat-id>.jsonl`. A log refuses new records after
   10,000 entries or 32 MiB instead of growing without bound.
5. Each record hashes its payload, links the previous record hash, and receives
   a matching audit event. Interaction and chat verification cross-check the
   chain and the audit link.
6. The next chat turn receives a clearly delimited summary plus the immutable
   record path. The archived user message remains the text the user typed, while
   the engine-prompt digest proves which interaction context was supplied.

This design lets the AI observe user state without pretending browser gestures
changed scientific evidence. Applying a draft to project source remains an
explicit agent action that can be reviewed, tested, and recorded normally.
Figure and plot reviews link to the producing simulation or experiment record;
clearing an annotation set appends a superseding empty-set record instead of
rewriting prior review history. Plot rendering is capped at 5,000 evenly sampled
points while retaining source-row identity and first/last coverage.
The `.xlsx` path is deliberately dependency-free, rejects encrypted, ZIP64,
oversized, unsafe-path, and unsupported-compression workbooks, and preserves
unchanged archive members while rebuilding edited sheet XML for download.

## Figure-comparison lifecycle

1. Resolve each selector through the same manifest, digest, audit, realpath,
   and artifact-hash verifier used by immutable revisions. Sources must be
   distinct canonical URLs and PNG artifacts; a revision selector resolves to
   its exact immutable replacement bytes.
2. Decode each source with the dependency-free PNG reader. The reader verifies
   signature, chunk type/order/CRC, compression, dimensions, decompressed byte
   count, palette/transparency structure, and row filters under fixed byte,
   chunk, dimension, and pixel caps. It accepts only non-interlaced 8-bit
   grayscale, indexed, RGB, grayscale-alpha, and RGBA input and emits canonical
   RGBA bytes.
3. Freeze the comparator version, integer per-channel tolerance, maximum
   changed-pixel fraction, optional minimum structural similarity, source
   URLs/hashes, dimensions, and rule digest. Compute exact/thresholded changed
   pixels, fractions, RGBA MAE/RMSE, per-channel mean/maximum deltas, overall
   maximum, and the changed bounding box. Version 2 also composites RGBA over
   a recorded white matte in linear-light sRGB, converts to Rec. 709 luminance,
   and computes a sample-weighted mean of fixed 8x8 SSIM blocks plus the
   minimum/worst block and luminance errors. When the optional floor is set,
   both pixel and structural rules must pass. Unequal dimensions produce a
   verified scientific failure rather than a resampled comparison.
4. Publish exact source copies, deterministic JSON report, and—when dimensions
   match—an opaque absolute-difference PNG through exclusive staging and atomic
   rename. Hash the manifest separately and append a source/report/manifest-
   linked audit event.
5. Verification re-resolves both original sources, rehashes every stored file,
   decodes and recomputes the versioned report, pixel-checks the difference
   image, checks pixel/structural audit fields, and fails closed on mutation.
   The legacy version-1 branch reproduces the original pixel-only report shape
   exactly. A `different` result remains integrity-valid and visible as
   scientific attention.
6. Lab/CLI/API, project gate, harness, and lineage consume that same record.
   Creating a chat-linked comparison appends a bounded interaction; saving an
   inspected view adds region, blend, difference gain, exact metrics, hashes,
   and the explicit mechanical/non-semantic limitation to the next AI turn.

## Semantic-figure registration lifecycle

1. A plotting process starts from a strict schema-1 contract: line, scatter,
   or line/scatter marks; one numeric x column; one through 16 numeric series;
   registered source/display units; shared y display unit; linear/log scales;
   explicit missing/duplicate/order policies; no aggregation; and all or
   deterministic evenly spaced sampling.
2. `sciencecode figure semantic sidecar` reads only regular project files,
   decodes the bounded PNG, strictly parses at most 8 MiB of UTF-8 CSV/TSV,
   resolves unique normalized headers, converts selected finite decimals with
   the versioned unit engine, applies row/order/sampling rules, and emits a
   canonical sidecar. The sidecar binds PNG digest/bytes/dimensions, table
   digest/bytes/format, normalized contract digest, converted series profiles,
   source-row digest, plotted-data digest, and the non-pixel-inference warning.
3. After the PNG, table, and sidecar enter an immutable producing record, a
   registration resolves all three through normal manifest, audit, digest,
   realpath, and record verification. The expected contract is supplied
   independently from the sidecar declaration.
4. ScienceCode reruns PNG validation, table parsing, column selection, unit
   conversion, log-domain checks, duplicate/missing policy, order, and
   sampling. Five explicit checks compare sidecar schema, figure binding,
   source binding, contract binding, and the complete deterministic replay.
   Mismatch is preserved as an integrity-valid negative scientific result.
5. Exclusive staging copies all three exact inputs plus the deterministic
   report, hashes the manifest, and appends a figure/source/sidecar/contract/
   replay/report/manifest-bound audit event. Verification re-resolves original
   inputs, rehashes copies, reruns the full engine, and checks the audit link.
6. CLI/API/Lab, interaction context, harness, lineage, state summaries, and
   the project gate consume the same verified record. None claims that PNG
   pixels visually implement the producer declaration; OCR, legend/axis
   extraction, renderer certification, and scientific validity remain outside
   the engine.

## Decoded-pixel figure-validation lifecycle

1. Accept only an integrity-valid semantic registration whose stored report is
   `pass`/`matched`. Bind its manifest, report, PNG, source-table, contract, and
   deterministic replay hashes rather than trusting a free-standing image or
   duplicating producer claims.
2. Normalize a strict schema-1 visual profile against the parent contract and
   decoded PNG dimensions. It declares one normalized plot rectangle,
   increasing linear/log domains containing every converted plotted value,
   uniform background and bottom/left-axis colors, nominal axis width, exact
   ordered series colors and chart-type-appropriate line/marker sizes, bounded
   RGB and position tolerances, and bounded pass/fail thresholds. All palette
   entries must be separable at twice the color tolerance.
3. Decode and alpha-composite the exact PNG over the declared background.
   Project only the independently selected, converted, ordered, and sampled
   semantic points. Rasterize bottom and left axis paths, line centerlines, and
   filled-circle marker footprints under a one-million-sample budget.
4. Build per-color masks and integral images. Measure axis path coverage and
   nominal pixel support; line path/footprint and marker-center/footprint
   coverage; same-color pixels outside each accepted mark envelope; and
   declared-background conformance outside the union of accepted foreground
   envelopes. Position proximity and pixel-support checks are separate so a
   thin nearby trace cannot satisfy a wider declared mark solely by proximity.
5. Preserve `conforming` and `nonconforming` outcomes as equally immutable
   records under `.sciencecode/figure-visuals/`. Exclusive staging and atomic
   rename publish the deterministic report and hashed manifest; the audit event
   binds parent, PNG, profile, replay, report, status, and manifest digests.
   Verification revalidates the current parent, every stored file, full replay,
   complete visual report, chat link, and audit chain.
6. Enumeration joins directory and audit identities, so deletion remains
   visible. Registry/profile/report/manifest/pixel/point/sample limits and
   realpath/symlink checks fail closed. CLI, same-origin API, Lab, AI interaction
   context, harness, lineage, state counts, and project verification consume
   the same record.
7. The engine is intentionally constrained to one uniform-background,
   bottom/left-axis flat-color line/scatter plot. It does not OCR titles, tick
   labels, legends, annotations, or values; validate error bars, hidden or
   overlapping marks, categorical/faceted layouts, statistics, domain meaning,
   or scientific validity; or certify a renderer generally.

## Domain-native studio lifecycle

1. Artifact extension routing happens only after the normal manifest and
   realpath checks. The server serves allowlisted text formats inline with an
   explicit MIME type; parsing remains entirely in local ES modules under
   `lab/` and loads no CDN code or remote data.
2. `lab/chemistry.js` parses a bounded connectivity subset of Daylight SMILES
   and MOL/SDF V2000 records. It preserves explicit atoms, charges, aromatic
   bonds, recorded coordinates, bond orders, and SDF properties. The view does
   not canonicalize, validate valence, infer hydrogens/stereochemistry, or
   claim that explicit-atom formula/mass is a complete molecular formula.
3. `lab/genomics.js` parses bounded BED/bedGraph, GFF3/GTF, VCF, and FASTA
   records. BED remains zero-based half-open. One-based inclusive GFF/GTF and
   one-based VCF records are normalized to an internal zero-based half-open
   viewport while the original bytes remain unchanged. The module does not
   index, align, call, annotate, or interpret biological significance.
4. `lab/manuscript.js` computes an LCS line diff within a fixed cell budget,
   merges it into review hunks, and extracts a bounded AI payload. When the
   exact display budget is exceeded, it labels the changed middle as a coarse
   delete/insert replacement. The editor still downloads or persists the exact
   complete draft rather than reconstructing it from the display diff.
5. Canvas views use deterministic coordinate transforms with pointer and
   keyboard controls. View, selection, source-edit, and diff actions enter the
   normal secret-scanned 48 KiB interaction chain. Complete edited text enters
   only the existing 8 MiB immutable revision workflow.

## Scientific-lineage lifecycle

1. `lib/lineage.js` enumerates existing record registries without creating or
   rewriting provenance. It runs the normal verifier for every evidence,
   retrieval, run, kernel/cell, simulation, experiment, preregistration, chat,
   and interaction record.
2. Stable namespaced nodes represent those records plus immutable code/data
   inputs, ranked evidence-span citations, and manifest-bound artifacts. Stable
   directed edges represent containment, ordering, grounding, AI context,
   execution, branch creation, production, and user revision.
3. Missing cross-links become explicit invalid placeholder nodes. Failed
   integrity is an error; valid failed computation remains a warning. A
   completed turn with no recorded evidence, notebook, interaction, or linked
   scientific input receives a grounding warning.
4. Nodes, edges, findings, schema, and scope are sorted and SHA-256 hashed. The
   request timestamp is excluded, so rebuilding unchanged records produces the
   same graph digest. Conversation scope is the connected component rooted at
   that chat and cannot silently pull in unrelated project records.
5. `sciencecode gate` includes lineage integrity. The loopback Lab exposes a
   read-only `/api/lineage` route and a dependency-free SVG client with
   pan/zoom, filters, node inspection, and upstream/downstream traversal.
6. Selecting or sharing lineage is a normal bounded, secret-scanned,
   hash-chained interaction. It records the graph digest, selected node, trace
   direction, bounded node IDs, and optional user note for the next AI turn.
   The derived graph itself remains read-only.

## Artifact revision lifecycle

An artifact revision is a new immutable output, not a mutation of the producing
simulation, experiment, evidence record, or notebook cell:

1. The caller supplies a canonical manifest-bound artifact URL and replacement
   text or bytes. ScienceCode resolves the URL through the source record's
   normal verifier, rejects forged metadata and filesystem escapes, and runs
   secret and size preflight before creating revision state.
2. ScienceCode writes the replacement and manifest to a private staging
   directory, fsyncs exclusive files, and atomically renames the directory into
   `.sciencecode/revisions/`. The manifest stores source record/artifact hashes,
   exact replacement hash/size/type, creation chat, optional rationale, and an
   optional prior revision's manifest and replacement hashes.
3. A creation audit event binds the immutable manifest and source/replacement
   digests. Audit IDs are also the revision registry's recovery index, so a
   removed or link-replaced record stays visible as an integrity failure.
4. Review decisions append to a separately locked JSONL hash chain. Each
   `accepted` or `rejected` decision has its own chat, note, digest, and audit
   event. Current status is derived from the latest verified decision; no
   manifest or artifact is rewritten.
5. Proposal and decision events append normal AI-visible interaction records.
   The next turn receives exact manifest and replacement paths and is warned
   that only the latest accepted revision is eligible for downstream use.
6. Lineage connects source artifact -> revision -> replacement artifact,
   earlier revision -> later revision, revision -> review decision, and each
   user handoff -> later turn. Pending proposals are review warnings; valid
   rejection is preserved without failing project integrity.

## Preregistration lifecycle

Preregistrations have two compatible immutable source contracts:

1. The native Confirmatory Lab accepts a non-empty name and bounded Markdown.
   Its local inspector and the authoritative server independently require one
   populated level-2 through level-6 heading for each of nine planning
   sections. Fenced-code headings do not count; missing, empty, duplicate, or
   `[REPLACE: ...]` sections fail before metadata creation.
2. Secret preflight and a 256 KiB UTF-8 ceiling run before `ensureScienceDir`.
   The schema-v2 record identifies an inline Markdown source, the validation
   engine, and its exact required-section list. The frozen artifact is written
   exclusively, followed by an exclusive JSON record and audit event binding
   both content and record hashes.
3. Verification checks schema, IDs, status, digests, byte length, manifest-bound
   paths, the audit event, and the full structured-section contract against the
   frozen bytes. Schema-v1 registrations created from project files retain
   source-drift reporting and remain valid under their original contract.
4. Metadata root, registry, record, mutable source, and frozen artifact paths
   are checked through the real filesystem. A link or non-directory store is
   rejected before creation; an unsafe record is never parsed or served.
5. Same-origin endpoints create, list, inspect, and serve only verified exact
   source bytes. Lab state marks each registration's integrity and source
   status, and lineage connects the registration to its immutable input
   artifact.
6. Chat is optional. When selected, creation or later focus adds a bounded,
   secret-scanned interaction for the next AI turn; it does not change or own
   the preregistration record.

## Confirmatory analysis lifecycle

An analysis contract freezes an operational decision rule before a recorded
experiment; an assessment is a later immutable replay, not an edit to either
record:

1. The caller links a verified frozen preregistration and a regular Python
   project file to a strict JSON contract. Unknown fields, secrets, traversal,
   filesystem links, invalid timestamps, oversized inputs, duplicate outcome
   IDs, and contracts without a primary outcome fail before record creation.
2. Normalization retains population, conditions, missing-data and multiplicity
   policy, exclusions, sensitivity analyses, and bounded primary, secondary,
   or exploratory outcomes. Legacy schema 1 keeps its free-text unit and bare
   numeric threshold. Schema 2 fixes a registered unit descriptor and typed
   threshold quantity for every outcome. Thresholds are dimension-checked and
   normalized into the outcome unit before the contract is frozen.
3. ScienceCode copies the exact script and canonical request into an exclusive
   staging directory, hashes every file, atomically publishes under
   `.sciencecode/analysis-contracts/`, and binds the record to the
   preregistration and audit chain. Verification replays normalization and
   reports later source-script drift without changing the frozen bytes.
4. `sciencecode experiment run --analysis-contract ID` refuses a changed
   source script and embeds the contract, manifest, preregistration, and script
   digests into both plan and experiment manifest. Experiment verification
   rechecks those links and prospective timing while preserving compatibility
   with older unbound exploratory experiments. A schema-2 binding also freezes
   unit-engine version 1 and places result/review artifacts in typed-quantity
   mode. Every present statistic must have exactly `{value, unit}`; compatible
   values receive deterministic canonical aggregates, while malformed or
   dimensionally inconsistent summaries fail the experiment review.
5. Assessment first verifies the contract and experiment, then selects exactly
   prespecified branches. Engine 1 preserves legacy numeric replay. Engine 2
   rejects bare, malformed, unknown-unit, or dimensionally incompatible
   statistics as explicit missing observations; converts valid quantities into
   the frozen outcome unit; calculates the fixed mean/median/minimum/maximum;
   and applies the already-normalized typed threshold. Raw and converted values
   remain visible. All primary outcomes determine the primary verdict;
   secondary and exploratory outcomes remain visible but noncontrolling.
6. The report separately records `outcome_verdict`, `registration.status`,
   automatic deviations, and a user-disclosed deviation. A passing threshold
   on a deviated or unregistered pair is never relabeled prospective. No
   p-value, confidence interval, causal, clinical, or regulatory inference is
   generated.
7. The entire report is deterministically regenerated during verification and
   stored with an audit-backed registry under
   `.sciencecode/analysis-assessments/`. The newest verified contract/experiment
   pair is current; prior assessments stay immutable with derived
   `superseded_by` lineage.
8. Lab creation automatically appends bounded analysis interactions. The next
   AI turn receives exact primary thresholds or replay values plus registration
   and deviation status. Harness, lineage, project state, CLI, and project gate
   expose the same records; scientific fail/deviation is attention, while
   tampering or broken links fail integrity.

## Procedure Studio lifecycle

A plan, assessment, and human decision are three immutable record types. None
is a hardware command:

1. The caller supplies a strict JSON plan. Normalization rejects unknown
   fields, suspected secrets, unsafe IDs, oversized collections, duplicate
   local IDs, unsupported domains or operations, and any physical policy other
   than external_human_control_only.
2. Every evidence ID is verified and digest-bound. A revision points to a
   verified prior plan and must have a later timestamp. The submitted request
   and canonical plan are written exclusively in staging, hashed, atomically
   published under .sciencecode/procedures, and linked to the audit chain.
3. Verification replays canonical normalization, evidence and supersession
   links, descriptors, counts, automation targets, timestamps, audit events,
   and supersession ancestry. Audit discovery keeps removed record IDs visible.
4. Assessment verifies the exact plan, topologically orders dependencies,
   reports cycles and unknown references, checks laboratory resources,
   drug-discovery controls, hazard-control hierarchy, training, emergency and
   stop requirements, totals known durations and material quantities, and
   builds non-executable XDL 2.0 and Opentrons mappings.
5. The complete assessment report is regenerated during verification. A new
   assessment becomes current for that exact plan, while older assessments
   remain historical. Ready for human review means no deterministic blocker;
   it is not a facility safety or scientific-validity finding.
6. A decision binds exact plan and current-assessment digests, reviewer-entered
   name, role, organization, basis, conditions, scope, explicit attestation,
   and optional expiry. External physical scope requires a future expiry no
   more than 366 days away. Reviewer identity is always recorded as unverified
   and physical execution as disabled.
7. Effective state is derived rather than stored: integrity, latest scope
   decision, current plan, current assessment, approved status, and unexpired
   time must all hold. A blocked assessment cannot be approved.
8. Procedure Studio and the CLI append bounded plan, assessment, and decision
   interactions. Step, gate, finding, adapter, and decision focus can be sent
   to the next AI turn as untrusted context. Lineage connects evidence to plan,
   plan to assessment and decision, assessment to decision, chats, artifacts,
   supersession, and interactions.

## Semantic consistency review lifecycle

A semantic review is an immutable deterministic critic record. It remains
separate from both the manuscript and any later AI or human correction:

1. The caller selects either a canonical manifest-bound Markdown/MDX,
   reStructuredText, TeX, or text artifact, or one exact immutable revision.
   ScienceCode reuses the source verifier, rejects links and filesystem
   escapes, caps the document at 8 MiB, validates UTF-8, and secret-scans the
   source before copying any review state.
2. A bounded extractor retains claim text hashes and source line ranges while
   skipping fenced and indented code plus reference sections. Citation locators can bind only
   to verified ScienceCode evidence IDs, exact spans, pages, or DOI metadata
   already present in the immutable evidence library.
3. The deterministic pass records lexical overlap, literal-number agreement,
   possible negation mismatch, and explicit arithmetic results. Arithmetic is
   parsed by a small finite expression grammar; manuscript text is never passed
   to JavaScript or a language runtime.
4. Markdown, HTML, and TeX links are resolved only through verified local
   artifact routes. Linked small text data can be checked for literal values;
   figure traceability requires an adjacent manifest-bound code link. External
   or untracked outputs become findings rather than being fetched.
5. The complete report and its settings, target, source, artifacts, and
   findings are hashed into an exclusive staged record under
   `.sciencecode/reviews/`, then bound to a `semantic_review.created` audit
   event. Verification reruns the deterministic analysis over the exact target
   and compares the entire report.
6. Creation appends a bounded `review` interaction for the next AI turn.
   Lineage adds target -> review, evidence -> review, and conversation -> review
   edges. The Lab Reviewer workspace and harness expose claim-level findings and
   an explicit user direction without rewriting either source or report.
7. Record integrity and scientific validity remain separate. A verified
   `review` or `fail` verdict is visible scientific attention, while only a
   malformed, missing, or tampered reviewer record fails the integrity gate.
   Load-bearing interpretation belongs to the read-only semantic reviewer and
   a qualified human.
8. Repeated reviews of the same target URL, target hash, and conversation are
   ordered by their exact creation timestamp. The newest verified record is
   current; older reports remain immutable and gain derived `superseded_by`
   lineage edges. Historical findings remain auditable but do not inflate the
   current attention counter.

## Foundational knowledge graph

`lib/knowledge.js` compiles a static, in-process principle graph at module load.
Layers are ordered mathematics (tier 0), physics, chemistry, biology, and
applied biomedicine (tier 4); the tier is the distance from first principles and
the strength of the warrant.

Compilation is fail-closed. Duplicate ids, unknown layers, kinds, statuses, or
confidences, unresolved dependencies, a dependency on a higher layer, a claim
of more confidence than the weakest dependency, an axiom outside mathematics,
or any cycle is recorded as a violation, and any violation makes every read
path throw `INVALID_KNOWLEDGE_BASE`. Violations are recorded rather than thrown
during import so the base stays describable: `knowledge verify` and `doctor`
report the exact violation instead of the whole CLI dying on a stack trace. Acyclicity is established by Kahn ordering, and that topological
order is reused for every derivation so dependencies always precede dependents.

Records are frozen on compile and shared by reference; queries are bounded by
a maximum query length and result count. `derivePrinciple` returns the full
transitive support tree with the layers crossed, the foundational principles it
terminates at, the weakest link, and every limit stated by a moderate or
provisional supporting claim. `groundDomain` does the same for a named domain
pack, and `knowledgeGroundingForWorkflow` maps a harness workflow to the packs
it must cite. `verifyKnowledgeBase` re-runs every invariant for
`sciencecode knowledge verify`, `sciencecode doctor`, and the release gate.

The base holds textbook-level grounding with primary references. It records no
experimental results, performs no chemistry or structure prediction, and
authorizes no physical work.

## Visible scientific harness

The harness classifies the first research goal into drug discovery,
biomolecular design, procedure development, computational science, evidence
synthesis, CAD engineering, or general research.
Each workflow declares its context of use, risk, physical-execution policy,
stages, owners, and review gates. Lane and stage status is derived from verified
turns, public tool events, linked compute records, transcript language, and
user interaction records; the server does not synthesize fake subagent activity.

Every view also carries the knowledge grounding for its workflow: the domain
packs it should cite, the layer span from mathematics up, the count of
supporting principles, and the provisional claims and governance principles it
must not present as settled.

Drug-discovery and procedure workflows always expose safety, dry-run or
validation, and named-human-approval gates. Biomolecular design adds a
grounding stage before design and a biosafety stage after compute; an outcome
recorded without visible biosafety, biosecurity, or dual-use screening raises
that stage to attention and is reported as a stated limitation. ScienceCode can design and inspect
physical work but does not autonomously authorize laboratory, clinical,
chemical, biological, or hardware execution.

## Hypothesis-tree campaign lifecycle

A version-2 campaign freezes one normalized research question, context of use,
classification, ordered hypothesis tree, task DAG, branch and global budgets,
and execution policy. A child can be an alternative, refinement, mechanism,
or rebuttal only to an earlier hypothesis, which makes replay deterministic
without a separate graph database. Version-1 plans retain their original
schema and replay path; they are never silently upgraded.

Execution state is derived from an append-only event ledger, not mutable task
rows. Checkpoint decisions, task starts, task terminals, campaign stops, and
hypothesis assessments carry sequence numbers, previous-event hashes, a
separate head, and audit links. Every task attempt gets a correlation token
and runs as one ordinary recorded Scientist turn, so its run/transcript and
any nested scientific records retain their existing verification contracts.
The dispatcher permits only one ready task and checks dependencies, risk
checkpoint, retry limit, wall clock, global attempts, GPU/NPU ceilings, active
branch state, and per-branch accelerator/attempt ceilings before launch.

Branch state is replayed from the newest direct assessment plus inherited
parent pause/prune state. A direct promote decision is the explicit escape
from an inherited gate; no model-generated rule automatically expands, ranks,
prunes, or promotes the tree. Tasks linked only to paused branches wait, tasks
linked only to pruned branches become visibly terminal without execution, and
shared tasks remain actionable while at least one linked branch is active.

A hypothesis assessment records a supported, challenged, falsified, or
inconclusive verdict separately from continue, pause, prune, or promote. It
links only completed tasks declared for that branch and supersedes rather than
rewrites an earlier assessment. Replay compares event sequence: if a relevant
task completes or is skipped after the latest verdict, that verdict is stale.
An active settled branch then requires a fresh local-user assessment before
the campaign can become completed. Integrity, task outcome, scientific
verdict, and branch resource decision remain distinct.

The Campaigns workspace and main harness expose the same replayed tree, task
states, current/stale/due verdicts, branch/global budgets, live job trace,
next task or checkpoint, and immutable ledger. CLI, API, interactions,
lineage, chat context, and project verification consume that state rather
than maintaining UI-only truth. Parent-child lineage edges preserve the exact
hypothesis relation; assessment interactions preserve the declared local-user
boundary.

The bundled Scientist is instructed and canonical-command-denied from
submitting `sciencecode campaign assess`; it may only recommend a verdict and
task basis. This is defense in depth, not authenticated identity: direct local
filesystem/API/module access is inside the user's trust boundary. Likewise,
campaign network policy is disclosed prompt policy until a future container
or OS-enforced executor exists.

## CAD lifecycle

A CAD project starts from the bounded starter assembly or a project-relative
manifest beside its source tree. Normalization fixes units to millimeters and
the engine to `openscad` or `cadquery`, requires one matching declared entry,
caps files and parts, validates all part references, and records build volume,
tessellation, simulation assumptions, parameters, and the permanent
no-hardware policy. Import copies each regular source or CAD asset into the
project-owned CAD directory and binds the normalized descriptor and source
hashes to the registry and audit chain. Existing schema-v1 OpenSCAD records
remain verifiable because an omitted engine normalizes to `openscad`.

Reads are restricted to declared regular files; binary assets are exposed as
non-editable metadata. A SCAD or Python write requires the digest observed by
the editor when supplied, rejects a stale digest, preflights the full engine
contract, preserves immutable before/after source, and atomically replaces only
that working source. OpenSCAD include/use/import references must be static and
declared. The descriptor remains immutable; changing engine, entry, or the
file/part contract creates a new CAD project.

A build verifies the current contract and snapshots every declared file. The
OpenSCAD path invokes the detected console with Manifold geometry and hard
warnings. The CadQuery path first requires a healthy definition-matched
isolated runtime, invokes the packaged adapter with isolated Python, bounded
parameters and explicit tessellation, and accepts a Workplane, Shape, or
Assembly returned by `build(parameters)` or `result`. It exports a common
ASCII STL plus STEP, canonicalizes volatile STEP time metadata, and records
CadQuery/OCP/Python versions, object names, solid/face counts, volume, area,
and loaded local modules. Both paths independently analyze the STL and archive
tool output. The complete declared source snapshot is hashed again after
execution; any addition, deletion, or mutation fails the build instead of
publishing outputs derived from changed inputs. The manifest covers every exact
artifact and is audit-linked. A later working-tree edit cannot change the
build; mutation, deletion, or an unexpected record file invalidates it.

The native CAD screen consumes only a verified completed build and produces
bounded topology, dimensions, volume, mass estimate, build-envelope, and
overhang results. It is deliberately classified as geometry and printability
triage, not a physics solver.

The packaged `cad-surface-heat` template is a separate, recorded first physics
path. It reads only the verified immutable ASCII STL parent, deduplicates its
bounded surface vertices, derives a unique edge graph and connected components,
and integrates normalized explicit graph diffusion with fixed hot and cold face
bands. The run refuses unknown parameters, degenerate boundary spans, overlapping
boundary bands, excessive mesh size, or a stability number above 0.45. Its
summary records the equation, units, time step, diffusivity, mesh scale,
components, boundary counts, finite-value/pinning/maximum-principle checks,
runtime device, and exact CAD hashes. The outputs include immutable summary JSON,
temperature history CSV, and ASCII PLY carrying `temperature_c` per vertex.
This is explicitly surface-graph heat diffusion for comparative exploration,
not volumetric finite-element heat transfer, material calibration, convergence
evidence, or safety validation.

The Lab installs a packaged simulation template only at its fixed project path.
It will reuse an exact existing copy, refuse a differing file, and never accepts
a caller-selected destination. Arbitrary recorded CPU/GPU model scripts can also
bind the verified STL as a CAD parent. Every simulation manifest carries the CAD
build and project IDs, build-manifest hash, mesh path and hash; verification and
lineage replay that exact parent and fail on drift. The Lab model route accepts
only bounded project-relative script/input paths, safe parameter names, JSON
arguments, seed, device, timeout, and a free-GPU-memory reserve. It refreshes
hardware state before auto/CUDA dispatch and serializes the model with other
operations for that CAD project.

Slicing also begins from a verified completed build. Preview mode uses an
isolated slicer data directory, zero extrusion and zero temperature, then scans
the complete G-code for positive extrusion, heaters, homing/leveling, spindle,
fan, coordinate, and mode indicators. Printer-profile mode is separate,
requires explicit physical-risk acknowledgement, snapshots the
project-contained profile, and rejects nonempty post-process hooks.
ScienceCode has no printer upload, network, USB/serial, or execution path.

Lab render, screen, and slice jobs run in isolated child processes and publish
bounded in-memory progress while the immutable success or failure record
remains authoritative. They finish provenance rather than exposing a UI kill
that could strand an ambiguous partial record. A CAD-linked model instead uses
the shared asynchronous simulation finalizer and can be stopped: the owned
process tree is terminated, available logs/artifacts are hashed, a cancelled
manifest and audit finish event are written, and the default project gate fails
the incomplete outcome. Comparative CAD studies use the shared asynchronous
experiment finalizer rather than the non-interruptible CAD worker: the complete
plan is frozen first, branch progress stays in a bounded process-local job, and
stopping terminates the active simulation while the parent writes its cancelled
branch plus explicit `not_run` rows for every undispatched branch. Review,
artifact hashes, audit finish, CAD-parent replay, lineage, and project-gate
policy then operate on that coherent partial experiment. A cleared owned timer
retains the prior 24-hour maximum for the whole matrix and aborts through the
same finalizer with a distinct reason. Cancellation must
match the exact job, operation, CAD project, build, and optional chat binding.
Source edits, selected files/builds, mesh
rotate/zoom/select state, G-code edits, directions, and outcomes become bounded
hash-chained interactions for the next AI turn.

## Simulation, experiment, and inference lifecycle

A recorded simulation validates containment and secrets before creating state,
captures source and runtime, records a start event, executes through the
deterministic Python launcher, captures GPU state and generated artifacts,
hashes the final manifest, then records a finish event.
When a CAD build is supplied, the launcher automatically declares its verified
immutable STL as an input, exposes only the exact parent metadata to the model,
and records a modeled_by lineage edge. The synchronous CLI and asynchronous Lab
paths share preparation and finalization; async cancellation remains a
verifiable terminal simulation rather than a partial directory.

A recorded experiment freezes its hypothesis and complete branch plan before
the first branch. It executes a bounded matrix sequentially so GPU use remains
predictable. Each child is a normal simulation with a parent ID, branch index,
branch count, and plan digest. The parent writes `results.json`,
`summary.csv`, and `review.json`. Verification recalculates reviewer
statistics and cross-checks plan rows, aggregate rows, child links, child
manifests, artifact digests, and the audit chain.

The Lab exposes simulation and experiment authoring through strict same-origin
JSON routes and `lab/compute.js`. Both launchers use native form controls,
bounded typed JSON, a safe public event projection, reload recovery, and one
shared standalone-compute slot. `runSimulationAsync` and
`runExperimentAsync` reuse the synchronous preparation and finalization
contracts. Stopping a matrix preserves the active branch record and writes
explicit `not_run` rows for undispatched branches before recomputing the
review, hashes, verification, and audit finish event. Public jobs disclose
parameter names and variation sizes, not values, directions, raw logs, or
artifacts. Scripts, declared inputs, CAD parents, and analysis contracts remain
project/manifest bound; real filesystem targets are checked before state is
created.

A recorded inference validates project containment, byte and iteration limits,
and secrets before creating state. It archives the exact ONNX model and
name-keyed JSON inputs, launches the isolated Windows ML runtime, captures NPY
outputs, a bounded JSON preview, latency and ONNX Runtime profile, then records
hardware and provider evidence before and after execution. `--device npu` is
strict unless fallback is explicitly allowed. Schema v2 calls the profile
counts execution events, not unique graph nodes; v1 records retain backward
verification with their original field names.

The CLI uses the synchronous recorder contract. Lab uses `runInferenceAsync`,
which passes an AbortSignal to the same isolated worker and then enters the
same immutable finalizer. Its public job retains a bounded event list and safe
request/result summary, never the user note, raw inputs, logs, or model bytes.
The route validates an allowlist of fields and numeric bounds before queueing,
realpath-resolves model and input files inside the project, and rejects a
second active inference. A stop changes the job to cancelling and terminates
the owned worker; finalization still hashes available artifacts and publishes
a verified `cancelled` record with a failed-outcome gate. Optional chat
linkage writes a separate inference interaction and lineage edge rather than
changing the inference manifest.

## Product evaluation lifecycle

`lib/evaluations.js` defines the versioned `sciencecode-core` product
evaluation. It is a release contract rather than a research-project record:
`sciencecode evaluate` performs no model call, network request, or mutation of
the user's project. The suite runs 55 labeled cases across reviewer detection,
citation behavior, numerical directives, repeatability, scientific-safety
instructions, and agent-role separation. Every current category threshold is
fixed at 1.0 because these cases describe exact deterministic behavior, not a
sampled estimate of general model quality.

Citation cases create an isolated OS-temporary ScienceCode evidence fixture,
exercise the same evidence ingestion and semantic-review functions used by the
product, run against exact record/page/span/DOI locators and adversarial
missing, weak, numeric, number-mismatch, and negation cases, then remove only
that owned temporary directory. No random evidence ID or temporary path enters
the public report. Arithmetic cases use the production bounded parser; claim
cases use the production review engine.

Safety and role cases treat packaged agents, commands, and skills as executable
product contracts. Each evaluated source must be a contained regular UTF-8 file
no larger than 1 MiB. The evaluator hashes newline-normalized text, reads all
bindings again after the first execution, repeats every projection, and fails
if a case, threshold, policy phrase, role permission, source binding, or repeat
digest differs. The timestamp-free JSON report contains the suite-definition
hash, per-category metrics, bounded expected/observed case projections, source
bindings, limitations, and a deterministic whole-report fingerprint. `npm run
check` runs this gate before the ordinary test suite.

The benchmark's precision, recall, and accuracy describe only its declared
fixtures. They are not estimates for external documents, open-ended agents,
citation entailment, domain validity, or safety containment; broader claims
require independent blinded corpora and expert labels.

## Governed external benchmark lifecycle

`lib/benchmarks.js` keeps external performance evidence separate from the
fixed `sciencecode-core` contract suite. It accepts one schema-v1 manifest for
a held-out citation-requirement corpus. The manifest freezes the case and label
file hashes/counts, task labels, prospective accuracy/precision/recall/
abstention thresholds, one through eight baseline-run hashes, and bounded
governance statements for independent creation, expert labeling, adjudication,
blinding, licensing, source, limitations, corpus freeze, and label unsealing.
No manifest-controlled threshold can alter `sciencecode evaluate`.

1. `benchmark inspect` opens the stable manifest and contained case JSONL only.
   It validates exact schema, UTF-8, sizes, portable paths, case uniqueness,
   hashes, and governance, then emits input hashes and declared sealed bindings.
   It never resolves, stats, or opens the label or baseline files.
2. `benchmark predict` reuses that input-only path and calls the production
   `extractScientificClaims` implementation. It is permitted only from corpus
   freeze up to—but not including—label unsealing. It emits one positive or
   negative label per case, binds declared case/label hashes, and exclusively
   writes a canonical-digest run inside the current working directory. No
   provider, model, network request, project record, or label read participates.
3. `benchmark score` reads and fully validates the candidate and hash-bound
   baseline runs before checking the unseal schedule. It refuses early scoring;
   only after unsealing does it resolve and open the label JSONL. Labels must
   cover every case exactly once and contain both declared classes.
4. Candidate and baseline scoring treats `null` as an explicit incorrect
   abstention. It reports accuracy, coverage, abstention rate, binary confusion,
   precision, recall, specificity, F1, per-stratum metrics, prospective
   threshold checks, and fixed 95% Wilson score intervals. Paired comparison
   counts show candidate-only, baseline-only, joint-correct, and joint-incorrect
   cases without making an unsupported significance claim.
5. The timestamp-free score report contains exact source/run hashes, no raw
   case text or local absolute path, reviewable unsealed case outcomes, baseline
   predictions, limitations, and a deterministic whole-report fingerprint.
   Inspection reports likewise omit label content and state that sealed files
   were not opened.
6. Bundle references are bounded regular UTF-8 files below a real bundle root;
   traversal, absolute/backslash paths, links/junctions, moving files, invalid
   encoding, mismatched hashes, unknown fields, duplicates, missing/extra cases,
   late predictions, baseline impersonation, and overwrite attempts fail closed.

This protocol provides verifiable file separation and sequencing, not a trusted
timestamp, identity system, confidential-computing boundary, or proof that an
attestation is true. A party with filesystem access can read or replace files
outside the command, and an author can lie about independence or expertise.
Real generalization evidence still requires an externally operated corpus and
review of the published materials.

## Scientific controls

- Research work is labeled exploratory or confirmatory.
- Raw inputs and archived work are preserved by protocol.
- Important factual claims should be traceable to primary sources.
- Computations record inputs, environment, parameters, seeds, and outputs.
- Confirmatory experiments can bind frozen operational outcomes and decision
  rules before execution, with deviations preserved rather than rewritten.
- Procedures separate a source-linked immutable plan, deterministic logical
  dry-run, and scoped local human decision. Mapping previews never become
  hardware permission.
- Campaigns freeze competing hypotheses and branch/global resource ceilings,
  execute one recorded task at a time, and require a current local-user verdict
  after branch work settles. Automatic pruning remains disabled.
- CAD keeps editable parametric sources separate from immutable render, screen,
  model, and slice records. A stopped model remains an incomplete outcome, and
  G-code generation never becomes printer permission.
- CAD scalar simulations bind a verified immutable mesh, record numerical and
  boundary checks, and keep user-selected field values in the interaction chain.
  A passing integrity or stability check is not scientific model validation.
- Conclusions require uncertainty, sensitivity/falsification, and limitations.
- Preregistrations can be frozen before outcome inspection.
- Independent reproducibility and skeptical agents challenge major findings.
- `sciencecode gate` verifies local provenance and failed-run status.

## Current limits

- Conversations execute one turn per chat at a time. Through bounded job
  polling, the Lab displays safe activity metadata and completed OpenCode text
  blocks, and it can abort a queued or running turn while preserving partial
  records. Granularity depends on the engine's JSON text-part events; this is
  not a general token-delta transport.
- The current NPU path targets bounded ONNX inference through Windows ML and
  AMD Vitis AI. It is not arbitrary Python offload, NPU training, a model
  converter, or evidence that every ONNX operator will execute on the NPU.
  Lab serializes accelerator inference within one process; its live job view is
  ephemeral, while completed, failed, and cancelled inference records persist.
- The built-in CAD screen is geometry and printability triage, not FEA, dynamics,
  fluid, fatigue, collision, tolerance, support generation, material
  certification, or printer validation. The packaged thermal model operates on
  the tessellated surface graph only; it has no volume elements, material
  database, convection/radiation/contact model, adaptive convergence study, or
  certification claim. OpenSCAD and PrusaSlicer are optional local toolchains;
  CadQuery is an optional isolated ScienceCode runtime. CadQuery sources and CAD
  model scripts remain arbitrary local Python code with user permissions. A
  free-VRAM threshold reduces accidental
  crowding but is not a scheduler or memory reservation. Profile G-code remains
  untrusted physical machine-control data even when its record verifies.
- Project kernels are local, single-project processes with one in-flight cell
  per language. They do not yet support collaborative multi-client editing,
  remote kernels, containers, schedulers, or HPC transports.
- Python is available through the isolated compute runtime or a system
  fallback. R support is optional and cannot be live-tested on a host without
  `Rscript`.
- Restore re-executes completed source in order and can repeat external side
  effects. Arbitrary notebook code still runs with the user's OS permissions;
  the worker protocol is not a sandbox.
- Rich values are represented through bounded results, variable summaries, and
  captured figures rather than a general object-serialization protocol.
- OpenCode JSON run streams do not currently expose all nested subagent events;
  lane status therefore remains conservative when a nested trace is absent.
- Campaigns use deterministic local branch/task scheduling, not autonomous
  best-first search or parallel multi-agent tree expansion. Task network policy
  and the local-user assessment boundary are workflow guardrails rather than
  OS-enforced network isolation or authenticated identity.
- The semantic reviewer extracts bounded prose claims and resolves immutable
  citations, but lexical overlap and literal-number matches do not establish
  entailment or refutation. It evaluates only explicit arithmetic directives,
  and does not infer units, transformations, or statistical validity. It does
  not silently infer figure agreement from a code link; pixel agreement now
  requires a separate explicit immutable figure-comparison record.
- Figure comparison is mechanical decoded-RGBA checking for a bounded
  non-interlaced 8-bit PNG subset, with an optional fixed-block luminance SSIM
  floor over linear-light white-matte pixels. It does not register, crop,
  resample, apply color profiles, use a learned/windowed perceptual model,
  inspect source data/code, interpret plot semantics, or supply a domain-valid
  acceptance threshold. Other raster/vector formats and spatial registration
  remain future work.
- Semantic figure registration is a separate producer-sidecar check over PNG
  plus UTF-8 CSV/TSV. It verifies exact artifact hashes, declared column/unit/
  scale/row/sampling semantics, and deterministic converted data digests. It
  does not extract axes, legends, marks, values, or labels from pixels; prove
  the renderer used its declaration; support categorical/faceted/error-bar/
  confidence-band/aggregation semantics; or establish statistical or domain
  validity. A dishonest or defective producer can emit a self-consistent
  sidecar beside a misleading image.
- Decoded-pixel figure validation is the optional constrained check for that
  remaining renderer gap. It starts from a matched semantic parent and checks
  only one declared plot rectangle, uniform background, bottom/left axes, and
  separable flat-color line or filled-circle marks. User-declared geometry,
  domains, colors, widths, radii, tolerances, and thresholds are frozen claims,
  not inferred truth. It does not support general chart parsing, antialiased or
  gradient style inference, grid/legend interpretation, categorical/faceted/
  error-bar semantics, OCR, hidden/overlapping-mark proof, or scientific
  acceptance.
- Confirmatory replay supports bounded registered-unit parsing, declared
  dimensional conversion, and deterministic threshold aggregation. It does not
  establish that a script measured the declared variable, validate physical
  plausibility, infer absent units, estimate a sampling distribution, perform
  statistical multiplicity correction, identify causality, interpret clinical
  relevance, or provide regulatory validation.
- Persisted revisions are limited to 8 MiB and 256 linked versions. Acceptance
  records human intent but does not automatically rewrite reports, rerun code,
  prove the revision scientifically correct, or make a binary format safe.
- Chemical parsing is a depiction-oriented SMILES subset plus MOL/SDF V2000,
  not a cheminformatics toolkit. Genome tracks are bounded in-memory previews,
  not indexed BAM/CRAM/BigWig-scale browsing. Manuscript diffs remain textual;
  the separate reviewer supplies deterministic consistency triage, not a
  domain-validity guarantee.
- Procedure assessment is structural and logical only. XDL and Opentrons
  previews omit platform binding and are not executable; local attestations do
  not verify identity, facility authority, training, safety, regulatory
  status, or hardware readiness.
- Provider authentication is local and separate, but there is no enterprise
  SSO/RBAC control plane.
- Shell permission patterns are guardrails, not an OS sandbox.
- Audit hashes are local and are not KMS-signed or externally notarized.

## Next architecture targets

- remote/container/HPC kernel adapters that preserve the current cell schema
- richer chemical stereochemistry/reaction support and indexed genomic adapters
- PubMed, Crossref, OpenAlex, and domain-database retrieval profiles
- Jupyter, R, HPC, and container execution adapters
- externally authored multi-domain corpora, calibration evaluation, and
  independently operated benchmark publication using the governed workflow
- versioned inferential-statistical contracts and broader categorical,
  faceted, uncertainty-mark, and renderer-native visual validation profiles
- signed packages, SBOM/provenance attestations, and managed audit export
