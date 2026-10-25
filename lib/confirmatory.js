import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import {
  ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION,
  ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION,
  getAnalysisContract,
  getAnalysisContractBinding,
  verifyAnalysisContract
} from './analysis-contracts.js';
import {
  RANK_BASED_INFERENCE_TESTS,
  STATISTICS_ENGINE_NAME,
  STATISTICS_ENGINE_VERSION,
  adjustPValues,
  effectSize,
  mannWhitneyUTest,
  oneSampleTTest,
  pairedTTest,
  tConfidenceInterval,
  tostPValue,
  welchTTest,
  wilcoxonSignedRankTest
} from './statistics.js';
import { getChatManifest } from './chats.js';
import { VERSION } from './constants.js';
import {
  getExperimentManifest,
  resolveExperimentDirectory,
  verifyExperiment
} from './experiments.js';
import { sha256File, sha256Json } from './hash.js';
import { scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  readJson,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';
import { convertQuantity } from './units.js';

export const CONFIRMATORY_TYPED_UNIT_SCHEMA_VERSION = 2;
export const CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION = 3;
export const CONFIRMATORY_ASSESSMENT_SCHEMA_VERSION = CONFIRMATORY_TYPED_UNIT_SCHEMA_VERSION;
export const CONFIRMATORY_ASSESSMENT_LEGACY_SCHEMA_VERSION = 1;
export const CONFIRMATORY_TYPED_UNIT_ENGINE_VERSION = 2;
export const CONFIRMATORY_INFERENTIAL_ENGINE_VERSION = 3;
export const CONFIRMATORY_ENGINE_VERSION = CONFIRMATORY_TYPED_UNIT_ENGINE_VERSION;
export const CONFIRMATORY_LEGACY_ENGINE_VERSION = 1;
export const MAX_CONFIRMATORY_ASSESSMENTS = 10_000;

const ASSESSMENT_ID_PATTERN = /^analysis-assessment-[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const CHAT_ID_PATTERN = /^chat-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assessmentError(message, code = 'INVALID_CONFIRMATORY_ASSESSMENT') {
  return Object.assign(new Error(message), { code });
}

function normalizeAssessmentId(value) {
  const id = String(value ?? '');
  if (!ASSESSMENT_ID_PATTERN.test(id) || id === '.' || id === '..') {
    throw assessmentError('Invalid confirmatory assessment ID: ' + id,
      'INVALID_CONFIRMATORY_ASSESSMENT_ID');
  }
  return id;
}

export function makeConfirmatoryAssessmentId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'analysis-assessment-' + stamp + '-' + crypto.randomBytes(4).toString('hex');
}

function assessmentsRoot(cwd, { create = false } = {}) {
  const project = path.resolve(cwd);
  const metadata = path.join(project, INTERNAL_DIR);
  const root = path.join(metadata, 'analysis-assessments');
  if (fs.existsSync(metadata)) {
    const projectReal = fs.realpathSync(project);
    const metadataStat = fs.lstatSync(metadata);
    if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() ||
        !isPathInside(projectReal, fs.realpathSync(metadata))) {
      throw assessmentError('ScienceCode metadata storage escapes the project.',
        'INVALID_CONFIRMATORY_ASSESSMENT_PATH');
    }
  }
  if (create) {
    ensureScienceDir(project);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  if (fs.existsSync(root)) {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw assessmentError('Confirmatory assessment storage must be a real project directory.',
        'INVALID_CONFIRMATORY_ASSESSMENT_PATH');
    }
    const metadataReal = fs.realpathSync(metadata);
    const rootReal = fs.realpathSync(root);
    if (!isPathInside(metadataReal, rootReal)) {
      throw assessmentError('Confirmatory assessment storage escapes the project metadata root.',
        'INVALID_CONFIRMATORY_ASSESSMENT_PATH');
    }
    return rootReal;
  }
  return root;
}

export function resolveConfirmatoryAssessmentDirectory(cwd, value) {
  return path.join(assessmentsRoot(cwd), normalizeAssessmentId(value));
}

function assessmentFiles(cwd, value) {
  const directory = resolveConfirmatoryAssessmentDirectory(cwd, value);
  return {
    directory,
    manifest: path.join(directory, 'manifest.json'),
    digest: path.join(directory, 'manifest.sha256'),
    report: path.join(directory, 'report.json')
  };
}

function safeAssessmentFiles(cwd, value) {
  const files = assessmentFiles(cwd, value);
  const root = assessmentsRoot(cwd);
  const stat = fs.lstatSync(files.directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw assessmentError('Confirmatory assessment not found: ' + normalizeAssessmentId(value),
      'CONFIRMATORY_ASSESSMENT_NOT_FOUND');
  }
  const directoryReal = fs.realpathSync(files.directory);
  if (!isPathInside(root, directoryReal)) {
    throw assessmentError('Confirmatory assessment escapes its storage root.',
      'INVALID_CONFIRMATORY_ASSESSMENT_PATH');
  }
  return { ...files, directory: directoryReal };
}

function safeRegularFile(file, directory) {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return Boolean(stat?.isFile() && !stat.isSymbolicLink() &&
      isPathInside(directory, fs.realpathSync(file)));
  } catch {
    return false;
  }
}

function validateChat(cwd, value) {
  if (value === undefined || value === null || value === '') return null;
  const chatId = String(value);
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw assessmentError('Invalid chat ID: ' + chatId, 'INVALID_CHAT_ID');
  }
  try {
    getChatManifest(cwd, chatId);
  } catch {
    throw assessmentError('Chat not found: ' + chatId, 'CHAT_NOT_FOUND');
  }
  return chatId;
}

function normalizeDeviationNote(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const note = String(value).replace(/\r\n/g, '\n').trim();
  if (note.length > 2_000) {
    throw assessmentError('Deviation note must be 2000 characters or fewer.');
  }
  const findings = scanSecrets(note);
  if (findings.length) {
    throw Object.assign(
      new Error('Potential secret detected in assessment deviation note; refusing to persist it.'),
      { code: 'SECRET_DETECTED', findings }
    );
  }
  return note;
}

