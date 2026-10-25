import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERSION,
  buildLineageGraph,
  createArtifactRevision,
  createChatSession,
  createSemanticReview,
  evaluateArithmetic,
  extractNumericLiterals,
  extractScientificClaims,
  ingestEvidence,
  interactionAwarePrompt,
  listSemanticReviews,
  readEvidenceSpans,
  readAuditRecords,
  recordInteraction,
  runSimulation,
  semanticReviewInteractionArtifact,
  semanticReviewInteractionPayload,
  startLab,
  verifyProject,
  verifySemanticReview
} from '../lib/core.js';
import { runCli } from '../lib/cli.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function fakeRuntime() {
  return {
    healthy: true,
    profile: 'science',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: ['numpy==2.3.5'] },
    probe: { python: '3.11.9', torch: { version: '2.12.0', cuda_available: false } }
  };
}

function artifactSource(simulation, name) {
  return {
    kind: 'simulation',
    record_id: simulation.manifest.simulation_id,
    name,
    url: '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) + '/' +
      name.split('/').map(encodeURIComponent).join('/'),
    sha256: simulation.manifest.artifacts['artifacts/' + name].sha256
  };
}

function reviewProject({ flawed = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-review-'));
  const chat = createChatSession({
    cwd: directory,
    title: 'Independent manuscript review',
    agent: 'scientist'
  });
  fs.writeFileSync(path.join(directory, 'paper.txt'), [
    'The controlled treatment increased response to 17 percent.',
    'The study used a prespecified control and reports the bounded result.'
  ].join('\n'));
  const evidence = ingestEvidence({
    cwd: directory,
    source: 'paper.txt',
    title: 'Controlled treatment study',
    doi: '10.1234/review.17',
    authors: ['A. Scientist'],
    year: 2026
  });
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("recorded analysis")\n');
  const evidenceId = evidence.manifest.evidence_id;
  const simulation = runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    runtime: fakeRuntime(),
    gpuProbe: () => ({ available: false, backend: 'nvidia', devices: [], error: 'test' }),
    runner(_command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed', device: { selected: 'cpu' }, seed: 0
      }));
      fs.writeFileSync(path.join(output, 'results.csv'), 'metric,value\nresponse_percent,17 percent\n');
      fs.writeFileSync(path.join(output, 'analysis.py'), 'response_percent = 17\n');
      fs.writeFileSync(path.join(output, 'figure.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      fs.writeFileSync(path.join(output, 'report.md'), flawed
        ? [
            '# Results',
            '',
            'The treatment reduced mortality by 42 percent.',
            '',
            '{{calc: 2 + 2 = 5}}',
            '',
            '![Figure 1](https://example.test/unfrozen.png)'
          ].join('\n')
        : [
            '# Results',
            '',
            'The controlled treatment increased response to 17 percent [data](results.csv) (' +
              evidenceId + ' page 1).',
            '',
            '{{calc: (12 + 8) / 4 = 5}}',
            '',
            '![Figure 1](figure.png)',
            '[analysis code](analysis.py)'
          ].join('\n')
      );
      return { status: 0, stdout: '', stderr: '', signal: null };
    }
  });
  return { directory, chat, evidence, simulation };
}

test('bounded claim, number, and arithmetic primitives are deterministic and fail closed', () => {
  const extracted = extractScientificClaims([
    '# Results',
    'The intervention increased response to 17 percent.',
    '',
    '~~~python',
    'print("This code did not increase a rate by 999 percent.")',
    '~~~',
    '',
    '    The command increased a synthetic response by 777 percent.',
    '',
    '## References',
    'A reference claimed a 42 percent effect.'
  ].join('\n'));
  assert.equal(extracted.claims.length, 1);
  assert.equal(extracted.claims[0].requires_citation, true);
  const legacy = extractScientificClaims([
    'The intervention increased response to 17 percent.',
    '',
    '    The command increased a synthetic response by 777 percent.'
  ].join('\n'), { engineVersion: 1 });
  assert.equal(legacy.claims.length, 2);
  assert.deepEqual(extractNumericLiterals('17 percent equals 0.17').map((item) => item.value), [17, 0.17]);
  assert.equal(evaluateArithmetic('(12 + 8) / 4'), 5);
  assert.equal(evaluateArithmetic('2^3+1'), 9);
  assert.throws(() => evaluateArithmetic('process.exit()'), { code: 'INVALID_CALCULATION' });
  assert.throws(() => evaluateArithmetic('1/0'), { code: 'INVALID_CALCULATION' });
});

