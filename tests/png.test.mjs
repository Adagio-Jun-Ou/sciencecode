import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  decodePng,
  MAX_PNG_BYTES,
  MAX_PNG_CHUNKS
} from '../lib/png.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(...buffers) {
  let value = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) {
      value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(typeBytes, data), 8 + data.length);
  return output;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const distances = [
    Math.abs(estimate - left),
    Math.abs(estimate - above),
    Math.abs(estimate - upperLeft)
  ];
  if (distances[0] <= distances[1] && distances[0] <= distances[2]) return left;
  return distances[1] <= distances[2] ? above : upperLeft;
}

function filteredRows(samples, width, height, channels, filters) {
  const rowBytes = width * channels;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const filter = filters[row] ?? filters.at(-1) ?? 0;
    const target = row * (rowBytes + 1);
    raw[target] = filter;
    for (let column = 0; column < rowBytes; column += 1) {
      const index = row * rowBytes + column;
      const left = column >= channels ? samples[index - channels] : 0;
      const above = row > 0 ? samples[index - rowBytes] : 0;
      const upperLeft = row > 0 && column >= channels
        ? samples[index - rowBytes - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      raw[target + 1 + column] = (samples[index] - predictor + 256) & 0xff;
    }
  }
  return raw;
}

function makePng({
  width = 1,
  height = 1,
  colorType = 6,
  samples = Buffer.from([0, 0, 0, 255]),
  filters = [0],
  palette,
  transparency,
  beforeIdat = [],
  afterIdat = [],
  raw
} = {}) {
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]])
    .get(colorType) ?? 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const pieces = [signature, chunk('IHDR', header), ...beforeIdat];
  if (palette !== undefined) pieces.push(chunk('PLTE', Buffer.from(palette)));
  if (transparency !== undefined) pieces.push(chunk('tRNS', Buffer.from(transparency)));
  pieces.push(chunk('IDAT', zlib.deflateSync(raw ??
    filteredRows(Buffer.from(samples), width, height, channels, filters)
  )), ...afterIdat, chunk('IEND'));
  return Buffer.concat(pieces);
}

test('bounded PNG decoder reconstructs every standard row filter', () => {
  const samples = Buffer.from([
    10, 20, 30, 255, 40, 50, 60, 200,
    70, 80, 90, 150, 100, 110, 120, 100
  ]);
  for (let filter = 0; filter <= 4; filter += 1) {
    const decoded = decodePng(makePng({
      width: 2,
      height: 2,
      samples,
      filters: [filter, filter]
    }));
    assert.deepEqual(decoded.rgba, samples, 'filter ' + filter);
  }
});

test('bounded PNG decoder canonicalizes supported 8-bit color types to RGBA', () => {
  assert.deepEqual(
    decodePng(makePng({
      colorType: 0,
      samples: [128],
      transparency: [0, 128]
    })).rgba,
    Buffer.from([128, 128, 128, 0])
  );
  assert.deepEqual(
    decodePng(makePng({
      colorType: 2,
      samples: [1, 2, 3],
      transparency: [0, 1, 0, 2, 0, 3]
    })).rgba,
    Buffer.from([1, 2, 3, 0])
  );
  assert.deepEqual(
    decodePng(makePng({
      colorType: 3,
      samples: [1],
      palette: [10, 20, 30, 40, 50, 60],
      transparency: [255, 100]
    })).rgba,
    Buffer.from([40, 50, 60, 100])
  );
  assert.deepEqual(
    decodePng(makePng({ colorType: 4, samples: [7, 80] })).rgba,
    Buffer.from([7, 7, 7, 80])
  );
  assert.deepEqual(
    decodePng(makePng({ colorType: 6, samples: [9, 8, 7, 6] })).rgba,
    Buffer.from([9, 8, 7, 6])
  );
});

test('bounded PNG decoder rejects oversized and structurally invalid inputs', () => {
  assert.throws(() => decodePng(Buffer.alloc(MAX_PNG_BYTES + 1)), {
    code: 'PNG_BYTE_LIMIT'
  });
  assert.throws(() => decodePng(makePng({ width: 8193, raw: Buffer.alloc(0) })), {
    code: 'PNG_DIMENSION_LIMIT'
  });
  assert.throws(() => decodePng(makePng({
    width: 8192, height: 2049, raw: Buffer.alloc(0)
  })), {
    code: 'PNG_PIXEL_LIMIT'
  });
  assert.throws(() => decodePng(makePng({
    colorType: 0,
    samples: [0],
    palette: [0, 0, 0]
  })), /cannot contain a palette/);
  assert.throws(() => decodePng(makePng({
    beforeIdat: [chunk('ABCD')]
  })), /Unsupported critical PNG chunk/);
  assert.throws(() => decodePng(makePng({
    beforeIdat: [chunk('abca')]
  })), /invalid chunk type/);
  assert.throws(() => decodePng(Buffer.concat([makePng(), Buffer.from([0])])),
    /bytes after IEND/);
});

test('bounded PNG decoder caps pathological ancillary chunk counts', () => {
  const extras = Array.from({ length: MAX_PNG_CHUNKS }, () => chunk('tEXt'));
  assert.throws(() => decodePng(makePng({ beforeIdat: extras })), {
    code: 'PNG_CHUNK_LIMIT'
  });
});
