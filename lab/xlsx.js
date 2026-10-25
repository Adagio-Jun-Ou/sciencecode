const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_INFLATED_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 96 * 1024 * 1024;
const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

function workbookError(message, code = 'INVALID_XLSX') {
  return Object.assign(new Error(message), { code });
}

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function findEndOfCentralDirectory(bytes, view) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) return offset;
  }
  throw workbookError('This file is not a supported ZIP-based .xlsx workbook.');
}

function parseZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw workbookError('The workbook file is truncated.');
  const end = findEndOfCentralDirectory(bytes, view);
  const disk = readU16(view, end + 4);
  const centralDisk = readU16(view, end + 6);
  const entryCount = readU16(view, end + 10);
  const centralSize = readU32(view, end + 12);
  const centralOffset = readU32(view, end + 16);
  if (disk !== 0 || centralDisk !== 0 || entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw workbookError('Multi-disk and ZIP64 workbooks are not supported in the browser editor.');
  }
  if (centralOffset + centralSize > bytes.length) {
    throw workbookError('The workbook central directory is invalid.');
  }
  const entries = [];
  const byName = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readU32(view, offset) !== 0x02014b50) {
      throw workbookError('The workbook central directory is malformed.');
    }
    const flags = readU16(view, offset + 8);
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      throw workbookError('ZIP64 workbook entries are not supported in the browser editor.');
    }
    if (flags & 0x0001) throw workbookError('Encrypted workbooks cannot be opened.');
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) throw workbookError('A workbook entry name is truncated.');
    const nameBytes = bytes.slice(nameStart, nameEnd);
    const name = textDecoder.decode(nameBytes).replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw workbookError('The workbook contains an unsafe internal path.');
    }
    if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== 0x04034b50) {
      throw workbookError('A workbook local entry is malformed.');
    }
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) {
      throw workbookError('A workbook entry is truncated.');
    }
    const entry = {
      name,
      nameBytes,
      flags,
      method,
      modifiedTime: readU16(view, offset + 12),
      modifiedDate: readU16(view, offset + 14),
      crc: readU32(view, offset + 16),
      compressedSize,
      uncompressedSize,
      versionMadeBy: readU16(view, offset + 4),
      versionNeeded: readU16(view, offset + 6),
      internalAttributes: readU16(view, offset + 36),
      externalAttributes: readU32(view, offset + 38),
      compressed: bytes.slice(dataOffset, dataOffset + compressedSize)
    };
    entries.push(entry);
    byName.set(name, entry);
    offset = nameEnd + extraLength + commentLength;
  }
  return { entries, byName };
}

