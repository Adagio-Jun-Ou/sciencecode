export const STATISTICS_ENGINE_NAME = 'sciencecode-inferential-t';
// v2 added standard errors and sidedness-matched confidence intervals to the
// t-test outputs; v3 added standardized effect sizes and threaded the declared
// null through every test; v4 added margin claims (equivalence,
// non-inferiority, non-superiority) and the report wording that describes
// them. Records frozen under an older version replay under that version's
// behavior, including its exact report shape and disclosure text.
// v5 added rank-based tests, which report a distribution-free interval and a
// rank-biserial effect size in place of a t interval and Cohen's d.
export const STATISTICS_ENGINE_VERSION = 5;
// Versions this build can still verify: the assessment replay dispatches on
// the version recorded in the frozen contract manifest, so records made under
// any listed version stay valid.
export const SUPPORTED_STATISTICS_ENGINE_VERSIONS = Object.freeze([
  2, 3, 4, STATISTICS_ENGINE_VERSION
]);

export const INFERENCE_TESTS = Object.freeze([
  'student_t_one_sample', 'welch_t_two_sample', 'student_t_paired',
  // Rank-based alternatives, available from engine v5. They carry no
  // normality assumption and test a shift in location rather than a
  // difference in means.
  'mann_whitney_u', 'wilcoxon_signed_rank'
]);
// Tests that do not assume approximate normality.
export const RANK_BASED_INFERENCE_TESTS = Object.freeze([
  'mann_whitney_u', 'wilcoxon_signed_rank'
]);
export const INFERENCE_SIDEDNESS = Object.freeze([
  'two_sided', 'greater', 'less', 'equivalence'
]);
export const MULTIPLICITY_CORRECTIONS = Object.freeze(['none', 'bonferroni', 'holm_bonferroni']);

const MAX_BETACF_ITERATIONS = 300;
const BETACF_EPSILON = 3e-16;
const BETACF_FPMIN = 1e-300;

// Lanczos approximation, g = 7, nine coefficients. Every routine in this
// module is a pure function of binary64 inputs with fixed iteration bounds so
// identical inputs replay to identical bits on any IEEE 754 platform.
const LANCZOS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7
];

function statisticsError(message, code = 'INVALID_STATISTICS_INPUT') {
  return Object.assign(new Error(message), { code });
}

export function logGamma(x) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) {
    throw statisticsError('logGamma requires a finite positive number.');
  }
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const shifted = x - 1;
  let sum = LANCZOS[0];
  for (let index = 1; index < LANCZOS.length; index += 1) {
    sum += LANCZOS[index] / (shifted + index);
  }
  const base = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(base) - base + Math.log(sum);
}

function betaContinuedFraction(a, b, x) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_BETACF_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let numerator = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
    c = 1 + numerator / c;
    if (Math.abs(c) < BETACF_FPMIN) c = BETACF_FPMIN;
    d = 1 / d;
    h *= d * c;
    numerator = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
    c = 1 + numerator / c;
    if (Math.abs(c) < BETACF_FPMIN) c = BETACF_FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < BETACF_EPSILON) return h;
  }
  return h;
}

export function regularizedIncompleteBeta(a, b, x) {
  if (![a, b].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    throw statisticsError('regularizedIncompleteBeta requires positive finite shape parameters.');
  }
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
    throw statisticsError('regularizedIncompleteBeta requires x in [0, 1].');
  }
  if (x === 0) return 0;
  if (x === 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaContinuedFraction(a, b, x) / a;
  }
  return 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

export function studentTCdf(t, degreesOfFreedom) {
  if (typeof t !== 'number' || Number.isNaN(t)) {
    throw statisticsError('studentTCdf requires a numeric t statistic.');
  }
  if (typeof degreesOfFreedom !== 'number' || !Number.isFinite(degreesOfFreedom) ||
      degreesOfFreedom <= 0) {
    throw statisticsError('studentTCdf requires positive finite degrees of freedom.');
  }
  if (t === Number.POSITIVE_INFINITY) return 1;
  if (t === Number.NEGATIVE_INFINITY) return 0;
  const x = degreesOfFreedom / (degreesOfFreedom + t * t);
  const tail = 0.5 * regularizedIncompleteBeta(degreesOfFreedom / 2, 0.5, x);
  return t <= 0 ? tail : 1 - tail;
}

export function tTestPValue(t, degreesOfFreedom, sidedness) {
  if (!INFERENCE_SIDEDNESS.includes(sidedness)) {
    throw statisticsError('Unsupported sidedness: ' + String(sidedness));
  }
  if (sidedness === 'equivalence') {
    throw statisticsError(
      'Equivalence uses two one-sided tests; call tostPValue with both bounds.'
    );
  }
  const cdf = studentTCdf(t, degreesOfFreedom);
  if (sidedness === 'greater') return 1 - cdf;
  if (sidedness === 'less') return cdf;
  return Math.min(1, 2 * Math.min(cdf, 1 - cdf));
}

