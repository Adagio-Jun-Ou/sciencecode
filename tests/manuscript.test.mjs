import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundedUtf8Excerpt,
  boundedManuscriptChanges,
  diffManuscript,
  manuscriptHunks
} from '../lab/manuscript.js';

test('manuscript diff preserves exact line numbers and insertion/deletion statistics', () => {
  const original = ['# Result', '', 'The response was 12%.', 'No adverse events.', '', 'Limitations remain.'].join('\n');
  const modified = ['# Result', '', 'The response was 18%.', 'No serious adverse events.', '', 'Limitations remain.', 'Replication is required.'].join('\n');
  const diff = diffManuscript(original, modified);
  assert.equal(diff.exact, true);
  assert.equal(diff.algorithm, 'lcs');
  assert.deepEqual(diff.stats, { added: 3, deleted: 2, unchanged: 4, changed_hunks: 2 });
  assert.deepEqual(diff.lines.filter((line) => line.type === 'delete').map((line) => ({
    line: line.old_line, text: line.text
  })), [
    { line: 3, text: 'The response was 12%.' },
    { line: 4, text: 'No adverse events.' }
  ]);
  assert.deepEqual(diff.lines.filter((line) => line.type === 'insert').map((line) => ({
    line: line.new_line, text: line.text
  })), [
    { line: 3, text: 'The response was 18%.' },
    { line: 4, text: 'No serious adverse events.' },
    { line: 7, text: 'Replication is required.' }
  ]);
});

test('manuscript hunks provide bounded context without merging distant edits', () => {
  const original = Array.from({ length: 30 }, (_, index) => 'line ' + (index + 1)).join('\n');
  const changed = original.split('\n');
  changed[2] = 'line three revised';
  changed[25] = 'line twenty-six revised';
  const diff = diffManuscript(original, changed.join('\n'));
  const result = manuscriptHunks(diff, { context: 1 });
  assert.equal(result.hunks.length, 2);
  assert.equal(result.truncated, false);
  assert.ok(result.hunks.every((hunk) => hunk.lines.some((line) => line.type !== 'equal')));
});

test('large divergent manuscripts use an explicit bounded fallback', () => {
  const original = Array.from({ length: 100 }, (_, index) => 'old ' + index).join('\n');
  const modified = Array.from({ length: 100 }, (_, index) => 'new ' + index).join('\n');
  const diff = diffManuscript(original, modified, { maxCells: 100 });
  assert.equal(diff.exact, false);
  assert.equal(diff.algorithm, 'bounded-middle-replacement');
  assert.equal(diff.stats.added, 100);
  assert.equal(diff.stats.deleted, 100);
  const bounded = boundedManuscriptChanges(diff, { maxChanges: 8, maxCharacters: 2_000 });
  assert.equal(bounded.changes.length, 8);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.changes.every((change) => ['insert', 'delete'].includes(change.type)));
});

test('unchanged manuscripts produce no change hunks or AI change payload', () => {
  const diff = diffManuscript('same\ntext', 'same\ntext');
  assert.deepEqual(diff.stats, { added: 0, deleted: 0, unchanged: 2, changed_hunks: 0 });
  assert.deepEqual(manuscriptHunks(diff).hunks, []);
  assert.deepEqual(boundedManuscriptChanges(diff), { changes: [], truncated: false });
});

test('AI manuscript change extraction enforces UTF-8 bytes rather than code units', () => {
  const diff = diffManuscript('', Array.from({ length: 20 }, () => '\u{1F9EC}'.repeat(100)).join('\n'));
  const bounded = boundedManuscriptChanges(diff, { maxBytes: 1_200, maxChanges: 100 });
  assert.equal(bounded.truncated, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(bounded.changes)).length <= 1_200);
  const excerpt = boundedUtf8Excerpt('\u{1F9EC}'.repeat(2_000), 1_000);
  assert.equal(excerpt.truncated, true);
  assert.ok(new TextEncoder().encode(excerpt.text).length <= 1_000);
  assert.equal(excerpt.text.includes('\uFFFD'), false);
});
