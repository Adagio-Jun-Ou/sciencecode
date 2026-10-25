# Security and preservation

## Standalone state

ScienceCode launches only its pinned package-local engine and redirects engine
config, provider auth, sessions, data, cache, and state under
`SCIENCECODE_HOME`. It does not search for or fall back to a global OpenCode
binary. Existing OpenCode and XDG config variables are replaced for the child
engine.

Use `sciencecode paths` to inspect the boundary. Provider credentials supplied
as OS environment variables remain visible to the process by design.

## Project preservation

`sciencecode init` and immutable artifacts use exclusive-create semantics.
Snapshots and verification reject paths that escape the project root. The CLI
has no delete command. Scientific agents are instructed to preserve raw,
archived, and legacy work and carry cross-platform guardrails for common
destructive shell/Git commands.

Managed Lab snapshots require normal contained metadata directories and
manifest files. Capture is staged under an exact job-specific pending name,
independently rehashed, copied with exclusive-create semantics, and audit-bound
only after publication. Cancellation removes only that uncommitted pending
file. A snapshot is not a backup, external timestamp, signature, or defense
against an actor able to rewrite the full project, manifest, audit log, and
head consistently.

Those rules are not an OS sandbox. A general-purpose interpreter or an
unrecognized command can still alter accessible data. Keep independent backups
and run ScienceCode with the least filesystem privilege practical.

## Secrets

ScienceCode scans prompts, chat messages/titles, user workspace interactions,
artifact-revision text and notes, preregistration text, analysis-contract JSON
and frozen scripts, assessment deviation notes, procedure plans, reviewer
decision fields, and procedure workspace interactions for common private
keys, provider tokens, cloud keys,
bearer tokens, credential assignments, and URL credentials before persistence
or engine submission. Captured stdout, stderr, and JSON events are redacted with
the same families of patterns. Interaction payloads are also size bounded.

Pattern matching has false positives and false negatives. Do not place secrets
in prompts, research data, tracked config, command-line flags, or result text.
Prefer ScienceCode's isolated provider connection and scoped environment
variables.

## Evidence sources and retrieval

Evidence ingestion accepts only project-contained regular PDF, Markdown,
reStructuredText, and text files up to 64 MiB. It copies rather than moves the
source, uses exclusive record creation, and hashes the original, extracted
pages, spans, artifacts, manifest, and audit link. PDF extraction runs through
exact-pinned Mozilla PDF.js in a bounded child process with dynamic evaluation
disabled. That process isolation is a failure boundary, not an OS sandbox;
treat PDFs as untrusted input and keep the dependency current.

Bibliographic metadata is secret-scanned. Source bodies are not rejected at
ingestion because scientific evidence can legitimately contain credential-like
strings and sensitive research text. A matched span becomes part of the model
prompt, where the normal prompt secret preflight still applies. Do not ingest
participant data, credentials, export-controlled material, or unpublished data
unless the selected provider and local handling policy are appropriate.

Retrieval stores a SHA-256 query digest rather than the raw query. Ranked
records contain source manifest, page, span, settings, and text hashes but no
copied span text. The engine receives a bounded JSONL representation with each
source excerpt confined to a quoted field and explicitly labeled untrusted
data. This reduces prompt-injection ambiguity but cannot guarantee that a model
will ignore malicious or misleading source content; citations and conclusions
still require review.

## Semantic consistency reviewer

Semantic review accepts only a verifier-resolved immutable manuscript artifact
or saved revision. Source text must be valid UTF-8, use an allowlisted document
extension, remain within 8 MiB, and pass secret preflight before a review staging
directory is created. Record directories, targets, evidence, and linked
artifacts are subject to the same project-root, realpath, symlink, manifest, and
digest checks as their source record types. External links are not fetched.

Claim extraction excludes fenced and indented Markdown code. Claim and link
extraction is bounded to 2,000 claims, 5,000 findings, 10,000
review records, an 8 MiB source, and a 16 MiB report. Explicit arithmetic uses
a dedicated parser for finite numeric literals, parentheses, and basic
operators; it does not call `eval`, a shell, a notebook, or a language runtime.
Linked literal-value inspection is restricted to bounded UTF-8 CSV, TSV, JSON,
and text artifacts. A manuscript remains untrusted data and is never executed.

