# Security threat model

## Assets

Unpublished research, participant data, datasets, provider credentials,
prompts/outputs, source code, preregistrations, run records, citations,
statistical results, project snapshot manifests, CAD source trees, rendered meshes and STEP exports, model
inputs, scalar simulation fields and histories, slicer profiles, G-code,
archived work, and ScienceCode engine state.

## Trust boundaries

- user and research project
- ScienceCode CLI/provenance process
- package-local OpenCode engine process
- isolated Python/CUDA compute runtime, simulation processes, and persistent
  project-owned Python/R kernel workers
- OpenSCAD, isolated CadQuery adapter, mesh parser, CAD worker, and PrusaSlicer
  process boundary
- packaged CAD surface-model process and bounded scalar-artifact parser
- loopback-only ScienceCode Research Workbench and chat routes
- package-local full-project verification worker and bounded Lab gate report
- package-local project-snapshot worker, pending/commit boundary, managed
  registry, exact manifest download, and bounded Lab drift report
- `SCIENCECODE_HOME`
- model provider and network
- MCP/tool/database services
- local interpreters, containers, notebooks, and HPC systems
- package registry and release pipeline
- filesystem, backups, and future control plane

The user's separate OpenCode installation and state are explicitly outside the
ScienceCode boundary.

## Priority threats

- prompt, retrieved-content, tool, or MCP injection
- credential or sensitive-data exfiltration
- accidental loading of user OpenCode config/auth/plugins
- malicious engine/dependency/update supply chain
- malicious or malformed PDF parser input and oversized evidence corpora
- pathological project trees, oversized snapshot manifests, unsafe snapshot
  registries, pending-file substitution, manifest tamper, or forged bindings
- destructive shell, code, file, Git, or notebook actions
- model-written scientific code execution, GPU denial of service, or runaway matrices
- malicious or pathological SCAD/CAD parser inputs, arbitrary CadQuery Python,
  dynamic or escaping file references, declared-source mutation during build,
  render denial of service, forged mesh/STEP/model parent links, slicer
  profile command injection, post-process execution, or unsafe G-code being
  mistaken for printer authorization; cross-build CAD model cancellation,
  orphaned solver processes, partial-record ambiguity, GPU-memory crowding,
  malformed surface-model parameters or scalar PLY properties, numerical
  instability, boundary collapse, mesh amplification, or a surface diffusion
  result being misrepresented as volumetric thermal FEA; CAD study matrix
  amplification, mixed-build branches, forged aggregates, parent drift, or
  interruption leaving an ambiguous partial experiment
- malformed or adversarial ONNX models/inputs, NPU denial of service, provider-
  attribution spoofing, silent CPU fallback, concurrent accelerator jobs, or
  cancellation of a job from the wrong browser/chat binding
- notebook replay side effects, runaway cells, stale/forged kernel locks,
  cross-chat state disclosure, or worker/process orphaning
- artifact traversal, symlink escape, unrecorded-file access, or local Lab exposure
- drive-by browser requests, DNS rebinding, cross-origin prompt execution, or
  concurrent turns against the same conversation
- user-interaction spoofing, oversized editor payloads, unsafe draft execution,
  or leaking tool inputs/outputs through a progress UI
- malformed or amplifying SMILES/SDF/genomic/manuscript inputs, coordinate
  confusion, artifact-label injection, or unsupported scientific inference
- lineage-link spoofing, graph amplification, stale graph selection, or hidden
  omission of an invalid/missing upstream record
- project-gate event-loop denial, concurrent gate amplification, oversized or
  secret-bearing diagnostics, outcome-policy confusion, mismatched
  cancellation, or a compact state response accidentally exposing full details
- revision-source spoofing, oversized or malicious binary replacements,
  forged prior-version ancestry, decision-chain tampering, or deletion hidden
  by directory enumeration
- malicious or oversized manuscripts causing extraction amplification; forged
  citation/span/DOI locators; arithmetic-parser abuse; external or untracked
  figure substitution; and misleading lexical-overlap or literal-number signals