// Two one-sided tests. Equivalence is claimed only when BOTH one-sided nulls
// are rejected, so the TOST p-value is the larger of the two — the test is
// conservative by construction and never borrows significance from one side.
// Omitting one bound gives the one-sided case: a lower bound alone is
// non-inferiority, an upper bound alone is non-superiority.
export function tostPValue({ estimate, standardError, degreesOfFreedom, lower = null, upper = null }) {
  if (![estimate, standardError, degreesOfFreedom].every(
    (value) => typeof value === 'number' && Number.isFinite(value))) {
    throw statisticsError('TOST requires a finite estimate, standard error, and df.');
  }
  if (standardError <= 0) {
    throw statisticsError('TOST requires a positive standard error.');
  }
  const hasLower = lower !== null && lower !== undefined;
  const hasUpper = upper !== null && upper !== undefined;
  if (!hasLower && !hasUpper) {
    throw statisticsError('TOST requires at least one finite bound.');
  }
  if ((hasLower && !Number.isFinite(lower)) || (hasUpper && !Number.isFinite(upper))) {
    throw statisticsError('TOST bounds must be finite numbers.');
  }
  if (hasLower && hasUpper && !(lower < upper)) {
    throw statisticsError('TOST lower bound must be strictly below the upper bound.');
  }
  // H0_lower: difference <= lower, rejected by a 'greater' test at the lower
  // bound. H0_upper: difference >= upper, rejected by a 'less' test.
  const tLower = hasLower ? (estimate - lower) / standardError : null;
  const tUpper = hasUpper ? (estimate - upper) / standardError : null;
  const pLower = hasLower ? 1 - studentTCdf(tLower, degreesOfFreedom) : null;
  const pUpper = hasUpper ? studentTCdf(tUpper, degreesOfFreedom) : null;
  return {
    kind: hasLower && hasUpper
      ? 'equivalence'
      : hasLower ? 'non_inferiority' : 'non_superiority',
    t_lower: tLower,
    t_upper: tUpper,
    p_lower: pLower,
    p_upper: pUpper,
    // Every declared bound must be cleared, so the decision takes the largest
    // of the one-sided p-values actually tested.
    p_value: Math.max(...[pLower, pUpper].filter((value) => value !== null)),
    bounds: {
      ...(hasLower ? { lower } : {}),
      ...(hasUpper ? { upper } : {})
    }
  };
}

// Acklam's rational approximation to the standard normal quantile; used only
// as the Newton starter for the t quantile, so its ~1e-9 accuracy is ample.
function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function studentTPdf(t, degreesOfFreedom) {
  return Math.exp(
    logGamma((degreesOfFreedom + 1) / 2) - logGamma(degreesOfFreedom / 2) -
    0.5 * Math.log(degreesOfFreedom * Math.PI) -
    ((degreesOfFreedom + 1) / 2) * Math.log(1 + t * t / degreesOfFreedom)
  );
}

export function studentTQuantile(p, degreesOfFreedom) {
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p >= 1) {
    throw statisticsError('studentTQuantile requires p strictly between 0 and 1.');
  }
  if (typeof degreesOfFreedom !== 'number' || !Number.isFinite(degreesOfFreedom) ||
      degreesOfFreedom <= 0) {
    throw statisticsError('studentTQuantile requires positive finite degrees of freedom.');
  }
  if (p === 0.5) return 0;
  let t = normalQuantile(p);
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const error = studentTCdf(t, degreesOfFreedom) - p;
    const density = studentTPdf(t, degreesOfFreedom);
    if (density === 0) {
      throw statisticsError(
        'studentTQuantile cannot refine p=' + p + ' at ' + degreesOfFreedom +
        ' degrees of freedom: the density underflowed before convergence.'
      );
    }
    const step = error / density;
    t -= step;
    if (Math.abs(step) < 1e-14 * Math.max(1, Math.abs(t))) break;
  }
  return t;
}

// Equivalence has no single p-value at this layer; the caller runs TOST from
// the returned estimate, standard error, and degrees of freedom.
function pValueFor(t, degreesOfFreedom, sidedness) {
  return sidedness === 'equivalence' ? null : tTestPValue(t, degreesOfFreedom, sidedness);
}

function numericSample(values, label, minimum) {
  if (!Array.isArray(values) ||
      !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw statisticsError(label + ' must be an array of finite numbers.');
  }
  if (values.length < minimum) {
    throw statisticsError(label + ' requires at least ' + minimum + ' observations.',
      'INSUFFICIENT_OBSERVATIONS');
  }
  return values;
}