Review reports are staged exclusively, atomically published, independently
hashed, audit-linked, and fully recomputed during verification. These controls
detect alteration and make the deterministic result replayable. They do not
make a cited source true, prove entailment, validate statistics or units, or
show that figure pixels agree with code. Lexical overlap can be manipulated by
an adversarial manuscript or source and is exposed only as triage. The bundled
semantic-reviewer is read-only, but any separately authorized rerun still has
the normal arbitrary-code risk.

## Semantic figure registrations

Semantic registration accepts only three verifier-resolved immutable inputs:
a supported PNG, a UTF-8 CSV/TSV table, and a JSON producer sidecar. Their
canonical artifact URLs, record hashes, file hashes, byte counts, formats, and
copies are bound into an exclusive staged record and audit event. Registration
specs reject unknown fields and secrets; all targets reject traversal, links,
unrecorded files, unsupported extensions, invalid parent records, and digest
substitution. The sidecar is limited to 1 MiB, the table to 8 MiB, the report
to 4 MiB, and each project to 10,000 registrations.

The dependency-free table reader requires strict UTF-8, bounded CSV/TSV
quoting, at most 100,000 data rows and 128 columns, normalized trimmed unique
headers, and exact row width. Contracts bind at most 16 series, registered
source/display units, scale, missing-value handling, duplicate-x handling, row
order, sampling, and no aggregation. Selected nonblank cells must use a strict
finite decimal grammar; conversion overflow, incompatible units, nonpositive
log values, forbidden duplicates, missing columns, and ambiguous headers fail
closed. Digest input uses source-row numbers plus converted decimal strings
under a versioned JSONL encoding.

Verification re-resolves all original records, hashes every stored copy,
rebuilds the expected sidecar and report, and checks figure/source/sidecar/
contract/replay audit fields. A declared mismatch remains a valid negative
result; mutation is an integrity failure. These controls do not authenticate
the producer or prove that image pixels implement the sidecar. A malicious
renderer can emit a self-consistent declaration beside a misleading PNG, so
visual inspection, plot-code review, and domain review remain required.

## Decoded-pixel figure validations

Visual validation accepts only an integrity-valid `pass`/`matched` semantic
registration. It reuses the parent's verified PNG and CSV/TSV copies and binds
the parent manifest/report, figure, source, semantic contract, and replay
digests. The schema-1 profile rejects unknown fields and secrets, is capped at
64 KiB (72 KiB including its request wrapper), requires one bounded plot
rectangle and increasing domains that contain all converted plotted values,
and must match every semantic series in exact order. Background, axis, and
series RGB colors must be pairwise separable at twice the declared tolerance.
Coverage thresholds cannot be below 0.8, unexpected-series tolerance cannot
exceed 0.1, RGB-channel tolerance cannot exceed 48, and position tolerance
cannot exceed eight pixels.

The inherited PNG decoder enforces signature/chunk/order/CRC/format,
source-byte, dimension, pixel, and decompression limits before RGBA output.
This layer lowers the accepted image ceiling to 4,194,304 pixels, semantic
points to 4,096, and projected path/footprint work to 1,000,000 samples. Color
matching alpha-composites over the declared background. Position coverage and
nominal pixel support are distinct checks; unexpected same-series pixels and
background deviations are explicit. The record/report/manifest/audit registry
is exclusive, realpath-contained, link-rejecting, count/byte-bounded, and
audit-discovered so deletion remains visible. Verification revalidates the
parent and deterministically recomputes the whole report.

A `conforming` result proves only conformance to the frozen profile under this
narrow algorithm. The profile is a user-supplied claim and can be chosen or
tuned after seeing the PNG; ScienceCode does not prove it came prospectively
from renderer configuration. Because there is no OCR, the engine cannot verify
that declared domains match visible tick labels or that colors map to a legend.
It handles one uniform-background rectangle with bottom/left axes and
flat-color line or filled-circle marks, not general charts, grid/legend
interpretation, error bars, hidden/overlapping marks, or scientific meaning.
Profile review, source-code review, and qualified visual/domain review remain
required.

