export const MAX_GENOMIC_FEATURES = 50_000;
export const MAX_GENOMIC_CONTIGS = 10_000;
export const MAX_SEQUENCE_BASES = 5_000_000;

function genomicError(message, code = 'INVALID_GENOMIC_DATA') {
  return Object.assign(new Error(message), { code });
}

function boundedInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError('Genomic parser limit must be an integer from 1 through ' + maximum + '.');
  }
  return parsed;
}

function safeText(value, limit = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
}

function finiteCoordinate(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseAttributes(value, format) {
  const result = {};
  const parts = String(value ?? '').split(';');
  for (const part of parts) {
    if (Object.keys(result).length >= 64) break;
    const trimmed = part.trim();
    if (!trimmed) continue;
    let key;
    let raw;
    if (format === 'gtf') {
      const match = trimmed.match(/^([^\s]+)\s+"?([\s\S]*?)"?$/);
      if (!match) continue;
      [, key, raw] = match;
    } else {
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      key = trimmed.slice(0, index);
      raw = trimmed.slice(index + 1);
    }
    const normalizedKey = safeText(key, 80);
    if (!normalizedKey) continue;
    result[normalizedKey] = safeText(raw, 1_000);
  }
  return result;
}

function preferredName(attributes, fallback) {
  return safeText(
    attributes.Name ?? attributes.name ?? attributes.gene_name ?? attributes.gene_id ??
    attributes.transcript_id ?? attributes.ID ?? fallback,
    240
  );
}

function featureRecord(values) {
  const score = values.score === null || values.score === undefined || values.score === '.' || values.score === ''
    ? null : Number(values.score);
  const numericValue = values.value === null || values.value === undefined || values.value === ''
    ? null : Number(values.value);
  return {
    index: values.index,
    row: values.row,
    contig: safeText(values.contig, 240),
    start: values.start,
    end: values.end,
    type: safeText(values.type || 'feature', 120),
    name: safeText(values.name || '', 240),
    score: Number.isFinite(score) ? score : null,
    value: Number.isFinite(numericValue) ? numericValue : null,
    strand: ['+', '-', '.'].includes(values.strand) ? values.strand : null,
    source: safeText(values.source || '', 120),
    ref: safeText(values.ref || '', 2_000),
    alt: Array.isArray(values.alt) ? values.alt.map((item) => safeText(item, 2_000)).slice(0, 64) : [],
    filter: safeText(values.filter || '', 240),
    attributes: values.attributes && typeof values.attributes === 'object' ? values.attributes : {}
  };
}

function parseFasta(text, maximumBases, maximumContigs) {
  const contigs = [];
  const warnings = [];
  let current = null;
  let total = 0;
  for (const [lineIndex, raw] of text.replace(/\r/g, '').split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      if (contigs.length >= maximumContigs) {
        warnings.push('Only the first ' + maximumContigs + ' FASTA records were loaded.');
        current = null;
        continue;
      }
      const description = safeText(line.slice(1), 1_000);
      const name = safeText(description.split(/\s+/)[0] || 'sequence-' + (contigs.length + 1), 240);
      current = { name, description, sequence: '', length: 0 };
      contigs.push(current);
      continue;
    }
    if (!current) throw genomicError('FASTA sequence data appears before a header at line ' + (lineIndex + 1) + '.');
    const sequence = line.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z*.-]+$/.test(sequence)) {
      warnings.push('Non-IUPAC characters were retained in FASTA line ' + (lineIndex + 1) + '.');
    }
    const remaining = Math.max(0, maximumBases - total);
    current.sequence += sequence.slice(0, remaining);
    current.length += sequence.length;
    total += Math.min(sequence.length, remaining);
    if (sequence.length > remaining && !warnings.some((warning) => warning.includes('sequence-base limit'))) {
      warnings.push('Sequence text was truncated at the ' + maximumBases + ' base display limit; recorded lengths remain available.');
    }
  }
  if (!contigs.length) throw genomicError('No FASTA records were found.');
  return { contigs, features: [], warnings, sequenceBases: total };
}

