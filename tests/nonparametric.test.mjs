import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXACT_RANK_TEST_MAXIMUM,
  mannWhitneyUTest,
  rankValues,
  standardNormalCdf,
  wilcoxonSignedRankTest
} from '../lib/core.js';

// Expected p-values below were cross-checked against SciPy 1.17.1
// (scipy.stats.mannwhitneyu / wilcoxon) and agree to ~1e-15: the exact cases
// are bit-identical, the approximations match to machine precision including
// tie and continuity corrections.
function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`);
}

test('midranks average tied positions and report tie sizes', () => {
  assert.deepEqual(rankValues([10, 20, 20, 30]),
    { ranks: [1, 2.5, 2.5, 4], tie_sizes: [2] });
  assert.deepEqual(rankValues([5, 5, 5]), { ranks: [2, 2, 2], tie_sizes: [3] });
  assert.deepEqual(rankValues([3, 1, 2]), { ranks: [3, 1, 2], tie_sizes: [] });
  // Equal values must not depend on sort stability for their ranks.
  assert.deepEqual(rankValues([2, 1, 2, 1]).ranks, [3.5, 1.5, 3.5, 1.5]);
});

test('the standard normal CDF stays accurate into the far tails', () => {
  close(standardNormalCdf(0), 0.5, 0);
  close(standardNormalCdf(1), 0.8413447460685429, 1e-15);
  close(standardNormalCdf(1.959963984540054), 0.975, 1e-15);
  // The tail is where a 1 - something implementation loses its digits.
  close(standardNormalCdf(-4), 0.00003167124183311992, 1e-18);
  close(standardNormalCdf(-8), 6.220960574271782e-16, 1e-29);
  for (const z of [0.3, 1.7, 2.5, 4.1]) {
    assert.equal(standardNormalCdf(z) + standardNormalCdf(-z), 1);
  }
  assert.equal(standardNormalCdf(Number.POSITIVE_INFINITY), 1);
  assert.equal(standardNormalCdf(Number.NEGATIVE_INFINITY), 0);
  assert.throws(() => standardNormalCdf(Number.NaN), /numeric z/);
});

test('Mann-Whitney uses the exact null distribution without ties', () => {
  const separated = mannWhitneyUTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], 'two_sided');
  assert.equal(separated.method, 'exact');
  assert.equal(separated.u_a, 0);
  assert.equal(separated.u_b, 25);
  // Perfect separation: 2 of C(10,5) = 252 arrangements are this extreme.
  close(separated.p_value, 2 / 252);
  assert.equal(separated.rank_biserial, -1);
  assert.equal(separated.location_shift, -5);
  assert.equal(separated.ties_present, false);

  close(mannWhitneyUTest([12, 15, 9, 20, 7], [11, 14, 8, 19, 6], 'two_sided').p_value,
    0.6904761904761905);
  const greater = mannWhitneyUTest([22, 25, 31, 40, 19, 28], [15, 17, 20, 24, 13, 18], 'greater');
  assert.equal(greater.method, 'exact');
  close(greater.p_value, 0.007575757575757576);
});

test('Mann-Whitney falls back to the tie-corrected approximation', () => {
  const tied = mannWhitneyUTest([1, 2, 2, 3, 5, 5, 7, 8], [2, 3, 3, 4, 5, 9, 10, 11], 'two_sided');
  assert.equal(tied.method, 'normal_approximation');
  assert.equal(tied.ties_present, true);
  close(tied.p_value, 0.314116917266259);

  // Past the exact bound the approximation is used even without ties.
  const large = mannWhitneyUTest(
    Array.from({ length: 25 }, (_, index) => index + 1),
    Array.from({ length: 25 }, (_, index) => index + 4),
    'two_sided'
  );
  assert.equal(large.method, 'normal_approximation');
  close(large.p_value, 0.17417273739617822);
  assert.ok(EXACT_RANK_TEST_MAXIMUM < 25);
});

test('Wilcoxon signed-rank uses the exact null distribution without ties', () => {
  const allPositive = wilcoxonSignedRankTest([2, 4, 6, 8, 10], [1, 2, 3, 4, 5], 0, 'two_sided');
  assert.equal(allPositive.method, 'exact');
  assert.equal(allPositive.w_plus, 15);
  assert.equal(allPositive.w_minus, 0);
  // All five differences positive: 2 of 2^5 sign assignments are this extreme.
  close(allPositive.p_value, 2 / 32);
  close(wilcoxonSignedRankTest([2, 4, 6, 8, 10], [1, 2, 3, 4, 5], 0, 'greater').p_value, 1 / 32);
  assert.equal(allPositive.rank_biserial, 1);
  assert.equal(allPositive.location_shift, 3);

  close(wilcoxonSignedRankTest([5, 8, 3, 9, 12, 4, 7], [6, 5, 4, 7, 10, 6, 5], 0, 'two_sided').p_value,
    0.3008027423277617);
  close(wilcoxonSignedRankTest(
    [10, 12, 14, 16, 18, 20, 22, 24], [9, 11, 14, 15, 17, 19, 21, 23], 0, 'two_sided').p_value,
  0.010733416102997193);
});

test('Wilcoxon reports dropped zero differences rather than hiding them', () => {
  const withZeros = wilcoxonSignedRankTest([5, 5, 7, 9], [5, 5, 3, 4], 0, 'two_sided');
  assert.equal(withZeros.zeros_dropped, 2);
  assert.equal(withZeros.n_nonzero, 2);
  assert.equal(withZeros.n_pairs, 4);
  // Dropping pairs changes the effective n, so the exact path is not used.
  assert.equal(withZeros.method, 'normal_approximation');

  const allZero = wilcoxonSignedRankTest([3, 3, 3], [3, 3, 3], 0, 'two_sided');
  assert.equal(allZero.degenerate, 'all_differences_zero');
  assert.equal(allZero.p_value, null);
});

test('the declared null shift is the hypothesis the rank tests actually test', () => {
  // Differences are [11..15] with median 13, so a null of 13 centers them at
  // [-2,-1,0,1,2] and the test must be maximally unsurprised.
  const shifted = wilcoxonSignedRankTest([12, 14, 16, 18, 20], [1, 2, 3, 4, 5], 13, 'two_sided');
  assert.equal(shifted.p_value, 1);
  // The estimate is the absolute shift (13), not what remains after the null
  // is subtracted; only the p-value responds to the declared null.
  assert.equal(shifted.location_shift, 13);
  const unshifted = wilcoxonSignedRankTest([12, 14, 16, 18, 20], [1, 2, 3, 4, 5], 0, 'two_sided');
  close(unshifted.p_value, 2 / 32);
  assert.ok(unshifted.p_value < shifted.p_value);
});

test('rank tests refuse alternatives and samples they cannot honor', () => {
  assert.throws(() => mannWhitneyUTest([1, 2], [3, 4], 'equivalence'),
    /two-sided, greater, or less/);
  assert.throws(() => wilcoxonSignedRankTest([1, 2], [3, 4], 0, 'equivalence'),
    /two-sided, greater, or less/);
  assert.throws(() => wilcoxonSignedRankTest([1, 2, 3], [1, 2], 0, 'two_sided'),
    /equal-length paired samples/);
  assert.throws(() => wilcoxonSignedRankTest([1, 2], [3, 4], Number.NaN, 'two_sided'),
    /finite null shift/);
  assert.throws(() => mannWhitneyUTest([1], [2, 3], 'two_sided'), /Group A/);
});

test('rank tests make no normality assumption and are order-invariant', () => {
  // A wildly heavy-tailed sample: the rank test is unmoved by the outlier's
  // magnitude, which is the entire point of using it.
  const modest = mannWhitneyUTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], 'two_sided');
  const extreme = mannWhitneyUTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 1e12], 'two_sided');
  assert.equal(modest.p_value, extreme.p_value);
  assert.equal(modest.u_a, extreme.u_a);

  // Reordering the observations cannot change the result.
  const forward = mannWhitneyUTest([3, 1, 4, 1, 5], [9, 2, 6, 5, 3], 'two_sided');
  const reversed = mannWhitneyUTest([5, 1, 4, 1, 3], [3, 5, 6, 2, 9], 'two_sided');
  assert.equal(forward.p_value, reversed.p_value);
  assert.equal(forward.u_a, reversed.u_a);
});

test('the one-sided continuity correction opposes the alternative', () => {
  // Regression: a sign-based "toward the mean" correction is correct only for
  // the two-sided test. One-sided it must always move the statistic AGAINST
  // the alternative, or the p-value is anti-conservative whenever the observed
  // deviation opposes the alternative. Values from SciPy 1.17.1.
  close(mannWhitneyUTest([2, 2, 1], [1, 2, 0], 'less').p_value, 0.8807035853417824, 1e-12);
  close(mannWhitneyUTest([0, 0, 0], [0, 1, 0], 'greater').p_value, 0.9087887802741323, 1e-12);
  close(mannWhitneyUTest([1, 0, 4], [4, 2, 0], 'greater').p_value, 0.6734524425339091, 1e-12);

  // Under a discrete null the correction makes each tail conservative, so the
  // two one-sided p-values must sum ABOVE 1. Summing to exactly 1 was the
  // original bug's signature. (Here `less` is exactly 0.5: U sits half a unit
  // below the null mean, so its corrected z is exactly zero — SciPy agrees.)
  const greater = mannWhitneyUTest([1, 0, 4], [4, 2, 0], 'greater').p_value;
  const less = mannWhitneyUTest([1, 0, 4], [4, 2, 0], 'less').p_value;
  assert.equal(less, 0.5);
  assert.ok(greater + less > 1);

  // The two-sided path is unaffected by the directional correction.
  close(mannWhitneyUTest([1, 2, 2, 3, 5, 5, 7, 8], [2, 3, 3, 4, 5, 9, 10, 11], 'two_sided').p_value,
    0.314116917266259);
});

test('the reported location shift is absolute and uses every pair', () => {
  // Zero differences are dropped from the TEST but must remain in the
  // ESTIMATE, where they legitimately pull the median toward zero.
  const withZeros = wilcoxonSignedRankTest([10, 10, 10, 11, 12], [10, 10, 10, 10, 10], 0, 'two_sided');
  assert.equal(withZeros.location_shift, 0.5);
  assert.equal(withZeros.zeros_dropped, 3);

  // The null shift must not be subtracted out of a field named for the
  // location shift: the estimate is the shift itself, not what remains of it.
  const shifted = wilcoxonSignedRankTest([12, 13, 14, 15, 16], [10, 10, 10, 10, 10], 2, 'two_sided');
  assert.equal(shifted.location_shift, 4);
  const unshifted = wilcoxonSignedRankTest([12, 13, 14, 15, 16], [10, 10, 10, 10, 10], 0, 'two_sided');
  assert.equal(unshifted.location_shift, shifted.location_shift,
    'the estimate must not move when only the null moves');
});

test('degenerate results keep the full result shape', () => {
  // A heterogeneous shape is a hazard for anything hashing these objects.
  const tiedGroups = mannWhitneyUTest([5, 5, 5], [5, 5, 5], 'two_sided');
  assert.equal(tiedGroups.degenerate, 'zero_variance');
  assert.equal(tiedGroups.p_value, null);
  assert.equal(tiedGroups.rank_biserial, 0);
  assert.ok(Object.hasOwn(tiedGroups, 'location_shift'));

  const allZero = wilcoxonSignedRankTest([3, 3, 3], [3, 3, 3], 0, 'two_sided');
  assert.equal(allZero.p_value, null);
  assert.equal(allZero.location_shift, 0);
  assert.ok(Object.hasOwn(allZero, 'rank_biserial'));
});

test('the distribution-free interval is the region the test does not reject', () => {
  // Regression for a systematic off-by-one that trimmed one order statistic
  // too far at each end, under-covering at every exact-regime sample size.
  // These endpoints were derived by INVERTING the test: they are the extreme
  // shifts at which this engine's own two-sided p-value still exceeds alpha.
  const a = [100, 300, 700];
  const b = [50, 150, 250, 450, 550, 650, 900];
  const interval = mannWhitneyUTest(a, b, 'two_sided', 0.95).confidence_interval;
  assert.equal(interval.lower, -600);
  assert.equal(interval.upper, 550);
  assert.equal(interval.method, 'distribution_free_exact');

  // The endpoints must not be rejected, and just outside them must be.
  const at = (shift) => mannWhitneyUTest(a, b, 'two_sided', 0.95, shift).p_value;
  assert.ok(at(-600 + 1e-6) > 0.05, 'the lower endpoint must lie inside');
  assert.ok(at(550 - 1e-6) > 0.05, 'the upper endpoint must lie inside');
  assert.ok(at(-650) <= 0.05, 'beyond the lower endpoint must be rejected');
  assert.ok(at(600) <= 0.05, 'beyond the upper endpoint must be rejected');

  // The estimate always lies inside its own interval.
  const fit = mannWhitneyUTest(a, b, 'two_sided', 0.95);
  assert.ok(interval.lower <= fit.location_shift && fit.location_shift <= interval.upper);
});

test('the declared null is the hypothesis Mann-Whitney actually tests', () => {
  // Regression: the null was accepted, echoed into the record, and ignored --
  // every reported p-value and conclusion was for a shift of zero.
  const a = [112, 115, 109, 120, 107];
  const b = [11, 14, 8, 19, 6];
  const atZero = mannWhitneyUTest(a, b, 'two_sided', 0.95, 0);
  const atTruth = mannWhitneyUTest(a, b, 'two_sided', 0.95, 100);
  assert.ok(atZero.p_value < 0.01, 'a shift of zero is implausible here');
  assert.ok(atTruth.p_value > 0.5, 'the true shift must be unsurprising');
  // The estimate is absolute and must not move when only the null moves.
  assert.equal(atZero.location_shift, atTruth.location_shift);
  assert.throws(() => mannWhitneyUTest(a, b, 'two_sided', 0.95, Number.NaN),
    /finite null shift/);
});

test('a rank interval does not depend on the null being tested', () => {
  // A confidence interval is a statement about the shift, so declaring a
  // different null must not move it. It previously did, because the interval
  // reused the test's post-shift, zero-filtered sample.
  const before = [3, 5, 7, 9, 11, 13, 2];
  const after = [0, 0, 0, 0, 0, 0, 0];
  const base = wilcoxonSignedRankTest(before, after, 0, 'two_sided').confidence_interval;
  for (const shift of [3, -2, 7.5]) {
    const moved = wilcoxonSignedRankTest(before, after, shift, 'two_sided').confidence_interval;
    assert.equal(moved.lower, base.lower);
    assert.equal(moved.upper, base.upper);
    assert.equal(moved.method, base.method);
    assert.equal(moved.trimmed_each_end, base.trimmed_each_end);
  }
});

test('a one-sided rank test reports a one-sided interval', () => {
  // A two-bounded interval beside a one-sided p-value lets a reader invert the
  // interval and reach a different decision than the test reported.
  const a = [12, 15, 9, 20, 7];
  const b = [11, 14, 8, 19, 6];
  const greater = mannWhitneyUTest(a, b, 'greater', 0.95).confidence_interval;
  assert.equal(greater.sidedness, 'greater');
  assert.equal(greater.upper, null);
  assert.ok(Number.isFinite(greater.lower));

  const less = mannWhitneyUTest(a, b, 'less', 0.95).confidence_interval;
  assert.equal(less.sidedness, 'less');
  assert.equal(less.lower, null);
  assert.ok(Number.isFinite(less.upper));

  const twoSided = mannWhitneyUTest(a, b, 'two_sided', 0.95).confidence_interval;
  assert.equal(twoSided.sidedness, 'two_sided');
  // A one-sided bound is tighter than the matching two-sided one.
  assert.ok(greater.lower >= twoSided.lower);
});