test('semantic reviews verify citations, numbers, calculations, data, figures, lineage, and AI handoff', () => {
  const { directory, chat, simulation } = reviewProject();
  const source = artifactSource(simulation, 'report.md');
  const review = createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source
  });

  assert.equal(review.manifest.sciencecode_version, VERSION);
  assert.equal(review.report.status, 'pass');
  assert.equal(review.report.summary.claims, 1);
  assert.equal(review.report.summary.verified_citations, 1);
  assert.equal(review.report.summary.calculations_passed, 1);
  assert.equal(review.report.summary.figures, 1);
  assert.equal(review.report.summary.linked_data, 1);
  assert.equal(review.report.summary.linked_code, 1);
  assert.equal(review.report.artifacts.figures[0].traceability, 'artifact_and_code_linked');
  assert.equal(review.report.artifacts.data[0].literal_number_check, 'match');
  assert.equal(verifySemanticReview(directory, review.review_id).ok, true);
  assert.equal(listSemanticReviews(directory)[0].verified, true);

  const artifact = semanticReviewInteractionArtifact(review);
  const payload = semanticReviewInteractionPayload(review);
  recordInteraction({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    surface: 'review',
    action: 'semantic-review.shared',
    artifact,
    payload
  });
  const prompt = interactionAwarePrompt({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    message: 'Revise the manuscript safely.'
  });
  assert.match(prompt.prompt, /Independent semantic review/);
  assert.match(prompt.prompt, /lexical overlap as triage/i);

  const lineage = buildLineageGraph(directory, { chatId: chat.manifest.chat_id });
  assert.equal(lineage.integrity.ok, true);
  assert.equal(lineage.nodes.filter((node) => node.type === 'review').length, 1);
  assert.ok(lineage.edges.some((edge) => edge.relation === 'reviewed_by'));
  assert.ok(lineage.edges.some((edge) => edge.relation === 'examined_by'));
  assert.ok(lineage.edges.some((edge) => edge.relation === 'requested'));

  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.semantic_reviews, 1);
  assert.equal(gate.counts.semantic_review_findings, 0);
  assert.equal(readAuditRecords(directory).at(-2).type, 'semantic_review.created');
  assert.equal(readAuditRecords(directory).at(-1).type, 'interaction.recorded');
});

test('reviewing an immutable revision exposes high-priority scientific inconsistencies', () => {
  const { directory, chat, simulation } = reviewProject();
  const source = artifactSource(simulation, 'report.md');
  const revision = createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source,
    content: [
      '# Revised result',
      '',
      'The treatment reduced mortality by 42 percent.',
      '',
      '{{calc: 2 + 2 = 5}}',
      '',
      '![Figure 1](https://example.test/unfrozen.png)'
    ].join('\n')
  });
  const review = createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    revisionId: revision.revision_id
  });

  assert.equal(review.manifest.target.kind, 'revision');
  assert.equal(review.report.status, 'fail');
  const codes = new Set(review.report.findings.map((finding) => finding.code));
  assert.equal(codes.has('claim_missing_citation'), true);
  assert.equal(codes.has('calculation_mismatch'), true);
  assert.equal(codes.has('external_artifact_not_frozen'), true);
  assert.equal(verifySemanticReview(directory, review.review_id).ok, true);
  assert.equal(verifyProject(directory).ok, true);

  const reportFile = path.join(
    directory, '.sciencecode', 'reviews', review.review_id, 'report.json'
  );
  fs.appendFileSync(reportFile, ' \n');
  const verification = verifySemanticReview(directory, review.review_id);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) =>
    error.file === 'report.json' && error.issue === 'hash_mismatch'
  ));
  assert.equal(verifyProject(directory).ok, false);
});

