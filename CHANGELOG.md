# Changelog

## Unreleased

### Thirteenth-pass review fixes: the rank interval under-covered

- Fixed a systematic off-by-one in the distribution-free interval. It trimmed
  one order statistic too far at each end, so every reported interval was
  narrower than the region the test itself fails to reject, and coverage sat
  at 93.4-94.1% against a nominal 95% that should be conservative — the
  dangerous direction for an interval. Exhaustive test inversion now agrees on
  120 of 120 random samples, where the shipped version disagreed on 102, every
  one of them narrower. Monte-Carlo coverage is 94.6-96.9% across the exact
  and approximate regimes. The previous validation used two hand-picked
  examples that happened to match; the regression test now pins an inverted
  endpoint and checks that just outside it is rejected.
- `mann_whitney_u` accepted a preregistered `null_value`, echoed it into the
  record, and tested a shift of zero regardless — so the p-value, conclusion
  and pass/fail status could all be for a hypothesis nobody declared. The
  declared shift is now genuinely tested, and the reported location estimate
  stays absolute so it does not move when only the null moves.
- A rank interval no longer depends on the null being tested. It previously
  drew its null distribution from the test's post-shift, zero-filtered sample,
  so declaring a different null silently produced a different "95%" interval
  for the same data and the same estimator.
- A one-sided rank test now reports a one-sided interval, matching what the
  parametric path already did. A two-bounded interval beside a one-sided
  p-value let a reader invert the interval and reach a different decision than
  the test reported.
- The Mann-Whitney interval's normal approximation now applies the same tie
  correction the test itself uses, and the report prose no longer describes
  every inferential assessment as a replay of "t-tests".

### Preregisterable rank tests (statistics engine v5)

- `mann_whitney_u` and `wilcoxon_signed_rank` are now declarable in an
  analysis contract, so an analysis that cannot assume normality can be
  preregistered and frozen like any other. They reuse the existing
  `group_parameter` and `pair_parameter` machinery, so choosing one over its
  parametric counterpart changes only what is assumed, not how data are
  collected.
- Rank tests now report a distribution-free confidence interval for the
  location shift, obtained by trimming order statistics of the pairwise
  differences (Mann-Whitney) or Walsh averages (Wilcoxon), using the exact
  null distribution for small untied samples. A t interval would have imported
  precisely the assumption these tests exist to avoid. Both were validated by
  test inversion — computing the set of shifts the test does not reject — and
  the order-statistic intervals match those acceptance regions exactly.
- The confirmatory assessment reports `rank_biserial_correlation` for these
  outcomes instead of Cohen's d, and omits the t statistic they do not have.
  Contracts refuse an equivalence claim on a rank test, because comparing
  orderings cannot express a distance from a margin.

### Discoverability, cross-language validation, and the dose-response template

- Bumped the dose-response engine to v2 **before** anything persists a potency.
  Its semantics changed several times at v1 — convergence, direction, plateau
  coverage, and the search itself — and once a fit is frozen the recorded
  version is the only thing that can tell a replay which mathematics produced
  it. The engine version is asserted by the replay tripwire and carried on
  every fit, so a stored result is self-describing.
- `sciencecode potency` was invisible: absent from the top-level usage block
  and from the README entirely, reachable only by guessing its name. Both
  fixed, with the diagnostics documented — what a potency number hides matters
  as much as the number.
- Added `sciencecode stats ranktest`, exposing Mann-Whitney U and Wilcoxon
  signed-rank. They were fully implemented, tested, and exported, but had no
  product surface at all, so the one part of the engine that carries no
  normality assumption was the one part a user could not run. Documented
  alongside the parametric calculator, including what they estimate instead of
  a mean difference.
- Corrected the `stats` usage line, which advertised `[ttest|quantile|adjust]`
  and had never listed `tost`.
- Added `templates/simulations/dose-response.py`, following the repo's
  two-independent-solver convention: SciPy trust-region least squares against
  a derivative-free Nelder-Mead search on the same objective, so agreement is
  evidence rather than two runs of one algorithm. It recovers a declared
  ground-truth potency from a simulated serial dilution and reports
  cross-solver disagreement and recovery error on the log scale, where potency
  actually lives.
- The template doubles as a cross-language check on the JavaScript engine: on
  identical data the two agree on the fitted potency to nine significant
  figures.
- Removed three stale release tarballs from the repository root and corrected
  RELEASE-GATES.md, which still described the project as version 0.38.

### Twelfth-pass review fixes: the honesty flags now work

The dose-response optimizer itself reviewed clean — it matched or beat SciPy
on 372 of 384 synthetic curves — but the diagnostics that were the point of
the module did not.

- `converged` was set on "some iteration reduced cost at least once", which is
  true of essentially every fit: it reported `true` on 3000 of 3000 pure-noise
  datasets and never once reported `false`. It now requires the cost to have
  stopped moving over the final stretch of iterations, and a new
  `stopped_early` reports the singular-system and non-finite-step paths that
  previously exited the loop silently while still claiming success.
- `direction` was the starting guess and was never recomputed from the fit,
  contradicting the reported hill slope on roughly a fifth of hard fits. It is
  now read off the fitted plateaus. The hill sign alone is not sufficient: it
  flips meaning when the plateaus are ordered the other way. The model also has
  an exact symmetry — swapping plateaus and negating the slope gives the same
  curve — so results are canonicalized to a non-negative hill slope and stay
  comparable between fits.
- `plateau_coverage` was capped at 1, which reported the collapsed-fit
  signature (a curve spanning LESS than the data) as perfect coverage —
  exactly backwards. The ratio is now uncapped, and exceeding 1 sets
  `amplitude_below_observed_range` and disqualifies `plateaus_observed`.
- Added `fit_worse_than_mean` for a negative r-squared, where the curve
  explains the data worse than a flat line through their mean; zero is a
  principled boundary, not a chosen threshold. Added `saturated_design` for a
  model with as many free parameters as concentrations, which can pass through
  every point whether or not it is right — the only cases where the optimizer
  trailed SciPy were of exactly this shape.
- The direction heuristic is gone entirely. It reduced to comparing single
  endpoints on four and five point designs — the very thing its comment
  claimed to guard against — and landed the optimizer on mirrored solutions
  with invented plateaus. The fit now runs from both directions and keeps the
  lower-cost result.
- The fit is now invariant to the order the points are listed in. Accumulating
  the normal equations in input order made the result depend on it at the last
  few bits; a frozen record describes a dataset, not a particular listing.
- The interval reported `asymptotic_normal_approximation` while using a
  Student-t quantile, and `--bottom` was silently discarded under the
  four-parameter model. Both corrected.

### Drug discovery: dose-response and potency estimation

- Added `lib/pharmacology.js`, a deterministic dose-response engine. Until now
  `drug_discovery` was almost entirely a routing label: a workflow name, a
  campaign lane, a keyword classifier, and one control-pairing check, with a
  knowledge principle (`med.assay.dose_response`) that described potency in
  prose while nothing computed it. There was no curve fitting anywhere.
- `doseResponseFit` fits four- and three-parameter logistic models by
  Levenberg-Marquardt and reports the half-maximal concentration (IC50/EC50),
  Hill slope, plateaus, r-squared, and a confidence interval taken on the
  log10 concentration scale, where the estimator is far closer to symmetric.
  Cross-checked against SciPy 1.17.1 `curve_fit`: exactly-fitting cases agree
  to ~1e-10, and a noisy case agrees on residual sum of squares to nine
  decimals, confirming both reach the same optimum.
- The fit is bit-reproducible, which is what allows a potency to be frozen
  into a verifiable record: the starting estimate is derived from the data by
  a fixed rule, the Jacobian uses a fixed relative step, and the optimizer
  runs a fixed iteration count rather than "until converged". It is under the
  replay tripwire.
- It reports what a potency number alone hides. A four-parameter fit can
  invent a plateau the assay never reached and then report a confident
  midpoint between one measured and one imaginary asymptote — with an
  r-squared above 0.999. `plateau_coverage`, `lower_plateau_observed`, and
  `upper_plateau_observed` expose that, `extrapolated` flags a potency outside
  the concentrations tested, and `converged` reports a fit that never improved
  on its starting estimate. A flat response returns `no_response_range`
  instead of a meaningless number, and a zero concentration is refused with
  the reason: the model is logarithmic in dose, so a vehicle control belongs
  in the bottom plateau.
- Added `sciencecode potency fit`, which states plainly that potency is
  relative to the assay format and is neither an affinity nor a dose.
- Added `pM`, `pmol`, and `pg` to the bounded unit registry, so the
  concentration range real assays use round-trips through frozen records.

### Eleventh-pass review fixes: one-sided rank tests

- Fixed an anti-conservative one-sided p-value in both rank tests. The
  half-unit continuity correction was applied toward the null mean, which is
  correct only two-sided; one-sided it must always move the statistic against
  the alternative. Whenever the observed deviation opposed the alternative the
  statistic moved the wrong way by a full unit, understating the p-value. A
  476-case sweep against SciPy now matches on all three alternatives, where
  565 of 1626 one-sided cases previously disagreed. The tell was that two
  opposite one-sided p-values summed to exactly 1, which cannot hold under a
  discrete null with a continuity correction.
- The reported `location_shift` is now the absolute paired shift computed over
  every pair. It previously excluded the zero differences dropped by the test
  — which legitimately pull the median toward zero, so the estimate was
  overstated, by 3x in one worked case — and it subtracted the declared null,
  making a field named for the location shift report only what remained of it.
  The Mann-Whitney field was already absolute; the two now agree.
- Degenerate results keep the full result shape rather than omitting
  `rank_biserial`, so consumers and the replay tripwire see one shape.
- Strengthened the rank-engine tripwire, which did NOT change when the
  continuity bug was fixed: its cases were all two-sided or exact. It now
  covers one-sided normal approximation, dropped zeros, a nonzero null, and a
  degenerate result.

### Rank-based tests: inference without a normality assumption

- Added `mannWhitneyUTest` and `wilcoxonSignedRankTest` to the statistics
  engine. Every test in the engine until now assumed approximate normality —
  stated in the README as an assumption, never checked. These use only the
  ordering of the observations, so a skewed or heavy-tailed outcome can be
  tested without pretending it is Gaussian. They test a shift in location,
  not a difference in means, and report that distinction.
- Small samples without ties use the exact null distribution — integer
  dynamic programs over the Mann-Whitney recurrence and over signed-rank
  subset sums — rather than a normal approximation. Ties or larger samples
  fall back to the tie-corrected normal approximation with a continuity
  correction, and the record says which was used. The exact-size bound is a
  frozen part of the engine, not a tuning knob: changing it changes p-values.
- Both report a Hodges-Lehmann location shift, the estimator these tests
  actually invert, and a rank-biserial correlation as a distribution-free
  effect size. Wilcoxon reports dropped zero differences rather than hiding
  a changed effective sample size.
- Added a standard normal CDF built on the incomplete gamma function, so far
  tail probabilities keep their significant digits instead of losing them to
  cancellation: it is accurate to ~1e-14 out to z = -8, where a naive
  1 - CDF(z) implementation has none left.
- All eight worked cases were cross-checked against SciPy 1.17.1 and agree to
  ~1e-15, the exact cases bit-identically, including tie and continuity
  corrections. The rank engine is under the replay tripwire from the start.

### Tenth-pass review fixes: settings must mean what they say

- Retrieval settings are now pinned by digest, not just by version number.
  Previously a record could be frozen under arbitrary BM25 parameters while
  claiming `version: 1`, and both `verifyEvidenceRetrieval` and
  `verifyEvidenceContext` would pass, because the replay used those same
  stored settings and therefore always agreed with itself. A settings object
  is now usable only if it is byte-identical to a published version.
- `settings.tokenizer` and `settings.stop_words` now select real behavior
  through named registries. They were advertised in every stored record but
  read by nothing: tokenization was hardcoded, so a future settings version
  changing the tokenizer would have re-tokenized v1 records too — exactly the
  silent re-ranking the previous commit set out to prevent.
- The result-limit ceiling comes from the settings being ranked under rather
  than the module constant, so lowering `maximum_results` in a future version
  cannot fail replay of a record frozen with a higher limit.
- A retrieval record missing its recorded settings now fails loudly instead of
  being re-ranked under current settings, which could mask a ranking mismatch
  on an already-corrupt record.
- Broadened the replay tripwire: the statistics probe now covers effect sizes,
  confidence intervals for every sidedness, one-sided TOST, and several
  quantile/CDF points; the experiment-review probe now exercises real numeric
  aggregation and `quantityMode` rather than the all-empty degenerate path.
  Both additions were mutation-tested. The guidance comment also names the one
  legitimate non-code cause of failure: V8 changing transcendental-math
  precision across Node releases.

### Evidence retrieval replays under its recorded settings

- `searchEvidence` now accepts the retrieval settings to rank under, and
  verification passes the settings stored in the frozen record rather than
  whatever the current build uses. The BM25 scorer reads those settings
  instead of the module constant, so a future settings version can be added
  without silently re-ranking retrievals already stored — previously the
  ranking replay had no recorded version to dispatch on at all, making it the
  least protected of the thirteen replay surfaces.
- An unsupported settings version is refused with
  `UNSUPPORTED_RETRIEVAL_SETTINGS` rather than quietly ranked with current
  parameters.

### Replay-compatibility tripwire

- Added `tests/replay-compatibility.test.mjs`, pinning the digest of each
  replayed derivation for a fixed input: the statistics engine, the experiment
  review, and the literature parser. Verification re-derives a frozen record's
  content and compares it byte-exactly, so an unconditional change to any of
  these silently breaks every record already frozen under the old behavior.
  Every other test creates a record with current code and verifies it
  immediately, which cannot detect that. The test states plainly that a
  failure is not a reason to re-pin the constant, but a prompt to
  version-dispatch the change or accept the break deliberately. Confirmed to
  fire by mutation: adding one innocuous unconditional field to a t-test
  result — the same shape as the bug fixed in the ninth pass — fails it.
- Also pins that the supported statistics engine set stays sorted and never
  drops a shipped version, which would orphan records frozen under it.

### Ninth-pass review fixes: released-record replay compatibility

- Fixed a critical regression that would have broken `sciencecode verify` on
  every inferential assessment record v0.41.0 shipped. Two report changes
  were emitted unconditionally rather than version-gated — a new summary key
  and revised interval-disclosure wording — so replaying an untouched,
  correctly-signed record produced `assessment_replay_mismatch` and
  `report_summary_mismatch`. The statistics engine is now v4, and every
  change made since v2 is dispatched on the version recorded in the frozen
  contract, so each generation replays with the exact shape and wording it
  was written with. A regression test pins v2, v3, and current replay side by
  side.