function vcfContig(line) {
  const match = line.match(/^##contig=<(.+)>$/i);
  if (!match) return null;
  const values = {};
  for (const item of match[1].split(',')) {
    const index = item.indexOf('=');
    if (index > 0) values[item.slice(0, index).trim().toUpperCase()] = item.slice(index + 1).trim();
  }
  if (!values.ID) return null;
  return { name: safeText(values.ID, 240), length: finiteCoordinate(values.LENGTH) ?? 0 };
}

export function parseGenomeDocument(value, extension, options = {}) {
  const text = String(value ?? '');
  const format = String(extension ?? '').toLowerCase();
  const maxFeatures = boundedInteger(options.maxFeatures, MAX_GENOMIC_FEATURES, MAX_GENOMIC_FEATURES);
  const maxContigs = boundedInteger(options.maxContigs, MAX_GENOMIC_CONTIGS, MAX_GENOMIC_CONTIGS);
  const maxSequenceBases = boundedInteger(options.maxSequenceBases, MAX_SEQUENCE_BASES, MAX_SEQUENCE_BASES);
  if (['fa', 'fasta', 'fna', 'ffn', 'faa'].includes(format)) {
    const parsed = parseFasta(text, maxSequenceBases, maxContigs);
    return finalizeDocument({ format, ...parsed });
  }
  if (!['bed', 'bedgraph', 'bdg', 'gff', 'gff3', 'gtf', 'vcf'].includes(format)) {
    throw genomicError('Unsupported genomic format: ' + (format || 'unknown') + '.');
  }
  const features = [];
  const contigMetadata = new Map();
  const observedContigs = new Set();
  const warnings = [];
  let truncated = false;
  const lines = text.replace(/\r/g, '').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const line = raw.trim();
    if (!line) continue;
    if (format === 'vcf' && line.startsWith('##contig=')) {
      const contig = vcfContig(line);
      if (contig && observedContigs.size < maxContigs) {
        contigMetadata.set(contig.name, contig);
        observedContigs.add(contig.name);
      }
      continue;
    }
    if (line.startsWith('#') || line.startsWith('track ') || line.startsWith('browser ')) continue;
    if (features.length >= maxFeatures) {
      truncated = true;
      break;
    }
    const columns = raw.split('\t');
    let record = null;
    if (format === 'bed' || format === 'bedgraph' || format === 'bdg') {
      if (columns.length < 3) {
        warnings.push('Skipped line ' + (lineIndex + 1) + ': expected at least three tab-separated BED columns.');
        continue;
      }
      const start = finiteCoordinate(columns[1]);
      const end = finiteCoordinate(columns[2]);
      if (start === null || end === null || end <= start) {
        warnings.push('Skipped line ' + (lineIndex + 1) + ': invalid zero-based half-open coordinates.');
        continue;
      }
      const graph = format === 'bedgraph' || format === 'bdg';
      record = featureRecord({
        index: features.length,
        row: lineIndex + 1,
        contig: columns[0], start, end,
        type: graph ? 'signal' : (columns.length >= 12 ? 'BED12' : 'interval'),
        name: graph ? '' : columns[3],
        score: graph ? null : columns[4],
        value: graph ? columns[3] : null,
        strand: graph ? null : columns[5],
        attributes: columns.length >= 12 ? {
          thick_start: safeText(columns[6], 32), thick_end: safeText(columns[7], 32),
          item_rgb: safeText(columns[8], 32), block_count: safeText(columns[9], 32)
        } : {}
      });
    } else if (format === 'gff' || format === 'gff3' || format === 'gtf') {
      if (columns.length < 9) {
        warnings.push('Skipped line ' + (lineIndex + 1) + ': expected nine GFF/GTF columns.');
        continue;
      }
      const oneBasedStart = finiteCoordinate(columns[3]);
      const oneBasedEnd = finiteCoordinate(columns[4]);
      if (oneBasedStart === null || oneBasedStart < 1 || oneBasedEnd === null || oneBasedEnd < oneBasedStart) {
        warnings.push('Skipped line ' + (lineIndex + 1) + ': invalid one-based inclusive coordinates.');
        continue;
      }
      const attributes = parseAttributes(columns[8], format);
      record = featureRecord({
        index: features.length,
        row: lineIndex + 1,
        contig: columns[0], start: oneBasedStart - 1, end: oneBasedEnd,
        source: columns[1], type: columns[2], score: columns[5], strand: columns[6],
        name: preferredName(attributes, columns[2] + ' ' + oneBasedStart + '-' + oneBasedEnd),
        attributes: { ...attributes, phase: safeText(columns[7], 8) }
      });
    } else if (format === 'vcf') {
      if (columns.length < 8) {
        warnings.push('Skipped line ' + (lineIndex + 1) + ': expected at least eight VCF columns.');
        continue;
      }
      const position = finiteCoordinate(columns[1]);
      if (position === null || position < 1) {
        warnings.push('Skipped line ' + (lineIndex + 1) + ': invalid one-based VCF position.');
        continue;
      }
      const info = parseAttributes(columns[7], 'gff');
      const start = position - 1;
      const infoEnd = finiteCoordinate(info.END);
      const end = infoEnd && infoEnd >= position ? infoEnd : start + Math.max(1, columns[3].length);
      record = featureRecord({
        index: features.length,
        row: lineIndex + 1,
        contig: columns[0], start, end,
        type: 'variant', name: columns[2] === '.' ? '' : columns[2],
        score: columns[5], ref: columns[3], alt: columns[4].split(','),
        filter: columns[6], attributes: info
      });
    }
    if (!record?.contig) {
      warnings.push('Skipped line ' + (lineIndex + 1) + ': missing contig name.');
      continue;
    }
    if (!observedContigs.has(record.contig)) {
      if (observedContigs.size >= maxContigs) {
        if (!warnings.some((warning) => warning.includes('contig limit'))) {
          warnings.push('Records on additional contigs were skipped at the ' + maxContigs + ' contig limit.');
        }
        continue;
      }
      observedContigs.add(record.contig);
    }
    features.push(record);
  }
  if (truncated) warnings.push('Only the first ' + maxFeatures + ' genomic features were loaded.');
  if (!features.length && !contigMetadata.size) throw genomicError('No supported genomic records were found.');
  return finalizeDocument({
    format,
    features,
    declaredContigs: [...contigMetadata.values()],
    warnings,
    sequenceBases: 0,
    truncated
  });
}

