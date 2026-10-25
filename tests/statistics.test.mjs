import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INFERENCE_TESTS,
  MULTIPLICITY_CORRECTIONS,
  RANK_BASED_INFERENCE_TESTS,
  STATISTICS_ENGINE_NAME,
  STATISTICS_ENGINE_VERSION,
  adjustPValues,
  effectSize,
  tostPValue,
  logGamma,
  oneSampleTTest,
  pairedTTest,
  regularizedIncompleteBeta,
  sampleMoments,
  studentTCdf,
  studentTQuantile,
  tConfidenceInterval,
  tTestPValue,
  welchTTest
} from '../lib/core.js';

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    'expected ' + actual + ' within ' + tolerance + ' of ' + expected);
}

test('logGamma matches exact factorial and half-integer values', () => {
  close(logGamma(1), 0);
  close(logGamma(2), 0);
  close(logGamma(5), Math.log(24));
  close(logGamma(11), Math.log(3_628_800));
  close(logGamma(0.5), Math.log(Math.sqrt(Math.PI)));
  close(logGamma(1.5), Math.log(Math.sqrt(Math.PI) / 2));
  assert.throws(() => logGamma(0), /positive/);
  assert.throws(() => logGamma(Number.NaN), /positive/);
});

test('regularized incomplete beta matches closed forms', () => {
  close(regularizedIncompleteBeta(1, 1, 0.3), 0.3);
  close(regularizedIncompleteBeta(2, 1, 0.5), 0.25);
  close(regularizedIncompleteBeta(1, 2, 0.5), 0.75);
  close(regularizedIncompleteBeta(3, 2, 0.4),
    4 * Math.pow(0.4, 3) * 0.6 + Math.pow(0.4, 4));
  assert.equal(regularizedIncompleteBeta(2.5, 3.5, 0), 0);
  assert.equal(regularizedIncompleteBeta(2.5, 3.5, 1), 1);
  assert.throws(() => regularizedIncompleteBeta(1, 1, 1.5), /\[0, 1\]/);
});

test('student t CDF matches Cauchy and df=2 closed forms and is symmetric', () => {
  close(studentTCdf(0, 7), 0.5);
  close(studentTCdf(1, 1), 0.75);
  close(studentTCdf(-1, 1), 0.25);
  const closedFormDf2 = (t) => 0.5 + t / (2 * Math.sqrt(2 + t * t));
  for (const t of [-3.5, -1, -0.25, 0.6, 2, 9]) {
    close(studentTCdf(t, 2), closedFormDf2(t), 1e-12);
    close(studentTCdf(t, 5) + studentTCdf(-t, 5), 1, 1e-12);
  }
  assert.equal(studentTCdf(Number.POSITIVE_INFINITY, 3), 1);
  assert.equal(studentTCdf(Number.NEGATIVE_INFINITY, 3), 0);
});

test('p-values respect sidedness and are replay-identical', () => {
  const twoSided = tTestPValue(1, 1, 'two_sided');
  close(twoSided, 0.5);
  close(tTestPValue(1, 1, 'greater'), 0.25);
  close(tTestPValue(1, 1, 'less'), 0.75);
  assert.equal(tTestPValue(2.31, 11.7, 'two_sided'), tTestPValue(2.31, 11.7, 'two_sided'));
  assert.throws(() => tTestPValue(1, 1, 'one_sided'), /sidedness/);
});

test('one-sample t test matches hand computation', () => {
  const result = oneSampleTTest([1, 2, 3, 4, 5], 2, 'two_sided');
  assert.equal(result.n, 5);
  close(result.mean, 3);
  close(result.variance, 2.5);
  assert.equal(result.degrees_of_freedom, 4);
  close(result.t, (3 - 2) / Math.sqrt(2.5 / 5));
  assert.equal(result.degenerate, null);
  assert.ok(result.p_value > 0 && result.p_value < 1);

  const flat = oneSampleTTest([2, 2, 2], 1);
  assert.equal(flat.degenerate, 'zero_variance');
  assert.equal(flat.p_value, null);
  assert.throws(() => oneSampleTTest([1], 0), /at least 2/);
});

