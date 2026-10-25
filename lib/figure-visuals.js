import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import {
  getFigureRegistration,
  normalizeFigureSemanticContract,
  projectFigureSemanticData,
  replayFigureSemanticData,
  resolveFigureRegistrationArtifact,
  verifyFigureRegistration
} from './figure-registrations.js';
import { sha256Buffer, sha256File, sha256Json } from './hash.js';
import { decodePng } from './png.js';
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

export const FIGURE_VISUAL_SCHEMA_VERSION = 1;
export const FIGURE_VISUAL_PROFILE_SCHEMA_VERSION = 1;
export const FIGURE_VISUAL_REPORT_SCHEMA_VERSION = 1;
export const FIGURE_VISUAL_ENGINE_VERSION = 1;
export const FIGURE_VISUAL_ENGINE = 'sciencecode-flat-color-plot-vision';
export const MAX_FIGURE_VISUALS = 10_000;
export const MAX_FIGURE_VISUAL_PROFILE_BYTES = 64 * 1024;
export const MAX_FIGURE_VISUAL_SPEC_BYTES =
  MAX_FIGURE_VISUAL_PROFILE_BYTES + 8 * 1024;
export const MAX_FIGURE_VISUAL_REPORT_BYTES = 4 * 1024 * 1024;
export const MAX_FIGURE_VISUAL_MANIFEST_BYTES = 1024 * 1024;
export const MAX_FIGURE_VISUAL_PIXELS = 4 * 1024 * 1024;
export const MAX_FIGURE_VISUAL_POINTS = 4_096;
export const MAX_FIGURE_VISUAL_SAMPLES = 1_000_000;

export const FIGURE_VISUAL_LIMITATION =
  'This record inspects decoded PNG pixels for declared flat-color bottom and ' +
  'left axis strokes plus projected line or filled-circle mark support inside ' +
  'one bounded plot rectangle. ' +
  'It does not OCR or validate titles, tick labels, legends, annotations, error ' +
  'bars, hidden or overlapping marks, statistical meaning, or scientific validity.';

const VISUAL_ID_PATTERN =
  /^figure-visual-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const REGISTRATION_ID_PATTERN =
  /^figure-registration-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROFILE_KEYS = new Set([
  'schema_version',
  'plot_area',
  'x_domain',
  'y_domain',
  'background_color',
  'axis_color',
  'axis_width_pixels',
  'series',
  'color_tolerance',
  'position_tolerance_pixels',
  'minimum_axis_coverage',
  'minimum_series_coverage',
  'maximum_unexpected_series_fraction',
  'minimum_background_fraction'
]);
const PLOT_AREA_KEYS = new Set(['left', 'top', 'right', 'bottom']);
const DOMAIN_KEYS = new Set(['minimum', 'maximum']);
const COLOR_KEYS = new Set(['red', 'green', 'blue']);
const SERIES_KEYS = new Set([
  'id', 'color', 'line_width_pixels', 'marker_radius_pixels'
]);
const SPEC_KEYS = new Set([
  'schema_version', 'name', 'note', 'figure_registration_id', 'profile'
]);
const FIXED_ARTIFACTS = new Set(['report.json']);
const FILE_LIMITS = new Map([
  ['manifest.json', MAX_FIGURE_VISUAL_MANIFEST_BYTES],
  ['manifest.sha256', 256],
  ['report.json', MAX_FIGURE_VISUAL_REPORT_BYTES]
]);

function visualError(message, code = 'INVALID_FIGURE_VISUAL') {
  return Object.assign(new Error(message), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertObject(value, label, code = 'INVALID_FIGURE_VISUAL_PROFILE') {
  if (!plainObject(value)) throw visualError(label + ' must be an object.', code);
}

function rejectUnknown(value, allowed, label, code = 'INVALID_FIGURE_VISUAL_PROFILE') {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw visualError('Unknown ' + label + ' field: ' + key, code);
    }
  }
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw visualError(label + ' must be a finite JSON number.',
      'INVALID_FIGURE_VISUAL_PROFILE');
  }
  return Object.is(value, -0) ? 0 : value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw visualError(
      label + ' must be an integer from ' + minimum + ' through ' + maximum + '.',
      'INVALID_FIGURE_VISUAL_PROFILE'
    );
  }
  return value;
}

function fraction(value, label, minimum = 0, maximum = 1) {
  const number = finiteNumber(value, label);
  if (number < minimum || number > maximum) {
    throw visualError(
      label + ' must be from ' + minimum + ' through ' + maximum + '.',
      'INVALID_FIGURE_VISUAL_PROFILE'
    );
  }
  return number;
}