- forged semantic-figure sidecars; PNG/table substitution; ambiguous or
  oversized CSV/TSV; duplicate headers/x values; malformed, non-finite, or
  dimensionally incompatible selected cells; sampling/order drift; replay-hash
  tampering; or a self-consistent sidecar being misrepresented as proof of
  rendered pixels
- post-hoc or deceptive visual profiles; plot-rectangle/domain/color remapping;
  near-collision palettes; missing/undersized/shifted axes or marks; extra
  same-color marks; transparent-pixel confusion; PNG/semantic-parent/report
  substitution or deletion; sample/pixel/registry amplification; unsafe record
  links; and a constrained passing result being described as OCR, renderer
  certification, prospective evidence, or scientific validity
- benchmark gaming, fixture overfitting, stale or weakened safety prompts,
  reviewer/author role collapse, missing or linked evaluation sources, source
  mutation between passes, nondeterministic reports, or bounded fixture metrics
  being misrepresented as external scientific accuracy
- external benchmark label leakage; forged independence/expertise/blinding or
  freeze/unseal statements; swapped case, label, candidate, or baseline files;
  missing/duplicate predictions hidden as coverage; linked bundle escapes;
  baseline impersonation; post-hoc threshold changes; and conditional Wilson
  intervals being misrepresented as population validity
- provenance or preregistration tampering/truncation
- poisoned or fabricated scientific sources
- evidence prompt injection, retrieval manipulation, or raw-query disclosure
- invalid statistical inference, leakage, selective reporting, or unit errors
- post-hoc primary-outcome or threshold changes; forged preregistration,
  script, experiment, or assessment links; hidden missing branches; impossible
  record timing; or conflating a threshold pass with prospective registration
- malicious or malformed procedure graphs; forged evidence, supersession,
  assessment, or decision links; hidden record deletion; stale/expired approval;
  unverified reviewer identity; unsafe hazard-control claims; or treating a
  non-executable XDL/Opentrons mapping as a hardware command
- malformed or cyclic hypothesis trees; forged checkpoint, task, or assessment
  events; stale verdicts presented as final; assessment links to unrelated or
  incomplete tasks; AI self-adjudication; automatic branch pruning; budget
  bypass; branch amplification; or prompt-only network policy presented as
  enforced containment
- unauthorized sharing, publication, server exposure, or external writes
- sensitive-data retention beyond research or legal policy
- future cross-tenant leakage

## Current mitigations

- exact package-local engine resolution with no global fallback
- isolated engine state and final ScienceCode config overlay
- default sharing disabled
- secret preflight and captured-output redaction
- project-root path containment and exclusive artifact creation
- bounded exact-pinned PDF.js extraction with dynamic evaluation disabled;
  immutable source/page/span manifests and no OCR or active-content execution
- a versioned offline product-evaluation suite with fixed labeled reviewer,
  citation, numerical, safety, and role contracts; exact 1.0 fixture thresholds;
  bounded contained regular UTF-8 source reads; normalized source hashes; two
  complete executions and binding reads; deterministic fingerprints; isolated
  temporary evidence cleanup; nonzero failure status; CI integration; and
  explicit no-generalization/no-containment limitations
- a separate governed held-out benchmark workflow with input-only inspection,
  pre-unseal production predictions, exclusive run creation, post-unseal label
  access, strict schemas and prospective thresholds, stable bounded UTF-8 reads,
  realpath/link containment, exact case/label/run/baseline hashes and coverage,
  explicit abstentions, two-class enforcement, 95% Wilson intervals, paired
  baseline counts, deterministic case-level reports without raw text or local
  paths, and explicit self-attestation/no-replacement limitations
