import { studentTQuantile } from './statistics.js';

// Dose-response analysis: the central quantitative measurement of drug
// discovery. A potency estimate (IC50/EC50) is only meaningful alongside the
// model it came from, the concentration range actually tested, and an honest
// statement of whether the fit converged — so all of that is reported, and
// nothing is silently defaulted.
//
// Determinism: the initial guess is derived from the data by a fixed rule, the
// Jacobian uses a fixed relative finite-difference step, the normal equations
// are solved by Gaussian elimination with partial pivoting, and the optimizer
// runs a FIXED number of iterations rather than "until converged". Identical
// inputs therefore replay to identical bits, which is what lets a fitted
// potency be frozen into a verifiable record.
export const PHARMACOLOGY_ENGINE_NAME = 'sciencecode-dose-response';
// v2 corrected the reported diagnostics and the search itself: a real
// convergence criterion, direction read from the fitted plateaus with a
// canonical non-negative hill slope, uncapped plateau coverage, a two-seed
// fit replacing the direction heuristic, and order-invariant accumulation.
// Those all change fitted values or reported fields, so v1 is not a version
// anything may be replayed under -- it is retired rather than supported.
export const PHARMACOLOGY_ENGINE_VERSION = 2;
export const SUPPORTED_PHARMACOLOGY_ENGINE_VERSIONS = Object.freeze([
  PHARMACOLOGY_ENGINE_VERSION
]);

// Frozen parts of the engine. Changing any of these changes fitted values, so
// they are versioned constants, not tuning knobs.
export const DOSE_RESPONSE_ITERATIONS = 200;
const JACOBIAN_RELATIVE_STEP = 1e-7;
const INITIAL_DAMPING = 1e-3;
const MINIMUM_DAMPING = 1e-12;
const MAXIMUM_DAMPING = 1e12;
const MINIMUM_POINTS = 4;
// A plateau counts as observed when the data come within this fraction of the
// fitted amplitude of it. Frozen engine behavior, not a tuning knob.
const PLATEAU_OBSERVATION_MARGIN = 0.1;
// The optimizer is judged converged when the cost stops moving by more than
// this relative amount over the final stretch of iterations.
const CONVERGENCE_TOLERANCE = 1e-12;
const CONVERGENCE_WINDOW = 20;
export const MAX_DOSE_RESPONSE_POINTS = 1_000;

export const DOSE_RESPONSE_MODELS = Object.freeze([
  'four_parameter_logistic',
  'three_parameter_logistic'
]);

function pharmacologyError(message, code = 'INVALID_DOSE_RESPONSE_INPUT') {
  return Object.assign(new Error(message), { code });
}

// bottom + (top - bottom) / (1 + 10^((log10(x) - logEC50) * hill))
function logisticResponse(concentration, [bottom, top, logHalfMaximal, hill]) {
  const exponent = (Math.log10(concentration) - logHalfMaximal) * hill;
  // Guard the exponential against overflow so a wild intermediate parameter
  // cannot turn the whole fit into NaN.
  if (exponent > 300) return bottom;
  if (exponent < -300) return top;
  return bottom + (top - bottom) / (1 + Math.pow(10, exponent));
}

function sumOfSquares(concentrations, responses, parameters) {
  let total = 0;
  for (let index = 0; index < concentrations.length; index += 1) {
    const residual = logisticResponse(concentrations[index], parameters) - responses[index];
    total += residual * residual;
  }
  return total;
}

// Central differences with a fixed relative step: a deterministic function of
// the parameters rather than an adaptive scheme.
function jacobian(concentrations, parameters, freeMask) {
  const rows = [];
  for (let index = 0; index < concentrations.length; index += 1) {
    const row = new Array(parameters.length).fill(0);
    for (let k = 0; k < parameters.length; k += 1) {
      if (!freeMask[k]) continue;
      const step = JACOBIAN_RELATIVE_STEP * (Math.abs(parameters[k]) + JACOBIAN_RELATIVE_STEP);
      const up = [...parameters];
      const down = [...parameters];
      up[k] += step;
      down[k] -= step;
      row[k] = (logisticResponse(concentrations[index], up) -
        logisticResponse(concentrations[index], down)) / (2 * step);
    }
    rows.push(row);
  }
  return rows;
}

