import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import { sha256File, sha256Json } from './hash.js';
import {
  decodePng,
  encodeRgbaPng,
  MAX_PNG_BYTES,
  MAX_PNG_DIMENSION,
  MAX_PNG_PIXELS
} from './png.js';
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

export const FIGURE_COMPARISON_SCHEMA_VERSION = 2;
export const FIGURE_COMPARISON_REPORT_SCHEMA_VERSION = 2;
export const FIGURE_COMPARISON_ENGINE_VERSION = 2;
export const MAX_FIGURE_COMPARISONS = 10_000;
export const MAX_FIGURE_COMPARISON_REPORT_BYTES = 4 * 1024 * 1024;
export const MAX_FIGURE_COMPARISON_MANIFEST_BYTES = 1024 * 1024;

const SUPPORTED_FIGURE_COMPARISON_VERSIONS = new Set([1, 2]);
const STRUCTURAL_SIMILARITY_BLOCK_SIZE = 8;
const STRUCTURAL_SIMILARITY_DECIMAL_PLACES = 12;
const STRUCTURAL_SIMILARITY_C1 = 0.01 ** 2;
const STRUCTURAL_SIMILARITY_C2 = 0.03 ** 2;
const LINEAR_SRGB = Float64Array.from({ length: 256 }, (_, value) => {
  const encoded = value / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
});

const COMPARISON_ID_PATTERN =
  /^figure-comparison-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FIXED_ARTIFACT_FILES = new Set([
  'baseline.png',
  'candidate.png',
  'pixel-difference.png',
  'report.json'
]);
const FIGURE_FILE_LIMITS = new Map([
  ['manifest.json', MAX_FIGURE_COMPARISON_MANIFEST_BYTES],
  ['manifest.sha256', 256],
  ['report.json', MAX_FIGURE_COMPARISON_REPORT_BYTES],
  ['baseline.png', MAX_PNG_BYTES],
  ['candidate.png', MAX_PNG_BYTES],
  ['pixel-difference.png', MAX_PNG_BYTES]
]);

function figureError(message, code = 'INVALID_FIGURE_COMPARISON') {
  return Object.assign(new Error(message), { code });
}

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function makeFigureComparisonId(now = new Date()) {
  return 'figure-comparison-' + stamp(now) + '-' +
    crypto.randomBytes(4).toString('hex');
}

function normalizeComparisonId(value) {
  const id = String(value ?? '');
  if (!COMPARISON_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw figureError('Invalid figure comparison ID: ' + id, 'INVALID_FIGURE_COMPARISON_ID');
  }
  return id;
}

function boundedText(value, name, maximum, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw figureError(name + ' is required.');
    return null;
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length > maximum) {
    throw figureError(name + ' must be ' + maximum + ' characters or fewer.');
  }
  const findings = scanSecrets(text);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in ' + name + '; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return text;
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

function normalizedInteger(value, name, minimum, maximum, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw figureError(
      name + ' must be an integer from ' + minimum + ' through ' + maximum + '.'
    );
  }
  return number;
}

function normalizedFraction(value, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw figureError(name + ' must be a finite number from 0 through 1.');
  }
  return number;
}

function normalizedOptionalFraction(value, name) {
  if (value === undefined || value === null ||
      (typeof value === 'string' && value.trim() === '')) return null;
  return normalizedFraction(value, name, null);
}

function normalizedEngineVersion(value) {
  const version = Number(value ?? FIGURE_COMPARISON_ENGINE_VERSION);
  if (!Number.isInteger(version) ||
      !SUPPORTED_FIGURE_COMPARISON_VERSIONS.has(version)) {
    throw figureError(
      'Unsupported figure comparison engine version: ' + String(value),
      'UNSUPPORTED_FIGURE_COMPARISON_VERSION'
    );
  }
  return version;
}

export function normalizeFigureComparisonSettings({
  pixelTolerance,
  maximumChangedFraction,
  minimumStructuralSimilarity,
  engineVersion
} = {}) {
  const version = normalizedEngineVersion(engineVersion);
  const common = {
    engine: 'sciencecode-bounded-png-pixel-comparison',
    engine_version: version,
    decode_space: 'non-interlaced 8-bit PNG decoded to RGBA',
    changed_pixel_rule: 'any RGBA channel delta exceeds pixel_tolerance',
    dimension_policy: 'equal width and height required for pixel comparison',
    pixel_tolerance: normalizedInteger(
      pixelTolerance,
      'Pixel tolerance',
      0,
      255,
      0
    ),
    maximum_changed_fraction: normalizedFraction(
      maximumChangedFraction,
      'Maximum changed fraction',
      0
    ),
    maximum_source_bytes: MAX_PNG_BYTES,
    maximum_dimension: MAX_PNG_DIMENSION,
    maximum_pixels: MAX_PNG_PIXELS
  };
  if (version === 1) return common;
  return {
    ...common,
    engine: 'sciencecode-bounded-png-structural-comparison',
    acceptance_rule:
      'pixel rule AND optional minimum block luminance structural similarity',
    structural_similarity_method:
      'sample-weighted mean of fixed 8x8 block SSIM using population moments over linear-light luminance',
    structural_similarity_block_size: STRUCTURAL_SIMILARITY_BLOCK_SIZE,
    structural_similarity_decimal_places:
      STRUCTURAL_SIMILARITY_DECIMAL_PLACES,
    structural_similarity_constants: {
      dynamic_range: 1,
      k1: 0.01,
      k2: 0.03
    },
    perceptual_space:
      'decoded sRGB RGBA alpha-composited over white in linear light; Rec. 709 luminance',
    perceptual_matte: 'white',
    minimum_structural_similarity: normalizedOptionalFraction(
      minimumStructuralSimilarity,
      'Minimum structural similarity'
    )
  };
}

function comparisonsRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  if (create) ensureScienceDir(project);
  const root = path.join(project, INTERNAL_DIR, 'figure-comparisons');
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw figureError(
      'Figure comparison storage must be a real project directory.',
      'INVALID_FIGURE_COMPARISON_PATH'
    );
  }
  if (stat) {
    const science = fs.realpathSync(path.join(project, INTERNAL_DIR));
    const real = fs.realpathSync(root);
    if (!isPathInside(science, real)) {
      throw figureError(
        'Figure comparison storage escapes the project.',
        'INVALID_FIGURE_COMPARISON_PATH'
      );
    }
  }
  return root;
}

export function resolveFigureComparisonDirectory(cwd, value) {
  return path.join(comparisonsRoot(cwd), normalizeComparisonId(value));
}

function comparisonFiles(cwd, value) {
  const comparisonId = normalizeComparisonId(value);
  const directory = resolveFigureComparisonDirectory(cwd, comparisonId);
  return {
    comparison_id: comparisonId,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    report: path.join(directory, 'report.json'),
    baseline: path.join(directory, 'baseline.png'),
    candidate: path.join(directory, 'candidate.png'),
    difference: path.join(directory, 'pixel-difference.png')
  };
}

function safeComparisonDirectory(cwd, value) {
  const root = comparisonsRoot(cwd);
  const files = comparisonFiles(cwd, value);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw figureError(
      'Figure comparison not found: ' + files.comparison_id,
      'FIGURE_COMPARISON_NOT_FOUND'
    );
  }
  const rootReal = fs.realpathSync(root);
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(rootReal, directoryReal)) {
    throw figureError(
      'Figure comparison escapes its storage root.',
      'INVALID_FIGURE_COMPARISON_PATH'
    );
  }
  for (const file of [
    files.manifest,
    files.digest,
    files.report,
    files.baseline,
    files.candidate
  ]) {
    const fileStat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!fileStat?.isFile() || fileStat.isSymbolicLink() ||
        !isPathInside(directoryReal, fs.realpathSync(file))) {
      throw figureError(
        'Figure comparison file is missing or unsafe: ' + path.basename(file),
        'FIGURE_COMPARISON_INVALID'
      );
    }
    const limit = FIGURE_FILE_LIMITS.get(path.basename(file));
    if (Number.isFinite(limit) && fileStat.size > limit) {
      throw figureError(
        'Figure comparison file exceeds its safe read limit: ' +
          path.basename(file),
        'FIGURE_COMPARISON_FILE_TOO_LARGE'
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

export function resolveFigureComparisonTarget(cwd, value) {
  const project = path.resolve(cwd);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw figureError('Figure source must be a manifest-bound artifact selector.');
  }
  let target;
  if (value.revision_id !== undefined && value.revision_id !== null &&
      String(value.revision_id).trim()) {
    const revision = resolveArtifactRevision(project, value.revision_id);
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
    const source = value.source ?? value;
    const resolved = resolveRevisionSourceArtifact(project, source);
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
  if (path.extname(target.name).toLowerCase() !== '.png' ||
      !['image/png', 'application/octet-stream'].includes(target.media_type)) {
    throw figureError(
      'Pixel comparison currently requires a manifest-bound PNG artifact.',
      'UNSUPPORTED_FIGURE_FORMAT'
    );
  }
  if (!Number.isInteger(target.bytes) || target.bytes <= 0 ||
      target.bytes > MAX_PNG_BYTES) {
    throw figureError(
      'Figure comparison PNG sources are limited to ' + MAX_PNG_BYTES + ' bytes.',
      'FIGURE_SOURCE_TOO_LARGE'
    );
  }
  return target;
}

function targetSelector(target) {
  if (target?.selector?.revision_id) {
    return { revision_id: target.selector.revision_id };
  }
  if (target?.selector?.source) return target.selector.source;
  throw figureError(
    'Figure comparison target selector is invalid.',
    'FIGURE_COMPARISON_INVALID'
  );
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

function publicTarget(target) {
  const { file: _file, ...value } = target;
  return value;
}

function channelSummary(sum, maximum, samples) {
  return {
    mean_absolute_delta: samples ? sum / samples : 0,
    maximum_absolute_delta: maximum
  };
}

function differencePixels(baseline, candidate) {
  const output = Buffer.allocUnsafe(baseline.rgba.length);
  for (let offset = 0; offset < baseline.rgba.length; offset += 4) {
    const alphaDelta = Math.abs(
      baseline.rgba[offset + 3] - candidate.rgba[offset + 3]
    );
    output[offset] = Math.max(
      Math.abs(baseline.rgba[offset] - candidate.rgba[offset]),
      alphaDelta
    );
    output[offset + 1] = Math.max(
      Math.abs(baseline.rgba[offset + 1] - candidate.rgba[offset + 1]),
      alphaDelta
    );
    output[offset + 2] = Math.max(
      Math.abs(baseline.rgba[offset + 2] - candidate.rgba[offset + 2]),
      alphaDelta
    );
    output[offset + 3] = 255;
  }
  return output;
}

function compositedLinearLuminance(rgba, offset) {
  const alpha = rgba[offset + 3] / 255;
  const white = 1 - alpha;
  const red = LINEAR_SRGB[rgba[offset]] * alpha + white;
  const green = LINEAR_SRGB[rgba[offset + 1]] * alpha + white;
  const blue = LINEAR_SRGB[rgba[offset + 2]] * alpha + white;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function canonicalStructuralNumber(value) {
  const rounded = Number(value.toFixed(
    STRUCTURAL_SIMILARITY_DECIMAL_PLACES
  ));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function structuralSimilarityMetrics(baseline, candidate) {
  let weightedScore = 0;
  let blockCount = 0;
  let sampleCount = 0;
  let absoluteLuminanceDelta = 0;
  let squaredLuminanceDelta = 0;
  let maximumLuminanceDelta = 0;
  let minimumBlockScore = 1;
  let worstBlock = null;
  for (let blockY = 0; blockY < baseline.height;
    blockY += STRUCTURAL_SIMILARITY_BLOCK_SIZE) {
    for (let blockX = 0; blockX < baseline.width;
      blockX += STRUCTURAL_SIMILARITY_BLOCK_SIZE) {
      const blockWidth = Math.min(
        STRUCTURAL_SIMILARITY_BLOCK_SIZE,
        baseline.width - blockX
      );
      const blockHeight = Math.min(
        STRUCTURAL_SIMILARITY_BLOCK_SIZE,
        baseline.height - blockY
      );
      const samples = blockWidth * blockHeight;
      let baselineSum = 0;
      let candidateSum = 0;
      let baselineSquaredSum = 0;
      let candidateSquaredSum = 0;
      let productSum = 0;
      for (let y = blockY; y < blockY + blockHeight; y += 1) {
        for (let x = blockX; x < blockX + blockWidth; x += 1) {
          const offset = (y * baseline.width + x) * 4;
          const baselineLuminance = compositedLinearLuminance(
            baseline.rgba,
            offset
          );
          const candidateLuminance = compositedLinearLuminance(
            candidate.rgba,
            offset
          );
          const delta = Math.abs(baselineLuminance - candidateLuminance);
          baselineSum += baselineLuminance;
          candidateSum += candidateLuminance;
          baselineSquaredSum += baselineLuminance * baselineLuminance;
          candidateSquaredSum += candidateLuminance * candidateLuminance;
          productSum += baselineLuminance * candidateLuminance;
          absoluteLuminanceDelta += delta;
          squaredLuminanceDelta += delta * delta;
          maximumLuminanceDelta = Math.max(maximumLuminanceDelta, delta);
        }
      }
      const baselineMean = baselineSum / samples;
      const candidateMean = candidateSum / samples;
      const baselineVariance = Math.max(
        0,
        baselineSquaredSum / samples - baselineMean * baselineMean
      );
      const candidateVariance = Math.max(
        0,
        candidateSquaredSum / samples - candidateMean * candidateMean
      );
      const covariance = productSum / samples -
        baselineMean * candidateMean;
      const numerator =
        (2 * baselineMean * candidateMean + STRUCTURAL_SIMILARITY_C1) *
        (2 * covariance + STRUCTURAL_SIMILARITY_C2);
      const denominator =
        (baselineMean * baselineMean + candidateMean * candidateMean +
          STRUCTURAL_SIMILARITY_C1) *
        (baselineVariance + candidateVariance +
          STRUCTURAL_SIMILARITY_C2);
      const score = canonicalStructuralNumber(
        Math.max(-1, Math.min(1, numerator / denominator))
      );
      weightedScore += score * samples;
      sampleCount += samples;
      blockCount += 1;
      if (worstBlock === null || score < minimumBlockScore) {
        minimumBlockScore = score;
        worstBlock = {
          x: blockX,
          y: blockY,
          width: blockWidth,
          height: blockHeight,
          structural_similarity: score
        };
      }
    }
  }
  return {
    block_size: STRUCTURAL_SIMILARITY_BLOCK_SIZE,
    block_count: blockCount,
    mean_structural_similarity: canonicalStructuralNumber(
      weightedScore / sampleCount
    ),
    minimum_block_structural_similarity: minimumBlockScore,
    worst_block: worstBlock,
    mean_absolute_luminance_error: canonicalStructuralNumber(
      absoluteLuminanceDelta / sampleCount
    ),
    root_mean_square_luminance_error: canonicalStructuralNumber(
      Math.sqrt(squaredLuminanceDelta / sampleCount)
    ),
    maximum_luminance_delta: canonicalStructuralNumber(
      maximumLuminanceDelta
    )
  };
}

export function analyzeFigureComparison({
  baseline,
  candidate,
  baselineTarget,
  candidateTarget,
  settings
}) {
  const normalizedSettings = normalizeFigureComparisonSettings({
    pixelTolerance: settings?.pixel_tolerance,
    maximumChangedFraction: settings?.maximum_changed_fraction,
    minimumStructuralSimilarity:
      settings?.minimum_structural_similarity,
    engineVersion: settings?.engine_version
  });
  const engineVersion = normalizedSettings.engine_version;
  const compatible = baseline.width === candidate.width &&
    baseline.height === candidate.height;
  const dimensions = {
    compatible,
    baseline: {
      width: baseline.width,
      height: baseline.height,
      pixels: baseline.pixel_count
    },
    candidate: {
      width: candidate.width,
      height: candidate.height,
      pixels: candidate.pixel_count
    }
  };
  let metrics = null;
  if (compatible) {
    const sums = [0, 0, 0, 0];
    const maxima = [0, 0, 0, 0];
    let squaredSum = 0;
    let exactChangedPixels = 0;
    let toleranceChangedPixels = 0;
    let minimumX = baseline.width;
    let minimumY = baseline.height;
    let maximumX = -1;
    let maximumY = -1;
    for (let pixel = 0; pixel < baseline.pixel_count; pixel += 1) {
      const offset = pixel * 4;
      let exactChanged = false;
      let toleranceChanged = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(
          baseline.rgba[offset + channel] - candidate.rgba[offset + channel]
        );
        sums[channel] += delta;
        squaredSum += delta * delta;
        maxima[channel] = Math.max(maxima[channel], delta);
        if (delta > 0) exactChanged = true;
        if (delta > normalizedSettings.pixel_tolerance) toleranceChanged = true;
      }
      if (exactChanged) exactChangedPixels += 1;
      if (toleranceChanged) {
        toleranceChangedPixels += 1;
        const x = pixel % baseline.width;
        const y = Math.floor(pixel / baseline.width);
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }
    const samples = baseline.pixel_count;
    const channelSamples = samples * 4;
    const absoluteSum = sums.reduce((total, value) => total + value, 0);
    metrics = {
      exact: exactChangedPixels === 0,
      pixel_count: samples,
      exact_changed_pixels: exactChangedPixels,
      exact_changed_fraction: exactChangedPixels / samples,
      tolerance_exceeding_pixels: toleranceChangedPixels,
      tolerance_exceeding_fraction: toleranceChangedPixels / samples,
      mean_absolute_error_rgba: absoluteSum / channelSamples,
      root_mean_square_error_rgba: Math.sqrt(squaredSum / channelSamples),
      maximum_channel_delta: Math.max(...maxima),
      channels: {
        red: channelSummary(sums[0], maxima[0], samples),
        green: channelSummary(sums[1], maxima[1], samples),
        blue: channelSummary(sums[2], maxima[2], samples),
        alpha: channelSummary(sums[3], maxima[3], samples)
      },
      changed_bounding_box: toleranceChangedPixels
        ? {
          x: minimumX,
          y: minimumY,
          width: maximumX - minimumX + 1,
          height: maximumY - minimumY + 1
        }
        : null
    };
    if (engineVersion >= 2) {
      metrics.structural_similarity = structuralSimilarityMetrics(
        baseline,
        candidate
      );
    }
  }
  const pixelRulePass = compatible &&
    metrics.tolerance_exceeding_fraction <=
      normalizedSettings.maximum_changed_fraction;
  const minimumStructuralSimilarity = engineVersion >= 2
    ? normalizedSettings.minimum_structural_similarity
    : null;
  const structuralRulePass = !compatible ||
      minimumStructuralSimilarity === null
    ? null
    : metrics.structural_similarity.mean_structural_similarity >=
      minimumStructuralSimilarity;
  const pass = pixelRulePass && structuralRulePass !== false;
  const reproductionStatus = !compatible
    ? 'incompatible_dimensions'
    : metrics.exact
      ? 'exact'
      : pass ? 'within_tolerance' : 'different';
  const status = pass ? 'pass' : 'fail';
  const summary = {
    status,
    reproduction_status: reproductionStatus,
    compatible_dimensions: compatible,
    exact: metrics?.exact ?? false,
    pixel_count: metrics?.pixel_count ?? 0,
    exact_changed_pixels: metrics?.exact_changed_pixels ?? null,
    tolerance_exceeding_pixels:
      metrics?.tolerance_exceeding_pixels ?? null,
    tolerance_exceeding_fraction:
      metrics?.tolerance_exceeding_fraction ?? null,
    pixel_tolerance: normalizedSettings.pixel_tolerance,
    maximum_changed_fraction:
      normalizedSettings.maximum_changed_fraction
  };
  if (engineVersion >= 2) {
    summary.pixel_rule_pass = pixelRulePass;
    summary.structural_similarity =
      metrics?.structural_similarity?.mean_structural_similarity ?? null;
    summary.minimum_structural_similarity = minimumStructuralSimilarity;
    summary.structural_similarity_rule_pass = structuralRulePass;
    summary.failed_rules = compatible
      ? [
        ...(pixelRulePass ? [] : ['pixel']),
        ...(structuralRulePass === false ? ['structural_similarity'] : [])
      ]
      : ['dimensions'];
  }
  const interpretation = reproductionStatus === 'exact'
    ? 'The decoded RGBA pixels are exactly equal.'
    : reproductionStatus === 'within_tolerance'
      ? engineVersion >= 2 && minimumStructuralSimilarity !== null
        ? 'The decoded RGBA pixels differ, but both frozen pixel and structural-similarity rules pass.'
        : 'The decoded RGBA pixels differ, but the frozen tolerance rule passes.'
      : reproductionStatus === 'different'
        ? engineVersion >= 2 && structuralRulePass === false && pixelRulePass
          ? 'The decoded RGBA pixels satisfy the frozen pixel rule but fail the frozen structural-similarity rule.'
          : engineVersion >= 2 && structuralRulePass === false
            ? 'The decoded RGBA pixels fail the frozen pixel and structural-similarity rules.'
            : 'The decoded RGBA pixels exceed the frozen tolerance rule.'
        : 'Pixel comparison is unavailable because the image dimensions differ.';
  const limitations = [
    'Pixel agreement does not establish that the underlying data, code, environment, labels, or scientific interpretation are correct.',
    engineVersion >= 2
      ? 'The structural score is a fixed blockwise luminance diagnostic after white-matte compositing; it is not semantic plot comparison, registration, or a domain-valid similarity judgment.'
      : 'The comparator decodes a bounded non-interlaced 8-bit PNG subset to RGBA; color-management profiles and perceptual equivalence are not modeled.',
    engineVersion >= 2
      ? 'The comparator decodes a bounded non-interlaced 8-bit PNG subset; color profiles, cropping, registration, resampling, and learned perceptual models are not applied.'
      : 'Tolerance is a frozen mechanical RGBA rule, not a domain-valid scientific acceptance criterion.',
    engineVersion >= 2
      ? 'Pixel and structural thresholds are frozen mechanical rules, not domain-valid scientific acceptance criteria.'
      : 'The difference image is a visualization; exact numerical deltas and the pass/fail rule are recorded in this report.',
    ...(engineVersion >= 2
      ? ['The difference image is a visualization; exact numerical deltas and the pass/fail rules are recorded in this report.']
      : [])
  ];
  return {
    schema_version: engineVersion,
    engine: normalizedSettings.engine,
    engine_version: normalizedSettings.engine_version,
    settings: normalizedSettings,
    settings_sha256: sha256Json(normalizedSettings),
    baseline: {
      url: baselineTarget.url,
      sha256: baselineTarget.sha256,
      bytes: baselineTarget.bytes
    },
    candidate: {
      url: candidateTarget.url,
      sha256: candidateTarget.sha256,
      bytes: candidateTarget.bytes
    },
    status,
    reproduction_status: reproductionStatus,
    summary,
    dimensions,
    metrics,
    difference_visualization: compatible
      ? {
        file: 'pixel-difference.png',
        representation:
          'opaque absolute RGB channel deltas; alpha deltas are promoted into all RGB channels',
        thresholding:
          'not applied to visualization; use report metrics for the frozen threshold'
      }
      : null,
    interpretation,
    limitations
  };
}

function artifactDescriptor(file, relative, mediaType) {
  return {
    file: relative,
    media_type: mediaType,
    bytes: fs.statSync(file).size,
    sha256: sha256File(file)
  };
}

function writeBufferExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
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
      !path.basename(staging).startsWith('.staging-figure-comparison-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function comparisonDirectories(cwd) {
  const root = comparisonsRoot(cwd);
  const ids = new Set();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && COMPARISON_ID_PATTERN.test(entry.name)) {
        ids.add(entry.name);
      }
    }
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'figure_comparison.created' &&
          COMPARISON_ID_PATTERN.test(
            String(record.figure_comparison_id ?? '')
          )) {
        ids.add(record.figure_comparison_id);
      }
    }
  } catch {
    // Project verification reports the malformed audit while retaining directories.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

export function createFigureComparison({
  cwd,
  chatId,
  baseline,
  candidate,
  name,
  note,
  pixelTolerance,
  maximumChangedFraction,
  minimumStructuralSimilarity,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw figureError('Figure comparison timestamp is invalid.');
  }
  const normalizedChatId = validateOptionalChat(project, chatId);
  const baselineTarget = resolveFigureComparisonTarget(project, baseline);
  const candidateTarget = resolveFigureComparisonTarget(project, candidate);
  if (baselineTarget.url === candidateTarget.url) {
    throw figureError(
      'Baseline and candidate must be distinct immutable artifact records.',
      'FIGURE_COMPARISON_SAME_SOURCE'
    );
  }
  const settings = normalizeFigureComparisonSettings({
    pixelTolerance,
    maximumChangedFraction,
    minimumStructuralSimilarity
  });
  const normalizedName = boundedText(
    name ?? path.basename(baselineTarget.name) + ' rerun comparison',
    'Figure comparison name',
    240,
    { required: true }
  );
  const normalizedNote = boundedText(note, 'Figure comparison note', 2_000);
  const baselineBytes = fs.readFileSync(baselineTarget.file);
  const candidateBytes = fs.readFileSync(candidateTarget.file);
  const baselineImage = decodePng(baselineBytes);
  const candidateImage = decodePng(candidateBytes);
  const report = analyzeFigureComparison({
    baseline: baselineImage,
    candidate: candidateImage,
    baselineTarget,
    candidateTarget,
    settings
  });
  if (Buffer.byteLength(JSON.stringify(report)) >
      MAX_FIGURE_COMPARISON_REPORT_BYTES) {
    throw figureError(
      'Figure comparison report exceeds the fixed storage limit.',
      'FIGURE_COMPARISON_REPORT_TOO_LARGE'
    );
  }

  const root = comparisonsRoot(project, { create: true });
  if (comparisonDirectories(project).length >= MAX_FIGURE_COMPARISONS) {
    throw figureError(
      'Figure comparison record limit reached for this project.',
      'FIGURE_COMPARISON_LIMIT'
    );
  }
  const comparisonId = makeFigureComparisonId(now);
  const finalDirectory = path.join(root, comparisonId);
  const staging = path.join(
    root,
    '.staging-figure-comparison-' + crypto.randomBytes(8).toString('hex')
  );
  fs.mkdirSync(staging, { mode: 0o700 });
  let manifest;
  try {
    const baselineFile = path.join(staging, 'baseline.png');
    const candidateFile = path.join(staging, 'candidate.png');
    const reportFile = path.join(staging, 'report.json');
    writeBufferExclusive(baselineFile, baselineBytes);
    writeBufferExclusive(candidateFile, candidateBytes);
    writeJsonExclusive(reportFile, report);
    const artifacts = {
      'baseline.png': artifactDescriptor(
        baselineFile,
        'baseline.png',
        'image/png'
      ),
      'candidate.png': artifactDescriptor(
        candidateFile,
        'candidate.png',
        'image/png'
      ),
      'report.json': artifactDescriptor(
        reportFile,
        'report.json',
        'application/json; charset=utf-8'
      )
    };
    if (report.dimensions.compatible) {
      const differenceFile = path.join(staging, 'pixel-difference.png');
      const difference = encodeRgbaPng({
        width: baselineImage.width,
        height: baselineImage.height,
        rgba: differencePixels(baselineImage, candidateImage)
      });
      writeBufferExclusive(differenceFile, difference);
      artifacts['pixel-difference.png'] = artifactDescriptor(
        differenceFile,
        'pixel-difference.png',
        'image/png'
      );
    }
    manifest = {
      schema_version: FIGURE_COMPARISON_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      figure_comparison_id: comparisonId,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      name: normalizedName,
      note: normalizedNote,
      status: report.status,
      reproduction_status: report.reproduction_status,
      baseline: publicTarget(baselineTarget),
      candidate: publicTarget(candidateTarget),
      comparator: {
        engine: settings.engine,
        engine_version: settings.engine_version,
        settings_sha256: report.settings_sha256
      },
      summary: report.summary,
      artifacts,
      preservation_policy:
        'immutable source copies, canonical source hashes, deterministic pixel and structural-similarity report, difference visualization, and audit link'
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
  const files = comparisonFiles(project, comparisonId);
  const manifestSha256 = sha256File(files.manifest);
  appendAudit(project, {
    type: 'figure_comparison.created',
    figure_comparison_id: comparisonId,
    chat_id: normalizedChatId,
    status: report.status,
    reproduction_status: report.reproduction_status,
    baseline_url: baselineTarget.url,
    baseline_sha256: baselineTarget.sha256,
    candidate_url: candidateTarget.url,
    candidate_sha256: candidateTarget.sha256,
    structural_similarity:
      report.summary.structural_similarity ?? null,
    minimum_structural_similarity:
      report.summary.minimum_structural_similarity ?? null,
    report_sha256: manifest.artifacts['report.json'].sha256,
    manifest_sha256: manifestSha256
  });
  return getFigureComparison(project, comparisonId);
}

export function getFigureComparisonManifest(cwd, value) {
  return readJson(safeComparisonDirectory(cwd, value).manifest);
}

export function getFigureComparisonReport(cwd, value) {
  const files = safeComparisonDirectory(cwd, value);
  if (fs.statSync(files.report).size > MAX_FIGURE_COMPARISON_REPORT_BYTES) {
    throw figureError(
      'Figure comparison report exceeds the safe read limit.',
      'FIGURE_COMPARISON_REPORT_TOO_LARGE'
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
    const limit = FIGURE_FILE_LIMITS.get(expectedName);
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
      errors.push({ file: descriptor.file, issue: 'byte_count_mismatch' });
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

export function verifyFigureComparison(cwd, value) {
  const project = path.resolve(cwd);
  const comparisonId = String(value ?? '');
  const errors = [];
  let files;
  let manifest;
  let report;
  try {
    files = safeComparisonDirectory(project, comparisonId);
    manifest = readJson(files.manifest);
    report = getFigureComparisonReport(project, comparisonId);
  } catch (error) {
    return {
      ok: false,
      figure_comparison_id: comparisonId,
      errors: [{
        issue: error.code ?? 'figure_comparison_error',
        detail: error.message
      }]
    };
  }
  const manifestSha256 = sha256File(files.manifest);
  const expectedManifestSha256 = fs.readFileSync(files.digest, 'utf8').trim();
  if (!SUPPORTED_FIGURE_COMPARISON_VERSIONS.has(
    manifest.schema_version
  )) {
    errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
  }
  if (manifest.figure_comparison_id !== comparisonId) {
    errors.push({
      file: 'manifest.json',
      issue: 'figure_comparison_id_mismatch'
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
  const baselineFile = artifactFileInside(
    files,
    manifest.artifacts?.['baseline.png'],
    'baseline.png',
    errors
  );
  const candidateFile = artifactFileInside(
    files,
    manifest.artifacts?.['candidate.png'],
    'candidate.png',
    errors
  );
  const reportFile = artifactFileInside(
    files,
    manifest.artifacts?.['report.json'],
    'report.json',
    errors
  );
  let resolvedBaseline = null;
  let resolvedCandidate = null;
  try {
    resolvedBaseline = resolveFigureComparisonTarget(
      project,
      targetSelector(manifest.baseline)
    );
    compareTarget(manifest.baseline, resolvedBaseline, errors, 'baseline');
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'baseline_invalid',
      detail: error.message,
      code: error.code ?? null
    });
  }
  try {
    resolvedCandidate = resolveFigureComparisonTarget(
      project,
      targetSelector(manifest.candidate)
    );
    compareTarget(manifest.candidate, resolvedCandidate, errors, 'candidate');
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'candidate_invalid',
      detail: error.message,
      code: error.code ?? null
    });
  }
  if (baselineFile && resolvedBaseline &&
      sha256File(baselineFile) !== resolvedBaseline.sha256) {
    errors.push({ file: 'baseline.png', issue: 'source_copy_mismatch' });
  }
  if (candidateFile && resolvedCandidate &&
      sha256File(candidateFile) !== resolvedCandidate.sha256) {
    errors.push({ file: 'candidate.png', issue: 'source_copy_mismatch' });
  }
  let recomputed = null;
  let decodedBaseline = null;
  let decodedCandidate = null;
  try {
    if (!baselineFile || !candidateFile || !resolvedBaseline ||
        !resolvedCandidate) {
      throw new Error('comparison inputs are unavailable');
    }
    decodedBaseline = decodePng(fs.readFileSync(baselineFile));
    decodedCandidate = decodePng(fs.readFileSync(candidateFile));
    recomputed = analyzeFigureComparison({
      baseline: decodedBaseline,
      candidate: decodedCandidate,
      baselineTarget: resolvedBaseline,
      candidateTarget: resolvedCandidate,
      settings: report.settings
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
      issue: 'comparison_recalculation_failed',
      detail: error.message
    });
  }
  if (reportFile &&
      manifest.artifacts?.['report.json']?.sha256 !== sha256File(reportFile)) {
    errors.push({ file: 'report.json', issue: 'manifest_report_mismatch' });
  }
  let expectedEngine = null;
  try {
    expectedEngine = normalizeFigureComparisonSettings({
      engineVersion: report.engine_version
    }).engine;
  } catch {
    // The explicit version/schema checks below report the unsupported record.
  }
  if (!SUPPORTED_FIGURE_COMPARISON_VERSIONS.has(
    report.engine_version
  ) ||
      report.schema_version !== report.engine_version ||
      manifest.schema_version !== report.schema_version ||
      report.engine !== expectedEngine ||
      report.settings?.engine !== report.engine ||
      report.settings?.engine_version !== report.engine_version ||
      report.settings_sha256 !== sha256Json(report.settings) ||
      manifest.comparator?.engine !== report.engine ||
      manifest.comparator?.engine_version !== report.engine_version ||
      manifest.comparator?.settings_sha256 !== report.settings_sha256) {
    errors.push({ file: 'report.json', issue: 'comparison_settings_mismatch' });
  }
  if (manifest.status !== report.status ||
      manifest.reproduction_status !== report.reproduction_status ||
      sha256Json(manifest.summary) !== sha256Json(report.summary)) {
    errors.push({ file: 'manifest.json', issue: 'report_summary_mismatch' });
  }
  const differenceDescriptor = manifest.artifacts?.['pixel-difference.png'];
  if (report.dimensions?.compatible) {
    const differenceFile = artifactFileInside(
      files,
      differenceDescriptor,
      'pixel-difference.png',
      errors
    );
    if (differenceFile && decodedBaseline && decodedCandidate) {
      try {
        const decodedDifference = decodePng(fs.readFileSync(differenceFile));
        const expectedPixels = differencePixels(
          decodedBaseline,
          decodedCandidate
        );
        if (decodedDifference.width !== decodedBaseline.width ||
            decodedDifference.height !== decodedBaseline.height ||
            !decodedDifference.rgba.equals(expectedPixels)) {
          errors.push({
            file: 'pixel-difference.png',
            issue: 'difference_visualization_mismatch'
          });
        }
      } catch (error) {
        errors.push({
          file: 'pixel-difference.png',
          issue: 'difference_visualization_invalid',
          detail: error.message
        });
      }
    }
  } else if (differenceDescriptor ||
      fs.existsSync(path.join(files.directory, 'pixel-difference.png'))) {
    errors.push({
      file: 'pixel-difference.png',
      issue: 'unexpected_difference_visualization'
    });
  }
  try {
    validateOptionalChat(project, manifest.chat_id);
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'comparison_chat_invalid',
      detail: error.message
    });
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const event = readAuditRecords(project).findLast((record) =>
      record.type === 'figure_comparison.created' &&
      record.figure_comparison_id === comparisonId
    );
    if (!event) {
      errors.push({ issue: 'missing_figure_comparison_audit_event' });
    } else {
      if (event.manifest_sha256 !== manifestSha256) {
        errors.push({ issue: 'audit_manifest_mismatch' });
      }
      if (event.report_sha256 !==
          manifest.artifacts?.['report.json']?.sha256) {
        errors.push({ issue: 'audit_report_mismatch' });
      }
      if (event.baseline_sha256 !== manifest.baseline?.sha256 ||
          event.candidate_sha256 !== manifest.candidate?.sha256) {
        errors.push({ issue: 'audit_source_mismatch' });
      }
      if (event.status !== manifest.status ||
          event.reproduction_status !== manifest.reproduction_status) {
        errors.push({ issue: 'audit_status_mismatch' });
      }
      if (manifest.schema_version >= 2 &&
          (event.structural_similarity ?? null) !==
            (report.summary?.structural_similarity ?? null)) {
        errors.push({ issue: 'audit_structural_similarity_mismatch' });
      }
      if (manifest.schema_version >= 2 &&
          (event.minimum_structural_similarity ?? null) !==
            (report.summary?.minimum_structural_similarity ?? null)) {
        errors.push({ issue: 'audit_structural_threshold_mismatch' });
      }
    }
  }
  return {
    ok: errors.length === 0,
    figure_comparison_id: comparisonId,
    manifest,
    report,
    manifest_sha256: manifestSha256,
    report_sha256: manifest.artifacts?.['report.json']?.sha256 ?? null,
    errors
  };
}

function comparisonSummary(cwd, comparisonId) {
  try {
    const verification = verifyFigureComparison(cwd, comparisonId);
    if (!verification.manifest || !verification.report) {
      throw new Error('Figure comparison record is unreadable.');
    }
    const manifest = verification.manifest;
    return {
      figure_comparison_id: comparisonId,
      created_at: manifest.created_at,
      chat_id: manifest.chat_id,
      name: manifest.name,
      note: manifest.note,
      status: manifest.status,
      reproduction_status: manifest.reproduction_status,
      verified: verification.ok,
      verification_errors: verification.errors,
      baseline: manifest.baseline,
      candidate: manifest.candidate,
      summary: manifest.summary,
      manifest_sha256: verification.manifest_sha256,
      report_sha256: verification.report_sha256,
      url: '/api/figure-comparisons/' + encodeURIComponent(comparisonId)
    };
  } catch (error) {
    return {
      figure_comparison_id: comparisonId,
      status: 'invalid',
      reproduction_status: 'invalid',
      verified: false,
      verification_errors: [{
        issue: error.code ?? 'figure_comparison_error',
        detail: error.message
      }],
      baseline: null,
      candidate: null,
      summary: {},
      url: '/api/figure-comparisons/' + encodeURIComponent(comparisonId)
    };
  }
}

export function listFigureComparisons(cwd, {
  chatId,
  baselineUrl,
  candidateUrl
} = {}) {
  return comparisonDirectories(cwd)
    .map((comparisonId) => comparisonSummary(cwd, comparisonId))
    .sort((left, right) =>
      String(right.created_at ?? '').localeCompare(
        String(left.created_at ?? '')
      ) ||
      String(right.figure_comparison_id).localeCompare(
        String(left.figure_comparison_id)
      )
    )
    .filter((record) => !chatId || record.chat_id === chatId)
    .filter((record) =>
      !baselineUrl || record.baseline?.url === baselineUrl
    )
    .filter((record) =>
      !candidateUrl || record.candidate?.url === candidateUrl
    );
}

export function getFigureComparison(cwd, value) {
  const comparisonId = normalizeComparisonId(value);
  const verification = verifyFigureComparison(cwd, comparisonId);
  if (!verification.manifest || !verification.report) {
    throw figureError(
      'Figure comparison not found: ' + comparisonId,
      'FIGURE_COMPARISON_NOT_FOUND'
    );
  }
  const artifactBase = '/figure-comparison-artifact/' +
    encodeURIComponent(comparisonId) + '/';
  return {
    figure_comparison_id: comparisonId,
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

export function resolveFigureComparisonArtifact(cwd, value, name) {
  const comparisonId = normalizeComparisonId(value);
  const artifactName = String(name ?? '');
  if (!FIXED_ARTIFACT_FILES.has(artifactName)) {
    throw figureError(
      'Figure comparison artifact not found: ' + artifactName,
      'FIGURE_COMPARISON_ARTIFACT_NOT_FOUND'
    );
  }
  const verification = verifyFigureComparison(cwd, comparisonId);
  if (!verification.ok) {
    throw Object.assign(
      new Error('Figure comparison failed integrity verification.'),
      { code: 'FIGURE_COMPARISON_INVALID', verification }
    );
  }
  const descriptor = verification.manifest.artifacts?.[artifactName];
  if (!descriptor) {
    throw figureError(
      'Figure comparison artifact not found: ' + artifactName,
      'FIGURE_COMPARISON_ARTIFACT_NOT_FOUND'
    );
  }
  const directory = safeComparisonDirectory(cwd, comparisonId).directory;
  const file = resolveInsideRoot(directory, descriptor.file);
  return { file, descriptor, verification };
}

export function figureComparisonInteractionArtifact(comparison) {
  const manifest = comparison?.manifest ?? comparison;
  return {
    kind: 'figure-comparison',
    record_id: manifest.figure_comparison_id,
    name: manifest.name ?? manifest.figure_comparison_id,
    url: '/api/figure-comparisons/' +
      encodeURIComponent(manifest.figure_comparison_id)
  };
}

export function figureComparisonInteractionPayload(comparison, values = {}) {
  const manifest = comparison?.manifest ?? comparison;
  const report = comparison?.report ?? {};
  return {
    figure_comparison_id: manifest.figure_comparison_id,
    record_file: '.sciencecode/figure-comparisons/' +
      manifest.figure_comparison_id + '/manifest.json',
    status: report.status ?? manifest.status,
    reproduction_status:
      report.reproduction_status ?? manifest.reproduction_status,
    baseline_url: manifest.baseline?.url ?? null,
    baseline_sha256: manifest.baseline?.sha256 ?? null,
    candidate_url: manifest.candidate?.url ?? null,
    candidate_sha256: manifest.candidate?.sha256 ?? null,
    settings: report.settings ?? null,
    dimensions: report.dimensions ?? null,
    metrics: report.metrics ?? null,
    selected_region: values.selected_region ?? null,
    blend: values.blend ?? null,
    difference_gain: values.difference_gain ?? null,
    note: boundedText(
      values.note,
      'Figure comparison interaction note',
      600
    ),
    interpretation:
      'mechanical pixel and optional structural-similarity check only; inspect source data, code, environment, labels, and scientific meaning separately'
  };
}