- before/after hashes and classified file changes
- sequenced hash-chain plus head consistency checks
- preregistration freeze and independent review protocols
- bounded sequential experiment matrices and deterministic aggregate review
- optional experiment CAD parents copied exactly into immutable plan/manifest,
  start/finish audit, and every child; shared 64-branch Cartesian bounds;
  strict/secret-scanned/size-bounded study requests; verified child and parent
  replay; recorder-side nested thermal-statistic extraction; fresh CUDA VRAM
  refusal; per-branch and 24-hour whole-matrix bounds; exact
  job/operation/project/build/chat
  cancellation binding; AbortSignal-owned active simulation termination;
  immutable cancelled-branch and explicit undispatched-branch rows; recomputed
  review, manifest, audit, verification, and failed-outcome gate; direct
  mesh-hashed lineage; and explicit sensitivity-not-FEA labeling
- strict versioned campaign normalization; earlier-parent tree and task-DAG
  checks; immutable plan plus locked hash-chained event/head replay; task
  execution tokens; one-task dispatch; global and per-branch attempt/GPU/NPU/
  wall-clock gates; explicit checkpoints; disabled automatic pruning;
  completed-task/hypothesis assessment links; superseding local-user verdicts;
  event-sequence stale-verdict detection; schema-v1 replay; canonical
  Scientist assessment-command denial; and Lab/harness/lineage/project-gate
  visibility
- bounded project-confined ONNX inference with realpath containment, strict
  profiled-provider attribution, explicit fallback, one active Lab inference,
  AbortSignal-owned worker termination, immutable partial cancellation records,
  and separate hash-chained AI interaction links
- normalized immutable CAD contracts; declared-file, extension, count, byte,
  secret, realpath, regular-file, static-reference, and descriptor-digest
  checks; conflict-safe SCAD/Python revision chains; source-snapshot OpenSCAD
  builds; pinned definition-hashed isolated CadQuery adapter builds with
  deterministic STL/STEP export and post-execution source-snapshot comparison;
  bounded mesh/G-code parsing; exact artifact and audit verification; verified
  CAD parents for recorded CPU/GPU models; strict Lab model schemas and
  project/build/chat cancellation binding; owned-process-tree termination;
  verified cancelled partial records and failed-outcome gates; refreshed
  free-VRAM dispatch checks; isolated slicer data; explicit printer-profile
  acknowledgement; post-process rejection; and no printer transport or
  execution route
- fixed-name/fixed-destination same-origin CAD template installation with strict
  request fields, exact-byte reuse, conflict refusal, and no caller-selected
  write path; bounded immutable-STL surface graph construction; strict finite
  parameter and mesh ceilings; separated nonempty boundary bands; explicit
  diffusion-stability refusal; recorded finite, pinning, and maximum-principle
  checks; manifest-bound summary/history/temperature PLY outputs; property-aware
  bounded scalar parsing; hash-chained scalar range/value interaction context;
  and explicit non-volumetric/non-FEA classification
- strict normalized analysis contracts with frozen preregistration/script
  digests, prospective experiment binding, exact branch filters, missingness and
  threshold rules, schema-versioned registered units, bounded explicit compound
  parsing, typed quantities, dimensional/affine conversion, unit-engine binding,
  deterministic whole-assessment replay, separate registration and outcome
  status, disclosed deviations, audit-backed deletion discovery, exclusive
  atomic publication, and storage-root/link containment
- strict bounded procedure normalization, mandatory external-human-control
  policy, exclusive atomic plan/assessment/decision publication, evidence and
  supersession digests, deterministic whole-assessment replay, graph/reference/
  hazard/control gates, non-executable adapter output, audit-backed deletion
  discovery, realpath/link containment, explicit decision attestation and
  bounded expiry, currentness derivation, unverified-identity labeling, and
  permanent physical-execution disablement
- loopback-only workbench with CSP, same-origin JSON mutation checks, bounded
  requests, per-conversation turn serialization, single accelerator-job
  serialization, cancellation binding, and manifest/realpath containment
- one active full-project gate in an owned cancellable process; exact canonical
  boolean policy; no integrity override; worker time/output limits; redacted
  128-finding and 12-KiB-detail projection; explicit truncation; deterministic
  report fingerprint; and compact state versus full bounded job separation