// ---------------------------------------------------------------------------
// Rank-based (nonparametric) tests.
//
// Every t-test above assumes approximate normality. These do not: they use
// only the ordering of the observations, so a skewed or heavy-tailed outcome
// can be tested without pretending it is Gaussian. What they test is a shift
// in location, not a difference in means.
//
// Determinism: ranks come from a total order (value, then original index, so
// ties never depend on sort stability), the exact null distributions are
// integer dynamic programs, and the normal approximation is a closed form.
// No randomness anywhere, and every loop has a fixed bound.
// ---------------------------------------------------------------------------

// Beyond this sample size the exact null distribution is replaced by the
// tie-corrected normal approximation. This bound is a frozen part of the
// engine, not a tuning knob: changing it changes reported p-values.
export const EXACT_RANK_TEST_MAXIMUM = 20;

// Midranks: tied observations share the average of the ranks they span.
export function rankValues(values) {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = new Array(values.length);
  const tieSizes = [];
  let start = 0;
  while (start < indexed.length) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const averageRank = (start + end + 1) / 2;
    for (let index = start; index < end; index += 1) ranks[indexed[index].index] = averageRank;
    if (end - start > 1) tieSizes.push(end - start);
    start = end;
  }
  return { ranks, tie_sizes: tieSizes };
}

const GAMMA_FPMIN = 1e-300;
const MAX_GAMMA_ITERATIONS = 500;

