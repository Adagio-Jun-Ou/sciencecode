import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENCHMARK_MANIFEST_SCHEMA_VERSION,
  BENCHMARK_REPORT_SCHEMA_VERSION,
  BENCHMARK_RUN_SCHEMA_VERSION,
  MAX_BENCHMARK_BASELINES,
  MAX_BENCHMARK_CASES,
  MAX_BENCHMARK_CASE_FILE_BYTES,
  MAX_BENCHMARK_LABEL_FILE_BYTES,
  MAX_BENCHMARK_MANIFEST_BYTES,
  MAX_BENCHMARK_RUN_BYTES,
  SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER,
  createScienceCodeBenchmarkRun,
  formatScienceCodeBenchmark,
  inspectScienceCodeBenchmark,
  scoreScienceCodeBenchmark,
  sha256Buffer,
  sha256Json,
  writeScienceCodeBenchmarkRun
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSITIVE = 'requires_citation';
const NEGATIVE = 'does_not_require_citation';

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; }
  };
}

function invoke(argv, cwd) {
  const stdout = capture();
  const stderr = capture();
  const code = runCli({
    argv,
    cwd,
    root: packageRoot,
    env: process.env,
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  return { code, stdout: stdout.read(), stderr: stderr.read() };
}

function serializeJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function serializeJsonLines(values) {
  return values.map((value) => JSON.stringify(value)).join('\n') + '\n';
}

function digestText(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

function canonicalPredictionDigest(predictions) {
  return sha256Json([...predictions]
    .map((item) => ({ case_id: item.case_id, label: item.label }))
    .sort((left, right) => left.case_id.localeCompare(right.case_id)));
}

function benchmarkRun({
  runId,
  benchmarkId,
  benchmarkVersion,
  casesSha256,
  labelsSha256,
  frozenAt,
  predictions,
  systemName = 'External benchmark system',
  systemVersion = '1.0.0',
  adapter = 'external-reviewer-v1'
}) {
  return {
    schema_version: BENCHMARK_RUN_SCHEMA_VERSION,
    run_id: runId,
    benchmark: {
      benchmark_id: benchmarkId,
      benchmark_version: benchmarkVersion,
      cases_sha256: casesSha256,
      labels_sha256: labelsSha256
    },
    system: {
      name: systemName,
      version: systemVersion,
      adapter
    },
    predictions_frozen_at: frozenAt,
    label_access: 'unavailable_until_predictions_frozen',
    method: 'Predictions were produced from held-out input text before the expert label file was made available.',
    predictions,
    predictions_sha256: canonicalPredictionDigest(predictions)
  };
}

function fixtureCases() {
  const positiveTexts = [
    'The intervention increased response by 17 percent.',
    'Median survival was 14 months.',
    'Exposure was associated with lower risk in the cohort.',
    'The treatment did not reduce mortality in the controlled study.',
    'The measured concentration was 8 milligrams per liter.',
    'Participants receiving the intervention recovered faster.',
    'The assay detected a significant increase in expression.',
    'The observed rate declined from 20 percent to 11 percent.',
    'The model predicted higher response in the validation cohort.',
    'Temperature was 4 degrees higher after treatment.'
  ];
  const negativeTexts = [
    'This section describes the workflow used in the analysis.',
    'The project archive was created in 2020 for this analysis.',
    '```python\nprint("The treatment increased response by 99 percent.")\n```',
    '    The command increased a synthetic response by 777 percent.',
    'TODO: The treatment increased response by 99 percent.',
    '## References\nA reference claimed a 42 percent effect in the cohort.',
    'This paragraph introduces the next section of the report.',
    'The following table contains the recorded workflow fields.',
    'The appendix documents how files are organized.',
    'This sentence is a navigation note for readers.'
  ];
  return [...positiveTexts, ...negativeTexts].map((text, index) => ({
    case_id: 'case-' + String(index + 1).padStart(3, '0'),
    text,
    stratum: index < 10 ? 'scientific-claims' : 'non-claim-prose'
  }));
}

function externalPredictions(cases, kind) {
  return cases.map((item, index) => {
    let label;
    if (kind === 'candidate') {
      label = index < 8 || index >= 11 ? POSITIVE : NEGATIVE;
      if (index >= 11) label = NEGATIVE;
      if (index === 10) label = POSITIVE;
    } else if (kind === 'baseline') {
      label = index < 7 || (index >= 12) ? POSITIVE : NEGATIVE;
      if (index >= 12) label = NEGATIVE;
      if (index === 10 || index === 11) label = POSITIVE;
    } else {
      label = null;
    }
    return { case_id: item.case_id, label };
  });
}

function createBenchmarkFixture(context, {
  corpusFrozenAt = '2026-01-01T00:00:00.000Z',
  labelsUnsealedAt = '2026-01-03T00:00:00.000Z',
  runFrozenAt = '2026-01-02T00:00:00.000Z',
  labelForIndex = (index) => index < 10 ? POSITIVE : NEGATIVE
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-benchmark-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cases = fixtureCases();
  const labels = cases.map((item, index) => ({
    case_id: item.case_id,
    label: labelForIndex(index)
  }));
  const casesText = serializeJsonLines(cases);
  const labelsText = serializeJsonLines(labels);
  const casesSha256 = digestText(casesText);
  const labelsSha256 = digestText(labelsText);
  const benchmarkId = 'independent-reviewer-corpus';
  const benchmarkVersion = '1.0.0';
  const baseline = benchmarkRun({
    runId: 'published-baseline',
    benchmarkId,
    benchmarkVersion,
    casesSha256,
    labelsSha256,
    frozenAt: runFrozenAt,
    predictions: externalPredictions(cases, 'baseline'),
    systemName: 'Published external baseline'
  });
  const baselineText = serializeJson(baseline);
  const manifest = {
    schema_version: BENCHMARK_MANIFEST_SCHEMA_VERSION,
    benchmark_id: benchmarkId,
    benchmark_version: benchmarkVersion,
    title: 'Independent reviewer citation-requirement corpus',
    description: 'A held-out text corpus for independently reviewing whether scientific prose requires a citation.',
    split: 'held_out_test',
    task: {
      adapter: SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER,
      positive_label: POSITIVE,
      negative_label: NEGATIVE
    },
    cases: { file: 'cases.jsonl', sha256: casesSha256, count: cases.length },
    labels: { file: 'labels.jsonl', sha256: labelsSha256, count: labels.length },
    baselines: [{
      baseline_id: 'published-baseline',
      run_file: 'baseline.json',
      run_sha256: digestText(baselineText)
    }],
    thresholds: {
      minimum_accuracy: 0.8,
      minimum_precision: 0.8,
      minimum_recall: 0.75,
      maximum_abstention_rate: 0
    },
    governance: {
      independent_from_sciencecode: true,
      independent_creator: 'Independent Evaluation Consortium',
      independence_statement: 'Corpus authors and adjudicators did not participate in ScienceCode implementation or fixture selection.',
      labeler_count: 3,
      expertise_statement: 'All labelers had documented experience reviewing scientific manuscripts and citation requirements.',
      labeling_protocol: 'Two experts labeled every case independently using a frozen rubric before an adjudicator reviewed disagreements.',
      adjudication_protocol: 'A third expert resolved disagreements without seeing candidate or baseline predictions and recorded the final label.',
      blinding_protocol: 'Candidate and baseline predictions were frozen and hashed before the expert label file was made available for scoring.',
      license: 'CC-BY-4.0',
      source_citation: 'Independent Evaluation Consortium, Reviewer Corpus version 1.0.0.',
      limitations: 'This synthetic test fixture demonstrates the governed workflow and is not itself an external performance claim.',
      corpus_frozen_at: corpusFrozenAt,
      labels_unsealed_at: labelsUnsealedAt
    }
  };
  const files = {
    manifest: path.join(directory, 'benchmark.json'),
    cases: path.join(directory, 'cases.jsonl'),
    labels: path.join(directory, 'labels.jsonl'),
    baseline: path.join(directory, 'baseline.json'),
    candidate: path.join(directory, 'candidate.json')
  };
  fs.writeFileSync(files.cases, casesText, 'utf8');
  fs.writeFileSync(files.labels, labelsText, 'utf8');
  fs.writeFileSync(files.baseline, baselineText, 'utf8');
  fs.writeFileSync(files.manifest, serializeJson(manifest), 'utf8');
  const candidate = benchmarkRun({
    runId: 'candidate-reviewer',
    benchmarkId,
    benchmarkVersion,
    casesSha256,
    labelsSha256,
    frozenAt: runFrozenAt,
    predictions: externalPredictions(cases, 'candidate')
  });
  fs.writeFileSync(files.candidate, serializeJson(candidate), 'utf8');
  return { directory, files, manifest, cases, labels, baseline, candidate };
}

test('benchmark inspection and ScienceCode prediction do not open sealed labels or baselines', (context) => {
  const fixture = createBenchmarkFixture(context);
  fs.unlinkSync(fixture.files.labels);
  fs.unlinkSync(fixture.files.baseline);

  const inspection = inspectScienceCodeBenchmark({ manifestPath: fixture.files.manifest });
  assert.equal(inspection.schema_version, BENCHMARK_REPORT_SCHEMA_VERSION);
  assert.equal(inspection.report_kind, 'benchmark_inspection');
  assert.equal(inspection.status, 'inputs_inspected');
  assert.equal(inspection.cases.count, 20);
  assert.deepEqual(inspection.cases.strata, ['non-claim-prose', 'scientific-claims']);
  assert.equal(inspection.sealed_bindings.labels.opened, false);
  assert.equal(inspection.sealed_bindings.baselines[0].opened, false);
  assert.doesNotMatch(JSON.stringify(inspection), /intervention increased response/i);

  const run = createScienceCodeBenchmarkRun({
    manifestPath: fixture.files.manifest,
    now: new Date('2026-01-02T12:00:00.000Z')
  });
  assert.equal(run.schema_version, BENCHMARK_RUN_SCHEMA_VERSION);
  assert.equal(run.system.adapter, SCIENCECODE_REVIEWER_BENCHMARK_ADAPTER);
  assert.equal(run.predictions.length, 20);
  assert.equal(run.predictions[0].label, POSITIVE);
  assert.equal(run.predictions[10].label, NEGATIVE);
  assert.ok(run.predictions.every((item) => [POSITIVE, NEGATIVE].includes(item.label)));
  assert.equal(run.predictions_sha256, canonicalPredictionDigest(run.predictions));

  const written = writeScienceCodeBenchmarkRun({
    manifestPath: fixture.files.manifest,
    outputPath: 'sciencecode-run.json',
    cwd: fixture.directory,
    now: new Date('2026-01-02T12:00:00.000Z')
  });
  assert.equal(written.output_file, 'sciencecode-run.json');
  assert.match(written.output_sha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () => writeScienceCodeBenchmarkRun({
      manifestPath: fixture.files.manifest,
      outputPath: 'sciencecode-run.json',
      cwd: fixture.directory,
      now: new Date('2026-01-02T12:00:00.000Z')
    }),
    (error) => error.code === 'BENCHMARK_OUTPUT_EXISTS'
  );

  const formatted = formatScienceCodeBenchmark(inspection);
  assert.match(formatted, /INPUTS INSPECTED WITHOUT LABELS/);
  assert.match(formatted, /content not opened/);
});

test('governed benchmark scoring reports deterministic Wilson metrics and paired baselines', (context) => {
  const fixture = createBenchmarkFixture(context);
  const options = {
    manifestPath: fixture.files.manifest,
    predictionsPath: fixture.files.candidate,
    now: new Date('2026-01-04T00:00:00.000Z')
  };
  const first = scoreScienceCodeBenchmark(options);
  const second = scoreScienceCodeBenchmark(options);

  assert.equal(first.schema_version, BENCHMARK_REPORT_SCHEMA_VERSION);
  assert.equal(first.report_kind, 'benchmark_score');
  assert.equal(first.status, 'pass');
  assert.equal(first.candidate.metrics.correct, 17);
  assert.equal(first.candidate.metrics.accuracy.value, 0.85);
  assert.equal(first.candidate.metrics.precision.value, 0.888888889);
  assert.equal(first.candidate.metrics.recall.value, 0.8);
  assert.equal(first.candidate.metrics.abstention_rate.value, 0);
  assert.deepEqual(first.candidate.metrics.confusion, {
    true_positive: 8,
    false_positive: 1,
    true_negative: 9,
    false_negative: 2,
    abstained_positive: 0,
    abstained_negative: 0
  });
  assert.equal(first.candidate.metrics.accuracy.confidence_interval.method, 'wilson_score');
  assert.ok(first.candidate.metrics.accuracy.confidence_interval.lower < 0.85);
  assert.ok(first.candidate.metrics.accuracy.confidence_interval.upper > 0.85);
  assert.equal(first.thresholds.pass, true);
  assert.ok(first.thresholds.checks.every((item) => item.pass));
  assert.equal(first.baselines.length, 1);
  assert.equal(first.baselines[0].metrics.accuracy.value, 0.75);
  assert.deepEqual(first.baselines[0].comparison, {
    accuracy_delta: 0.1,
    candidate_only_correct: 2,
    baseline_only_correct: 0,
    both_correct: 15,
    neither_correct: 3
  });
  assert.equal(first.candidate.strata.length, 2);
  assert.equal(first.cases.length, 20);
  assert.equal(first.fingerprint_sha256, second.fingerprint_sha256);
  assert.deepEqual(first, second);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, new RegExp(fixture.directory.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
  assert.doesNotMatch(serialized, /The intervention increased response/);
  assert.match(first.limitations.join(' '), /do not independently prove/i);
  assert.match(first.limitations.join(' '), /never replace, waive, or lower/i);

  const formatted = formatScienceCodeBenchmark(first);
  assert.match(formatted, /governed benchmark: PASS/i);
  assert.match(formatted, /Accuracy: 0\.850000 \(95% Wilson/);
  assert.match(formatted, /candidate delta 0\.100000/);
});

test('benchmark scoring penalizes abstention and fails prospective thresholds', (context) => {
  const fixture = createBenchmarkFixture(context);
  const abstaining = benchmarkRun({
    runId: 'abstaining-candidate',
    benchmarkId: fixture.manifest.benchmark_id,
    benchmarkVersion: fixture.manifest.benchmark_version,
    casesSha256: fixture.manifest.cases.sha256,
    labelsSha256: fixture.manifest.labels.sha256,
    frozenAt: '2026-01-02T00:00:00.000Z',
    predictions: externalPredictions(fixture.cases, 'abstain')
  });
  fs.writeFileSync(fixture.files.candidate, serializeJson(abstaining), 'utf8');
  const report = scoreScienceCodeBenchmark({
    manifestPath: fixture.files.manifest,
    predictionsPath: fixture.files.candidate,
    now: new Date('2026-01-04T00:00:00.000Z')
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.candidate.metrics.accuracy.value, 0);
  assert.equal(report.candidate.metrics.coverage.value, 0);
  assert.equal(report.candidate.metrics.abstention_rate.value, 1);
  assert.equal(report.candidate.metrics.precision.value, null);
  assert.equal(report.candidate.metrics.recall.value, 0);
  assert.equal(report.candidate.metrics.specificity.value, 0);
  assert.equal(report.thresholds.pass, false);
  assert.deepEqual(
    report.thresholds.checks.filter((item) => !item.pass).map((item) => item.metric),
    ['accuracy', 'precision', 'recall', 'abstention_rate']
  );
  assert.match(formatScienceCodeBenchmark(report), /Failed thresholds:/);
});

test('benchmark timeline, hashes, run coverage, encoding, and bundle containment fail closed', (context) => {
  const fixture = createBenchmarkFixture(context);
  fs.writeFileSync(fixture.files.labels, Buffer.from([0xff, 0xfe, 0xfd]));
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: fixture.files.manifest,
      predictionsPath: fixture.files.candidate,
      now: new Date('2026-01-02T12:00:00.000Z')
    }),
    (error) => error.code === 'BENCHMARK_LABELS_SEALED'
  );

  const malformed = structuredClone(fixture.candidate);
  malformed.predictions.pop();
  malformed.predictions_sha256 = canonicalPredictionDigest(malformed.predictions);
  fs.writeFileSync(fixture.files.candidate, serializeJson(malformed), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: fixture.files.manifest,
      predictionsPath: fixture.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    (error) => error.code === 'INVALID_BENCHMARK_RUN' && /one prediction per case/i.test(error.message)
  );

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-benchmark-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const externalCases = path.join(outside, 'cases.jsonl');
  fs.copyFileSync(fixture.files.cases, externalCases);
  const linked = path.join(fixture.directory, 'linked');
  try {
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      context.skip('Directory links are unavailable on this host.');
      return;
    }
    throw error;
  }
  const escapedManifest = structuredClone(fixture.manifest);
  escapedManifest.cases.file = 'linked/cases.jsonl';
  fs.writeFileSync(fixture.files.manifest, serializeJson(escapedManifest), 'utf8');
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: fixture.files.manifest }),
    /unsafe bundle directory|outside the benchmark bundle/i
  );
});