test('semantic reviews resolve exact spans and ingested DOI metadata without a network lookup', () => {
  const { directory, chat, evidence, simulation } = reviewProject();
  const source = artifactSource(simulation, 'report.md');
  const span = readEvidenceSpans(directory, evidence.manifest.evidence_id)[0];
  const revision = createArtifactRevision({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source,
    content: [
      '# Exact citation result',
      '',
      'The controlled treatment increased response to 17 percent (' +
        span.span_id + '; 10.1234/review.17).'
    ].join('\n')
  });
  const review = createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    revisionId: revision.revision_id
  });

  assert.equal(review.report.summary.citations, 2);
  assert.equal(review.report.summary.verified_citations, 2);
  assert.ok(review.report.citations.some((citation) =>
    citation.locator_status === 'exact_span' && citation.span_id === span.span_id
  ));
  assert.ok(review.report.citations.some((citation) =>
    citation.locator.kind === 'doi' &&
    citation.locator.doi === '10.1234/review.17' &&
    citation.evidence_id === evidence.manifest.evidence_id
  ));
  assert.equal(verifySemanticReview(directory, review.review_id).ok, true);
});

test('review reruns keep history immutable while only the newest exact-target review is current', () => {
  const { directory, chat, simulation } = reviewProject({ flawed: true });
  const source = artifactSource(simulation, 'report.md');
  const first = createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source
  });
  const second = createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source
  });
  const listed = listSemanticReviews(directory);

  assert.equal(listed.length, 2);
  assert.equal(listed[0].review_id, second.review_id);
  assert.equal(listed[0].current_for_target, true);
  assert.equal(listed[0].superseded_by, null);
  assert.equal(listed[1].review_id, first.review_id);
  assert.equal(listed[1].current_for_target, false);
  assert.equal(listed[1].superseded_by, second.review_id);
  assert.equal(verifySemanticReview(directory, first.review_id).ok, true);
  assert.equal(verifySemanticReview(directory, second.review_id).ok, true);

  const gate = verifyProject(directory);
  assert.equal(gate.ok, true);
  assert.equal(gate.counts.semantic_reviews, 2);
  assert.equal(gate.counts.current_semantic_reviews, 1);
  assert.equal(gate.counts.semantic_reviews_needing_attention, 1);
  assert.equal(gate.counts.current_semantic_review_findings, second.report.summary.findings);
  assert.equal(gate.counts.semantic_review_findings,
    first.report.summary.findings + second.report.summary.findings);

  const lineage = buildLineageGraph(directory, { chatId: chat.manifest.chat_id });
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.edges.some((edge) =>
    edge.relation === 'superseded_by' &&
    edge.source === 'review:' + first.review_id &&
    edge.target === 'review:' + second.review_id
  ));
  assert.ok(lineage.findings.some((finding) =>
    finding.code === 'semantic_review_superseded'
  ));
});

test('semantic review creation rejects forged, unsupported, and untracked sources before writing a review', () => {
  const { directory, chat, simulation } = reviewProject();
  const source = artifactSource(simulation, 'report.md');
  assert.throws(() => createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: { ...source, sha256: '0'.repeat(64) }
  }), { code: 'REVISION_SOURCE_MISMATCH' });
  assert.throws(() => createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: { url: source.url.replace('/report.md', '/../manifest.json') }
  }), { code: 'INVALID_REVISION_SOURCE' });
  assert.throws(() => createSemanticReview({
    cwd: directory,
    chatId: chat.manifest.chat_id,
    source: artifactSource(simulation, 'results.csv')
  }), { code: 'UNSUPPORTED_REVIEW_FORMAT' });
  assert.equal(listSemanticReviews(directory).length, 0);
});