## Analysis contracts and confirmatory assessments

Contract creation accepts only a strict plain JSON object and a verified frozen
preregistration. It rejects unknown fields, secrets, unsafe or linked script
paths, more than 32 outcomes, non-finite thresholds, invalid roles or keys,
missing primary outcomes, impossible timestamps, and scripts larger than 8
MiB. It canonicalizes the project-relative path, copies exact source bytes,
uses exclusive staged writes and atomic directory publication, and binds the
contract, request, script, preregistration, manifest, and audit digests.

Schema-2 contracts additionally require registered unit declarations and typed
threshold quantities. The parser is capped at 64 characters, 12 explicit
factors, and absolute exponents of 12; rejects implicit multiplication,
parentheses, unknown symbols, overflow, extra quantity fields, and non-finite
values; and treats absolute `K`/`degC` as incompatible with temperature
differences or compound units. Unit-engine name/version is manifest-bound.
Typed experiment review rejects bare values and incompatible dimensions, while
confirmatory replay records unit faults as missing observations rather than
guessing or silently comparing unlike quantities. Legacy schema-1 contracts and
engine-1 reports follow their original numeric path.

A bound experiment refuses to run if current script bytes differ from the
contract and embeds the exact binding in its immutable plan and manifest.
Assessment requires verified contract and experiment records, deterministically
replays the bounded branch filter, missingness, aggregation, minimum count, and
threshold rules, then records registration status separately from outcome.
Every report is fully recomputed during verification. Contract and assessment
registries also read creation IDs from the audit chain, so deleted records stay
visible as failures. Storage roots, record directories, and files reject
symlink/junction escapes.

These checks prevent silent record drift and declared dimensional mismatch;
they do not establish that a script measured the declared variable, that a unit
or value is physically plausible, or that a chosen outcome, threshold, model,
missing-data policy, or multiplicity approach is scientifically valid. They do
not produce inferential, causal, clinical, or regulatory evidence. The
read-only confirmatory reviewer and a qualified human must inspect those choices
and any disclosed or automatic deviation.

## Procedure plans, assessments, and local decisions

Procedure plan creation accepts a strict plain JSON object capped at 512 KiB.
It rejects unknown fields, suspected secrets, unsupported policy values,
non-finite quantities, invalid or duplicate IDs, unsafe record paths, excessive
collections, and more than 256 steps. Linked evidence and any superseded plan
must pass their normal verifier. Exclusive staging, atomic publication,
per-file descriptors, manifest digests, audit-backed deletion discovery, and
realpath/junction containment apply to all three procedure registries.

The logical dry-run is a deterministic parser and graph evaluator. It does not
execute step text, generate code, call vendor software, contact hardware, or
interpret parameters as shell expressions. XDL 2.0 and Opentrons output contains
only bounded named-operation mappings and external requirements. Every adapter
record states that execution is disabled.

A decision can be approved or rejected within design-review, external-dry-run,
or external-physical scope. Approval requires an explicit attestation, and
external physical scope requires a future expiry capped at 366 days. ScienceCode
records reviewer-provided names and roles but always marks identity unverified.
It derives effective state from current verified records and time; it never
stores or exposes a hardware-enable capability. These checks prevent a stale or
blocked record from appearing current, but they do not verify the reviewer,
facility, training, hazard controls, law, ethics, biosafety, equipment, or
scientific validity.

## Provenance

CAD parameter studies use the same maximum-64 sequential experiment planner
and immutable child records as other matrices. When a CAD build is selected,
its verified manifest and STL hash are copied into the plan and manifest and
must match every child simulation and the audit chain during replay. Lab
rejects unsafe names, duplicate fixed/varied keys, oversized matrices, secrets,
large payloads, unavailable CUDA devices, and insufficient fresh free VRAM.
Lab study cancellation must match the exact job, operation, CAD project, build,
and optional chat. It aborts only the active owned simulation, finalizes its
available artifacts, writes explicit `not_run` rows for undispatched branches,
then recomputes and hashes the parent review and manifest before the audit finish
event. A maximum 24-hour whole-matrix timer uses the same finalizer and records
`study_wall_clock_timeout`; each branch retains its own smaller requested
timeout. Cancelled studies remain failed outcomes by default even when every
partial record passes integrity verification. Aggregate review detects record
drift but does not validate the equations, mesh convergence, material model,
uncertainty, causal interpretation, structural safety, or print safety.