function boundedText(value, label, maximum, { optional = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (optional) return null;
    throw visualError(label + ' is required.');
  }
  const text = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (text.length > maximum) {
    throw visualError(label + ' must be ' + maximum + ' characters or fewer.');
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

function normalizeColor(value, label) {
  assertObject(value, label);
  rejectUnknown(value, COLOR_KEYS, label);
  return {
    red: integer(value.red, label + ' red', 0, 255),
    green: integer(value.green, label + ' green', 0, 255),
    blue: integer(value.blue, label + ' blue', 0, 255)
  };
}

function normalizeDomain(value, label, scale) {
  assertObject(value, label);
  rejectUnknown(value, DOMAIN_KEYS, label);
  const minimum = finiteNumber(value.minimum, label + ' minimum');
  const maximum = finiteNumber(value.maximum, label + ' maximum');
  if (!(minimum < maximum)) {
    throw visualError(label + ' minimum must be smaller than maximum.',
      'INVALID_FIGURE_VISUAL_PROFILE');
  }
  if (scale === 'log10' && minimum <= 0) {
    throw visualError(label + ' must be positive for a log10 axis.',
      'INVALID_FIGURE_VISUAL_PROFILE');
  }
  return { minimum, maximum };
}

function normalizePlotArea(value, width, height) {
  assertObject(value, 'Figure visual plot_area');
  rejectUnknown(value, PLOT_AREA_KEYS, 'figure visual plot_area');
  const area = Object.fromEntries(
    [...PLOT_AREA_KEYS].map((key) => [
      key,
      fraction(value[key], 'plot_area ' + key)
    ])
  );
  if (!(area.left < area.right) || !(area.top < area.bottom) ||
      area.right - area.left < 0.1 || area.bottom - area.top < 0.1) {
    throw visualError(
      'plot_area must have increasing edges and span at least 0.1 on both axes.',
      'INVALID_FIGURE_VISUAL_PROFILE'
    );
  }
  const pixels = pixelPlotArea(area, width, height);
  if (pixels.width < 32 || pixels.height < 32) {
    throw visualError(
      'plot_area must span at least 32 by 32 decoded pixels.',
      'INVALID_FIGURE_VISUAL_PROFILE'
    );
  }
  return area;
}

function colorDistance(left, right) {
  return Math.max(
    Math.abs(left.red - right.red),
    Math.abs(left.green - right.green),
    Math.abs(left.blue - right.blue)
  );
}

function pixelPlotArea(area, width, height) {
  const left = Math.round(area.left * (width - 1));
  const top = Math.round(area.top * (height - 1));
  const right = Math.round(area.right * (width - 1));
  const bottom = Math.round(area.bottom * (height - 1));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1
  };
}

function transformed(value, scale) {
  return scale === 'log10' ? Math.log10(value) : value;
}

export function normalizeFigureVisualProfile(value, {
  contract,
  width,
  height,
  points = []
} = {}) {
  assertObject(value, 'Figure visual profile');
  rejectUnknown(value, PROFILE_KEYS, 'figure visual profile');
  if (value.schema_version !== FIGURE_VISUAL_PROFILE_SCHEMA_VERSION) {
    throw visualError(
      'Figure visual profile schema_version must be ' +
        FIGURE_VISUAL_PROFILE_SCHEMA_VERSION + '.',
      'UNSUPPORTED_FIGURE_VISUAL_VERSION'
    );
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1) {
    throw visualError('Decoded figure dimensions are required for visual validation.');
  }
  const semantic = normalizeFigureSemanticContract(contract);
  if (!Array.isArray(points) || points.length < 1 ||
      points.length > MAX_FIGURE_VISUAL_POINTS) {
    throw visualError(
      'Visual validation requires 1 through ' + MAX_FIGURE_VISUAL_POINTS +
        ' plotted points after semantic sampling.',
      'FIGURE_VISUAL_POINT_LIMIT'
    );
  }
  const plotArea = normalizePlotArea(value.plot_area, width, height);
  const xDomain = normalizeDomain(value.x_domain, 'x_domain', semantic.x_axis.scale);
  const yDomain = normalizeDomain(value.y_domain, 'y_domain', semantic.y_axis.scale);
  for (const point of points) {
    if (point.x < xDomain.minimum || point.x > xDomain.maximum ||
        point.y.some((number) => number < yDomain.minimum || number > yDomain.maximum)) {
      throw visualError(
        'Visual axis domains must contain every plotted converted value.',
        'INVALID_FIGURE_VISUAL_PROFILE'
      );
    }
  }
  const backgroundColor = normalizeColor(value.background_color, 'background_color');
  const axisColor = normalizeColor(value.axis_color, 'axis_color');
  const colorTolerance = integer(
    value.color_tolerance,
    'color_tolerance',
    0,
    48
  );
  const positionTolerance = integer(
    value.position_tolerance_pixels,
    'position_tolerance_pixels',
    0,
    8
  );
  const axisWidth = integer(value.axis_width_pixels, 'axis_width_pixels', 1, 16);
  if (!Array.isArray(value.series) || value.series.length !== semantic.series.length) {
    throw visualError(
      'Visual profile series must match every semantic series exactly.',
      'INVALID_FIGURE_VISUAL_PROFILE'
    );
  }
  const series = value.series.map((item, index) => {
    assertObject(item, 'Visual series ' + (index + 1));
    rejectUnknown(item, SERIES_KEYS, 'visual series ' + (index + 1));
    const expectedId = semantic.series[index].id;
    if (item.id !== expectedId) {
      throw visualError(
        'Visual series ' + (index + 1) + ' must have ID ' + expectedId + '.',
        'INVALID_FIGURE_VISUAL_PROFILE'
      );
    }
    const lineWidth = integer(
      item.line_width_pixels,
      'Visual series ' + expectedId + ' line_width_pixels',
      0,
      16
    );
    const markerRadius = integer(
      item.marker_radius_pixels,
      'Visual series ' + expectedId + ' marker_radius_pixels',
      0,
      16
    );
    const drawsLine = ['line', 'line_scatter'].includes(semantic.chart_type);
    const drawsMarker = ['scatter', 'line_scatter'].includes(semantic.chart_type);
    if ((drawsLine && lineWidth < 1) || (!drawsLine && lineWidth !== 0) ||
        (drawsMarker && markerRadius < 1) || (!drawsMarker && markerRadius !== 0)) {
      throw visualError(
        'Visual series widths must match chart_type ' + semantic.chart_type + '.',
        'INVALID_FIGURE_VISUAL_PROFILE'
      );
    }
    return {
      id: expectedId,
      color: normalizeColor(item.color, 'Visual series ' + expectedId + ' color'),
      line_width_pixels: lineWidth,
      marker_radius_pixels: markerRadius
    };
  });
  const palette = [
    ['background_color', backgroundColor],
    ['axis_color', axisColor],
    ...series.map((item) => ['series ' + item.id, item.color])
  ];
  for (let left = 0; left < palette.length; left += 1) {
    for (let right = left + 1; right < palette.length; right += 1) {
      if (colorDistance(palette[left][1], palette[right][1]) <=
          colorTolerance * 2) {
        throw visualError(
          palette[left][0] + ' and ' + palette[right][0] +
            ' are not separable at the declared color tolerance.',
          'INVALID_FIGURE_VISUAL_PROFILE'
        );
      }
    }
  }
  const normalized = {
    schema_version: FIGURE_VISUAL_PROFILE_SCHEMA_VERSION,
    plot_area: plotArea,
    x_domain: xDomain,
    y_domain: yDomain,
    background_color: backgroundColor,
    axis_color: axisColor,
    axis_width_pixels: axisWidth,
    series,
    color_tolerance: colorTolerance,
    position_tolerance_pixels: positionTolerance,
    minimum_axis_coverage: fraction(
      value.minimum_axis_coverage,
      'minimum_axis_coverage',
      0.8,
      1
    ),
    minimum_series_coverage: fraction(
      value.minimum_series_coverage,
      'minimum_series_coverage',
      0.8,
      1
    ),
    maximum_unexpected_series_fraction: fraction(
      value.maximum_unexpected_series_fraction,
      'maximum_unexpected_series_fraction',
      0,
      0.1
    ),
    minimum_background_fraction: fraction(
      value.minimum_background_fraction,
      'minimum_background_fraction',
      0.8,
      1
    )
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_FIGURE_VISUAL_PROFILE_BYTES) {
    throw visualError(
      'Figure visual profile exceeds the bounded JSON size.',
      'FIGURE_VISUAL_PROFILE_TOO_LARGE'
    );
  }
  return normalized;
}

function decodedColor(decoded, pixel, background) {
  const offset = pixel * 4;
  const alpha = decoded.rgba[offset + 3];
  if (alpha === 255) {
    return [
      decoded.rgba[offset],
      decoded.rgba[offset + 1],
      decoded.rgba[offset + 2]
    ];
  }
  const inverse = 255 - alpha;
  return [
    Math.round((decoded.rgba[offset] * alpha + background.red * inverse) / 255),
    Math.round((decoded.rgba[offset + 1] * alpha + background.green * inverse) / 255),
    Math.round((decoded.rgba[offset + 2] * alpha + background.blue * inverse) / 255)
  ];
}

function matchesColor(color, expected, tolerance) {
  return Math.abs(color[0] - expected.red) <= tolerance &&
    Math.abs(color[1] - expected.green) <= tolerance &&
    Math.abs(color[2] - expected.blue) <= tolerance;
}

function plotColorMask(decoded, area, expected, tolerance, background) {
  const mask = new Uint8Array(area.width * area.height);
  let count = 0;
  for (let y = 0; y < area.height; y += 1) {
    const imageY = area.top + y;
    for (let x = 0; x < area.width; x += 1) {
      const pixel = imageY * decoded.width + area.left + x;
      if (matchesColor(decodedColor(decoded, pixel, background), expected, tolerance)) {
        mask[y * area.width + x] = 1;
        count += 1;
      }
    }
  }
  return { mask, count };
}

function integralMask(mask, width, height) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += mask[y * width + x];
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + row;
    }
  }
  return integral;
}

