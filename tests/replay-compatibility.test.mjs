import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PHARMACOLOGY_ENGINE_VERSION,
  RETRIEVAL_SETTINGS,
  RETRIEVAL_SETTINGS_DIGESTS,
  STATISTICS_ENGINE_VERSION,
  SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS,
  SUPPORTED_RETRIEVAL_SETTINGS_VERSIONS,
  SUPPORTED_STATISTICS_ENGINE_VERSIONS,
  adjustPValues,
  buildExperimentReview,
  doseResponseFit,
  effectSize,
  ingestEvidence,
  mannWhitneyUTest,
  oneSampleTTest,
  pairedTTest,
  parseLiteratureResponse,
  rankValues,
  searchEvidence,
  sha256Json,
  standardNormalCdf,
  studentTCdf,
  studentTQuantile,
  tConfidenceInterval,
  tostPValue,
  welchTTest,
  wilcoxonSignedRankTest
} from '../lib/core.js';

// Verification of a frozen record re-derives its content with current code and
// compares it byte-exactly against what was stored. Any unconditional change to
// a replayed derivation therefore breaks verification of every record already
// frozen under the old behavior — permanently, and silently, because every
// other test in this suite creates a record with current code and verifies it
// immediately, which cannot detect the difference.
//
// These digests are that missing tripwire.
//
// A FAILURE HERE IS NOT A REASON TO RE-PIN THE CONSTANT. It means a replayed
// derivation changed shape or value. The change must either be dispatched on a
// version recorded in the frozen record (see the `engineVersion >= N` pattern
// in lib/confirmatory.js) so older records keep replaying as written, or be
// accepted as a deliberate break of every existing record. Re-pin only after
// making that choice explicitly.
//
// The one exception: Math.log/exp/sin precision is implementation-defined in
// ECMA-262 and V8 has changed it across releases, so a Node upgrade can flip a
// last-ulp digit here with no code change. That affects real verification too
// — confirm the diff is a last-digit float change before re-pinning.

test('the statistics engine is bit-stable for fixed inputs', () => {
  // Every inferential record's stored statistic, p-value, and interval is
  // replayed through these functions at verification.
  const probe = {
    one_sample: oneSampleTTest([1.2, 2.4, 3.1, 4.8, 5.3], 2, 'two_sided'),
    welch: welchTTest([620, 655, 640, 630], [510, 505, 520, 515], 'two_sided', 0),
    paired: pairedTTest([10, 12, 14, 16], [9, 12, 13, 14], 0, 'greater'),
    tost: tostPValue({ estimate: 1, standardError: 0.5, degreesOfFreedom: 9, lower: -5, upper: 5 }),
    tost_one_sided: tostPValue({ estimate: 1, standardError: 0.5, degreesOfFreedom: 9, lower: -5 }),
    // Several quantile/cdf points, so a change confined to one branch of the
    // Newton solve or the tail expansion still fires.
    quantile: [studentTQuantile(0.975, 9), studentTQuantile(0.005, 3), studentTQuantile(0.999, 120)],
    cdf: [studentTCdf(1.5, 7), studentTCdf(-4.2, 2), studentTCdf(0, 15)],
    adjust: adjustPValues([0.01, 0.04, 0.2], 'holm_bonferroni', 3),
    // Effect sizes and intervals are replayed into every confirmatory report.
    effect_one: effectSize(oneSampleTTest([1.2, 2.4, 3.1, 4.8, 5.3], 2, 'two_sided'), 2),
    effect_welch: effectSize(welchTTest([620, 655, 640, 630], [510, 505, 520, 515], 'two_sided', 0), 0),
    effect_paired: effectSize(pairedTTest([10, 12, 14, 16], [9, 12, 13, 14], 0, 'greater'), 0),
    ci_two: tConfidenceInterval({ estimate: 1.5, standardError: 0.4, degreesOfFreedom: 12, sidedness: 'two_sided', level: 0.95 }),
    ci_greater: tConfidenceInterval({ estimate: 1.5, standardError: 0.4, degreesOfFreedom: 12, sidedness: 'greater', level: 0.95 }),
    ci_equiv: tConfidenceInterval({ estimate: 1.5, standardError: 0.4, degreesOfFreedom: 12, sidedness: 'equivalence', level: 0.9 })
  };
  assert.equal(sha256Json(probe),
    'b2a1a66688a8b77a1f2a9922f7f780460df7926e43051179d2275f1d2c0c4cee');
});