Chat, run, campaign/assessment, simulation, experiment, analysis-contract/assessment,
procedure/assessment/decision, kernel/cell,
evidence, retrieval, artifact-revision/decision, semantic-review,
figure-comparison, semantic-figure-registration, figure-visual, and
preregistration records carry
SHA-256 digests.
Audit records are
sequenced and hash chained, with a separate head record that catches accidental
truncation. This is local tamper evidence, not external notarization. A user or
malware process able to rewrite the complete project can recompute the chain.

The lineage graph is derived on demand from those records and their existing
verifiers. Its digest covers sorted scope, nodes, edges, and findings, but not
the response timestamp. Missing cross-record targets become invalid placeholder
nodes, and project verification fails when lineage integrity has errors. This
does not add an external trust anchor. Semantic-review nodes add bounded
consistency traces, but do not prove agreement between a claim and its source,
code, number, or figure.

Experiment verification recalculates deterministic reviewer values and
cross-checks the immutable plan, aggregate rows, child links, child simulation
manifests, artifact hashes, and audit events. Passing integrity verification
does not mean a hypothesis was supported or a numerical method was valid.

## Hypothesis-tree campaigns and local-user verdicts

Campaign plans are strict, byte-bounded, secret-scanned, immutable records.
Their event directories accept only sequenced exclusive writes under a lock;
each event binds the previous event hash, the head binds the latest sequence
and digest, and audit records bind plan creation plus event publication.
Verification replays tree relations, task dependencies, checkpoint/attempt
semantics, execution tokens, completed-task assessment links, branch and
global budgets, supersession, and final-verdict freshness.

Campaign execution is deliberately serialized one task at a time. High-risk
tasks require a checkpoint; physical execution and AI nondisclosure cannot be
enabled. Per-branch and global attempt/GPU/NPU/wall-clock ceilings limit
workflow amplification. They do not reserve an accelerator, stop activity
outside the owned task, validate scientific code, or contain filesystem,
subprocess, credential, or network access. The recorded network setting is
prompt policy, not a firewall, container, or VM.

The assessment route and CLI record a declared local-user action. The bundled
Scientist is instructed not to submit it and its canonical CLI patterns are
denied. These controls prevent compliant agent workflow from silently
adjudicating itself, but they do not authenticate the operator or stop another
local process, modified agent, direct module caller, or user with filesystem
access. The `ai_generated: false` field records the submission boundary; it is
not cryptographic proof of authorship. Local hashes remain recomputable by an
attacker who controls the whole project.

Assessment currentness is derived rather than trusted. A new assessment
supersedes an older event without deletion. If a relevant task completes or
is skipped later, the prior verdict becomes stale and an active settled branch
cannot complete until a fresh assessment is recorded. This guards against
accidental post-result mismatch; it does not establish that the verdict, task
basis, statistics, or causal interpretation is scientifically correct.

## Project notebook kernels

Notebook source is arbitrary executable code and runs with the user's OS
permissions. ScienceCode secret-scans and bounds a cell before creating its
record, removes inherited Python virtual-environment and startup variables,
disables interactive stdin, uses a private child-process protocol rather than a
network listener, bounds captured representations and artifacts, and terminates
the worker on timeout or interrupt. These controls reduce accidental exposure
and provide a failure boundary; they do not prevent filesystem, network,
subprocess, database, or GPU actions performed by the cell.

Every attempted cell is immutable and hash-linked. A failed, timed-out, or
interrupted cell is retained and fails the default project gate. After a Lab or
CLI process exits, ScienceCode never silently rebuilds interpreter state. An
explicit restore verifies completed history and then re-executes its source in
order. Verification does not make replay side-effect free: review prior code
before restore because file writes, service calls, and external mutations can
occur again. Histories containing a non-completed or invalid cell are refused.