function lowerGammaSeries(a, x) {
  let ap = a;
  let sum = 1 / a;
  let delta = sum;
  for (let n = 1; n <= MAX_GAMMA_ITERATIONS; n += 1) {
    ap += 1;
    delta *= x / ap;
    sum += delta;
    if (Math.abs(delta) < Math.abs(sum) * 1e-17) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function upperGammaContinued(a, x) {
  let b = x + 1 - a;
  let c = 1 / GAMMA_FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_GAMMA_ITERATIONS; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < GAMMA_FPMIN) d = GAMMA_FPMIN;
    c = b + an / c;
    if (Math.abs(c) < GAMMA_FPMIN) c = GAMMA_FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-17) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

// Standard normal CDF via the complementary error function, so far-tail
// probabilities keep their significant digits instead of being lost to
// cancellation in 1 - something.
export function standardNormalCdf(z) {
  if (typeof z !== 'number' || Number.isNaN(z)) {
    throw statisticsError('standardNormalCdf requires a numeric z.');
  }
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  const x = -z / Math.SQRT2;
  const erfc = x < 0
    ? 2 - regularizedUpperGamma(0.5, x * x)
    : regularizedUpperGamma(0.5, x * x);
  return 0.5 * erfc;
}

function regularizedUpperGamma(a, x) {
  if (x <= 0) return 1;
  return x < a + 1 ? 1 - lowerGammaSeries(a, x) : upperGammaContinued(a, x);
}

// Exact Mann-Whitney null counts: f(m,n)[u] = f(m-1,n)[u-n] + f(m,n-1)[u].
// Counts stay well inside binary64's exact-integer range for m, n <= 20.
function mannWhitneyNullCounts(m, n) {
  const table = [];
  for (let i = 0; i <= m; i += 1) {
    table.push([]);
    for (let j = 0; j <= n; j += 1) {
      const row = new Float64Array(i * j + 1);
      if (i === 0 || j === 0) {
        row[0] = 1;
      } else {
        for (let u = 0; u < row.length; u += 1) {
          const previous = table[i - 1][j];
          const fromA = u - j >= 0 && u - j < previous.length ? previous[u - j] : 0;
          const other = table[i][j - 1];
          row[u] = fromA + (u < other.length ? other[u] : 0);
        }
      }
      table[i].push(row);
    }
  }
  return table[m][n];
}

// Exact Wilcoxon signed-rank counts: subsets of {1..n} by their sum.
function signedRankNullCounts(n) {
  const maximum = (n * (n + 1)) / 2;
  const counts = new Float64Array(maximum + 1);
  counts[0] = 1;
  for (let k = 1; k <= n; k += 1) {
    for (let w = maximum; w >= k; w -= 1) counts[w] += counts[w - k];
  }
  return counts;
}

function tailProbability(counts, total, threshold, direction) {
  let sum = 0;
  if (direction === 'at_most') {
    for (let value = 0; value <= threshold && value < counts.length; value += 1) sum += counts[value];
  } else {
    for (let value = Math.max(0, threshold); value < counts.length; value += 1) sum += counts[value];
  }
  return sum / total;
}

// The half-unit continuity correction is DIRECTIONAL for a one-sided test: it
// always moves the statistic against the alternative, never merely toward the
// mean. A sign-based "toward the mean" correction is right only two-sided; one
// -sided it shifts the wrong way whenever the observed deviation opposes the
// alternative, making the p-value anti-conservative.
function continuityCorrectedZ(statistic, mean, standardDeviation, sidedness) {
  if (sidedness === 'greater') return (statistic - mean - 0.5) / standardDeviation;
  if (sidedness === 'less') return (statistic - mean + 0.5) / standardDeviation;
  const deviation = statistic - mean;
  return (deviation - Math.sign(deviation) * Math.min(0.5, Math.abs(deviation))) /
    standardDeviation;
}

// Largest cut count k such that the null probability of being that extreme
// stays at or below the requested tail. Returns 0 when even the most extreme
// order statistic cannot achieve the level, which is the honest answer for a
// sample too small to support the interval.
function distributionFreeCut(counts, total, tail) {
  let cumulative = 0;
  let cut = 0;
  for (let value = 0; value < counts.length; value += 1) {
    cumulative += counts[value];
    if (cumulative / total > tail) break;
    cut = value + 1;
  }
  return cut;
}

// A distribution-free interval for the location shift, obtained by trimming
// order statistics of the pairwise differences (or Walsh averages) rather than
// by assuming normality. This is the interval that actually corresponds to
// inverting the rank test; a t-interval here would import the very assumption
// the test exists to avoid.
function hodgesLehmannInterval(sortedValues, counts, level, normalFallback,
  sidedness = 'two_sided') {
  // A one-sided test gets a one-sided interval, matching what the parametric
  // path does. Reporting a two-bounded interval beside a one-sided p-value
  // lets a reader invert the interval and reach a different decision than the
  // test reported.
  const tail = sidedness === 'two_sided' ? (1 - level) / 2 : 1 - level;
  let cut;
  if (counts) {
    let total = 0;
    for (const count of counts) total += count;
    cut = distributionFreeCut(counts, total, tail);
  } else {
    cut = normalFallback(tail);
  }
  const n = sortedValues.length;
  if (!(cut >= 0) || cut >= n || n === 0) return null;
  // `cut` is the largest k with P(statistic <= k - 1) <= tail, which pairs
  // with the acceptance region [D_(k), D_(N+1-k)] in the 1-indexed standard
  // formulation -- NOT [D_(k+1), D_(N-k)]. Taking the narrower pair trims one
  // order statistic too far at each end and under-covers. A cut of zero means
  // the sample is too small to reach the level at all, so the widest interval
  // the data can express is reported rather than a falsely narrow one.
  const lower = sortedValues[Math.max(0, cut - 1)];
  const upper = sortedValues[Math.min(n - 1, n - cut)];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  return {
    level,
    sidedness,
    lower: sidedness === 'less' ? null : lower,
    upper: sidedness === 'greater' ? null : upper,
    method: counts ? 'distribution_free_exact' : 'distribution_free_normal_approximation',
    trimmed_each_end: cut
  };
}

function median(sorted) {
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Hodges-Lehmann location shift: the median of all pairwise differences. It is
// the estimator these tests actually invert, so it is what belongs beside them
// rather than a difference of means.
function pairwiseDifferences(a, b) {
  const differences = [];
  for (const left of a) for (const right of b) differences.push(left - right);
  differences.sort((left, right) => left - right);
  return differences;
}

function hodgesLehmannTwoSample(a, b) {
  return median(pairwiseDifferences(a, b));
}

function walshAverages(values) {
  // Walsh averages: (d_i + d_j) / 2 over i <= j.
  const averages = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i; j < values.length; j += 1) averages.push((values[i] + values[j]) / 2);
  }
  averages.sort((left, right) => left - right);
  return averages;
}

function hodgesLehmannOneSample(values) {
  return median(walshAverages(values));
}