test('the rank-based engine is bit-stable for fixed inputs', () => {
  // Rank tests will be replayed into confirmatory reports the same way the
  // t-tests are, so they belong under the same tripwire from the start.
  // Coverage note: the first version of this probe held only two-sided and
  // exact cases, so it did NOT change when a real one-sided continuity bug was
  // fixed. Every distinct code path now appears here — one-sided under the
  // normal approximation, dropped zeros, a nonzero null, and a degenerate
  // result — because a tripwire that misses a path is worse than none.
  const probe = {
    mw_exact: mannWhitneyUTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], 'two_sided'),
    mw_ties: mannWhitneyUTest([1, 2, 2, 3, 5, 5, 7, 8], [2, 3, 3, 4, 5, 9, 10, 11], 'two_sided'),
    mw_greater: mannWhitneyUTest([22, 25, 31, 40, 19, 28], [15, 17, 20, 24, 13, 18], 'greater'),
    mw_approx_greater: mannWhitneyUTest([1, 0, 4], [4, 2, 0], 'greater'),
    mw_approx_less: mannWhitneyUTest([2, 2, 1], [1, 2, 0], 'less'),
    wsr_exact: wilcoxonSignedRankTest([2, 4, 6, 8, 10], [1, 2, 3, 4, 5], 0, 'two_sided'),
    wsr_ties: wilcoxonSignedRankTest(
      [10, 12, 14, 16, 18, 20, 22, 24], [9, 11, 14, 15, 17, 19, 21, 23], 0, 'two_sided'),
    wsr_approx_greater: wilcoxonSignedRankTest([5, 8, 3, 9, 12, 4, 7], [6, 5, 4, 7, 10, 6, 5], 0, 'greater'),
    wsr_zeros: wilcoxonSignedRankTest([10, 10, 10, 11, 12], [10, 10, 10, 10, 10], 0, 'two_sided'),
    wsr_shifted_null: wilcoxonSignedRankTest([12, 13, 14, 15, 16], [10, 10, 10, 10, 10], 2, 'two_sided'),
    // A declared null shift on the unpaired test is its own path.
    mw_shifted: mannWhitneyUTest([112, 115, 109, 120, 107], [11, 14, 8, 19, 6], 'two_sided', 0.95, 100),
    degenerate: mannWhitneyUTest([5, 5, 5], [5, 5, 5], 'two_sided'),
    ranks: rankValues([10, 20, 20, 30, 5]),
    normal: [standardNormalCdf(1.96), standardNormalCdf(-4), standardNormalCdf(0.5)]
  };
  assert.equal(sha256Json(probe),
    'fd3cfac799acfc59fcc7fb44a4ebb2d2f31fd8a6222efb3406ebea1080edef7b');
});