The worker does not rely on Python audit hooks for containment; Python's own
documentation states that Python-level hooks are not a sandbox. R uses the same
project and OS trust boundary. Use a dedicated low-privilege account or an
external container/VM when untrusted code requires real containment.

## Scientific code and GPU execution

Simulation scripts are executable code and run with the user's OS permissions.
ScienceCode isolates Python packages and records execution, but it does not
place code inside an OS container, VM, or restricted account. Inspect model-written code and dependencies,
declare inputs, start with bounded workloads, and do not terminate unrelated
GPU processes. Experiment matrices are capped at 64 and execute sequentially
to limit accidental resource amplification.

Generated artifacts may contain sensitive source data. Artifact and transcript
reads in the workbench are manifest-bound, but anyone with local filesystem
access may still read project records directly.

## Product evaluation boundary

`sciencecode evaluate` uses only packaged labeled fixtures and packaged source
contracts. It does not send prompts, call a provider, use the network, inspect
the current research project, or persist an evaluation record. Citation cases
create a fresh OS-temporary project, ingest one fixed non-sensitive text
fixture, and remove only that owned directory after both evaluation passes.
Temporary paths and randomized evidence identifiers are excluded from the
report.

Bound product sources are fixed project-package paths. Each must resolve to a
regular non-link UTF-8 file inside the real package root and remain unchanged
during a bounded read; individual files above 1 MiB fail closed. The report
records newline-normalized hashes, rereads every binding between two complete
executions, and fails on missing, linked, oversized, non-UTF-8, moving, or
policy-drifted sources. This detects accidental or local prompt/implementation
drift; it is not a signature, supply-chain attestation, sandbox, or protection
against an attacker who can modify both the package and evaluator.

Safety and role checks establish that declared guardrail text and permission
separation are present. They do not prove that a model will obey text, that a
tool runtime enforces every policy, or that scientific output is safe or valid.
Fixture precision/recall must never be represented as external performance.

## Governed external benchmark boundary

External benchmark bundles are untrusted local data. ScienceCode accepts only
a strict schema-v1 manifest and separate UTF-8 case, label, and run files with
fixed counts and SHA-256 bindings. Manifest references use portable relative
paths and must traverse existing non-link directories to regular files whose
real paths remain under the real bundle root. Stable reads compare file
identity before and after access. The manifest is capped at 1 MiB, case data at
64 MiB and 50,000 records, label/run data at 32 MiB, individual case text at
64 KiB, and published baselines at eight. Unknown fields, invalid encodings,
moving files, traversal, links/junctions, hash drift, duplicate or missing case
IDs, undeclared labels, and degenerate one-class labels fail closed.

`sciencecode benchmark inspect` and `benchmark predict` deliberately do not
resolve, stat, or open label and baseline files. Prediction calls only the
deterministic local claim extractor, performs no provider or network request,
and is rejected outside the manifest's declared corpus-freeze/label-unseal
window. Generated run files contain no case text, are restricted to the current
working directory, and use exclusive creation rather than overwrite. Scoring
validates candidate and baseline runs before checking the schedule and does not
open expert labels until the declared unseal time. Score reports omit raw input
text and absolute local paths, but intentionally disclose unsealed labels,
predictions, system/method metadata, and governance statements for external
review. Do not put secrets, participant data, or restricted material in a
benchmark bundle or its metadata.

These controls make file separation, declared timing, hashes, abstentions,
metrics, and baseline comparisons auditable. They do not authenticate the
creator or labelers, prove expertise or independence, establish that labels
were actually hidden, provide a trusted timestamp, protect files from another
local process, or make expert labels scientifically true. Wilson intervals are
conditional on the submitted fixed corpus and are not evidence of sampling
representativeness. An attacker able to replace a manifest and every bound file
can forge a self-consistent bundle. The external workflow never replaces or
weakens the packaged `sciencecode evaluate` gate.

## CAD, model, and slicer execution