- The alpha-below-0.5 rule now applies only to two-bound equivalence, whose
  interval is at 1 - 2*alpha; a single margin reports the one-sided 1 - alpha
  interval and has no such restriction, and the error text says which case it
  is rejecting.
- Documented that margin labels describe the sign of the declared bound, not
  which direction is clinically better: a latency outcome expressing "no
  worse than 50 ms slower" uses an upper margin and is labelled
  `non_superiority`.

### One-sided margins: non-inferiority and non-superiority

- An equivalence outcome may now declare `equivalence_lower`,
  `equivalence_upper`, or both. A lower bound alone preregisters
  non-inferiority, an upper bound alone non-superiority, and both remain
  two-sided equivalence — closing a gap that previously forced the most
  common margin design to be expressed as a superiority test with a shifted
  null and the wrong conclusion vocabulary.
- The assessment runs one one-sided test per declared bound and takes the
  largest p-value, so every declared bound must be cleared. Conclusions name
  the claim (`non_inferior`, `non_superior`, `equivalent`, and their `not_…`
  counterparts), and the reported interval matches the decision: two-sided at
  1 - 2*alpha for equivalence, one-sided at 1 - alpha for a single margin.
  `sciencecode stats tost` accepts either or both bounds.

### Eighth-pass review fixes

- Equivalence conclusions now appear in the assessment summary counts, which
  had silently dropped them: a preregistration whose only primary outcome
  established equivalence reported an empty family while the outcome itself
  passed. The counts partition the family again, with
  `margin_claims_established` reported separately.
- `stats ttest --sidedness equivalence` is refused with a pointer to
  `stats tost` instead of emitting a null p-value beside a 1 - alpha interval
  that corresponds to no equivalence decision, and an equivalence alpha at or
  above 0.5 is rejected at freeze time rather than crashing the assessment of
  an already-frozen contract.
- The superiority `t` is omitted from an equivalence outcome's payload, where
  it sat beside a TOST p-value a reader could not recompute from it, and the
  TOST detail now reaches the interaction payload. The interval disclosure in
  reports and the README states the equivalence exception instead of claiming
  every interval is at the unadjusted level, and the README documents
  equivalence outcomes.

### Equivalence testing (TOST)

- Added `equivalence` sidedness: an outcome preregisters `equivalence_lower`
  and `equivalence_upper` as typed quantities bracketing its declared null,
  and the assessment runs two one-sided tests, taking the larger p-value so
  equivalence is claimed only when both one-sided nulls are rejected. The
  reported interval is the 1 - 2·alpha two-sided interval that corresponds to
  that decision, and the conclusion reads `equivalent` / `not_equivalent`
  rather than borrowing superiority vocabulary. Equivalence outcomes join the
  same multiplicity family as any other test.
- `sciencecode stats tost` exposes the same computation for one-sample,
  two-sample, and paired data, and states plainly that absence of equivalence
  is not evidence of difference.

### Seventh-pass review fixes

- Hedges' correction now uses the variance-estimate degrees of freedom
  (`n1 + n2 - 2` for Welch) rather than the Welch-Satterthwaite test df,
  which shrank the corrected effect without bound — 11% understated on the
  engine's own fixture and 86% in the worst reachable case. Below two
  degrees of freedom the correction and `hedges_g` are reported as `null`
  instead of collapsing a real effect to zero.
- A nonzero paired null is no longer published as `cohens_d_z`, which the
  literature defines as the uncentered standardized mean difference; the
  null-centered quantity is named `standardized_mean_difference_vs_null`.
- Fixed a pre-existing defect the effect sizes exposed: a Welch outcome could
  preregister a nonzero `null_value` that the test silently ignored, so the
  p-value answered a different hypothesis than the one frozen. The declared
  null now reaches the Welch statistic and its effect size from engine v3,
  while v2 records replay against zero as they were computed, and
  `stats ttest --null` works for two-sample tests instead of being rejected.

### Standardized effect sizes

- Statistics engine v3 reports a standardized effect size beside every
  computable inference: Cohen's d for one-sample, d_z on within-pair
  differences for paired, and the average-variance form
  `d = mean_difference / sqrt((var_a + var_b) / 2)` for Welch, which does not
  assume equal variances. Each carries Hedges' small-sample correction
  `J = 1 - 3/(4·df - 1)` and the degrees of freedom it used, and effect sizes
  flow into confirmatory reports, interaction prompts, and
  `sciencecode stats ttest`.
- The assessment replay now dispatches on the statistics engine version
  recorded in the frozen contract, so a record created under v2 replays
  byte-identically without effect sizes while new records use v3. This is the
  first exercise of the supported-version machinery: verification accepts
  both 2 and 3, and a regression test pins the old behavior.

### Sixth-pass review fixes

- Pair ordering now uses codepoint comparison: `localeCompare` treats some
  distinct strings as equal, which let branch enumeration order leak into
  the summation order under collation-equal pair keys and change the
  replayed statistic across orderings. A regression test freezes the
  deterministic behavior with soft-hyphen keys.
- The inference dispatcher names its tests explicitly and marks anything it
  does not know `unsupported_test` instead of silently evaluating a future
  test as paired. `pairedTTest` validates both samples and the null
  difference before differencing and reports overflow in its own words;
  `stats ttest --paired --null` rejects a non-finite null with a paired
  message; and a contract whose `pair_parameter` equals `group_parameter` —
  a preregistration that can never align its arms — is rejected at freeze
  time rather than surfacing later as ambiguous pairing.

### Paired t-test

- Added `student_t_paired` to the statistics engine and to schema-3
  contracts: a paired inference declares the comparison arms plus a
  `pair_parameter`, and the assessment matches arm observations sharing the
  same pair-key value, orders complete pairs canonically, and runs the
  one-sample t-test on within-pair differences against the typed null. Pairs
  missing an arm are excluded, fewer than two complete pairs is loudly
  indeterminate, and duplicate observations for one arm and pair key fail
  closed as `ambiguous_pairing` rather than picking one. The existing
  seed-crossed experiment matrix pairs naturally on the seed parameter.
  `sciencecode stats ttest --paired` exposes the same computation.

### Deterministic statistics calculator

- Added `sciencecode stats ttest|quantile|adjust`, a calculator over the
  exact pinned statistics engine used by inferential contracts, so a hand
  check reproduces a frozen assessment bit for bit: one-sample and Welch
  t-tests with sidedness and a sidedness-matched confidence interval, the
  Student-t quantile, and Bonferroni/Holm adjustment with an explicit family
  size. It records nothing and states that normality and independence are
  assumed, not checked.

### Fifth-pass review fixes

- The stats calculator rejects empty list elements (a trailing comma
  previously injected a silent phantom `0` observation — the worst failure
  mode for a hand-check tool), and `stats adjust` accepts value lists that
  begin with a digit-adjacent minus sign without misreading them as options.
- Figure semantic verification checks the recorded unit-engine version
  against the supported set, matching the analysis-contract relaxation, so a
  future engine bump treats both record families consistently.

### Engine version upgrade path

- Contract verification now checks the unit and statistics engine versions
  recorded in a frozen manifest against explicit supported-version sets
  (`SUPPORTED_UNIT_ENGINE_VERSIONS`, `SUPPORTED_STATISTICS_ENGINE_VERSIONS`),
  and the contract binding reports the recorded versions rather than the
  runtime constants. Behavior is unchanged today — each set holds one version
  — but a future engine bump can keep the old version listed and dispatch
  replay on the recorded version, so existing records stay verifiable instead
  of failing wholesale.

## 0.41.0 - 2026-08-24

### Statistical-inference knowledge grounding and third-pass review fixes

- Added two mathematics-layer principles — the Student-t sampling
  distribution / Welch statistic and confidence-interval coverage — and a
  `statistical_inference` domain pack (t-tests, interval coverage,
  multiplicity, estimands, floating point), wired into the
  computational-science, evidence-review, and drug-discovery workflow
  groundings. The base grows to 84 principles and `knowledge derive` traces
  the new engine's claims down to mathematics.
- Bumped the statistics engine to v2: standard errors and confidence
  intervals change frozen report content, so records must not claim v1.
  `studentTQuantile` now throws on density underflow instead of returning a
  non-root.
- `signal-analysis` fails loudly when fewer than two spectral peaks survive
  the height gate (previously an IndexError, or worse, a silently
  under-reported frequency error), caps total samples at 20e6, and integrates
  the PSD with an explicit trapezoid so numpy 1.x works. `molecular-dynamics`
  bounds total pair-steps at 2e9 so in-bounds parameters cannot become a
  day-long run.

### Molecular-dynamics and signal-analysis templates

- Added `molecular-dynamics`: a periodic Lennard-Jones NVE system in reduced
  units integrated with velocity Verlet, bounded by three independent
  diagnostics — total-energy drift, total-momentum drift (~1e-14 at
  defaults), and a time-reversal test that integrates forward, negates
  velocities, integrates back, and measures position recovery (~1e-9).
- Added `signal-analysis`: Welch PSD and windowed periodogram over a seeded
  multi-tone signal the script itself constructs, so recovered tone
  frequencies are checked against exact ground truth (within one frequency
  bin at defaults) alongside a Parseval residual between time-domain power
  and integrated PSD.
- Both emit typed final statistics, declare their scope honestly (toy
  pair-potential system; self-validated estimation pipeline), and join the
  deterministic double-run replay test.

### Confidence intervals and toolchain diagnostics

- Added a deterministic Student-t quantile (Newton on the pinned CDF with an
  Acklam normal starter) and `tConfidenceInterval` to the statistics engine;
  both t-tests now report their standard error. Every computable inference in
  a confirmatory assessment carries a confidence interval matching the test's
  sidedness at the unadjusted level, in the outcome's frozen unit, explicitly
  flagged `adjusted_for_multiplicity: false`; one-sided intervals leave the
  unbounded side null. The report states that corrections apply to decisions,
  not intervals.
- `sciencecode doctor` now probes the local Python for numpy/scipy/matplotlib
  (the stack the SciPy simulation templates require) and reports the pinned
  unit and statistics engine versions with an explicit warning that bumping
  either invalidates existing typed or inferential records.

### Second-pass verification fixes

- The harness literature board now shows the newest sixteen records instead
  of the oldest, and its two literature counters are named `project_*` to
  state plainly that they are project-wide while their neighbours are
  chat-scoped (literature manifests carry no chat binding).
- `indeterminate_confirmatory_assessments` now counts by `outcome_verdict`,
  so a deviated assessment whose primary outcomes are indeterminate is no
  longer invisible to the counter. The assessment summary's inference counts
  are family-scoped, commensurable with `family_size`, with uncorrected
  secondary/exploratory inferences reported separately as
  `out_of_family_inferences`.
- The literature fetch timeout now covers the whole body stream, the
  non-streaming fallback enforces the byte cap too, and a source-filtered
  literature listing keeps unverifiable records visible instead of hiding
  exactly the records that need attention.

### Design review fixes and full harness integration

- Fixed the frozen inference record overwriting its preregistered
  `group_a`/`group_b` arm identities with the computed group summaries; the
  summaries now persist as `group_a_summary`/`group_b_summary` so a reviewer
  can always tell which arm was compared. Inference group membership now
  compares canonically (recursively sorted keys), so a plan branch whose
  parameters serialize in a different key order still lands in its
  preregistered group. Schema v3 now requires at least one *primary*
  inference so the correction family cannot be empty, requires
  `minimum_count >= 4` for two-sample tests, and the inferential paths use
  `>=` version checks so a future schema cannot silently drop preregistered
  tests.
- Surfaced inferential results everywhere threshold results already were:
  the assessment summary and manifest carry statistics engine, correction,
  family size, and reject/fail-to-reject/indeterminate counts; assessment
  lists carry `schema_version`; interaction prompts render per-outcome
  p-values, adjusted p-values, and conclusions with an honest assumptions
  statement; the harness board, validation counters, limitations, lineage
  metadata, and project counts distinguish inferential records; the two
  now-stale "not an inferential claim" interpretation strings are
  version-conditional.
- Integrated literature records into the whole system: a `literature`
  interaction surface with artifact/payload projections and prompt summary,
  a lineage node type with a `describes` edge to evidence sharing the same
  DOI, project verification (`literature_invalid`) and gate counts, Lab
  `/api/literature` list/detail routes plus offline import with interaction
  recording, and a harness `board.literature` section with counters and an
  honest limitation line.
- Hardened literature records: verification fails closed on unsafe storage
  roots and checks byte counts; retrieval timestamps and HTTP status are
  validated before freezing; fetch enforces the 4 MiB cap while streaming in
  both the API and the CLI worker; the CLI distinguishes timeouts from
  malformed worker replies.
- Fixed the SEIR final-size bracket losing its sign change for R0 > ~27.6,
  gave the Kepler solver a proper high-eccentricity starter with an explicit
  convergence failure, and supplied the analytic Jacobian to LSODA so the
  cross-solver disagreement diagnostic measures method difference rather
  than finite-difference noise.

### High-fidelity SciPy simulation templates

- Added three recorded-simulation templates built on the pinned SciPy runtime,
  each with an independent cross-check reported as explicit fidelity
  diagnostics in typed final statistics:
  - `orbital-mechanics`: two-body Keplerian propagation with DOP853 at
    user-bounded tolerances, checked against analytic Kepler propagation plus
    energy and angular-momentum drift (observed ~1e-12 relative drift and
    sub-millimeter position error over ten orbits at defaults).
  - `chemical-kinetics`: the Robertson stiff mass-action network integrated
    with BDF (analytic Jacobian) and independently with LSODA, reporting mass
    conservation and cross-solver disagreement.
  - `epidemic-seir`: closed-population SEIR with DOP853 vs LSODA and the
    implicit final-size equation as an analytic residual check.
- Every template emits typed `{value, unit}` final statistics so inferential
  (schema v3) and typed (v2) analysis contracts can bind to them directly, and
  each declares its scope honestly: the diagnostics bound numerical fidelity,
  not physical, chemical, or epidemiological realism.

### Frozen literature metadata adapters

- Added `lib/literature.js`: Crossref, OpenAlex, and PubMed metadata adapters.
  `sciencecode literature fetch` performs a single explicit HTTPS GET — the
  only network access in ScienceCode — through a subprocess worker, and
  freezes the exact response bytes, request descriptor (URL, HTTP status,
  retrieval time, transport), and a deterministically parsed bounded
  bibliography into an immutable audited record under
  `.sciencecode/literature/`. `literature import` freezes a previously saved
  API response with no network access at all.