test('benchmark schemas, exact hashes, blind-window timestamps, and output paths are strict', (context) => {
  const caseTamper = createBenchmarkFixture(context);
  fs.appendFileSync(caseTamper.files.cases, '{"case_id":"extra","text":"extra"}\n', 'utf8');
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: caseTamper.files.manifest }),
    /exactly 20 nonempty JSON lines|case-file SHA-256 mismatch/i
  );

  const labelEncoding = createBenchmarkFixture(context);
  fs.writeFileSync(labelEncoding.files.labels, Buffer.from([0xff, 0xfe, 0xfd]));
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: labelEncoding.files.manifest,
      predictionsPath: labelEncoding.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /label file must be valid UTF-8/i
  );

  const baselineTamper = createBenchmarkFixture(context);
  fs.appendFileSync(baselineTamper.files.baseline, ' ', 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: baselineTamper.files.manifest,
      predictionsPath: baselineTamper.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /baseline SHA-256 mismatch/i
  );

  const schema = createBenchmarkFixture(context);
  const unknown = { ...schema.manifest, undeclared_policy: true };
  fs.writeFileSync(schema.files.manifest, serializeJson(unknown), 'utf8');
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: schema.files.manifest }),
    /unknown field.*undeclared_policy/i
  );

  const timing = createBenchmarkFixture(context);
  assert.throws(
    () => createScienceCodeBenchmarkRun({
      manifestPath: timing.files.manifest,
      now: new Date('2026-01-03T00:00:00.000Z')
    }),
    (error) => error.code === 'BENCHMARK_PREDICTION_WINDOW_CLOSED'
  );
  const late = { ...timing.candidate, predictions_frozen_at: '2026-01-03T00:00:00.000Z' };
  fs.writeFileSync(timing.files.candidate, serializeJson(late), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: timing.files.manifest,
      predictionsPath: timing.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    (error) => error.code === 'INVALID_BENCHMARK_RUN' && /blind window/i.test(error.message)
  );
  assert.throws(
    () => writeScienceCodeBenchmarkRun({
      manifestPath: timing.files.manifest,
      outputPath: path.join('..', 'escaped-benchmark-run.json'),
      cwd: timing.directory,
      now: new Date('2026-01-02T00:00:00.000Z')
    }),
    (error) => error.code === 'BENCHMARK_OUTPUT_PATH'
  );

  const moving = createBenchmarkFixture(context);
  const originalReadFileSync = fs.readFileSync;
  let changed = false;
  fs.readFileSync = function injectedMovingRead(file, ...args) {
    const result = originalReadFileSync.call(fs, file, ...args);
    if (!changed && typeof file === 'number') {
      changed = true;
      fs.appendFileSync(moving.files.manifest, ' ', 'utf8');
    }
    return result;
  };
  try {
    assert.throws(
      () => inspectScienceCodeBenchmark({ manifestPath: moving.files.manifest }),
      /changed while it was being read/i
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('benchmark manifest, corpus, label, run, text, count, and baseline ceilings fail before parsing', (context) => {
  const manifestSize = createBenchmarkFixture(context);
  fs.writeFileSync(
    manifestSize.files.manifest,
    Buffer.alloc(MAX_BENCHMARK_MANIFEST_BYTES + 1, 0x20)
  );
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: manifestSize.files.manifest }),
    (error) => error.code === 'BENCHMARK_TOO_LARGE'
  );

  const caseSize = createBenchmarkFixture(context);
  fs.truncateSync(caseSize.files.cases, MAX_BENCHMARK_CASE_FILE_BYTES + 1);
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: caseSize.files.manifest }),
    (error) => error.code === 'BENCHMARK_TOO_LARGE'
  );

  const labelSize = createBenchmarkFixture(context);
  fs.truncateSync(labelSize.files.labels, MAX_BENCHMARK_LABEL_FILE_BYTES + 1);
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: labelSize.files.manifest,
      predictionsPath: labelSize.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    (error) => error.code === 'BENCHMARK_TOO_LARGE'
  );

  const runSize = createBenchmarkFixture(context);
  fs.truncateSync(runSize.files.candidate, MAX_BENCHMARK_RUN_BYTES + 1);
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: runSize.files.manifest,
      predictionsPath: runSize.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    (error) => error.code === 'BENCHMARK_TOO_LARGE'
  );

  const counts = createBenchmarkFixture(context);
  const tooMany = structuredClone(counts.manifest);
  tooMany.cases.count = MAX_BENCHMARK_CASES + 1;
  tooMany.labels.count = MAX_BENCHMARK_CASES + 1;
  fs.writeFileSync(counts.files.manifest, serializeJson(tooMany), 'utf8');
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: counts.files.manifest }),
    /count must be an integer/i
  );

  const baselines = createBenchmarkFixture(context);
  const tooManyBaselines = structuredClone(baselines.manifest);
  tooManyBaselines.baselines = Array.from(
    { length: MAX_BENCHMARK_BASELINES + 1 },
    (_, index) => ({
      baseline_id: 'baseline-' + index,
      run_file: 'baseline-' + index + '.json',
      run_sha256: '0'.repeat(64)
    })
  );
  fs.writeFileSync(baselines.files.manifest, serializeJson(tooManyBaselines), 'utf8');
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: baselines.files.manifest }),
    /baselines must contain from 1 through/i
  );

  const textSize = createBenchmarkFixture(context);
  const oversizedCases = structuredClone(textSize.cases);
  oversizedCases[0].text = 'a'.repeat(64 * 1024 + 1);
  const oversizedCaseText = serializeJsonLines(oversizedCases);
  const oversizedManifest = structuredClone(textSize.manifest);
  oversizedManifest.cases.sha256 = digestText(oversizedCaseText);
  fs.writeFileSync(textSize.files.cases, oversizedCaseText, 'utf8');
  fs.writeFileSync(textSize.files.manifest, serializeJson(oversizedManifest), 'utf8');
  assert.throws(
    () => inspectScienceCodeBenchmark({ manifestPath: textSize.files.manifest }),
    /65536 UTF-8 bytes/i
  );

  const missingLabels = createBenchmarkFixture(context);
  fs.unlinkSync(missingLabels.files.labels);
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: missingLabels.files.manifest,
      predictionsPath: missingLabels.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /label file is unavailable/i
  );
});

