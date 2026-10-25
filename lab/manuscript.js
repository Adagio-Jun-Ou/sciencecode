export const MAX_MANUSCRIPT_LINES = 20_000;
export const MAX_DIFF_CELLS = 1_500_000;

function utf8Edge(value, maximumBytes, fromEnd = false) {
  const text = String(value ?? '');
  const encoder = new TextEncoder();
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = fromEnd ? text.slice(text.length - middle) : text.slice(0, middle);
    if (encoder.encode(candidate).length <= maximumBytes) low = middle;
    else high = middle - 1;
  }
  let edge = fromEnd ? text.slice(text.length - low) : text.slice(0, low);
  if (fromEnd && edge && /[\uDC00-\uDFFF]/.test(edge[0])) edge = edge.slice(1);
  if (!fromEnd && edge && /[\uD800-\uDBFF]/.test(edge.at(-1))) edge = edge.slice(0, -1);
  return edge;
}

export function boundedUtf8Excerpt(value, maximumBytes = 24_000) {
  const text = String(value ?? '');
  const limit = Math.max(128, Math.min(40_000, Number(maximumBytes) || 24_000));
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= limit) return { text, truncated: false };
  const marker = '\n[...middle omitted from interaction...]\n';
  const budget = Math.max(0, Math.floor((limit - encoder.encode(marker).length) / 2));
  return {
    text: utf8Edge(text, budget) + marker + utf8Edge(text, budget, true),
    truncated: true
  };
}

function linesOf(value) {
  const text = String(value ?? '');
  const lines = text.split(/\r\n|\n|\r/);
  return lines.length > MAX_MANUSCRIPT_LINES ? lines.slice(0, MAX_MANUSCRIPT_LINES) : lines;
}

function pushUnit(units, type, text, oldLine, newLine) {
  units.push({ type, text, old_line: oldLine, new_line: newLine });
}

function coarseMiddle(left, right, prefixLength, suffixLength) {
  const units = [];
  for (let index = 0; index < prefixLength; index += 1) {
    pushUnit(units, 'equal', left[index], index + 1, index + 1);
  }
  const leftEnd = left.length - suffixLength;
  const rightEnd = right.length - suffixLength;
  for (let index = prefixLength; index < leftEnd; index += 1) {
    pushUnit(units, 'delete', left[index], index + 1, null);
  }
  for (let index = prefixLength; index < rightEnd; index += 1) {
    pushUnit(units, 'insert', right[index], null, index + 1);
  }
  for (let offset = 0; offset < suffixLength; offset += 1) {
    const leftIndex = leftEnd + offset;
    const rightIndex = rightEnd + offset;
    pushUnit(units, 'equal', left[leftIndex], leftIndex + 1, rightIndex + 1);
  }
  return units;
}

function exactMiddle(left, right, prefixLength, suffixLength) {
  const leftMiddle = left.slice(prefixLength, left.length - suffixLength);
  const rightMiddle = right.slice(prefixLength, right.length - suffixLength);
  const rows = leftMiddle.length + 1;
  const columns = rightMiddle.length + 1;
  const table = new Uint32Array(rows * columns);
  for (let leftIndex = leftMiddle.length - 1; leftIndex >= 0; leftIndex -= 1) {
    const row = leftIndex * columns;
    const nextRow = (leftIndex + 1) * columns;
    for (let rightIndex = rightMiddle.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[row + rightIndex] = leftMiddle[leftIndex] === rightMiddle[rightIndex]
        ? table[nextRow + rightIndex + 1] + 1
        : Math.max(table[nextRow + rightIndex], table[row + rightIndex + 1]);
    }
  }
  const units = [];
  for (let index = 0; index < prefixLength; index += 1) {
    pushUnit(units, 'equal', left[index], index + 1, index + 1);
  }
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftMiddle.length || rightIndex < rightMiddle.length) {
    if (leftIndex < leftMiddle.length && rightIndex < rightMiddle.length &&
        leftMiddle[leftIndex] === rightMiddle[rightIndex]) {
      pushUnit(units, 'equal', leftMiddle[leftIndex], prefixLength + leftIndex + 1,
        prefixLength + rightIndex + 1);
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex < rightMiddle.length &&
        (leftIndex >= leftMiddle.length ||
          table[leftIndex * columns + rightIndex + 1] >=
            table[(leftIndex + 1) * columns + rightIndex])) {
      pushUnit(units, 'insert', rightMiddle[rightIndex], null, prefixLength + rightIndex + 1);
      rightIndex += 1;
    } else {
      pushUnit(units, 'delete', leftMiddle[leftIndex], prefixLength + leftIndex + 1, null);
      leftIndex += 1;
    }
  }
  const leftEnd = left.length - suffixLength;
  const rightEnd = right.length - suffixLength;
  for (let offset = 0; offset < suffixLength; offset += 1) {
    pushUnit(units, 'equal', left[leftEnd + offset], leftEnd + offset + 1, rightEnd + offset + 1);
  }
  return units;
}