- Verification re-hashes every frozen file, replays the pinned parser
  (`sciencecode-literature-parser` v1) over the exact response bytes, and
  cross-checks the hash-chained `literature.ingested` audit event, so a
  record is exactly as reproducible offline as every other ScienceCode
  artifact. A record is a snapshot of a third-party registry at retrieval
  time, not a claim that the registry is correct.

### Versioned inferential-statistical contracts

- Added `lib/statistics.js`, a pinned deterministic statistics engine
  (`sciencecode-inferential-t`): Lanczos log-gamma, regularized incomplete
  beta via a bounded Lentz continued fraction, the Student-t CDF, one-sample
  Student and two-sample Welch t-tests with declared sidedness, and Bonferroni
  and Holm-Bonferroni multiplicity adjustment. Every routine is a pure function
  of binary64 inputs with fixed iteration bounds, so identical inputs replay to
  identical bits.
- Added analysis contract schema version 3. It keeps typed units and adds an
  optional per-outcome `inference` block (test, sidedness, alpha, typed null
  value, and a branch-parameter group split for two-sample tests) plus a
  required top-level `multiplicity_correction`. A v3 contract must declare at
  least one inference, inference outcomes require `minimum_count >= 2`, and the
  frozen manifest pins the statistics engine name and version exactly as it
  pins the unit engine; verification rejects a manifest naming any other
  engine.
- Extended the confirmatory engine to schema/engine version 3. Preregistered
  t-tests replay over verified typed branch observations; the multiplicity
  family is the set of primary outcomes that declared an inference in the
  frozen contract, so missing data can never shrink the preregistered
  multiplier. Inferential outcomes derive their status from the corrected test
  (reject/fail-to-reject/indeterminate) while the threshold rule is still
  evaluated and reported as `threshold_status`. The report states that
  normality and independence are assumed, not checked, and that no causal,
  clinical, or regulatory conclusion follows.

## 0.40.0 - 2026-08-11

### Layered foundational knowledge and biomolecular design

- Added `lib/knowledge.js`: 82 principles compiled into a directed acyclic
  graph over five ordered layers — mathematics, physics, chemistry, biology,
  applied biomedicine. Each principle carries its kind, statement, dependencies,
  epistemic status and confidence, scope of validity, stated limits, and
  primary references.
- Enforced two invariants at module load: no principle may depend on a layer
  above its own, and no principle may claim more confidence than the weakest
  principle it rests on. Compilation records every violation rather than
  throwing, so an unsound base fails closed on every query while
  `knowledge verify` and `doctor` still name the exact violation. Axioms are admissible only in the mathematics layer,
  and every principle above tier 0 must derive back down to mathematics.
- Added domain packs for drug discovery, nucleic-acid design, protein
  engineering, vaccine design, evidence appraisal, and measurement. Each
  resolves to its full transitive support tree, and each biomolecular pack
  carries the `bioeng.biosafety.dual_use` governance principle.
- Added `sciencecode knowledge layers|list|show|derive|domain|ground|verify`.
  `derive` prints the complete support chain in dependency order with the
  layers crossed, the weakest supporting claim, and every stated limit.
- Added the `biomolecular_design` workflow (scope, evidence, grounding, design,
  compute, biosafety, review, approval, outcome) with `biomolecular-designer`
  and `biosafety` agent lanes. Goals naming DNA, RNA, primers, CRISPR guides,
  codons, constructs, epitopes, antigens, immunogens, vaccines, antibodies, or
  protein design route to it ahead of drug discovery. An outcome recorded
  without visible biosafety screening raises the biosafety stage to attention
  rather than leaving it queued.
- Added the `biomolecular-designer` authoring subagent and the read-only
  `biosafety-reviewer`, both bound into the evaluation suite. The designer must
  name its reference assembly or accession, cite the principles a design rests
  on, and report the weakest link; the reviewer screens containment, provider
  screening, and dual-use exposure and marks missing gates as blocking. Two new
  `scientific_safety` cases enforce those boundaries, taking the suite to 57
  cases.
- Attached workflow grounding to every harness view and surfaced the layer span
  and provisional claims on the Lab context card. `sciencecode doctor` now
  fails when the knowledge base does not verify.
### Review fixes

- Fixed unit conversion forming its ratio from two independently rounded
  binary64 scales, so `1 ppm -> ppb` returned 999.9999999999999 rather than
  1000. Twelve of twenty metric pairs tested were off by an ULP, and because
  `normalizeDecisionQuantity` bakes the result into a frozen analysis contract,
  an observation sitting exactly on a preregistered threshold could be reported
  as pass when it fails, or fail when it passes. Scales now carry an exact
  integer significand and decade so the ratio is exact; stored
  `scale_to_canonical` values are unchanged.
- Fixed `redactText` ending a quoted credential at the first raw quote, which
  emitted the tail of any secret containing an escaped quote - as any
  JSON-encoded value may - into immutable records. Fixed a private key arriving
  without its END marker, from truncated or block-streamed output, being flagged
  by `scanSecrets` but passed through by redaction unchanged.
- Fixed Lab read routes accepting any `Host` header while mutations required a
  loopback one, leaving `/api/state` and artifact routes open to DNS rebinding
  that the threat model claims is mitigated. The check now runs for every
  method.
- Fixed `findExecutable` treating the `.11` in `python3.11` as an executable
  extension and skipping every PATHEXT candidate, and fixed output-buffer
  overflow spawning one `taskkill` per subsequent chunk.
- Fixed the goal classifier requiring literal adjacency for `protein design`,
  which routed "design a protein binder", "design a nanobody", and "design a
  toxin variant" away from biomolecular design and past its biosafety stage
  entirely. Design intent is now matched separately from the biomolecule, and
  bare `construct`, `rna`, and `genome` no longer capture analysis and
  literature goals.
- Fixed prototype-chain lookup on the domain and workflow tables, where
  `knowledge domain constructor` threw a raw TypeError instead of the coded
  unknown-domain error, and fixed knowledge CLI options swallowing a following
  flag as their value or being accepted and ignored outside `list`.
- Registered 26 error codes that were reaching HTTP 500 and exit 1 by
  omission, including `PROJECT_NOT_FOUND` across 12 sites, and added a test
  asserting every code thrown in `lib/` is classified.
- Added direct tests for `lib/security.js`, which had none.

- Kept the epistemic boundary explicit: the base is textbook-level grounding
  for reasoning, not a source of experimental fact, not a substitute for
  primary literature, and not authorization for synthesis, editing,
  immunisation, or any other physical or clinical work.

## 0.39.0 - 2026-08-11

### Renderer-independent decoded-pixel figure validation

- Added a strict schema-1 visual profile and deterministic
  `sciencecode-flat-color-plot-vision` engine. Visual validation starts only
  from an integrity-valid matched semantic registration, projects the exact
  converted/sampled data through frozen linear or log10 domains into one
  declared plot rectangle, and alpha-composites the exact PNG over its declared
  background.
- Added separate position and nominal pixel-support checks for bottom/left axis
  strokes, line paths/footprints, and filled-circle marker centers/footprints,
  plus per-series unexpected-color fractions and background conformance. Strict
  threshold floors/ceilings and pairwise color separation prevent profiles from
  disabling checks or assigning ambiguous masks; undersized marks now fail even
  when their centerlines are within position tolerance.
- Added immutable `.sciencecode/figure-visuals` records that bind the exact
  semantic parent manifest/report, PNG, source, contract, replay, normalized
  profile, deterministic report, status, and audit hashes. Conforming and
  nonconforming outcomes are both valid records; verification reruns the full
  parent and pixel engines, and audit-backed enumeration exposes deletion.
- Added `sciencecode figure visual register|list|show|verify`, profile and
  registration templates, shared 400/404/409/413 error semantics, same-origin
  Lab create/list/detail/artifact routes, state summaries, a responsive
  **Marks and axes against the data** PNG workspace, bounded AI interaction
  context, harness activity/cards, lineage parent/report links, and whole-
  project gate coverage.
- Added 4,194,304-pixel, 4,096-point, 1,000,000-sample, 64-KiB profile,
  72-KiB spec, report/manifest/file, and 10,000-record ceilings; strict
  realpath/link containment; malformed-record handling; and adversarial tests
  for deceptive self-consistent sidecars, missing/undersized axes and marks,
  unexpected pixels, log projection, profile errors, tampering, registry caps,
  cross-origin requests, AI handoff, lineage, and project verification.
- Kept the epistemic boundary explicit: the plot rectangle, domains, colors,
  sizes, tolerances, and thresholds are user-supplied and can be tuned post hoc.
  A pass is not OCR, prospective independence, general chart understanding,
  renderer certification, statistical validation, or scientific validity; the
  engine does not validate titles, tick labels, legends, annotations, error
  bars, hidden/overlapping marks, or categorical/faceted layouts.

## 0.38.0 - 2026-08-11

### Replayable semantic figure registration

- Added a strict schema-1 semantic figure contract and producer-sidecar builder.
  Contracts bind line/scatter type, exact x and series columns, registered
  source/display units, deterministic conversions, linear/log scales, missing
  and duplicate-x policy, source/x-ascending order, no aggregation, and all or
  evenly spaced sampling.
- Added a dependency-free bounded UTF-8 CSV/TSV replay engine with quoted-field
  validation, normalized unique headers, exact row width, strict finite decimal
  parsing, log-domain and conversion refusal, 8-MiB/100,000-row/128-column/
  16-series ceilings, source-row-preserving JSONL digests, per-series hashes,
  and whole plotted-data replay.
- Added immutable semantic registration records over three independently
  verified artifacts: PNG, table, and JSON sidecar. Reports compare sidecar
  schema, PNG digest/dimensions, table digest/format, normalized contract, and
  full replay. A mismatch is retained as an integrity-valid negative result;
  later source/copy/report/manifest/audit mutation fails verification.
- Added `sciencecode figure semantic sidecar|register|list|show|verify`, public
  core APIs, templates, strict shared error semantics, same-origin Lab list/
  detail/create/artifact routes, a responsive **Source-to-figure contract** PNG
  studio, harness activity/cards, bounded AI interaction summaries, lineage
  input/report edges, Lab state counts, and whole-project gate coverage.
- Added adversarial contract, CSV/TSV, numeric, dimensional, log, duplicate,
  sampling, byte/row/column/series/record-ceiling, sidecar-mismatch,
  stored-copy-tamper, CLI, API, origin, artifact, interaction, harness, lineage,
  project-gate, and UI-source coverage. The feature explicitly does not infer
  semantics from pixels or certify that a renderer drew its self-declared axes,
  labels, marks, or values.
- Release validation passes all 55 built-in evaluation cases with fingerprint
  `515291ebe400d6845e5a0650c43af11c2a7e0ab666853dfaf1f52fcbdaa95238` and
  268/268 tests (259 passed, 9 capability skips, 0 failures). Instrumented
  coverage is 82.30% lines, 72.95% branches, and 91.18% functions; the focused
  semantic-registration engine is 75.32% lines, 62.43% branches, and 96.04%
  functions. The production dependency audit reports zero vulnerabilities, and
  the 0.38.0 dry-run package contains 158 intended files, including the engine
  and both new templates.

## 0.37.0 - 2026-08-11

### Typed measurement contracts

- Added a bounded shared unit engine with registered SI-scaled mass, length,
  time, amount, volume, temperature, frequency, pressure, energy, power, force,
  ratio, count, arbitrary, and molar atoms plus explicit compound `*`, `/`, and
  `^` expressions. Inspection and conversion are public through `sciencecode
  unit list|inspect|convert` and the core API.
- Added analysis-contract schema 2. Outcomes now freeze a normalized registered
  unit descriptor and decision bounds require typed `{value, unit}` quantities;
  compatible thresholds are converted to the outcome unit before publication.
  Unit-engine name/version is manifest- and experiment-bound. Schema-1 contracts
  retain their original normalized shape, binding, assessment schema, and
  confirmatory engine-1 replay.
- Contract-bound experiments now enter typed-quantity review mode. Present
  `final_statistics` must use exactly `{value, unit}`; valid compatible values
  produce canonical quantity aggregates with source and standard-deviation
  units, while bare values, invalid objects, unknown units, and inconsistent
  dimensions fail the experiment review.
- Confirmatory engine 2 converts each branch observation into the frozen outcome
  unit before aggregation and threshold comparison. Reports retain source and
  converted quantities and expose missing, bare, malformed, unknown-unit, and
  dimensional-mismatch cases rather than inferring a unit. The Lab schema-2
  editor, contract detail, branch replay, and AI handoff render the same typed
  state.
- Absolute `K`/`degC` form a separate affine space from `delta_K`/`delta_degC`;
  absolute units cannot appear in compounds. Unit text is capped at 64
  characters and 12 factors with exponent/overflow checks, exact object keys,
  finite JSON numbers, case-sensitive symbols, no implicit multiplication, and
  fail-closed incompatible conversions.
- Added focused parser, conversion, experiment-review, CLI, schema migration,
  legacy replay, end-to-end immutable-record, and unit-engine tamper coverage.
  The unit contract establishes declared dimensional consistency only: it does
  not prove what code measured, physical plausibility, statistical validity,
  causal meaning, clinical relevance, or regulatory fitness.
- Release validation passed all 55 built-in evaluation cases with every metric
  at 1.0 and fingerprint
  `a41e33182e86f6b75ba7ad4834ea0d0f63bea3b259cb1c37c5e47f6c67d0fa94`.
  The full suite reports 259 tests: 250 passed, 9 capability-gated skips, and 0
  failed. Focused typed-contract coverage reports 97.95% lines, 90.00% branches,
  and 100% functions for `lib/units.js`. The production dependency audit reports
  0 vulnerabilities, the CLI reports 0.37.0, and the dry-run package contains
  the intended 155 files without creating a tarball. Live browser,
  accessibility-tree, keyboard, and responsive visual inspection remains a
  separate release-machine gate because no in-app or extension browser session
  was available here.

## 0.36.0 - 2026-08-11

### Governed blinded-corpus evaluation

- Added `sciencecode benchmark inspect`, `benchmark predict`, and `benchmark
  score` as a separate external-evidence workflow. Inspection validates the
  held-out manifest and case binding without resolving, statting, or opening
  labels/baselines. Prediction uses the production deterministic
  citation-requirement reviewer only inside the declared blind window and
  exclusively creates a case-complete, canonical-digest run. Scoring validates
  candidate and published baseline runs first, refuses sealed labels, and opens
  expert labels only after their declared unseal time.