test('welch t test matches hand-computed statistic and Welch-Satterthwaite df', () => {
  const a = [10, 12, 14, 16];
  const b = [11, 11.5, 12];
  const result = welchTTest(a, b, 'greater');
  const va = 20 / 3;
  const vb = 0.25;
  const pooled = va / 4 + vb / 3;
  close(result.t, (13 - 11.5) / Math.sqrt(pooled));
  const df = pooled * pooled /
    ((va / 4) * (va / 4) / 3 + (vb / 3) * (vb / 3) / 2);
  close(result.degrees_of_freedom, df);
  close(result.mean_difference, 1.5);
  // A declared nonzero null difference shifts the statistic.
  close(welchTTest(a, b, 'greater', 1).t, (13 - 11.5 - 1) / Math.sqrt(pooled));
  assert.equal(welchTTest([1, 1], [1, 1]).degenerate, 'zero_variance');
  assert.throws(() => welchTTest(a, b, 'greater', Number.NaN), /finite null difference/);
});

test('paired t test equals the one-sample test on within-pair differences', () => {
  const a = [620, 655, 640, 630];
  const b = [510, 505, 520, 515];
  const paired = pairedTTest(a, b, 0, 'greater');
  const differences = a.map((value, index) => value - b[index]);
  const oneSample = oneSampleTTest(differences, 0, 'greater');
  assert.equal(paired.test, 'student_t_paired');
  assert.equal(paired.pairs, 4);
  assert.equal(paired.t, oneSample.t);
  assert.equal(paired.p_value, oneSample.p_value);
  assert.equal(paired.mean_difference, oneSample.mean);
  assert.equal(paired.degrees_of_freedom, 3);
  assert.throws(() => pairedTTest([1, 2], [1]), /equal-length/);
  assert.equal(pairedTTest([1, 2, 3], [0, 1, 2]).degenerate, 'zero_variance');
  assert.throws(() => pairedTTest(['5', '6', '7'], [1, 2, 4]), /Paired group A/);
  assert.throws(() => pairedTTest([1, 2], [1, 2], Number.NaN), /finite null difference/);
  assert.throws(() => pairedTTest([1e308, -1e308], [-1e308, 1e308]), /overflowed/);
});

test('effect sizes match hand computation for every supported test', () => {
  const oneSample = oneSampleTTest([1, 2, 3, 4, 5], 2, 'two_sided');
  const d = effectSize(oneSample, 2);
  // mean 3, variance 2.5, so d = (3 - 2) / sqrt(2.5).
  assert.equal(d.method, 'cohens_d');
  close(d.cohens_d, 1 / Math.sqrt(2.5));
  const correction = 1 - 3 / (4 * 4 - 1);
  close(d.small_sample_correction, correction);
  assert.equal(d.correction_degrees_of_freedom, 4);
  close(d.hedges_g, (1 / Math.sqrt(2.5)) * correction);

  const a = [10, 12, 14, 16];
  const b = [11, 11.5, 12];
  const welch = welchTTest(a, b, 'two_sided');
  const welchEffect = effectSize(welch);
  assert.equal(welchEffect.method, 'cohens_d_average_variance');
  close(welchEffect.cohens_d, 1.5 / Math.sqrt(((20 / 3) + 0.25) / 2));
  // Hedges' J uses the variance-estimate df (n1 + n2 - 2 = 5), not the
  // Welch-Satterthwaite test df.
  assert.equal(welchEffect.correction_degrees_of_freedom, 5);
  close(welchEffect.small_sample_correction, 1 - 3 / (4 * 5 - 1));

  const paired = pairedTTest([620, 655, 640, 630], [510, 505, 520, 515], 0, 'greater');
  const pairedEffect = effectSize(paired, 0);
  assert.equal(pairedEffect.method, 'cohens_d_z');
  const differences = [110, 150, 120, 115];
  const meanDifference = differences.reduce((sum, value) => sum + value, 0) / 4;
  const variance = differences.reduce((sum, value) =>
    sum + (value - meanDifference) ** 2, 0) / 3;
  close(pairedEffect.cohens_d, meanDifference / Math.sqrt(variance));

  // Below two degrees of freedom the correction collapses toward zero, so the
  // corrected value is withheld rather than reported as a tiny effect.
  const tiny = effectSize(oneSampleTTest([1, 3], 0), 0);
  assert.equal(tiny.hedges_g, null);
  assert.equal(tiny.small_sample_correction, null);
  assert.ok(tiny.cohens_d > 1);
  // A nonzero paired null is a different quantity than literature d_z.
  const centered = effectSize(
    pairedTTest([10, 12, 14, 16], [4, 5, 6, 7], 5, 'greater'), 5);
  assert.equal(centered.method, 'standardized_mean_difference_vs_null');
  const uncentered = effectSize(pairedTTest([10, 12, 14, 16], [4, 5, 6, 7]), 0);
  assert.equal(uncentered.method, 'cohens_d_z');
  assert.ok(uncentered.cohens_d > centered.cohens_d);
  assert.equal(effectSize(oneSampleTTest([2, 2, 2], 1), 1), null);
  assert.equal(effectSize(null), null);
  assert.equal(effectSize({ test: 'unknown', degrees_of_freedom: 3 }), null);
});