test('the dose-response engine is bit-stable for fixed inputs', () => {
  // A fitted potency is meant to be frozen into a verifiable record, so the
  // optimizer's output must be reproducible bit for bit. Every path is
  // covered: exact fit, noisy fit, an unobserved plateau, the fixed-bottom
  // model, and a degenerate flat response.
  const logistic = (x, [bottom, top, logHalf, hill]) =>
    bottom + (top - bottom) / (1 + Math.pow(10, (Math.log10(x) - logHalf) * hill));
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const clean = doses.map((dose) => logistic(dose, [0, 100, Math.log10(250), 1]));
  const perturbation = [1.5, -1.5, 0, 1.5, -1.5, 0, 1.5, -1.5, 0];
  const probe = {
    exact: doseResponseFit({ concentrations: doses, responses: clean }),
    noisy: doseResponseFit({
      concentrations: doses,
      responses: clean.map((value, index) => value + perturbation[index])
    }),
    partial: doseResponseFit({ concentrations: [1, 3, 10, 30, 100], responses: [100, 96, 88, 74, 61] }),
    three_param: doseResponseFit({
      concentrations: doses, responses: clean, model: 'three_parameter_logistic', bottom: 0
    }),
    degenerate: doseResponseFit({ concentrations: [1, 10, 100, 1000], responses: [50, 50, 50, 50] }),
    // A failed fit and an increasing curve are distinct code paths and belong
    // under the tripwire too.
    failed: doseResponseFit({ concentrations: [1, 10, 100, 1000], responses: [1, 99.01, 50, 0.99] }),
    increasing: doseResponseFit({
      concentrations: doses,
      responses: doses.map((dose) => logistic(dose, [100, 0, Math.log10(250), 1]))
    })
  };
  assert.equal(sha256Json(probe),
    '3f2b0d3b4b86b809baddb030cdf77ae31fa0deec23aaa5a64744178869013c2d');
});

test('experiment review derivation is stable for a fixed input', () => {
  // Replayed by verifyExperiment as review_calculation_mismatch.
  // Rows must be shaped so numericAggregates() is actually entered: it reads
  // status 'completed', verified, simulation_id, and final_statistics. An
  // all-zero degenerate review would pin nothing worth pinning.
  const results = [
    { branch: 0, status: 'completed', verified: true, simulation_id: 'sim-a',
      final_statistics: { yield: 0.514, runtime_s: 12.25 } },
    { branch: 1, status: 'completed', verified: true, simulation_id: 'sim-b',
      final_statistics: { yield: 0.623, runtime_s: 11.5 } },
    { branch: 2, status: 'completed', verified: false, simulation_id: 'sim-c',
      final_statistics: { yield: 0.481, runtime_s: 13.75 } }
  ];
  const review = buildExperimentReview(results, 3);
  assert.ok(Object.keys(review.numeric_aggregates).length > 0,
    'the probe must exercise numeric aggregation, not the empty path');
  assert.equal(sha256Json(review),
    'fcf9457775d3c267e2ed0b84c89f93390dca000200bf0389e85e2eca431fe1b3');

  // quantityMode selects a different schema_version and two extra output keys.
  assert.equal(sha256Json(buildExperimentReview(results, 3, { quantityMode: true })),
    '4a55f2ad4192af4b6ba1448733f6b5fdef2a38545e45026676f3c331da8ed87c');
});

test('literature parse derivation is stable for frozen upstream bytes', () => {
  // Replayed by verifyLiterature as parse_replay_mismatch: the stored upstream
  // response is re-parsed with current adapter code.
  const response = Buffer.from(JSON.stringify({
    message: {
      DOI: '10.1000/example',
      title: ['A worked example'],
      author: [{ given: 'Ada', family: 'Lovelace' }],
      'container-title': ['Journal of Examples'],
      issued: { 'date-parts': [[2026, 3, 14]] },
      type: 'journal-article'
    }
  }));
  assert.equal(
    sha256Json(parseLiteratureResponse('crossref', response, '10.1000/example')),
    '0d20f9d4744f1db1114d084ec0f75daa6a8592e688eedbc34e4a1b86c39d0478');
});

test('the dose-response engine records a version that matches its behavior', () => {
  // The fitter's semantics changed several times before anything persisted a
  // potency: convergence, direction, plateau coverage, the search itself. The
  // recorded version has to move with them, because once a fit is frozen the
  // version is the only thing that can tell a replay which maths produced it.
  assert.ok(PHARMACOLOGY_ENGINE_VERSION >= 2);
  assert.ok(SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS.includes(PHARMACOLOGY_ENGINE_VERSION));
  assert.deepEqual(
    [...SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS],
    [...SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS].sort((left, right) => left - right)
  );
  // Every fit carries its engine version, so a stored result is self-describing.
  const fit = doseResponseFit({
    concentrations: [1, 10, 100, 1000, 10000],
    responses: [99, 90, 50, 10, 1]
  });
  assert.equal(fit.engine.version, PHARMACOLOGY_ENGINE_VERSION);
  assert.equal(fit.engine.name, 'sciencecode-dose-response');
});