// Gaussian elimination with partial pivoting. Returns null for a singular
// system rather than a plausible-looking wrong answer.
function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (!Number.isFinite(augmented[pivot][column]) ||
        Math.abs(augmented[pivot][column]) < 1e-300) {
      return null;
    }
    const temporary = augmented[column];
    augmented[column] = augmented[pivot];
    augmented[pivot] = temporary;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column] / augmented[column][column];
      for (let c = column; c <= n; c += 1) augmented[row][c] -= factor * augmented[column][c];
    }
  }
  const solution = new Array(n);
  for (let index = 0; index < n; index += 1) solution[index] = augmented[index][n] / augmented[index][index];
  return solution.every(Number.isFinite) ? solution : null;
}

// Inverse of a symmetric positive-definite matrix by solving against the
// identity; used for the asymptotic parameter covariance.
function invertMatrix(matrix) {
  const n = matrix.length;
  const inverse = [];
  for (let column = 0; column < n; column += 1) {
    const basis = new Array(n).fill(0);
    basis[column] = 1;
    const solved = solveLinearSystem(matrix.map((row) => [...row]), basis);
    if (!solved) return null;
    inverse.push(solved);
  }
  // inverse currently holds columns; transpose into rows.
  const result = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) result[row][column] = inverse[column][row];
  }
  return result;
}

function numericVector(values, label) {
  if (!Array.isArray(values)) throw pharmacologyError(label + ' must be an array.');
  if (values.length > MAX_DOSE_RESPONSE_POINTS) {
    throw pharmacologyError(label + ' must contain at most ' +
      MAX_DOSE_RESPONSE_POINTS + ' points.');
  }
  return values.map((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw pharmacologyError(label + ' must contain only finite numbers.');
    }
    return value;
  });
}

// Runs the fixed-iteration Levenberg-Marquardt loop from one starting point.
// Reported separately from the caller so a fit can be attempted from more than
// one seed and the better result kept.
function levenbergMarquardt(doses, observed, initial, freeMask) {
  let parameters = [...initial];
  let damping = INITIAL_DAMPING;
  let improved = false;
  let stoppedEarly = false;
  let windowCost = null;
  for (let iteration = 0; iteration < DOSE_RESPONSE_ITERATIONS; iteration += 1) {
    const currentCost = sumOfSquares(doses, observed, parameters);
    const rows = jacobian(doses, parameters, freeMask);
    const size = parameters.length;
    const normal = Array.from({ length: size }, () => new Array(size).fill(0));
    const gradient = new Array(size).fill(0);
    for (let index = 0; index < doses.length; index += 1) {
      const residual = logisticResponse(doses[index], parameters) - observed[index];
      for (let a = 0; a < size; a += 1) {
        gradient[a] += rows[index][a] * residual;
        for (let b = 0; b < size; b += 1) normal[a][b] += rows[index][a] * rows[index][b];
      }
    }
    // Freeze out fixed parameters so the system stays non-singular.
    for (let a = 0; a < size; a += 1) {
      if (freeMask[a]) continue;
      for (let b = 0; b < size; b += 1) { normal[a][b] = 0; normal[b][a] = 0; }
      normal[a][a] = 1;
      gradient[a] = 0;
    }
    const damped = normal.map((row, a) => row.map((value, b) => (a === b ? value * (1 + damping) : value)));
    if (iteration === DOSE_RESPONSE_ITERATIONS - CONVERGENCE_WINDOW) windowCost = currentCost;
    const step = solveLinearSystem(damped, gradient.map((value) => -value));
    // A singular system or a non-finite step means the optimizer could not
    // continue, which is reported rather than passed off as a finished fit.
    if (!step) { stoppedEarly = true; break; }
    const candidate = parameters.map((value, index) => value + step[index]);
    if (!candidate.every(Number.isFinite)) { stoppedEarly = true; break; }
    const candidateCost = sumOfSquares(doses, observed, candidate);
    if (candidateCost < currentCost) {
      parameters = candidate;
      damping = Math.max(damping / 10, MINIMUM_DAMPING);
      improved = true;
    } else {
      damping = Math.min(damping * 10, MAXIMUM_DAMPING);
    }
  }
  const finalCost = sumOfSquares(doses, observed, parameters);
  // Converged means the cost stopped moving, not merely that some early step
  // once helped. A fit that is still descending when the iteration budget runs
  // out has NOT converged, and must not claim to have.
  const settled = windowCost === null
    ? improved
    : (windowCost - finalCost) <= CONVERGENCE_TOLERANCE * Math.max(windowCost, Number.MIN_VALUE);
  return {
    parameters,
    cost: finalCost,
    improved,
    stopped_early: stoppedEarly,
    converged: improved && settled && !stoppedEarly
  };
}