function integralCount(integral, width, height, x, y, radius) {
  const stride = width + 1;
  const left = Math.max(0, x - radius);
  const top = Math.max(0, y - radius);
  const right = Math.min(width - 1, x + radius);
  const bottom = Math.min(height - 1, y + radius);
  return integral[(bottom + 1) * stride + right + 1] -
    integral[top * stride + right + 1] -
    integral[(bottom + 1) * stride + left] +
    integral[top * stride + left];
}

function projectedPoint(point, seriesIndex, semantic, profile, area) {
  const xMinimum = transformed(profile.x_domain.minimum, semantic.x_axis.scale);
  const xMaximum = transformed(profile.x_domain.maximum, semantic.x_axis.scale);
  const yMinimum = transformed(profile.y_domain.minimum, semantic.y_axis.scale);
  const yMaximum = transformed(profile.y_domain.maximum, semantic.y_axis.scale);
  const x = transformed(point.x, semantic.x_axis.scale);
  const y = transformed(point.y[seriesIndex], semantic.y_axis.scale);
  return {
    x: Math.round((x - xMinimum) / (xMaximum - xMinimum) * (area.width - 1)),
    y: Math.round((1 - (y - yMinimum) / (yMaximum - yMinimum)) *
      (area.height - 1))
  };
}

function addSample(samples, x, y) {
  samples.push(x, y);
  if (samples.length / 2 > MAX_FIGURE_VISUAL_SAMPLES) {
    throw visualError(
      'Projected visual marks exceed the bounded sample count.',
      'FIGURE_VISUAL_SAMPLE_LIMIT'
    );
  }
}

function rasterLine(samples, from, to) {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx - dy;
  while (true) {
    addSample(samples, x, y);
    if (x === to.x && y === to.y) break;
    const twice = error * 2;
    if (twice > -dy) {
      error -= dy;
      x += stepX;
    }
    if (twice < dx) {
      error += dx;
      y += stepY;
    }
  }
}

function markRectangles(samples, width, height, radius) {
  if (!samples.length) return new Uint8Array(width * height);
  const stride = width + 1;
  const difference = new Int32Array(stride * (height + 1));
  for (let index = 0; index < samples.length; index += 2) {
    const x = samples[index];
    const y = samples[index + 1];
    const left = Math.max(0, x - radius);
    const top = Math.max(0, y - radius);
    const right = Math.min(width - 1, x + radius);
    const bottom = Math.min(height - 1, y + radius);
    difference[top * stride + left] += 1;
    difference[top * stride + right + 1] -= 1;
    difference[(bottom + 1) * stride + left] -= 1;
    difference[(bottom + 1) * stride + right + 1] += 1;
  }
  for (let y = 0; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      difference[y * stride + x] += difference[y * stride + x - 1];
    }
  }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = difference[y * stride + x] +
        (y ? difference[(y - 1) * stride + x] : 0);
      difference[y * stride + x] = value;
      if (value > 0) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function mergeMask(target, source) {
  for (let index = 0; index < target.length; index += 1) {
    if (source[index]) target[index] = 1;
  }
}

function sampleCoverage(samples, integral, width, height, radius) {
  const expected = samples.length / 2;
  let matched = 0;
  for (let index = 0; index < samples.length; index += 2) {
    if (integralCount(
      integral,
      width,
      height,
      samples[index],
      samples[index + 1],
      radius
    ) > 0) matched += 1;
  }
  return {
    expected_samples: expected,
    matched_samples: matched,
    coverage: expected ? matched / expected : 1
  };
}

const DISK_OFFSETS = new Map();

function diskOffsets(radius) {
  if (DISK_OFFSETS.has(radius)) return DISK_OFFSETS.get(radius);
  const offsets = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) offsets.push(x, y);
    }
  }
  DISK_OFFSETS.set(radius, offsets);
  return offsets;
}

function footprintSamples(samples, width, height, radius, budget) {
  const offsets = diskOffsets(radius);
  const operations = samples.length / 2 * (offsets.length / 2);
  budget.count += operations;
  if (budget.count > MAX_FIGURE_VISUAL_SAMPLES) {
    throw visualError(
      'Projected visual marks exceed the bounded total sample count.',
      'FIGURE_VISUAL_SAMPLE_LIMIT'
    );
  }
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < samples.length; index += 2) {
    const centerX = samples[index];
    const centerY = samples[index + 1];
    for (let offset = 0; offset < offsets.length; offset += 2) {
      const x = centerX + offsets[offset];
      const y = centerY + offsets[offset + 1];
      if (x >= 0 && y >= 0 && x < width && y < height) {
        mask[y * width + x] = 1;
      }
    }
  }
  let pixelCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) pixelCount += 1;
  }
  return { pixel_count: pixelCount };
}

function footprintSupport(matching, allowed, expectedPixels) {
  let supporting = 0;
  for (let index = 0; index < matching.mask.length; index += 1) {
    if (matching.mask[index] && allowed[index]) supporting += 1;
  }
  const matched = Math.min(supporting, expectedPixels);
  return {
    expected_pixels: expectedPixels,
    matched_pixels: matched,
    supporting_color_pixels: supporting,
    pixel_coverage: expectedPixels ? matched / expectedPixels : 1
  };
}

function reportCheck(name, pass, observed, threshold, comparison = 'minimum') {
  return {
    name,
    status: pass ? 'pass' : 'fail',
    observed,
    threshold,
    comparison
  };
}

