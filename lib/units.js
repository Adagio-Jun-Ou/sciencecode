export const UNIT_ENGINE_NAME = 'sciencecode-bounded-units';
export const UNIT_ENGINE_VERSION = 1;
// Versions this build can still verify; see SUPPORTED_STATISTICS_ENGINE_VERSIONS.
export const SUPPORTED_UNIT_ENGINE_VERSIONS = Object.freeze([UNIT_ENGINE_VERSION]);
export const MAX_UNIT_EXPRESSION_LENGTH = 64;
export const MAX_UNIT_FACTORS = 12;
export const MAX_UNIT_ABS_EXPONENT = 12;

const DIMENSION_ORDER = [
  ['mass', 'kg'],
  ['length', 'm'],
  ['time', 's'],
  ['amount', 'mol'],
  ['temperature', 'delta_K'],
  ['count', 'count'],
  ['arbitrary', 'AU']
];

const ATOMS = new Map();

function atom(symbol, scale, dimensions = {}, options = {}) {
  ATOMS.set(symbol, Object.freeze({
    symbol,
    scale,
    dimensions: Object.freeze({ ...dimensions }),
    offset: options.offset ?? 0,
    affine_space: options.affineSpace ?? null,
    description: options.description ?? null
  }));
}

atom('1', 1, {}, { description: 'dimensionless ratio' });
atom('%', 1e-2, {}, { description: 'percent' });
atom('ppm', 1e-6, {}, { description: 'parts per million' });
atom('ppb', 1e-9, {}, { description: 'parts per billion' });
atom('count', 1, { count: 1 }, { description: 'discrete count' });
atom('AU', 1, { arbitrary: 1 }, { description: 'arbitrary unit' });

atom('kg', 1, { mass: 1 }, { description: 'kilogram' });
atom('g', 1e-3, { mass: 1 }, { description: 'gram' });
atom('mg', 1e-6, { mass: 1 }, { description: 'milligram' });
atom('ug', 1e-9, { mass: 1 }, { description: 'microgram' });
atom('ng', 1e-12, { mass: 1 }, { description: 'nanogram' });
atom('pg', 1e-15, { mass: 1 }, { description: 'picogram' });

atom('km', 1e3, { length: 1 }, { description: 'kilometre' });
atom('m', 1, { length: 1 }, { description: 'metre' });
atom('cm', 1e-2, { length: 1 }, { description: 'centimetre' });
atom('mm', 1e-3, { length: 1 }, { description: 'millimetre' });
atom('um', 1e-6, { length: 1 }, { description: 'micrometre' });
atom('nm', 1e-9, { length: 1 }, { description: 'nanometre' });

atom('d', 86_400, { time: 1 }, { description: 'day of exactly 86400 seconds' });
atom('h', 3_600, { time: 1 }, { description: 'hour' });
atom('min', 60, { time: 1 }, { description: 'minute' });
atom('s', 1, { time: 1 }, { description: 'second' });
atom('ms', 1e-3, { time: 1 }, { description: 'millisecond' });
atom('us', 1e-6, { time: 1 }, { description: 'microsecond' });
atom('ns', 1e-9, { time: 1 }, { description: 'nanosecond' });

atom('mol', 1, { amount: 1 }, { description: 'mole' });
atom('mmol', 1e-3, { amount: 1 }, { description: 'millimole' });
atom('umol', 1e-6, { amount: 1 }, { description: 'micromole' });
atom('nmol', 1e-9, { amount: 1 }, { description: 'nanomole' });
atom('pmol', 1e-12, { amount: 1 }, { description: 'picomole' });

atom('L', 1e-3, { length: 3 }, { description: 'litre' });
atom('mL', 1e-6, { length: 3 }, { description: 'millilitre' });
atom('uL', 1e-9, { length: 3 }, { description: 'microlitre' });
atom('nL', 1e-12, { length: 3 }, { description: 'nanolitre' });

atom('K', 1, { temperature: 1 }, {
  affineSpace: 'absolute_temperature',
  description: 'absolute kelvin temperature'
});
atom('degC', 1, { temperature: 1 }, {
  offset: 273.15,
  affineSpace: 'absolute_temperature',
  description: 'absolute degrees Celsius temperature'
});
atom('delta_K', 1, { temperature: 1 }, { description: 'kelvin temperature difference' });
atom('delta_degC', 1, { temperature: 1 }, {
  description: 'degrees Celsius temperature difference'
});

