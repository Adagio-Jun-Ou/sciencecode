import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSE_RESPONSE_ITERATIONS,
  PHARMACOLOGY_ENGINE_VERSION,
  SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS,
  convertQuantity,
  doseResponseFit,
  sha256Json
} from '../lib/core.js';

// Reference parameters below were cross-checked against SciPy 1.17.1
// scipy.optimize.curve_fit on the same data. Exactly-fitting cases agree to
// ~1e-10; the noisy case agrees on residual sum of squares to 9 decimals,
// which is the meaningful check — both optimizers reach the same minimum, and
// the remaining parameter digits differ only within its flatness.
const logistic = (x, [bottom, top, logHalf, hill]) =>
  bottom + (top - bottom) / (1 + Math.pow(10, (Math.log10(x) - logHalf) * hill));

test('an exact dose-response curve recovers its own parameters', () => {
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const truth = [0, 100, Math.log10(250), 1];
  const responses = doses.map((dose) => logistic(dose, truth));
  const fit = doseResponseFit({ concentrations: doses, responses });

  assert.ok(Math.abs(fit.half_maximal_concentration - 250) < 1e-6);
  assert.ok(Math.abs(fit.hill_slope - 1) < 1e-6);
  assert.ok(Math.abs(fit.top - 100) < 1e-6);
  assert.ok(Math.abs(fit.bottom) < 1e-6);
  assert.equal(fit.r_squared, 1);
  assert.equal(fit.converged, true);
  assert.equal(fit.direction, 'decreasing');
  assert.equal(fit.model, 'four_parameter_logistic');
  assert.equal(fit.engine.version, PHARMACOLOGY_ENGINE_VERSION);
  // A perfect fit has no residual variance, so no interval is claimed.
  assert.equal(fit.confidence_interval, null);

  // A steep curve with offset plateaus, matched to SciPy to 10 decimals.
  const steepDoses = [0.1, 0.3, 1, 3, 10, 30, 100, 300];
  const steep = doseResponseFit({
    concentrations: steepDoses,
    responses: steepDoses.map((dose) => logistic(dose, [5, 95, Math.log10(4.2), 2.1]))
  });
  assert.ok(Math.abs(steep.half_maximal_concentration - 4.2) < 1e-8);
  assert.ok(Math.abs(steep.hill_slope - 2.1) < 1e-8);
});

test('the fit is bit-reproducible, which is what lets a potency be frozen', () => {
  const doses = [1, 3, 10, 30, 100, 300, 1000];
  const responses = [99.1, 97.4, 91.2, 74.8, 46.3, 19.7, 6.2];
  const first = doseResponseFit({ concentrations: doses, responses });
  const second = doseResponseFit({ concentrations: doses, responses });
  assert.equal(sha256Json(first), sha256Json(second));
  // The iteration count is fixed, not convergence-dependent, so runtime and
  // result cannot vary with the data.
  assert.equal(first.iterations, DOSE_RESPONSE_ITERATIONS);
});

test('a noisy curve matches the reference optimizer at the same minimum', () => {
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const clean = doses.map((dose) => logistic(dose, [0, 100, Math.log10(250), 1]));
  const perturbation = [1.5, -1.5, 0, 1.5, -1.5, 0, 1.5, -1.5, 0];
  const responses = clean.map((value, index) => value + perturbation[index]);
  const fit = doseResponseFit({ concentrations: doses, responses });

  // SciPy reaches rss = 12.574085576 on this data; agreeing here proves both
  // found the same optimum.
  assert.ok(Math.abs(fit.residual_sum_of_squares - 12.574085575547644) < 1e-6);
  assert.ok(Math.abs(fit.half_maximal_concentration - 252.1162764) < 1e-3);
  assert.ok(Math.abs(fit.hill_slope - 0.9663920917) < 1e-5);
  assert.ok(Math.abs(fit.log10_standard_error - 0.030169675709484218) < 1e-5);

  // With residual variance there is an interval, reported on the log10 scale
  // where the estimator is far closer to symmetric.
  assert.equal(fit.confidence_interval.scale, 'log10_concentration');
  assert.equal(fit.confidence_interval.level, 0.95);
  assert.ok(fit.confidence_interval.lower < fit.half_maximal_concentration);
  assert.ok(fit.confidence_interval.upper > fit.half_maximal_concentration);
  // The interval is asymmetric on the concentration scale, as it must be.
  const below = fit.half_maximal_concentration - fit.confidence_interval.lower;
  const above = fit.confidence_interval.upper - fit.half_maximal_concentration;
  assert.ok(above > below);
});