async function inflateEntry(entry) {
  if (!entry) throw workbookError('A required workbook entry is missing.');
  if (entry.uncompressedSize > MAX_INFLATED_ENTRY_BYTES) {
    throw workbookError('A workbook XML entry is too large for the interactive editor.', 'XLSX_TOO_LARGE');
  }
  if (entry.method === 0) return entry.compressed.slice();
  if (entry.method !== 8) {
    throw workbookError('Unsupported workbook compression method: ' + entry.method + '.');
  }
  if (typeof DecompressionStream !== 'function') {
    throw workbookError('This browser does not support local .xlsx decompression.');
  }
  const stream = new Blob([entry.compressed]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_INFLATED_ENTRY_BYTES) {
      await reader.cancel();
      throw workbookError('A workbook XML entry expanded beyond the editor limit.', 'XLSX_TOO_LARGE');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return output;
}

function parseXml(value, label) {
  const document = new DOMParser().parseFromString(value, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw workbookError('Invalid XML in workbook entry: ' + label + '.');
  }
  return document;
}

function elements(parent, localName) {
  return [...parent.getElementsByTagNameNS('*', localName)];
}

function firstElement(parent, localName) {
  return parent.getElementsByTagNameNS('*', localName)[0] ?? null;
}

function resolveZipTarget(base, target) {
  const parts = String(target ?? '').startsWith('/')
    ? []
    : base.split('/').slice(0, -1);
  for (const part of String(target ?? '').replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw workbookError('A workbook relationship escapes the archive root.');
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function columnIndex(label) {
  let result = 0;
  for (const character of String(label).toUpperCase()) {
    const value = character.charCodeAt(0) - 64;
    if (value < 1 || value > 26) return 0;
    result = result * 26 + value;
  }
  return result;
}

function columnName(index) {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellCoordinates(reference) {
  const match = String(reference ?? '').replaceAll('$', '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const column = columnIndex(match[1]);
  const row = Number(match[2]);
  return column > 0 && Number.isInteger(row) && row > 0 ? { row, column } : null;
}

function cellReference(row, column) {
  return columnName(column) + row;
}

function relationshipPath(source) {
  const parts = source.split('/');
  const name = parts.pop();
  return [...parts, '_rels', name + '.rels'].join('/');
}

function relationshipMap(document, source) {
  const map = new Map();
  for (const relationship of elements(document, 'Relationship')) {
    if (relationship.getAttribute('TargetMode') === 'External') continue;
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) map.set(id, resolveZipTarget(source, target));
  }
  return map;
}

function sharedStringValues(document) {
  return elements(document, 'si').map((item) =>
    elements(item, 't').map((value) => value.textContent ?? '').join('')
  );
}

function readCellValue(cell, sharedStrings) {
  const formula = firstElement(cell, 'f');
  if (formula) return '=' + (formula.textContent ?? '');
  const type = cell.getAttribute('t') ?? '';
  if (type === 'inlineStr') {
    return elements(firstElement(cell, 'is') ?? cell, 't')
      .map((value) => value.textContent ?? '').join('');
  }
  const raw = firstElement(cell, 'v')?.textContent ?? '';
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e') return raw ? '#' + raw : '#ERROR';
  return raw;
}

function dimensionExtent(document) {
  const reference = firstElement(document, 'dimension')?.getAttribute('ref') ?? '';
  const end = reference.split(':').at(-1);
  return cellCoordinates(end) ?? { row: 0, column: 0 };
}

function directChildren(parent, localName) {
  return [...(parent?.childNodes ?? [])].filter(
    (node) => node.nodeType === 1 && node.localName === localName
  );
}

function ensureSheetData(sheet) {
  let sheetData = firstElement(sheet.document, 'sheetData');
  if (sheetData) return sheetData;
  const namespace = sheet.document.documentElement.namespaceURI;
  sheetData = sheet.document.createElementNS(namespace, 'sheetData');
  sheet.document.documentElement.appendChild(sheetData);
  return sheetData;
}

function ensureRow(sheet, rowNumber) {
  const existing = sheet.rows.get(rowNumber);
  if (existing) return existing;
  const sheetData = ensureSheetData(sheet);
  const namespace = sheet.document.documentElement.namespaceURI;
  const row = sheet.document.createElementNS(namespace, 'row');
  row.setAttribute('r', String(rowNumber));
  const next = directChildren(sheetData, 'row').find(
    (candidate) => Number(candidate.getAttribute('r')) > rowNumber
  );
  sheetData.insertBefore(row, next ?? null);
  sheet.rows.set(rowNumber, row);
  return row;
}

function ensureCell(sheet, rowNumber, columnNumber) {
  const reference = cellReference(rowNumber, columnNumber);
  const existing = sheet.cells.get(reference);
  if (existing) return existing;
  const row = ensureRow(sheet, rowNumber);
  const namespace = sheet.document.documentElement.namespaceURI;
  const cell = sheet.document.createElementNS(namespace, 'c');
  cell.setAttribute('r', reference);
  const next = directChildren(row, 'c').find((candidate) => {
    const coordinates = cellCoordinates(candidate.getAttribute('r'));
    return coordinates && coordinates.column > columnNumber;
  });
  row.insertBefore(cell, next ?? null);
  sheet.cells.set(reference, cell);
  return cell;
}

function replaceCellValue(sheet, row, column, input) {
  const text = String(input ?? '').slice(0, 32_768);
  const cell = ensureCell(sheet, row, column);
  const namespace = sheet.document.documentElement.namespaceURI;
  for (const child of [...cell.childNodes]) {
    if (child.nodeType === 1 && ['f', 'v', 'is'].includes(child.localName)) {
      cell.removeChild(child);
    }
  }
  cell.removeAttribute('t');
  if (text.startsWith('=') && text.length > 1) {
    const formula = sheet.document.createElementNS(namespace, 'f');
    formula.textContent = text.slice(1);
    cell.appendChild(formula);
  } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    const value = sheet.document.createElementNS(namespace, 'v');
    value.textContent = text;
    cell.appendChild(value);
  } else if (/^(?:TRUE|FALSE)$/i.test(text)) {
    cell.setAttribute('t', 'b');
    const value = sheet.document.createElementNS(namespace, 'v');
    value.textContent = text.toUpperCase() === 'TRUE' ? '1' : '0';
    cell.appendChild(value);
  } else {
    cell.setAttribute('t', 'inlineStr');
    const inline = sheet.document.createElementNS(namespace, 'is');
    const value = sheet.document.createElementNS(namespace, 't');
    value.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    value.textContent = text;
    inline.appendChild(value);
    cell.appendChild(inline);
  }
  const reference = cellReference(row, column);
  sheet.values.set(reference, text);
  sheet.maxRow = Math.max(sheet.maxRow, row);
  sheet.maxColumn = Math.max(sheet.maxColumn, column);
  sheet.modified = true;
  const dimension = firstElement(sheet.document, 'dimension');
  if (dimension) {
    dimension.setAttribute('ref', sheet.maxRow === 1 && sheet.maxColumn === 1
      ? 'A1'
      : 'A1:' + cellReference(sheet.maxRow, sheet.maxColumn));
  }
}

function worksheetModel({ name, path, document, sharedStrings }) {
  const values = new Map();
  const cells = new Map();
  const rows = new Map();
  const extent = dimensionExtent(document);
  let maxRow = extent.row;
  let maxColumn = extent.column;
  const rowElements = elements(document, 'row');
  if (rowElements.length > 250_000) {
    throw workbookError('This worksheet has too many rows for the interactive editor.', 'XLSX_TOO_LARGE');
  }
  for (const rowElement of rowElements) {
    const rowNumber = Number(rowElement.getAttribute('r'));
    if (Number.isInteger(rowNumber) && rowNumber > 0 && rowNumber <= 200) {
      rows.set(rowNumber, rowElement);
    }
  }
  const cellElements = elements(document, 'c');
  if (cellElements.length > 1_000_000) {
    throw workbookError('This worksheet has too many cells for the interactive editor.', 'XLSX_TOO_LARGE');
  }
  for (const cell of cellElements) {
    const reference = cell.getAttribute('r');
    const coordinates = cellCoordinates(reference);
    if (!coordinates) continue;
    maxRow = Math.max(maxRow, coordinates.row);
    maxColumn = Math.max(maxColumn, coordinates.column);
    if (coordinates.row <= 200 && coordinates.column <= 40) {
      cells.set(reference, cell);
      values.set(reference, readCellValue(cell, sharedStrings));
    }
  }
  const sheet = {
    name,
    path,
    document,
    rows,
    cells,
    values,
    maxRow: Math.max(maxRow, 1),
    maxColumn: Math.max(maxColumn, 1),
    modified: false,
    getValue(row, column) {
      return values.get(cellReference(row, column)) ?? '';
    },
    setValue(row, column, value) {
      replaceCellValue(sheet, row, column, value);
    }
  };
  return sheet;
}

export async function loadXlsxWorkbook(buffer) {
  const archive = parseZip(buffer);
  const workbookPath = 'xl/workbook.xml';
  const workbookEntry = archive.byName.get(workbookPath);
  if (!workbookEntry) throw workbookError('The .xlsx workbook definition is missing.');
  const workbookXml = textDecoder.decode(await inflateEntry(workbookEntry));
  const workbookDocument = parseXml(workbookXml, workbookPath);
  const relsPath = relationshipPath(workbookPath);
  const relsDocument = parseXml(
    textDecoder.decode(await inflateEntry(archive.byName.get(relsPath))),
    relsPath
  );
  const relationships = relationshipMap(relsDocument, workbookPath);
  const sharedPath = [...relationships.entries()].find(([id]) => {
    const relationship = elements(relsDocument, 'Relationship')
      .find((candidate) => candidate.getAttribute('Id') === id);
    return relationship?.getAttribute('Type')?.endsWith('/sharedStrings');
  })?.[1] ?? 'xl/sharedStrings.xml';
  const sharedEntry = archive.byName.get(sharedPath);
  const sharedStrings = sharedEntry
    ? sharedStringValues(parseXml(textDecoder.decode(await inflateEntry(sharedEntry)), sharedPath))
    : [];
  const worksheets = [];
  for (const sheetElement of elements(workbookDocument, 'sheet')) {
    const relationshipId = sheetElement.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'id'
    ) ?? sheetElement.getAttribute('r:id');
    const sheetPath = relationships.get(relationshipId);
    if (!sheetPath || !archive.byName.has(sheetPath)) continue;
    const sheetDocument = parseXml(
      textDecoder.decode(await inflateEntry(archive.byName.get(sheetPath))),
      sheetPath
    );
    worksheets.push(worksheetModel({
      name: sheetElement.getAttribute('name') ?? 'Sheet ' + (worksheets.length + 1),
      path: sheetPath,
      document: sheetDocument,
      sharedStrings
    }));
  }
  if (!worksheets.length) throw workbookError('The workbook contains no readable worksheets.');
  return {
    mimeType: XLSX_MIME,
    worksheets,
    async writeBuffer() {
      const updates = new Map();
      for (const sheet of worksheets) {
        if (!sheet.modified) continue;
        const serialized = new XMLSerializer().serializeToString(sheet.document);
        updates.set(sheet.path, textEncoder.encode(
          serialized.startsWith('<?xml') ? serialized : '<?xml version="1.0" encoding="UTF-8"?>' + serialized
        ));
      }
      return writeZip(archive.entries, updates);
    }
  };
}

let crcTable;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(entry, offset) {
  const bytes = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(bytes.buffer);
  writeU32(view, 0, 0x04034b50);
  writeU16(view, 4, entry.versionNeeded || 20);
  writeU16(view, 6, entry.flags);
  writeU16(view, 8, entry.method);
  writeU16(view, 10, entry.modifiedTime);
  writeU16(view, 12, entry.modifiedDate);
  writeU32(view, 14, entry.crc);
  writeU32(view, 18, entry.compressedSize);
  writeU32(view, 22, entry.uncompressedSize);
  writeU16(view, 26, entry.nameBytes.length);
  writeU16(view, 28, 0);
  bytes.set(entry.nameBytes, 30);
  entry.outputOffset = offset;
  return bytes;
}

function centralHeader(entry) {
  const bytes = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(bytes.buffer);
  writeU32(view, 0, 0x02014b50);
  writeU16(view, 4, entry.versionMadeBy || 20);
  writeU16(view, 6, entry.versionNeeded || 20);
  writeU16(view, 8, entry.flags);
  writeU16(view, 10, entry.method);
  writeU16(view, 12, entry.modifiedTime);
  writeU16(view, 14, entry.modifiedDate);
  writeU32(view, 16, entry.crc);
  writeU32(view, 20, entry.compressedSize);
  writeU32(view, 24, entry.uncompressedSize);
  writeU16(view, 28, entry.nameBytes.length);
  writeU16(view, 30, 0);
  writeU16(view, 32, 0);
  writeU16(view, 34, 0);
  writeU16(view, 36, entry.internalAttributes);
  writeU32(view, 38, entry.externalAttributes);
  writeU32(view, 42, entry.outputOffset);
  bytes.set(entry.nameBytes, 46);
  return bytes;
}

function joinByteArrays(arrays, total) {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const bytes of arrays) {
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}

function writeZip(entries, updates) {
  if (entries.length > 0xffff) {
    throw workbookError('The workbook has too many ZIP entries to rewrite.');
  }
  const prepared = entries.map((source) => {
    const update = updates.get(source.name);
    const data = update ?? source.compressed;
    return {
      ...source,
      // Updated worksheet XML is stored without compression. Other entries
      // keep their original compressed bytes exactly.
      flags: source.flags & 0x0800,
      method: update ? 0 : source.method,
      crc: update ? crc32(update) : source.crc,
      compressedSize: data.length,
      uncompressedSize: update ? update.length : source.uncompressedSize,
      data
    };
  });
  const localParts = [];
  let localSize = 0;
  for (const entry of prepared) {
    const header = localHeader(entry, localSize);
    localParts.push(header, entry.data);
    localSize += header.length + entry.data.length;
    if (localSize > MAX_OUTPUT_BYTES) {
      throw workbookError('The edited workbook exceeds the download limit.', 'XLSX_TOO_LARGE');
    }
  }
  const centralParts = prepared.map(centralHeader);
  const centralSize = centralParts.reduce((total, bytes) => total + bytes.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, prepared.length);
  writeU16(endView, 10, prepared.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, localSize);
  writeU16(endView, 20, 0);
  const total = localSize + centralSize + end.length;
  if (total > MAX_OUTPUT_BYTES) {
    throw workbookError('The edited workbook exceeds the download limit.', 'XLSX_TOO_LARGE');
  }
  return joinByteArrays([...localParts, ...centralParts, end], total);
}