atom('Hz', 1, { time: -1 }, { description: 'hertz' });
atom('kHz', 1e3, { time: -1 }, { description: 'kilohertz' });
atom('MHz', 1e6, { time: -1 }, { description: 'megahertz' });
atom('GHz', 1e9, { time: -1 }, { description: 'gigahertz' });
atom('Pa', 1, { mass: 1, length: -1, time: -2 }, { description: 'pascal' });
atom('kPa', 1e3, { mass: 1, length: -1, time: -2 }, { description: 'kilopascal' });
atom('MPa', 1e6, { mass: 1, length: -1, time: -2 }, { description: 'megapascal' });
atom('bar', 1e5, { mass: 1, length: -1, time: -2 }, { description: 'bar' });
atom('J', 1, { mass: 1, length: 2, time: -2 }, { description: 'joule' });
atom('mJ', 1e-3, { mass: 1, length: 2, time: -2 }, { description: 'millijoule' });
atom('kJ', 1e3, { mass: 1, length: 2, time: -2 }, { description: 'kilojoule' });
atom('W', 1, { mass: 1, length: 2, time: -3 }, { description: 'watt' });
atom('mW', 1e-3, { mass: 1, length: 2, time: -3 }, { description: 'milliwatt' });
atom('kW', 1e3, { mass: 1, length: 2, time: -3 }, { description: 'kilowatt' });
atom('N', 1, { mass: 1, length: 1, time: -2 }, { description: 'newton' });
atom('mN', 1e-3, { mass: 1, length: 1, time: -2 }, { description: 'millinewton' });

atom('M', 1e3, { amount: 1, length: -3 }, { description: 'molar' });
atom('mM', 1, { amount: 1, length: -3 }, { description: 'millimolar' });
atom('uM', 1e-3, { amount: 1, length: -3 }, { description: 'micromolar' });
atom('nM', 1e-6, { amount: 1, length: -3 }, { description: 'nanomolar' });
atom('pM', 1e-9, { amount: 1, length: -3 }, { description: 'picomolar' });

const ALIASES = new Map([
  ['dimensionless', '1'],
  ['unitless', '1'],
  ['ratio', '1'],
  ['percent', '%'],
  ['counts', 'count'],
  ['arbitrary_unit', 'AU'],
  ['sec', 's'],
  ['second', 's'],
  ['seconds', 's'],
  ['millisecond', 'ms'],
  ['milliseconds', 'ms'],
  ['microsecond', 'us'],
  ['microseconds', 'us'],
  ['nanosecond', 'ns'],
  ['nanoseconds', 'ns'],
  ['minute', 'min'],
  ['minutes', 'min'],
  ['hour', 'h'],
  ['hours', 'h'],
  ['day', 'd'],
  ['days', 'd'],
  ['meter', 'm'],
  ['meters', 'm'],
  ['metre', 'm'],
  ['metres', 'm'],
  ['liter', 'L'],
  ['liters', 'L'],
  ['litre', 'L'],
  ['litres', 'L'],
  ['milliliter', 'mL'],
  ['milliliters', 'mL'],
  ['millilitre', 'mL'],
  ['millilitres', 'mL'],
  ['microliter', 'uL'],
  ['microliters', 'uL'],
  ['microlitre', 'uL'],
  ['microlitres', 'uL'],
  ['gram', 'g'],
  ['grams', 'g'],
  ['kilogram', 'kg'],
  ['kilograms', 'kg'],
  ['kelvin', 'K'],
  ['celsius', 'degC'],
  ['degree_celsius', 'degC'],
  ['degrees_celsius', 'degC'],
  ['°C', 'degC']
]);