- Added a strict schema-v1 benchmark contract for held-out text, two declared
  classes, exact case/label/run hashes and counts, one through eight baselines,
  prospective accuracy/precision/recall/abstention thresholds, and bounded
  governance metadata covering independent creation, at least two expert
  labelers, expertise, labeling, adjudication, blinding, licensing, source,
  limitations, corpus freeze, and label unsealing.
- Score reports now expose explicit abstentions, binary confusion counts,
  accuracy, coverage, abstention rate, precision, recall, specificity, F1,
  per-stratum replay, fixed 95% Wilson score intervals, threshold decisions,
  paired candidate/baseline outcomes, exact source bindings, case-level
  expected/observed labels, limitations, and a deterministic fingerprint. Raw
  input text and local absolute paths are excluded.
- External files are treated as untrusted bounded data: stable regular UTF-8
  reads, portable realpath containment, link/junction refusal, strict unknown
  fields, fixed manifest/case/label/run/text/count limits, exact coverage,
  both-class enforcement, canonical prediction digests, timeline checks,
  baseline identity, contained exclusive outputs, and nonzero threshold failure
  all fail closed. Added direct API and CLI tests for blind separation,
  deterministic metrics, abstention, tampering, encoding, hashes, containment,
  timing, option handling, and overwrite refusal.
- This release provides tooling, not an independent performance result.
  Governance and timestamps remain externally reviewable self-attestations;
  Wilson intervals are conditional on the submitted fixed corpus; no genuinely
  independent expert corpus ships with ScienceCode; and external scores cannot
  replace, waive, or weaken the 55-case built-in release gate.
- Release validation passed all 55 built-in evaluation cases with every metric
  at 1.0 and all 251 tests with 242 passed, 9 capability-gated skips, and 0
  failed. Focused benchmark coverage reports 91.83% lines, 75.50% branches, and
  100% functions. The production dependency audit reports 0 vulnerabilities,
  the CLI reports 0.36.0, and the dry-run package contains the intended 154
  files without creating a tarball. Live browser, accessibility-tree, keyboard,
  and responsive visual inspection remains a separate release-machine gate
  because no in-app or extension browser session was available here.

## 0.35.0 - 2026-08-11

### Executable product-accuracy evaluation

- Added the versioned `sciencecode-core` release suite and public
  `sciencecode evaluate [--json]` / `npm run evaluate` entry points. The suite
  runs 55 labeled cases across reviewer detection precision/recall, citation
  correctness, numerical review, reproducible reruns, scientific-safety
  contracts, and agent-role separation. Human and JSON reports expose exact
  expectations, observations, confusion counts, category metrics, thresholds,
  repeat digests, source bindings, limitations, and one deterministic
  fingerprint.
- Citation evaluation exercises the production evidence and semantic-review
  paths with record, page, exact-span, DOI, missing, numeric-style, weak-overlap,
  number-mismatch, and negation cases. Numerical evaluation uses the production
  bounded arithmetic and directive parser. The complete projection and every
  product-source binding are read and evaluated twice.
- Bound implementation, agent, command, and skill sources must be contained
  regular UTF-8 files no larger than 1 MiB. Newline-normalized hashes make the
  contract portable; missing, linked, moving, oversized, malformed, weakened-
  policy, role-drifted, or nondeterministic inputs fail closed. Temporary
  citation fixtures are isolated and removed, and neither their paths nor random
  evidence IDs enter the report.
- Added independent-run determinism, policy-drift, nonzero CLI failure, strict
  option, source-binding, no-leakage, metric, threshold, and formatting tests.
  `npm run check` now runs the evaluation before the ordinary test suite.
- Fixed an under-load Lab connection race exposed by the complete release gate.
  Reusable loopback sockets now remain available across a long synchronous
  verification pass under a finite 65-second keep-alive and 70-second header
  deadline, with server-policy and concurrent CAD/evaluation/Lab coverage.
- A perfect score is intentionally described only as regression success on the
  declared fixtures. It is not a claim of external precision/recall, citation
  entailment, scientific or causal validity, model obedience, or OS-enforced
  safety.
- Release validation passed all 55 evaluation cases with every declared metric
  at 1.0 and all 243 tests with 234 passed, 9 capability-gated skips, and 0
  failed. The production dependency audit reports 0 vulnerabilities, the CLI
  reports 0.35.0, and the dry-run package contains the intended 153 files
  without creating a tarball. Live browser, accessibility-tree, keyboard, and
  responsive visual inspection remains a separate release-machine gate.

## 0.34.1 - 2026-08-11

### CAD study guidance accuracy

- Corrected the bundled Scientist, CAD Engineer, `/cad` command, and
  `cad-engineering` skill so they describe the cancellable v0.34 study lifecycle
  instead of the superseded non-cancellable behavior. Each surface now explains
  active-branch interruption, retained completed and interrupted artifacts,
  explicit `not_run` branches, verified partial finalization, and the rule that
  a cancelled study or partial aggregate must never be presented as complete.
- Added bundled-engine compatibility coverage that requires those four product
  contracts to agree and rejects the obsolete cancellation guidance.
- Release validation covers 238 tests: 229 passed, 9 capability-gated tests
  were skipped, and 0 failed. The production dependency audit reports 0
  vulnerabilities, the CLI reports 0.34.1, and the dry-run package contains the
  intended 152 files without creating a tarball. Live browser and
  accessibility-tree inspection remains a release-machine gate because no
  browser connection was available here.

## 0.34.0 - 2026-08-11

### Cancellable comparative CAD studies

- Routed Lab CAD studies through the shared asynchronous experiment finalizer.
  Build, geometry-screen, and slicer work retain their existing isolated worker
  paths, while a study now exposes bounded branch-start and branch-finish
  progress without blocking loopback state reads.
- Added a dedicated **Stop study** control, reload recovery, polite live status,
  busy state, operation-aware completion text, and distinct partial-study AI
  handoff. Completed and cancelled studies remain inspectable through the same
  responsive comparison cards, branch outcomes, scalar-field links, immutable
  experiment detail, harness, and lineage surfaces.

### Coherent partial provenance

- Cancellation now binds to the exact job, operation, CAD project, build, and
  optional chat. It aborts only the active model process, retains completed and
  interrupted child artifacts, writes explicit `not_run` rows for undispatched
  branches, recomputes the deterministic review, finalizes the manifest and
  audit link, and re-verifies the complete partial experiment. The prior
  24-hour whole-matrix ceiling remains enforced through the same finalizer with
  a distinct recorded timeout reason.
- Cancelled CAD studies remain integrity-verifiable but fail the default
  experiment and simulation outcome gates. Harness and Lab state now disclose
  separate integrity-verified and passing counts, cancelled CAD-study counts,
  studies needing attention, and the verified partial-study safety contract.
- Added real-loopback regression coverage for a completed first branch,
  cancelled second branch, untouched third branch, exact cancellation mismatch,
  responsive state reads, active-job recovery, partial artifacts, retry,
  interactions, harness counts, lineage, and whole-project policy.
- Release validation covers 238 tests: 229 passed, 9 capability-gated tests
  were skipped, and 0 failed. The production dependency audit reports 0
  vulnerabilities, the CLI reports 0.34.0, and the dry-run package contains the
  intended 152 files without creating a tarball. Live browser and
  accessibility-tree inspection remains an explicit release-machine gate
  because no browser connection was available here.

## 0.33.0 - 2026-08-11

### Native Reproducibility workspace

- Added a full-width responsive **Reproducibility** workspace for creating,
  listing, downloading, and verifying immutable project baselines without a
  terminal. Strict mode distinguishes added, modified, missing, unreadable,
  and record-integrity findings; relaxed mode ignores only later additions.
- Added keyboard-native capture, strict-policy, refresh, verify, cancel, and
  disclosure controls; live busy/completion state; terminal focus; reload
  recovery; audit-binding labels; exact JSON downloads; lazy bounded
  diagnostics; and desktop-to-phone layouts.
- Preserved compatibility with `sciencecode snapshot` manifests in the managed
  `.sciencecode/snapshots/` registry, including schema-1 verification, while
  strengthening snapshot metadata, digest, type, size, path, and configurable
  file/byte-limit validation.

### Atomic capture, integrity, and responsiveness

- Added a package-local cancellable snapshot worker. Capture hashes at most
  100,000 entries and 16 GiB into a maximum 32 MiB pending manifest, verifies
  the current project, and returns only a bounded report. The Lab independently
  rehashes the pending file, copies it with exclusive-create semantics, removes
  the pending file, and then appends the exact audit binding. Cancellation
  removes only that job's uncommitted pending file.
- Added strict same-origin JSON create/verify routes, one active snapshot
  operation, five-minute and 4 MiB worker bounds, exact kind/ID/operation
  cancellation, safe registry and download containment, a 256-record bounded
  list, a compact latest-job state projection, and full diagnostics only from
  the process-local job detail.
- Added deterministic secret-redacted reports capped at 128 findings and
  12 KiB per finding. Snapshot-file tampering, unsafe stores, malformed
  metadata, missing or ambiguous audit bindings, and audit-chain failures are
  non-waivable whole-project gate blockers. Ordinary later project drift does
  not invalidate the historical baseline record or block the project gate.
- Added domain, strict/relaxed drift, tamper/gate, limit, redaction,
  real-worker loopback, same-origin, compact-state, exact-download,
  single-flight, responsiveness, cancellation cleanup/retry, accessibility,
  and responsive-layout regressions. Release validation covers 238 tests: 229
  passed, 9 capability-gated tests were skipped, and 0 failed. The production
  dependency audit reports 0 vulnerabilities, the CLI reports 0.33.0, and the
  dry-run package contains the intended 152 files. Live browser and
  accessibility-tree inspection remains an explicit release-machine gate
  because no browser session was available here.

## 0.32.0 - 2026-08-11

### Native Verification Center

- Added a full-width responsive **Verification** workspace that runs the same
  authoritative project verifier as `sciencecode gate`, reports pass or blocked
  status, audit and lineage anchors, record counts, categorized findings, and
  the exact bounded JSON report without requiring a terminal.
- Separated non-waivable hash, schema, reference, audit-chain, and lineage
  integrity blockers from explicit failed-outcome policy. Eight native
  checkboxes mirror the CLI's recorded run, simulation, CAD build/slice,
  inference, experiment, notebook-cell, and campaign-task allowances; accepted
  failures remain counted and visible.
- Added keyboard-native fieldsets and disclosures, live busy/completion status,
  result focus, cancellation, reload recovery, textual status labels, and
  desktop-to-phone layouts. The workspace rail now shows the latest pass,
  blocker count, active state, or incomplete run state.

### Responsive and bounded verification

- Moved full synchronous project verification into a dedicated cancellable
  child process so the loopback Lab event loop remains responsive on large
  projects. Only one gate runs per Lab process, worker time/output are bounded,
  shutdown aborts owned work, and a gate run never mutates scientific records.
- Added strict same-origin JSON creation, exact gate cancellation binding,
  stable shared HTTP error semantics, secret-redacted issue projection,
  128-finding and 12-KiB-per-diagnostic limits, deterministic report fingerprints,
  and a compact latest-gate `/api/state` summary. Full bounded diagnostics are
  available only from the short-lived job detail.
- Added domain, real-worker loopback, tampered-audit, policy, redaction, byte
  limit, single-flight, responsiveness, cancellation, static accessibility,
  and responsive-layout regressions. Release validation passes 227/227 tests,
  the production dependency audit reports zero vulnerabilities, the CLI
  reports 0.32.0, and the dry-run package contains the intended 149 files.
  Live browser and accessibility-tree inspection remains an explicit
  release-machine gate because no browser session was available here.

## 0.31.0 - 2026-08-11

### Native preregistration authoring

- Added a full-width responsive preregistration editor to the Confirmatory Lab
  with a substantive Markdown starter, local UTF-8 byte meter, live checklist,
  explicit incomplete/duplicate/placeholder feedback, keyboard-native form
  controls, status announcements, and a one-column phone layout.
- Added schema-v2 inline registrations with nine required planning sections,
  deterministic server-side completeness replay, a 256 KiB ceiling, exact
  immutable Markdown, record/content hashes, and audit binding. Existing
  schema-v1 project-file registrations and source-drift reporting remain
  compatible.
- Added same-origin create/list/detail/exact-source endpoints, verified Lab
  state and counts, archive cards, exact text-only source inspection, lineage
  artifact URLs, and preregistration-specific AI context. Registration,
  contract, and assessment creation now work without chat; a selected chat adds
  only an optional secret-scanned handoff.

### Containment and verification

- Added strict request allowlists, name/note/body limits, early secret refusal,
  Markdown-fence-aware section parsing, and fail-closed HTTP semantics.
- Hardened preregistration metadata, registry, JSON record, mutable source, and
  frozen artifact resolution against junctions, symlinks, non-directory stores,
  traversal, tampering, and unsafe source serving before external state can be
  written or exposed.
- Added core, real-loopback API, no-chat downstream binding, optional chat
  handoff, lineage, responsive/accessibility source-contract, tamper, and
  filesystem-link regressions. Live browser and accessibility-tree inspection
  remains an explicit release-machine gate because no browser session was
  available in this validation environment.
- Release validation passes 219/219 tests with bounded four-worker execution;
  the production dependency audit reports zero vulnerabilities, the CLI reports
  0.31.0, and the dry-run package contains the intended 146 files.

## 0.30.0 - 2026-08-11

### Native recorded-compute authoring

- Turned the Lab's Simulations and Experiments archives into responsive
  authoring workspaces. Users can select project Python, deterministic seeds,
  device and timeout policy, typed fixed parameters, declared inputs, script
  arguments, an optional verified CAD parent, and an optional AI conversation
  handoff without leaving the workbench.
- Added bounded experiment design with a falsifiable hypothesis, seed list,
  live branch-count feedback, Cartesian variations, and an optional frozen
  analysis contract. Simulation users can also install exact packaged starters
  through the existing additive, no-overwrite template contract.
- Added same-origin `POST /api/simulations` and `POST /api/experiments`
  lifecycles with safe public job summaries, bounded events, reload recovery,
  detail handoff, and one shared standalone-compute concurrency boundary.

### Cancellation, containment, and interaction safety