function finalizeDocument({ format, contigs = [], declaredContigs = [], features, warnings, sequenceBases, truncated = false }) {
  const contigMap = new Map();
  for (const contig of [...declaredContigs, ...contigs]) {
    if (!contigMap.has(contig.name)) contigMap.set(contig.name, { ...contig });
    else contigMap.get(contig.name).length = Math.max(contigMap.get(contig.name).length ?? 0, contig.length ?? 0);
  }
  for (const feature of features) {
    const current = contigMap.get(feature.contig) ?? { name: feature.contig, length: 0 };
    current.length = Math.max(current.length ?? 0, feature.end);
    contigMap.set(feature.contig, current);
  }
  const normalizedContigs = [...contigMap.values()].map((contig, index) => ({
    index,
    name: contig.name,
    length: Math.max(1, Number(contig.length) || String(contig.sequence ?? '').length || 1),
    description: safeText(contig.description || '', 1_000),
    sequence: typeof contig.sequence === 'string' ? contig.sequence : null
  }));
  const contigOrder = new Map(normalizedContigs.map((contig) => [contig.name, contig.index]));
  features.sort((left, right) =>
    (contigOrder.get(left.contig) ?? Number.MAX_SAFE_INTEGER) -
      (contigOrder.get(right.contig) ?? Number.MAX_SAFE_INTEGER) ||
    left.start - right.start || left.end - right.end || left.row - right.row
  );
  const types = [...new Set(features.map((feature) => feature.type))].sort();
  return {
    format,
    contigs: normalizedContigs,
    features,
    warnings,
    stats: {
      contig_count: normalizedContigs.length,
      feature_count: features.length,
      sequence_bases_loaded: sequenceBases,
      types,
      truncated
    }
  };
}

function normalizedView(view) {
  const length = Math.max(1, Number(view?.length) || 1);
  let start = Math.max(0, Math.min(length - 1, Number(view?.start) || 0));
  let end = Math.max(start + 1, Math.min(length, Number(view?.end) || length));
  if (end > length) {
    start = Math.max(0, start - (end - length));
    end = length;
  }
  return { contig: String(view?.contig ?? ''), length, start, end };
}