const DIMENSION_NAMES = new Map([
  ['', 'dimensionless'],
  ['mass:1', 'mass'],
  ['length:1', 'length'],
  ['length:2', 'area'],
  ['length:3', 'volume'],
  ['time:1', 'time'],
  ['time:-1', 'frequency'],
  ['amount:1', 'amount'],
  ['count:1', 'count'],
  ['arbitrary:1', 'arbitrary'],
  ['length:1,time:-1', 'speed'],
  ['length:1,time:-2', 'acceleration'],
  ['mass:1,length:1,time:-2', 'force'],
  ['mass:1,length:-1,time:-2', 'pressure'],
  ['mass:1,length:2,time:-2', 'energy'],
  ['mass:1,length:2,time:-3', 'power'],
  ['amount:1,length:-3', 'amount_concentration'],
  ['mass:1,length:-3', 'mass_concentration']
]);

const CANONICAL_UNITS = new Map([
  ['', '1'],
  ['mass:1', 'kg'],
  ['length:1', 'm'],
  ['length:2', 'm^2'],
  ['length:3', 'm^3'],
  ['time:1', 's'],
  ['time:-1', 'Hz'],
  ['amount:1', 'mol'],
  ['count:1', 'count'],
  ['arbitrary:1', 'AU'],
  ['length:1,time:-1', 'm/s'],
  ['length:1,time:-2', 'm/s^2'],
  ['mass:1,length:1,time:-2', 'N'],
  ['mass:1,length:-1,time:-2', 'Pa'],
  ['mass:1,length:2,time:-2', 'J'],
  ['mass:1,length:2,time:-3', 'W'],
  ['amount:1,length:-3', 'mol/m^3'],
  ['mass:1,length:-3', 'kg/m^3']
]);

function unitError(message, code = 'INVALID_UNIT') {
  return Object.assign(new Error(message), { code });
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype);
}

function normalizeExpression(value) {
  if (typeof value !== 'string') throw unitError('Unit must be a string.');
  let text = value.trim();
  if (!text) throw unitError('Unit is required.');
  if (text.length > MAX_UNIT_EXPRESSION_LENGTH) {
    throw unitError('Unit must be ' + MAX_UNIT_EXPRESSION_LENGTH + ' characters or fewer.');
  }
  text = text.replace(/[µμ]/g, 'u').replace(/[⋅·]/g, '*').replace(/−/g, '-');
  text = ALIASES.get(text) ?? text;
  text = text.replace(/\s*([*/^])\s*/g, '$1');
  if (/\s/.test(text)) {
    throw unitError('Unit expressions cannot contain implicit multiplication or spaces.');
  }
  return text;
}

function dimensionKey(dimensions) {
  return DIMENSION_ORDER
    .filter(([name]) => dimensions[name])
    .map(([name]) => name + ':' + dimensions[name])
    .join(',');
}

function canonicalExpression(dimensions) {
  const key = dimensionKey(dimensions);
  if (CANONICAL_UNITS.has(key)) return CANONICAL_UNITS.get(key);
  const factors = [];
  for (const [name, symbol] of DIMENSION_ORDER) {
    const exponent = dimensions[name] ?? 0;
    if (!exponent) continue;
    factors.push(symbol + (exponent === 1 ? '' : '^' + exponent));
  }
  return factors.join('*') || '1';
}

function parseFactors(expression) {
  const factors = [];
  let start = 0;
  let operation = '*';
  for (let index = 0; index <= expression.length; index += 1) {
    const character = expression[index];
    if (index !== expression.length && character !== '*' && character !== '/') continue;
    const token = expression.slice(start, index);
    if (!token) throw unitError('Unit expression has an empty factor.');
    const match = /^([A-Za-z%][A-Za-z0-9_]*|1)(?:\^(-?\d+))?$/.exec(token);
    if (!match) throw unitError('Invalid unit factor: ' + token);
    const exponent = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isInteger(exponent) || exponent === 0 ||
        Math.abs(exponent) > MAX_UNIT_ABS_EXPONENT) {
      throw unitError('Unit exponents must be nonzero integers from -' +
        MAX_UNIT_ABS_EXPONENT + ' through ' + MAX_UNIT_ABS_EXPONENT + '.');
    }
    const definition = ATOMS.get(match[1]);
    if (!definition) throw unitError('Unsupported unit symbol: ' + match[1]);
    factors.push({
      definition,
      exponent: operation === '/' ? -exponent : exponent,
      display_exponent: exponent,
      operation
    });
    if (factors.length > MAX_UNIT_FACTORS) {
      throw unitError('Unit expression exceeds the ' + MAX_UNIT_FACTORS + '-factor limit.');
    }
    operation = character;
    start = index + 1;
  }
  return factors;
}