- Added `runExperimentAsync` on the same preparation/finalization path as the
  synchronous recorder. A stopped matrix preserves its immutable plan,
  completed or active branch evidence, explicit `not_run` branches,
  deterministic review, verification, audit links, and the failed-outcome
  project gate.
- Simulation and experiment stop requests are exact job/kind/chat bound and
  pass an `AbortSignal` to the owned work. Optional completed, failed, and
  cancellation handoffs use separate secret-scanned interaction records rather
  than changing scientific manifests.
- Added strict request allowlists, typed and byte bounds, a 64-branch ceiling,
  secret preflight, redacted job requests, and realpath containment for scripts
  and declared inputs. Junction or symlink escapes now fail before any
  simulation or experiment record is created.
- Added busy/live semantics, keyboard-native forms, locked controls during
  execution, chat-dependent direction controls, and one-column phone layouts.
  Static contracts and loopback API tests do not replace live browser,
  accessibility-tree, keyboard, and responsive visual QA on a release machine.

### Verification

- Added real loopback launch/serialization/concurrency/completion/cancellation
  coverage, pure browser-form parsing and source contracts, asynchronous
  experiment cancellation replay, and Windows-junction containment regressions.
- Release validation passes 212/212 tests with bounded four-worker execution;
  the production dependency audit reports zero vulnerabilities, the CLI reports
  0.30.0, and the dry-run package contains the intended 145 files.

## 0.29.0 - 2026-08-11

### Consistent user-facing failures

- Added one shared error-semantics boundary for the CLI and loopback Lab API.
  Explicit route statuses still win; otherwise malformed input, absent records,
  payload ceilings, state conflicts, unavailable runtimes, secret refusal, and
  missing executables retain distinct outcomes instead of depending on two
  drifting command- and server-local tables.
- Corrected newer campaign, figure-comparison, review, inference, simulation,
  and experiment identifiers. Malformed identifiers now return CLI status 2
  and HTTP 400, while valid identifiers for absent records return CLI status 1
  and HTTP 404. Unknown failures continue to fail closed as CLI status 1 and
  HTTP 500.
- Added the shared classifier to the syntax gate so packaging a new boundary
  module cannot bypass the normal source checks.

### Verification

- Added three regression contracts covering the classifier directly, real CLI
  dispatch across eight command families, and real Lab requests across six
  record families. The affected 59-test Lab/domain suite passes.
- Release validation passes 206/206 tests with bounded four-worker execution;
  the production dependency audit reports zero vulnerabilities, the CLI reports
  0.29.0, and the dry-run package contains the intended 144 files.

## 0.28.0 - 2026-08-11

### Honest, responsive Lab shell

- Added an explicit project-verification screen and disabled conversation,
  navigation, and refresh-dependent actions until verified state is available.
  Initial failure stays non-actionable and explains recovery instead of
  silently presenting an empty ready-looking workspace.
- Made conversation selection atomic from the user's perspective. A failed
  selection restores the previous conversation and harness, or returns to a
  coherent new-conversation state, rather than leaving mismatched selection,
  URL, and content.
- Kept fresh, reused, stale, and failed integrity state visible after normal
  conversation loading and at narrow widths. Conversation selection no longer
  overwrites a verified-state label with an ambiguous `Local` label.
- Changed JSON API serialization from pretty-printed to compact JSON without
  changing response values. On the 676-file local project, `/api/state` fell
  from 461,769 to 311,810 bytes (32.5%). The repeatable three-run benchmark
  completed in 7.54 seconds cold and 0.11–0.24 seconds unchanged (0.174-second
  mean). Negotiated gzip was tested and rejected because it increased warm
  latency on the intentionally loopback-only server.

### Keyboard and narrow-layout completeness

- Added a skip link, programmatic heading/detail focus on hidden-view
  transitions, `aria-current` workspace state, busy-region semantics, and
  reduced-motion-aware scrolling.
- Implemented a complete harness tab contract with tab/tablist/tabpanel roles,
  selected and focus state, hidden inactive panels, and arrow/Home/End keyboard
  navigation.
- Replaced the fixed ten-column mobile workspace grid with a single horizontal
  rail for every current view, retained the integrity indicator on mobile, and
  enlarged narrow harness tab targets.

### Verification

- Added five focused Lab shell contracts covering bootstrap gating, focus and
  selection semantics, tab keyboard behavior, narrow-layout integrity status,
  and verified-label persistence. HTTP coverage also proves compact JSON keeps
  exact content length and remains structurally identical.
- Release validation passes 203/203 tests with bounded four-worker execution;
  the production dependency audit reports zero vulnerabilities, the CLI reports
  0.28.0, and the dry-run package contains the intended 143 files.
- Source and HTTP contracts do not replace live visual browser QA; responsive
  screenshots, accessibility-tree inspection, and keyboard traversal remain a
  release-machine gate.

## 0.27.0 - 2026-08-11

### Responsive verified Lab state

- Added bounded parallel digest preloading and bounded reusable SHA-256 and
  audit caches. Every digest hit rechecks device, inode, mode, size, nanosecond
  modification time, and change time; a file that changes during asynchronous
  preload is discarded and handled by the authoritative synchronous verifier.
- Added a complete verified-state cache for the default persisted Lab providers.
  Every request walks `.sciencecode` and `cad` metadata, same-origin mutations
  explicitly invalidate the snapshot, a changing snapshot is retried once, and
  any link in a watched root disables whole-state reuse. API responses disclose
  hit state, strategy, fingerprint, verification time, and check time.
- Scoped caches remain bounded and mutation-aware. Normal external edits,
  appends, same-size tampering with restored modification time, file replacement,
  and audit-head changes force a rebuild; cache reuse does not replace a first
  full cryptographic verification.
- Made the Lab title bar use the API version instead of stale hard-coded text and
  show **verified now**, **verified snapshot**, or **integrity warning** state.

### Faster truthful hardware discovery

- Replaced the Windows-wide `Win32_PnPSignedDriver` scan with locale-independent
  `pnputil /format xml`, a narrow registry service lookup, and a targeted
  `Microsoft.WinML.AMD.NPU.EP.2` inventory query. Device, driver, service, and
  provider-package fields remain separate from profiled execution evidence.
- Extended the ordinary Lab compute-status lifetime from 15 seconds to five
  minutes; the existing explicit Refresh path still forces a new probe.
- Added `npm run bench:lab-state -- <project> [runs]` with optional
  `--skip-compute`. On the 676-file, 16.6 MB local development project, the
  measured HTTP state path improved from more than 10 seconds to 6.2–7.5
  seconds cold and 0.20–0.29 seconds unchanged.

### Verification

- Added cache-bound, concurrent-preload, LRU-bound, append-invalidation,
  same-size/restored-mtime tamper, endpoint reuse, and visible UI freshness
  coverage. The cache boundary remains local metadata acceleration, not a
  defense against privileged filesystem metadata forgery.
- Release validation passes 198/198 tests with bounded four-worker execution;
  the production dependency audit reports zero vulnerabilities, and the 0.27.0
  dry-run package contains the intended 143 files, including the benchmark.

## 0.26.0 - 2026-08-11

### Frozen structural figure evidence

- Extended immutable PNG rerun records with deterministic, dependency-free
  block-luminance structural similarity. RGBA pixels are alpha-composited over
  a recorded white matte in linear-light sRGB, converted to Rec. 709
  luminance, and assessed as a sample-weighted mean of fixed 8x8 SSIM blocks.
- Added mean and minimum block similarity, worst-block coordinates, luminance
  MAE/RMSE and maximum delta. An optional 0-through-1 minimum similarity is
  frozen into the settings digest; when configured, both the existing pixel
  rule and the structural rule must pass.
- Kept the boundary explicit: this is a mechanical diagnostic, not image
  registration, semantic plot comparison, a learned perceptual metric, or a
  domain-valid scientific acceptance criterion.

### Replay compatibility and workbench integration

- Versioned the comparison manifest, report, and engine while retaining exact
  deterministic replay of schema-v1 pixel-only records. Current verification
  recomputes all pixel, luminance, block, threshold, copied-source,
  visualization, manifest, and audit evidence.
- Added `--min-structural-similarity`, a Lab **MIN BLOCK SSIM** control, score
  and rule cards, provenance details, list/state/harness counts, lineage
  summaries, and bounded next-turn AI context.
- Increased the full-config bundled-engine probe allowance to tolerate process
  contention in parallel Windows release tests without changing the shorter
  version probe.
- Bounded Node test-file concurrency at four workers and separated child
  startup delay from measured abort latency, preventing host oversubscription
  from masquerading as engine, local-server, or cancellation failures.

### Verification

- Added core, CLI, same-origin API, state, harness, lineage, interaction,
  compatibility-shape, strict/relaxed threshold, and responsive UI contract
  coverage for structural figure comparisons.
- Release validation passes 195/195 tests with bounded four-worker execution;
  `npm audit` reports zero vulnerabilities, and the 0.26.0 dry-run package
  contains the intended 142 files.

## 0.25.0 - 2026-08-11

### Immutable figure rerun comparison

- Added a first-class figure-comparison record for two distinct verified PNG
  artifacts or immutable PNG revisions. The record freezes canonical source
  URLs/hashes, comparator version, integer RGBA channel tolerance, and accepted
  changed-pixel fraction; preserves exact baseline/candidate copies; and emits
  a deterministic report plus an absolute pixel-difference PNG when dimensions
  match.
- Added exact and thresholded changed-pixel counts/fractions, RGBA MAE/RMSE,
  overall and per-channel deltas, dimension compatibility, and changed bounding
  box. Outcomes distinguish exact, within-tolerance, different, and incompatible
  dimensions without confusing scientific failure with record corruption.
- Added a dependency-free bounded PNG codec with signature/chunk/CRC/order
  validation, all five standard row filters, grayscale/indexed/RGB/gray-alpha/
  RGBA canonicalization, and fixed source-byte, chunk, dimension, pixel, and
  decompression limits.

### Interactive comparison and AI harness

- Extended every recorded PNG studio with verified rerun selection, frozen
  threshold controls, comparison history, baseline/candidate/blend/difference
  modes, difference gain, draggable source-pixel region selection, metrics,
  source provenance, and explicit pixel-only limitations.
- Creating a chat-linked comparison and saving an inspected view now append
  bounded hash-chained interactions containing exact source hashes, settings,
  metrics, region, blend, gain, and user direction for the next AI turn.
  Figure reproducibility also appears in harness activity, design status,
  computation/validation counts, project state, and scientific lineage.
- Added `sciencecode figure compare|list|show|verify`, including immutable
  `revision:ID` selectors, plus same-origin Lab create/list/detail/artifact APIs.

### NPU inventory resilience

- Separated ready ComputeAccelerator discovery from AppX package inventory so
  a failing Windows package database remains visible as diagnostics without
  hiding the AMD NPU. If the Windows ML catalog is degraded, Node and Python
  now independently permit only the exact manifest-recorded Vitis DLL under
  the protected Microsoft AMD WindowsApps package; status and inference do not
  acquire or download a provider.
- A fresh strict hardware smoke completed as immutable inference
  `20260811T091448Z-55d19c` with six profiled Vitis provider events, no
  fallback, five measured iterations at 0.5337 ms mean latency, and successful
  artifact/audit verification. Registration used the recorded WindowsApps DLL;
  the execution claim still came exclusively from the archived runtime profile.

### Verification and safety

- Verification re-resolves both original immutable sources, rehashes every
  stored artifact, decodes and deterministically recomputes the report,
  compares the decoded difference visualization pixel-for-pixel, verifies the
  audit link, and fails closed on source, report, manifest, or artifact drift.
- Project gates fail invalid comparison integrity but retain a verified
  `different` result as scientific attention. Lineage connects both source
  artifacts, copied inputs, report/difference outputs, conversation, and user
  inspection state.
- Added PNG filter/color/safety-bound tests plus core, CLI, API origin/path,
  artifact-serving, AI-context, harness, lineage, gate, tamper, and interactive
  UI contract coverage.
- Release validation passes 194/194 tests with 84.14% line, 69.23% branch,
  and 91.97% function coverage; `npm audit` reports zero vulnerabilities, and
  the 0.25.0 dry-run package contains 142 files including both new engines.
- A live local smoke compared two verified RTX 4090 reaction-diffusion
  figures with identical model parameters and distinct recorded seeds. The
  strict rule detected 26,099 changed pixels (1.1188%), emitted and reverified
  a 39,714-byte difference PNG, passed the whole-project integrity gate, served
  through an ephemeral Lab instance, and closed the server cleanly.

## 0.24.0 - 2026-08-11

### Verified comparative CAD studies

- Added an optional immutable CAD parent to the existing bounded experiment
  matrix. `sciencecode cad study BUILD SCRIPT` and `experiment run
  --cad-build BUILD` freeze that parent in the plan and manifest, pass the
  exact mesh to every child, record it in start/finish audit events, and fail
  verification if the build, mesh, experiment, or any child link drifts.
- Added deterministic extraction of final scalar statistics from the packaged
  nested surface-thermal summary without changing or overwriting already
  installed template bytes. Aggregate CSV and reviewer replay now compare
  thermal minima, means, maxima, ranges, and final update deltas.
- Added a reusable real-hardware smoke that drives a three-branch study through
  the same-origin Lab worker, AI context, harness, lineage, whole-project gate,
  and clean shutdown.

### Interactive study workspace and harness

- Added strict fixed-parameter, variation, seed, hypothesis, device, timeout,
  input, and GPU-reserve controls to CAD Studio. Matrices reuse the shared
  64-branch bound, run on one verified build, and appear as comparison cards
  with reviewer status, scalar ranges, per-branch parameters, direct opening
  of each rotatable 3D field, immutable-record links, and explicit non-FEA
  limitations.
- **Share comparison with AI** now records bounded branch counts, varied names,
  review verdict, and numeric aggregates for the next turn. CAD studies also
  appear in live activity, the main design-board gate, computation/validation
  counts, safety notes, and a direct mesh-hashed CAD-build-to-experiment edge.
- The worker/API path performs fresh CUDA availability and free-memory checks,
  exposes the experiment ID and aggregate review on the job, and keeps accepted
  studies non-cancellable so one coherent ledger is finalized.

### Verification

- Added core tamper, nested-summary, CLI, Lab schema/matrix/GPU/job, UI,
  next-turn AI, harness, and lineage coverage. The real CPU smoke completed and
  verified 3/3 branches on a 544-triangle CadQuery assembly; final mean surface
  temperature ranged from 40.0472 to 40.1870 Â°C, the 577-node/612-edge project
  gate passed, and the ephemeral Lab server closed.
