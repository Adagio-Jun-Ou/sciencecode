import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import { sha256Buffer, sha256File, sha256Json } from './hash.js';
import { decodePng, MAX_PNG_BYTES } from './png.js';
import {
  resolveArtifactRevision,
  resolveRevisionSourceArtifact
} from './revisions.js';
import { scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  resolveInsideRoot,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';
import {
  convertQuantity,
  normalizeUnitDeclaration,
  unitsCompatible,
  UNIT_ENGINE_NAME,
  UNIT_ENGINE_VERSION,
  SUPPORTED_UNIT_ENGINE_VERSIONS
} from './units.js';

export const FIGURE_REGISTRATION_SCHEMA_VERSION = 1;
export const FIGURE_SEMANTIC_REPORT_SCHEMA_VERSION = 1;
export const FIGURE_SEMANTIC_SIDECAR_SCHEMA_VERSION = 1;
export const FIGURE_SEMANTIC_ENGINE_VERSION = 1;
export const FIGURE_SEMANTIC_ENGINE = 'sciencecode-tabular-figure-replay';
export const MAX_FIGURE_REGISTRATIONS = 10_000;
export const MAX_FIGURE_SEMANTIC_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_FIGURE_SEMANTIC_SIDECAR_BYTES = 1024 * 1024;
export const MAX_FIGURE_SEMANTIC_REPORT_BYTES = 4 * 1024 * 1024;
export const MAX_FIGURE_REGISTRATION_MANIFEST_BYTES = 1024 * 1024;
export const MAX_FIGURE_TABLE_ROWS = 100_000;
export const MAX_FIGURE_TABLE_COLUMNS = 128;
export const MAX_FIGURE_SERIES = 16;

export const FIGURE_SEMANTIC_LIMITATION =
  'This record verifies an immutable producer sidecar against an exact PNG, ' +
  'tabular source, declared encodings, unit conversions, and deterministic ' +
  'data replay. It does not infer chart semantics from pixels or prove that ' +
  'the renderer drew the declared values correctly.';

const REGISTRATION_ID_PATTERN =
  /^figure-registration-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const CHART_TYPES = new Set(['line', 'scatter', 'line_scatter']);
const SCALES = new Set(['linear', 'log10']);
const MISSING_POLICIES = new Set(['error', 'drop_row']);
const ROW_ORDERS = new Set(['source', 'x_ascending']);
const DUPLICATE_X_POLICIES = new Set(['allow', 'error']);
const SOURCE_EXTENSIONS = new Set(['.csv', '.tsv']);
const FIXED_ARTIFACT_FILES = new Set([
  'figure.png',
  'source.csv',
  'source.tsv',
  'sidecar.json',
  'report.json'
]);
const FILE_LIMITS = new Map([
  ['manifest.json', MAX_FIGURE_REGISTRATION_MANIFEST_BYTES],
  ['manifest.sha256', 256],
  ['figure.png', MAX_PNG_BYTES],
  ['source.csv', MAX_FIGURE_SEMANTIC_SOURCE_BYTES],
  ['source.tsv', MAX_FIGURE_SEMANTIC_SOURCE_BYTES],
  ['sidecar.json', MAX_FIGURE_SEMANTIC_SIDECAR_BYTES],
  ['report.json', MAX_FIGURE_SEMANTIC_REPORT_BYTES]
]);
const NUMERIC_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const CONTRACT_KEYS = new Set([
  'chart_type',
  'title',
  'x_axis',
  'y_axis',
  'series',
  'missing_value_policy',
  'row_order',
  'duplicate_x_policy',
  'sampling',
  'aggregation'
]);
const X_AXIS_KEYS = new Set([
  'column', 'label', 'source_unit', 'display_unit', 'scale'
]);
const Y_AXIS_KEYS = new Set(['label', 'display_unit', 'scale']);
const SERIES_KEYS = new Set(['id', 'column', 'label', 'source_unit']);
const SAMPLING_KEYS = new Set(['method', 'maximum_points']);
const UNIT_KEYS = new Set(['symbol', 'dimension', 'canonical_unit']);
const SIDECAR_KEYS = new Set([
  'schema_version',
  'engine',
  'engine_version',
  'unit_engine',
  'figure',
  'source',
  'contract',
  'contract_sha256',
  'replay',
  'replay_sha256',
  'limitations'
]);
const SIDECAR_FIGURE_KEYS = new Set([
  'sha256', 'bytes', 'media_type', 'width', 'height'
]);
const SIDECAR_SOURCE_KEYS = new Set([
  'sha256', 'bytes', 'media_type', 'format'
]);
const REGISTRATION_SPEC_KEYS = new Set([
  'schema_version', 'name', 'note', 'figure', 'source', 'sidecar', 'contract'
]);
const SELECTOR_KEYS = new Set(['url', 'kind', 'record_id', 'name', 'sha256']);

function registrationError(message, code = 'INVALID_FIGURE_REGISTRATION') {
  return Object.assign(new Error(message), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertPlainObject(value, label, code = 'INVALID_FIGURE_REGISTRATION') {
  if (!plainObject(value)) throw registrationError(label + ' must be an object.', code);
}

function rejectUnknownKeys(value, allowed, label, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw registrationError('Unknown ' + label + ' field: ' + key, code);
    }
  }
}

function boundedText(value, label, maximum, { optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw registrationError(label + ' is required.', 'INVALID_FIGURE_SEMANTIC_CONTRACT');
  }
  const text = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (text.length > maximum) {
    throw registrationError(
      label + ' must be ' + maximum + ' characters or fewer.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  const findings = scanSecrets(text);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in ' + label + '; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return text;
}

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function makeFigureRegistrationId(now = new Date()) {
  return 'figure-registration-' + stamp(now) + '-' +
    crypto.randomBytes(4).toString('hex');
}

function normalizeRegistrationId(value) {
  const id = String(value ?? '');
  if (!REGISTRATION_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw registrationError(
      'Invalid figure registration ID: ' + id,
      'INVALID_FIGURE_REGISTRATION_ID'
    );
  }
  return id;
}

function validateOptionalChat(cwd, value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const chatId = String(value);
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw Object.assign(new Error('Invalid chat ID: ' + chatId), {
      code: 'INVALID_CHAT_ID'
    });
  }
  try {
    getChatManifest(cwd, chatId);
  } catch (error) {
    throw Object.assign(new Error('Chat not found: ' + chatId), {
      code: error.code === 'INVALID_CHAT_ID' ? error.code : 'CHAT_NOT_FOUND'
    });
  }
  return chatId;
}

function normalizeColumn(value, label) {
  const column = boundedText(value, label, 128);
  if (/\p{C}/u.test(column) || /[\r\n\t]/.test(column)) {
    throw registrationError(
      label + ' contains unsupported control characters.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  return column;
}

function normalizeContractUnit(value, label) {
  assertPlainObject(value, label, 'INVALID_FIGURE_SEMANTIC_CONTRACT');
  rejectUnknownKeys(
    value,
    UNIT_KEYS,
    label,
    'INVALID_FIGURE_SEMANTIC_CONTRACT'
  );
  let normalized;
  try {
    normalized = normalizeUnitDeclaration({ symbol: value.symbol }, label);
  } catch (error) {
    if (['INVALID_UNIT', 'INVALID_QUANTITY', 'UNIT_DIMENSION_MISMATCH']
      .includes(error.code)) {
      throw registrationError(error.message, 'INVALID_FIGURE_SEMANTIC_CONTRACT');
    }
    throw error;
  }
  if ((value.dimension !== undefined && value.dimension !== normalized.dimension) ||
      (value.canonical_unit !== undefined &&
       value.canonical_unit !== normalized.canonical_unit)) {
    throw registrationError(
      label + ' metadata does not match its registered symbol.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  return normalized;
}

function normalizeScale(value, label) {
  const scale = String(value ?? 'linear');
  if (!SCALES.has(scale)) {
    throw registrationError(
      label + ' must be linear or log10.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  return scale;
}

function normalizeSampling(value) {
  if (value === undefined || value === null) return { method: 'all' };
  assertPlainObject(value, 'Figure sampling', 'INVALID_FIGURE_SEMANTIC_CONTRACT');
  rejectUnknownKeys(
    value,
    SAMPLING_KEYS,
    'figure sampling',
    'INVALID_FIGURE_SEMANTIC_CONTRACT'
  );
  const method = String(value.method ?? '');
  if (method === 'all') {
    if (value.maximum_points !== undefined) {
      throw registrationError(
        'all sampling must not declare maximum_points.',
        'INVALID_FIGURE_SEMANTIC_CONTRACT'
      );
    }
    return { method };
  }
  if (method !== 'evenly_spaced') {
    throw registrationError(
      'Figure sampling method must be all or evenly_spaced.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  const maximum = Number(value.maximum_points);
  if (!Number.isSafeInteger(maximum) || maximum < 2 ||
      maximum > MAX_FIGURE_TABLE_ROWS) {
    throw registrationError(
      'evenly_spaced maximum_points must be an integer from 2 through ' +
        MAX_FIGURE_TABLE_ROWS + '.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  return { method, maximum_points: maximum };
}

export function normalizeFigureSemanticContract(value) {
  assertPlainObject(
    value,
    'Figure semantic contract',
    'INVALID_FIGURE_SEMANTIC_CONTRACT'
  );
  rejectUnknownKeys(
    value,
    CONTRACT_KEYS,
    'figure semantic contract',
    'INVALID_FIGURE_SEMANTIC_CONTRACT'
  );
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 64 * 1024) {
    throw registrationError(
      'Figure semantic contract exceeds the 65536-byte limit.',
      'FIGURE_SEMANTIC_CONTRACT_TOO_LARGE'
    );
  }
  const findings = scanSecrets(encoded);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in figure semantic contract; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  const chartType = String(value.chart_type ?? '');
  if (!CHART_TYPES.has(chartType)) {
    throw registrationError(
      'chart_type must be line, scatter, or line_scatter.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  assertPlainObject(value.x_axis, 'x_axis', 'INVALID_FIGURE_SEMANTIC_CONTRACT');
  rejectUnknownKeys(
    value.x_axis,
    X_AXIS_KEYS,
    'x_axis',
    'INVALID_FIGURE_SEMANTIC_CONTRACT'
  );
  const xSourceUnit = normalizeContractUnit(
    value.x_axis.source_unit,
    'x_axis source_unit'
  );
  const xDisplayUnit = normalizeContractUnit(
    value.x_axis.display_unit,
    'x_axis display_unit'
  );
  if (!unitsCompatible(xSourceUnit.symbol, xDisplayUnit.symbol)) {
    throw registrationError(
      'x_axis source_unit is incompatible with display_unit.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  assertPlainObject(value.y_axis, 'y_axis', 'INVALID_FIGURE_SEMANTIC_CONTRACT');
  rejectUnknownKeys(
    value.y_axis,
    Y_AXIS_KEYS,
    'y_axis',
    'INVALID_FIGURE_SEMANTIC_CONTRACT'
  );
  const yDisplayUnit = normalizeContractUnit(
    value.y_axis.display_unit,
    'y_axis display_unit'
  );
  if (!Array.isArray(value.series) || value.series.length < 1 ||
      value.series.length > MAX_FIGURE_SERIES) {
    throw registrationError(
      'series must contain 1 through ' + MAX_FIGURE_SERIES + ' entries.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  const series = value.series.map((item, index) => {
    assertPlainObject(
      item,
      'series ' + (index + 1),
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
    rejectUnknownKeys(
      item,
      SERIES_KEYS,
      'series ' + (index + 1),
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
    const id = String(item.id ?? '');
    if (!ID_PATTERN.test(id)) {
      throw registrationError(
        'Series ' + (index + 1) + ' requires an ID beginning with a letter.',
        'INVALID_FIGURE_SEMANTIC_CONTRACT'
      );
    }
    const sourceUnit = normalizeContractUnit(
      item.source_unit,
      'series ' + id + ' source_unit'
    );
    if (!unitsCompatible(sourceUnit.symbol, yDisplayUnit.symbol)) {
      throw registrationError(
        'Series ' + id + ' source_unit is incompatible with y_axis display_unit.',
        'INVALID_FIGURE_SEMANTIC_CONTRACT'
      );
    }
    return {
      id,
      column: normalizeColumn(item.column, 'Series ' + id + ' column'),
      label: boundedText(item.label, 'Series ' + id + ' label', 160),
      source_unit: sourceUnit
    };
  });
  if (new Set(series.map((item) => item.id)).size !== series.length) {
    throw registrationError(
      'Series IDs must be unique.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  if (new Set(series.map((item) => item.column)).size !== series.length) {
    throw registrationError(
      'Each series must bind a distinct source column.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  const missingPolicy = String(value.missing_value_policy ?? '');
  if (!MISSING_POLICIES.has(missingPolicy)) {
    throw registrationError(
      'missing_value_policy must be error or drop_row.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  const rowOrder = String(value.row_order ?? '');
  if (!ROW_ORDERS.has(rowOrder)) {
    throw registrationError(
      'row_order must be source or x_ascending.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  const duplicatePolicy = String(value.duplicate_x_policy ?? '');
  if (!DUPLICATE_X_POLICIES.has(duplicatePolicy)) {
    throw registrationError(
      'duplicate_x_policy must be allow or error.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  if (value.aggregation !== 'none') {
    throw registrationError(
      'Figure semantic schema 1 requires aggregation to be none.',
      'INVALID_FIGURE_SEMANTIC_CONTRACT'
    );
  }
  return {
    chart_type: chartType,
    title: boundedText(value.title, 'Figure title', 300, { optional: true }),
    x_axis: {
      column: normalizeColumn(value.x_axis.column, 'x_axis column'),
      label: boundedText(value.x_axis.label, 'x_axis label', 160),
      source_unit: xSourceUnit,
      display_unit: xDisplayUnit,
      scale: normalizeScale(value.x_axis.scale, 'x_axis scale')
    },
    y_axis: {
      label: boundedText(value.y_axis.label, 'y_axis label', 160),
      display_unit: yDisplayUnit,
      scale: normalizeScale(value.y_axis.scale, 'y_axis scale')
    },
    series,
    missing_value_policy: missingPolicy,
    row_order: rowOrder,
    duplicate_x_policy: duplicatePolicy,
    sampling: normalizeSampling(value.sampling),
    aggregation: 'none'
  };
}

export function normalizeFigureRegistrationSpec(value) {
  assertPlainObject(value, 'Figure registration spec');
  rejectUnknownKeys(
    value,
    REGISTRATION_SPEC_KEYS,
    'figure registration spec',
    'INVALID_FIGURE_REGISTRATION'
  );
  if (value.schema_version !== FIGURE_REGISTRATION_SCHEMA_VERSION) {
    throw registrationError(
      'Figure registration spec schema_version must be ' +
        FIGURE_REGISTRATION_SCHEMA_VERSION + '.',
      'UNSUPPORTED_FIGURE_SEMANTIC_VERSION'
    );
  }
  if (!plainObject(value.figure) || !plainObject(value.source) ||
      !plainObject(value.sidecar)) {
    throw registrationError(
      'Figure registration spec requires figure, source, and sidecar selectors.'
    );
  }
  return {
    schema_version: FIGURE_REGISTRATION_SCHEMA_VERSION,
    name: boundedText(
      value.name,
      'Figure registration name',
      240,
      { optional: true }
    ),
    note: boundedText(
      value.note,
      'Figure registration note',
      2_000,
      { optional: true }
    ),
    figure: normalizeRegistrationSelector(value.figure, 'figure'),
    source: normalizeRegistrationSelector(value.source, 'source'),
    sidecar: normalizeRegistrationSelector(value.sidecar, 'sidecar'),
    contract: normalizeFigureSemanticContract(value.contract)
  };
}

function normalizeRegistrationSelector(value, label) {
  assertPlainObject(value, 'Figure ' + label + ' selector');
  if (Object.hasOwn(value, 'revision_id')) {
    if (Object.keys(value).length !== 1 ||
        !String(value.revision_id ?? '').trim()) {
      throw registrationError(
        'Figure ' + label + ' revision selector must contain only revision_id.'
      );
    }
    return { revision_id: String(value.revision_id) };
  }
  if (Object.hasOwn(value, 'source')) {
    if (Object.keys(value).length !== 1) {
      throw registrationError(
        'Figure ' + label + ' wrapped selector must contain only source.'
      );
    }
    return {
      source: normalizeRegistrationSelector(value.source, label + ' source')
    };
  }
  rejectUnknownKeys(
    value,
    SELECTOR_KEYS,
    'figure ' + label + ' selector',
    'INVALID_FIGURE_REGISTRATION'
  );
  if (typeof value.url !== 'string' || !value.url.startsWith('/')) {
    throw registrationError(
      'Figure ' + label + ' selector requires a local artifact URL.'
    );
  }
  return Object.fromEntries(
    [...SELECTOR_KEYS]
      .filter((key) => value[key] !== undefined && value[key] !== null)
      .map((key) => [key, String(value[key])])
  );
}

function sourceFormat(name) {
  const extension = path.extname(String(name ?? '')).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) {
    throw registrationError(
      'Figure semantic replay currently requires a CSV or TSV source.',
      'UNSUPPORTED_FIGURE_DATA_FORMAT'
    );
  }
  return {
    extension,
    format: extension === '.csv' ? 'csv' : 'tsv',
    delimiter: extension === '.csv' ? ',' : '\t',
    media_type: extension === '.csv'
      ? 'text/csv; charset=utf-8'
      : 'text/tab-separated-values; charset=utf-8'
  };
}

function decodeUtf8(value, label) {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(value);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.includes('\0')) {
      throw new Error('NUL bytes are not allowed');
    }
    return text;
  } catch (error) {
    throw registrationError(
      label + ' must be valid UTF-8: ' + error.message,
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
}

function parseDelimitedStrict(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let totalCells = 0;
  const pushField = () => {
    if (field.length > MAX_FIGURE_SEMANTIC_SOURCE_BYTES) {
      throw registrationError(
        'Figure source field exceeds the bounded source size.',
        'INVALID_FIGURE_SEMANTIC_DATA'
      );
    }
    row.push(field);
    field = '';
    afterQuote = false;
    totalCells += 1;
    if (row.length > MAX_FIGURE_TABLE_COLUMNS ||
        totalCells > MAX_FIGURE_TABLE_ROWS * MAX_FIGURE_TABLE_COLUMNS) {
      throw registrationError(
        'Figure source exceeds the bounded table shape.',
        'FIGURE_SEMANTIC_SOURCE_TOO_LARGE'
      );
    }
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > MAX_FIGURE_TABLE_ROWS + 1) {
      throw registrationError(
        'Figure source exceeds the ' + MAX_FIGURE_TABLE_ROWS + '-row limit.',
        'FIGURE_SEMANTIC_SOURCE_TOO_LARGE'
      );
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += character;
      }
      continue;
    }
    if (afterQuote) {
      if (character === delimiter) pushField();
      else if (character === '\n') pushRow();
      else if (character === '\r' && text[index + 1] === '\n') {
        pushRow();
        index += 1;
      } else {
        throw registrationError(
          'Unexpected character after a closing quoted field.',
          'INVALID_FIGURE_SEMANTIC_DATA'
        );
      }
      continue;
    }
    if (character === '"') {
      if (field.length) {
        throw registrationError(
          'A quoted field must begin at the start of a field.',
          'INVALID_FIGURE_SEMANTIC_DATA'
        );
      }
      quoted = true;
    } else if (character === delimiter) {
      pushField();
    } else if (character === '\n') {
      pushRow();
    } else if (character === '\r') {
      if (text[index + 1] !== '\n') {
        throw registrationError(
          'Figure source contains a bare carriage return.',
          'INVALID_FIGURE_SEMANTIC_DATA'
        );
      }
      pushRow();
      index += 1;
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw registrationError(
      'Figure source ends inside a quoted field.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  if (afterQuote || field.length || row.length) pushRow();
  return rows;
}

export function parseFigureSemanticTable(value, { name = 'source.csv' } = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!buffer.length) {
    throw registrationError(
      'Figure semantic source is empty.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  if (buffer.length > MAX_FIGURE_SEMANTIC_SOURCE_BYTES) {
    throw registrationError(
      'Figure semantic source exceeds the ' +
        MAX_FIGURE_SEMANTIC_SOURCE_BYTES + '-byte limit.',
      'FIGURE_SEMANTIC_SOURCE_TOO_LARGE'
    );
  }
  const format = sourceFormat(name);
  const rows = parseDelimitedStrict(decodeUtf8(buffer, 'Figure semantic source'),
    format.delimiter);
  if (rows.length < 2) {
    throw registrationError(
      'Figure semantic source requires one header row and at least one data row.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  const rawHeader = rows[0];
  if (rawHeader.length < 2 || rawHeader.length > MAX_FIGURE_TABLE_COLUMNS) {
    throw registrationError(
      'Figure semantic source must contain 2 through ' +
        MAX_FIGURE_TABLE_COLUMNS + ' columns.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  const header = rawHeader.map((value, index) => {
    const normalized = String(value).normalize('NFC');
    if (!normalized || normalized !== normalized.trim() ||
        normalized.length > 128 || /[\r\n\t\0]/.test(normalized)) {
      throw registrationError(
        'Figure source header ' + (index + 1) +
          ' must be non-empty, normalized, trimmed, and at most 128 characters.',
        'INVALID_FIGURE_SEMANTIC_DATA'
      );
    }
    return normalized;
  });
  if (new Set(header).size !== header.length) {
    throw registrationError(
      'Figure source headers must be unique.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  const data = rows.slice(1);
  for (let index = 0; index < data.length; index += 1) {
    if (data[index].length !== header.length) {
      throw registrationError(
        'Figure source row ' + (index + 2) + ' has ' + data[index].length +
          ' columns; expected ' + header.length + '.',
        'INVALID_FIGURE_SEMANTIC_DATA'
      );
    }
  }
  return {
    format: format.format,
    media_type: format.media_type,
    header,
    rows: data
  };
}

function finiteCell(value, row, column) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!NUMERIC_PATTERN.test(text)) {
    throw registrationError(
      'Figure source row ' + row + ', column ' + column +
        ' is not a strict finite decimal number.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  const number = Number(text);
  if (!Number.isFinite(number)) {
    throw registrationError(
      'Figure source row ' + row + ', column ' + column +
        ' overflows the supported numeric range.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  return Object.is(number, -0) ? 0 : number;
}

function convertedValue(value, sourceUnit, displayUnit, label) {
  try {
    return convertQuantity(
      { value, unit: sourceUnit.symbol },
      displayUnit,
      label
    ).value;
  } catch (error) {
    throw registrationError(
      label + ' could not be converted: ' + error.message,
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
}

function canonicalNumber(value) {
  if (!Number.isFinite(value)) {
    throw registrationError(
      'Figure replay encountered a non-finite number.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  if (Object.is(value, -0)) return '0';
  return String(value);
}

function sampledRows(rows, sampling) {
  if (sampling.method === 'all' || rows.length <= sampling.maximum_points) {
    return rows;
  }
  const sampled = [];
  let previous = -1;
  for (let index = 0; index < sampling.maximum_points; index += 1) {
    const sourceIndex = Math.round(
      index * (rows.length - 1) / (sampling.maximum_points - 1)
    );
    if (sourceIndex !== previous) sampled.push(rows[sourceIndex]);
    previous = sourceIndex;
  }
  return sampled;
}

function numericRange(rows, accessor) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const row of rows) {
    const value = accessor(row);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return { minimum, maximum };
}

function streamDigest(rows, select) {
  const hash = crypto.createHash('sha256');
  hash.update(FIGURE_SEMANTIC_ENGINE + ':canonical-decimal-jsonl:v1\n');
  for (const row of rows) hash.update(JSON.stringify(select(row)) + '\n');
  return hash.digest('hex');
}

export function projectFigureSemanticData({ source, sourceName, contract }) {
  const normalized = normalizeFigureSemanticContract(contract);
  const table = parseFigureSemanticTable(source, { name: sourceName });
  const columnIndexes = new Map(table.header.map((name, index) => [name, index]));
  const requiredColumns = [
    normalized.x_axis.column,
    ...normalized.series.map((item) => item.column)
  ];
  for (const column of requiredColumns) {
    if (!columnIndexes.has(column)) {
      throw registrationError(
        'Figure contract column is absent from the source header: ' + column,
        'INVALID_FIGURE_SEMANTIC_DATA'
      );
    }
  }
  const xIndex = columnIndexes.get(normalized.x_axis.column);
  const seriesIndexes = normalized.series.map((item) => columnIndexes.get(item.column));
  const complete = [];
  let droppedRows = 0;
  for (let index = 0; index < table.rows.length; index += 1) {
    const sourceRow = index + 2;
    const selectedCells = [
      table.rows[index][xIndex],
      ...seriesIndexes.map((column) => table.rows[index][column])
    ];
    if (selectedCells.some((cell) => !String(cell ?? '').trim())) {
      if (normalized.missing_value_policy === 'error') {
        throw registrationError(
          'Figure source row ' + sourceRow +
            ' has a missing value in a selected column.',
          'INVALID_FIGURE_SEMANTIC_DATA'
        );
      }
      droppedRows += 1;
      continue;
    }
    const xRaw = finiteCell(
      selectedCells[0],
      sourceRow,
      normalized.x_axis.column
    );
    const x = convertedValue(
      xRaw,
      normalized.x_axis.source_unit,
      normalized.x_axis.display_unit,
      'x value at source row ' + sourceRow
    );
    if (normalized.x_axis.scale === 'log10' && x <= 0) {
      throw registrationError(
        'Figure x_axis log10 scale requires positive converted values; ' +
          'source row ' + sourceRow + ' is ' + canonicalNumber(x) + '.',
        'INVALID_FIGURE_SEMANTIC_DATA'
      );
    }
    const y = normalized.series.map((item, seriesIndex) => {
      const raw = finiteCell(
        selectedCells[seriesIndex + 1],
        sourceRow,
        item.column
      );
      const converted = convertedValue(
        raw,
        item.source_unit,
        normalized.y_axis.display_unit,
        'series ' + item.id + ' value at source row ' + sourceRow
      );
      if (normalized.y_axis.scale === 'log10' && converted <= 0) {
        throw registrationError(
          'Figure y_axis log10 scale requires positive converted values; ' +
            'series ' + item.id + ' at source row ' + sourceRow + ' is ' +
            canonicalNumber(converted) + '.',
          'INVALID_FIGURE_SEMANTIC_DATA'
        );
      }
      return converted;
    });
    complete.push({ source_row: sourceRow, x, y });
  }
  if (!complete.length) {
    throw registrationError(
      'Figure semantic replay has no complete data rows.',
      'INVALID_FIGURE_SEMANTIC_DATA'
    );
  }
  if (normalized.duplicate_x_policy === 'error') {
    const firstRows = new Map();
    for (const row of complete) {
      const key = canonicalNumber(row.x);
      if (firstRows.has(key)) {
        throw registrationError(
          'Figure x values duplicate after unit conversion at source rows ' +
            firstRows.get(key) + ' and ' + row.source_row + '.',
          'INVALID_FIGURE_SEMANTIC_DATA'
        );
      }
      firstRows.set(key, row.source_row);
    }
  }
  if (normalized.row_order === 'x_ascending') {
    complete.sort((left, right) => left.x - right.x ||
      left.source_row - right.source_row);
  }
  const plotted = sampledRows(complete, normalized.sampling);
  return {
    contract: normalized,
    source_format: table.format,
    column_count: table.header.length,
    header_sha256: sha256Json(table.header),
    data_row_count: table.rows.length,
    complete_row_count: complete.length,
    dropped_row_count: droppedRows,
    sampled: plotted.length < complete.length,
    x_column_index: xIndex,
    series_column_indexes: seriesIndexes,
    points: plotted.map((row) => ({
      source_row: row.source_row,
      x: row.x,
      y: [...row.y]
    }))
  };
}

export function replayFigureSemanticData({ source, sourceName, contract }) {
  const projected = projectFigureSemanticData({ source, sourceName, contract });
  const normalized = projected.contract;
  const plotted = projected.points;
  const xRange = numericRange(plotted, (row) => row.x);
  const digestRow = (row) => [
    row.source_row,
    canonicalNumber(row.x),
    ...row.y.map(canonicalNumber)
  ];
  return {
    schema_version: FIGURE_SEMANTIC_REPORT_SCHEMA_VERSION,
    engine: FIGURE_SEMANTIC_ENGINE,
    engine_version: FIGURE_SEMANTIC_ENGINE_VERSION,
    digest_encoding: 'source-row plus converted decimal strings as JSONL',
    source_format: projected.source_format,
    column_count: projected.column_count,
    header_sha256: projected.header_sha256,
    data_row_count: projected.data_row_count,
    complete_row_count: projected.complete_row_count,
    dropped_row_count: projected.dropped_row_count,
    plotted_point_count: plotted.length,
    sampled: projected.sampled,
    plotted_source_rows_sha256: streamDigest(
      plotted,
      (row) => [row.source_row]
    ),
    plotted_data_sha256: streamDigest(plotted, digestRow),
    x_axis: {
      column: normalized.x_axis.column,
      column_index: projected.x_column_index,
      source_unit: normalized.x_axis.source_unit,
      display_unit: normalized.x_axis.display_unit,
      converted: normalized.x_axis.source_unit.symbol !==
        normalized.x_axis.display_unit.symbol,
      scale: normalized.x_axis.scale,
      minimum: xRange.minimum,
      maximum: xRange.maximum
    },
    y_axis: {
      display_unit: normalized.y_axis.display_unit,
      scale: normalized.y_axis.scale
    },
    series: normalized.series.map((item, index) => {
      const range = numericRange(plotted, (row) => row.y[index]);
      return {
        id: item.id,
        column: item.column,
        column_index: projected.series_column_indexes[index],
        source_unit: item.source_unit,
        display_unit: normalized.y_axis.display_unit,
        converted: item.source_unit.symbol !==
          normalized.y_axis.display_unit.symbol,
        point_count: plotted.length,
        minimum: range.minimum,
        maximum: range.maximum,
        data_sha256: streamDigest(plotted, (row) => [
          row.source_row,
          canonicalNumber(row.x),
          canonicalNumber(row.y[index])
        ])
      };
    })
  };
}

function pngDescriptor(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PNG_BYTES) {
    throw registrationError(
      'Semantic figure PNG exceeds the bounded source size.',
      'FIGURE_SEMANTIC_FIGURE_TOO_LARGE'
    );
  }
  let decoded;
  try {
    decoded = decodePng(buffer);
  } catch (error) {
    throw registrationError(
      'Semantic figure must be a supported, valid PNG: ' + error.message,
      error.code ?? 'INVALID_FIGURE_REGISTRATION'
    );
  }
  return {
    sha256: sha256Buffer(buffer),
    bytes: buffer.length,
    media_type: 'image/png',
    width: decoded.width,
    height: decoded.height
  };
}

function sourceDescriptor(buffer, name) {
  const format = sourceFormat(name);
  if (!Buffer.isBuffer(buffer) || !buffer.length ||
      buffer.length > MAX_FIGURE_SEMANTIC_SOURCE_BYTES) {
    throw registrationError(
      'Figure semantic table exceeds the bounded source size.',
      'FIGURE_SEMANTIC_SOURCE_TOO_LARGE'
    );
  }
  return {
    sha256: sha256Buffer(buffer),
    bytes: buffer.length,
    media_type: format.media_type,
    format: format.format
  };
}

export function buildFigureSemanticSidecar({
  figure,
  source,
  sourceName,
  contract
}) {
  const figureBuffer = Buffer.isBuffer(figure) ? figure : Buffer.from(figure);
  const sourceBuffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const normalizedContract = normalizeFigureSemanticContract(contract);
  const replay = replayFigureSemanticData({
    source: sourceBuffer,
    sourceName,
    contract: normalizedContract
  });
  return {
    schema_version: FIGURE_SEMANTIC_SIDECAR_SCHEMA_VERSION,
    engine: FIGURE_SEMANTIC_ENGINE,
    engine_version: FIGURE_SEMANTIC_ENGINE_VERSION,
    unit_engine: {
      name: UNIT_ENGINE_NAME,
      version: UNIT_ENGINE_VERSION
    },
    figure: pngDescriptor(figureBuffer),
    source: sourceDescriptor(sourceBuffer, sourceName),
    contract: normalizedContract,
    contract_sha256: sha256Json(normalizedContract),
    replay,
    replay_sha256: sha256Json(replay),
    limitations: FIGURE_SEMANTIC_LIMITATION
  };
}

function normalizeSha256(value, label) {
  const digest = String(value ?? '');
  if (!SHA256_PATTERN.test(digest)) {
    throw registrationError(label + ' must be a lowercase SHA-256 digest.',
      'INVALID_FIGURE_SIDECAR');
  }
  return digest;
}

function normalizePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw registrationError(label + ' must be a bounded positive integer.',
      'INVALID_FIGURE_SIDECAR');
  }
  return number;
}

export function normalizeFigureSemanticSidecar(value) {
  assertPlainObject(value, 'Figure semantic sidecar', 'INVALID_FIGURE_SIDECAR');
  rejectUnknownKeys(value, SIDECAR_KEYS, 'figure semantic sidecar',
    'INVALID_FIGURE_SIDECAR');
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_FIGURE_SEMANTIC_SIDECAR_BYTES) {
    throw registrationError(
      'Figure semantic sidecar exceeds the ' +
        MAX_FIGURE_SEMANTIC_SIDECAR_BYTES + '-byte limit.',
      'FIGURE_SEMANTIC_SIDECAR_TOO_LARGE'
    );
  }
  if (value.schema_version !== FIGURE_SEMANTIC_SIDECAR_SCHEMA_VERSION ||
      value.engine !== FIGURE_SEMANTIC_ENGINE ||
      value.engine_version !== FIGURE_SEMANTIC_ENGINE_VERSION) {
    throw registrationError(
      'Figure semantic sidecar uses an unsupported schema or replay engine.',
      'UNSUPPORTED_FIGURE_SEMANTIC_VERSION'
    );
  }
  if (!plainObject(value.unit_engine) ||
      value.unit_engine.name !== UNIT_ENGINE_NAME ||
      !SUPPORTED_UNIT_ENGINE_VERSIONS.includes(value.unit_engine.version) ||
      Object.keys(value.unit_engine).some((key) => !['name', 'version'].includes(key))) {
    throw registrationError(
      'Figure semantic sidecar unit-engine binding is invalid.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  assertPlainObject(value.figure, 'Sidecar figure', 'INVALID_FIGURE_SIDECAR');
  rejectUnknownKeys(value.figure, SIDECAR_FIGURE_KEYS, 'sidecar figure',
    'INVALID_FIGURE_SIDECAR');
  const figure = {
    sha256: normalizeSha256(value.figure.sha256, 'Sidecar figure sha256'),
    bytes: normalizePositiveInteger(
      value.figure.bytes,
      'Sidecar figure bytes',
      MAX_PNG_BYTES
    ),
    media_type: String(value.figure.media_type ?? ''),
    width: normalizePositiveInteger(value.figure.width, 'Sidecar figure width'),
    height: normalizePositiveInteger(value.figure.height, 'Sidecar figure height')
  };
  if (figure.media_type !== 'image/png') {
    throw registrationError(
      'Sidecar figure media_type must be image/png.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  assertPlainObject(value.source, 'Sidecar source', 'INVALID_FIGURE_SIDECAR');
  rejectUnknownKeys(value.source, SIDECAR_SOURCE_KEYS, 'sidecar source',
    'INVALID_FIGURE_SIDECAR');
  const format = String(value.source.format ?? '');
  if (!['csv', 'tsv'].includes(format)) {
    throw registrationError(
      'Sidecar source format must be csv or tsv.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  const expectedMediaType = format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'text/tab-separated-values; charset=utf-8';
  const source = {
    sha256: normalizeSha256(value.source.sha256, 'Sidecar source sha256'),
    bytes: normalizePositiveInteger(
      value.source.bytes,
      'Sidecar source bytes',
      MAX_FIGURE_SEMANTIC_SOURCE_BYTES
    ),
    media_type: String(value.source.media_type ?? ''),
    format
  };
  if (source.media_type !== expectedMediaType) {
    throw registrationError(
      'Sidecar source media_type does not match its format.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  const contract = normalizeFigureSemanticContract(value.contract);
  const contractSha256 = normalizeSha256(
    value.contract_sha256,
    'Sidecar contract_sha256'
  );
  if (contractSha256 !== sha256Json(contract)) {
    throw registrationError(
      'Sidecar contract_sha256 does not match its normalized contract.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  assertPlainObject(value.replay, 'Sidecar replay', 'INVALID_FIGURE_SIDECAR');
  const replay = JSON.parse(JSON.stringify(value.replay));
  const replaySha256 = normalizeSha256(
    value.replay_sha256,
    'Sidecar replay_sha256'
  );
  if (replaySha256 !== sha256Json(replay)) {
    throw registrationError(
      'Sidecar replay_sha256 does not match its replay object.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  if (value.limitations !== FIGURE_SEMANTIC_LIMITATION) {
    throw registrationError(
      'Figure semantic sidecar must retain the standard limitation statement.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  return {
    schema_version: FIGURE_SEMANTIC_SIDECAR_SCHEMA_VERSION,
    engine: FIGURE_SEMANTIC_ENGINE,
    engine_version: FIGURE_SEMANTIC_ENGINE_VERSION,
    unit_engine: {
      name: UNIT_ENGINE_NAME,
      version: UNIT_ENGINE_VERSION
    },
    figure,
    source,
    contract,
    contract_sha256: contractSha256,
    replay,
    replay_sha256: replaySha256,
    limitations: FIGURE_SEMANTIC_LIMITATION
  };
}

function parseSidecarBuffer(value) {
  if (!Buffer.isBuffer(value) || !value.length) {
    throw registrationError(
      'Figure semantic sidecar is empty.',
      'INVALID_FIGURE_SIDECAR'
    );
  }
  if (value.length > MAX_FIGURE_SEMANTIC_SIDECAR_BYTES) {
    throw registrationError(
      'Figure semantic sidecar exceeds the bounded read limit.',
      'FIGURE_SEMANTIC_SIDECAR_TOO_LARGE'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(decodeUtf8(value, 'Figure semantic sidecar'));
  } catch (error) {
    if (error.code) throw error;
    throw registrationError(
      'Figure semantic sidecar is not valid JSON: ' + error.message,
      'INVALID_FIGURE_SIDECAR'
    );
  }
  return normalizeFigureSemanticSidecar(parsed);
}

function check(name, pass, detail = null) {
  return {
    name,
    status: pass ? 'pass' : 'fail',
    ...(detail ? { detail } : {})
  };
}

export function analyzeFigureRegistration({
  figure,
  source,
  sourceName,
  sidecar,
  contract
}) {
  const expected = buildFigureSemanticSidecar({
    figure,
    source,
    sourceName,
    contract
  });
  let observed = null;
  let sidecarError = null;
  try {
    observed = parseSidecarBuffer(sidecar);
  } catch (error) {
    sidecarError = {
      code: error.code ?? 'INVALID_FIGURE_SIDECAR',
      message: error.message
    };
  }
  const sidecarValid = Boolean(observed);
  const figureBound = sidecarValid &&
    sha256Json(observed.figure) === sha256Json(expected.figure);
  const sourceBound = sidecarValid &&
    sha256Json(observed.source) === sha256Json(expected.source);
  const contractBound = sidecarValid &&
    observed.contract_sha256 === expected.contract_sha256 &&
    sha256Json(observed.contract) === sha256Json(expected.contract);
  const replayBound = sidecarValid &&
    observed.replay_sha256 === expected.replay_sha256 &&
    sha256Json(observed.replay) === sha256Json(expected.replay);
  const checks = [
    check('sidecar_schema', sidecarValid, sidecarError?.message ?? null),
    check('figure_digest_and_dimensions', figureBound),
    check('source_digest_and_format', sourceBound),
    check('declared_contract', contractBound),
    check('deterministic_data_replay', replayBound)
  ];
  const mismatches = [];
  if (sidecarError) mismatches.push({
    issue: 'sidecar_invalid',
    ...sidecarError
  });
  if (sidecarValid && !figureBound) mismatches.push({
    issue: 'figure_binding_mismatch',
    expected_sha256: expected.figure.sha256,
    actual_sha256: observed.figure.sha256
  });
  if (sidecarValid && !sourceBound) mismatches.push({
    issue: 'source_binding_mismatch',
    expected_sha256: expected.source.sha256,
    actual_sha256: observed.source.sha256
  });
  if (sidecarValid && !contractBound) mismatches.push({
    issue: 'contract_binding_mismatch',
    expected_sha256: expected.contract_sha256,
    actual_sha256: observed.contract_sha256
  });
  if (sidecarValid && !replayBound) mismatches.push({
    issue: 'data_replay_mismatch',
    expected_sha256: expected.replay_sha256,
    actual_sha256: observed.replay_sha256
  });
  const pass = checks.every((item) => item.status === 'pass');
  return {
    schema_version: FIGURE_SEMANTIC_REPORT_SCHEMA_VERSION,
    engine: FIGURE_SEMANTIC_ENGINE,
    engine_version: FIGURE_SEMANTIC_ENGINE_VERSION,
    unit_engine: {
      name: UNIT_ENGINE_NAME,
      version: UNIT_ENGINE_VERSION
    },
    status: pass ? 'pass' : 'fail',
    registration_status: pass ? 'matched' : 'mismatch',
    contract: expected.contract,
    contract_sha256: expected.contract_sha256,
    checks,
    summary: {
      passed_checks: checks.filter((item) => item.status === 'pass').length,
      failed_checks: checks.filter((item) => item.status === 'fail').length,
      source_rows: expected.replay.data_row_count,
      complete_rows: expected.replay.complete_row_count,
      dropped_rows: expected.replay.dropped_row_count,
      plotted_points: expected.replay.plotted_point_count,
      series: expected.replay.series.length,
      sampled: expected.replay.sampled,
      converted_axes: Number(expected.replay.x_axis.converted) +
        expected.replay.series.filter((item) => item.converted).length
    },
    expected: {
      figure: expected.figure,
      source: expected.source,
      replay: expected.replay,
      replay_sha256: expected.replay_sha256
    },
    observed: observed ? {
      figure: observed.figure,
      source: observed.source,
      contract_sha256: observed.contract_sha256,
      replay_sha256: observed.replay_sha256
    } : null,
    mismatches,
    interpretation: pass
      ? 'The immutable producer sidecar matches the exact PNG, source table, ' +
        'declared encodings, unit conversions, and deterministic plotted-data replay.'
      : 'The immutable producer sidecar does not match one or more exact ' +
        'figure, source, contract, or plotted-data bindings.',
    limitations: FIGURE_SEMANTIC_LIMITATION
  };
}

function regularProjectFile(cwd, value, label, extensions) {
  const file = resolveInsideRoot(cwd, String(value ?? ''));
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw registrationError(label + ' must be a regular project file.',
      'INVALID_FIGURE_REGISTRATION');
  }
  const projectReal = fs.realpathSync(path.resolve(cwd));
  const fileReal = fs.realpathSync(file);
  if (!isPathInside(projectReal, fileReal)) {
    throw registrationError(label + ' escapes the project.',
      'INVALID_FIGURE_REGISTRATION');
  }
  const extension = path.extname(fileReal).toLowerCase();
  if (!extensions.has(extension)) {
    throw registrationError(
      label + ' has an unsupported file extension.',
      label === 'Figure source'
        ? 'UNSUPPORTED_FIGURE_DATA_FORMAT'
        : 'UNSUPPORTED_FIGURE_FORMAT'
    );
  }
  return fileReal;
}

export function createFigureSemanticSidecarFile({
  cwd,
  contract,
  figureFile,
  sourceFile,
  outputFile
}) {
  const project = path.resolve(cwd);
  const figure = regularProjectFile(
    project,
    figureFile,
    'Figure PNG',
    new Set(['.png'])
  );
  const source = regularProjectFile(
    project,
    sourceFile,
    'Figure source',
    SOURCE_EXTENSIONS
  );
  const sidecar = buildFigureSemanticSidecar({
    figure: fs.readFileSync(figure),
    source: fs.readFileSync(source),
    sourceName: path.basename(source),
    contract
  });
  if (outputFile !== undefined && outputFile !== null &&
      String(outputFile).trim()) {
    const output = resolveInsideRoot(project, String(outputFile));
    if (path.extname(output).toLowerCase() !== '.json') {
      throw registrationError(
        'Figure semantic sidecar output must use a .json extension.',
        'INVALID_FIGURE_REGISTRATION'
      );
    }
    const parent = path.dirname(output);
    const parentStat = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (!parentStat?.isDirectory() || parentStat.isSymbolicLink() ||
        !isPathInside(fs.realpathSync(project), fs.realpathSync(parent))) {
      throw registrationError(
        'Figure semantic sidecar output directory must be a real project directory.',
        'INVALID_FIGURE_REGISTRATION_PATH'
      );
    }
    writeJsonExclusive(output, sidecar);
  }
  return sidecar;
}

function registrationsRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  const metadata = path.join(project, INTERNAL_DIR);
  const metadataStat = fs.lstatSync(metadata, { throwIfNoEntry: false });
  if (metadataStat && (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() ||
      !isPathInside(fs.realpathSync(project), fs.realpathSync(metadata)))) {
    throw registrationError(
      'Figure registration metadata root must be a real project directory.',
      'INVALID_FIGURE_REGISTRATION_PATH'
    );
  }
  const root = path.join(metadata, 'figure-registrations');
  const existingRoot = fs.lstatSync(root, { throwIfNoEntry: false });
  if (existingRoot && (!existingRoot.isDirectory() || existingRoot.isSymbolicLink())) {
    throw registrationError(
      'Figure registration storage must be a real project directory.',
      'INVALID_FIGURE_REGISTRATION_PATH'
    );
  }
  if (create) ensureScienceDir(project);
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw registrationError(
      'Figure registration storage must be a real project directory.',
      'INVALID_FIGURE_REGISTRATION_PATH'
    );
  }
  if (stat) {
    const science = fs.realpathSync(path.join(project, INTERNAL_DIR));
    const real = fs.realpathSync(root);
    if (!isPathInside(science, real)) {
      throw registrationError(
        'Figure registration storage escapes the project.',
        'INVALID_FIGURE_REGISTRATION_PATH'
      );
    }
  }
  return root;
}

export function resolveFigureRegistrationDirectory(cwd, value) {
  return path.join(registrationsRoot(cwd), normalizeRegistrationId(value));
}

function registrationFiles(cwd, value) {
  const registrationId = normalizeRegistrationId(value);
  const directory = resolveFigureRegistrationDirectory(cwd, registrationId);
  return {
    registration_id: registrationId,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    report: path.join(directory, 'report.json'),
    figure: path.join(directory, 'figure.png'),
    sidecar: path.join(directory, 'sidecar.json'),
    csv: path.join(directory, 'source.csv'),
    tsv: path.join(directory, 'source.tsv')
  };
}

function safeRegistrationDirectory(cwd, value) {
  const root = registrationsRoot(cwd);
  const files = registrationFiles(cwd, value);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw registrationError(
      'Figure registration not found: ' + files.registration_id,
      'FIGURE_REGISTRATION_NOT_FOUND'
    );
  }
  const rootReal = fs.realpathSync(root);
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(rootReal, directoryReal)) {
    throw registrationError(
      'Figure registration escapes its storage root.',
      'INVALID_FIGURE_REGISTRATION_PATH'
    );
  }
  for (const file of [
    files.manifest,
    files.digest,
    files.report,
    files.figure,
    files.sidecar
  ]) {
    const fileStat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!fileStat?.isFile() || fileStat.isSymbolicLink() ||
        !isPathInside(directoryReal, fs.realpathSync(file))) {
      throw registrationError(
        'Figure registration file is missing or unsafe: ' + path.basename(file),
        'FIGURE_REGISTRATION_INVALID'
      );
    }
    const limit = FILE_LIMITS.get(path.basename(file));
    if (Number.isFinite(limit) && fileStat.size > limit) {
      throw registrationError(
        'Figure registration file exceeds its safe read limit: ' +
          path.basename(file),
        'FIGURE_REGISTRATION_FILE_TOO_LARGE'
      );
    }
  }
  return { ...files, directory: directoryReal };
}

function publicResolvedTarget(resolved, selector) {
  return {
    kind: resolved.kind,
    record_id: resolved.record_id,
    name: resolved.name,
    url: resolved.url,
    sha256: resolved.sha256,
    bytes: resolved.bytes,
    media_type: resolved.media_type,
    record_sha256: resolved.record_sha256 ?? null,
    source: resolved.source ?? null,
    selector
  };
}

function resolveTarget(cwd, value, role) {
  const project = path.resolve(cwd);
  const normalizedSelector = normalizeRegistrationSelector(value, role);
  const selected = normalizedSelector.source ?? normalizedSelector;
  let target;
  if (selected.revision_id !== undefined && selected.revision_id !== null &&
      String(selected.revision_id).trim()) {
    const revision = resolveArtifactRevision(project, selected.revision_id);
    const manifest = revision.manifest;
    target = {
      ...publicResolvedTarget({
        kind: 'revision',
        record_id: revision.revision_id,
        name: manifest.artifact.name,
        url: '/revision-artifact/' + encodeURIComponent(revision.revision_id),
        sha256: manifest.artifact.sha256,
        bytes: manifest.artifact.bytes,
        media_type: manifest.artifact.media_type,
        record_sha256: revision.verification.manifest_sha256,
        source: manifest.source
      }, { revision_id: revision.revision_id }),
      file: revision.file
    };
  } else {
    const resolved = resolveRevisionSourceArtifact(project, selected);
    const selectorSource = {
      kind: resolved.kind,
      record_id: resolved.record_id,
      name: resolved.name,
      url: resolved.url,
      sha256: resolved.sha256
    };
    target = {
      ...publicResolvedTarget(resolved, { source: selectorSource }),
      file: resolved.file
    };
  }
  const extension = path.extname(target.name).toLowerCase();
  if (role === 'figure') {
    if (extension !== '.png' ||
        !['image/png', 'application/octet-stream'].includes(target.media_type)) {
      throw registrationError(
        'Semantic figure registration requires a manifest-bound PNG artifact.',
        'UNSUPPORTED_FIGURE_FORMAT'
      );
    }
    if (!Number.isSafeInteger(target.bytes) || target.bytes < 1 ||
        target.bytes > MAX_PNG_BYTES) {
      throw registrationError(
        'Semantic figure PNG exceeds the bounded source size.',
        'FIGURE_SEMANTIC_FIGURE_TOO_LARGE'
      );
    }
  } else if (role === 'source') {
    sourceFormat(target.name);
    if (!Number.isSafeInteger(target.bytes) || target.bytes < 1 ||
        target.bytes > MAX_FIGURE_SEMANTIC_SOURCE_BYTES) {
      throw registrationError(
        'Figure semantic source exceeds the bounded source size.',
        'FIGURE_SEMANTIC_SOURCE_TOO_LARGE'
      );
    }
  } else if (role === 'sidecar') {
    if (extension !== '.json') {
      throw registrationError(
        'Figure semantic sidecar must be a manifest-bound JSON artifact.',
        'INVALID_FIGURE_SIDECAR'
      );
    }
    if (!Number.isSafeInteger(target.bytes) || target.bytes < 1 ||
        target.bytes > MAX_FIGURE_SEMANTIC_SIDECAR_BYTES) {
      throw registrationError(
        'Figure semantic sidecar exceeds the bounded source size.',
        'FIGURE_SEMANTIC_SIDECAR_TOO_LARGE'
      );
    }
  }
  return target;
}

export function resolveFigureRegistrationTarget(cwd, value, role) {
  if (!['figure', 'source', 'sidecar'].includes(role)) {
    throw registrationError('Unknown figure registration target role: ' + role);
  }
  return resolveTarget(cwd, value, role);
}

function targetSelector(target) {
  if (target?.selector?.revision_id) {
    return { revision_id: target.selector.revision_id };
  }
  if (target?.selector?.source) return target.selector.source;
  throw registrationError(
    'Figure registration target selector is invalid.',
    'FIGURE_REGISTRATION_INVALID'
  );
}

function publicTarget(target) {
  const { file: _file, ...value } = target;
  return value;
}

function compareTarget(expected, actual, errors, prefix) {
  for (const key of [
    'kind',
    'record_id',
    'name',
    'url',
    'sha256',
    'bytes',
    'media_type',
    'record_sha256'
  ]) {
    if ((expected?.[key] ?? null) !== (actual?.[key] ?? null)) {
      errors.push({
        file: 'manifest.json',
        issue: prefix + '_' + key + '_mismatch',
        expected: expected?.[key] ?? null,
        actual: actual?.[key] ?? null
      });
    }
  }
}

function artifactDescriptor(file, relative, mediaType) {
  return {
    file: relative,
    sha256: sha256File(file),
    bytes: fs.statSync(file).size,
    media_type: mediaType
  };
}

function writeBufferExclusive(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function safeRemoveStaging(root, staging) {
  if (!isPathInside(root, staging) ||
      path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith('.staging-figure-registration-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function registrationDirectories(cwd) {
  const root = registrationsRoot(cwd);
  const ids = new Set();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && REGISTRATION_ID_PATTERN.test(entry.name)) {
        ids.add(entry.name);
      }
    }
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'figure_registration.created' &&
          REGISTRATION_ID_PATTERN.test(String(record.figure_registration_id ?? ''))) {
        ids.add(record.figure_registration_id);
      }
    }
  } catch {
    // Project-level verification reports malformed audit records.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

export function createFigureRegistration({
  cwd,
  chatId,
  figure,
  source,
  sidecar,
  contract,
  name,
  note,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw registrationError('Figure registration timestamp is invalid.');
  }
  const normalizedChatId = validateOptionalChat(project, chatId);
  const normalizedContract = normalizeFigureSemanticContract(contract);
  const normalizedName = boundedText(
    name,
    'Figure registration name',
    240,
    { optional: true }
  );
  const normalizedNote = boundedText(
    note,
    'Figure registration note',
    2_000,
    { optional: true }
  );
  const figureTarget = resolveTarget(project, figure, 'figure');
  const sourceTarget = resolveTarget(project, source, 'source');
  const sidecarTarget = resolveTarget(project, sidecar, 'sidecar');
  if (new Set([
    figureTarget.sha256,
    sourceTarget.sha256,
    sidecarTarget.sha256
  ]).size !== 3) {
    throw registrationError(
      'Figure, source, and sidecar must be distinct immutable artifacts.'
    );
  }
  const figureBuffer = fs.readFileSync(figureTarget.file);
  const sourceBuffer = fs.readFileSync(sourceTarget.file);
  const sidecarBuffer = fs.readFileSync(sidecarTarget.file);
  const report = analyzeFigureRegistration({
    figure: figureBuffer,
    source: sourceBuffer,
    sourceName: sourceTarget.name,
    sidecar: sidecarBuffer,
    contract: normalizedContract
  });
  const reportBytes = Buffer.byteLength(JSON.stringify(report));
  if (reportBytes > MAX_FIGURE_SEMANTIC_REPORT_BYTES) {
    throw registrationError(
      'Figure semantic report exceeds the bounded record size.',
      'FIGURE_SEMANTIC_REPORT_TOO_LARGE'
    );
  }
  const root = registrationsRoot(project, { create: true });
  if (registrationDirectories(project).length >= MAX_FIGURE_REGISTRATIONS) {
    throw registrationError(
      'Figure registration limit reached for this project.',
      'FIGURE_REGISTRATION_LIMIT'
    );
  }
  const registrationId = makeFigureRegistrationId(now);
  const finalDirectory = path.join(root, registrationId);
  if (fs.existsSync(finalDirectory)) {
    throw registrationError(
      'Figure registration already exists: ' + registrationId,
      'FIGURE_REGISTRATION_EXISTS'
    );
  }
  const staging = path.join(
    root,
    '.staging-figure-registration-' + crypto.randomBytes(8).toString('hex')
  );
  fs.mkdirSync(staging, { mode: 0o700 });
  let manifest;
  try {
    const sourceFormatValue = sourceFormat(sourceTarget.name);
    const sourceArtifactName = 'source' + sourceFormatValue.extension;
    const figureFile = path.join(staging, 'figure.png');
    const sourceFile = path.join(staging, sourceArtifactName);
    const sidecarFile = path.join(staging, 'sidecar.json');
    const reportFile = path.join(staging, 'report.json');
    writeBufferExclusive(figureFile, figureBuffer);
    writeBufferExclusive(sourceFile, sourceBuffer);
    writeBufferExclusive(sidecarFile, sidecarBuffer);
    writeJsonExclusive(reportFile, report);
    const artifacts = {
      'figure.png': artifactDescriptor(figureFile, 'figure.png', 'image/png'),
      [sourceArtifactName]: artifactDescriptor(
        sourceFile,
        sourceArtifactName,
        sourceFormatValue.media_type
      ),
      'sidecar.json': artifactDescriptor(
        sidecarFile,
        'sidecar.json',
        'application/json; charset=utf-8'
      ),
      'report.json': artifactDescriptor(
        reportFile,
        'report.json',
        'application/json; charset=utf-8'
      )
    };
    manifest = {
      schema_version: FIGURE_REGISTRATION_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      figure_registration_id: registrationId,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      name: normalizedName,
      note: normalizedNote,
      status: report.status,
      registration_status: report.registration_status,
      figure: publicTarget(figureTarget),
      source: publicTarget(sourceTarget),
      sidecar: publicTarget(sidecarTarget),
      contract: normalizedContract,
      contract_sha256: report.contract_sha256,
      replay_engine: {
        name: FIGURE_SEMANTIC_ENGINE,
        version: FIGURE_SEMANTIC_ENGINE_VERSION,
        unit_engine: {
          name: UNIT_ENGINE_NAME,
          version: UNIT_ENGINE_VERSION
        }
      },
      summary: report.summary,
      artifacts,
      preservation_policy:
        'immutable figure, source, sidecar, normalized contract, deterministic replay report, hashes, and audit link',
      limitations: FIGURE_SEMANTIC_LIMITATION
    };
    const manifestFile = path.join(staging, 'manifest.json');
    writeJsonExclusive(manifestFile, manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(manifestFile) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
  } catch (error) {
    safeRemoveStaging(root, staging);
    throw error;
  }
  const files = registrationFiles(project, registrationId);
  const manifestSha256 = sha256File(files.manifest);
  appendAudit(project, {
    type: 'figure_registration.created',
    figure_registration_id: registrationId,
    chat_id: normalizedChatId,
    status: report.status,
    registration_status: report.registration_status,
    figure_sha256: figureTarget.sha256,
    source_sha256: sourceTarget.sha256,
    sidecar_sha256: sidecarTarget.sha256,
    contract_sha256: report.contract_sha256,
    replay_sha256: report.expected.replay_sha256,
    report_sha256: manifest.artifacts['report.json'].sha256,
    manifest_sha256: manifestSha256
  });
  return getFigureRegistration(project, registrationId);
}

export function getFigureRegistrationManifest(cwd, value) {
  return readJson(safeRegistrationDirectory(cwd, value).manifest);
}

export function getFigureRegistrationReport(cwd, value) {
  const files = safeRegistrationDirectory(cwd, value);
  if (fs.statSync(files.report).size > MAX_FIGURE_SEMANTIC_REPORT_BYTES) {
    throw registrationError(
      'Figure semantic report exceeds the safe read limit.',
      'FIGURE_SEMANTIC_REPORT_TOO_LARGE'
    );
  }
  return readJson(files.report);
}

function artifactFileInside(files, descriptor, expectedName, errors) {
  if (!descriptor || descriptor.file !== expectedName ||
      !FIXED_ARTIFACT_FILES.has(descriptor.file)) {
    errors.push({
      file: 'manifest.json',
      issue: 'invalid_artifact_path',
      artifact: expectedName
    });
    return null;
  }
  try {
    const file = resolveInsideRoot(files.directory, descriptor.file);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink() ||
        !isPathInside(files.directory, fs.realpathSync(file))) {
      throw new Error('artifact missing or unsafe');
    }
    const limit = FILE_LIMITS.get(expectedName);
    if (Number.isFinite(limit) && stat.size > limit) {
      throw new Error('artifact exceeds its safe read limit');
    }
    const actualSha256 = sha256File(file);
    if (descriptor.sha256 !== actualSha256) {
      errors.push({
        file: descriptor.file,
        issue: 'hash_mismatch',
        expected: descriptor.sha256 ?? null,
        actual: actualSha256
      });
    }
    if (descriptor.bytes !== stat.size) {
      errors.push({
        file: descriptor.file,
        issue: 'byte_count_mismatch',
        expected: descriptor.bytes ?? null,
        actual: stat.size
      });
    }
    return file;
  } catch (error) {
    errors.push({
      file: expectedName,
      issue: 'artifact_unavailable',
      detail: error.message
    });
    return null;
  }
}

export function verifyFigureRegistration(cwd, value) {
  const project = path.resolve(cwd);
  const registrationId = String(value ?? '');
  const errors = [];
  let files;
  let manifest;
  let report;
  try {
    files = safeRegistrationDirectory(project, registrationId);
    manifest = readJson(files.manifest);
    report = getFigureRegistrationReport(project, registrationId);
  } catch (error) {
    return {
      ok: false,
      figure_registration_id: registrationId,
      errors: [{
        issue: error.code ?? 'figure_registration_error',
        detail: error.message
      }]
    };
  }
  const manifestSha256 = sha256File(files.manifest);
  const expectedManifestSha256 = fs.readFileSync(files.digest, 'utf8').trim();
  if (manifest.schema_version !== FIGURE_REGISTRATION_SCHEMA_VERSION) {
    errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
  }
  if (manifest.figure_registration_id !== registrationId) {
    errors.push({
      file: 'manifest.json',
      issue: 'figure_registration_id_mismatch'
    });
  }
  if (manifestSha256 !== expectedManifestSha256) {
    errors.push({
      file: 'manifest.json',
      issue: 'hash_mismatch',
      expected: expectedManifestSha256,
      actual: manifestSha256
    });
  }
  const sourceExtension = path.extname(manifest.source?.name ?? '').toLowerCase();
  const sourceArtifactName = sourceExtension === '.tsv' ? 'source.tsv' : 'source.csv';
  const expectedArtifactNames = new Set([
    'figure.png', sourceArtifactName, 'sidecar.json', 'report.json'
  ]);
  for (const name of Object.keys(manifest.artifacts ?? {})) {
    if (!expectedArtifactNames.has(name)) {
      errors.push({
        file: 'manifest.json',
        issue: 'unexpected_artifact',
        artifact: name
      });
    }
  }
  const figureFile = artifactFileInside(
    files,
    manifest.artifacts?.['figure.png'],
    'figure.png',
    errors
  );
  const sourceFile = artifactFileInside(
    files,
    manifest.artifacts?.[sourceArtifactName],
    sourceArtifactName,
    errors
  );
  const sidecarFile = artifactFileInside(
    files,
    manifest.artifacts?.['sidecar.json'],
    'sidecar.json',
    errors
  );
  const reportFile = artifactFileInside(
    files,
    manifest.artifacts?.['report.json'],
    'report.json',
    errors
  );
  let resolvedFigure = null;
  let resolvedSource = null;
  let resolvedSidecar = null;
  for (const [role, target, setResolved] of [
    ['figure', manifest.figure, (value) => { resolvedFigure = value; }],
    ['source', manifest.source, (value) => { resolvedSource = value; }],
    ['sidecar', manifest.sidecar, (value) => { resolvedSidecar = value; }]
  ]) {
    try {
      const resolved = resolveTarget(project, targetSelector(target), role);
      setResolved(resolved);
      compareTarget(target, resolved, errors, role);
    } catch (error) {
      errors.push({
        file: 'manifest.json',
        issue: role + '_invalid',
        detail: error.message,
        code: error.code ?? null
      });
    }
  }
  for (const [file, resolved, name] of [
    [figureFile, resolvedFigure, 'figure.png'],
    [sourceFile, resolvedSource, sourceArtifactName],
    [sidecarFile, resolvedSidecar, 'sidecar.json']
  ]) {
    if (file && resolved && sha256File(file) !== resolved.sha256) {
      errors.push({ file: name, issue: 'source_copy_mismatch' });
    }
  }
  let recomputed = null;
  try {
    if (!figureFile || !sourceFile || !sidecarFile ||
        !resolvedFigure || !resolvedSource || !resolvedSidecar) {
      throw new Error('semantic registration inputs are unavailable');
    }
    recomputed = analyzeFigureRegistration({
      figure: fs.readFileSync(figureFile),
      source: fs.readFileSync(sourceFile),
      sourceName: resolvedSource.name,
      sidecar: fs.readFileSync(sidecarFile),
      contract: manifest.contract
    });
    if (sha256Json(recomputed) !== sha256Json(report)) {
      errors.push({
        file: 'report.json',
        issue: 'deterministic_recalculation_mismatch'
      });
    }
  } catch (error) {
    errors.push({
      file: 'report.json',
      issue: 'semantic_recalculation_failed',
      detail: error.message,
      code: error.code ?? null
    });
  }
  if (reportFile &&
      manifest.artifacts?.['report.json']?.sha256 !== sha256File(reportFile)) {
    errors.push({ file: 'report.json', issue: 'manifest_report_mismatch' });
  }
  let normalizedContract = null;
  try {
    normalizedContract = normalizeFigureSemanticContract(manifest.contract);
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'contract_invalid',
      detail: error.message
    });
  }
  if (!normalizedContract ||
      manifest.contract_sha256 !== sha256Json(normalizedContract) ||
      report.schema_version !== FIGURE_SEMANTIC_REPORT_SCHEMA_VERSION ||
      report.engine !== FIGURE_SEMANTIC_ENGINE ||
      report.engine_version !== FIGURE_SEMANTIC_ENGINE_VERSION ||
      report.unit_engine?.name !== UNIT_ENGINE_NAME ||
      !SUPPORTED_UNIT_ENGINE_VERSIONS.includes(report.unit_engine?.version) ||
      manifest.replay_engine?.name !== FIGURE_SEMANTIC_ENGINE ||
      manifest.replay_engine?.version !== FIGURE_SEMANTIC_ENGINE_VERSION ||
      manifest.replay_engine?.unit_engine?.name !== UNIT_ENGINE_NAME ||
      !SUPPORTED_UNIT_ENGINE_VERSIONS.includes(manifest.replay_engine?.unit_engine?.version) ||
      report.contract_sha256 !== manifest.contract_sha256) {
    errors.push({ file: 'report.json', issue: 'semantic_settings_mismatch' });
  }
  if (manifest.status !== report.status ||
      manifest.registration_status !== report.registration_status ||
      sha256Json(manifest.summary) !== sha256Json(report.summary) ||
      manifest.limitations !== FIGURE_SEMANTIC_LIMITATION ||
      report.limitations !== FIGURE_SEMANTIC_LIMITATION) {
    errors.push({ file: 'manifest.json', issue: 'report_summary_mismatch' });
  }
  try {
    validateOptionalChat(project, manifest.chat_id);
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'registration_chat_invalid',
      detail: error.message
    });
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const event = readAuditRecords(project).findLast((record) =>
      record.type === 'figure_registration.created' &&
      record.figure_registration_id === registrationId
    );
    if (!event) {
      errors.push({ issue: 'missing_figure_registration_audit_event' });
    } else {
      if (event.manifest_sha256 !== manifestSha256) {
        errors.push({ issue: 'audit_manifest_mismatch' });
      }
      if (event.report_sha256 !== manifest.artifacts?.['report.json']?.sha256) {
        errors.push({ issue: 'audit_report_mismatch' });
      }
      if (event.figure_sha256 !== manifest.figure?.sha256 ||
          event.source_sha256 !== manifest.source?.sha256 ||
          event.sidecar_sha256 !== manifest.sidecar?.sha256) {
        errors.push({ issue: 'audit_source_mismatch' });
      }
      if (event.contract_sha256 !== manifest.contract_sha256 ||
          event.replay_sha256 !== report.expected?.replay_sha256) {
        errors.push({ issue: 'audit_semantic_binding_mismatch' });
      }
      if (event.status !== manifest.status ||
          event.registration_status !== manifest.registration_status) {
        errors.push({ issue: 'audit_status_mismatch' });
      }
    }
  }
  return {
    ok: errors.length === 0,
    figure_registration_id: registrationId,
    manifest,
    report,
    manifest_sha256: manifestSha256,
    report_sha256: manifest.artifacts?.['report.json']?.sha256 ?? null,
    errors
  };
}

function registrationSummary(cwd, registrationId) {
  try {
    const verification = verifyFigureRegistration(cwd, registrationId);
    if (!verification.manifest || !verification.report) {
      throw new Error('Figure registration record is unreadable.');
    }
    const manifest = verification.manifest;
    return {
      figure_registration_id: registrationId,
      created_at: manifest.created_at,
      chat_id: manifest.chat_id,
      name: manifest.name,
      note: manifest.note,
      status: manifest.status,
      registration_status: manifest.registration_status,
      verified: verification.ok,
      verification_errors: verification.errors,
      figure: manifest.figure,
      source: manifest.source,
      sidecar: manifest.sidecar,
      contract_sha256: manifest.contract_sha256,
      summary: manifest.summary,
      manifest_sha256: verification.manifest_sha256,
      report_sha256: verification.report_sha256,
      url: '/api/figure-registrations/' + encodeURIComponent(registrationId)
    };
  } catch (error) {
    return {
      figure_registration_id: registrationId,
      status: 'invalid',
      registration_status: 'invalid',
      verified: false,
      verification_errors: [{
        issue: error.code ?? 'figure_registration_error',
        detail: error.message
      }],
      figure: null,
      source: null,
      sidecar: null,
      summary: {},
      url: '/api/figure-registrations/' + encodeURIComponent(registrationId)
    };
  }
}

export function listFigureRegistrations(cwd, {
  chatId,
  figureUrl,
  sourceUrl,
  status
} = {}) {
  return registrationDirectories(cwd)
    .map((registrationId) => registrationSummary(cwd, registrationId))
    .sort((left, right) =>
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) ||
      String(right.figure_registration_id).localeCompare(
        String(left.figure_registration_id)
      )
    )
    .filter((record) => !chatId || record.chat_id === chatId)
    .filter((record) => !figureUrl || record.figure?.url === figureUrl)
    .filter((record) => !sourceUrl || record.source?.url === sourceUrl)
    .filter((record) => !status || record.status === status);
}

export function getFigureRegistration(cwd, value) {
  const registrationId = normalizeRegistrationId(value);
  const verification = verifyFigureRegistration(cwd, registrationId);
  if (!verification.manifest || !verification.report) {
    throw registrationError(
      'Figure registration not found: ' + registrationId,
      'FIGURE_REGISTRATION_NOT_FOUND'
    );
  }
  const artifactBase = '/figure-registration-artifact/' +
    encodeURIComponent(registrationId) + '/';
  return {
    figure_registration_id: registrationId,
    manifest: verification.manifest,
    report: verification.report,
    artifacts: Object.fromEntries(
      Object.entries(verification.manifest.artifacts ?? {}).map(
        ([name, descriptor]) => [
          name,
          { ...descriptor, url: artifactBase + encodeURIComponent(name) }
        ]
      )
    ),
    verification
  };
}

export function resolveFigureRegistrationArtifact(cwd, value, name) {
  const registrationId = normalizeRegistrationId(value);
  const artifactName = String(name ?? '');
  if (!FIXED_ARTIFACT_FILES.has(artifactName)) {
    throw registrationError(
      'Figure registration artifact not found: ' + artifactName,
      'FIGURE_REGISTRATION_ARTIFACT_NOT_FOUND'
    );
  }
  const verification = verifyFigureRegistration(cwd, registrationId);
  if (!verification.ok) {
    throw Object.assign(
      new Error('Figure registration failed integrity verification.'),
      { code: 'FIGURE_REGISTRATION_INVALID', verification }
    );
  }
  const descriptor = verification.manifest.artifacts?.[artifactName];
  if (!descriptor) {
    throw registrationError(
      'Figure registration artifact not found: ' + artifactName,
      'FIGURE_REGISTRATION_ARTIFACT_NOT_FOUND'
    );
  }
  const directory = safeRegistrationDirectory(cwd, registrationId).directory;
  const file = resolveInsideRoot(directory, descriptor.file);
  return { file, descriptor, verification };
}

export function figureRegistrationInteractionArtifact(registration) {
  const manifest = registration?.manifest ?? registration;
  return {
    kind: 'figure-registration',
    record_id: manifest.figure_registration_id,
    name: manifest.name ?? manifest.figure_registration_id,
    url: '/api/figure-registrations/' +
      encodeURIComponent(manifest.figure_registration_id)
  };
}

export function figureRegistrationInteractionPayload(registration) {
  const manifest = registration?.manifest ?? registration;
  const report = registration?.report ?? {};
  return {
    figure_registration_id: manifest.figure_registration_id,
    record_file: '.sciencecode/figure-registrations/' +
      manifest.figure_registration_id + '/manifest.json',
    status: report.status ?? manifest.status,
    registration_status:
      report.registration_status ?? manifest.registration_status,
    figure_url: manifest.figure?.url ?? null,
    figure_sha256: manifest.figure?.sha256 ?? null,
    source_url: manifest.source?.url ?? null,
    source_sha256: manifest.source?.sha256 ?? null,
    sidecar_url: manifest.sidecar?.url ?? null,
    sidecar_sha256: manifest.sidecar?.sha256 ?? null,
    contract_sha256: report.contract_sha256 ?? manifest.contract_sha256,
    replay_sha256: report.expected?.replay_sha256 ?? null,
    checks: report.checks ?? null,
    summary: report.summary ?? manifest.summary,
    interpretation: report.interpretation ?? null,
    limitations: FIGURE_SEMANTIC_LIMITATION
  };
}