export function analyzeFigureVisual({ figure, source, sourceName, contract, profile }) {
  if (!Buffer.isBuffer(figure) || !figure.length) {
    throw visualError('Figure visual analysis requires PNG bytes.');
  }
  let decoded;
  try {
    decoded = decodePng(figure);
  } catch (error) {
    throw visualError('Figure visual PNG is invalid: ' + error.message,
      error.code ?? 'INVALID_FIGURE_VISUAL');
  }
  if (decoded.pixel_count > MAX_FIGURE_VISUAL_PIXELS) {
    throw visualError(
      'Figure visual analysis is limited to ' + MAX_FIGURE_VISUAL_PIXELS +
        ' decoded pixels.',
      'FIGURE_VISUAL_PIXEL_LIMIT'
    );
  }
  const projected = projectFigureSemanticData({ source, sourceName, contract });
  const semantic = projected.contract;
  const normalized = normalizeFigureVisualProfile(profile, {
    contract: semantic,
    width: decoded.width,
    height: decoded.height,
    points: projected.points
  });
  const replay = replayFigureSemanticData({ source, sourceName, contract: semantic });
  const area = pixelPlotArea(normalized.plot_area, decoded.width, decoded.height);
  const checks = [];
  const foreground = new Uint8Array(area.width * area.height);

  const axisPixels = plotColorMask(
    decoded,
    area,
    normalized.axis_color,
    normalized.color_tolerance,
    normalized.background_color
  );
  const axisIntegral = integralMask(axisPixels.mask, area.width, area.height);
  const xAxisSamples = [];
  const yAxisSamples = [];
  for (let x = 0; x < area.width; x += 1) addSample(xAxisSamples, x, area.height - 1);
  for (let y = 0; y < area.height; y += 1) addSample(yAxisSamples, 0, y);
  const sampleBudget = {
    count: xAxisSamples.length / 2 + yAxisSamples.length / 2
  };
  const axisStrokeRadius = Math.floor(normalized.axis_width_pixels / 2);
  const axisRadius = normalized.position_tolerance_pixels + axisStrokeRadius;
  const xAxisPath = sampleCoverage(
    xAxisSamples,
    axisIntegral,
    area.width,
    area.height,
    axisRadius
  );
  const yAxisPath = sampleCoverage(
    yAxisSamples,
    axisIntegral,
    area.width,
    area.height,
    axisRadius
  );
  const xAxisFootprint = footprintSamples(
    xAxisSamples,
    area.width,
    area.height,
    axisStrokeRadius,
    sampleBudget
  );
  const yAxisFootprint = footprintSamples(
    yAxisSamples,
    area.width,
    area.height,
    axisStrokeRadius,
    sampleBudget
  );
  const xAxisAllowed = markRectangles(
    xAxisSamples,
    area.width,
    area.height,
    axisRadius
  );
  const yAxisAllowed = markRectangles(
    yAxisSamples,
    area.width,
    area.height,
    axisRadius
  );
  const xAxisSupport = footprintSupport(
    axisPixels,
    xAxisAllowed,
    xAxisFootprint.pixel_count
  );
  const yAxisSupport = footprintSupport(
    axisPixels,
    yAxisAllowed,
    yAxisFootprint.pixel_count
  );
  const xAxis = { ...xAxisPath, ...xAxisSupport };
  const yAxis = { ...yAxisPath, ...yAxisSupport };
  checks.push(reportCheck(
    'horizontal_axis_stroke',
    xAxis.coverage >= normalized.minimum_axis_coverage,
    xAxis.coverage,
    normalized.minimum_axis_coverage
  ));
  checks.push(reportCheck(
    'horizontal_axis_pixel_support',
    xAxis.pixel_coverage >= normalized.minimum_axis_coverage,
    xAxis.pixel_coverage,
    normalized.minimum_axis_coverage
  ));
  checks.push(reportCheck(
    'vertical_axis_stroke',
    yAxis.coverage >= normalized.minimum_axis_coverage,
    yAxis.coverage,
    normalized.minimum_axis_coverage
  ));
  checks.push(reportCheck(
    'vertical_axis_pixel_support',
    yAxis.pixel_coverage >= normalized.minimum_axis_coverage,
    yAxis.pixel_coverage,
    normalized.minimum_axis_coverage
  ));
  mergeMask(foreground, markRectangles(
    [...xAxisSamples, ...yAxisSamples],
    area.width,
    area.height,
    axisRadius
  ));

  const seriesReports = [];
  let expectedMarkSamples = 0;
  let matchedMarkSamples = 0;
  let actualSeriesPixels = 0;
  let unexpectedSeriesPixels = 0;
  for (let seriesIndex = 0; seriesIndex < normalized.series.length; seriesIndex += 1) {
    const style = normalized.series[seriesIndex];
    const coordinates = projected.points.map((point) =>
      projectedPoint(point, seriesIndex, semantic, normalized, area));
    const lineSamples = [];
    const markerSamples = [];
    if (['line', 'line_scatter'].includes(semantic.chart_type)) {
      if (coordinates.length === 1) {
        addSample(lineSamples, coordinates[0].x, coordinates[0].y);
      } else {
        for (let index = 1; index < coordinates.length; index += 1) {
          rasterLine(lineSamples, coordinates[index - 1], coordinates[index]);
        }
      }
    }
    if (['scatter', 'line_scatter'].includes(semantic.chart_type)) {
      for (const point of coordinates) addSample(markerSamples, point.x, point.y);
    }
    sampleBudget.count += lineSamples.length / 2 + markerSamples.length / 2;
    if (sampleBudget.count > MAX_FIGURE_VISUAL_SAMPLES) {
      throw visualError(
        'Projected visual marks exceed the bounded total sample count.',
        'FIGURE_VISUAL_SAMPLE_LIMIT'
      );
    }
    const matching = plotColorMask(
      decoded,
      area,
      style.color,
      normalized.color_tolerance,
      normalized.background_color
    );
    const integral = integralMask(matching.mask, area.width, area.height);
    const lineStrokeRadius = Math.floor(style.line_width_pixels / 2);
    const lineRadius = normalized.position_tolerance_pixels + lineStrokeRadius;
    const markerRadius = normalized.position_tolerance_pixels +
      style.marker_radius_pixels;
    const linePath = sampleCoverage(
      lineSamples,
      integral,
      area.width,
      area.height,
      lineRadius
    );
    const markerCenters = sampleCoverage(
      markerSamples,
      integral,
      area.width,
      area.height,
      markerRadius
    );
    const lineFootprint = footprintSamples(
      lineSamples,
      area.width,
      area.height,
      lineStrokeRadius,
      sampleBudget
    );
    const markerFootprint = footprintSamples(
      markerSamples,
      area.width,
      area.height,
      style.marker_radius_pixels,
      sampleBudget
    );
    const lineAllowed = markRectangles(
      lineSamples,
      area.width,
      area.height,
      lineRadius
    );
    const markerAllowed = markRectangles(
      markerSamples,
      area.width,
      area.height,
      markerRadius
    );
    const lineSupport = footprintSupport(
      matching,
      lineAllowed,
      lineFootprint.pixel_count
    );
    const markerSupport = footprintSupport(
      matching,
      markerAllowed,
      markerFootprint.pixel_count
    );
    const line = { ...linePath, ...lineSupport };
    const markers = { ...markerCenters, ...markerSupport };
    mergeMask(lineAllowed, markerAllowed);
    mergeMask(foreground, lineAllowed);
    let unexpected = 0;
    for (let index = 0; index < matching.mask.length; index += 1) {
      if (matching.mask[index] && !lineAllowed[index]) unexpected += 1;
    }
    const unexpectedFraction = matching.count ? unexpected / matching.count : 0;
    const drawsLine = line.expected_samples > 0;
    const drawsMarkers = markers.expected_samples > 0;
    if (drawsLine) {
      checks.push(reportCheck(
        'series_' + style.id + '_line_coverage',
        line.coverage >= normalized.minimum_series_coverage,
        line.coverage,
        normalized.minimum_series_coverage
      ));
      checks.push(reportCheck(
        'series_' + style.id + '_line_pixel_support',
        line.pixel_coverage >= normalized.minimum_series_coverage,
        line.pixel_coverage,
        normalized.minimum_series_coverage
      ));
    }
    if (drawsMarkers) {
      checks.push(reportCheck(
        'series_' + style.id + '_marker_coverage',
        markers.coverage >= normalized.minimum_series_coverage,
        markers.coverage,
        normalized.minimum_series_coverage
      ));
      checks.push(reportCheck(
        'series_' + style.id + '_marker_pixel_support',
        markers.pixel_coverage >= normalized.minimum_series_coverage,
        markers.pixel_coverage,
        normalized.minimum_series_coverage
      ));
    }
    checks.push(reportCheck(
      'series_' + style.id + '_unexpected_pixels',
      unexpectedFraction <= normalized.maximum_unexpected_series_fraction,
      unexpectedFraction,
      normalized.maximum_unexpected_series_fraction,
      'maximum'
    ));
    expectedMarkSamples += line.expected_pixels + markers.expected_pixels;
    matchedMarkSamples += line.matched_pixels + markers.matched_pixels;
    actualSeriesPixels += matching.count;
    unexpectedSeriesPixels += unexpected;
    seriesReports.push({
      id: style.id,
      color: style.color,
      line,
      markers,
      actual_color_pixels: matching.count,
      unexpected_color_pixels: unexpected,
      unexpected_color_fraction: unexpectedFraction
    });
  }

  let eligibleBackground = 0;
  let matchingBackground = 0;
  for (let y = 0; y < area.height; y += 1) {
    const imageY = area.top + y;
    for (let x = 0; x < area.width; x += 1) {
      const relative = y * area.width + x;
      if (foreground[relative]) continue;
      eligibleBackground += 1;
      const pixel = imageY * decoded.width + area.left + x;
      if (matchesColor(
        decodedColor(decoded, pixel, normalized.background_color),
        normalized.background_color,
        normalized.color_tolerance
      )) matchingBackground += 1;
    }
  }
  const backgroundFraction = eligibleBackground
    ? matchingBackground / eligibleBackground
    : 0;
  checks.push(reportCheck(
    'plot_background',
    backgroundFraction >= normalized.minimum_background_fraction,
    backgroundFraction,
    normalized.minimum_background_fraction
  ));
  const pass = checks.every((item) => item.status === 'pass');
  return {
    schema_version: FIGURE_VISUAL_REPORT_SCHEMA_VERSION,
    engine: FIGURE_VISUAL_ENGINE,
    engine_version: FIGURE_VISUAL_ENGINE_VERSION,
    status: pass ? 'pass' : 'fail',
    visual_status: pass ? 'conforming' : 'nonconforming',
    profile: normalized,
    profile_sha256: sha256Json(normalized),
    figure: {
      sha256: sha256Buffer(figure),
      width: decoded.width,
      height: decoded.height,
      pixel_count: decoded.pixel_count,
      plot_area_pixels: area
    },
    semantic: {
      contract_sha256: sha256Json(semantic),
      replay_sha256: sha256Json(replay),
      plotted_data_sha256: replay.plotted_data_sha256,
      plotted_points: replay.plotted_point_count,
      series: replay.series.length,
      chart_type: semantic.chart_type,
      x_scale: semantic.x_axis.scale,
      y_scale: semantic.y_axis.scale
    },
    axes: {
      actual_color_pixels: axisPixels.count,
      horizontal: xAxis,
      vertical: yAxis
    },
    background: {
      eligible_pixels: eligibleBackground,
      matching_pixels: matchingBackground,
      matching_fraction: backgroundFraction
    },
    series: seriesReports,
    checks,
    summary: {
      passed_checks: checks.filter((item) => item.status === 'pass').length,
      failed_checks: checks.filter((item) => item.status === 'fail').length,
      plotted_points: replay.plotted_point_count,
      series: replay.series.length,
      expected_mark_samples: expectedMarkSamples,
      matched_mark_samples: matchedMarkSamples,
      actual_series_pixels: actualSeriesPixels,
      unexpected_series_pixels: unexpectedSeriesPixels
    },
    interpretation: pass
      ? 'Decoded pixels contain the declared axis strokes and projected flat-color marks within the frozen acceptance rules.'
      : 'Decoded pixels do not satisfy one or more frozen axis, mark, unexpected-pixel, or background rules.',
    limitations: FIGURE_VISUAL_LIMITATION
  };
}

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function makeFigureVisualId(now = new Date()) {
  return 'figure-visual-' + stamp(now) + '-' +
    crypto.randomBytes(4).toString('hex');
}