export function mannWhitneyUTest(groupA, groupB, sidedness = 'two_sided',
  confidenceLevel = 0.95, nullShift = 0) {
  if (!INFERENCE_SIDEDNESS.includes(sidedness) || sidedness === 'equivalence') {
    throw statisticsError('Mann-Whitney requires a two-sided, greater, or less alternative.');
  }
  if (typeof nullShift !== 'number' || !Number.isFinite(nullShift)) {
    throw statisticsError('Mann-Whitney requires a finite null shift.');
  }
  // The declared null is a location shift: the hypothesis is that group A
  // minus that shift has the same distribution as group B. Ignoring it would
  // test a shift of zero while the record displayed the declared one.
  const observedA = numericSample(groupA, 'Group A', 2);
  const a = nullShift === 0 ? observedA : observedA.map((value) => value - nullShift);
  const b = numericSample(groupB, 'Group B', 2);
  const nA = a.length;
  const nB = b.length;
  const total = nA + nB;
  const { ranks, tie_sizes: tieSizes } = rankValues([...a, ...b]);
  const rankSumA = ranks.slice(0, nA).reduce((sum, rank) => sum + rank, 0);
  // U_A counts (pairs where A exceeds B) + half the tied pairs.
  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const uB = nA * nB - uA;
  const sortedA = [...a].sort((left, right) => left - right);
  const sortedB = [...b].sort((left, right) => left - right);
  const exact = tieSizes.length === 0 &&
    nA <= EXACT_RANK_TEST_MAXIMUM && nB <= EXACT_RANK_TEST_MAXIMUM;

  let pValue;
  let z = null;
  if (exact) {
    const counts = mannWhitneyNullCounts(nA, nB);
    let combinations = 0;
    for (const count of counts) combinations += count;
    if (sidedness === 'greater') {
      pValue = tailProbability(counts, combinations, Math.ceil(uA), 'at_least');
    } else if (sidedness === 'less') {
      pValue = tailProbability(counts, combinations, Math.floor(uA), 'at_most');
    } else {
      // The null distribution is symmetric about nA*nB/2, so doubling the
      // smaller tail is exact rather than an approximation.
      const lower = tailProbability(counts, combinations, Math.floor(Math.min(uA, uB)), 'at_most');
      pValue = Math.min(1, 2 * lower);
    }
  } else {
    const mean = (nA * nB) / 2;
    let tieAdjustment = 0;
    for (const size of tieSizes) tieAdjustment += size * size * size - size;
    const variance = total > 1
      ? ((nA * nB) / 12) * ((total + 1) - tieAdjustment / (total * (total - 1)))
      : 0;
    if (variance <= 0) {
      return {
        test: 'mann_whitney_u',
        group_a: { n: nA, median: median(sortedA) },
        group_b: { n: nB, median: median(sortedB) },
        u_a: uA,
        u_b: uB,
        rank_sum_a: rankSumA,
        ties_present: tieSizes.length > 0,
        method: 'normal_approximation',
        z: null,
        p_value: null,
        location_shift: hodgesLehmannTwoSample(observedA, b),
        rank_biserial: (2 * uA) / (nA * nB) - 1,
        degenerate: 'zero_variance'
      };
    }
    z = continuityCorrectedZ(uA, mean, Math.sqrt(variance), sidedness);
    pValue = sidedness === 'greater'
      ? 1 - standardNormalCdf(z)
      : sidedness === 'less'
        ? standardNormalCdf(z)
        : Math.min(1, 2 * Math.min(standardNormalCdf(z), 1 - standardNormalCdf(z)));
  }

  return {
    test: 'mann_whitney_u',
    group_a: { n: nA, median: median(sortedA) },
    group_b: { n: nB, median: median(sortedB) },
    u_a: uA,
    u_b: uB,
    rank_sum_a: rankSumA,
    ties_present: tieSizes.length > 0,
    method: exact ? 'exact' : 'normal_approximation',
    z,
    p_value: pValue,
    // Reported on the original scale, so the estimate does not move when only
    // the declared null moves.
    location_shift: hodgesLehmannTwoSample(observedA, b),
    // A distribution-free interval for that shift, obtained by trimming order
    // statistics of the pairwise differences. A t-interval would import the
    // normality assumption the test exists to avoid.
    confidence_interval: hodgesLehmannInterval(
      pairwiseDifferences(observedA, b),
      exact ? mannWhitneyNullCounts(nA, nB) : null,
      confidenceLevel,
      (tail) => {
        const mean = (nA * nB) / 2;
        // The only ways to reach this branch are ties or a large sample, so
        // the tie correction the test itself applies belongs here too.
        let tieAdjustment = 0;
        for (const size of tieSizes) tieAdjustment += size * size * size - size;
        const variance = total > 1
          ? ((nA * nB) / 12) * ((total + 1) - tieAdjustment / (total * (total - 1)))
          : (nA * nB * (total + 1)) / 12;
        const z = -studentTQuantile(1 - tail, 1e6);
        return Math.max(0, Math.floor(mean + z * Math.sqrt(Math.max(variance, 0))));
      },
      sidedness
    ),
    // Rank-biserial correlation: the effect size these ranks support, bounded
    // in [-1, 1] and free of any normality assumption.
    rank_biserial: (2 * uA) / (nA * nB) - 1
  };
}

