import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExperimentReview,
  convertQuantity,
  describeUnit,
  listSupportedUnits,
  normalizeQuantity,
  normalizeUnitDeclaration,
  parseUnit,
  unitsCompatible
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; }
  };
}

function invoke(argv) {
  const stdout = capture();
  const stderr = capture();
  const code = runCli({ argv, stdout: stdout.stream, stderr: stderr.stream });
  return { code, stdout: stdout.read(), stderr: stderr.read() };
}

test('bounded unit parsing normalizes aliases and composes registered dimensions', () => {
  assert.deepEqual(parseUnit('mg/L'), {
    symbol: 'mg/L',
    dimension: 'mass_concentration',
    canonical_unit: 'kg/m^3',
    scale_to_canonical: 0.001,
    scale_parts: { numerator: 1, denominator: 1, decades: -3 },
    offset_to_canonical: 0,
    affine: false,
    compatibility_key: 'linear|mass:1,length:-3'
  });
  const force = parseUnit('kg * m / s^2');
  assert.equal(force.symbol, 'kg*m/s^2');
  assert.equal(force.dimension, 'force');
  assert.equal(force.canonical_unit, 'N');
  assert.equal(force.scale_to_canonical, 1);
  assert.equal(parseUnit('µg/mL').symbol, 'ug/mL');
  assert.equal(parseUnit('µg/mL').scale_to_canonical, 0.001);
  assert.equal(parseUnit('milliseconds').symbol, 'ms');
  assert.equal(parseUnit('mM').scale_to_canonical, 1);
  assert.equal(parseUnit('M').scale_to_canonical, 1000);
  assert.equal(describeUnit('°C').symbol, 'degC');
  assert.equal(unitsCompatible('mL', 'cm^3'), true);
  assert.equal(unitsCompatible('%', '1'), true);
  assert.equal(unitsCompatible('count', '1'), false);
  assert.ok(listSupportedUnits().some((unit) => unit.symbol === 'delta_degC'));
});

test('quantity conversion handles scaling and affine temperature without conflating differences', () => {
  assert.deepEqual(convertQuantity({ value: 1000, unit: 'ms' }, 's'), {
    value: 1,
    unit: 's',
    source: { value: 1000, unit: 'ms' },
    dimension: 'time',
    converted: true
  });
  assert.equal(convertQuantity({ value: 50, unit: '%' }, '1').value, 0.5);
  assert.equal(convertQuantity({ value: 2, unit: 'mg/mL' }, 'kg/m^3').value, 2);
  assert.equal(convertQuantity({ value: 25, unit: 'degC' }, 'K').value, 298.15);
  assert.equal(convertQuantity({ value: 9, unit: 'delta_degC' }, 'delta_K').value, 9);
  assert.throws(() => convertQuantity({ value: 1, unit: 'K' }, 'delta_K'), {
    code: 'UNIT_DIMENSION_MISMATCH'
  });
  assert.throws(() => parseUnit('K/s'), { code: 'INVALID_UNIT' });
});

test('unit and quantity schemas fail closed on ambiguity, unsupported syntax, and overflow', () => {
  assert.deepEqual(normalizeUnitDeclaration({ symbol: 'seconds' }), {
    symbol: 's', dimension: 'time', canonical_unit: 's'
  });
  assert.deepEqual(normalizeQuantity({ value: -0, unit: 'milliseconds' }), {
    value: 0, unit: 'ms'
  });
  assert.throws(() => normalizeUnitDeclaration({ symbol: 's', guessed: true }), {
    code: 'INVALID_UNIT'
  });
  assert.throws(() => normalizeQuantity({ value: 1, unit: 's', note: 'guess' }), {
    code: 'INVALID_QUANTITY'
  });
  assert.throws(() => normalizeQuantity({ value: Number.NaN, unit: 's' }), {
    code: 'INVALID_QUANTITY'
  });
  assert.throws(() => convertQuantity({ value: 1, unit: 's' }, {
    symbol: 's', dimension: 'length', canonical_unit: 's'
  }), { code: 'INVALID_UNIT' });
  assert.throws(() => convertQuantity({ value: 1, unit: 's' }, {
    symbol: 's', guessed: true
  }), { code: 'INVALID_UNIT' });
  assert.throws(() => parseUnit('m s'), { code: 'INVALID_UNIT' });
  assert.throws(() => parseUnit('m^13'), { code: 'INVALID_UNIT' });
  assert.throws(() => parseUnit('furlong'), { code: 'INVALID_UNIT' });
  assert.throws(() => convertQuantity({ value: Number.MAX_VALUE, unit: 'km' }, 'm'), {
    code: 'INVALID_QUANTITY'
  });
});