export function fitGenomeView(document, contigName) {
  const contig = document?.contigs?.find((item) => item.name === contigName) ?? document?.contigs?.[0];
  if (!contig) return { contig: '', length: 1, start: 0, end: 1 };
  return { contig: contig.name, length: Math.max(1, contig.length), start: 0, end: Math.max(1, contig.length) };
}

export function genomePositionToCanvas(position, view, width, padding = 48) {
  const normalized = normalizedView(view);
  const canvasWidth = Math.max(1, Number(width) || 1);
  const safePadding = Math.max(0, Math.min(Number(padding) || 0, canvasWidth / 3));
  const inner = Math.max(1, canvasWidth - safePadding * 2);
  return safePadding + ((Number(position) - normalized.start) /
    Math.max(1, normalized.end - normalized.start)) * inner;
}

export function canvasToGenomePosition(x, view, width, padding = 48) {
  const normalized = normalizedView(view);
  const canvasWidth = Math.max(1, Number(width) || 1);
  const safePadding = Math.max(0, Math.min(Number(padding) || 0, canvasWidth / 3));
  const inner = Math.max(1, canvasWidth - safePadding * 2);
  const fraction = (Number(x) - safePadding) / inner;
  return normalized.start + fraction * (normalized.end - normalized.start);
}

export function zoomGenomeView(view, factor, anchorPosition) {
  const normalized = normalizedView(view);
  const multiplier = Number(factor);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return normalized;
  const span = normalized.end - normalized.start;
  const nextSpan = Math.max(1, Math.min(normalized.length, span * multiplier));
  const anchor = Math.max(normalized.start, Math.min(normalized.end,
    Number.isFinite(Number(anchorPosition)) ? Number(anchorPosition) : (normalized.start + normalized.end) / 2));
  const fraction = span > 0 ? (anchor - normalized.start) / span : 0.5;
  let start = anchor - nextSpan * fraction;
  let end = start + nextSpan;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > normalized.length) {
    start -= end - normalized.length;
    end = normalized.length;
  }
  return normalizedView({ ...normalized, start: Math.max(0, start), end });
}

export function panGenomeView(view, deltaBases) {
  const normalized = normalizedView(view);
  const span = normalized.end - normalized.start;
  let start = normalized.start + (Number(deltaBases) || 0);
  let end = start + span;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > normalized.length) {
    start -= end - normalized.length;
    end = normalized.length;
  }
  return normalizedView({ ...normalized, start: Math.max(0, start), end });
}

export function visibleGenomeFeatures(document, view, enabledTypes) {
  const normalized = normalizedView(view);
  const types = enabledTypes instanceof Set ? enabledTypes :
    Array.isArray(enabledTypes) ? new Set(enabledTypes) : null;
  return (document?.features ?? []).filter((feature) =>
    feature.contig === normalized.contig && feature.end > normalized.start &&
    feature.start < normalized.end && (!types || types.has(feature.type))
  );
}

export function nearestGenomeFeature(features, position, maximumDistance = Infinity) {
  const target = Number(position);
  if (!Number.isFinite(target)) return null;
  let nearest = null;
  for (const feature of features ?? []) {
    const distance = target < feature.start ? feature.start - target :
      target > feature.end ? target - feature.end : 0;
    if (distance <= maximumDistance && (!nearest || distance < nearest.distance ||
        (distance === nearest.distance && feature.end - feature.start < nearest.feature.end - nearest.feature.start))) {
      nearest = { feature, distance };
    }
  }
  return nearest;
}

export function genomeTicks(view, count = 6) {
  const normalized = normalizedView(view);
  const desired = Math.max(2, Math.min(20, Number(count) || 6));
  const rawStep = (normalized.end - normalized.start) / desired;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rawStep)));
  const normalizedStep = rawStep / magnitude;
  const multiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;
  const step = multiplier * magnitude;
  const first = Math.ceil(normalized.start / step) * step;
  const ticks = [];
  for (let value = first; value <= normalized.end && ticks.length < 64; value += step) ticks.push(value);
  return ticks;
}