export function wilcoxonSignedRankTest(before, after, nullShift = 0, sidedness = 'two_sided', confidenceLevel = 0.95) {
  if (!INFERENCE_SIDEDNESS.includes(sidedness) || sidedness === 'equivalence') {
    throw statisticsError('Wilcoxon requires a two-sided, greater, or less alternative.');
  }
  if (typeof nullShift !== 'number' || !Number.isFinite(nullShift)) {
    throw statisticsError('Wilcoxon signed-rank test requires a finite null shift.');
  }
  const first = numericSample(before, 'Paired first measurement', 2);
  const second = numericSample(after, 'Paired second measurement', 2);
  if (first.length !== second.length) {
    throw statisticsError('Wilcoxon signed-rank test requires equal-length paired samples.');
  }
  // The paired shift the estimator reports is the absolute one, over every
  // pair. Zeros are dropped from the TEST (they carry no sign information) but
  // must stay in the ESTIMATE, where they legitimately pull the median toward
  // zero, and the null shift must not be subtracted out of a field named for
  // the location shift itself.
  const pairedDifferences = first.map((value, index) => value - second[index]);
  const locationShift = hodgesLehmannOneSample(pairedDifferences);
  const rawDifferences = pairedDifferences.map((value) => value - nullShift);
  // Zero differences carry no directional information and are dropped, which
  // is reported rather than hidden because it changes the effective n.
  const differences = rawDifferences.filter((value) => value !== 0);
  const zerosDropped = rawDifferences.length - differences.length;
  const n = differences.length;
  if (n < 1) {
    return {
      test: 'wilcoxon_signed_rank',
      n_pairs: rawDifferences.length,
      n_nonzero: 0,
      zeros_dropped: zerosDropped,
      w_plus: null,
      w_minus: null,
      ties_present: false,
      method: 'exact',
      z: null,
      p_value: null,
      location_shift: locationShift,
      rank_biserial: null,
      degenerate: 'all_differences_zero'
    };
  }
  const { ranks, tie_sizes: tieSizes } = rankValues(differences.map(Math.abs));
  // Exactness for the INTERVAL is decided on the original paired differences,
  // independently of the declared null.
  const pairCount = pairedDifferences.length;
  const intervalExact = rankValues(pairedDifferences.map(Math.abs)).tie_sizes.length === 0 &&
    pairCount <= EXACT_RANK_TEST_MAXIMUM;
  let wPlus = 0;
  for (let index = 0; index < n; index += 1) {
    if (differences[index] > 0) wPlus += ranks[index];
  }
  const totalRank = (n * (n + 1)) / 2;
  const wMinus = totalRank - wPlus;
  const exact = tieSizes.length === 0 && zerosDropped === 0 && n <= EXACT_RANK_TEST_MAXIMUM;

  let pValue;
  let z = null;
  if (exact) {
    const counts = signedRankNullCounts(n);
    const combinations = Math.pow(2, n);
    if (sidedness === 'greater') {
      pValue = tailProbability(counts, combinations, Math.ceil(wPlus), 'at_least');
    } else if (sidedness === 'less') {
      pValue = tailProbability(counts, combinations, Math.floor(wPlus), 'at_most');
    } else {
      const lower = tailProbability(counts, combinations, Math.floor(Math.min(wPlus, wMinus)), 'at_most');
      pValue = Math.min(1, 2 * lower);
    }
  } else {
    const mean = totalRank / 2;
    let tieAdjustment = 0;
    for (const size of tieSizes) tieAdjustment += size * size * size - size;
    const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieAdjustment / 48;
    if (variance <= 0) {
      return {
        test: 'wilcoxon_signed_rank',
        n_pairs: rawDifferences.length,
        n_nonzero: n,
        zeros_dropped: zerosDropped,
        w_plus: wPlus,
        w_minus: wMinus,
        ties_present: tieSizes.length > 0,
        method: 'normal_approximation',
        z: null,
        p_value: null,
        location_shift: locationShift,
        rank_biserial: (wPlus - wMinus) / totalRank,
        degenerate: 'zero_variance'
      };
    }
    z = continuityCorrectedZ(wPlus, mean, Math.sqrt(variance), sidedness);
    pValue = sidedness === 'greater'
      ? 1 - standardNormalCdf(z)
      : sidedness === 'less'
        ? standardNormalCdf(z)
        : Math.min(1, 2 * Math.min(standardNormalCdf(z), 1 - standardNormalCdf(z)));
  }

  return {
    test: 'wilcoxon_signed_rank',
    n_pairs: rawDifferences.length,
    n_nonzero: n,
    zeros_dropped: zerosDropped,
    w_plus: wPlus,
    w_minus: wMinus,
    ties_present: tieSizes.length > 0,
    method: exact ? 'exact' : 'normal_approximation',
    z,
    p_value: pValue,
    // Median of the Walsh averages, the estimator this test inverts.
    location_shift: locationShift,
    confidence_interval: hodgesLehmannInterval(
      walshAverages(pairedDifferences),
      // The interval is a statement about the location shift, so it must not
      // move when the declared null moves. Its null distribution therefore
      // comes from ALL pairs and the unshifted differences -- never from the
      // post-shift, zero-filtered sample the TEST uses, whose size and
      // exactness both depend on the hypothesis being tested.
      intervalExact ? signedRankNullCounts(pairCount) : null,
      confidenceLevel,
      (tail) => {
        const mean = (pairCount * (pairCount + 1)) / 4;
        const variance = (pairCount * (pairCount + 1) * (2 * pairCount + 1)) / 24;
        const z = -studentTQuantile(1 - tail, 1e6);
        return Math.max(0, Math.floor(mean + z * Math.sqrt(variance)));
      },
      sidedness
    ),
    rank_biserial: (wPlus - wMinus) / totalRank
  };
}