OpenSCAD files are programs, CadQuery sources and Python model scripts are
executable code, CAD assets are parser inputs, and G-code is physical
machine-control data. ScienceCode does not treat any of them as passive or
inherently safe.

Each CAD environment has an immutable normalized descriptor and a bounded
allowlist of declared files. Paths must be relative regular files within the
environment; realpath checks reject links and escapes. OpenSCAD include, use,
import, and surface references must be static and declared. Absolute paths,
dot/parent segments, dynamic references, undeclared files, secrets, individual
files over 16 MiB, aggregate trees over 64 MiB, more than 256 files, and more
than 512 parts are rejected before tool execution. This scanner is a strict
preflight, not a complete OpenSCAD language sandbox. A pathological but
syntactically allowed model can still consume CPU or memory until the bounded
tool timeout ends it. CadQuery source is not covered by that static-reference
claim: imports and arbitrary Python behavior cannot be fully preflighted.

Builds copy the entire declared source set into a new immutable record before
tool execution. OpenSCAD receives no interactive input. CadQuery uses a pinned,
definition-hashed ScienceCode virtual environment. The manifest, packaged
definition, and installed adapter/requirements must match before the adapter
runs with isolated Python and bytecode writes disabled. It can nevertheless read or write
anything the user account can access, open network connections, import installed
packages, or launch child processes; ScienceCode does not claim an OS, network,
or Python capability sandbox. Run only reviewed CadQuery source in an
appropriately restricted user/container environment.

Tool output is bounded and redacted, and every emitted STL, STEP, report, and
supporting file must appear in the final manifest. After either engine exits,
ScienceCode rehashes the entire declared source snapshot and fails the build if
a file was added, removed, or changed. That prevents publication from silently
mutated inputs; it does not undo external side effects. Mesh analysis caps input
bytes and triangle count. Record verification rejects missing, changed, linked,
or unexpected artifacts and rechecks the project audit link.

CAD-linked CPU/GPU model scripts run through the existing arbitrary-code
simulation boundary with the user's OS permissions. The verified STL is
automatically recorded as an input, and the simulation carries the exact CAD
build-manifest and mesh hashes. That prevents silent parent substitution; it
does not validate equations, material properties, loads, boundary conditions,
solver stability, convergence, or scientific interpretation.

The Lab can install a packaged CAD simulation only by its known template name
at a fixed project-relative destination. The same-origin JSON request has a
strict field allowlist. An existing exact regular file is reused and audited;
a differing file is never replaced. This prevents a template request from
becoming a general write primitive, but the installed Python remains executable
scientific code at the normal user-permission boundary.

The packaged surface-thermal model independently caps STL bytes, unique
vertices, triangles, and edges; rejects unknown or non-finite parameters;
requires separated nonempty face-band boundaries; counts connected components;
and refuses an explicit step above its stability limit. It records finite,
boundary-pinning, and maximum-principle checks and writes bounded summary,
history, and scalar PLY artifacts. Those controls catch defined input and
numerical-integrity failures. They do not establish a material model, mesh
convergence, volumetric heat transfer, physical accuracy, or safe operating
temperature.

The Lab model route allowlists and bounds the script, input list, parameter
names/JSON, script arguments, seed, device, timeout, and free-memory reserve.
Only one CAD operation per project runs at once. Immediately before auto/CUDA
dispatch, the Lab refreshes the selected NVIDIA device and refuses launch when
free memory is unknown or below the requested reserve (2,048 MiB by default).
This is denial-of-service mitigation, not a GPU allocation or guarantee:
another process can consume memory after the probe.

Preview slicing uses an isolated data directory and requests no extrusion and
zero temperature. ScienceCode parses the complete bounded output for positive
extrusion, heater, homing/leveling, spindle, fan, coordinate, and mode
indicators. Printer-profile mode requires an explicit acknowledgement because a
profile can intentionally generate physical commands. Profiles are
project-confined regular files and any nonempty post-process setting is
rejected. No route uploads, transmits, streams, schedules, or executes G-code
over a network, USB, serial port, or printer API. Saving or accepting a G-code
revision also does not grant execution permission.