/**
 * Fit a dose-response curve and report the half-maximal concentration.
 *
 * Concentrations must be strictly positive: the model is logarithmic in dose,
 * so a zero or negative concentration has no place on the curve. A vehicle
 * control belongs in the `bottom` parameter, not as a zero dose.
 */
export function doseResponseFit({
  concentrations,
  responses,
  model = 'four_parameter_logistic',
  bottom = null,
  confidenceLevel = 0.95
} = {}) {
  if (!DOSE_RESPONSE_MODELS.includes(model)) {
    throw pharmacologyError('Unsupported dose-response model: ' + String(model));
  }
  let doses = numericVector(concentrations, 'Concentrations');
  let observed = numericVector(responses, 'Responses');
  if (doses.length !== observed.length) {
    throw pharmacologyError('Concentrations and responses must have equal length.');
  }
  if (doses.length < MINIMUM_POINTS) {
    throw pharmacologyError('A dose-response fit requires at least ' +
      MINIMUM_POINTS + ' points.');
  }
  if (doses.some((dose) => dose <= 0)) {
    throw pharmacologyError(
      'Concentrations must be strictly positive; the model is logarithmic in ' +
      'dose, so a vehicle control belongs in the bottom parameter rather than ' +
      'as a zero concentration.'
    );
  }
  if (typeof confidenceLevel !== 'number' || !(confidenceLevel > 0) || !(confidenceLevel < 1)) {
    throw pharmacologyError('Confidence level must be strictly between 0 and 1.');
  }
  const fixedBottom = model === 'three_parameter_logistic';
  if (fixedBottom && (typeof bottom !== 'number' || !Number.isFinite(bottom))) {
    throw pharmacologyError(
      'A three-parameter fit requires a finite fixed bottom value.'
    );
  }

  // Accumulating the normal equations in input order makes the result depend on
  // that order at the last few bits. Sorting first makes the fit a function of
  // the DATASET rather than of how it happened to be listed, which is what a
  // reader of a frozen record will assume.
  const pairOrder = doses.map((dose, index) => index)
    .sort((left, right) => doses[left] - doses[right] ||
      observed[left] - observed[right] || left - right);
  const sortedDoses = pairOrder.map((index) => doses[index]);
  const sortedObserved = pairOrder.map((index) => observed[index]);
  doses = sortedDoses;
  observed = sortedObserved;

  const logDoses = doses.map((dose) => Math.log10(dose));
  const minimumLogDose = Math.min(...logDoses);
  const maximumLogDose = Math.max(...logDoses);
  const sortedResponses = [...observed].sort((left, right) => left - right);
  const lowestResponse = sortedResponses[0];
  const highestResponse = sortedResponses[sortedResponses.length - 1];
  const responseRange = highestResponse - lowestResponse;
  if (responseRange === 0) {
    return {
      engine: { name: PHARMACOLOGY_ENGINE_NAME, version: PHARMACOLOGY_ENGINE_VERSION },
      model,
      n_points: doses.length,
      degenerate: 'no_response_range'
    };
  }

  // Rather than guess the curve's direction from the data — which on a four or
  // five point design reduces to comparing single, possibly noisy endpoints,
  // and which lands the optimizer on a mirrored solution when it guesses wrong
  // — the fit is attempted from BOTH directions and the lower-cost result is
  // kept. Deterministic, and it removes the heuristic's failure mode entirely.
  const freeMask = [!fixedBottom, true, true, true];
  const seedFor = (hill) => [
    fixedBottom ? bottom : lowestResponse,
    highestResponse,
    (minimumLogDose + maximumLogDose) / 2,
    hill
  ];
  const descending = levenbergMarquardt(doses, observed, seedFor(1), freeMask);
  const ascending = levenbergMarquardt(doses, observed, seedFor(-1), freeMask);
  // Ties go to the descending seed so the choice never depends on float noise.
  const best = ascending.cost < descending.cost ? ascending : descending;
  // The four-parameter model has an exact symmetry: swapping the plateaus and
  // negating the hill slope describes the identical curve. Both seeds can
  // therefore land on equivalent-but-mirrored answers with the same cost. The
  // result is canonicalized to a non-negative hill slope so the reported
  // parameters are stable and comparable between fits.
  const parameters = [...best.parameters];
  if (parameters[3] < 0) {
    const swappedBottom = parameters[1];
    parameters[1] = parameters[0];
    parameters[0] = swappedBottom;
    parameters[3] = -parameters[3];
  }

  const [fittedBottom, fittedTop, logHalfMaximal, hillSlope] = parameters;
  const residualSumOfSquares = sumOfSquares(doses, observed, parameters);
  const freeParameters = freeMask.filter(Boolean).length;
  const degreesOfFreedom = doses.length - freeParameters;
  const meanResponse = observed.reduce((sum, value) => sum + value, 0) / observed.length;
  let totalSumOfSquares = 0;
  for (const value of observed) totalSumOfSquares += (value - meanResponse) * (value - meanResponse);

  // Asymptotic standard errors from the parameter covariance. This is a large
  // sample approximation on a nonlinear model, and is reported as such: the
  // interval is on log10 concentration, where the estimator is far closer to
  // symmetric, then exponentiated. An interval taken directly on the
  // concentration scale would be misleadingly narrow on the low side.
  let logStandardError = null;
  let interval = null;
  if (degreesOfFreedom > 0 && residualSumOfSquares > 0) {
    const rows = jacobian(doses, parameters, freeMask);
    const size = parameters.length;
    const normal = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let index = 0; index < doses.length; index += 1) {
      for (let a = 0; a < size; a += 1) {
        for (let b = 0; b < size; b += 1) normal[a][b] += rows[index][a] * rows[index][b];
      }
    }
    for (let a = 0; a < size; a += 1) {
      if (freeMask[a]) continue;
      for (let b = 0; b < size; b += 1) { normal[a][b] = 0; normal[b][a] = 0; }
      normal[a][a] = 1;
    }
    const inverse = invertMatrix(normal);
    const variance = residualSumOfSquares / degreesOfFreedom;
    if (inverse && inverse[2][2] > 0) {
      logStandardError = Math.sqrt(variance * inverse[2][2]);
      const quantile = studentTQuantile(1 - (1 - confidenceLevel) / 2, degreesOfFreedom);
      const margin = quantile * logStandardError;
      interval = {
        level: confidenceLevel,
        lower: Math.pow(10, logHalfMaximal - margin),
        upper: Math.pow(10, logHalfMaximal + margin),
        scale: 'log10_concentration',
        method: 'student_t_on_asymptotic_covariance'
      };
    }
  }

  // A four-parameter fit can invent a plateau the assay never reached, and
  // then report a confident midpoint between one measured and one imaginary
  // asymptote. R-squared does not catch this: the curve still passes through
  // every point. So the coverage of each plateau is measured and reported.
  const fittedAmplitude = Math.abs(fittedTop - fittedBottom);
  const observedSpan = highestResponse - lowestResponse;
  // NOT capped at 1. A ratio above 1 means the fitted curve spans LESS than the
  // data — the fit has collapsed toward a step function whose plateaus sit
  // inside the observations. Capping would report that failure as perfect
  // coverage, which is precisely backwards.
  const plateauCoverage = fittedAmplitude > 0
    ? observedSpan / fittedAmplitude
    : null;
  const margin = fittedAmplitude * PLATEAU_OBSERVATION_MARGIN;
  const lowerPlateau = Math.min(fittedBottom, fittedTop);
  const upperPlateau = Math.max(fittedBottom, fittedTop);
  const lowerPlateauObserved = fittedAmplitude > 0 && lowestResponse <= lowerPlateau + margin;
  const upperPlateauObserved = fittedAmplitude > 0 && highestResponse >= upperPlateau - margin;
  // A fitted amplitude smaller than the observed spread is a collapsed fit, not
  // a well-covered one, so it disqualifies the "plateaus observed" claim.
  const amplitudeBelowObserved = plateauCoverage !== null &&
    plateauCoverage > 1 + PLATEAU_OBSERVATION_MARGIN;

  const rSquared = totalSumOfSquares > 0
    ? 1 - residualSumOfSquares / totalSumOfSquares
    : null;

  const halfMaximal = Math.pow(10, logHalfMaximal);
  // A potency outside the tested range is an extrapolation, not a measurement.
  // Reporting it without saying so is one of the most common ways a dose
  // -response number misleads, so it is flagged rather than left to the reader.
  const extrapolated = logHalfMaximal < minimumLogDose || logHalfMaximal > maximumLogDose;

  return {
    engine: { name: PHARMACOLOGY_ENGINE_NAME, version: PHARMACOLOGY_ENGINE_VERSION },
    model,
    n_points: doses.length,
    bottom: fittedBottom,
    top: fittedTop,
    half_maximal_concentration: halfMaximal,
    log10_half_maximal: logHalfMaximal,
    hill_slope: hillSlope,
    // Direction is read off the fitted curve, not the starting guess. With the
    // canonical non-negative hill slope, low dose tends to `top` and high dose
    // to `bottom`, so the response falls exactly when top exceeds bottom. The
    // hill sign alone is NOT enough: it flips meaning when the plateaus are
    // ordered the other way.
    direction: fittedTop > fittedBottom ? 'decreasing' : 'increasing',
    residual_sum_of_squares: residualSumOfSquares,
    degrees_of_freedom: degreesOfFreedom,
    r_squared: rSquared,
    // With as many free parameters as points there is nothing left to assess
    // the fit against: it can pass through every observation regardless of
    // whether the model is right, and no interval can be formed.
    saturated_design: degreesOfFreedom <= 0,
    // A negative r-squared means the fitted curve explains the data worse than
    // a flat line at their mean. That is not a weak fit, it is a failed one,
    // and zero is a principled boundary rather than a chosen threshold.
    fit_worse_than_mean: rSquared !== null && rSquared < 0,
    log10_standard_error: logStandardError,
    confidence_interval: interval,
    converged: best.converged,
    // True when the optimizer could not continue (singular normal equations or
    // a non-finite step) rather than finishing its iteration budget.
    stopped_early: best.stopped_early,
    // True when the fitted potency lies outside the concentrations actually
    // tested, i.e. the number is extrapolated beyond the evidence.
    extrapolated,
    // Fraction of the fitted curve's amplitude the observations actually span,
    // and whether each plateau was approached. When a plateau is unobserved the
    // potency is a midpoint between a measured and an assumed asymptote, and is
    // far less certain than the residuals alone suggest.
    plateau_coverage: plateauCoverage,
    lower_plateau_observed: lowerPlateauObserved,
    upper_plateau_observed: upperPlateauObserved,
    plateaus_observed: lowerPlateauObserved && upperPlateauObserved && !amplitudeBelowObserved,
    amplitude_below_observed_range: amplitudeBelowObserved,
    concentration_range: { minimum: Math.pow(10, minimumLogDose), maximum: Math.pow(10, maximumLogDose) },
    iterations: DOSE_RESPONSE_ITERATIONS
  };
}