function normalizeVisualId(value) {
  const id = String(value ?? '');
  if (!VISUAL_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw visualError('Invalid figure visual ID: ' + id, 'INVALID_FIGURE_VISUAL_ID');
  }
  return id;
}

function normalizeRegistrationId(value) {
  const id = String(value ?? '');
  if (!REGISTRATION_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw visualError(
      'Invalid semantic figure registration ID: ' + id,
      'INVALID_FIGURE_REGISTRATION_ID'
    );
  }
  return id;
}

function validateOptionalChat(cwd, value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const chatId = String(value);
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw visualError('Invalid chat ID: ' + chatId, 'INVALID_CHAT_ID');
  }
  getChatManifest(cwd, chatId);
  return chatId;
}

export function normalizeFigureVisualSpec(value) {
  assertObject(value, 'Figure visual spec', 'INVALID_FIGURE_VISUAL');
  rejectUnknown(value, SPEC_KEYS, 'figure visual spec', 'INVALID_FIGURE_VISUAL');
  const specEncoded = JSON.stringify(value);
  if (Buffer.byteLength(specEncoded) > MAX_FIGURE_VISUAL_SPEC_BYTES) {
    throw visualError(
      'Figure visual spec exceeds the bounded JSON size.',
      'FIGURE_VISUAL_SPEC_TOO_LARGE'
    );
  }
  if (value.schema_version !== FIGURE_VISUAL_SCHEMA_VERSION) {
    throw visualError(
      'Figure visual spec schema_version must be ' + FIGURE_VISUAL_SCHEMA_VERSION + '.',
      'UNSUPPORTED_FIGURE_VISUAL_VERSION'
    );
  }
  const registrationId = normalizeRegistrationId(value.figure_registration_id);
  assertObject(value.profile, 'Figure visual profile');
  rejectUnknown(value.profile, PROFILE_KEYS, 'figure visual profile');
  const encoded = JSON.stringify(value.profile);
  if (Buffer.byteLength(encoded) > MAX_FIGURE_VISUAL_PROFILE_BYTES) {
    throw visualError(
      'Figure visual profile exceeds the bounded JSON size.',
      'FIGURE_VISUAL_PROFILE_TOO_LARGE'
    );
  }
  const findings = scanSecrets(encoded);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in figure visual profile; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return {
    schema_version: FIGURE_VISUAL_SCHEMA_VERSION,
    name: boundedText(value.name, 'Figure visual name', 240, { optional: true }),
    note: boundedText(value.note, 'Figure visual note', 2_000, { optional: true }),
    figure_registration_id: registrationId,
    profile: JSON.parse(encoded)
  };
}

function visualsRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  const metadata = path.join(project, INTERNAL_DIR);
  const metadataStat = fs.lstatSync(metadata, { throwIfNoEntry: false });
  if (metadataStat && (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() ||
      !isPathInside(fs.realpathSync(project), fs.realpathSync(metadata)))) {
    throw visualError(
      'Figure visual metadata root must be a real project directory.',
      'INVALID_FIGURE_VISUAL_PATH'
    );
  }
  const root = path.join(metadata, 'figure-visuals');
  const existing = fs.lstatSync(root, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    throw visualError(
      'Figure visual storage must be a real project directory.',
      'INVALID_FIGURE_VISUAL_PATH'
    );
  }
  if (create) ensureScienceDir(project);
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw visualError(
      'Figure visual storage must be a real project directory.',
      'INVALID_FIGURE_VISUAL_PATH'
    );
  }
  if (stat) {
    const science = fs.realpathSync(path.join(project, INTERNAL_DIR));
    const real = fs.realpathSync(root);
    if (!isPathInside(science, real)) {
      throw visualError(
        'Figure visual storage escapes the project.',
        'INVALID_FIGURE_VISUAL_PATH'
      );
    }
  }
  return root;
}

export function resolveFigureVisualDirectory(cwd, value) {
  return path.join(visualsRoot(cwd), normalizeVisualId(value));
}

function visualFiles(cwd, value) {
  const visualId = normalizeVisualId(value);
  const directory = resolveFigureVisualDirectory(cwd, visualId);
  return {
    visual_id: visualId,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    report: path.join(directory, 'report.json')
  };
}

function safeVisualDirectory(cwd, value) {
  const root = visualsRoot(cwd);
  const files = visualFiles(cwd, value);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw visualError(
      'Figure visual record not found: ' + files.visual_id,
      'FIGURE_VISUAL_NOT_FOUND'
    );
  }
  const rootReal = fs.realpathSync(root);
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(rootReal, directoryReal)) {
    throw visualError(
      'Figure visual record escapes its storage root.',
      'INVALID_FIGURE_VISUAL_PATH'
    );
  }
  for (const file of [files.manifest, files.digest, files.report]) {
    const fileStat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!fileStat?.isFile() || fileStat.isSymbolicLink() ||
        !isPathInside(directoryReal, fs.realpathSync(file))) {
      throw visualError(
        'Figure visual file is missing or unsafe: ' + path.basename(file),
        'FIGURE_VISUAL_INVALID'
      );
    }
    const limit = FILE_LIMITS.get(path.basename(file));
    if (Number.isFinite(limit) && fileStat.size > limit) {
      throw visualError(
        'Figure visual file exceeds its safe read limit: ' + path.basename(file),
        'FIGURE_VISUAL_FILE_TOO_LARGE'
      );
    }
  }
  return { ...files, directory: directoryReal };
}