- one active snapshot operation in an owned cancellable process; authoritative
  hashing/comparison reuse; entry/declared-byte/manifest/runtime/output bounds;
  job-bound pending names; independent pre-commit rehash; exclusive publish;
  exact audit bindings; safe normal-file/directory containment; strict
  kind/ID/operation cancellation; pending cleanup; bounded registry/list and
  secret-redacted findings; deterministic fingerprints; exact local download;
  compact state; and non-waivable snapshot-record project-gate verification
- allowlisted live tool metadata that excludes tool inputs and outputs, plus
  independently redacted and bounded assistant response blocks with
  process-local job/event retention
- hash-linked conversation turns with reciprocal run links and project-gate
  verification
- read-only deterministic lineage derived through normal record verifiers,
  explicit missing-link nodes, bounded graph/traversal size, stable graph
  digests, conversation-component scoping, and project-gate integration
- canonical manifest-bound revision sources, exact source/replacement/prior
  hashes, exclusive staging and atomic publication, bounded text/base64 bytes
  and ancestry, secret preflight, realpath containment, append-only locked
  decisions, audit-backed missing-record discovery, AI status disclosure, and
  fail-closed project/lineage verification
- canonical immutable review targets; UTF-8, extension, source/report, claim,
  finding, and record bounds; secret preflight; a non-evaluating finite
  arithmetic grammar; verified evidence/span/page/ingested-DOI resolution;
  no external artifact fetch; exclusive atomic report publication; deterministic
  report replay; audit-backed discovery; read-only critic permissions; and
  explicit triage-not-entailment labels
- three-way manifest-bound semantic-figure inputs; supported-PNG validation;
  strict bounded UTF-8 CSV/TSV parsing; normalized unique headers and exact row
  width; finite-decimal, unit-compatibility/conversion, log-domain, missing,
  duplicate, order, and sampling checks; versioned source-row/converted-value
  digests; exact sidecar/contract/replay comparison; exclusive atomic copies;
  audit-backed discovery; deterministic whole-report replay; Lab/CLI/API/
  lineage/project-gate coverage; and explicit sidecar-not-pixel-proof labeling
- matched-parent-only decoded-pixel validation; exact parent manifest/report/
  PNG/source/contract/replay binding; strict size/order/domain/palette/style/
  threshold profile normalization; bounded alpha-composited PNG decode;
  independent converted-point projection; separate axis/line/marker position
  and pixel-support checks; unexpected-series/background rules; four-million-
  pixel, 4,096-point, one-million-sample, file, and 10,000-record ceilings;
  exclusive atomic publication; link/realpath rejection; audit-backed deletion
  discovery; deterministic replay; Lab/CLI/API/AI/harness/lineage/gate coverage;
  and explicit user-profile/no-OCR/no-scientific-proof labeling
- versioned deterministic retrieval, raw-query digests, historical-corpus
  replay, cited-span verification, and JSONL-quoted untrusted evidence context
- secret-scanned, payload-bounded, hash-chained user interaction records with
  audit links and transcript context cross-checks
- manifest-bound package-local scientific parsers with molecule/atom/bond,
  contig/feature/sequence, line/diff-cell, rendered-feature, and AI-payload
  ceilings; DOM/canvas text rendering; explicit coordinate normalization and
  coarse-diff disclosure; no active content, CDN, or automatic draft execution
- private stdin/file kernel transport, one-owner project locks, explicit
  restore/clean-start choice, completed-only verified replay, monotonic immutable
  cell chains, bounded streams/results/figures, timeout/interrupt termination,
  chat-link validation, exact notebook-context verification, failed-cell gates,
  and server-close worker cleanup
- explicit design-only physical-work policy with safety, dry-run/validation,
  instrument-compatibility, and named-human-approval gates
- pinned compute requirements, runtime manifests, deterministic seeds, and GPU probes
- destructive-command guardrails and explicit preservation instructions
- real-engine compatibility tests, dependency lockfile, and cross-platform CI

