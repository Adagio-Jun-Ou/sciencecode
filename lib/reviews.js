import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import {
  getEvidenceManifest,
  listEvidence,
  readEvidencePages,
  readEvidenceSpans,
  verifyEvidence
} from './evidence.js';
import { sha256File, sha256Json, sha256Text } from './hash.js';
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
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

export const SEMANTIC_REVIEW_SCHEMA_VERSION = 1;
export const SEMANTIC_REVIEW_REPORT_SCHEMA_VERSION = 1;
export const MAX_SEMANTIC_REVIEW_BYTES = 8 * 1024 * 1024;
export const MAX_SEMANTIC_REVIEW_CLAIMS = 2_000;
export const MAX_SEMANTIC_REVIEW_FINDINGS = 5_000;
export const MAX_SEMANTIC_REVIEWS = 10_000;
export const MAX_SEMANTIC_REVIEW_REPORT_BYTES = 16 * 1024 * 1024;

const SEMANTIC_REVIEW_SETTINGS_V1 = Object.freeze({
  engine: 'sciencecode-deterministic-semantic-review',
  engine_version: 1,
  claim_extraction: 'bounded prose sentences with source line ranges',
  citation_resolution: 'ScienceCode evidence IDs, exact span IDs, page locators, and ingested DOI metadata',
  citation_alignment: 'deterministic lexical and literal-number triage; never a support/refutation verdict',
  calculations: 'explicit {{calc: arithmetic = expected}} directives only',
  artifact_checks: 'manifest-bound local link integrity, literal-number agreement, and figure/code traceability',
  maximum_claims: MAX_SEMANTIC_REVIEW_CLAIMS,
  maximum_findings: MAX_SEMANTIC_REVIEW_FINDINGS
});

export const SEMANTIC_REVIEW_SETTINGS = Object.freeze({
  ...SEMANTIC_REVIEW_SETTINGS_V1,
  engine_version: 2,
  claim_extraction: 'bounded prose sentences with source line ranges; fenced and indented code excluded'
});

function semanticReviewSettings(engineVersion) {
  if (engineVersion === 1) return SEMANTIC_REVIEW_SETTINGS_V1;
  if (engineVersion === SEMANTIC_REVIEW_SETTINGS.engine_version) return SEMANTIC_REVIEW_SETTINGS;
  return null;
}

const REVIEW_ID_PATTERN = /^review-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DOCUMENT_EXTENSIONS = new Set(['.markdown', '.md', '.mdx', '.rst', '.tex', '.txt']);
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const DATA_EXTENSIONS = new Set(['.csv', '.json', '.tsv', '.txt']);
const CODE_EXTENSIONS = new Set(['.ipynb', '.jl', '.js', '.m', '.py', '.r', '.rmd', '.ts']);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is',
  'it', 'its', 'may', 'might', 'not', 'of', 'on', 'or', 'our', 'should', 'that', 'the',
  'their', 'these', 'this', 'those', 'to', 'was', 'were', 'will', 'with', 'would'
]);
const CLAIM_SIGNALS = /\b(?:associated|association|caused?|causal|compared|decreas(?:e|ed|es|ing)|demonstrat(?:e|ed|es|ing)|effect|estimate|found|greater|higher|improv(?:e|ed|es|ing)|increas(?:e|ed|es|ing)|inferior|lower|mean|median|odds|prevalence|rate|reduc(?:e|ed|es|ing)|result|risk|significant|superior|support(?:s|ed)?|suggest(?:s|ed)?|yield(?:s|ed)?)\b/i;
const NEGATION = /\b(?:cannot|didn['’]t|doesn['’]t|failed to|lack(?:ed|s)?|neither|never|no|not|without)\b/i;

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function makeSemanticReviewId(now = new Date()) {
  return 'review-' + stamp(now) + '-' + crypto.randomBytes(4).toString('hex');
}

function normalizeReviewId(value) {
  const id = String(value ?? '');
  if (!REVIEW_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw Object.assign(new Error('Invalid semantic review ID: ' + id), {
      code: 'INVALID_REVIEW_ID'
    });
  }
  return id;
}

function reviewsRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  if (create) ensureScienceDir(project);
  const root = path.join(project, INTERNAL_DIR, 'reviews');
  if (create) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw Object.assign(new Error('Semantic review storage must be a real project directory.'), {
      code: 'INVALID_REVIEW_PATH'
    });
  }
  if (stat) {
    const science = fs.realpathSync(path.join(project, INTERNAL_DIR));
    const real = fs.realpathSync(root);
    if (!isPathInside(science, real)) {
      throw Object.assign(new Error('Semantic review storage escapes the project.'), {
        code: 'INVALID_REVIEW_PATH'
      });
    }
  }
  return root;
}

export function resolveSemanticReviewDirectory(cwd, value) {
  return path.join(reviewsRoot(cwd), normalizeReviewId(value));
}

function validateChat(cwd, value) {
  const chatId = String(value ?? '');
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw Object.assign(new Error('Invalid chat ID: ' + chatId), { code: 'INVALID_CHAT_ID' });
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

function compact(value, limit = 2_000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
}

function normalizeDoi(value) {
  return String(value ?? '').trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/[)\].,;:]+$/g, '');
}