// A unit scale is a decimal quantity, but binary64 cannot hold most of them
// exactly, so a ratio of two independently rounded scales (1e-6 / 1e-9) misses
// the exact answer by an ULP. Every scale here is `significand * 10 ** decades`
// with an integer significand, so keeping those parts lets convertQuantity form
// the ratio exactly for metric prefixes and simple factors alike.
const MAX_EXACT_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_EXACT_DECADES = 22;

function decimalParts(value) {
  const [mantissa, exponent] = value.toExponential().split('e');
  const digits = mantissa.replace('.', '');
  return {
    significand: Number(digits),
    decades: Number(exponent) - (digits.replace('-', '').length - 1)
  };
}

function exactRatio(source, target) {
  const numerator = source.numerator * target.denominator;
  const denominator = source.denominator * target.numerator;
  const decades = source.decades - target.decades;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
      denominator === 0 || Math.abs(decades) > MAX_EXACT_DECADES) {
    return null;
  }
  const quotient = numerator / denominator;
  if (!Number.isFinite(quotient)) return null;
  return quotient * (10 ** decades);
}

export function parseUnit(value) {
  const expression = normalizeExpression(value);
  const factors = parseFactors(expression);
  const affine = factors.filter((factor) => factor.definition.affine_space);
  if (affine.length && (factors.length !== 1 || factors[0].exponent !== 1)) {
    throw unitError(
      'Absolute temperature units may only appear alone; use delta_K or delta_degC in compound units.'
    );
  }
  const dimensions = {};
  let scale = 1;
  let numerator = 1;
  let denominator = 1;
  let decades = 0;
  for (const factor of factors) {
    scale *= factor.definition.scale ** factor.exponent;
    if (!Number.isFinite(scale) || scale <= 0) {
      throw unitError('Unit scale overflows the supported numeric range.');
    }
    const parts = decimalParts(factor.definition.scale);
    if (factor.exponent >= 0) {
      numerator *= parts.significand ** factor.exponent;
    } else {
      denominator *= parts.significand ** -factor.exponent;
    }
    decades += parts.decades * factor.exponent;
    for (const [name, exponent] of Object.entries(factor.definition.dimensions)) {
      const next = (dimensions[name] ?? 0) + (exponent * factor.exponent);
      if (Math.abs(next) > MAX_UNIT_ABS_EXPONENT * MAX_UNIT_FACTORS) {
        throw unitError('Unit dimension exponent exceeds the safety limit.');
      }
      if (next) dimensions[name] = next;
      else delete dimensions[name];
    }
  }
  const key = dimensionKey(dimensions);
  const affineSpace = affine[0]?.definition.affine_space ?? null;
  const normalized = factors.map((factor, index) => {
    const prefix = index === 0 ? '' : factor.operation;
    const exponent = factor.display_exponent === 1 ? '' : '^' + factor.display_exponent;
    return prefix + factor.definition.symbol + exponent;
  }).join('');
  const dimension = affineSpace === 'absolute_temperature'
    ? 'temperature'
    : key === 'temperature:1'
      ? 'temperature_difference'
      : DIMENSION_NAMES.get(key) ?? 'compound';
  return {
    symbol: normalized,
    dimension,
    canonical_unit: affineSpace === 'absolute_temperature'
      ? 'K'
      : canonicalExpression(dimensions),
    scale_to_canonical: scale,
    scale_parts: Object.freeze({ numerator, denominator, decades }),
    offset_to_canonical: affine[0]?.definition.offset ?? 0,
    affine: Boolean(affineSpace),
    compatibility_key: (affineSpace ?? 'linear') + '|' + key
  };
}

export function describeUnit(value) {
  const parsed = parseUnit(value);
  return {
    engine: { name: UNIT_ENGINE_NAME, version: UNIT_ENGINE_VERSION },
    symbol: parsed.symbol,
    dimension: parsed.dimension,
    canonical_unit: parsed.canonical_unit,
    scale_to_canonical: parsed.scale_to_canonical,
    offset_to_canonical: parsed.offset_to_canonical,
    affine: parsed.affine
  };
}