## Residual risk

The engine, CadQuery source, notebook kernels, and spawned scientific tools run
with the user's OS permissions. CadQuery runtime isolation is dependency/state
isolation, not a filesystem, process, or network sandbox.
Local hashes have no external trust anchor. Content-level scientific errors are
not eliminated by workflow prompts, the semantic reviewer, confirmatory
threshold replay, or procedure logical dry-runs. An attacker can make wording and numbers superficially
overlap. ScienceCode does not validate statistical assumptions, sampling
uncertainty, multiplicity methods, whether declared units match what code truly
measured, physical plausibility, scientific scope, causal identification,
clinical relevance, or figure pixels against a rerun. Semantic figure
registration proves only that a producer declaration agrees with exact inputs
and ScienceCode's tabular replay; it cannot prove that a renderer drew those
declared values, axes, labels, or marks. Decoded-pixel validation can detect a
narrow class of flat-color axis/line/scatter disagreement, but its plot bounds,
domains, palette, dimensions, tolerances, and thresholds are user-declared and
can be tuned post hoc. It does not read tick/legend text, establish prospective
independence, handle general chart grammar, prove hidden/overlapping marks, or
validate scientific meaning. The bounded unit engine
checks only registered syntax and declared dimensional compatibility; it is not
a domain ontology or measurement validator.
Environment credentials can be inherited.
Exact snapshot JSON exposes captured relative filenames, symlink targets,
sizes, and digests to the local downloader. A snapshot is neither a backup nor
an externally witnessed timestamp, and a privileged local actor can replace a
manifest plus the entire audit history consistently.
Network providers and tools have their own retention and security properties.
The current product has no centralized identity, policy, tenancy, or audit
service.
Campaign local-user verdicts are not authenticated, and a local process can
bypass the bundled agent's canonical command denial. Campaign network policy
is not enforced below the prompt/tool layer; untrusted tasks require an
external low-privilege account, container, or VM.
Procedure Studio cannot determine facility safety, validate a vendor protocol,
verify a reviewer, enforce training, or stop an external user from manually
copying a misleading mapping into another system.
Likewise, CAD integrity checks cannot validate design intent, material data,
loads, solver physics, numerical convergence, tolerances, support strategy,
printer firmware, machine condition, thermal behavior, operator competence, or
site safety. The surface-graph thermal template has no volume elements, material
database, contact, convection, radiation, phase-change, or adaptive-convergence
model. Its integrity, finite-value, boundary, maximum-principle, and explicit-
stability checks do not establish physical accuracy, a qualified temperature
limit, or thermal safety. The GPU-memory check is a point-in-time observation, not a
reservation or scheduler, so another process can allocate memory immediately
after it passes. A user can manually copy generated G-code into an external
printer outside the ScienceCode boundary.

The layered knowledge base verifies only its own structure: that no principle
depends on a layer above its own, that none claims more confidence than the
weakest principle it rests on, that axioms stay in mathematics, that every
principle derives back down to mathematics, and that each states scope, limits,
and a reference. Those checks establish internal soundness of the graph, not
the truth of any statement in it, the correctness of a citation, or the
currency of the science. The base is authored content and can be wrong or out
of date; it does not read the literature and is not updated by evidence
records. Biomolecular design gating is likewise procedural. ScienceCode cannot
verify an institutional biosafety approval, a containment level, a synthesis
provider's screening, an operator's training, or a jurisdiction's oversight
requirements, and it cannot detect that a design with a benign stated intent
would be harmful in use. The biosafety stage records that a screening claim was
made; a local actor can satisfy it with text alone, and sequence-level output
can be copied outside the ScienceCode boundary at any time.

## Before GA

Complete component-level STRIDE/data-flow review, signed reproducible builds,
SBOM/SCA policy, external penetration test, sandbox strategy, KMS integration,
managed identity/tenancy design, immutable audit export, incident response,
backup/restore exercises, provider privacy review, and scientific benchmark
validation.