function sameJson(left, right) {
  return sha256Json(left) === sha256Json(right);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// Inference group membership compares canonically (recursively sorted keys) so
// a plan branch whose parameter object serializes in a different key order
// than the frozen contract still lands in its preregistered group.
function sameCanonicalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function branchMatches(branch, filter) {
  return Object.entries(filter ?? {}).every(([name, expected]) =>
    Object.hasOwn(branch.parameters ?? {}, name) &&
    sameJson(branch.parameters[name], expected)
  );
}

function aggregate(values, method) {
  if (!values.length) return null;
  if (method === 'minimum') return Math.min(...values);
  if (method === 'maximum') return Math.max(...values);
  if (method === 'median') {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function applyDecision(value, rule) {
  const scalar = (item) => typeof item === 'number' ? item : item?.value;
  if (rule.operator === 'greater_than') return value > scalar(rule.value);
  if (rule.operator === 'greater_than_or_equal') return value >= scalar(rule.value);
  if (rule.operator === 'less_than') return value < scalar(rule.value);
  if (rule.operator === 'less_than_or_equal') return value <= scalar(rule.value);
  if (rule.operator === 'between_inclusive') {
    return value >= scalar(rule.lower) && value <= scalar(rule.upper);
  }
  if (rule.operator === 'outside_inclusive') {
    return value <= scalar(rule.lower) || value >= scalar(rule.upper);
  }
  return false;
}

function typedObservation(value, outcome, branchIndex) {
  if (value === undefined || value === null) {
    return { missing: { branch_index: branchIndex, reason: 'statistic_missing' } };
  }
  if (typeof value === 'number') {
    return {
      missing: { branch_index: branchIndex, reason: 'statistic_requires_typed_quantity' }
    };
  }
  try {
    const converted = convertQuantity(
      value,
      outcome.unit.symbol,
      'Statistic ' + outcome.statistic
    );
    return {
      observation: {
        branch_index: branchIndex,
        value: converted.value,
        unit: converted.unit,
        source_value: converted.source.value,
        source_unit: converted.source.unit,
        converted: converted.converted
      }
    };
  } catch (error) {
    const reason = error.code === 'UNIT_DIMENSION_MISMATCH'
      ? 'statistic_unit_mismatch'
      : error.code === 'INVALID_UNIT'
        ? 'statistic_invalid_unit'
        : 'statistic_invalid_quantity';
    const observedUnit = value && typeof value === 'object' &&
      typeof value.unit === 'string' && value.unit.length <= 64
      ? value.unit
      : null;
    return {
      missing: {
        branch_index: branchIndex,
        reason,
        expected_unit: outcome.unit.symbol,
        ...(observedUnit ? { observed_unit: observedUnit } : {})
      }
    };
  }
}

function outcomeAssessment(outcome, contract, plan, results, typed = false) {
  const intended = (plan.branches ?? [])
    .filter((branch) => branchMatches(branch, outcome.filter))
    .sort((left, right) => left.index - right.index);
  const byIndex = new Map((results ?? []).map((result) => [result.branch_index, result]));
  const observed = [];
  const missing = [];
  for (const branch of intended) {
    const result = byIndex.get(branch.index);
    const value = result?.final_statistics?.[outcome.statistic];
    if (!result) {
      missing.push({ branch_index: branch.index, reason: 'result_missing' });
    } else if (result.status !== 'completed') {
      missing.push({ branch_index: branch.index, reason: 'branch_' + String(result.status ?? 'unknown') });
    } else if (result.verified !== true) {
      missing.push({ branch_index: branch.index, reason: 'branch_unverified' });
    } else if (typed) {
      const assessed = typedObservation(value, outcome, branch.index);
      if (assessed.observation) observed.push(assessed.observation);
      else missing.push(assessed.missing);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      missing.push({ branch_index: branch.index, reason: 'statistic_missing_or_nonfinite' });
    } else {
      observed.push({ branch_index: branch.index, value });
    }
  }
  const enough = observed.length >= outcome.minimum_count;
  const missingAllowed = contract.missing_data_policy === 'exclude_after_minimum_count' ||
    missing.length === 0;
  const aggregated = enough && missingAllowed
    ? aggregate(observed.map((item) => item.value), outcome.aggregation)
    : null;
  const aggregateNonfinite = typed && aggregated !== null && !Number.isFinite(aggregated);
  const value = aggregateNonfinite ? null : aggregated;
  const status = value === null
    ? 'indeterminate'
    : applyDecision(value, outcome.decision_rule) ? 'pass' : 'fail';
  return {
    outcome_id: outcome.outcome_id,
    role: outcome.role,
    label: outcome.label,
    statistic: outcome.statistic,
    variable: outcome.variable,
    unit: outcome.unit,
    ...(typed ? { measurement_mode: 'typed_quantity' } : {}),
    timepoint: outcome.timepoint,
    summary_measure: outcome.summary_measure,
    intercurrent_event_strategy: outcome.intercurrent_event_strategy,
    aggregation: outcome.aggregation,
    filter: outcome.filter,
    minimum_count: outcome.minimum_count,
    expected_count: intended.length,
    observed_count: observed.length,
    missing_count: missing.length,
    observations: observed,
    missing,
    aggregate_value: value,
    ...(aggregateNonfinite ? { calculation_error: 'aggregate_nonfinite' } : {}),
    ...(typed ? {
      aggregate_quantity: value === null
        ? null
        : { value, unit: outcome.unit.symbol }
    } : {}),
    decision_rule: outcome.decision_rule,
    ...(outcome.inference ? { inference_declared: true } : {}),
    status
  };
}

function computeInference(outcome, contract, plan, assessment, engineVersion) {
  const inference = outcome.inference;
  const gateReason = assessment.missing_count > 0 &&
      contract.missing_data_policy === 'fail'
    ? 'missing_data'
    : assessment.observed_count < outcome.minimum_count
      ? 'insufficient_observations'
      : null;
  let computation = null;
  let reason = gateReason;
  if (!reason && inference.test === 'student_t_one_sample') {
    computation = oneSampleTTest(
      assessment.observations.map((item) => item.value),
      inference.null_value.value,
      inference.sidedness
    );
  } else if (!reason && inference.test === 'welch_t_two_sample') {
    const parameters = new Map((plan.branches ?? [])
      .map((branch) => [branch.index, branch.parameters ?? {}]));
    const groupA = [];
    const groupB = [];
    for (const observation of assessment.observations) {
      const branchParameters = parameters.get(observation.branch_index) ?? {};
      if (!Object.hasOwn(branchParameters, inference.group_parameter)) continue;
      const value = branchParameters[inference.group_parameter];
      if (sameCanonicalJson(value, inference.group_a)) groupA.push(observation.value);
      else if (sameCanonicalJson(value, inference.group_b)) groupB.push(observation.value);
    }
    if (groupA.length < 2 || groupB.length < 2) {
      reason = 'insufficient_group_observations';
    } else {
      // The declared null difference reached the Welch statistic only from
      // engine v3; v2 records tested a zero difference and must replay so.
      computation = welchTTest(groupA, groupB, inference.sidedness,
        engineVersion >= 3 ? inference.null_value.value : 0);
    }
  } else if (!reason && inference.test === 'mann_whitney_u') {
    // Same grouping machinery as Welch: only the test applied to the two
    // groups differs, so a preregistration can swap one for the other without
    // changing how the data are collected.
    const parameters = new Map((plan.branches ?? [])
      .map((branch) => [branch.index, branch.parameters ?? {}]));
    const groupA = [];
    const groupB = [];
    for (const observation of assessment.observations) {
      const branchParameters = parameters.get(observation.branch_index) ?? {};
      if (!Object.hasOwn(branchParameters, inference.group_parameter)) continue;
      const value = branchParameters[inference.group_parameter];
      if (sameCanonicalJson(value, inference.group_a)) groupA.push(observation.value);
      else if (sameCanonicalJson(value, inference.group_b)) groupB.push(observation.value);
    }
    if (groupA.length < 2 || groupB.length < 2) {
      reason = 'insufficient_group_observations';
    } else {
      computation = mannWhitneyUTest(groupA, groupB, inference.sidedness,
        1 - inference.alpha, inference.null_value.value);
    }
  } else if (!reason && inference.test === 'wilcoxon_signed_rank') {
    const parameters = new Map((plan.branches ?? [])
      .map((branch) => [branch.index, branch.parameters ?? {}]));
    const pairs = new Map();
    let unpairable = false;
    for (const observation of assessment.observations) {
      const branchParameters = parameters.get(observation.branch_index) ?? {};
      if (!Object.hasOwn(branchParameters, inference.group_parameter)) continue;
      if (!Object.hasOwn(branchParameters, inference.pair_parameter)) continue;
      const arm = branchParameters[inference.group_parameter];
      const key = canonicalJson(branchParameters[inference.pair_parameter]);
      const side = sameCanonicalJson(arm, inference.group_a)
        ? 'a'
        : sameCanonicalJson(arm, inference.group_b) ? 'b' : null;
      if (!side) continue;
      const entry = pairs.get(key) ?? {};
      if (Object.hasOwn(entry, side)) {
        unpairable = true;
        break;
      }
      entry[side] = observation.value;
      pairs.set(key, entry);
    }
    const complete = [...pairs.entries()]
      .filter(([, entry]) => Object.hasOwn(entry, 'a') && Object.hasOwn(entry, 'b'))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    if (unpairable) {
      reason = 'ambiguous_pairing';
    } else if (complete.length < 2) {
      reason = 'insufficient_pair_observations';
    } else {
      computation = wilcoxonSignedRankTest(
        complete.map(([, entry]) => entry.a),
        complete.map(([, entry]) => entry.b),
        inference.null_value.value,
        inference.sidedness,
        1 - inference.alpha
      );
    }
  } else if (!reason && inference.test === 'student_t_paired') {
    // Paired: match arm observations sharing the same pair-parameter value,
    // keep only complete pairs, and order them canonically so replay never
    // depends on branch enumeration order.
    const parameters = new Map((plan.branches ?? [])
      .map((branch) => [branch.index, branch.parameters ?? {}]));
    const pairs = new Map();
    let unpairable = false;
    for (const observation of assessment.observations) {
      const branchParameters = parameters.get(observation.branch_index) ?? {};
      if (!Object.hasOwn(branchParameters, inference.group_parameter) ||
          !Object.hasOwn(branchParameters, inference.pair_parameter)) continue;
      const arm = branchParameters[inference.group_parameter];
      const key = canonicalJson(branchParameters[inference.pair_parameter]);
      const side = sameCanonicalJson(arm, inference.group_a)
        ? 'a'
        : sameCanonicalJson(arm, inference.group_b) ? 'b' : null;
      if (!side) continue;
      const entry = pairs.get(key) ?? {};
      if (Object.hasOwn(entry, side)) {
        // Two observations for the same arm and pair key make the pairing
        // ambiguous; fail closed rather than pick one.
        unpairable = true;
        break;
      }
      entry[side] = observation.value;
      pairs.set(key, entry);
    }
    // Codepoint comparison, not localeCompare: collation treats some distinct
    // strings as equal, which would let branch enumeration order leak into
    // the summation order and break cross-machine replay.
    const complete = [...pairs.entries()]
      .filter(([, entry]) => Object.hasOwn(entry, 'a') && Object.hasOwn(entry, 'b'))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    if (unpairable) {
      reason = 'ambiguous_pairing';
    } else if (complete.length < 2) {
      reason = 'insufficient_pair_observations';
    } else {
      computation = pairedTTest(
        complete.map(([, entry]) => entry.a),
        complete.map(([, entry]) => entry.b),
        inference.null_value.value,
        inference.sidedness
      );
    }
  } else if (!reason) {
    // A test the contract normalizer accepted but this dispatcher does not
    // know must be loud, never silently evaluated as some other test.
    reason = 'unsupported_test';
  }
  if (computation?.degenerate) {
    reason = computation.degenerate;
  }
  return {
    declared: {
      test: inference.test,
      sidedness: inference.sidedness,
      alpha: inference.alpha,
      null_value: inference.null_value,
      ...(inference.group_parameter ? {
        group_parameter: inference.group_parameter,
        group_a: inference.group_a,
        group_b: inference.group_b,
        ...(inference.pair_parameter ? { pair_parameter: inference.pair_parameter } : {})
      } : {}),
      ...(inference.equivalence ? { equivalence: inference.equivalence } : {})
    },
    computation,
    // Equivalence needs both one-sided tests, which run on the estimate the
    // t-test already produced.
    tost: inference.equivalence && computation && !computation.degenerate && !reason
      ? tostPValue({
        estimate: computation.mean_difference ?? computation.mean,
        standardError: computation.standard_error,
        degreesOfFreedom: computation.degrees_of_freedom,
        lower: inference.equivalence.lower?.value ?? null,
        upper: inference.equivalence.upper?.value ?? null
      })
      : null,
    reason
  };
}

// The correction family is the set of primary outcomes that declared an
// inference in the frozen contract, so missing data can never shrink the
// preregistered multiplier.
// engineVersion is the version recorded in the frozen contract, so a record
// created before effect sizes existed replays byte-identically.
function attachInference(outcomes, contract, plan, engineVersion) {
  const correction = contract.multiplicity_correction ?? 'none';
  const entries = outcomes
    .filter((assessment) => assessment.inference_declared)
    .map((assessment) => ({
      assessment,
      result: computeInference(
        contract.outcomes.find((outcome) => outcome.outcome_id === assessment.outcome_id),
        contract,
        plan,
        assessment,
        engineVersion
      )
    }));
  const family = entries.filter((entry) => entry.assessment.role === 'primary');
  const familySize = family.length;
  // An equivalence outcome contributes its TOST p-value (the larger of the two
  // one-sided tests) to the same correction family as any other test.
  const rawPValue = (entry) => entry.result.tost
    ? entry.result.tost.p_value
    : entry.result.computation?.p_value ?? null;
  const computable = family.filter((entry) => typeof rawPValue(entry) === 'number');
  const adjusted = computable.length
    ? adjustPValues(computable.map(rawPValue), correction, familySize)
    : [];
  computable.forEach((entry, index) => {
    entry.adjustedP = adjusted[index];
  });
  for (const entry of entries) {
    const inFamily = entry.assessment.role === 'primary';
    const raw = rawPValue(entry);
    const adjustedP = inFamily
      ? entry.adjustedP ?? null
      : raw;
    const isEquivalence = entry.result.declared.sidedness === 'equivalence';
    const rejected = adjustedP !== null && adjustedP <= entry.result.declared.alpha;
    // Rejecting every declared one-sided null establishes the margin claim;
    // the conclusion names that claim rather than reusing superiority-test
    // vocabulary, and says plainly when it was not established.
    const marginConclusions = {
      equivalence: ['equivalent', 'not_equivalent'],
      non_inferiority: ['non_inferior', 'not_non_inferior'],
      non_superiority: ['non_superior', 'not_non_superior']
    };
    const conclusion = entry.result.reason !== null || adjustedP === null
      ? 'indeterminate'
      : isEquivalence
        ? marginConclusions[entry.result.declared.equivalence?.kind ?? 'equivalence'][
          rejected ? 0 : 1]
        : rejected ? 'reject_null' : 'fail_to_reject';
    // The declared group_a/group_b (which arm is which) must survive the
    // computed group summaries, so the statistics payload renames its keys.
    const { group_a: groupASummary, group_b: groupBSummary, degenerate: _degenerate,
      ...allComputation } = entry.result.computation ?? {};
    // For equivalence the reported p-value comes from TOST, so the superiority
    // t must not sit beside it where a reader would try to recompute one from
    // the other.
    const { t: _superiorityT, ...withoutT } = allComputation;
    const computation = engineVersion >= 4 &&
        entry.result.declared.sidedness === 'equivalence'
      ? withoutT
      : allComputation;
    const equivalent = entry.result.declared.sidedness === 'equivalence';
    const marginKind = entry.result.declared.equivalence?.kind ?? null;
    const oneSidedMargin = marginKind && marginKind !== 'equivalence' ? marginKind : null;
    // A rank test brings its own distribution-free interval and rank-biserial
    // effect size. Running the t machinery over it would import exactly the
    // normality assumption the test was chosen to avoid.
    const rankBased = RANK_BASED_INFERENCE_TESTS.includes(entry.result.declared.test);
    let confidenceInterval = null;
    if (rankBased && entry.result.computation?.confidence_interval &&
        !entry.result.computation.degenerate && entry.result.reason === null) {
      confidenceInterval = {
        ...entry.result.computation.confidence_interval,
        unit: entry.result.declared.null_value.unit,
        adjusted_for_multiplicity: false
      };
    } else if (!rankBased && entry.result.computation && !entry.result.computation.degenerate &&
        entry.result.reason === null) {
      const interval = tConfidenceInterval({
        estimate: computation.mean_difference ?? computation.mean,
        standardError: computation.standard_error,
        degreesOfFreedom: computation.degrees_of_freedom,
        // A two-bound decision at alpha matches the 1 - 2*alpha two-sided
        // interval; a one-bound decision matches the one-sided 1 - alpha
        // interval on the side that was actually tested.
        sidedness: equivalent && oneSidedMargin
          ? (oneSidedMargin === 'non_inferiority' ? 'greater' : 'less')
          : entry.result.declared.sidedness,
        level: equivalent && !oneSidedMargin
          ? 1 - 2 * entry.result.declared.alpha
          : 1 - entry.result.declared.alpha
      });
      confidenceInterval = {
        ...interval,
        unit: entry.result.declared.null_value.unit,
        adjusted_for_multiplicity: false
      };
    }
    // Effect sizes arrived in statistics engine v3; older frozen records must
    // replay without them.
    const effect = rankBased
      ? (typeof entry.result.computation?.rank_biserial === 'number'
        ? { method: 'rank_biserial_correlation', value: entry.result.computation.rank_biserial }
        : null)
      : engineVersion >= 3
        ? effectSize(entry.result.computation, entry.result.declared.null_value.value)
        : null;
    entry.assessment.threshold_status = entry.assessment.status;
    entry.assessment.inference = {
      ...entry.result.declared,
      in_family: inFamily,
      multiplicity_correction: inFamily ? correction : 'none',
      ...computation,
      ...(groupASummary ? { group_a_summary: groupASummary } : {}),
      ...(groupBSummary ? { group_b_summary: groupBSummary } : {}),
      p_value: raw,
      adjusted_p_value: adjustedP,
      ...(entry.result.tost ? { tost: entry.result.tost } : {}),
      ...(confidenceInterval ? { confidence_interval: confidenceInterval } : {}),
      ...(effect ? { effect_size: effect } : {}),
      ...(entry.result.reason ? { reason: entry.result.reason } : {}),
      conclusion
    };
    const established = ['reject_null', 'equivalent', 'non_inferior', 'non_superior'];
    const notEstablished = ['fail_to_reject', 'not_equivalent',
      'not_non_inferior', 'not_non_superior'];
    entry.assessment.status = established.includes(conclusion)
      ? 'pass'
      : notEstablished.includes(conclusion) ? 'fail' : 'indeterminate';
  }
  return {
    statistics_engine: {
      name: STATISTICS_ENGINE_NAME,
      version: engineVersion
    },
    multiplicity_correction: correction,
    family: family.map((entry) => entry.assessment.outcome_id),
    family_size: familySize
  };
}

export function evaluateConfirmatoryExperiment({
  contractId,
  contractBinding,
  contract,
  experimentId,
  experimentManifest,
  experimentManifestSha256,
  plan,
  results,
  deviationNote = null
}) {
  const typed = (contract.schema_version ?? 1) >= ANALYSIS_CONTRACT_TYPED_UNIT_SCHEMA_VERSION;
  const inferential =
    (contract.schema_version ?? 1) >= ANALYSIS_CONTRACT_INFERENTIAL_SCHEMA_VERSION;
  const linked = plan.analysis_contract?.analysis_contract_id === contractId &&
    experimentManifest.analysis_contract?.analysis_contract_id === contractId;
  const digestMatch = linked &&
    plan.analysis_contract?.manifest_sha256 === contractBinding.manifest_sha256 &&
    experimentManifest.analysis_contract?.manifest_sha256 === contractBinding.manifest_sha256;
  const scriptMatch = experimentManifest.script?.sha256 === contractBinding.script_sha256 &&
    plan.script?.sha256 === contractBinding.script_sha256;
  const contractTime = Date.parse(contractBinding.created_at);
  const experimentTime = Date.parse(experimentManifest.started_at);
  const timestampValid = Number.isFinite(contractTime) && Number.isFinite(experimentTime);
  const createdBeforeExperiment = timestampValid && contractTime <= experimentTime;
  const automaticDeviations = [
    !linked ? 'experiment_not_bound_to_contract' : null,
    linked && !digestMatch ? 'contract_digest_mismatch' : null,
    !scriptMatch ? 'analysis_script_mismatch' : null,
    !createdBeforeExperiment ? 'contract_not_created_before_experiment' : null
  ].filter(Boolean);
  const registrationStatus = linked && digestMatch && scriptMatch && createdBeforeExperiment &&
      !deviationNote
    ? 'prospective'
    : linked ? 'deviated' : 'unregistered';
  const outcomes = contract.outcomes.map((outcome) =>
    outcomeAssessment(outcome, contract, plan, results, typed)
  );
  const statisticsEngineVersion =
    contractBinding.statistics_engine_version ?? STATISTICS_ENGINE_VERSION;
  const inferenceSummary = inferential
    ? attachInference(outcomes, contract, plan, statisticsEngineVersion)
    : null;
  const primary = outcomes.filter((outcome) => outcome.role === 'primary');
  const outcomeVerdict = primary.some((outcome) => outcome.status === 'fail')
    ? 'fail'
    : primary.some((outcome) => outcome.status === 'indeterminate')
      ? 'indeterminate'
      : 'pass';
  const status = registrationStatus === 'prospective' ? outcomeVerdict : 'deviation';
  const assessmentSchemaVersion = inferential
    ? CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION
    : typed
      ? CONFIRMATORY_ASSESSMENT_SCHEMA_VERSION
      : CONFIRMATORY_ASSESSMENT_LEGACY_SCHEMA_VERSION;
  const engineVersion = inferential
    ? CONFIRMATORY_INFERENTIAL_ENGINE_VERSION
    : typed
      ? CONFIRMATORY_ENGINE_VERSION
      : CONFIRMATORY_LEGACY_ENGINE_VERSION;
  return {
    schema_version: assessmentSchemaVersion,
    engine: {
      name: 'sciencecode-confirmatory-threshold',
      version: engineVersion
    },
    analysis_contract: {
      analysis_contract_id: contractId,
      manifest_sha256: contractBinding.manifest_sha256,
      contract_sha256: contractBinding.contract_sha256,
      created_at: contractBinding.created_at,
      preregistration_id: contractBinding.preregistration_id,
      script_sha256: contractBinding.script_sha256,
      ...(typed ? {
        schema_version: contractBinding.schema_version,
        unit_engine_version: contractBinding.unit_engine_version
      } : {}),
      ...(inferential ? {
        statistics_engine_version: contractBinding.statistics_engine_version
      } : {})
    },
    experiment: {
      experiment_id: experimentId,
      manifest_sha256: experimentManifestSha256,
      plan_sha256: experimentManifest.plan_sha256,
      started_at: experimentManifest.started_at,
      finished_at: experimentManifest.finished_at,
      status: experimentManifest.status,
      branches: experimentManifest.branch_count
    },
    registration: {
      status: registrationStatus,
      linked,
      digest_match: digestMatch,
      script_match: scriptMatch,
      timestamp_valid: timestampValid,
      contract_created_before_experiment: createdBeforeExperiment,
      automatic_deviations: automaticDeviations,
      disclosed_deviation: deviationNote
    },
    ...(inferenceSummary ? { inference: inferenceSummary } : {}),
    outcomes,
    summary: {
      outcomes: outcomes.length,
      primary: primary.length,
      primary_passed: primary.filter((outcome) => outcome.status === 'pass').length,
      primary_failed: primary.filter((outcome) => outcome.status === 'fail').length,
      primary_indeterminate: primary.filter((outcome) => outcome.status === 'indeterminate').length,
      secondary: outcomes.filter((outcome) => outcome.role === 'secondary').length,
      exploratory: outcomes.filter((outcome) => outcome.role === 'exploratory').length,
      outcome_verdict: outcomeVerdict,
      registration_status: registrationStatus,
      ...(inferenceSummary ? {
        inference: {
          statistics_engine: inferenceSummary.statistics_engine,
          multiplicity_correction: inferenceSummary.multiplicity_correction,
          family_size: inferenceSummary.family_size,
          // Family-scoped so the counts stay commensurable with family_size;
          // out-of-family (secondary/exploratory) inferences are uncorrected.
          rejected_null: outcomes.filter((outcome) =>
            outcome.inference?.in_family &&
            ['reject_null', 'equivalent', 'non_inferior', 'non_superior']
              .includes(outcome.inference.conclusion)).length,
          failed_to_reject: outcomes.filter((outcome) =>
            outcome.inference?.in_family &&
            ['fail_to_reject', 'not_equivalent', 'not_non_inferior', 'not_non_superior']
              .includes(outcome.inference.conclusion)).length,
          // Margin claims arrived in statistics engine v4; an older frozen
          // record must replay with the exact summary shape it was written
          // with, or its own verification would reject it.
          ...(statisticsEngineVersion >= 4 ? {
            margin_claims_established: outcomes.filter((outcome) =>
              outcome.inference?.in_family &&
              ['equivalent', 'non_inferior', 'non_superior']
                .includes(outcome.inference.conclusion)).length
          } : {}),
          indeterminate: outcomes.filter((outcome) =>
            outcome.inference?.in_family &&
            outcome.inference.conclusion === 'indeterminate').length,
          out_of_family_inferences: outcomes.filter((outcome) =>
            outcome.inference && !outcome.inference.in_family).length
        }
      } : {}),
      status
    },
    status,
    interpretation: [
      'Deterministic threshold assessment over verified experiment final_statistics.',
      ...(typed ? [
        'Typed quantities are dimension-checked and converted to each frozen outcome unit before aggregation.'
      ] : []),
      ...(inferential ? [
        'Preregistered t-tests are replayed with the pinned deterministic statistics engine and the frozen multiplicity correction over the declared primary family.',
        statisticsEngineVersion >= 4
          ? 'Confidence intervals match each test\'s sidedness at the unadjusted level, except margin-claim outcomes, whose interval matches their one- or two-bound decision; the multiplicity correction applies to decisions, not intervals.'
          : 'Confidence intervals match each test\'s sidedness at the unadjusted level; the multiplicity correction applies to decisions, not intervals.',
        'Test validity assumes approximately normal, independent observations; those assumptions are stated, not checked.',
        'No causal effect, clinical benefit, or regulatory conclusion is inferred.'
      ] : [
        'No p-value, confidence interval, causal effect, clinical benefit, or regulatory conclusion is inferred.'
      ]),
      'Secondary and exploratory outcomes do not change the primary verdict.'
    ]
  };
}

function safeRemoveStaging(root, staging) {
  if (!isPathInside(root, staging) || path.dirname(path.resolve(staging)) !== path.resolve(root) ||
      !path.basename(staging).startsWith('.staging-analysis-assessment-')) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

function assessmentIds(cwd) {
  const ids = new Set();
  try {
    const root = assessmentsRoot(cwd);
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (ASSESSMENT_ID_PATTERN.test(entry.name)) ids.add(entry.name);
      }
    }
  } catch {
    // Audit discovery below preserves visibility of records whose storage root
    // was replaced with an unsafe filesystem link.
  }
  try {
    for (const record of readAuditRecords(cwd)) {
      if (record.type === 'analysis_assessment.created' &&
          ASSESSMENT_ID_PATTERN.test(String(record.analysis_assessment_id ?? ''))) {
        ids.add(record.analysis_assessment_id);
      }
    }
  } catch {
    // Project verification reports the audit failure. Readable audit IDs keep
    // deleted immutable assessment records discoverable.
  }
  return [...ids].sort((left, right) => right.localeCompare(left));
}

function readExperimentDocuments(cwd, experimentId) {
  const directory = resolveExperimentDirectory(cwd, experimentId);
  return {
    plan: readJson(path.join(directory, 'plan.json')),
    results: readJson(path.join(directory, 'results.json')).results
  };
}

export function createConfirmatoryAssessment({
  cwd,
  contractId,
  experimentId,
  chatId = null,
  deviationNote = null,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw assessmentError('Confirmatory assessment timestamp is invalid.');
  }
  const normalizedChatId = validateChat(project, chatId);
  const normalizedDeviation = normalizeDeviationNote(deviationNote);
  const contractVerification = verifyAnalysisContract(project, contractId);
  if (!contractVerification.ok) {
    throw Object.assign(
      new Error('Analysis contract failed integrity verification.'),
      { code: 'ANALYSIS_CONTRACT_INVALID', verification: contractVerification }
    );
  }
  const binding = getAnalysisContractBinding(project, contractId);
  const experimentVerification = verifyExperiment(project, experimentId);
  if (!experimentVerification.ok) {
    throw Object.assign(
      new Error('Experiment failed integrity verification.'),
      { code: 'CONFIRMATORY_EXPERIMENT_INVALID', verification: experimentVerification }
    );
  }
  const documents = readExperimentDocuments(project, experimentId);
  const report = evaluateConfirmatoryExperiment({
    contractId: binding.analysis_contract_id,
    contractBinding: binding,
    contract: contractVerification.contract,
    experimentId,
    experimentManifest: experimentVerification.manifest,
    experimentManifestSha256: experimentVerification.manifest_sha256,
    plan: documents.plan,
    results: documents.results,
    deviationNote: normalizedDeviation
  });
  if (assessmentIds(project).length >= MAX_CONFIRMATORY_ASSESSMENTS) {
    throw assessmentError('Confirmatory assessment limit reached for this project.',
      'CONFIRMATORY_ASSESSMENT_LIMIT');
  }
  const sourceTimes = [
    Date.parse(binding.created_at),
    Date.parse(experimentVerification.manifest.finished_at ??
      experimentVerification.manifest.started_at)
  ];
  if (sourceTimes.some((value) => !Number.isFinite(value)) ||
      now.getTime() < Math.max(...sourceTimes)) {
    throw assessmentError(
      'Confirmatory assessment must be created after its contract and experiment records.',
      'CONFIRMATORY_ASSESSMENT_TIME_INVALID'
    );
  }
  const root = assessmentsRoot(project, { create: true });
  const id = makeConfirmatoryAssessmentId(now);
  const finalDirectory = resolveConfirmatoryAssessmentDirectory(project, id);
  const staging = path.join(
    root,
    '.staging-analysis-assessment-' + crypto.randomBytes(8).toString('hex')
  );
  if (fs.existsSync(finalDirectory)) {
    throw assessmentError('Confirmatory assessment already exists: ' + id,
      'CONFIRMATORY_ASSESSMENT_EXISTS');
  }
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    writeJsonExclusive(path.join(staging, 'report.json'), report);
    const reportFile = path.join(staging, 'report.json');
    const manifest = {
      schema_version: report.schema_version,
      sciencecode_version: VERSION,
      analysis_assessment_id: id,
      created_at: now.toISOString(),
      chat_id: normalizedChatId,
      status: report.status,
      analysis_contract: {
        analysis_contract_id: binding.analysis_contract_id,
        manifest_sha256: binding.manifest_sha256,
        contract_sha256: binding.contract_sha256
      },
      experiment: {
        experiment_id: experimentId,
        manifest_sha256: experimentVerification.manifest_sha256,
        plan_sha256: experimentVerification.manifest.plan_sha256
      },
      deviation_note: normalizedDeviation,
      report: {
        file: 'report.json',
        sha256: sha256File(reportFile),
        bytes: fs.statSync(reportFile).size,
        engine_version: report.engine.version
      },
      summary: report.summary,
      interpretation: 'Immutable replayable assessment; scientific interpretation requires qualified review.',
      preservation_policy: 'immutable assessment over exact contract and experiment records'
    };
    writeJsonExclusive(path.join(staging, 'manifest.json'), manifest);
    writeTextExclusive(
      path.join(staging, 'manifest.sha256'),
      sha256File(path.join(staging, 'manifest.json')) + '\n'
    );
    fs.renameSync(staging, finalDirectory);
    const manifestSha256 = sha256File(path.join(finalDirectory, 'manifest.json'));
    appendAudit(project, {
      type: 'analysis_assessment.created',
      analysis_assessment_id: id,
      analysis_contract_id: binding.analysis_contract_id,
      experiment_id: experimentId,
      chat_id: normalizedChatId,
      status: report.status,
      registration_status: report.registration.status,
      manifest_sha256: manifestSha256,
      report_sha256: manifest.report.sha256
    });
    return {
      manifest,
      report,
      manifest_sha256: manifestSha256,
      directory: finalDirectory
    };
  } catch (error) {
    if (fs.existsSync(staging)) safeRemoveStaging(root, staging);
    throw error;
  }
}

export function getConfirmatoryAssessmentManifest(cwd, value) {
  const id = normalizeAssessmentId(value);
  const files = safeAssessmentFiles(cwd, id);
  if (!safeRegularFile(files.manifest, files.directory)) {
    throw assessmentError('Confirmatory assessment not found: ' + id,
      'CONFIRMATORY_ASSESSMENT_NOT_FOUND');
  }
  return readJson(files.manifest);
}

export function getConfirmatoryAssessmentReport(cwd, value) {
  const id = normalizeAssessmentId(value);
  const files = safeAssessmentFiles(cwd, id);
  getConfirmatoryAssessmentManifest(cwd, id);
  if (!safeRegularFile(files.report, files.directory)) {
    throw assessmentError('Confirmatory assessment report is missing or unsafe: ' + id,
      'CONFIRMATORY_ASSESSMENT_NOT_FOUND');
  }
  return readJson(files.report);
}

export function verifyConfirmatoryAssessment(cwd, value) {
  const project = path.resolve(cwd);
  let id;
  try {
    id = normalizeAssessmentId(value);
  } catch (error) {
    return {
      ok: false,
      analysis_assessment_id: String(value ?? ''),
      errors: [{ issue: error.code ?? 'confirmatory_assessment_error', detail: error.message }]
    };
  }
  let files;
  try {
    files = safeAssessmentFiles(project, id);
  } catch (error) {
    return {
      ok: false,
      analysis_assessment_id: id,
      errors: [{
        issue: error.code === 'CONFIRMATORY_ASSESSMENT_NOT_FOUND'
          ? 'confirmatory_assessment_missing'
          : error.code ?? 'invalid_confirmatory_assessment_path',
        detail: error.message
      }]
    };
  }
  const errors = [];
  let manifest = null;
  let report = null;
  try {
    if (!safeRegularFile(files.manifest, files.directory)) throw new Error('missing or unsafe file');
    manifest = readJson(files.manifest);
  } catch (error) {
    errors.push({ file: 'manifest.json', issue: 'invalid_json', detail: error.message });
  }
  try {
    if (!safeRegularFile(files.report, files.directory)) throw new Error('missing or unsafe file');
    report = readJson(files.report);
  } catch (error) {
    errors.push({ file: 'report.json', issue: 'invalid_json', detail: error.message });
  }
  const manifestSha256 = safeRegularFile(files.manifest, files.directory)
    ? sha256File(files.manifest)
    : null;
  if (!safeRegularFile(files.digest, files.directory)) {
    errors.push({ file: 'manifest.sha256', issue: 'missing' });
  } else {
    const expected = fs.readFileSync(files.digest, 'utf8').trim();
    if (expected !== manifestSha256) {
      errors.push({
        file: 'manifest.json',
        issue: 'hash_mismatch',
        expected,
        actual: manifestSha256
      });
    }
  }
  if (manifest) {
    if (![CONFIRMATORY_ASSESSMENT_LEGACY_SCHEMA_VERSION,
      CONFIRMATORY_ASSESSMENT_SCHEMA_VERSION,
      CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION].includes(manifest.schema_version)) {
      errors.push({ file: 'manifest.json', issue: 'unsupported_schema' });
    }
    const expectedEngineVersion = manifest.schema_version ===
      CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION
      ? CONFIRMATORY_INFERENTIAL_ENGINE_VERSION
      : manifest.schema_version === CONFIRMATORY_ASSESSMENT_SCHEMA_VERSION
        ? CONFIRMATORY_ENGINE_VERSION
        : CONFIRMATORY_LEGACY_ENGINE_VERSION;
    if (manifest.analysis_assessment_id !== id) {
      errors.push({ file: 'manifest.json', issue: 'analysis_assessment_id_mismatch' });
    }
    if (manifest.report?.file !== 'report.json' ||
        manifest.report?.engine_version !== expectedEngineVersion) {
      errors.push({ file: 'manifest.json', issue: 'invalid_report_descriptor' });
    }
  }
  const reportStat = fs.lstatSync(files.report, { throwIfNoEntry: false });
  const reportSha256 = safeRegularFile(files.report, files.directory)
    ? sha256File(files.report)
    : null;
  if (!safeRegularFile(files.report, files.directory)) {
    errors.push({ file: 'report.json', issue: 'missing' });
  } else if (manifest) {
    if (manifest.report?.sha256 !== reportSha256) {
      errors.push({
        file: 'report.json',
        issue: 'hash_mismatch',
        expected: manifest.report?.sha256 ?? null,
        actual: reportSha256
      });
    }
    if (manifest.report?.bytes !== reportStat.size) {
      errors.push({
        file: 'report.json',
        issue: 'size_mismatch',
        expected: manifest.report?.bytes ?? null,
        actual: reportStat.size
      });
    }
  }

  let contractVerification = null;
  let contractBinding = null;
  const contractId = manifest?.analysis_contract?.analysis_contract_id;
  if (contractId) {
    contractVerification = verifyAnalysisContract(project, contractId);
    if (!contractVerification.ok) {
      errors.push({
        issue: 'analysis_contract_invalid',
        analysis_contract_id: contractId,
        errors: contractVerification.errors
      });
    } else {
      contractBinding = getAnalysisContractBinding(project, contractId);
      if (contractBinding.manifest_sha256 !== manifest.analysis_contract.manifest_sha256 ||
          contractBinding.contract_sha256 !== manifest.analysis_contract.contract_sha256) {
        errors.push({ issue: 'analysis_contract_link_mismatch' });
      }
    }
  } else if (manifest) {
    errors.push({ file: 'manifest.json', issue: 'analysis_contract_missing' });
  }

  let experimentVerification = null;
  const experimentId = manifest?.experiment?.experiment_id;
  if (experimentId) {
    experimentVerification = verifyExperiment(project, experimentId);
    if (!experimentVerification.ok) {
      errors.push({
        issue: 'experiment_invalid',
        experiment_id: experimentId,
        errors: experimentVerification.errors
      });
    } else if (
      experimentVerification.manifest_sha256 !== manifest.experiment.manifest_sha256 ||
      experimentVerification.manifest.plan_sha256 !== manifest.experiment.plan_sha256
    ) {
      errors.push({ issue: 'experiment_link_mismatch' });
    }
  } else if (manifest) {
    errors.push({ file: 'manifest.json', issue: 'experiment_missing' });
  }

  if (manifest && report && contractVerification?.ok && experimentVerification?.ok) {
    try {
      const documents = readExperimentDocuments(project, experimentId);
      const expected = evaluateConfirmatoryExperiment({
        contractId,
        contractBinding,
        contract: contractVerification.contract,
        experimentId,
        experimentManifest: experimentVerification.manifest,
        experimentManifestSha256: experimentVerification.manifest_sha256,
        plan: documents.plan,
        results: documents.results,
        deviationNote: manifest.deviation_note
      });
      if (!sameJson(expected, report)) {
        errors.push({ file: 'report.json', issue: 'assessment_replay_mismatch' });
      }
      if (manifest.status !== report.status || !sameJson(manifest.summary, report.summary)) {
        errors.push({ file: 'manifest.json', issue: 'report_summary_mismatch' });
      }
    } catch (error) {
      errors.push({
        file: 'report.json',
        issue: error.code ?? 'assessment_replay_failed',
        detail: error.message
      });
    }
  }

  const audit = verifyAudit(project);
  if (!audit.ok) {
    errors.push({ issue: 'audit_invalid', errors: audit.errors });
  } else if (manifest) {
    const event = readAuditRecords(project).findLast((record) =>
      record.type === 'analysis_assessment.created' &&
      record.analysis_assessment_id === id
    );
    if (!event) {
      errors.push({ issue: 'missing_audit_event' });
    } else if (
      event.manifest_sha256 !== manifestSha256 ||
      event.report_sha256 !== reportSha256 ||
      event.analysis_contract_id !== contractId ||
      event.experiment_id !== experimentId ||
      event.status !== manifest.status
    ) {
      errors.push({ issue: 'audit_assessment_mismatch' });
    }
  }
  return {
    ok: errors.length === 0,
    analysis_assessment_id: id,
    manifest,
    report,
    manifest_sha256: manifestSha256,
    report_sha256: reportSha256,
    analysis_contract: contractVerification,
    experiment: experimentVerification,
    errors
  };
}

export function getConfirmatoryAssessment(cwd, value) {
  const id = normalizeAssessmentId(value);
  const verification = verifyConfirmatoryAssessment(cwd, id);
  if (!verification.manifest || !verification.report) {
    throw assessmentError('Confirmatory assessment not found: ' + id,
      'CONFIRMATORY_ASSESSMENT_NOT_FOUND');
  }
  return {
    manifest: verification.manifest,
    report: verification.report,
    verification
  };
}

export function listConfirmatoryAssessments(cwd, { chatId, contractId, experimentId } = {}) {
  const records = assessmentIds(cwd).map((id) => {
    const verification = verifyConfirmatoryAssessment(cwd, id);
    const manifest = verification.manifest;
    const report = verification.report;
    return {
      analysis_assessment_id: id,
      status: manifest?.status ?? 'invalid',
      schema_version: manifest?.schema_version ?? null,
      registration_status: report?.registration?.status ?? null,
      outcome_verdict: report?.summary?.outcome_verdict ?? null,
      verified: verification.ok,
      created_at: manifest?.created_at ?? null,
      chat_id: manifest?.chat_id ?? null,
      analysis_contract_id: manifest?.analysis_contract?.analysis_contract_id ?? null,
      experiment_id: manifest?.experiment?.experiment_id ?? null,
      summary: report?.summary ?? manifest?.summary ?? {},
      current_for_pair: false,
      superseded_by: null,
      errors: verification.errors,
      url: '/api/analysis-assessments/' + encodeURIComponent(id)
    };
  });
  const current = new Map();
  for (const record of records.filter((item) => item.verified)) {
    const key = record.analysis_contract_id + '\n' + record.experiment_id;
    const existing = current.get(key);
    if (!existing ||
        String(record.created_at ?? '').localeCompare(String(existing.created_at ?? '')) > 0 ||
        (record.created_at === existing.created_at &&
         record.analysis_assessment_id.localeCompare(existing.analysis_assessment_id) > 0)) {
      current.set(key, record);
    }
  }
  for (const record of records) {
    const key = record.analysis_contract_id + '\n' + record.experiment_id;
    const latest = current.get(key);
    record.current_for_pair = latest?.analysis_assessment_id === record.analysis_assessment_id;
    record.superseded_by = latest && latest.analysis_assessment_id !== record.analysis_assessment_id
      ? latest.analysis_assessment_id
      : null;
  }
  return records.filter((item) =>
    (!chatId || item.chat_id === chatId) &&
    (!contractId || item.analysis_contract_id === contractId) &&
    (!experimentId || item.experiment_id === experimentId)
  ).sort((left, right) =>
    String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) ||
    right.analysis_assessment_id.localeCompare(left.analysis_assessment_id)
  );
}