function coalesce(units) {
  const operations = [];
  for (const unit of units) {
    const current = operations.at(-1);
    if (!current || current.type !== unit.type) {
      operations.push({
        type: unit.type,
        old_start: unit.old_line,
        new_start: unit.new_line,
        lines: [unit.text]
      });
    } else {
      current.lines.push(unit.text);
      if (current.old_start === null && unit.old_line !== null) current.old_start = unit.old_line;
      if (current.new_start === null && unit.new_line !== null) current.new_start = unit.new_line;
    }
  }
  return operations;
}

function statsFor(units) {
  let added = 0;
  let deleted = 0;
  let unchanged = 0;
  let hunks = 0;
  let insideChange = false;
  for (const unit of units) {
    if (unit.type === 'insert') added += 1;
    else if (unit.type === 'delete') deleted += 1;
    else unchanged += 1;
    if (unit.type === 'equal') insideChange = false;
    else if (!insideChange) {
      hunks += 1;
      insideChange = true;
    }
  }
  return { added, deleted, unchanged, changed_hunks: hunks };
}

export function diffManuscript(original, modified, options = {}) {
  const leftAll = linesOf(original);
  const rightAll = linesOf(modified);
  const originalTruncated = String(original ?? '').split(/\r\n|\n|\r/).length > leftAll.length;
  const modifiedTruncated = String(modified ?? '').split(/\r\n|\n|\r/).length > rightAll.length;
  let prefixLength = 0;
  while (prefixLength < leftAll.length && prefixLength < rightAll.length &&
      leftAll[prefixLength] === rightAll[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (suffixLength < leftAll.length - prefixLength &&
      suffixLength < rightAll.length - prefixLength &&
      leftAll[leftAll.length - suffixLength - 1] === rightAll[rightAll.length - suffixLength - 1]) {
    suffixLength += 1;
  }
  const leftMiddleLength = leftAll.length - prefixLength - suffixLength;
  const rightMiddleLength = rightAll.length - prefixLength - suffixLength;
  const requestedCells = (leftMiddleLength + 1) * (rightMiddleLength + 1);
  const maximumCells = Number.isInteger(options.maxCells) && options.maxCells > 0
    ? Math.min(options.maxCells, MAX_DIFF_CELLS)
    : MAX_DIFF_CELLS;
  const coarse = requestedCells > maximumCells;
  const units = coarse
    ? coarseMiddle(leftAll, rightAll, prefixLength, suffixLength)
    : exactMiddle(leftAll, rightAll, prefixLength, suffixLength);
  return {
    original_line_count: leftAll.length,
    modified_line_count: rightAll.length,
    operations: coalesce(units),
    lines: units,
    stats: statsFor(units),
    exact: !coarse && !originalTruncated && !modifiedTruncated,
    truncated: originalTruncated || modifiedTruncated,
    algorithm: coarse ? 'bounded-middle-replacement' : 'lcs'
  };
}

export function manuscriptHunks(diff, options = {}) {
  const context = Math.max(0, Math.min(20, Number(options.context) || 3));
  const maxHunks = Math.max(1, Math.min(500, Number(options.maxHunks) || 100));
  const maxLines = Math.max(1, Math.min(10_000, Number(options.maxLines) || 2_000));
  const lines = diff?.lines ?? [];
  const changed = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].type !== 'equal') changed.push(index);
  }
  const ranges = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const current = ranges.at(-1);
    if (current && start <= current.end) current.end = Math.max(current.end, end);
    else ranges.push({ start, end });
  }
  const hunks = [];
  let lineCount = 0;
  let truncated = false;
  for (const range of ranges) {
    if (hunks.length >= maxHunks || lineCount >= maxLines) {
      truncated = true;
      break;
    }
    const selected = lines.slice(range.start, Math.min(range.end, range.start + maxLines - lineCount));
    lineCount += selected.length;
    hunks.push({
      old_start: selected.find((line) => line.old_line !== null)?.old_line ?? null,
      new_start: selected.find((line) => line.new_line !== null)?.new_line ?? null,
      lines: selected
    });
    if (range.end - range.start > selected.length) truncated = true;
  }
  return { hunks, truncated, line_count: lineCount };
}

export function boundedManuscriptChanges(diff, options = {}) {
  const maxChanges = Math.max(1, Math.min(200, Number(options.maxChanges) || 80));
  const maxBytes = Math.max(256, Math.min(40_000,
    Number(options.maxBytes ?? options.maxCharacters) || 24_000));
  const changes = [];
  let bytes = 2;
  const encoder = new TextEncoder();
  for (const line of diff?.lines ?? []) {
    if (line.type === 'equal') continue;
    const normalized = {
      type: line.type,
      old_line: line.old_line,
      new_line: line.new_line,
      text: String(line.text ?? '').slice(0, 2_000)
    };
    const size = encoder.encode(JSON.stringify(normalized)).length + 1;
    if (changes.length >= maxChanges || bytes + size > maxBytes) break;
    changes.push(normalized);
    bytes += size;
  }
  return {
    changes,
    truncated: changes.length < (diff?.stats?.added ?? 0) + (diff?.stats?.deleted ?? 0)
  };
}