export function sampleMoments(values) {
  const sample = numericSample(values, 'Sample', 1);
  const n = sample.length;
  const mean = sample.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { n, mean, variance: null };
  const variance = sample.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / (n - 1);
  return { n, mean, variance };
}

export function oneSampleTTest(values, nullMean, sidedness = 'two_sided') {
  if (typeof nullMean !== 'number' || !Number.isFinite(nullMean)) {
    throw statisticsError('One-sample t-test requires a finite null mean.');
  }
  const { n, mean, variance } = sampleMoments(numericSample(values, 'Sample', 2));
  const degreesOfFreedom = n - 1;
  if (variance === 0) {
    return {
      test: 'student_t_one_sample',
      n,
      mean,
      variance,
      degrees_of_freedom: degreesOfFreedom,
      t: null,
      p_value: null,
      degenerate: 'zero_variance'
    };
  }
  const standardError = Math.sqrt(variance / n);
  const t = (mean - nullMean) / standardError;
  return {
    test: 'student_t_one_sample',
    n,
    mean,
    variance,
    standard_error: standardError,
    degrees_of_freedom: degreesOfFreedom,
    t,
    p_value: pValueFor(t, degreesOfFreedom, sidedness),
    degenerate: null
  };
}

// A paired t-test is the one-sample t-test on within-pair differences
// (group A minus group B), against a null mean difference.
export function pairedTTest(groupA, groupB, nullDifference = 0, sidedness = 'two_sided') {
  if (!Array.isArray(groupA) || !Array.isArray(groupB) ||
      groupA.length !== groupB.length) {
    throw statisticsError('Paired t-test requires two equal-length aligned samples.');
  }
  numericSample(groupA, 'Paired group A', 2);
  numericSample(groupB, 'Paired group B', 2);
  if (typeof nullDifference !== 'number' || !Number.isFinite(nullDifference)) {
    throw statisticsError('Paired t-test requires a finite null difference.');
  }
  const differences = groupA.map((value, index) => value - groupB[index]);
  if (differences.some((value) => !Number.isFinite(value))) {
    throw statisticsError('Paired differences overflowed to a non-finite value.');
  }
  const result = oneSampleTTest(differences, nullDifference, sidedness);
  return {
    ...result,
    test: 'student_t_paired',
    pairs: result.n,
    mean_difference: result.mean
  };
}

export function welchTTest(groupA, groupB, sidedness = 'two_sided', nullDifference = 0) {
  if (typeof nullDifference !== 'number' || !Number.isFinite(nullDifference)) {
    throw statisticsError('Welch t-test requires a finite null difference.');
  }
  const a = sampleMoments(numericSample(groupA, 'Group A', 2));
  const b = sampleMoments(numericSample(groupB, 'Group B', 2));
  const pooled = a.variance / a.n + b.variance / b.n;
  if (pooled === 0) {
    return {
      test: 'welch_t_two_sample',
      group_a: { n: a.n, mean: a.mean, variance: a.variance },
      group_b: { n: b.n, mean: b.mean, variance: b.variance },
      mean_difference: a.mean - b.mean,
      degrees_of_freedom: null,
      t: null,
      p_value: null,
      degenerate: 'zero_variance'
    };
  }
  const degreesOfFreedom = (pooled * pooled) / (
    (a.variance / a.n) * (a.variance / a.n) / (a.n - 1) +
    (b.variance / b.n) * (b.variance / b.n) / (b.n - 1)
  );
  const standardError = Math.sqrt(pooled);
  const t = (a.mean - b.mean - nullDifference) / standardError;
  return {
    test: 'welch_t_two_sample',
    group_a: { n: a.n, mean: a.mean, variance: a.variance },
    group_b: { n: b.n, mean: b.mean, variance: b.variance },
    mean_difference: a.mean - b.mean,
    standard_error: standardError,
    degrees_of_freedom: degreesOfFreedom,
    t,
    p_value: pValueFor(t, degreesOfFreedom, sidedness),
    degenerate: null
  };
}