test('typed experiment review aggregates compatible quantities and rejects malformed summaries', () => {
  const valid = [{
    branch_index: 0,
    simulation_id: 'simulation-a',
    status: 'completed',
    verified: true,
    final_statistics: {
      latency: { value: 500, unit: 'ms' },
      temperature: { value: 25, unit: 'degC' }
    }
  }, {
    branch_index: 1,
    simulation_id: 'simulation-b',
    status: 'completed',
    verified: true,
    final_statistics: {
      latency: { value: 1, unit: 's' },
      temperature: { value: 300, unit: 'K' }
    }
  }];
  const review = buildExperimentReview(valid, 2, { quantityMode: true });
  assert.equal(review.schema_version, 2);
  assert.equal(review.verdict, 'pass');
  assert.deepEqual(review.numeric_aggregates, {});
  assert.equal(review.quantity_aggregates.latency.mean, 0.75);
  assert.equal(review.quantity_aggregates.latency.unit, 's');
  assert.deepEqual(review.quantity_aggregates.latency.source_units, ['ms', 's']);
  assert.equal(review.quantity_aggregates.temperature.unit, 'K');
  assert.equal(review.quantity_aggregates.temperature.sample_standard_deviation_unit, 'delta_K');
  assert.deepEqual(review.quantity_diagnostics, []);

  const malformed = structuredClone(valid);
  malformed[0].final_statistics.latency = 500;
  malformed[1].final_statistics.temperature = { value: 1, unit: 'm' };
  const failed = buildExperimentReview(malformed, 2, { quantityMode: true });
  assert.equal(failed.verdict, 'warn');
  assert.equal(failed.checks.find((check) =>
    check.name === 'valid_typed_quantity_summaries').ok, false);
  assert.deepEqual(failed.quantity_diagnostics.map((item) => item.issue), [
    'invalid_statistic_quantity',
    'incompatible_statistic_dimension'
  ]);
  assert.ok(failed.findings.some((finding) => finding.severity === 'error'));

  const overflowing = structuredClone(valid);
  overflowing[0].final_statistics = { mass: { value: Number.MAX_VALUE, unit: 'kg' } };
  overflowing[1].final_statistics = { mass: { value: Number.MAX_VALUE, unit: 'kg' } };
  const overflowReview = buildExperimentReview(overflowing, 2, { quantityMode: true });
  assert.equal(overflowReview.verdict, 'warn');
  assert.deepEqual(overflowReview.quantity_diagnostics, [{
    branch_index: null,
    statistic: 'mass',
    issue: 'quantity_aggregate_nonfinite'
  }]);
});

test('unit CLI exposes inspection, conversion, listing, help, and usage failures', () => {
  const converted = invoke(['unit', 'convert', '1000', 'ms', 's', '--json']);
  assert.equal(converted.code, 0, converted.stderr);
  assert.deepEqual(JSON.parse(converted.stdout).result, { value: 1, unit: 's' });

  const inspected = invoke(['units', 'inspect', 'mg/L', '--json']);
  assert.equal(inspected.code, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).dimension, 'mass_concentration');

  const listed = invoke(['unit', 'list']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /SYMBOL\s+DIMENSION\s+CANONICAL/);
  assert.match(listed.stdout, /delta_degC/);

  assert.equal(invoke(['unit', '--help']).code, 0);
  assert.equal(invoke(['unit', 'convert', '1', 'm', 's']).code, 2);
  assert.equal(invoke(['unit', 'convert', '01', 'm', 'cm']).code, 2);
  assert.equal(invoke(['unit', 'inspect', 'unknown']).code, 2);
  assert.equal(invoke(['unit', 'list', '--json', '--json']).code, 2);
  assert.equal(invoke(['unit', 'list', '--wat']).code, 2);
});

test('decimal-scaled conversions are exact so threshold comparisons do not flip', () => {
  // A ratio of two independently rounded binary64 scales (1e-6 / 1e-9) lands an
  // ULP away from 1000, which silently inverts a preregistered pass/fail
  // verdict for an observation sitting exactly on the declared threshold.
  const exact = [
    [1, 'ppm', 'ppb', 1000],
    [1, 'cm^3', 'mL', 1],
    [1, 'g/cm^3', 'kg/m^3', 1000],
    [1, 'mg', 'ug', 1000],
    [1, 'um', 'nm', 1000],
    [1, 'mL', 'uL', 1000],
    [1, 'ms', 'us', 1000],
    [1, 'uM', 'nM', 1000],
    [1000, 'mm^3', 'cm^3', 1],
    [1, 'L', 'cm^3', 1000],
    [1, 'd', 'h', 24],
    [1, 'h', 'min', 60],
    [1, '%', 'ppm', 10000]
  ];
  for (const [value, from, to, expected] of exact) {
    const converted = convertQuantity({ value, unit: from }, to);
    assert.equal(converted.value, expected,
      value + ' ' + from + ' -> ' + to + ' must be exact');
  }

  // Absolute and delta temperature keep their affine handling.
  assert.equal(convertQuantity({ value: 25, unit: 'degC' }, 'K').value, 298.15);
  assert.equal(convertQuantity({ value: -273.15, unit: 'degC' }, 'K').value, 0);
  assert.equal(convertQuantity({ value: 1, unit: 'delta_degC' }, 'delta_K').value, 1);
});