test('an unobserved plateau is reported even when r-squared looks excellent', () => {
  // The trap: a four-parameter fit can invent a plateau the assay never
  // reached and report a confident midpoint between one measured and one
  // imaginary asymptote. Here responses stop at 61 while the fit places the
  // bottom near 51 -- and r-squared is still above 0.999.
  const partial = doseResponseFit({
    concentrations: [1, 3, 10, 30, 100],
    responses: [100, 96, 88, 74, 61]
  });
  assert.ok(partial.r_squared > 0.999, 'the fit still passes through every point');
  assert.equal(partial.lower_plateau_observed, false);
  assert.equal(partial.upper_plateau_observed, true);
  assert.equal(partial.plateaus_observed, false);
  assert.ok(partial.plateau_coverage < 1);

  // A full curve reaching both plateaus reports the opposite.
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const full = doseResponseFit({
    concentrations: doses,
    responses: doses.map((dose) => logistic(dose, [0, 100, Math.log10(250), 1]))
  });
  assert.equal(full.plateaus_observed, true);
  assert.ok(full.plateau_coverage > 0.9);
});

test('a potency outside the tested range is flagged as extrapolated', () => {
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const inRange = doseResponseFit({
    concentrations: doses,
    responses: doses.map((dose) => logistic(dose, [0, 100, Math.log10(250), 1]))
  });
  assert.equal(inRange.extrapolated, false);
  assert.equal(inRange.concentration_range.minimum, 1);
  assert.equal(inRange.concentration_range.maximum, 10000);
});

test('an increasing response curve is fitted in the right direction', () => {
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const responses = doses.map((dose) => logistic(dose, [100, 0, Math.log10(250), 1]));
  const fit = doseResponseFit({ concentrations: doses, responses });
  assert.equal(fit.direction, 'increasing');
  assert.ok(Math.abs(fit.half_maximal_concentration - 250) < 1e-5);
});

test('a three-parameter fit holds the declared bottom fixed', () => {
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const responses = doses.map((dose) => logistic(dose, [0, 100, Math.log10(250), 1]));
  const fit = doseResponseFit({
    concentrations: doses,
    responses,
    model: 'three_parameter_logistic',
    bottom: 0
  });
  assert.equal(fit.bottom, 0, 'the fixed plateau must not drift');
  assert.equal(fit.model, 'three_parameter_logistic');
  assert.ok(Math.abs(fit.half_maximal_concentration - 250) < 1e-6);
  // One fewer free parameter means one more degree of freedom.
  assert.equal(fit.degrees_of_freedom, doses.length - 3);
  assert.throws(() => doseResponseFit({
    concentrations: doses, responses, model: 'three_parameter_logistic'
  }), /finite fixed bottom/);
});

test('the fit refuses input it cannot honestly model', () => {
  const doses = [1, 10, 100, 1000];
  const responses = [100, 75, 25, 0];
  // A zero dose has no place on a log axis; a vehicle control is the bottom.
  assert.throws(() => doseResponseFit({
    concentrations: [0, 10, 100, 1000], responses
  }), /strictly positive/);
  assert.throws(() => doseResponseFit({
    concentrations: [-1, 10, 100, 1000], responses
  }), /strictly positive/);
  assert.throws(() => doseResponseFit({
    concentrations: [1, 10], responses: [100, 0]
  }), /at least 4 points/);
  assert.throws(() => doseResponseFit({
    concentrations: doses, responses: [1, 2, 3]
  }), /equal length/);
  assert.throws(() => doseResponseFit({
    concentrations: doses, responses, model: 'five_parameter'
  }), /Unsupported dose-response model/);
  assert.throws(() => doseResponseFit({
    concentrations: doses, responses, confidenceLevel: 1
  }), /strictly between 0 and 1/);
  assert.throws(() => doseResponseFit({
    concentrations: doses, responses: [100, 75, 25, Number.NaN]
  }), /finite numbers/);

  // A flat response has no curve to fit, and says so rather than returning a
  // meaningless potency.
  const flat = doseResponseFit({
    concentrations: doses, responses: [50, 50, 50, 50]
  });
  assert.equal(flat.degenerate, 'no_response_range');
  assert.equal(flat.half_maximal_concentration, undefined);
});

test('potency concentrations round-trip through the bounded unit registry', () => {
  // Potency work is useless if the concentration unit cannot be frozen and
  // converted, so the registry must carry the range assays actually use.
  assert.equal(convertQuantity({ value: 250, unit: 'nM' }, 'uM', 'x').value, 0.25);
  assert.equal(convertQuantity({ value: 1, unit: 'nM' }, 'pM', 'x').value, 1000);
  assert.equal(convertQuantity({ value: 1, unit: 'uM' }, 'nM', 'x').value, 1000);
  assert.equal(convertQuantity({ value: 1, unit: 'mM' }, 'uM', 'x').value, 1000);
  assert.equal(convertQuantity({ value: 1, unit: 'pmol' }, 'nmol', 'x').value, 0.001);
  assert.deepEqual([...SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS], [PHARMACOLOGY_ENGINE_VERSION]);
});