function safeRemoveStaging(root, staging) {
  if (!isPathInside(root, staging) ||
      path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith('.staging-figure-visual-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function visualDirectories(cwd) {
  const root = visualsRoot(cwd);
  const ids = new Set();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && VISUAL_ID_PATTERN.test(entry.name)) ids.add(entry.name);
      if (ids.size > MAX_FIGURE_VISUALS) {
        throw visualError(
          'Figure visual registry exceeds the bounded record count.',
          'FIGURE_VISUAL_LIMIT'
        );
      }
    }
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'figure_visual.created' &&
          VISUAL_ID_PATTERN.test(String(record.figure_visual_id ?? ''))) {
        ids.add(record.figure_visual_id);
        if (ids.size > MAX_FIGURE_VISUALS) {
          throw visualError(
            'Figure visual registry exceeds the bounded record count.',
            'FIGURE_VISUAL_LIMIT'
          );
        }
      }
    }
  } catch (error) {
    if (error?.code === 'FIGURE_VISUAL_LIMIT') throw error;
    // Whole-project verification reports malformed audit records.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

function parentArtifacts(cwd, registration) {
  const sourceName = registration.manifest.artifacts?.['source.tsv']
    ? 'source.tsv' : 'source.csv';
  const figureArtifact = resolveFigureRegistrationArtifact(
    cwd,
    registration.figure_registration_id,
    'figure.png'
  );
  const sourceArtifact = resolveFigureRegistrationArtifact(
    cwd,
    registration.figure_registration_id,
    sourceName
  );
  return {
    figure: fs.readFileSync(figureArtifact.file),
    source: fs.readFileSync(sourceArtifact.file),
    source_name: registration.manifest.source?.name ?? sourceName,
    source_artifact_name: sourceName
  };
}

function requireMatchedRegistration(cwd, value) {
  const registrationId = normalizeRegistrationId(value);
  let registration;
  try {
    registration = getFigureRegistration(cwd, registrationId);
  } catch (error) {
    throw visualError(
      'Semantic figure registration could not be loaded: ' + error.message,
      'FIGURE_VISUAL_PARENT_INVALID'
    );
  }
  if (!registration.verification.ok) {
    throw Object.assign(
      new Error('Semantic figure registration failed integrity verification.'),
      { code: 'FIGURE_VISUAL_PARENT_INVALID', verification: registration.verification }
    );
  }
  if (registration.report.status !== 'pass' ||
      registration.report.registration_status !== 'matched') {
    throw visualError(
      'Visual validation requires a matched semantic figure registration.',
      'FIGURE_VISUAL_PARENT_MISMATCH'
    );
  }
  return registration;
}

function parentBinding(registration) {
  const sourceName = registration.manifest.artifacts?.['source.tsv']
    ? 'source.tsv' : 'source.csv';
  return {
    figure_registration_id: registration.figure_registration_id,
    manifest_sha256: registration.verification.manifest_sha256,
    report_sha256: registration.verification.report_sha256,
    figure_sha256: registration.manifest.artifacts?.['figure.png']?.sha256 ?? null,
    source_sha256: registration.manifest.artifacts?.[sourceName]?.sha256 ?? null,
    contract_sha256: registration.manifest.contract_sha256,
    replay_sha256: registration.report.expected?.replay_sha256 ?? null
  };
}

function artifactDescriptor(file, relative) {
  return {
    file: relative,
    sha256: sha256File(file),
    bytes: fs.statSync(file).size,
    media_type: 'application/json; charset=utf-8'
  };
}

export function createFigureVisual({
  cwd,
  chatId,
  figureRegistrationId,
  profile,
  name,
  note,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw visualError('Figure visual timestamp is invalid.');
  }
  const normalizedChatId = validateOptionalChat(project, chatId);
  const normalizedName = boundedText(name, 'Figure visual name', 240, { optional: true });
  const normalizedNote = boundedText(note, 'Figure visual note', 2_000, { optional: true });
  const registration = requireMatchedRegistration(project, figureRegistrationId);
  const inputs = parentArtifacts(project, registration);
  const report = analyzeFigureVisual({
    figure: inputs.figure,
    source: inputs.source,
    sourceName: inputs.source_name,
    contract: registration.manifest.contract,
    profile
  });
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_FIGURE_VISUAL_REPORT_BYTES) {
    throw visualError(
      'Figure visual report exceeds the bounded record size.',
      'FIGURE_VISUAL_REPORT_TOO_LARGE'
    );
  }
  const root = visualsRoot(project, { create: true });
  if (visualDirectories(project).length >= MAX_FIGURE_VISUALS) {
    throw visualError(
      'Figure visual record limit reached for this project.',
      'FIGURE_VISUAL_LIMIT'
    );
  }
  const visualId = makeFigureVisualId(now);
  const finalDirectory = path.join(root, visualId);
  if (fs.existsSync(finalDirectory)) {
    throw visualError(
      'Figure visual record already exists: ' + visualId,
      'FIGURE_VISUAL_EXISTS'
    );
  }
  const staging = path.join(
    root,
    '.staging-figure-visual-' + crypto.randomBytes(8).toString('hex')
  );
  fs.mkdirSync(staging, { mode: 0o700 });
  let manifest;
  try {
    const reportFile = path.join(staging, 'report.json');
    writeJsonExclusive(reportFile, report);
    manifest = {
      schema_version: FIGURE_VISUAL_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      figure_visual_id: visualId,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      name: normalizedName,
      note: normalizedNote,
      status: report.status,
      visual_status: report.visual_status,
      figure_registration: parentBinding(registration),
      profile: report.profile,
      profile_sha256: report.profile_sha256,
      engine: {
        name: FIGURE_VISUAL_ENGINE,
        version: FIGURE_VISUAL_ENGINE_VERSION
      },
      summary: report.summary,
      artifacts: {
        'report.json': artifactDescriptor(reportFile, 'report.json')
      },
      preservation_policy:
        'immutable parent binding, visual profile, pixel-analysis report, hashes, and audit link',
      limitations: FIGURE_VISUAL_LIMITATION
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
  const files = visualFiles(project, visualId);
  const manifestSha256 = sha256File(files.manifest);
  appendAudit(project, {
    type: 'figure_visual.created',
    figure_visual_id: visualId,
    chat_id: normalizedChatId,
    status: report.status,
    visual_status: report.visual_status,
    figure_registration_id: registration.figure_registration_id,
    parent_manifest_sha256: registration.verification.manifest_sha256,
    figure_sha256: report.figure.sha256,
    profile_sha256: report.profile_sha256,
    replay_sha256: report.semantic.replay_sha256,
    report_sha256: manifest.artifacts['report.json'].sha256,
    manifest_sha256: manifestSha256
  });
  return getFigureVisual(project, visualId);
}

export function getFigureVisualManifest(cwd, value) {
  return readJson(safeVisualDirectory(cwd, value).manifest);
}

export function getFigureVisualReport(cwd, value) {
  return readJson(safeVisualDirectory(cwd, value).report);
}

function compareParentBinding(expected, registration, errors) {
  const actual = parentBinding(registration);
  for (const key of Object.keys(actual)) {
    if ((expected?.[key] ?? null) !== (actual[key] ?? null)) {
      errors.push({
        file: 'manifest.json',
        issue: 'parent_' + key + '_mismatch',
        expected: expected?.[key] ?? null,
        actual: actual[key] ?? null
      });
    }
  }
}

export function verifyFigureVisual(cwd, value) {
  const project = path.resolve(cwd);
  const visualId = String(value ?? '');
  const errors = [];
  let files;
  let manifest;
  let report;
  try {
    files = safeVisualDirectory(project, visualId);
    manifest = readJson(files.manifest);
    report = readJson(files.report);
  } catch (error) {
    return {
      ok: false,
      figure_visual_id: visualId,
      errors: [{
        issue: error.code ?? 'figure_visual_error',
        detail: error.message
      }]
    };
  }
  const manifestSha256 = sha256File(files.manifest);
  const expectedManifestSha256 = fs.readFileSync(files.digest, 'utf8').trim();
  if (!plainObject(manifest) || !plainObject(report)) {
    return {
      ok: false,
      figure_visual_id: visualId,
      manifest,
      report,
      manifest_sha256: manifestSha256,
      report_sha256: null,
      errors: [{
        issue: 'invalid_record_structure',
        detail: 'Figure visual manifest and report must both be JSON objects.'
      }]
    };
  }
  if (manifest.schema_version !== FIGURE_VISUAL_SCHEMA_VERSION) {
    errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
  }
  if (manifest.figure_visual_id !== visualId) {
    errors.push({ file: 'manifest.json', issue: 'figure_visual_id_mismatch' });
  }
  if (manifestSha256 !== expectedManifestSha256) {
    errors.push({
      file: 'manifest.json',
      issue: 'hash_mismatch',
      expected: expectedManifestSha256,
      actual: manifestSha256
    });
  }
  const artifactNames = Object.keys(manifest.artifacts ?? {});
  if (artifactNames.length !== 1 || artifactNames[0] !== 'report.json') {
    errors.push({ file: 'manifest.json', issue: 'invalid_artifact_set' });
  }
  const descriptor = manifest.artifacts?.['report.json'];
  if (!descriptor || descriptor.file !== 'report.json' ||
      !FIXED_ARTIFACTS.has(descriptor.file)) {
    errors.push({ file: 'manifest.json', issue: 'invalid_report_artifact' });
  } else {
    const stat = fs.statSync(files.report);
    const actualSha256 = sha256File(files.report);
    if (descriptor.sha256 !== actualSha256) {
      errors.push({ file: 'report.json', issue: 'hash_mismatch' });
    }
    if (descriptor.bytes !== stat.size) {
      errors.push({ file: 'report.json', issue: 'byte_count_mismatch' });
    }
  }
  let registration = null;
  try {
    registration = requireMatchedRegistration(
      project,
      manifest.figure_registration?.figure_registration_id
    );
    compareParentBinding(manifest.figure_registration, registration, errors);
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'parent_registration_invalid',
      detail: error.message,
      code: error.code ?? null
    });
  }
  let recomputed = null;
  try {
    if (!registration) throw new Error('semantic figure registration is unavailable');
    const inputs = parentArtifacts(project, registration);
    recomputed = analyzeFigureVisual({
      figure: inputs.figure,
      source: inputs.source,
      sourceName: inputs.source_name,
      contract: registration.manifest.contract,
      profile: manifest.profile
    });
    if (sha256Json(recomputed) !== sha256Json(report)) {
      errors.push({ file: 'report.json', issue: 'deterministic_recalculation_mismatch' });
    }
  } catch (error) {
    errors.push({
      file: 'report.json',
      issue: 'visual_recalculation_failed',
      detail: error.message,
      code: error.code ?? null
    });
  }
  const profileHashMatches = plainObject(manifest.profile) &&
    manifest.profile_sha256 === sha256Json(manifest.profile) &&
    report.profile_sha256 === manifest.profile_sha256;
  if (report.schema_version !== FIGURE_VISUAL_REPORT_SCHEMA_VERSION ||
      report.engine !== FIGURE_VISUAL_ENGINE ||
      report.engine_version !== FIGURE_VISUAL_ENGINE_VERSION ||
      manifest.engine?.name !== FIGURE_VISUAL_ENGINE ||
      manifest.engine?.version !== FIGURE_VISUAL_ENGINE_VERSION ||
      !profileHashMatches) {
    errors.push({ file: 'report.json', issue: 'visual_settings_mismatch' });
  }
  const summaryMatches = plainObject(manifest.summary) &&
    plainObject(report.summary) &&
    sha256Json(manifest.summary) === sha256Json(report.summary);
  if (manifest.status !== report.status ||
      manifest.visual_status !== report.visual_status ||
      !summaryMatches ||
      manifest.limitations !== FIGURE_VISUAL_LIMITATION ||
      report.limitations !== FIGURE_VISUAL_LIMITATION) {
    errors.push({ file: 'manifest.json', issue: 'report_summary_mismatch' });
  }
  try {
    validateOptionalChat(project, manifest.chat_id);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'visual_chat_invalid', detail: error.message });
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const event = readAuditRecords(project).findLast((record) =>
      record.type === 'figure_visual.created' &&
      record.figure_visual_id === visualId
    );
    if (!event) {
      errors.push({ issue: 'missing_figure_visual_audit_event' });
    } else {
      if (event.manifest_sha256 !== manifestSha256) {
        errors.push({ issue: 'audit_manifest_mismatch' });
      }
      if (event.report_sha256 !== descriptor?.sha256) {
        errors.push({ issue: 'audit_report_mismatch' });
      }
      if (event.figure_registration_id !==
          manifest.figure_registration?.figure_registration_id ||
          event.parent_manifest_sha256 !==
            manifest.figure_registration?.manifest_sha256) {
        errors.push({ issue: 'audit_parent_mismatch' });
      }
      if (event.figure_sha256 !== report.figure?.sha256 ||
          event.profile_sha256 !== manifest.profile_sha256 ||
          event.replay_sha256 !== report.semantic?.replay_sha256) {
        errors.push({ issue: 'audit_visual_binding_mismatch' });
      }
      if (event.status !== manifest.status ||
          event.visual_status !== manifest.visual_status) {
        errors.push({ issue: 'audit_status_mismatch' });
      }
    }
  }
  return {
    ok: errors.length === 0,
    figure_visual_id: visualId,
    manifest,
    report,
    manifest_sha256: manifestSha256,
    report_sha256: descriptor?.sha256 ?? null,
    errors
  };
}