test('TOST equals two one-sided tests and takes the larger p-value', () => {
  const args = { estimate: 1, standardError: 0.5, degreesOfFreedom: 9, lower: -5, upper: 5 };
  const tost = tostPValue(args);
  // Each side is the matching one-sided t test at that bound.
  close(tost.p_lower, tTestPValue((1 - -5) / 0.5, 9, 'greater'));
  close(tost.p_upper, tTestPValue((1 - 5) / 0.5, 9, 'less'));
  assert.equal(tost.p_value, Math.max(tost.p_lower, tost.p_upper));
  assert.deepEqual(tost.bounds, { lower: -5, upper: 5 });
  // An estimate outside the bounds cannot be equivalent at any usual alpha.
  const outside = tostPValue({ ...args, estimate: 9 });
  assert.ok(outside.p_value > 0.5);
  // Bounds tight relative to the noise also fail.
  const tight = tostPValue({ ...args, lower: -0.1, upper: 0.1 });
  assert.ok(tight.p_value > 0.5);
  assert.throws(() => tostPValue({ ...args, lower: 5, upper: -5 }), /strictly below/);
  assert.throws(() => tostPValue({ ...args, standardError: 0 }), /positive standard error/);
  assert.throws(() => tostPValue({ ...args, estimate: Number.NaN }), /finite/);
  assert.throws(() => tTestPValue(1, 5, 'equivalence'), /two one-sided tests/);
});

test('multiplicity corrections are exact and never shrink under missing family members', () => {
  assert.deepEqual(adjustPValues([0.01, 0.04], 'none'), [0.01, 0.04]);
  assert.deepEqual(adjustPValues([0.01, 0.04], 'bonferroni'), [0.02, 0.08]);
  assert.deepEqual(adjustPValues([0.01, 0.04], 'bonferroni', 4), [0.04, 0.16]);
  assert.deepEqual(
    adjustPValues([0.04, 0.01, 0.03], 'holm_bonferroni'),
    [0.06, 0.03, 0.06]
  );
  assert.deepEqual(adjustPValues([0.3, 0.9], 'bonferroni', 4), [1, 1]);
  assert.throws(() => adjustPValues([0.5], 'bonferroni', 0), /Family size/);
  assert.throws(() => adjustPValues([1.5], 'none'), /p-values/);
  assert.throws(() => adjustPValues([0.5], 'fdr'), /correction/);
});

test('student t quantile inverts the CDF and matches closed forms', () => {
  for (const p of [0.005, 0.025, 0.05, 0.25, 0.5, 0.9, 0.975, 0.999]) {
    close(studentTQuantile(p, 1), Math.tan(Math.PI * (p - 0.5)), 1e-9);
    const df2 = studentTQuantile(p, 2);
    close(0.5 + df2 / (2 * Math.sqrt(2 + df2 * df2)), p, 1e-12);
    for (const df of [3, 10, 120]) {
      close(studentTCdf(studentTQuantile(p, df), df), p, 1e-12);
      close(studentTQuantile(p, df), -studentTQuantile(1 - p, df), 1e-9);
    }
  }
  assert.equal(studentTQuantile(0.5, 7), 0);
  assert.throws(() => studentTQuantile(0, 5), /strictly between/);
  assert.throws(() => studentTQuantile(0.5, 0), /degrees of freedom/);
});