test('benchmark prediction coverage, declared labels, canonical digests, class balance, and identities are exact', (context) => {
  const digest = createBenchmarkFixture(context);
  const digestMismatch = { ...digest.candidate, predictions_sha256: '0'.repeat(64) };
  fs.writeFileSync(digest.files.candidate, serializeJson(digestMismatch), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: digest.files.manifest,
      predictionsPath: digest.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /prediction digest does not match/i
  );

  const duplicate = createBenchmarkFixture(context);
  const duplicateRun = structuredClone(duplicate.candidate);
  duplicateRun.predictions.at(-1).case_id = duplicateRun.predictions[0].case_id;
  duplicateRun.predictions_sha256 = canonicalPredictionDigest(duplicateRun.predictions);
  fs.writeFileSync(duplicate.files.candidate, serializeJson(duplicateRun), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: duplicate.files.manifest,
      predictionsPath: duplicate.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /predicts a case more than once/i
  );

  const extra = createBenchmarkFixture(context);
  const extraRun = structuredClone(extra.candidate);
  extraRun.predictions.at(-1).case_id = 'case-extra';
  extraRun.predictions_sha256 = canonicalPredictionDigest(extraRun.predictions);
  fs.writeFileSync(extra.files.candidate, serializeJson(extraRun), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: extra.files.manifest,
      predictionsPath: extra.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /predicts an unknown case/i
  );

  const label = createBenchmarkFixture(context);
  const undeclared = structuredClone(label.candidate);
  undeclared.predictions[0].label = 'uncertain';
  undeclared.predictions_sha256 = canonicalPredictionDigest(undeclared.predictions);
  fs.writeFileSync(label.files.candidate, serializeJson(undeclared), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: label.files.manifest,
      predictionsPath: label.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /undeclared prediction label/i
  );

  const baselineIdentity = createBenchmarkFixture(context);
  const renamedBaseline = { ...baselineIdentity.baseline, run_id: 'different-baseline' };
  const renamedBaselineText = serializeJson(renamedBaseline);
  const reboundManifest = structuredClone(baselineIdentity.manifest);
  reboundManifest.baselines[0].run_sha256 = digestText(renamedBaselineText);
  fs.writeFileSync(baselineIdentity.files.baseline, renamedBaselineText, 'utf8');
  fs.writeFileSync(baselineIdentity.files.manifest, serializeJson(reboundManifest), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: baselineIdentity.files.manifest,
      predictionsPath: baselineIdentity.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /baseline ID does not match its run/i
  );

  const candidateIdentity = createBenchmarkFixture(context);
  const impersonating = { ...candidateIdentity.candidate, run_id: 'published-baseline' };
  fs.writeFileSync(candidateIdentity.files.candidate, serializeJson(impersonating), 'utf8');
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: candidateIdentity.files.manifest,
      predictionsPath: candidateIdentity.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /distinct from every published baseline/i
  );

  const oneClass = createBenchmarkFixture(context, { labelForIndex: () => POSITIVE });
  assert.throws(
    () => scoreScienceCodeBenchmark({
      manifestPath: oneClass.files.manifest,
      predictionsPath: oneClass.files.candidate,
      now: new Date('2026-01-04T00:00:00.000Z')
    }),
    /labels must contain both declared classes/i
  );
});

