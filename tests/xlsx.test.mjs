import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { loadXlsxWorkbook } from '../lab/xlsx.js';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const encoder = new TextEncoder();

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

function u16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function u32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function join(parts) {
  const result = new Uint8Array(parts.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function storedZip(files) {
  const entries = [];
  const local = [];
  let localOffset = 0;
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    const checksum = crc32(data);
    u32(view, 0, 0x04034b50);
    u16(view, 4, 20);
    u16(view, 6, 0x0800);
    u16(view, 8, 0);
    u32(view, 14, checksum);
    u32(view, 18, data.length);
    u32(view, 22, data.length);
    u16(view, 26, nameBytes.length);
    header.set(nameBytes, 30);
    local.push(header, data);
    entries.push({ nameBytes, data, checksum, offset: localOffset });
    localOffset += header.length + data.length;
  }
  const central = [];
  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x02014b50);
    u16(view, 4, 20);
    u16(view, 6, 20);
    u16(view, 8, 0x0800);
    u16(view, 10, 0);
    u32(view, 16, entry.checksum);
    u32(view, 20, entry.data.length);
    u32(view, 24, entry.data.length);
    u16(view, 28, entry.nameBytes.length);
    u32(view, 42, entry.offset);
    header.set(entry.nameBytes, 46);
    central.push(header);
  }
  const centralBytes = join(central);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  u32(view, 0, 0x06054b50);
  u16(view, 8, entries.length);
  u16(view, 10, entries.length);
  u32(view, 12, centralBytes.length);
  u32(view, 16, localOffset);
  return join([...local, centralBytes, end]);
}

function fixtureWorkbook() {
  const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return storedZip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
      </Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="${relationships}">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="${spreadsheet}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Screen" sheetId="1" r:id="rId1"/>
          <sheet name="Notes" sheetId="2" r:id="rId2"/>
        </sheets>
      </workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="${relationships}">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
      </Relationships>`],
    ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="${spreadsheet}" count="2" uniqueCount="2">
        <si><t>Candidate</t></si><si><t>Alpha</t></si>
      </sst>`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="${spreadsheet}">
        <dimension ref="A1:C3"/>
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Score</t></is></c><c r="C1" t="inlineStr"><is><t>Percent</t></is></c></row>
          <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>0.82</v></c><c r="C2"><f>B2*100</f><v>82</v></c></row>
          <row r="3"><c r="A3" t="inlineStr"><is><t>Beta</t></is></c><c r="B3"><v>0.61</v></c></row>
        </sheetData>
      </worksheet>`],
    ['xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="${spreadsheet}"><dimension ref="A1:A2"/><sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Notes</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>Review required</t></is></c></row>
      </sheetData></worksheet>`]
  ]);
}

function exactBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('local xlsx engine loads multiple sheets and round-trips cell and formula edits', async () => {
  const workbook = await loadXlsxWorkbook(exactBuffer(fixtureWorkbook()));
  assert.equal(workbook.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Screen', 'Notes']);
  const screen = workbook.worksheets[0];
  assert.equal(screen.getValue(1, 1), 'Candidate');
  assert.equal(screen.getValue(2, 1), 'Alpha');
  assert.equal(screen.getValue(2, 2), '0.82');
  assert.equal(screen.getValue(2, 3), '=B2*100');
  assert.equal(workbook.worksheets[1].getValue(2, 1), 'Review required');

  screen.setValue(2, 1, 'Alpha revised');
  screen.setValue(2, 2, '0.91');
  screen.setValue(3, 3, '=B3*100');
  workbook.worksheets[1].setValue(3, 1, 'Human approval pending');
  const output = await workbook.writeBuffer();
  assert.equal(output[0], 0x50);
  assert.equal(output[1], 0x4b);

  const reloaded = await loadXlsxWorkbook(exactBuffer(output));
  assert.equal(reloaded.worksheets[0].getValue(2, 1), 'Alpha revised');
  assert.equal(reloaded.worksheets[0].getValue(2, 2), '0.91');
  assert.equal(reloaded.worksheets[0].getValue(3, 3), '=B3*100');
  assert.equal(reloaded.worksheets[1].getValue(3, 1), 'Human approval pending');
});

test('local xlsx engine rejects unsafe archive paths before parsing workbook XML', async () => {
  const unsafe = storedZip([['../outside.xml', '<unsafe/>']]);
  await assert.rejects(
    () => loadXlsxWorkbook(exactBuffer(unsafe)),
    { code: 'INVALID_XLSX' }
  );
});