- The RTX 4090 and CUDA runtime were detected, but only 135 MiB was free, so
  the run stayed on CPU. The AMD Vitis AI NPU and isolated CadQuery runtimes
  remained healthy; NPU readiness is not represented as CAD solver execution.

## 0.23.0 - 2026-08-11

### Recorded CAD surface simulation

- Added the packaged `cad-surface-heat` PyTorch model. It binds the exact
  verified ASCII STL, deduplicates a bounded triangle graph, applies explicit
  hot/cold bounding-face bands, enforces a conservative explicit-step
  diffusion number, and records device, precision, components, integration,
  boundary, finite, pinning, maximum-principle, and limitation evidence.
- The model emits immutable `summary.json`, `temperature-history.csv`, and
  `temperature-field.ply` artifacts. Its classification is deliberately
  `surface_graph_heat_diffusion_not_volumetric_fea`: it does not claim
  thickness, heat capacity, conductivity, convection, radiation, contact,
  finite elements, material qualification, or thermal safety.
- Added an end-to-end live thermal smoke through the same-origin Lab API,
  recorded model job, artifact server, PLY parser, AI interaction chain,
  modeled-by lineage, whole-project gate, GPU reserve check, and server cleanup.

### Interactive thermal workspace

- Added guided mesh-validation, surface-thermal, and custom CAD model presets.
  Built-in templates install additively, reuse only exact packaged bytes, and
  refuse to overwrite a different project file.
- Extended ASCII PLY inspection with property-name parsing, temperature/scalar
  ranges, a blue-to-red mesh legend, lit field faces, selectable vertex values,
  and exact scalar/range context for the next AI turn.
- Added thermal summaries and direct field opening in CAD history, plus thermal
  model/gate/safety state in the main harness work feed and side panel.

### Verification and reliability

- Added strict endpoint, overwrite-conflict, scalar-property-order, interaction,
  UI, harness, and template tests. Fixed generic CAD interaction summaries that
  referenced an undefined engine value and fixed live model smoke auto-selection
  to verify candidate builds.
- Verified the real CPU path on a 544-triangle CadQuery assembly: 276 scalar
  vertices, 544 rendered faces, 20–80 °C range, all numerical checks passing,
  exact CAD hash/lineage, AI-visible point selection, and a clean project gate.
  CUDA support remains available, but the live run correctly stayed on CPU
  because only 135 MiB of the RTX 4090 was free.

## 0.22.0 - 2026-08-11

### Budgeted hypothesis-tree campaigns

- Added schema-v2 immutable research campaigns with ordered root, alternative,
  refinement, mechanism, and rebuttal branches; strict unknown-field and
  earlier-parent validation; per-branch task/GPU/NPU ceilings; global attempt,
  accelerator, and wall-clock budgets; explicit AI disclosure; and preserved
  schema-v1 replay compatibility.
- Added deterministic branch-aware replay. Human continue/pause/prune/promote
  decisions gate linked tasks, promotion can explicitly reopen an inherited
  branch, pruned work remains terminal without execution, and branch ceilings
  block dispatch independently of the global budget.
- Added append-only `hypothesis.assessed` events with supported/challenged/
  falsified/inconclusive verdicts, exact completed-task basis, explicit
  supersession, secret scanning, human-checkpoint labeling, hash chaining,
  audit links, and independent semantic verification.
- Final assessments are result-relative: completed or skipped branch work after
  a verdict marks it stale and requires a fresh local-user checkpoint before a
  campaign can complete. Automatic pruning remains disabled.

### Interactive harness and AI boundary

- Added a responsive Campaigns workspace with an editable validated starter
  tree, task dependency studio, one-turn execution, live bounded output, stop/
  abandon handling, branch inspector, verdict and decision form, completed-task
  evidence selection, budget meters, event ledger, and current/stale/due state.
- Added campaign state to the main harness board, project counts, AI context,
  user interactions, and scientific lineage, including parent-child relation
  edges, branch verdict/effective state, next action, and budget use.
- Added CLI create/list/show/verify/decide/assess/advance/stop/abandon support,
  `templates/campaign.json`, the bundled `/campaign` workflow, expanded
  hypothesis-testing guidance, and canonical CLI denial for the Scientist's
  local-user assessment action.
- Kept the boundary honest: local-user assessment and network rules are
  workflow/prompt controls, not authenticated identity, container isolation,
  or an externally anchored audit system.

### Verification

- Added end-to-end engine, CLI, Lab HTTP, UI contract, harness, lineage,
  project-gate, backward-compatibility, stale-verdict, task-link, branch-budget,
  unsafe-policy, secret, retry, cancellation, and tamper coverage.

## 0.21.0 - 2026-08-11

### Multi-engine CAD and STEP interchange

- Added CadQuery as a first-class engine beside OpenSCAD. CAD descriptors now
  bind an explicit engine, matching entry type, named Python symbols, parameters,
  build volume, and deterministic linear/angular tessellation while preserving
  verification of historical schema-v1 OpenSCAD projects.
- Added a four-file CadQuery starter assembly and conflict-safe `.py` editing
  with immutable before/after revisions. Declared STEP/STP, IGES/IGS, BREP,
  Python, JSON, mesh, and 2D assets can coexist within the existing 256-file,
  512-part, and byte-bounded environment; binary files remain read-only.
- Added a packaged CadQuery adapter that accepts a Workplane, Shape, or Assembly
  from `build(parameters)` or `result`, exports independently analyzed ASCII
  STL plus STEP, records Python/CadQuery/OCP and geometry metadata, and
  canonicalizes volatile STEP timestamp metadata for reproducible output.
- Added declared STEP round-trip manipulation: CadQuery source can resolve an
  immutable binary input through `SCIENCECODE_SOURCE_ROOT`, import and transform
  it, and publish new STL/STEP outputs while the exact input hash remains bound.

### Isolated CAD runtime and provenance

- Added the independently pinned `python-cad-v1` runtime, `compute setup
  --profile cad`, definition hashes for both requirements and adapter source,
  stale-runtime refusal, explicit refresh, doctor/status reporting, and the
  `cadquery_parametric_cad` capability.
- CAD builds now hash the complete declared source snapshot before and after
  tool execution. A Python source addition, deletion, or mutation fails the
  build and remains inspectable rather than publishing outputs from changed
  inputs. This is detection, not an OS/network/Python sandbox.
- Routed CadQuery builds through the existing verified geometry screen,
  recorded CPU/GPU model parent, PrusaSlicer preview, audit, interactions,
  harness, lineage, artifact serving, and project-gate contracts.

### Interactive ScienceCode Lab

- Added an engine selector, editable many-file Python workspace, engine/runtime
  facts, CadQuery adapter report, verified STL and STEP downloads, and
  engine-aware jobs and AI context. Mesh drag/rotate/zoom/select, source edits,
  build selection, model outcomes, screens, slices, and directions continue to
  reach the next Scientist turn.
- Kept physical safety invariant: slicer preview remains non-transmitting,
  zero-extrusion and zero-temperature by default; no printer-control route was
  added.

### Verification

- Expanded the deterministic suite to 178 passing tests, including fake-engine
  end-to-end CadQuery/STEP, runtime isolation/freshness, source-mutation
  adversarial coverage, Lab/API/artifact, geometry, slicing, harness, and gate
  checks.
- Added `npm run smoke:cadquery`. On the real local CadQuery 2.8.0/OCP 7.9.3.1.1
  runtime it produced byte-identical repeated STL and STEP exports, imported
  the exact STEP into a second environment and verified a 5 mm transform, a
  watertight two-solid 544-triangle mesh, a verified geometry report, a safe
  PrusaSlicer preview, and a real ephemeral-Lab build whose downloaded
  artifacts rehashed exactly; the whole-project gate passed and the server
  closed.

## 0.20.0 - 2026-08-11

### Interactive CAD-linked models

- Added a first-class Lab launcher for project-relative Python models bound to
  the selected verified CAD build. The workspace accepts a bounded device,
  seed, timeout, JSON parameter object, JSON script-argument array, and
  project-relative declared inputs while defaulting to CPU.
- Added a strict same-origin POST /api/cad/builds/:id/models route, per-project
  serialization, live job events, result inspection, and exact project/build/
  chat cancellation binding. Launch, completion, failure, cancellation, script,
  device, parameters, CAD parent, and simulation ID become bounded AI-visible
  interactions.
- Added a shared asynchronous simulation lifecycle. Stopping a model terminates
  the owned process tree and finalizes an immutable cancelled manifest with
  logs, snapshots, partial artifacts, cancellation reason, audit links, CAD
  parent verification, and a failed-outcome project gate instead of stranding
  an ambiguous running record.
- Added a refreshed free-VRAM policy for Lab CUDA and auto-device launches.
  The default requires 2,048 MiB free and reports the selected GPU and observed
  memory; users can choose CPU or a bounded higher reserve, but the Lab cannot
  silently crowd another GPU workload.

### Verification

- Added completed, failed-request, low-VRAM, mismatched-cancellation, cancelled
  partial-artifact, AI-interaction, lineage, project-gate, and responsive UI
  tests for the new model path.
- Added npm run smoke:cad-model. The reusable smoke launches through a
  transient Lab server, verifies the immutable simulation and modeled_by edge,
  runs the complete project gate, closes the server, defaults to CPU, and
  refuses CUDA below a configurable free-memory threshold.
- Exercised that smoke against the real 84-triangle OpenSCAD QA assembly. The
  CPU model reproduced its 80 x 37 x 32 mm bounds, 6,759.794121 mm2 area,
  11,098.890300 mm3 volume, and 13.762624 g estimate. The resulting 68-node,
  68-edge project gate passed. A real CUDA attempt was refused before launch
  because the unrelated training workload left only 155 MiB free.

## 0.19.0 - 2026-08-11

### Multi-file parametric CAD

- Added a native ScienceCode CAD contract for up to 256 declared
  project-relative SCAD, STL, 3MF, OBJ, OFF, AMF, DXF, or SVG files and 512
  named parts in one environment. Static OpenSCAD include, use, import, and
  surface references are checked before execution; absolute, parent, dynamic,
  undeclared, linked, oversized, and secret-bearing sources fail closed.
- Added starter multi-file assemblies plus manifest import with
  sciencecode cad create. Imported sources are copied into a project-owned
  environment and bound to a normalized descriptor, source hashes, audit
  events, units, parts, transforms, parameters, build volume, material-density
  assumptions, and a no-hardware execution policy.
- Added conflict-safe SCAD reads and writes. Each source save checks the SHA-256
  seen by the editor and preserves immutable before/after files, a revision
  manifest, and an audit link instead of silently overwriting concurrent work.

### Rendering, simulation, and slicing

- Added immutable OpenSCAD builds with source snapshots, Manifold rendering,
  hard warnings, ASCII STL, tool output, OpenSCAD JSON summaries, and bounded
  independent mesh analysis for topology, bounds, area, volume, centroid, and
  orientation-dependent overhang indicators.
- Added a deterministic geometry/printability screen with build-volume fit and
  mass estimation. Its records explicitly exclude FEA, structural, thermal,
  fluid, fatigue, collision, tolerance, support, material, and printer-safety
  claims.
- Added verified CAD parents for arbitrary recorded CPU/GPU model scripts via
  sciencecode cad physics. The immutable STL is automatically declared as an
  input, supplied through bounded environment metadata, verified again with the
  simulation, exposed to the harness, and linked as
  cad-build -> modeled_by -> simulation in scientific lineage.
- Added a reusable cad-mesh-validation PyTorch template. On the real QA
  assembly it independently reproduced the 80 x 37 x 32 mm bounds,
  6,759.794121 mm2 area, 11,098.890300 mm3 volume, and 13.762624 g estimate.
- Added PrusaSlicer integration with a non-extruding, zero-temperature preview
  default and bounded G-code analysis. Printer-profile mode requires an
  explicit physical-risk acknowledgement, rejects post-process hooks, uses an
  isolated data directory, creates an immutable record, and never transmits to
  or controls a printer.

### Interactive CAD workbench and AI harness

- Added a dedicated responsive Lab CAD view with project/part facts, a
  multi-file rail, editable SCAD source, optimistic conflict handling,
  asynchronous build/screen/slice provenance, reports, history, and a
  depth-sorted shaded STL canvas with drag rotation, wheel zoom, and selection.
- G-code opens in the normal editable code studio and can become a verified
  immutable proposal. CAD source edits, file/build selections, mesh gestures,
  jobs, directions, revisions, and outcomes are bounded AI-visible interaction
  context rather than invisible browser state.
- Added CAD projects, builds, screens, slices, linked models, artifacts, hashes,
  failures, and safety boundaries to Lab state, the Scientist harness, lineage,
  the CLI gate, package checks, and the bundled OpenCode watcher exclusions.
- Added a cad-engineer specialist, cad-engineering skill, and /cad workflow.
  The primary Scientist now uses the exact render/verify/model/slice protocol
  and cannot relabel a lightweight geometry check as physics or a generated
  profile as printer authorization.

### Verification

- Added adversarial tests for traversal, dynamic and undeclared references,
  symlinks/record mutation through normal verifiers, stale edits, empty edits,
  artifact revision forgery, relative G-code coordinates, dangerous commands,
  profile post-processing, missing acknowledgement, CAD-parent tampering,
  lineage, project gates, CLI, Lab APIs, and responsive UI source contracts.
- Exercised the real installed OpenSCAD 2025.09.07 and PrusaSlicer 2.9.6
  toolchains end to end. The 84-triangle output was watertight, both preview
  slices contained zero extrusion/heater/homing/spindle commands, and the
  complete project gate passed.
- Revalidated the isolated GPU and NPU runtimes. The NVIDIA RTX 4090 CUDA
  runtime is healthy but the live GPU model was intentionally not crowded while
  an unrelated process left only 163 MiB free. A strict AMD NPU smoke completed
  with one profiled VitisAIExecutionProvider event and no fallback.

## 0.18.0 - 2026-08-10

### Actionable NPU inference in ScienceCode Lab

- Added a same-origin asynchronous inference-job route backed by the same
  immutable recorder as the CLI. It accepts a strict bounded schema, permits
  one accelerator inference at a time, exposes only safe request/result
  metadata, and reports queued, dispatch, runtime, and terminal events.
- Added an interactive Inferences launcher for deterministic hardware smoke or
  project-relative ONNX model/input paths. Users can choose strict NPU,
  explicit-fallback, or CPU policy; set bounded warmup/iteration/timeout
  values; monitor the runtime trace; stop a job; and open the verified result.