test('review CLI runs, lists, shows, verifies, and records the result for the next AI turn', () => {
  const { directory, chat, simulation } = reviewProject();
  const source = artifactSource(simulation, 'report.md');
  const created = invoke([
    'review', 'run', source.url, '--chat', chat.manifest.chat_id
  ], directory);
  assert.equal(created.code, 0, created.stderr);
  const result = JSON.parse(created.stdout);
  assert.equal(result.review.report.status, 'pass');
  assert.equal(result.interaction.surface, 'review');
  assert.equal(result.interaction.action, 'semantic-review.created');
  assert.equal(result.interaction_error, null);

  const reviewId = result.review.review_id;
  const listed = invoke([
    'review', 'list', '--chat', chat.manifest.chat_id, '--json'
  ], directory);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].review_id, reviewId);
  assert.equal(JSON.parse(listed.stdout)[0].current_for_target, true);

  const shown = invoke(['review', 'show', reviewId], directory);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).review_id, reviewId);

  const verified = invoke(['review', 'verify', reviewId], directory);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
});

test('Lab exposes reviewer creation, state, detail, lineage, harness, and interactive UI contracts', async (context) => {
  const { directory, chat, simulation } = reviewProject();
  const source = artifactSource(simulation, 'report.md');
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({
      ok: true,
      gpu: { available: false, backend: 'nvidia', devices: [], error: 'test' },
      runtime: fakeRuntime()
    })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const response = await fetch(details.url + '/api/reviews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: details.url
    },
    body: JSON.stringify({ chat_id: chat.manifest.chat_id, source })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.review.report.status, 'pass');
  assert.equal(created.interaction.surface, 'review');
  assert.equal(created.interaction.action, 'semantic-review.created');
  assert.equal(created.interaction_error, null);
  const reviewId = created.review.review_id;

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.semantic_reviews, 1);
  assert.equal(state.counts.current_semantic_reviews, 1);
  assert.equal(state.counts.verified_semantic_reviews, 1);
  assert.equal(state.reviews[0].review_id, reviewId);

  const listed = await (await fetch(
    details.url + '/api/reviews?chat=' + encodeURIComponent(chat.manifest.chat_id)
  )).json();
  assert.equal(listed.summary.count, 1);
  assert.equal(listed.summary.current, 1);
  assert.equal(listed.summary.superseded, 0);
  assert.equal(listed.summary.verified, 1);
  assert.equal(listed.reviews[0].review_id, reviewId);

  const detail = await (await fetch(
    details.url + '/api/reviews/' + encodeURIComponent(reviewId)
  )).json();
  assert.equal(detail.verification.ok, true);
  assert.equal(detail.report.summary.verified_citations, 1);

  const lineage = await (await fetch(
    details.url + '/api/lineage?chat=' + encodeURIComponent(chat.manifest.chat_id)
  )).json();
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'review' && node.record_id === reviewId
  ));

  const harness = await (await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chat.manifest.chat_id) + '/harness'
  )).json();
  assert.equal(harness.board.reviews[0].review_id, reviewId);
  assert.equal(harness.board.validation.review_observed, true);
  assert.equal(harness.board.validation.semantic_reviews, 1);
  assert.equal(harness.board.validation.semantic_reviews_current, 1);
  assert.equal(harness.board.validation.semantic_reviews_verified, 1);

  const [indexSource, appSource, styleSource] = await Promise.all([
    fetch(details.url + '/').then((item) => item.text()),
    fetch(details.url + '/app.js').then((item) => item.text()),
    fetch(details.url + '/styles.css').then((item) => item.text())
  ]);
  assert.match(indexSource, /data-view="reviews"/);
  assert.match(appSource, /runSemanticReview/);
  assert.match(appSource, /showSemanticReviewDetail/);
  assert.match(appSource, /Save \+ review draft/);
  assert.match(appSource, /\/api\/reviews/);
  assert.match(appSource, /HISTORICAL SEMANTIC REVIEW/);
  assert.match(styleSource, /\.semantic-review-actions/);
  assert.match(styleSource, /\.manuscript-review-result/);
});