test('t confidence intervals match sidedness and hand computation', () => {
  const twoSided = tConfidenceInterval({
    estimate: 10, standardError: 2, degreesOfFreedom: 9,
    sidedness: 'two_sided', level: 0.95
  });
  const quantile = studentTQuantile(0.975, 9);
  close(twoSided.lower, 10 - quantile * 2, 1e-9);
  close(twoSided.upper, 10 + quantile * 2, 1e-9);
  assert.equal(twoSided.level, 0.95);

  const greater = tConfidenceInterval({
    estimate: 10, standardError: 2, degreesOfFreedom: 9,
    sidedness: 'greater', level: 0.95
  });
  close(greater.lower, 10 - studentTQuantile(0.95, 9) * 2, 1e-9);
  assert.equal(greater.upper, null);

  const less = tConfidenceInterval({
    estimate: 10, standardError: 2, degreesOfFreedom: 9,
    sidedness: 'less', level: 0.95
  });
  assert.equal(less.lower, null);
  close(less.upper, 10 + studentTQuantile(0.95, 9) * 2, 1e-9);

  assert.throws(() => tConfidenceInterval({
    estimate: 1, standardError: 0, degreesOfFreedom: 5,
    sidedness: 'two_sided', level: 0.95
  }), /standard error/);
});

test('engine identity and enumerations are frozen', () => {
  assert.equal(STATISTICS_ENGINE_NAME, 'sciencecode-inferential-t');
  assert.equal(STATISTICS_ENGINE_VERSION, 5);
  // Adding a test is additive; the existing entries must keep their identity
  // and order, because a frozen contract names one of these strings.
  assert.deepEqual([...INFERENCE_TESTS], [
    'student_t_one_sample', 'welch_t_two_sample', 'student_t_paired',
    'mann_whitney_u', 'wilcoxon_signed_rank'
  ]);
  assert.deepEqual([...RANK_BASED_INFERENCE_TESTS],
    ['mann_whitney_u', 'wilcoxon_signed_rank']);
  for (const rankTest of RANK_BASED_INFERENCE_TESTS) {
    assert.ok(INFERENCE_TESTS.includes(rankTest));
  }
  assert.deepEqual([...MULTIPLICITY_CORRECTIONS], ['none', 'bonferroni', 'holm_bonferroni']);
  assert.deepEqual(sampleMoments([4]), { n: 1, mean: 4, variance: null });
});

test('one-sided margins give non-inferiority and non-superiority TOST', () => {
  const base = { estimate: 1, standardError: 0.5, degreesOfFreedom: 9 };
  const nonInferior = tostPValue({ ...base, lower: -5 });
  assert.equal(nonInferior.kind, 'non_inferiority');
  assert.equal(nonInferior.p_upper, null);
  assert.equal(nonInferior.t_upper, null);
  assert.equal(nonInferior.p_value, nonInferior.p_lower);
  close(nonInferior.p_lower, tTestPValue((1 - -5) / 0.5, 9, 'greater'));
  assert.deepEqual(nonInferior.bounds, { lower: -5 });

  const nonSuperior = tostPValue({ ...base, upper: 5 });
  assert.equal(nonSuperior.kind, 'non_superiority');
  assert.equal(nonSuperior.p_lower, null);
  assert.equal(nonSuperior.p_value, nonSuperior.p_upper);
  close(nonSuperior.p_upper, tTestPValue((1 - 5) / 0.5, 9, 'less'));

  // A two-bound TOST is never more permissive than either one-sided claim.
  const both = tostPValue({ ...base, lower: -5, upper: 5 });
  assert.equal(both.kind, 'equivalence');
  assert.ok(both.p_value >= nonInferior.p_value);
  assert.ok(both.p_value >= nonSuperior.p_value);

  assert.throws(() => tostPValue(base), /at least one finite bound/);
  assert.throws(() => tostPValue({ ...base, lower: Number.NaN }), /finite numbers/);
});