export function confirmatoryAssessmentInteractionArtifact(value) {
  const manifest = value.manifest ?? value;
  return {
    kind: 'analysis-assessment',
    record_id: manifest.analysis_assessment_id,
    name: 'Confirmatory assessment ' + manifest.analysis_assessment_id,
    url: '/api/analysis-assessments/' + encodeURIComponent(manifest.analysis_assessment_id)
  };
}

export function confirmatoryAssessmentInteractionPayload(value, note = null) {
  const manifest = value.manifest ?? value;
  const report = value.report ?? {};
  return {
    analysis_assessment_id: manifest.analysis_assessment_id,
    analysis_contract_id: manifest.analysis_contract?.analysis_contract_id ??
      report.analysis_contract?.analysis_contract_id,
    experiment_id: manifest.experiment?.experiment_id ?? report.experiment?.experiment_id,
    status: report.status ?? manifest.status,
    registration_status: report.registration?.status ?? null,
    outcome_verdict: report.summary?.outcome_verdict ?? null,
    summary: report.summary ?? manifest.summary ?? {},
    primary_outcomes: (report.outcomes ?? [])
      .filter((outcome) => outcome.role === 'primary')
      .slice(0, 32)
      .map((outcome) => ({
        outcome_id: outcome.outcome_id,
        label: outcome.label,
        unit: outcome.unit,
        aggregate_value: outcome.aggregate_value,
        observed_count: outcome.observed_count,
        missing_count: outcome.missing_count,
        decision_rule: outcome.decision_rule,
        ...(outcome.inference ? {
          inference: {
            test: outcome.inference.test,
            sidedness: outcome.inference.sidedness,
            alpha: outcome.inference.alpha,
            p_value: outcome.inference.p_value,
            adjusted_p_value: outcome.inference.adjusted_p_value,
            confidence_interval: outcome.inference.confidence_interval ?? null,
            effect_size: outcome.inference.effect_size ?? null,
            tost: outcome.inference.tost ?? null,
            multiplicity_correction: outcome.inference.multiplicity_correction,
            conclusion: outcome.inference.conclusion
          }
        } : {}),
        status: outcome.status
      })),
    deviations: report.registration?.automatic_deviations ?? [],
    disclosed_deviation: report.registration?.disclosed_deviation ?? null,
    note,
    interpretation: (report.schema_version ?? manifest.schema_version) >=
        CONFIRMATORY_INFERENTIAL_SCHEMA_VERSION
      ? 'deterministic replay of preregistered hypothesis tests under stated, unchecked assumptions; no causal claim'
      : 'deterministic threshold replay; no inferential or causal claim'
  };
}