// Standardized effect size for a computed t-test result. One-sample and
// paired use Cohen's d = (mean - null) / sd (d_z on differences for paired);
// Welch uses the average-variance form d = mean_difference /
// sqrt((var_a + var_b)/2), which does not assume equal variances. Hedges'
// small-sample correction J = 1 - 3/(4*df - 1) uses the computation's own
// degrees of freedom (an approximation for the Welch case).
export function effectSize(computation, nullValue = 0) {
  if (!computation || typeof computation !== 'object' || computation.degenerate) {
    return null;
  }
  let method;
  let value;
  // Hedges' J approximates a ratio of gamma functions in the VARIANCE-estimate
  // degrees of freedom, which for a two-sample d is n1 + n2 - 2. Feeding the
  // Welch-Satterthwaite test df instead would shrink g without bound.
  let correctionDf;
  if (computation.test === 'welch_t_two_sample') {
    method = 'cohens_d_average_variance';
    value = (computation.mean_difference - nullValue) /
      Math.sqrt((computation.group_a.variance + computation.group_b.variance) / 2);
    correctionDf = computation.group_a.n + computation.group_b.n - 2;
  } else if (computation.test === 'student_t_paired') {
    // Literature d_z is the uncentered standardized mean difference; a
    // null-centered value is a different quantity and is named as such.
    method = nullValue === 0 ? 'cohens_d_z' : 'standardized_mean_difference_vs_null';
    value = (computation.mean_difference - nullValue) / Math.sqrt(computation.variance);
    correctionDf = computation.degrees_of_freedom;
  } else if (computation.test === 'student_t_one_sample') {
    method = 'cohens_d';
    value = (computation.mean - nullValue) / Math.sqrt(computation.variance);
    correctionDf = computation.degrees_of_freedom;
  } else {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  // J collapses toward zero as df approaches 1, so below two degrees of
  // freedom the corrected value is reported as unavailable rather than as a
  // spuriously tiny effect.
  const correction = correctionDf >= 2 ? 1 - 3 / (4 * correctionDf - 1) : null;
  return {
    method,
    cohens_d: value,
    hedges_g: correction === null ? null : value * correction,
    small_sample_correction: correction,
    correction_degrees_of_freedom: correctionDf
  };
}

// A one- or two-sided confidence interval for a t-distributed estimate. For
// one-sided tests the unbounded side is null. The interval matches the test's
// sidedness and is computed at the UNADJUSTED level; multiplicity correction
// applies to the decision, not to this interval.
export function tConfidenceInterval({ estimate, standardError, degreesOfFreedom, sidedness, level }) {
  if (typeof estimate !== 'number' || !Number.isFinite(estimate) ||
      typeof standardError !== 'number' || !Number.isFinite(standardError) ||
      standardError <= 0) {
    throw statisticsError('tConfidenceInterval requires a finite estimate and positive standard error.');
  }
  if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0 || level >= 1) {
    throw statisticsError('Confidence level must be strictly between 0 and 1.');
  }
  if (!INFERENCE_SIDEDNESS.includes(sidedness)) {
    throw statisticsError('Unsupported sidedness: ' + String(sidedness));
  }
  // An equivalence interval is two-sided; the caller supplies the 1 - 2*alpha
  // level that corresponds to the TOST decision.
  if (sidedness === 'two_sided' || sidedness === 'equivalence') {
    const quantile = studentTQuantile(1 - (1 - level) / 2, degreesOfFreedom);
    return {
      level,
      lower: estimate - quantile * standardError,
      upper: estimate + quantile * standardError
    };
  }
  const quantile = studentTQuantile(level, degreesOfFreedom);
  if (sidedness === 'greater') {
    return { level, lower: estimate - quantile * standardError, upper: null };
  }
  return { level, lower: null, upper: estimate + quantile * standardError };
}

// familySize is the preregistered family size, not the count of p-values that
// happened to be computable, so missing data can never shrink the correction.
export function adjustPValues(pValues, correction, familySize = pValues.length) {
  if (!MULTIPLICITY_CORRECTIONS.includes(correction)) {
    throw statisticsError('Unsupported multiplicity correction: ' + String(correction));
  }
  if (!Array.isArray(pValues) ||
      !pValues.every((value) => typeof value === 'number' &&
        Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw statisticsError('adjustPValues requires p-values in [0, 1].');
  }
  if (!Number.isSafeInteger(familySize) || familySize < pValues.length || familySize < 1) {
    throw statisticsError('Family size must be an integer at least the number of p-values.');
  }
  if (correction === 'none') return [...pValues];
  if (correction === 'bonferroni') {
    return pValues.map((value) => Math.min(1, value * familySize));
  }
  const order = pValues
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const adjusted = new Array(pValues.length);
  let running = 0;
  for (let rank = 0; rank < order.length; rank += 1) {
    const stepped = Math.min(1, (familySize - rank) * order[rank].value);
    running = Math.max(running, stepped);
    adjusted[order[rank].index] = running;
  }
  return adjusted;
}