Lab CAD build, screen, and slice jobs execute in dedicated child processes with
bounded requests and results. The browser cannot interrupt those tools halfway
through immutable finalization; the worker records success or failure before
releasing the project. CAD-linked models use the asynchronous simulation path.
A stop request must match the exact project, build, and chat binding, terminates
the owned process tree, and still archives bounded logs, snapshots, partial
artifacts, a cancellation reason, final digest, and audit event. Cancelled
models fail the default outcome gate. Process isolation, termination, memory
checks, and timeouts improve containment and observability but are not an OS
sandbox.

The live activity trace deliberately receives only an allowlisted projection
of engine events: tool name, title, status, call ID, and timing. Tool inputs and
outputs are excluded because they can contain credentials, private datasets,
or large derived results. Full redacted event records remain in the run
archive.

The ephemeral job response separately exposes completed assistant text parts,
never tool payloads. Response text is re-redacted and control-character cleaned
at the Lab boundary, capped at 8 KiB per part, stripped from the activity-event
copy, and retained in a rolling 32-block/48-KiB window with explicit omission
metadata. The verified transcript remains authoritative after completion.

Browser edits do not replace archived artifacts. Shared code drafts, table cell
changes, plot views/selections/directions, figure views/annotations, semantic
figure registrations, decoded-pixel figure validations, 3D state,
chemical molecule/atom state, genomic regions/features, manuscript diffs,
analysis contract/assessment focus, procedure step/gate/finding/adapter/decision
focus, scalar-field ranges and selected values, board directions, and selected lineage
traces are appended to a SHA-256-linked interaction record with
matching audit events. This is tamper
evidence, not access control, and user-authored code still requires review before
execution. Payloads and artifact labels are secret-scanned, individual records
are capped at 48 KiB, and each conversation log stops accepting records after
10,000 entries or 32 MiB. Browser-visible asynchronous failures pass through the
same credential redaction used for archived engine output.

Chemical, genomic, and manuscript artifacts are parsed only after the normal
manifest/realpath checks and only by package-local browser modules. The Lab
does not load a CDN renderer or send these files to a third party. Chemistry is
bounded to 128 molecules, 5,000 atoms, and 10,000 bonds and deliberately omits
chemical execution, valence certification, canonicalization, and
stereochemical inference. Genomic parsing is bounded to 50,000 features,
10,000 contigs, and 5,000,000 retained sequence characters; it does not parse
compressed/indexed data or execute embedded directives. Manuscript diffing is
bounded to 20,000 lines per side and 1,500,000 exact comparison cells, with an
explicit coarse fallback. Canvas labels use text APIs and DOM text nodes rather
than artifact-controlled HTML. Applying source edits affects only the local
view; complete persistence still uses the revision preflight below.

Code, CSV/TSV, workbook, chemical/genomic source, and manuscript edits can
optionally be persisted as a new
artifact revision. The source URL must resolve through a normal record verifier;
the source and replacement digests are frozen in an exclusive immutable
manifest, and optional prior-version links include both manifest and artifact
hashes. Replacement bytes are capped at 8 MiB, ancestry at 256, text and notes
are secret-scanned, binary transport requires canonical base64, and artifact
reads re-run complete revision verification. Accept/reject records append to a
separately locked hash chain with matching audit events. These checks prove
record integrity and review history, not that accepted content is scientifically
correct, non-malicious, or safe to execute or open.

## Server modes

`sciencecode web` and `sciencecode serve` default to the local engine. Keep the
listener on `127.0.0.1` unless remote access is intentional. Configure a strong
`OPENCODE_SERVER_PASSWORD` and network-layer controls before exposing it.