export function normalizeUnitDeclaration(value, label = 'Unit declaration') {
  if (!plainObject(value)) throw unitError(label + ' must be an object with a symbol field.');
  for (const key of Object.keys(value)) {
    if (key !== 'symbol') throw unitError('Unknown ' + label + ' field: ' + key);
  }
  const parsed = parseUnit(value.symbol);
  return {
    symbol: parsed.symbol,
    dimension: parsed.dimension,
    canonical_unit: parsed.canonical_unit
  };
}

export function normalizeQuantity(value, label = 'Quantity') {
  if (!plainObject(value)) {
    throw unitError(label + ' must be an object with exactly value and unit fields.',
      'INVALID_QUANTITY');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'value' && key !== 'unit') {
      throw unitError('Unknown ' + label + ' field: ' + key, 'INVALID_QUANTITY');
    }
  }
  if (!Object.hasOwn(value, 'value') || typeof value.value !== 'number' ||
      !Number.isFinite(value.value)) {
    throw unitError(label + ' value must be a finite JSON number.', 'INVALID_QUANTITY');
  }
  const parsed = parseUnit(value.unit);
  return {
    value: Object.is(value.value, -0) ? 0 : value.value,
    unit: parsed.symbol
  };
}

export function unitsCompatible(left, right) {
  return parseUnit(left).compatibility_key === parseUnit(right).compatibility_key;
}

export function convertQuantity(value, targetUnit, label = 'Quantity') {
  const source = normalizeQuantity(value, label);
  const sourceUnit = parseUnit(source.unit);
  let target;
  if (plainObject(targetUnit)) {
    for (const key of Object.keys(targetUnit)) {
      if (!['symbol', 'dimension', 'canonical_unit'].includes(key)) {
        throw unitError('Unknown target unit descriptor field: ' + key);
      }
    }
    target = parseUnit(targetUnit.symbol);
    if ((targetUnit.dimension !== undefined && targetUnit.dimension !== target.dimension) ||
        (targetUnit.canonical_unit !== undefined &&
         targetUnit.canonical_unit !== target.canonical_unit)) {
      throw unitError('Target unit descriptor does not match its registered symbol.');
    }
  } else {
    target = parseUnit(targetUnit);
  }
  if (sourceUnit.compatibility_key !== target.compatibility_key) {
    throw unitError(
      label + ' unit ' + sourceUnit.symbol + ' (' + sourceUnit.dimension +
      ') is incompatible with ' + target.symbol + ' (' + target.dimension + ').',
      'UNIT_DIMENSION_MISMATCH'
    );
  }
  const canonical = (source.value * sourceUnit.scale_to_canonical) +
    sourceUnit.offset_to_canonical;
  const ratio = sourceUnit.affine || target.affine
    ? null
    : exactRatio(sourceUnit.scale_parts, target.scale_parts);
  const convertedValue = sourceUnit.affine || target.affine
    ? (canonical - target.offset_to_canonical) / target.scale_to_canonical
    : source.value * (ratio ?? (sourceUnit.scale_to_canonical / target.scale_to_canonical));
  if (!Number.isFinite(canonical) || !Number.isFinite(convertedValue)) {
    throw unitError(label + ' conversion overflows the supported numeric range.',
      'INVALID_QUANTITY');
  }
  return {
    value: Object.is(convertedValue, -0) ? 0 : convertedValue,
    unit: target.symbol,
    source,
    dimension: target.dimension,
    converted: source.unit !== target.symbol
  };
}

export function listSupportedUnits() {
  return [...ATOMS.values()]
    .map((definition) => {
      const parsed = parseUnit(definition.symbol);
      return {
        symbol: definition.symbol,
        dimension: parsed.dimension,
        canonical_unit: parsed.canonical_unit,
        scale_to_canonical: parsed.scale_to_canonical,
        offset_to_canonical: parsed.offset_to_canonical,
        affine: parsed.affine,
        description: definition.description
      };
    })
    .sort((left, right) =>
      left.dimension.localeCompare(right.dimension) || left.symbol.localeCompare(right.symbol));
}

export function differenceUnitFor(value) {
  const parsed = parseUnit(value);
  if (parsed.compatibility_key !== 'absolute_temperature|temperature:1') return parsed.symbol;
  return parsed.symbol === 'degC' ? 'delta_degC' : 'delta_K';
}