- Added optional conversation linkage. Completed/failed results and user stop
  requests become hash-chained `inference` interactions and lineage links, so a
  later AI turn can see the exact immutable record without confusing partial
  output with a completed result.

### Async recorder and safety

- Added `runInferenceAsync` with AbortSignal-aware worker execution while
  retaining the synchronous CLI contract and one shared immutable finalizer.
  Cancellation preserves partial logs/artifacts as a verified `cancelled`
  inference and remains a failed-outcome project gate by default.
- Canonicalized model/input files through realpath checks before publication,
  preventing project junction or symlink escapes. Lab launch validation rejects
  unknown fields, invalid ranges, secrets, cross-origin requests, confusing
  smoke inputs, and mismatched cancellation bindings.
- Added distinct cancelled-inference counts plus an `/inference` OpenCode
  command and `npu-inference` skill. Scientist, data-analysis, and
  drug-discovery guidance now require profiled provider attribution and
  explicit fallback status for NPU claims.

### Verification

- Added unit and live HTTP integration coverage for asynchronous completion,
  lifecycle events, one-job serialization, safe public payloads, chat/lineage
  links, cancellation, partial-artifact verification, project gates, UI
  contracts, and realpath escapes.
- Exercised the Lab route on the local AMD NPU in strict mode. The recorded
  smoke completed with four Vitis profile events, no fallback, a verified
  manifest, and a linked AI interaction while the unrelated NVIDIA GPU
  workload remained untouched.

## 0.17.0 - 2026-08-10

### Live conversational response blocks

- Added an opt-in projection for completed OpenCode JSON text parts during
  asynchronous Lab turns. Recorded harness activity stays metadata-only and
  never gains assistant content or raw tool input/output.
- Added a second redaction and control-character boundary in the Lab, an
  8-KiB per-block limit, repeated-part replacement, and a rolling maximum of
  32 blocks/48 KiB with explicit omitted-block and byte counts.
- Updated the pending assistant message in place while the job runs, with
  accessible busy state, bounded-preview metadata, conditional auto-follow,
  terminal state, and preservation of partial blocks through cancellation.
  The API explicitly reports completed-text-block granularity and
  `token_streaming: false`.

### Verification

- Added unit and integration coverage for opt-in archive separation,
  credential redaction, control removal, multibyte-safe truncation, aggregate
  response ceilings, repeated-part replacement, activity-content exclusion,
  running and terminal job states, cancellation, and Lab UI contracts.

## 0.16.0 - 2026-08-10

### Dual-accelerator compute and recorded NPU inference

- Added an isolated Windows ML NPU runtime beside the existing isolated
  CUDA/PyTorch GPU runtime. Compute status now reports GPU and NPU devices,
  drivers, runtime health, registered execution providers, and separate
  readiness capabilities without modifying a system Python or the user's
  existing OpenCode installation.
- Added explicit `gpu`, `npu`, and `all` setup profiles. Provider acquisition is
  permitted only during the explicit NPU setup action; status and inference do
  not silently download or install execution-provider packages.
- Added bounded ONNX `inference smoke` and `inference run` lifecycles with
  `npu`, `cpu`, and `auto` policies. A strict NPU request fails when profiled
  Vitis execution is not observed unless the user explicitly permits recorded
  fallback.
- Added immutable inference schema v2 records containing the exact model and
  JSON inputs, NPY outputs and interactive summaries, ONNX Runtime profile,
  latency, runtime manifest, before/after hardware state, logs, provider
  profile-event attribution, hashes, audit links, project gates, and backward
  verification for v1 records.
- Added inference CLI inspection and verification, lineage nodes and artifacts,
  chat links, harness NPU readiness/outcome counts, and an interactive Lab
  inference archive with output previews and manifest-bound downloads.

### Interruptible conversational harness

- Added abort-aware engine processes and recorded runs, a same-origin Lab
  cancellation endpoint, an active-turn Stop control, explicit cancelling and
  cancelled states, bounded partial-output preservation, and cancelled-run
  project gates.
- Cancellation is recorded as a hash-chained user interaction so the next AI
  turn sees that the partial response is incomplete. Terminal jobs remain
  inspectable without being counted as active supervisor work.

### Verification

- Added deterministic NPU detection/runtime, strict-fallback, input/archive,
  tamper, CLI, Lab, harness, lineage, project-gate, UI-contract, and
  backward-schema tests.
- Added an end-to-end cancellation test covering origin and chat binding,
  process abort delivery, partial transcript and run verification, explicit
  gate override, terminal re-cancel rejection, and AI-visible follow-up
  context.

## 0.15.0 - 2026-08-10

### Procedure Studio records and logical dry-runs

- Added strict neutral procedure schemas for objectives, domains, immutable
  evidence links, materials, equipment limits, controls, hazards and control
  hierarchy, dependency-linked steps, observations, deviation actions,
  acceptance criteria, stop conditions, training, emergency response, waste,
  automation targets, and the mandatory external-human-control policy.
- Added immutable staged procedure plans with normalization replay, source and
  supersession digests, exclusive publication, audit-backed deletion
  discovery, realpath/junction containment, bounded registries, and project
  gate verification.
- Added deterministic logical dry-runs for graph order and cycles, unknown
  resource references, control strategy, hazard completeness, known duration
  and material totals, and non-executable XDL 2.0 and Opentrons mapping
  previews. Reports explicitly decline facility safety, scientific validity,
  and hardware authorization claims.
- Added immutable current/historical assessments and scoped human decisions.
  Approvals require explicit local attestation; external physical scope also
  requires an expiry capped at 366 days. Blocked assessments cannot be
  approved, reviewer identity is never marked verified, and newer assessments,
  expired decisions, or superseding plans make prior approvals ineffective.

### Interactive Procedure workspace and visible harness

- Added the Lab **Procedures** workspace with an editable source-aware template,
  live step/dependency preview, local draft issues, current-plan revision
  loading, immutable freeze, logical dry-run, and reviewer decision forms.
- Added interactive inspectors for exact steps, resources, controls, hazards,
  gates, findings, adapter gaps, resource totals, decision basis, expiry, and
  identity/authority limitations. User-selected state can be recorded for the
  next AI turn without changing the archived records.
- Replaced the procedure harness placeholder with exact current plan,
  assessment, gate, adapter, and effective-decision state. The Design and
  Outcome panels link directly to records and keep hardware disabled visible.
- Added Procedure Studio nodes and edges to deterministic lineage, AI-context
  summaries, conversation record links, Lab state/detail/list/mutation APIs,
  project counts, and audit verification.
- Added the procedure CLI lifecycle, templates/procedure.json, upgraded bundled
  procedure/safety/methodology guidance, strict API origin/media/body gates,
  adversarial tamper/deletion/currentness tests, and responsive UI regression
  coverage.

## 0.14.0 - 2026-08-10

### Preregistered confirmatory analysis

- Added strict prospective analysis contracts that bind a verified frozen
  preregistration, exact Python script bytes, population and conditions,
  missing-data and multiplicity policies, exclusions, sensitivity analyses,
  and up to 32 operational primary, secondary, or exploratory outcomes.
- Each outcome freezes its result key, variable, unit, timepoint, summary
  measure, intercurrent-event strategy, exact experiment-branch filter,
  mean/median/minimum/maximum aggregation, minimum count, and numeric decision
  rule. Unknown fields, secrets, unsafe paths, invalid timestamps, and missing
  primary outcomes fail before immutable state is created.
- Added `--analysis-contract` to experiment execution. Bound experiments embed
  exact contract, preregistration, and script digests in the frozen plan and
  final manifest, refuse source-script drift, and verify prospective timing and
  cross-record links without invalidating older exploratory experiments.
- Added deterministic confirmatory assessments over verified branch
  `final_statistics`. Reports keep primary outcome verdict and
  prospective/deviated/unregistered registration status separate, preserve
  automatic and user-disclosed deviations, and explicitly decline p-value,
  confidence-interval, causal, clinical, and regulatory inference.
- Added exclusive staged/atomic contract and assessment records, complete
  normalization/report replay, audit-backed deletion discovery, symlink and
  Windows-junction containment, project-gate integration, and immutable
  current/historical assessment derivation.

### Interactive workbench and AI harness

- Added the Lab **Confirmatory** workspace with editable JSON contract design,
  preregistration and experiment selectors, explicit deviation entry,
  branch-level result cards, registration checks, exact digests/reports, and
  responsive record history.
- Freeze, assess, and user-focus actions create bounded hash-chained analysis
  interactions. The next AI turn receives exact primary thresholds, replayed
  values, missing counts, registration status, and deviations as untrusted
  user-authored context.
- Added confirmatory contracts and assessments to Lab state/detail/list APIs,
  the visible harness design/outcome boards, deterministic scientific lineage,
  conversation links, project counts, and integrity verification.
- Added `sciencecode analysis contract create|list|show|verify`, `sciencecode
  analysis assess`, and `sciencecode analysis assessment list|show|verify`,
  plus `templates/analysis-contract.json`.
- Added the bundled confirmatory-analysis skill, `/confirmatory` command, and
  independent read-only confirmatory-reviewer; updated scientist,
  methodologist, simulation, and experiment-review agents to use the contract
  before interpreting confirmatory work.

### Verification

- Added end-to-end tests for normalization and script drift, prospective and
  unregistered assessments, rerun history, CLI lifecycle, same-origin Lab API
  and UI contracts, AI handoff, harness, lineage, project gate, tampering,
  audit-backed removal, impossible timestamps, and filesystem-link escapes.

## 0.13.0 - 2026-08-10

### Independent semantic consistency reviewer

- Added immutable semantic-review records for verified Markdown/MDX,
  reStructuredText, TeX, and plain-text artifacts or exact saved revisions.
  Reports preserve source line/hash locators, deterministic settings, target
  and report hashes, audit links, and full replay verification.
- Added bounded claim extraction and citation resolution for ScienceCode
  evidence IDs, exact spans, pages, and already ingested DOI metadata. Recorded
  lexical overlap, literal-number agreement, and possible negation mismatch are
  explicitly labeled as triage rather than evidence of entailment. Reviewer
  engine v2 excludes both fenced and indented Markdown code; engine-v1 records
  remain reproducible through their recorded settings.
- Added a non-evaluating arithmetic parser for explicit
  `{{calc: expression = expected}}` directives and manifest-bound link checks
  for local data, code, and figures. Small UTF-8 data files can be checked for
  literal values; external or untracked artifacts become findings.
- Added the Lab **Reviewer** workspace with severity filters, claim/evidence
  excerpts, calculation inspection, artifact traces, limitations, and a
  user-direction handoff to the selected AI conversation. Manuscript studios
  can review the archived source or atomically save and review an immutable
  draft revision.
- Added reviewer visibility to the harness outcome board, project state,
  scientific lineage, AI interaction summaries, and project integrity gate.
  Scientific attention status stays separate from record tampering: a valid
  failing review remains valid provenance, while a damaged review fails closed.
- Added derived current/historical semantics for exact-target reruns. The newest
  verified review is current, prior reports remain reproducible with
  `superseded_by` lineage edges, and only current findings drive attention
  counters.
- Added `sciencecode review list|run|show|verify`, a read-only
  `semantic-reviewer` subagent, `/review-consistency`, and the bundled
  semantic-review skill.
- Added adversarial tests for forged sources, traversal, unsupported formats,
  DOI and exact-span resolution, calculation mismatch, unfrozen figures,
  report tampering, CLI lifecycle, live same-origin Lab APIs, harness/lineage
  integration, and AI-visible handoff.

## 0.12.0 - 2026-08-10

### Domain-native scientific studios

- Added a dependency-free chemical depiction engine for bounded SMILES and
  MOL/SDF V2000 artifacts. It supports molecule switching, explicit atoms and
  charges, branches, ring closures, disconnected components, aromatic and
  multiple bonds, recorded properties, deterministic 2D layout, anchored zoom,
  panning, and atom selection. MOL/SDF can switch to the existing draggable,
  spinning 3D coordinate viewer.
- Added a local genomic track engine for BED, bedGraph, GFF/GTF, VCF, and FASTA
  families with contig selection, zero-based half-open region entry, pointer/
  keyboard pan and zoom, coordinate rulers, type filters, signal/feature/
  variant glyphs, feature selection, and sequence letters at close zoom.
- Added a split manuscript studio for Markdown/MDX, TeX, and reStructuredText.
  It provides a live exact bounded LCS line diff, selectable review lines,
  responsive panes, line wrapping, a labeled coarse fallback for divergent
  large documents, and exact draft download/revision bytes.

### Editing, AI context, and safety

- Added collapsible chemical and genomic source editors. Applying a draft
  reparses only the local view; sharing writes a bounded secret-scanned
  interaction, while saving uses the immutable 0.11 proposal/decision workflow.
- Added first-class `chemical`, `genome`, and `manuscript` interaction surfaces.
  Molecule/atom, contig/region/feature, and selected diff state now receives
  domain-specific summaries in the next AI turn and appears in the normal
  audit, harness, lineage, transcript-context, and project verification paths.
- Added safe inline MIME handling for all new formats, canvas/DOM text-only
  rendering, parser/diff resource ceilings, explicit coordinate conversion,
  and honest limitations around stereochemistry, implicit hydrogens, indexed
  genomics, biological interpretation, and semantic manuscript review.

### Verification

- Added deterministic tests for SMILES charges/aromaticity/rings/bounds,
  MOL/SDF properties, BED/GFF/VCF coordinate semantics, bedGraph signals,
  FASTA and contig/feature bounds, reversible chemical/genomic transforms,
  exact/coarse manuscript diffs, bounded AI changes, and domain interaction
  summaries.
- Extended live Lab tests to serve every local module plus manifest-bound
  SMILES, VCF, and manuscript artifacts with the intended MIME and inline
  security behavior. Expanded UI contract and responsive-style assertions.

## 0.11.0 - 2026-08-10

### Immutable derived-artifact revisions

- Added immutable replacement files for manifest-bound simulation,
  experiment, evidence, and notebook artifacts. Every revision records exact
  source and replacement hashes, sizes, media type, creation conversation,
  optional rationale, and an optional prior revision without overwriting the
  producing record.
- Added append-only accept/reject decision chains with independent hashes and
  audit events. The current revision status is derived from the latest verified
  decision; acceptance is an explicit review signal and does not rewrite an
  upstream artifact or project file.
- Added canonical artifact-route resolution, source-record verification,
  exclusive staging/rename writes, 8 MiB replacement limits, 256-version chain
  bounds, secret preflight, realpath/symlink containment, audit-backed deleted
  record discovery, and project-gate failure for tampering or missing records.