test('benchmark CLI exposes blind inspection, prediction, scoring, aliases, and strict options', (context) => {
  const scored = createBenchmarkFixture(context);
  const score = invoke([
    'benchmark', 'score', 'benchmark.json', '--predictions', 'candidate.json', '--json'
  ], scored.directory);
  assert.equal(score.code, 0, score.stderr);
  assert.equal(JSON.parse(score.stdout).candidate.metrics.accuracy.value, 0.85);

  const abstaining = benchmarkRun({
    runId: 'cli-abstaining-candidate',
    benchmarkId: scored.manifest.benchmark_id,
    benchmarkVersion: scored.manifest.benchmark_version,
    casesSha256: scored.manifest.cases.sha256,
    labelsSha256: scored.manifest.labels.sha256,
    frozenAt: '2026-01-02T00:00:00.000Z',
    predictions: externalPredictions(scored.cases, 'abstain')
  });
  fs.writeFileSync(path.join(scored.directory, 'abstain.json'), serializeJson(abstaining), 'utf8');
  const failedScore = invoke([
    'benchmark', 'score', 'benchmark.json', '--predictions', 'abstain.json', '--json'
  ], scored.directory);
  assert.equal(failedScore.code, 1, failedScore.stderr);
  assert.equal(JSON.parse(failedScore.stdout).status, 'fail');

  const inspect = invoke(['bench', 'inspect', 'benchmark.json'], scored.directory);
  assert.equal(inspect.code, 0, inspect.stderr);
  assert.match(inspect.stdout, /INPUTS INSPECTED WITHOUT LABELS/);

  const future = createBenchmarkFixture(context, {
    corpusFrozenAt: '2020-01-01T00:00:00.000Z',
    labelsUnsealedAt: '2099-01-01T00:00:00.000Z',
    runFrozenAt: '2021-01-01T00:00:00.000Z'
  });
  const predict = invoke([
    'benchmarks', 'predict', 'benchmark.json', '--output', 'sciencecode.json', '--json'
  ], future.directory);
  assert.equal(predict.code, 0, predict.stderr);
  const predictionResult = JSON.parse(predict.stdout);
  assert.equal(predictionResult.run.predictions.length, 20);
  assert.equal(fs.existsSync(path.join(future.directory, 'sciencecode.json')), true);
  const duplicate = invoke([
    'benchmark', 'predict', 'benchmark.json', '--output', 'sciencecode.json'
  ], future.directory);
  assert.equal(duplicate.code, 2);
  assert.match(duplicate.stderr, /never overwritten/i);

  const help = invoke(['benchmark', '--help'], scored.directory);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Wilson intervals/);
  assert.match(help.stdout, /never replace or weaken/i);
  const subcommandHelp = invoke(['benchmark', 'score', '--help'], scored.directory);
  assert.equal(subcommandHelp.code, 0, subcommandHelp.stderr);
  assert.match(subcommandHelp.stdout, /--predictions RUN\.json/);

  const invalid = invoke(['benchmark', 'score', 'benchmark.json', '--unknown'], scored.directory);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Unknown option: --unknown/);
});