test('the supported statistics engine set only ever grows', () => {
  // Dropping a version from this set orphans every record frozen under it.
  for (const version of [2, 3, 4]) {
    assert.ok(SUPPORTED_STATISTICS_ENGINE_VERSIONS.includes(version),
      'engine v' + version + ' has shipped and must stay replayable');
  }
  assert.ok(SUPPORTED_STATISTICS_ENGINE_VERSIONS.includes(STATISTICS_ENGINE_VERSION));
  assert.deepEqual(
    [...SUPPORTED_STATISTICS_ENGINE_VERSIONS],
    [...SUPPORTED_STATISTICS_ENGINE_VERSIONS].sort((left, right) => left - right)
  );
});

test('evidence retrieval replays under the settings its record was frozen with', () => {
  // The retrieval record stores its settings in full, so a future settings
  // version must not silently re-rank results already stored under v1.
  assert.deepEqual([...SUPPORTED_RETRIEVAL_SETTINGS_VERSIONS], [1]);
  assert.equal(RETRIEVAL_SETTINGS.version, 1);
  assert.ok(SUPPORTED_RETRIEVAL_SETTINGS_VERSIONS.includes(RETRIEVAL_SETTINGS.version));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-retrieval-replay-'));
  fs.writeFileSync(path.join(directory, 'notes.txt'),
    'Buffer stability depends on temperature. Cold storage preserves the buffer. ' +
    'Warm storage degrades the reagent rapidly and reduces measured yield.\n');
  const record = ingestEvidence({
    cwd: directory,
    source: 'notes.txt',
    title: 'Storage notes'
  });

  const current = searchEvidence(directory, 'buffer storage', { limit: 3 });
  assert.ok(current.results.length > 0);
  assert.equal(current.settings.version, 1);

  // Explicitly passing the recorded settings must reproduce the ranking bit
  // for bit; that is exactly what verification does.
  const replayed = searchEvidence(directory, 'buffer storage', {
    limit: 3,
    settings: current.settings
  });
  assert.equal(sha256Json(replayed.results), sha256Json(current.results));
  assert.equal(replayed.settings_sha256, current.settings_sha256);

  // A settings version this build cannot rank under must be refused loudly
  // rather than silently ranked with current parameters.
  assert.throws(() => searchEvidence(directory, 'buffer storage', {
    limit: 3,
    settings: { ...RETRIEVAL_SETTINGS, version: 99 }
  }), { code: 'UNSUPPORTED_RETRIEVAL_SETTINGS' });

  // Settings that claim a published version but differ from it must be
  // refused. Otherwise a record could be frozen under arbitrary parameters
  // while claiming v1, and every later verification would agree with it,
  // because the replay uses those same stored settings.
  for (const offSpec of [
    { ...RETRIEVAL_SETTINGS, k1: 2.5 },
    { ...RETRIEVAL_SETTINGS, b: 0.1 },
    { ...RETRIEVAL_SETTINGS, maximum_results: 500 },
    { ...RETRIEVAL_SETTINGS, tokenizer: 'nonsense' },
    { ...RETRIEVAL_SETTINGS, stop_words: 'none' }
  ]) {
    assert.throws(() => searchEvidence(directory, 'buffer storage', {
      limit: 3,
      settings: offSpec
    }), { code: 'UNSUPPORTED_RETRIEVAL_SETTINGS' },
    'off-spec settings claiming v1 must be refused');
  }

  // The published digest must describe the constant this build actually uses.
  assert.equal(RETRIEVAL_SETTINGS_DIGESTS[1], sha256Json(RETRIEVAL_SETTINGS));

  // The named stop-word list must genuinely be applied, or the settings would
  // describe ranking behavior they do not control.
  assert.equal(searchEvidence(directory, 'the and of', { limit: 3 }).results.length, 0);
  assert.ok(record.manifest.evidence_id);
});