### Interactive output versioning

- Added inline revision ledgers to code, CSV/TSV, and real `.xlsx` studios.
  Users can save exact edited output, inspect prior versions and digests, add a
  rationale, open immutable files, and explicitly accept or reject proposals.
- Added bounded base64 transport for binary workbook revisions, canonical
  same-origin revision create/list/detail/decision/artifact routes, and safe
  feedback when an immutable revision succeeds but AI interaction handoff does
  not.
- Made notebook-generated rich files open in the same interactive output
  studios, extending editing and versioning to kernel-produced artifacts.

### Provenance, AI context, and tooling

- Added revision and decision nodes plus `derived_as`, `revised_as`,
  `reviewed_as`, and `produced` relationships to scientific lineage. Pending
  proposals become visible review findings, while valid rejection remains a
  preserved scientific outcome.
- Added exact revision manifest/replacement paths and latest decision semantics
  to AI-visible interaction context, including an explicit instruction never
  to substitute rejected revisions.
- Added `sciencecode revision list/create/show/verify/decide`, public core APIs,
  project counts and integrity checks, adversarial tamper/path/secret/deletion
  tests, binary API coverage, live Lab coverage, and UI contract tests.

## 0.10.0 - 2026-08-10

### Verified scientific lineage

- Added a deterministic, read-only graph spanning evidence sources and ranked
  spans, retrievals, conversations and turns, engine runs, notebook kernels and
  cells, immutable code/data inputs, preregistrations, experiment matrices,
  simulation branches, manifest-bound artifacts, and user interactions.
- Added explicit containment, ordering, grounding, AI-context, execution,
  branch, production, and revision edges. Dangling references become visible
  invalid nodes instead of being omitted; record failures, failed outcomes,
  pending user state, unresolved sources, missing hypotheses, and ungrounded
  completed turns produce deterministic review findings.
- Added stable sorting and a graph SHA-256 that excludes request time. Current
  conversation scope returns only its connected lineage component, while the
  project graph remains available for complete review.
- Added lineage integrity to `sciencecode gate` plus
  `sciencecode lineage show/verify` for CLI inspection.

### Interactive Lineage workspace

- Added a dependency-free SVG graph to the Lab with pointer panning, wheel
  zoom, fit/reset, record and integrity filters, keyboard-selectable nodes,
  upstream/downstream/both traversal, exact hash/metadata inspection, linked
  record navigation, and inline review findings.
- Selecting a node quietly appends AI-visible state for the active conversation.
  Sharing a trace records its graph digest, direction, bounded node IDs, and
  optional user instruction through the existing secret-scanned, hash-chained
  interaction path; archived records remain unchanged.
- Added a read-only `/api/lineage` endpoint, chat-scoped HTTP coverage,
  deterministic/tamper/project-gate tests, and browser-independent layout and
  traversal tests.

## 0.9.0 - 2026-08-10

### Persistent scientific notebooks

- Added one long-lived project-owned Python or optional R worker per live
  language, with retained namespace, monotonic execution counts, busy state,
  timeout, interrupt, restart, graceful shutdown, and project-lock ownership.
- Added append-only cell records containing immutable source, bounded
  stdout/stderr, visible result or error, variable/type/shape summaries,
  imported dependency versions, project-file changes, runtime/process identity,
  Matplotlib PNG outputs, hash-chain links, independent digests, and audit links.
- Added explicit restore versus clean-start semantics. Restore verifies all
  history and replays only completed cells in order; it refuses tampered or
  non-completed histories and never occurs silently after process loss.
- Preserved error, timeout, and interruption attempts as verifiable cells while
  making them fail the default project gate unless explicitly reviewed with
  `--allow-failed-kernel-cells`.

### Interactive Notebook workspace

- Added a responsive Python/R Notebook view with runtime facts, explicit
  restore/start/restart/interrupt controls, editable new cells, keyboard run,
  immutable history, source-to-draft loading, streams, results, errors,
  clickable variables, dependencies, file changes, and rich figure output.
- Added same-origin kernel list/detail/execute/restore/restart/interrupt and
  manifest-bound artifact routes. Lab shutdown terminates owned workers and
  removes their project locks.
- Linked executed cells to selected conversations. The next AI turn receives a
  bounded verified JSONL summary of recent linked notebook state plus any
  user-authored notebook interaction; transcript verification rebuilds the
  exact context and detects later cell tampering.
- Added `sciencecode kernel status/list/exec/show/verify`; CLI execution uses a
  private child lifecycle and requires `--restore` or `--fresh` when history
  already exists.

### Hardening and validation

- Kept kernel transport private to stdin and project-confined files instead of
  exposing an unauthenticated local TCP socket. Secret preflight and code-size
  validation happen before creating a kernel record.
- Added storage realpath/junction escape rejection, bounded artifacts and
  values, stale async Notebook-response suppression, and case-insensitive
  Windows `Path`/`PathExt` resolution for plain isolated environment objects.
- Added real local-Python tests for state continuity, explicit replay, AI
  context, CLI lifecycles, Lab APIs, interruption, timeout, errors, tampering,
  failed-cell gates, origin checks, path escapes, optional-R absence, and clean
  server shutdown.

## 0.8.0 — 2026-08-10

### Immutable evidence and deterministic retrieval

- Added project-confined PDF, Markdown, reStructuredText, and plain-text
  ingestion with immutable source copies, bibliographic DOI/title/author/year
  metadata, normalized page JSONL, overlapping span JSONL, artifact hashes,
  independent manifest digests, and audit links.
- Pinned Mozilla `pdfjs-dist@5.4.624` and isolated extraction in a bounded child
  process. Raised the Node baseline to 20.16 to match the extraction runtime.
- Added versioned Unicode tokenization, stop words, and BM25 ranking. Retrieval
  records retain only query digests, exact historical corpus manifest hashes,
  settings, limits, ranked page/span hashes, and audit provenance.
- Grounded matching chat turns with at most four JSONL-quoted evidence spans
  and an explicit untrusted-source-data rule. Transcript verification replays
  the ranking against the historical corpus and validates every cited span.
- Added `sciencecode evidence add/list/show/search/verify` and project-gate
  verification for every evidence and retrieval record.

### Interactive evidence workspace

- Replaced the placeholder Evidence archive with a same-origin local ingestion
  form, deterministic search, ranked snippets, bibliography and integrity
  details, immutable-source links, and a page-addressable text reader.
- Added evidence source/page selections and plain-language directions as
  bounded, secret-scanned, hash-chained interactions visible to the next AI
  turn and the live harness.
- Added manifest-bound evidence source/page APIs, loopback/origin/path guards,
  responsive UI, and focused PDF, retrieval, replay, tamper, CLI, chat, gate,
  interaction, and live HTTP tests.

## 0.7.0 — 2026-08-10

### Figure and plot workbench

- Added manifest-bound raster figure studios with drag panning, anchored wheel
  zoom, keyboard navigation, normalized point placement, and local annotation
  overlays for observations, questions, and requested revisions.
- Added native line/scatter plot views for CSV, TSV, and active `.xlsx`
  worksheets. Axis selection, pan, zoom, source-row selection, and edited-cell
  refresh all run locally without mutating the archived data artifact.
- Added plain-language plot direction plus explicit figure-view, annotation-set,
  and annotation-clear interactions. Their artifact link, view, coordinates,
  selected row, and user direction become bounded context for the next AI turn.
- Extracted plot sampling, bounds, transforms, point selection, figure fitting,
  normalized coordinates, and anchored zoom into a dependency-free tested
  visualization module capped at 5,000 rendered points.
- Added responsive controls, keyboard affordances, same-origin static serving,
  interaction/API integration tests, and immutable revision semantics.

## 0.6.0 — 2026-08-10

### Visible scientific harness

- Added research-goal classification and stage-gated boards for drug
  discovery, procedure development, computational science, evidence synthesis,
  and general research.
- Added explicit supervisor, evidence, scientist, methodologist, discovery,
  procedure, compute, independent-review, and recorder lanes whose displayed
  states are derived from verified records instead of invented progress.
- Added nonblocking Lab jobs with polling and a bounded live event stream.
  Public tool events expose tool, title, status, and timing while excluding
  tool inputs and outputs.
- Added original drug-discovery, procedure-development, and model-credibility
  skills plus discovery, procedure, and independent safety specialists.

### Interactive AI workspace

- Added editable code, CSV/TSV, and real `.xlsx` output studios with
  multi-sheet workbook editing and downloadable local drafts,
  and a native interactive 3D renderer for PDB, MOL/SDF, XYZ, OBJ, and ASCII
  PLY artifacts with drag rotation, wheel zoom, auto-spin, and point selection.
- Added an append-only, SHA-256-chained user-interaction record. Code drafts,
  cell changes, 3D views/selections, stage focus, and outcome directions appear
  in the harness and are supplied as user-authored context to the next AI turn.
- Kept archived artifacts immutable: workspace edits become separately
  verifiable interaction records rather than silent overwrites.
- Added secret scanning for payloads and artifact labels, 48 KiB payload bounds,
  10,000-record/32 MiB log bounds, audit links, transcript cross-checks,
  project-gate counts, same-origin APIs, and tamper tests for interactions.
- Redacted credential-shaped details from browser-visible asynchronous failures.
- Kept workbook parsing local and dependency-free after rejecting a candidate
  library whose current dependency tree failed the production audit gate.

### Research and validation

- Grounded the harness design in primary sources on Claude Science, Google AI
  co-scientist, Biomni, Robin, Coscientist, ChemCrow, XDL/chemputation, and FDA
  good-AI-practice and credibility principles.
- Added focused tests for streamed engine execution, safe event projection,
  workflow derivation, async API jobs, interaction-to-AI context, secret
  rejection, and chain/audit tamper detection.

## 0.5.0 — 2026-08-10

### Conversational research workbench

- Made recorded conversation the primary Lab interaction instead of requiring
  users to leave the harness for the upstream engine UI.
- Added persistent ScienceCode conversations backed by the pinned, isolated
  OpenCode session engine. Follow-up turns continue the same engine session.
- Recorded every user message and assistant response in an append-only,
  SHA-256-linked transcript with exact run, prompt, event, change, and audit
  cross-links.
- Automatically linked simulations, experiments, preregistrations, and nested
  recorded runs created during a turn back to the conversation.
- Added transcript verification to the project gate and kept failed outcomes
  distinct from record-integrity failures.

### Interactive Lab

- Added same-origin JSON endpoints for creating conversations and running
  research turns while retaining loopback-only binding.
- Added request size limits, secret preflight, Host/Origin/Sec-Fetch-Site
  checks, per-conversation serialization, and transcript path containment.
- Rebuilt the first viewport around conversations, scientist progress,
  generated-output links, live GPU context, project evidence, and transcript
  verification.

## 0.4.0 — 2026-08-10

### Local scientific compute

- Added an isolated Python 3.11 scientific runtime under `SCIENCECODE_HOME`
  with pinned NumPy, SciPy, pandas, Matplotlib, and CUDA-enabled PyTorch.
- Added NVIDIA detection, runtime setup/status commands, deterministic CUDA
  controls, runtime manifests, and compute diagnostics.
- Added recorded Python simulations with exact source/runtime/input capture,
  GPU metadata, generated artifact hashing, append-only manifests, audit links,
  list/show/verify commands, and project-gate integration.
- Added a Gray–Scott reaction-diffusion GPU template and simulation specialist.

### Experiment matrices and review

- Added hypothesis-driven, multi-seed Cartesian parameter matrices with a
  64-branch cap and sequential GPU execution.
- Linked every branch to its immutable parent plan while keeping each branch an
  independently verifiable simulation.
- Added aggregate CSV export, finite-value/coverage checks, descriptive
  statistics, deterministic reviewer verdicts, cross-record verification, and
  failed-outcome gate policy.
- Added `/experiment` plus an independent read-only experiment-reviewer agent.

### Visual Lab

- Added a dependency-free, responsive local Lab for compute health, experiment
  comparisons, reviewer findings, branch navigation, generated figures,
  runtime metadata, and recorded artifacts.
- Restricted Lab to loopback and GET/HEAD, added CSP/security headers, and
  limited artifact access to manifest-bound, realpath-contained files.

### Validation

- Validated a 512x512, 1,200-step recorded workload and a four-branch
  multi-seed parameter sweep on an NVIDIA GeForce RTX 4090 with CUDA 13.0.
- Expanded automated coverage for compute, simulations, experiments, Lab APIs,
  tamper detection, traversal/symlink containment, secret preflight, matrix
  bounds, and the distinction between integrity and outcome status.

## 0.3.0 — 2026-08-09

### Standalone product boundary

- Pinned `opencode-ai@1.18.15` as a local ScienceCode engine dependency.
- Removed all implicit reliance on a global `opencode` command.
- Added `SCIENCECODE_HOME` with isolated config, auth, session, cache, and state
  roots.
- Replaced inherited OpenCode/XDG config variables for engine processes and
  disabled global Claude-compatible config discovery.
- Added `sciencecode paths` so the boundary is directly inspectable.

### Runtime and provenance

- Fixed Windows npm command-shim execution without enabling a general shell for
  prompt arguments.
- Added default OpenCode JSON-event capture and readable event rendering.
- Added artifact digests, final manifest digests, run listing/inspection, and
  `verify-run`.
- Added sequenced audit records, a consistency head, cross-process locking,
  truncation checks, and `sciencecode audit`.
- Added project-wide `sciencecode gate` verification.

### Scientific workflow

- Added immutable preregistration freeze/list/show/verify commands.
- Added preregistration and structured reviewer templates.
- Expanded destructive-command guardrails for Windows, Unix, and Git.

### Quality

- Expanded the automated suite from 7 tests to cross-platform unit,
  integration, security, CLI, runtime-isolation, and real bundled-engine tests.
- Added Windows/macOS/Linux CI, package-file controls, an MIT license, pinned
  dependencies, and a lockfile.
- Corrected outdated version and architecture documentation.

## 0.2.0 — 2026-08-09

- Added hash-chained local audit events.
- Added prompt secret detection and captured-log credential redaction.
- Removed raw prompt content from run manifests.
- Added enterprise-readiness release-gate documentation.

## 0.1.0 — 2026-08-09

- Added the first runnable research launcher, scientist/subagents, five
  research skills, five workflow commands, run manifests, SHA-256 snapshots,
  verification, diagnostics, preservation policy, and automated tests.