function visualSummary(cwd, visualId) {
  try {
    const verification = verifyFigureVisual(cwd, visualId);
    if (!verification.manifest || !verification.report) {
      throw new Error('Figure visual record is unreadable.');
    }
    const manifest = verification.manifest;
    return {
      figure_visual_id: visualId,
      created_at: manifest.created_at,
      chat_id: manifest.chat_id,
      name: manifest.name,
      note: manifest.note,
      status: manifest.status,
      visual_status: manifest.visual_status,
      verified: verification.ok,
      verification_errors: verification.errors,
      figure_registration_id: manifest.figure_registration?.figure_registration_id ?? null,
      figure_sha256: manifest.figure_registration?.figure_sha256 ?? null,
      profile_sha256: manifest.profile_sha256,
      summary: manifest.summary,
      manifest_sha256: verification.manifest_sha256,
      report_sha256: verification.report_sha256,
      url: '/api/figure-visuals/' + encodeURIComponent(visualId)
    };
  } catch (error) {
    return {
      figure_visual_id: visualId,
      status: 'invalid',
      visual_status: 'invalid',
      verified: false,
      verification_errors: [{
        issue: error.code ?? 'figure_visual_error',
        detail: error.message
      }],
      summary: {},
      url: '/api/figure-visuals/' + encodeURIComponent(visualId)
    };
  }
}

export function listFigureVisuals(cwd, {
  chatId,
  figureRegistrationId,
  status
} = {}) {
  return visualDirectories(cwd)
    .map((visualId) => visualSummary(cwd, visualId))
    .sort((left, right) =>
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) ||
      String(right.figure_visual_id).localeCompare(String(left.figure_visual_id))
    )
    .filter((record) => !chatId || record.chat_id === chatId)
    .filter((record) => !figureRegistrationId ||
      record.figure_registration_id === figureRegistrationId)
    .filter((record) => !status || record.status === status);
}

export function getFigureVisual(cwd, value) {
  const visualId = normalizeVisualId(value);
  const verification = verifyFigureVisual(cwd, visualId);
  if (!verification.manifest || !verification.report) {
    throw visualError(
      'Figure visual record not found: ' + visualId,
      'FIGURE_VISUAL_NOT_FOUND'
    );
  }
  const descriptor = plainObject(verification.manifest.artifacts)
    ? verification.manifest.artifacts['report.json']
    : null;
  return {
    figure_visual_id: visualId,
    manifest: verification.manifest,
    report: verification.report,
    artifacts: descriptor ? {
      'report.json': {
        ...descriptor,
        url: '/figure-visual-artifact/' + encodeURIComponent(visualId) +
          '/report.json'
      }
    } : {},
    verification
  };
}

export function resolveFigureVisualArtifact(cwd, value, name) {
  const visualId = normalizeVisualId(value);
  const artifactName = String(name ?? '');
  if (!FIXED_ARTIFACTS.has(artifactName)) {
    throw visualError(
      'Figure visual artifact not found: ' + artifactName,
      'FIGURE_VISUAL_ARTIFACT_NOT_FOUND'
    );
  }
  const verification = verifyFigureVisual(cwd, visualId);
  if (!verification.ok) {
    throw Object.assign(
      new Error('Figure visual record failed integrity verification.'),
      { code: 'FIGURE_VISUAL_INVALID', verification }
    );
  }
  const directory = safeVisualDirectory(cwd, visualId).directory;
  const descriptor = verification.manifest.artifacts[artifactName];
  return {
    file: resolveInsideRoot(directory, descriptor.file),
    descriptor,
    verification
  };
}

export function figureVisualInteractionArtifact(visual) {
  const manifest = visual?.manifest ?? visual;
  return {
    kind: 'figure-visual',
    record_id: manifest.figure_visual_id,
    name: manifest.name ?? manifest.figure_visual_id,
    url: '/api/figure-visuals/' + encodeURIComponent(manifest.figure_visual_id)
  };
}

export function figureVisualInteractionPayload(visual) {
  const manifest = visual?.manifest ?? visual;
  const report = visual?.report ?? {};
  return {
    figure_visual_id: manifest.figure_visual_id,
    record_file: '.sciencecode/figure-visuals/' +
      manifest.figure_visual_id + '/manifest.json',
    status: report.status ?? manifest.status,
    visual_status: report.visual_status ?? manifest.visual_status,
    figure_registration_id:
      manifest.figure_registration?.figure_registration_id ?? null,
    figure_sha256: report.figure?.sha256 ??
      manifest.figure_registration?.figure_sha256 ?? null,
    profile_sha256: report.profile_sha256 ?? manifest.profile_sha256,
    replay_sha256: report.semantic?.replay_sha256 ?? null,
    checks: report.checks ?? null,
    summary: report.summary ?? manifest.summary,
    interpretation: report.interpretation ?? null,
    limitations: FIGURE_VISUAL_LIMITATION
  };
}