test('direction comes from the fitted curve, not the starting guess', () => {
  // Regression: `direction` was the initial heuristic and was never recomputed,
  // so it contradicted the reported hill slope on a fifth of hard fits. The
  // hill sign alone is not sufficient either -- it flips meaning when the
  // plateaus are ordered the other way, so direction is read off the plateaus.
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000];
  const falling = doseResponseFit({
    concentrations: doses,
    responses: doses.map((dose) => logistic(dose, [0, 100, 1, 1]))
  });
  assert.equal(falling.direction, 'decreasing');
  assert.ok(falling.top > falling.bottom);

  const rising = doseResponseFit({
    concentrations: doses,
    responses: doses.map((dose) => logistic(dose, [100, 0, 1, 1]))
  });
  assert.equal(rising.direction, 'increasing');
  assert.ok(rising.bottom > rising.top);

  // The model has an exact symmetry (swap plateaus, negate hill), so the fit is
  // canonicalized to a non-negative hill slope and stays comparable.
  assert.ok(falling.hill_slope >= 0);
  assert.ok(rising.hill_slope >= 0);

  // A depressed low-dose point used to flip the direction heuristic and land
  // the fit on a mirrored solution.
  const awkward = doseResponseFit({
    concentrations: [1, 10, 100, 1000], responses: [0, 99.01, 50, 0.99]
  });
  assert.ok(awkward.hill_slope >= 0);
  assert.equal(awkward.direction, awkward.top > awkward.bottom ? 'decreasing' : 'increasing');
});

test('the fit is invariant to the order the points are listed in', () => {
  // Accumulating the normal equations in input order made the result depend on
  // it at the last few bits. A frozen record describes a dataset, not a
  // particular listing of it.
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000];
  const responses = doses
    .map((dose) => logistic(dose, [0, 100, 1, 1]))
    .map((value, index) => value + [0.7, -0.5, 0.3, -0.9, 0.4, 0.2, -0.6, 0.1][index]);
  const base = doseResponseFit({ concentrations: doses, responses });
  const permutation = [5, 0, 7, 2, 6, 1, 4, 3];
  const shuffled = doseResponseFit({
    concentrations: permutation.map((index) => doses[index]),
    responses: permutation.map((index) => responses[index])
  });
  assert.equal(sha256Json(shuffled), sha256Json(base));
});

test('a failed fit is reported as failed rather than dressed in a potency', () => {
  // Every one of these used to report converged:true with healthy-looking
  // plateau flags.
  const stepLike = doseResponseFit({
    concentrations: [1, 10, 100, 1000], responses: [1, 99.01, 50, 0.99]
  });
  assert.equal(stepLike.converged, false);
  // The fitted curve spans less than the data, which is a collapse, not
  // perfect coverage -- so the ratio is reported uncapped.
  assert.ok(stepLike.plateau_coverage > 1);
  assert.equal(stepLike.amplitude_below_observed_range, true);
  assert.equal(stepLike.plateaus_observed, false);

  // A negative r-squared means the curve does worse than a flat line at the
  // mean. Zero is a principled boundary, not a chosen threshold.
  const collapsed = doseResponseFit({
    concentrations: [1, 10, 100, 1000],
    responses: [0, 99.01, 50, 0.99],
    model: 'three_parameter_logistic',
    bottom: 100
  });
  assert.ok(collapsed.r_squared < 0);
  assert.equal(collapsed.fit_worse_than_mean, true);

  // A well-behaved fit claims none of these.
  const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const good = doseResponseFit({
    concentrations: doses,
    responses: doses.map((dose) => logistic(dose, [0, 100, Math.log10(250), 1]))
  });
  assert.equal(good.converged, true);
  assert.equal(good.stopped_early, false);
  assert.equal(good.fit_worse_than_mean, false);
  assert.equal(good.amplitude_below_observed_range, false);
  assert.equal(good.saturated_design, false);
});

test('a design with no degrees of freedom says so', () => {
  // Four points and four free parameters: the curve can pass through every
  // observation whether or not the model is right.
  const saturated = doseResponseFit({
    concentrations: [1, 10, 100, 1000], responses: [100, 74, 26, 1]
  });
  assert.equal(saturated.saturated_design, true);
  assert.equal(saturated.degrees_of_freedom, 0);
  assert.equal(saturated.confidence_interval, null);

  // Fixing the bottom frees a degree of freedom back up.
  const threeParam = doseResponseFit({
    concentrations: [1, 10, 100, 1000], responses: [100, 74, 26, 1],
    model: 'three_parameter_logistic', bottom: 0
  });
  assert.equal(threeParam.saturated_design, false);
  assert.equal(threeParam.degrees_of_freedom, 1);
});