`sciencecode lab` is stricter about network exposure: it accepts only
loopback host values and sends CSP and related security headers. Its narrow
POST surface can create a conversation, ingest a project-contained evidence
source, create or decide an artifact revision, create an immutable semantic
review, figure comparison, semantic figure registration, or decoded-pixel
figure validation, create an analysis
contract or confirmatory assessment, create a
procedure plan, logical assessment, or scoped human decision, execute a
recorded research turn, bounded ONNX inference, CAD source revision,
OpenSCAD/CadQuery build, geometry screen, packaged simulation-template install,
CAD-linked model, slice, or notebook cell, control an owned kernel, or append an
interaction to an existing conversation. It can also queue a read-only full
project gate, create an immutable project baseline, or queue a read-only
snapshot comparison. Those requests
require JSON,
a loopback Host, same-origin Origin and Sec-Fetch-Site values when present,
bounded bodies, secret preflight, one active turn per conversation, and one
active accelerator inference per Lab process. Inference requests accept only a
fixed field allowlist and bounded ranges; model/input paths are canonicalized
inside the project before a record is created. Public jobs omit the user note,
model bytes, inputs, logs, and raw worker output. Cancellation is bound to the
job kind and linked chat and can terminate only the Lab-owned worker.
Reusable loopback connections have a finite 65-second keep-alive timeout and a
70-second header timeout so long local verification does not race the next
meaningful request without permitting unbounded idle or partial-header state.
Transcript, artifact, and evidence reads resolve real paths inside record roots
and expose only manifest-named files. Async jobs, event lists, and live response
windows are process-local, bounded, and disappear when the Lab process exits.
Inference completion/failure/cancellation persists through the normal
immutable manifest, artifact, audit, and project-gate path; the in-memory job
is not evidence. The Lab owns its kernel, inference, project-gate, and snapshot
workers; server shutdown terminates live workers and releases project locks. A killed host process
can leave a stale lock, which is recovered only after its recorded process is
no longer live.

The Lab project gate reuses the CLI's authoritative verifier in a separate
owned process so large synchronous checks do not block the HTTP event loop.
Only one may run at a time. Its request contains eight allowlisted boolean
failed-outcome choices and no integrity override. Runtime and combined output
are bounded; cancellation is exact-kind bound; shutdown aborts the child. The
browser report redacts secrets, retains at most 128 findings and 12 KiB per
diagnostic body, and explicitly reports omissions and truncation. `/api/state` exposes
only a compact latest-job summary. The complete bounded job report is
process-local, disappears with the Lab, and is not an immutable audit record or
proof of scientific correctness.

The Lab snapshot lifecycle also runs synchronous walking, hashing, and
comparison in an owned child process, with one active snapshot operation,
five-minute runtime, 4 MiB combined output, 100,000 captured entries, 16 GiB of
declared bytes, and a 32 MiB manifest. Create and verification bodies are exact
allowlists; cancellation must match kind, snapshot ID, and operation. The
managed registry is capped at 1,024 records for whole-project verification and
returns at most 256 summaries to the browser. Reports retain at most 128
secret-redacted findings and 12 KiB per finding, disclose omissions, and keep
complete findings only in process-local job detail. Exact manifest downloads
are local and may reveal project filenames, symlink targets, sizes, and hashes;
treat them with the same confidentiality as the project. Snapshot integrity
proves local byte/audit consistency, not the correctness, completeness,
authorship, or scientific meaning of captured content.

`/api/lineage` is read-only but can be computationally heavier than a normal
state read because it re-verifies project records. Graph size, traversal, and
interaction payloads are bounded. It exposes record labels, IDs, hashes, and
selected metadata to the local browser, so the same local-project
confidentiality assumptions as transcript and artifact views apply.

Drug-discovery and procedure artifacts are not execution authorization. The
bundled workflow requires unresolved chemical/biological/clinical/equipment
hazards, validation or dry-run evidence, and named human approval to remain
visible before any physical work. Procedure Studio 0.15 records only a local
attestation over exact plan and assessment digests. ScienceCode does not verify
the reviewer or operate, schedule, or authorize laboratory hardware.

Chat agents can execute tools and modify project files with the user's OS
permissions. The workbench is therefore not a read-only viewer or a sandbox.
Keep it on loopback, review agent outputs and file changes, preserve backups,
and do not weaken the bundled permission rules. It is not designed for remote
exposure.

## Vulnerability reports

Do not include live credentials, private research data, or unpublished
participant information in a report. Provide a minimal reproduction, affected
ScienceCode/engine versions, operating system, impact, and suggested embargo
needs through the repository's private security-reporting channel when one is
configured.