function stripMarkup(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\(?:cite|ref|label|emph|textbf|textit)\{([^}]*)}/g, '$1')
    .replace(/[*_~\x60]+/g, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentToken(value) {
  let token = value.toLocaleLowerCase('en-US');
  if (token.length > 5 && token.endsWith('ing')) token = token.slice(0, -3);
  else if (token.length > 4 && token.endsWith('ed')) token = token.slice(0, -2);
  else if (token.length > 4 && token.endsWith('es')) token = token.slice(0, -2);
  else if (token.length > 3 && token.endsWith('s')) token = token.slice(0, -1);
  return token;
}

function semanticTokens(value) {
  return [...new Set(
    (String(value ?? '').match(/[\p{L}][\p{L}\p{N}-]{1,}/gu) ?? [])
      .map(contentToken)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  )];
}

function paragraphsFromText(value, { excludeIndentedCode = true } = {}) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = [];
  let buffer = [];
  let start = 1;
  let fenced = false;
  let references = false;
  const flush = () => {
    if (!buffer.length) return;
    paragraphs.push({
      raw: buffer.join(' ').replace(/\s+/g, ' ').trim(),
      line_start: start,
      line_end: start + buffer.length - 1
    });
    buffer = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (/^(?:\x60{3,}|~{3,})/.test(trimmed)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (excludeIndentedCode && /^(?: {4}|\t)/.test(raw)) {
      flush();
      continue;
    }
    if (/^(?:#{1,6}\s*|\\section\*?\{|={2,}\s*)(?:references|bibliography)\b/i.test(trimmed)) {
      flush();
      references = true;
      continue;
    }
    if (references) continue;
    if (!trimmed || /^(?:#{1,6}\s|[-=]{3,}\s*$|\.\.\s+\w+::|\\(?:begin|end)\{)/.test(trimmed) ||
        (/^\|.*\|$/.test(trimmed) && trimmed.split('|').length > 3)) {
      flush();
      continue;
    }
    if (!buffer.length) start = index + 1;
    buffer.push(trimmed);
  }
  flush();
  return { lines, paragraphs };
}

function splitSentences(paragraph) {
  const pieces = paragraph.raw
    .split(/(?<=[.!?])\s+(?=(?:["'“‘([]?[A-Z0-9]))/)
    .map((value) => value.trim())
    .filter(Boolean);
  return pieces.length ? pieces : [paragraph.raw];
}

function requiresCitation(text) {
  const withoutLocators = text
    .replace(/evidence-[A-Za-z0-9][A-Za-z0-9._-]*(?::p\d{4}:s\d{4})?/g, '')
    .replace(/\b(?:page|p\.?)\s*\d+\b/gi, '');
  return CLAIM_SIGNALS.test(withoutLocators) ||
    extractNumericLiterals(withoutLocators).some((item) => item.kind !== 'year');
}

export function extractScientificClaims(value, {
  maximumClaims = MAX_SEMANTIC_REVIEW_CLAIMS,
  engineVersion = SEMANTIC_REVIEW_SETTINGS.engine_version
} = {}) {
  const maximum = Math.min(MAX_SEMANTIC_REVIEW_CLAIMS, Math.max(1, Number(maximumClaims) || 1));
  const settings = semanticReviewSettings(engineVersion);
  if (!settings) {
    throw Object.assign(new Error('Unsupported semantic review engine version: ' + engineVersion), {
      code: 'UNSUPPORTED_REVIEW_ENGINE'
    });
  }
  const parsed = paragraphsFromText(value, { excludeIndentedCode: engineVersion >= 2 });
  const claims = [];
  let truncated = false;
  for (const paragraph of parsed.paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      const proseWithoutLinks = sentence
        .replace(/!?\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/\\includegraphics(?:\[[^\]]*])?\{[^}]+}/g, ' ')
        .trim();
      if (!proseWithoutLinks) continue;
      const text = stripMarkup(sentence);
      if (text.length < 18 || /^https?:\/\//i.test(text) ||
          /^(?:note|todo)\s*:/i.test(text) || /^\{\{calc:/i.test(text)) continue;
      if (claims.length >= maximum) {
        truncated = true;
        break;
      }
      const numbers = extractNumericLiterals(text);
      const claim = {
        claim_id: 'claim-' + String(claims.length + 1).padStart(4, '0'),
        text: compact(text),
        source_text_sha256: sha256Text(sentence),
        line_start: paragraph.line_start,
        line_end: paragraph.line_end,
        kind: numbers.length ? 'quantitative' : CLAIM_SIGNALS.test(text) ? 'scientific' : 'statement',
        requires_citation: requiresCitation(text),
        negated: NEGATION.test(text),
        numbers
      };
      claims.push(claim);
    }
    if (truncated) break;
  }
  return {
    claims,
    truncated,
    source_lines: parsed.lines.length,
    source_sha256: sha256Text(String(value ?? ''))
  };
}

function normalizeUnit(value) {
  const unit = String(value ?? '').trim().toLowerCase();
  if (unit === 'percent' || unit === 'percentage' || unit === 'pct') return '%';
  return unit.replace(/μ/g, 'u');
}

export function extractNumericLiterals(value, { maximum = 4_000 } = {}) {
  const cleaned = String(value ?? '')
    .replace(/evidence-[A-Za-z0-9][A-Za-z0-9._-]*(?::p\d{4}:s\d{4})?/g, ' ')
    .replace(/\b10\.\d{4,9}\/\S+/gi, ' ')
    .replace(/\b(?:page|p\.?)\s*\d+\b/gi, ' ');
  const pattern = /(^|[^\p{L}\p{N}])([-+]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[-+]?\d+)?)\s*(%|percent(?:age)?|pct|ms|s|min|h|hr|day|days|kg|g|mg|ug|μg|ng|l|ml|ul|μl|m|cm|mm|um|μm|nm|mol|mmol|umol|μmol|nmol|hz|khz|mhz|pa|kpa|mpa|°c|c|k)?\b/giu;
  const results = [];
  let match;
  while ((match = pattern.exec(cleaned)) && results.length < maximum) {
    const raw = match[2];
    const valueNumber = Number(raw.replaceAll(',', ''));
    if (!Number.isFinite(valueNumber)) continue;
    const unit = normalizeUnit(match[3]);
    results.push({
      raw: raw + (match[3] ? ' ' + match[3] : ''),
      value: valueNumber,
      unit: unit || null,
      kind: !unit && Number.isInteger(valueNumber) && valueNumber >= 1800 && valueNumber <= 2100
        ? 'year' : 'measurement'
    });
  }
  return results;
}

function nearlyEqual(left, right, tolerance = 1e-9) {
  return Math.abs(left - right) <= Math.max(tolerance, Math.abs(right) * 1e-6);
}

function numericEquivalent(left, right) {
  if (left.unit === right.unit && nearlyEqual(left.value, right.value)) return true;
  if (left.unit === '%' && !right.unit && nearlyEqual(left.value / 100, right.value)) return true;
  if (!left.unit && right.unit === '%' && nearlyEqual(left.value, right.value / 100)) return true;
  return false;
}

function arithmeticTokens(value) {
  const tokens = String(value ?? '').match(/(?:\d+(?:\.\d+)?(?:e[-+]?\d+)?)|[()+\-*/^]/gi) ?? [];
  const compacted = String(value ?? '').replace(/\s+/g, '');
  if (tokens.join('') !== compacted || tokens.length > 128) {
    throw Object.assign(new Error('Calculation contains unsupported tokens.'), {
      code: 'INVALID_CALCULATION'
    });
  }
  return tokens;
}

export function evaluateArithmetic(value) {
  const tokens = arithmeticTokens(value);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const primary = () => {
    if (take() === '(') {
      const result = expression();
      if (take() !== ')') throw new Error('Missing closing parenthesis.');
      return result;
    }
    index -= 1;
    const token = take();
    if (token === '+' || token === '-') {
      const result = primary();
      return token === '-' ? -result : result;
    }
    const result = Number(token);
    if (!Number.isFinite(result)) throw new Error('Expected a finite number.');
    return result;
  };
  const power = () => {
    let result = primary();
    while (peek() === '^') {
      take();
      const exponent = primary();
      if (Math.abs(exponent) > 32) throw new Error('Exponent exceeds the review limit.');
      result = result ** exponent;
    }
    return result;
  };
  const product = () => {
    let result = power();
    while (peek() === '*' || peek() === '/') {
      const operator = take();
      const right = power();
      if (operator === '/' && right === 0) throw new Error('Division by zero.');
      result = operator === '*' ? result * right : result / right;
    }
    return result;
  };
  const expression = () => {
    let result = product();
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = product();
      result = operator === '+' ? result + right : result - right;
    }
    return result;
  };
  if (!tokens.length) throw Object.assign(new Error('Calculation is empty.'), { code: 'INVALID_CALCULATION' });
  try {
    const result = expression();
    if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Calculation is incomplete or non-finite.');
    return result;
  } catch (error) {
    if (error.code) throw error;
    throw Object.assign(new Error(error.message), { code: 'INVALID_CALCULATION' });
  }
}

function lineAtOffset(value, offset) {
  return String(value ?? '').slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function citationLocators(value) {
  const text = String(value ?? '');
  const locators = [];
  const spanIds = new Set();
  for (const match of text.matchAll(/evidence-[A-Za-z0-9][A-Za-z0-9._-]*:p(\d{4}):s(\d{4})/g)) {
    const spanId = match[0];
    const evidenceId = spanId.slice(0, spanId.indexOf(':p'));
    spanIds.add(spanId);
    locators.push({
      kind: 'sciencecode-span',
      evidence_id: evidenceId,
      span_id: spanId,
      page: Number(match[1])
    });
  }
  const evidenceIds = new Set();
  for (const match of text.matchAll(/evidence-[A-Za-z0-9][A-Za-z0-9._-]*/g)) {
    let evidenceId = match[0].split(':p')[0].replace(/[.,;]+$/g, '');
    if (!evidenceId || evidenceIds.has(evidenceId) ||
        [...spanIds].some((spanId) => spanId.startsWith(evidenceId + ':'))) continue;
    evidenceIds.add(evidenceId);
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 96);
    const page = tail.match(/(?:^|[\s,;·(])(?:page|p\.?)\s*[:#]?\s*(\d{1,7})/i);
    locators.push({
      kind: 'sciencecode-evidence',
      evidence_id: evidenceId,
      span_id: null,
      page: page ? Number(page[1]) : null
    });
  }
  const dois = new Set();
  for (const match of text.matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi)) {
    const doi = normalizeDoi(match[0]);
    if (!doi || dois.has(doi)) continue;
    dois.add(doi);
    locators.push({ kind: 'doi', doi, evidence_id: null, span_id: null, page: null });
  }
  return locators;
}

function numericCitationSyntax(value) {
  return /(?:^|[\s(])\[(?:\d{1,4}(?:\s*[-,]\s*\d{1,4})*)](?=$|[\s).,;])/m.test(String(value ?? ''));
}

function evidenceCatalog(cwd) {
  const byId = new Map();
  const byDoi = new Map();
  for (const summary of listEvidence(cwd)) {
    let manifest = null;
    try {
      manifest = getEvidenceManifest(cwd, summary.evidence_id);
    } catch {
      // The verifier below reports unreadable records when a claim cites them.
    }
    const item = { summary, manifest };
    byId.set(summary.evidence_id, item);
    const doi = normalizeDoi(manifest?.bibliography?.doi);
    if (doi && !byDoi.has(doi)) byDoi.set(doi, item);
  }
  return { byId, byDoi };
}

function lexicalAlignment(claim, evidenceText) {
  const claimText = claim.text
    .replace(/evidence-[A-Za-z0-9][A-Za-z0-9._-]*(?::p\d{4}:s\d{4})?/g, ' ')
    .replace(/\b10\.\d{4,9}\/\S+/gi, ' ')
    .replace(/\b(?:page|p\.?)\s*\d+\b/gi, ' ');
  const claimTokens = semanticTokens(claimText);
  const evidenceTokens = new Set(semanticTokens(evidenceText));
  const overlap = claimTokens.filter((token) => evidenceTokens.has(token));
  const score = claimTokens.length ? overlap.length / claimTokens.length : 0;
  const evidenceNumbers = extractNumericLiterals(evidenceText);
  const relevantNumbers = claim.numbers.filter((item) => item.kind !== 'year');
  const matchedNumbers = relevantNumbers.filter((number) =>
    evidenceNumbers.some((candidate) => numericEquivalent(number, candidate))
  );
  const missingNumbers = relevantNumbers.filter((number) =>
    !evidenceNumbers.some((candidate) => numericEquivalent(number, candidate))
  );
  return {
    score: Number(score.toFixed(6)),
    label: score >= 0.45 ? 'strong_lexical_overlap'
      : score >= 0.22 ? 'partial_lexical_overlap'
        : 'weak_lexical_overlap',
    overlapping_terms: overlap.slice(0, 24),
    claim_term_count: claimTokens.length,
    matched_numbers: matchedNumbers,
    missing_numbers: missingNumbers,
    negation_mismatch: claim.negated !== NEGATION.test(evidenceText)
  };
}

function bestEvidenceSpan(claim, spans) {
  return [...spans].map((span) => ({
    span,
    alignment: lexicalAlignment(claim, span.text)
  })).sort((left, right) =>
    right.alignment.score - left.alignment.score ||
    String(left.span.span_id).localeCompare(String(right.span.span_id))
  )[0] ?? null;
}

function resolveClaimCitation(cwd, claim, locator, catalog) {
  const catalogItem = locator.kind === 'doi'
    ? catalog.byDoi.get(locator.doi)
    : catalog.byId.get(locator.evidence_id);
  if (!catalogItem) {
    return {
      locator,
      ok: false,
      issue: locator.kind === 'doi' ? 'doi_not_ingested' : 'evidence_not_found'
    };
  }
  const evidenceId = catalogItem.summary.evidence_id;
  const verification = verifyEvidence(cwd, evidenceId);
  if (!verification.ok) {
    return {
      locator: { ...locator, evidence_id: evidenceId },
      ok: false,
      issue: 'evidence_integrity_failed',
      verification_errors: verification.errors.slice(0, 12)
    };
  }
  const manifest = verification.manifest ?? catalogItem.manifest;
  const spans = readEvidenceSpans(cwd, evidenceId);
  const pages = readEvidencePages(cwd, evidenceId);
  let candidates;
  let locatorStatus;
  if (locator.span_id) {
    candidates = spans.filter((span) => span.span_id === locator.span_id);
    locatorStatus = 'exact_span';
  } else if (locator.page) {
    candidates = spans.filter((span) => span.page === locator.page);
    locatorStatus = 'page';
  } else {
    candidates = spans;
    locatorStatus = 'record';
  }
  if (!candidates.length) {
    return {
      locator: { ...locator, evidence_id: evidenceId },
      ok: false,
      issue: locator.span_id ? 'span_not_found' : locator.page ? 'page_not_found' : 'evidence_has_no_spans'
    };
  }
  const selected = bestEvidenceSpan(claim, candidates);
  const page = pages.find((item) => item.page === selected.span.page);
  return {
    locator: { ...locator, evidence_id: evidenceId },
    ok: true,
    evidence_id: evidenceId,
    evidence_manifest_sha256: verification.manifest_sha256,
    bibliography: {
      title: manifest?.bibliography?.title ?? evidenceId,
      year: manifest?.bibliography?.year ?? null,
      doi: manifest?.bibliography?.doi ?? null
    },
    locator_status: locatorStatus,
    page: selected.span.page,
    page_sha256: page?.text_sha256 ?? null,
    span_id: selected.span.span_id,
    span_sha256: selected.span.text_sha256,
    evidence_excerpt: compact(selected.span.text, 720),
    alignment: selected.alignment,
    interpretation: 'triage_only_not_scientific_entailment'
  };
}

function addReviewFinding(state, values) {
  if (state.findings.length >= MAX_SEMANTIC_REVIEW_FINDINGS) {
    state.findings_truncated = true;
    return null;
  }
  const finding = {
    finding_id: 'finding-' + String(state.findings.length + 1).padStart(5, '0'),
    severity: values.severity,
    category: values.category,
    code: values.code,
    message: compact(values.message, 600),
    claim_id: values.claim_id ?? null,
    line_start: values.line_start ?? null,
    ...Object.fromEntries(Object.entries(values).filter(([key]) =>
      !['severity', 'category', 'code', 'message', 'claim_id', 'line_start'].includes(key)
    ))
  };
  state.findings.push(finding);
  return finding;
}

function reviewCitations(cwd, claims, state) {
  const catalog = evidenceCatalog(cwd);
  const citations = [];
  for (const claim of claims) {
    const locators = citationLocators(claim.text);
    claim.citation_count = locators.length;
    claim.citation_ids = [];
    if (!locators.length && claim.requires_citation) {
      addReviewFinding(state, {
        severity: 'warning',
        category: 'citation',
        code: numericCitationSyntax(claim.text)
          ? 'numeric_citation_unresolved' : 'claim_missing_citation',
        message: numericCitationSyntax(claim.text)
          ? 'The claim uses a numeric citation style that is not bound to an ingested ScienceCode evidence record.'
          : 'This scientific or quantitative claim has no resolvable ScienceCode evidence ID, span ID, or ingested DOI.',
        claim_id: claim.claim_id,
        line_start: claim.line_start
      });
    }
    for (const locator of locators) {
      const result = resolveClaimCitation(cwd, claim, locator, catalog);
      const citationId = 'citation-' + String(citations.length + 1).padStart(5, '0');
      const citation = { citation_id: citationId, claim_id: claim.claim_id, ...result };
      citations.push(citation);
      claim.citation_ids.push(citationId);
      if (!result.ok) {
        addReviewFinding(state, {
          severity: 'error',
          category: 'citation',
          code: result.issue,
          message: 'Citation could not be verified: ' + result.issue.replaceAll('_', ' ') + '.',
          claim_id: claim.claim_id,
          line_start: claim.line_start,
          evidence_id: result.locator?.evidence_id ?? null,
          doi: result.locator?.doi ?? null
        });
        continue;
      }
      if (result.alignment.label === 'weak_lexical_overlap') {
        addReviewFinding(state, {
          severity: 'warning',
          category: 'citation',
          code: 'weak_claim_citation_overlap',
          message: 'The cited passage has weak deterministic lexical overlap with the claim; a qualified human or independent model must inspect support and scope.',
          claim_id: claim.claim_id,
          line_start: claim.line_start,
          citation_id: citationId,
          evidence_id: result.evidence_id,
          span_id: result.span_id
        });
      }
      if (result.alignment.missing_numbers.length) {
        addReviewFinding(state, {
          severity: 'warning',
          category: 'number',
          code: 'cited_number_not_found',
          message: 'One or more literal claim numbers were not found in the selected cited passage.',
          claim_id: claim.claim_id,
          line_start: claim.line_start,
          citation_id: citationId,
          evidence_id: result.evidence_id,
          missing_numbers: result.alignment.missing_numbers.slice(0, 16)
        });
      }
      if (result.alignment.negation_mismatch) {
        addReviewFinding(state, {
          severity: 'warning',
          category: 'citation',
          code: 'possible_negation_mismatch',
          message: 'Claim and cited passage use different explicit negation polarity; inspect the exact wording.',
          claim_id: claim.claim_id,
          line_start: claim.line_start,
          citation_id: citationId,
          evidence_id: result.evidence_id
        });
      }
    }
  }
  return citations;
}

function reviewCalculations(value, state) {
  const calculations = [];
  for (const match of String(value ?? '').matchAll(/\{\{calc:\s*([^{}\r\n]{1,500})\}\}/gi)) {
    const calculationId = 'calculation-' + String(calculations.length + 1).padStart(4, '0');
    const raw = match[1].trim();
    const equals = raw.lastIndexOf('=');
    let result;
    if (equals <= 0 || equals === raw.length - 1) {
      result = {
        calculation_id: calculationId,
        raw,
        line: lineAtOffset(value, match.index),
        status: 'invalid',
        issue: 'expected_expression_equals_value'
      };
    } else {
      const expression = raw.slice(0, equals).trim();
      const expectedText = raw.slice(equals + 1).trim();
      const expected = Number(expectedText);
      try {
        if (!Number.isFinite(expected) || !/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(expectedText)) {
          throw Object.assign(new Error('Expected value must be one finite literal number.'), {
            code: 'INVALID_CALCULATION'
          });
        }
        const actual = evaluateArithmetic(expression);
        result = {
          calculation_id: calculationId,
          raw,
          line: lineAtOffset(value, match.index),
          expression,
          expected,
          actual,
          delta: actual - expected,
          status: nearlyEqual(actual, expected) ? 'pass' : 'mismatch'
        };
      } catch (error) {
        result = {
          calculation_id: calculationId,
          raw,
          line: lineAtOffset(value, match.index),
          expression,
          expected: Number.isFinite(expected) ? expected : null,
          status: 'invalid',
          issue: error.code ?? 'invalid_calculation',
          detail: compact(error.message, 240)
        };
      }
    }
    calculations.push(result);
    if (result.status !== 'pass') {
      addReviewFinding(state, {
        severity: result.status === 'mismatch' ? 'error' : 'warning',
        category: 'calculation',
        code: result.status === 'mismatch' ? 'calculation_mismatch' : 'calculation_invalid',
        message: result.status === 'mismatch'
          ? 'The explicit arithmetic directive does not equal its recorded expected value.'
          : 'The explicit arithmetic directive could not be evaluated safely.',
        line_start: result.line,
        calculation_id: result.calculation_id
      });
    }
  }
  return calculations;
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

export function resolveSemanticReviewTarget(cwd, { source, revisionId } = {}) {
  const project = path.resolve(cwd);
  if (revisionId !== undefined && revisionId !== null && String(revisionId).trim()) {
    const revision = resolveArtifactRevision(project, revisionId);
    const manifest = revision.manifest;
    return {
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
  }
  const resolved = resolveRevisionSourceArtifact(project, source);
  const selectorSource = {
    kind: resolved.kind,
    record_id: resolved.record_id,
    name: resolved.name,
    url: resolved.url,
    sha256: resolved.sha256
  };
  return {
    ...publicResolvedTarget(resolved, { source: selectorSource }),
    file: resolved.file
  };
}

function decodeReviewText(target) {
  if (!DOCUMENT_EXTENSIONS.has(path.extname(target.name).toLowerCase())) {
    throw Object.assign(new Error('Semantic review supports Markdown, MDX, reStructuredText, TeX, and plain-text manuscripts.'), {
      code: 'UNSUPPORTED_REVIEW_FORMAT'
    });
  }
  if (!Number.isInteger(target.bytes) || target.bytes < 0 || target.bytes > MAX_SEMANTIC_REVIEW_BYTES) {
    throw Object.assign(new Error('Semantic review sources are limited to ' + MAX_SEMANTIC_REVIEW_BYTES + ' bytes.'), {
      code: 'REVIEW_SOURCE_TOO_LARGE'
    });
  }
  const bytes = fs.readFileSync(target.file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw Object.assign(new Error('Semantic review sources must be valid UTF-8 text.'), {
      code: 'INVALID_REVIEW_ENCODING'
    });
  }
  const secrets = scanSecrets(text);
  if (secrets.length) {
    throw Object.assign(new Error('Potential secret detected in the review source; refusing to duplicate it into a review report.'), {
      code: 'SECRET_DETECTED',
      findings: secrets
    });
  }
  return text;
}

function documentLinks(value) {
  const links = [];
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const add = (rawTarget, label, line, explicitFigure = false) => {
    const target = String(rawTarget ?? '').trim().replace(/^<|>$/g, '').replaceAll('&amp;', '&');
    if (!target || target.startsWith('#')) return;
    const cleanTarget = target.replace(/^["']|["']$/g, '');
    const extension = path.extname(cleanTarget.split(/[?#]/)[0]).toLowerCase();
    const kind = explicitFigure || IMAGE_EXTENSIONS.has(extension)
      ? 'figure' : DATA_EXTENSIONS.has(extension)
        ? 'data' : CODE_EXTENSIONS.has(extension)
          ? 'code' : 'reference';
    const key = [cleanTarget, line, kind].join('\n');
    if (links.some((item) => item.key === key)) return;
    links.push({ key, target: cleanTarget, label: compact(label, 240), line, kind, extension });
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const match of line.matchAll(/(!?)\[([^\]]*)]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
      add(match[3], match[2], index + 1, match[1] === '!');
    }
    for (const match of line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      const alt = match[0].match(/\balt=["']([^"']*)["']/i);
      add(match[1], alt?.[1] ?? '', index + 1, true);
    }
    for (const match of line.matchAll(/\\includegraphics(?:\[[^\]]*])?\{([^}]+)}/g)) {
      add(match[1], 'LaTeX figure', index + 1, true);
    }
  }
  return links.map(({ key: _key, ...link }) => link);
}

function baseSourceUrl(target) {
  return target.kind === 'revision' && target.source?.url ? target.source.url : target.url;
}

function canonicalLocalLink(target, raw) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null;
  try {
    const resolved = new URL(raw, 'http://sciencecode.local' + baseSourceUrl(target));
    if (resolved.origin !== 'http://sciencecode.local') return null;
    return resolved.pathname;
  } catch {
    return null;
  }
}

function resolveLinkedArtifact(cwd, target, link) {
  if (/^https?:\/\//i.test(link.target) || link.target.startsWith('//')) {
    return { ...link, status: 'external_unfrozen', url: link.target };
  }
  const url = canonicalLocalLink(target, link.target);
  if (!url) return { ...link, status: 'not_manifest_bound', url: null };
  try {
    if (url.startsWith('/revision-artifact/')) {
      const encoded = url.slice('/revision-artifact/'.length);
      if (!encoded || encoded.includes('/')) throw new Error('Malformed revision artifact URL.');
      const revisionId = decodeURIComponent(encoded);
      const resolved = resolveSemanticReviewTarget(cwd, { revisionId });
      return {
        ...link,
        status: 'verified',
        url: resolved.url,
        artifact: {
          kind: resolved.kind,
          record_id: resolved.record_id,
          name: resolved.name,
          sha256: resolved.sha256,
          bytes: resolved.bytes,
          media_type: resolved.media_type
        },
        file: resolved.file
      };
    }
    const resolved = resolveRevisionSourceArtifact(cwd, { url });
    return {
      ...link,
      status: 'verified',
      url: resolved.url,
      artifact: {
        kind: resolved.kind,
        record_id: resolved.record_id,
        name: resolved.name,
        sha256: resolved.sha256,
        bytes: resolved.bytes,
        media_type: resolved.media_type
      },
      file: resolved.file
    };
  } catch (error) {
    return {
      ...link,
      status: 'not_manifest_bound',
      url,
      issue: error.code ?? 'artifact_resolution_failed',
      detail: compact(error.message, 240)
    };
  }
}

function publicLinkedArtifact(value) {
  const { file: _file, ...publicValue } = value;
  return publicValue;
}

function linkedClaim(claims, line) {
  return claims.find((claim) => line >= claim.line_start && line <= claim.line_end) ?? null;
}

function reviewArtifacts(cwd, text, target, claims, state) {
  const resolved = documentLinks(text)
    .filter((link) => link.kind !== 'reference')
    .map((link) => resolveLinkedArtifact(cwd, target, link));
  const code = resolved.filter((item) => item.kind === 'code' && item.status === 'verified');
  const figures = resolved.filter((item) => item.kind === 'figure');
  const data = resolved.filter((item) => item.kind === 'data');
  for (const artifact of [...figures, ...data, ...resolved.filter((item) => item.kind === 'code')]) {
    if (artifact.status === 'verified') continue;
    addReviewFinding(state, {
      severity: artifact.status === 'external_unfrozen' ? 'warning' : 'error',
      category: 'artifact',
      code: artifact.status === 'external_unfrozen'
        ? 'external_artifact_not_frozen' : 'artifact_not_manifest_bound',
      message: artifact.status === 'external_unfrozen'
        ? 'A linked scientific artifact is external and is not frozen in the project record.'
        : 'A linked scientific artifact could not be resolved to a verified immutable ScienceCode artifact.',
      line_start: artifact.line,
      target: artifact.target,
      artifact_kind: artifact.kind
    });
  }
  const figureNumbers = new Set();
  for (let index = 0; index < figures.length; index += 1) {
    const figure = figures[index];
    figure.figure_id = 'figure-' + String(index + 1).padStart(3, '0');
    figureNumbers.add(String(index + 1));
    const labelNumber = figure.label.match(/\b(?:fig(?:ure)?\.?)\s*(\d+[a-z]?)/i);
    if (labelNumber) figureNumbers.add(labelNumber[1].toLowerCase());
    figure.code_links = code
      .filter((item) => Math.abs(item.line - figure.line) <= 8)
      .map((item) => ({ url: item.url, name: item.artifact.name, sha256: item.artifact.sha256 }));
    figure.traceability = figure.status !== 'verified'
      ? 'unresolved' : figure.code_links.length ? 'artifact_and_code_linked' : 'artifact_only';
    figure.agreement = 'not_evaluated_requires_code_or_visual_rerun';
    if (figure.status === 'verified' && !figure.code_links.length) {
      addReviewFinding(state, {
        severity: 'warning',
        category: 'figure',
        code: 'figure_without_explicit_code_link',
        message: 'The figure is immutable and verified, but no manifest-bound code link appears within eight source lines; visual/code agreement remains untraceable from this manuscript.',
        line_start: figure.line,
        figure_id: figure.figure_id,
        artifact_url: figure.url
      });
    }
  }
  for (const claim of claims) {
    for (const match of claim.text.matchAll(/\b(?:figure|fig\.)\s*(\d+[a-z]?)/gi)) {
      const number = match[1].toLowerCase();
      if (!figureNumbers.has(number)) {
        addReviewFinding(state, {
          severity: 'warning',
          category: 'figure',
          code: 'figure_reference_unresolved',
          message: 'The manuscript references Figure ' + number + ', but no matching linked figure was found.',
          claim_id: claim.claim_id,
          line_start: claim.line_start,
          figure_reference: number
        });
      }
    }
  }
  for (let index = 0; index < data.length; index += 1) {
    const artifact = data[index];
    artifact.data_id = 'data-' + String(index + 1).padStart(3, '0');
    artifact.literal_number_check = 'not_checked';
    if (artifact.status !== 'verified' || artifact.artifact.bytes > 2 * 1024 * 1024) continue;
    const claim = linkedClaim(claims, artifact.line);
    if (!claim) continue;
    const claimNumbers = claim.numbers.filter((item) => item.kind !== 'year');
    if (!claimNumbers.length) continue;
    let artifactText;
    try {
      artifactText = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(artifact.file));
    } catch {
      artifact.literal_number_check = 'non_utf8_or_unreadable';
      continue;
    }
    const artifactNumbers = extractNumericLiterals(artifactText, { maximum: 20_000 });
    const missing = claimNumbers.filter((number) =>
      !artifactNumbers.some((candidate) => numericEquivalent(number, candidate))
    );
    artifact.literal_number_check = missing.length ? 'mismatch' : 'match';
    artifact.claim_id = claim.claim_id;
    artifact.missing_numbers = missing.slice(0, 16);
    if (missing.length) {
      addReviewFinding(state, {
        severity: 'warning',
        category: 'number',
        code: 'linked_data_number_not_found',
        message: 'A literal number in the claim was not found in its linked small text/JSON/tabular artifact.',
        claim_id: claim.claim_id,
        line_start: claim.line_start,
        data_id: artifact.data_id,
        artifact_url: artifact.url,
        missing_numbers: missing.slice(0, 16)
      });
    }
  }
  return {
    figures: figures.map(publicLinkedArtifact),
    data: data.map(publicLinkedArtifact),
    code: code.map(publicLinkedArtifact),
    counts: {
      figures: figures.length,
      data: data.length,
      code: code.length,
      verified: resolved.filter((item) => item.status === 'verified').length,
      unresolved: resolved.filter((item) => item.status !== 'verified').length
    }
  };
}

export function analyzeScientificDocument({
  cwd,
  text,
  target,
  engineVersion = SEMANTIC_REVIEW_SETTINGS.engine_version
}) {
  const project = path.resolve(cwd);
  const settings = semanticReviewSettings(engineVersion);
  if (!settings) {
    throw Object.assign(new Error('Unsupported semantic review engine version: ' + engineVersion), {
      code: 'UNSUPPORTED_REVIEW_ENGINE'
    });
  }
  const extraction = extractScientificClaims(text, { engineVersion });
  const state = { findings: [], findings_truncated: false };
  if (extraction.truncated) {
    addReviewFinding(state, {
      severity: 'warning',
      category: 'scope',
      code: 'claim_limit_reached',
      message: 'Claim extraction reached the fixed review limit; later prose was not analyzed.'
    });
  }
  const citations = reviewCitations(project, extraction.claims, state);
  const calculations = reviewCalculations(text, state);
  const artifacts = reviewArtifacts(project, text, target, extraction.claims, state);
  if (!extraction.claims.length) {
    addReviewFinding(state, {
      severity: 'info',
      category: 'scope',
      code: 'no_reviewable_claims',
      message: 'No bounded prose claims were detected in this document.'
    });
  }
  if (state.findings_truncated) {
    state.findings.push({
      finding_id: 'finding-truncated',
      severity: 'warning',
      category: 'scope',
      code: 'finding_limit_reached',
      message: 'The fixed review finding limit was reached; additional findings were omitted.',
      claim_id: null,
      line_start: null
    });
  }
  const severity = {
    errors: state.findings.filter((item) => item.severity === 'error').length,
    warnings: state.findings.filter((item) => item.severity === 'warning').length,
    info: state.findings.filter((item) => item.severity === 'info').length
  };
  const status = severity.errors ? 'fail' : severity.warnings ? 'review' : 'pass';
  return {
    schema_version: SEMANTIC_REVIEW_REPORT_SCHEMA_VERSION,
    engine: settings.engine,
    engine_version: settings.engine_version,
    settings,
    settings_sha256: sha256Json(settings),
    target_sha256: target.sha256,
    source_sha256: extraction.source_sha256,
    status,
    summary: {
      status,
      claims: extraction.claims.length,
      claims_requiring_citation: extraction.claims.filter((claim) => claim.requires_citation).length,
      claims_with_citations: extraction.claims.filter((claim) => claim.citation_count > 0).length,
      citations: citations.length,
      verified_citations: citations.filter((citation) => citation.ok).length,
      calculations: calculations.length,
      calculations_passed: calculations.filter((item) => item.status === 'pass').length,
      figures: artifacts.counts.figures,
      linked_data: artifacts.counts.data,
      linked_code: artifacts.counts.code,
      findings: state.findings.length,
      ...severity,
      source_lines: extraction.source_lines,
      claims_truncated: extraction.truncated,
      findings_truncated: state.findings_truncated
    },
    claims: extraction.claims,
    citations,
    calculations,
    artifacts,
    findings: state.findings,
    limitations: [
      'Lexical overlap and literal-number matching are deterministic triage signals, not proof that a source supports or refutes a claim.',
      'Only ScienceCode evidence IDs, exact span IDs, page locators, and ingested DOI metadata are resolvable; numeric bibliography styles require an explicit mapping.',
      'Only explicit {{calc: arithmetic = expected}} directives are evaluated; equations with variables, statistics, and domain assumptions require independent review.',
      'Figure checks verify immutable links and nearby code traceability. They do not compare pixels with a rerun or prove that plotting code produced the displayed scientific interpretation.',
      'Linked-data checks compare literal values in bounded UTF-8 CSV, TSV, JSON, or text artifacts. They do not infer units, transformations, rounding policy, or statistical validity.'
    ]
  };
}

function reviewFiles(cwd, value) {
  const reviewId = normalizeReviewId(value);
  const directory = resolveSemanticReviewDirectory(cwd, reviewId);
  return {
    review_id: reviewId,
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    report: path.join(directory, 'report.json')
  };
}

function safeReviewDirectory(cwd, value) {
  const root = reviewsRoot(cwd);
  const files = reviewFiles(cwd, value);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw Object.assign(new Error('Semantic review not found: ' + files.review_id), {
      code: 'REVIEW_NOT_FOUND'
    });
  }
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw Object.assign(new Error('Semantic review storage is unavailable.'), {
      code: 'INVALID_REVIEW_PATH'
    });
  }
  const rootReal = fs.realpathSync(root);
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(rootReal, directoryReal)) {
    throw Object.assign(new Error('Semantic review escapes its storage root.'), {
      code: 'INVALID_REVIEW_PATH'
    });
  }
  for (const file of [files.manifest, files.digest, files.report]) {
    const fileStat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!fileStat?.isFile() || fileStat.isSymbolicLink() ||
        !isPathInside(directoryReal, fs.realpathSync(file))) {
      throw Object.assign(new Error('Semantic review file is missing or unsafe: ' + path.basename(file)), {
        code: 'REVIEW_INVALID'
      });
    }
  }
  return { ...files, directory: directoryReal };
}

export function getSemanticReviewManifest(cwd, value) {
  const files = safeReviewDirectory(cwd, value);
  return readJson(files.manifest);
}

export function getSemanticReviewReport(cwd, value) {
  const files = safeReviewDirectory(cwd, value);
  if (fs.statSync(files.report).size > MAX_SEMANTIC_REVIEW_REPORT_BYTES) {
    throw Object.assign(new Error('Semantic review report exceeds the safe read limit.'), {
      code: 'REVIEW_REPORT_TOO_LARGE'
    });
  }
  return readJson(files.report);
}

function safeRemoveStaging(root, staging) {
  if (!isPathInside(root, staging) || path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith('.staging-review-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function publicTarget(target) {
  const { file: _file, ...value } = target;
  return value;
}

function reviewDirectories(cwd) {
  const root = reviewsRoot(cwd);
  const ids = new Set();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && REVIEW_ID_PATTERN.test(entry.name)) ids.add(entry.name);
    }
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'semantic_review.created' &&
          REVIEW_ID_PATTERN.test(String(record.review_id ?? ''))) {
        ids.add(record.review_id);
      }
    }
  } catch {
    // Project verification reports malformed audit logs; retain readable directories.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

export function createSemanticReview({
  cwd,
  chatId,
  source,
  revisionId,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  const normalizedChatId = validateChat(project, chatId);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw Object.assign(new Error('Semantic review timestamp is invalid.'), {
      code: 'INVALID_REVIEW'
    });
  }
  const target = resolveSemanticReviewTarget(project, { source, revisionId });
  const text = decodeReviewText(target);
  const report = analyzeScientificDocument({ cwd: project, text, target });
  const serializedReportBytes = Buffer.byteLength(JSON.stringify(report));
  if (serializedReportBytes > MAX_SEMANTIC_REVIEW_REPORT_BYTES) {
    throw Object.assign(new Error('Semantic review report exceeds the fixed storage limit.'), {
      code: 'REVIEW_REPORT_TOO_LARGE'
    });
  }
  const root = reviewsRoot(project, { create: true });
  if (reviewDirectories(project).length >= MAX_SEMANTIC_REVIEWS) {
    throw Object.assign(new Error('Semantic review record limit reached for this project.'), {
      code: 'REVIEW_LIMIT'
    });
  }
  const reviewId = makeSemanticReviewId(now);
  const finalDirectory = path.join(root, reviewId);
  const staging = path.join(root, '.staging-review-' + crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(staging, { mode: 0o700 });
  let manifest;
  try {
    const reportFile = path.join(staging, 'report.json');
    writeJsonExclusive(reportFile, report);
    const reportSha256 = sha256File(reportFile);
    const targetRecord = publicTarget(target);
    manifest = {
      schema_version: SEMANTIC_REVIEW_SCHEMA_VERSION,
      sciencecode_version: VERSION,
      review_id: reviewId,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      status: report.status,
      target: targetRecord,
      reviewer: {
        engine: SEMANTIC_REVIEW_SETTINGS.engine,
        engine_version: SEMANTIC_REVIEW_SETTINGS.engine_version,
        settings_sha256: report.settings_sha256,
        independence: 'separate deterministic record; no generating-agent output is trusted'
      },
      counts: report.summary,
      report: {
        file: 'report.json',
        sha256: reportSha256,
        bytes: fs.statSync(reportFile).size
      },
      preservation_policy: 'immutable target digest, deterministic review report, evidence locators, and audit link'
    };
    const manifestFile = path.join(staging, 'manifest.json');
    writeJsonExclusive(manifestFile, manifest);
    writeTextExclusive(path.join(staging, 'manifest.sha256'), sha256File(manifestFile) + '\n');
    fs.renameSync(staging, finalDirectory);
  } catch (error) {
    safeRemoveStaging(root, staging);
    throw error;
  }
  const files = reviewFiles(project, reviewId);
  const manifestSha256 = sha256File(files.manifest);
  appendAudit(project, {
    type: 'semantic_review.created',
    review_id: reviewId,
    chat_id: normalizedChatId,
    status: report.status,
    target_url: target.url,
    target_sha256: target.sha256,
    report_sha256: manifest.report.sha256,
    manifest_sha256: manifestSha256,
    findings: report.summary.findings
  });
  return getSemanticReview(project, reviewId);
}

function targetSelector(target) {
  if (target?.selector?.revision_id) return { revisionId: target.selector.revision_id };
  if (target?.selector?.source) return { source: target.selector.source };
  throw Object.assign(new Error('Semantic review target selector is invalid.'), {
    code: 'REVIEW_INVALID'
  });
}

function compareTarget(expected, actual, errors) {
  for (const key of ['kind', 'record_id', 'name', 'url', 'sha256', 'bytes', 'media_type', 'record_sha256']) {
    if ((expected?.[key] ?? null) !== (actual?.[key] ?? null)) {
      errors.push({
        file: 'manifest.json',
        issue: 'target_' + key + '_mismatch',
        expected: expected?.[key] ?? null,
        actual: actual?.[key] ?? null
      });
    }
  }
}

export function verifySemanticReview(cwd, value) {
  const project = path.resolve(cwd);
  const reviewId = String(value ?? '');
  const errors = [];
  let files;
  let manifest;
  let report;
  try {
    files = safeReviewDirectory(project, reviewId);
    manifest = readJson(files.manifest);
    report = getSemanticReviewReport(project, reviewId);
  } catch (error) {
    return {
      ok: false,
      review_id: reviewId,
      errors: [{ issue: error.code ?? 'review_error', detail: error.message }]
    };
  }
  const manifestSha256 = sha256File(files.manifest);
  const reportSha256 = sha256File(files.report);
  const expectedManifestSha256 = fs.readFileSync(files.digest, 'utf8').trim();
  if (manifest.schema_version !== SEMANTIC_REVIEW_SCHEMA_VERSION) {
    errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
  }
  if (manifest.review_id !== reviewId) {
    errors.push({ file: 'manifest.json', issue: 'review_id_mismatch' });
  }
  if (expectedManifestSha256 !== manifestSha256) {
    errors.push({
      file: 'manifest.json',
      issue: 'hash_mismatch',
      expected: expectedManifestSha256,
      actual: manifestSha256
    });
  }
  if (manifest.report?.file !== 'report.json') {
    errors.push({ file: 'manifest.json', issue: 'invalid_report_path' });
  }
  if (manifest.report?.sha256 !== reportSha256) {
    errors.push({
      file: 'report.json',
      issue: 'hash_mismatch',
      expected: manifest.report?.sha256 ?? null,
      actual: reportSha256
    });
  }
  if (manifest.report?.bytes !== fs.statSync(files.report).size) {
    errors.push({ file: 'report.json', issue: 'byte_count_mismatch' });
  }
  const replaySettings = semanticReviewSettings(report.engine_version);
  if (report.schema_version !== SEMANTIC_REVIEW_REPORT_SCHEMA_VERSION ||
      !replaySettings ||
      report.engine !== replaySettings?.engine ||
      report.settings_sha256 !== sha256Json(report.settings) ||
      report.settings_sha256 !== (replaySettings ? sha256Json(replaySettings) : null) ||
      manifest.reviewer?.engine !== report.engine ||
      manifest.reviewer?.engine_version !== report.engine_version ||
      manifest.reviewer?.settings_sha256 !== report.settings_sha256) {
    errors.push({ file: 'report.json', issue: 'review_settings_mismatch' });
  }
  let resolved = null;
  let recomputed = null;
  try {
    resolved = resolveSemanticReviewTarget(project, targetSelector(manifest.target));
    compareTarget(manifest.target, resolved, errors);
    const text = decodeReviewText(resolved);
    if (replaySettings) {
      recomputed = analyzeScientificDocument({
        cwd: project,
        text,
        target: resolved,
        engineVersion: report.engine_version
      });
      if (sha256Json(recomputed) !== sha256Json(report)) {
        errors.push({ file: 'report.json', issue: 'deterministic_recalculation_mismatch' });
      }
    }
  } catch (error) {
    errors.push({
      file: 'manifest.json',
      issue: 'review_target_invalid',
      detail: error.message,
      code: error.code ?? null
    });
  }
  if (manifest.status !== report.status || sha256Json(manifest.counts) !== sha256Json(report.summary)) {
    errors.push({ file: 'manifest.json', issue: 'report_summary_mismatch' });
  }
  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else {
    const event = readAuditRecords(project).findLast((record) =>
      record.type === 'semantic_review.created' && record.review_id === reviewId
    );
    if (!event) {
      errors.push({ issue: 'missing_review_audit_event' });
    } else {
      if (event.manifest_sha256 !== manifestSha256) {
        errors.push({ issue: 'audit_manifest_mismatch' });
      }
      if (event.report_sha256 !== reportSha256) {
        errors.push({ issue: 'audit_report_mismatch' });
      }
      if (event.target_sha256 !== manifest.target?.sha256) {
        errors.push({ issue: 'audit_target_mismatch' });
      }
    }
  }
  return {
    ok: errors.length === 0,
    review_id: reviewId,
    manifest,
    report,
    manifest_sha256: manifestSha256,
    report_sha256: reportSha256,
    errors
  };
}

function semanticReviewSummary(cwd, reviewId) {
  try {
    const verification = verifySemanticReview(cwd, reviewId);
    const manifest = verification.manifest;
    const report = verification.report;
    if (!manifest || !report) throw new Error('Review record is unreadable.');
    return {
      review_id: reviewId,
      created_at: manifest.created_at,
      chat_id: manifest.chat_id,
      status: manifest.status,
      verified: verification.ok,
      verification_errors: verification.errors,
      target: manifest.target,
      reviewer: manifest.reviewer,
      counts: report.summary,
      manifest_sha256: verification.manifest_sha256,
      report_sha256: verification.report_sha256,
      url: '/api/reviews/' + encodeURIComponent(reviewId)
    };
  } catch (error) {
    return {
      review_id: reviewId,
      status: 'invalid',
      verified: false,
      verification_errors: [{ issue: error.code ?? 'review_error', detail: error.message }],
      target: null,
      counts: {},
      url: '/api/reviews/' + encodeURIComponent(reviewId)
    };
  }
}

export function listSemanticReviews(cwd, { chatId, targetUrl } = {}) {
  const reviews = reviewDirectories(cwd).map((reviewId) => semanticReviewSummary(cwd, reviewId))
    .sort((left, right) =>
      String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) ||
      String(right.review_id).localeCompare(String(left.review_id))
    );
  const currentByTarget = new Map();
  const targetKey = (review) => review.verified && review.target?.url && review.target?.sha256
    ? [review.chat_id, review.target.url, review.target.sha256].join('\n')
    : null;
  for (const review of reviews) {
    const key = targetKey(review);
    if (key && !currentByTarget.has(key)) currentByTarget.set(key, review.review_id);
  }
  for (const review of reviews) {
    const key = targetKey(review);
    const currentId = key ? currentByTarget.get(key) : null;
    review.current_for_target = Boolean(currentId && currentId === review.review_id);
    review.superseded_by = currentId && currentId !== review.review_id ? currentId : null;
  }
  return reviews
    .filter((review) => !chatId || review.chat_id === chatId)
    .filter((review) => !targetUrl || review.target?.url === targetUrl);
}

export function getSemanticReview(cwd, value) {
  const reviewId = normalizeReviewId(value);
  const verification = verifySemanticReview(cwd, reviewId);
  if (!verification.manifest || !verification.report) {
    throw Object.assign(new Error('Semantic review not found: ' + reviewId), {
      code: 'REVIEW_NOT_FOUND'
    });
  }
  return {
    review_id: reviewId,
    manifest: verification.manifest,
    report: verification.report,
    verification
  };
}

export function semanticReviewInteractionArtifact(review) {
  const manifest = review?.manifest ?? review;
  return {
    kind: 'review',
    record_id: manifest.review_id,
    name: 'Semantic review · ' + (manifest.target?.name ?? manifest.review_id),
    url: '/api/reviews/' + encodeURIComponent(manifest.review_id)
  };
}

export function semanticReviewInteractionPayload(review) {
  const manifest = review?.manifest ?? review;
  const report = review?.report ?? {};
  return {
    review_id: manifest.review_id,
    status: report.status ?? manifest.status,
    target_url: manifest.target?.url ?? null,
    target_sha256: manifest.target?.sha256 ?? null,
    report_sha256: manifest.report?.sha256 ?? review?.verification?.report_sha256 ?? null,
    counts: report.summary ?? manifest.counts ?? {},
    findings: (report.findings ?? []).slice(0, 24).map((finding) => ({
      finding_id: finding.finding_id,
      severity: finding.severity,
      category: finding.category,
      code: finding.code,
      claim_id: finding.claim_id,
      line_start: finding.line_start,
      message: compact(finding.message, 360)
    })),
    findings_truncated: (report.findings?.length ?? 0) > 24,
    interpretation: 'deterministic triage; inspect exact review record before changing scientific conclusions'
  };
}
