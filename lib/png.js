import zlib from 'node:zlib';

export const MAX_PNG_BYTES = 20 * 1024 * 1024;
export const MAX_PNG_DIMENSION = 8_192;
export const MAX_PNG_PIXELS = 16 * 1024 * 1024;
export const MAX_PNG_CHUNKS = 16_384;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COLOR_CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4]
]);

const CRC_TABLE = (() => {
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

function pngError(message, code = 'INVALID_PNG') {
  return Object.assign(new Error(message), { code });
}

function crc32(values) {
  let crc = 0xffffffff;
  for (const value of values) {
    for (const byte of value) {
      crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.allocUnsafe(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32([typeBytes, data]), 8 + data.length);
  return output;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function checkedImageSize(width, height, channels) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width <= 0 || height <= 0 ||
      width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
    throw pngError(
      'PNG dimensions must be positive integers no larger than ' +
        MAX_PNG_DIMENSION + ' pixels.',
      'PNG_DIMENSION_LIMIT'
    );
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_PNG_PIXELS) {
    throw pngError(
      'PNG images are limited to ' + MAX_PNG_PIXELS + ' pixels.',
      'PNG_PIXEL_LIMIT'
    );
  }
  const rowBytes = width * channels;
  const inflatedBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(inflatedBytes)) {
    throw pngError('PNG dimensions overflow the safe decoder bounds.');
  }
  return { pixelCount, rowBytes, inflatedBytes };
}

function decodeChunks(buffer) {
  if (buffer.length < PNG_SIGNATURE.length ||
      !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw pngError('Figure is not a PNG image.');
  }
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let header = null;
  let palette = null;
  let transparency = null;
  let seenIdat = false;
  let idatEnded = false;
  let seenIend = false;
  const idat = [];

  while (offset < buffer.length) {
    if (chunkIndex >= MAX_PNG_CHUNKS) {
      throw pngError(
        'PNG contains more than ' + MAX_PNG_CHUNKS + ' chunks.',
        'PNG_CHUNK_LIMIT'
      );
    }
    if (seenIend) throw pngError('PNG contains bytes after IEND.');
    if (offset + 12 > buffer.length) throw pngError('PNG chunk header is truncated.');
    const length = buffer.readUInt32BE(offset);
    if (length > MAX_PNG_BYTES || offset + 12 + length > buffer.length) {
      throw pngError('PNG chunk length exceeds the bounded source.');
    }
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type) || (typeBytes[2] & 0x20) !== 0) {
      throw pngError('PNG contains an invalid chunk type.');
    }
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32([typeBytes, data]);
    if (expectedCrc !== actualCrc) {
      throw pngError('PNG chunk CRC failed for ' + type + '.', 'PNG_CRC_MISMATCH');
    }
    offset += 12 + length;

    if (chunkIndex === 0 && type !== 'IHDR') {
      throw pngError('PNG IHDR must be the first chunk.');
    }
    if (type === 'IHDR') {
      if (header || length !== 13) throw pngError('PNG contains an invalid IHDR.');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
    } else if (type === 'PLTE') {
      if (!header || seenIdat || palette || !length || length > 768 || length % 3 !== 0) {
        throw pngError('PNG contains an invalid palette.');
      }
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      if (!header || seenIdat || transparency ||
          (header.colorType === 3 && !palette)) {
        throw pngError('PNG contains an invalid transparency chunk.');
      }
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      if (!header || idatEnded) throw pngError('PNG IDAT chunks must be consecutive.');
      seenIdat = true;
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      if (!header || !seenIdat || length !== 0) throw pngError('PNG contains an invalid IEND.');
      seenIend = true;
    } else {
      if (seenIdat) idatEnded = true;
      const critical = (typeBytes[0] & 0x20) === 0;
      if (critical) throw pngError('Unsupported critical PNG chunk: ' + type + '.');
    }
    if (type !== 'IDAT' && seenIdat && type !== 'IEND') idatEnded = true;
    chunkIndex += 1;
  }
  if (!seenIend || offset !== buffer.length) throw pngError('PNG is missing a terminal IEND.');
  return { header, palette, transparency, idat };
}

function validateHeader(header, palette, transparency) {
  if (!header || header.bitDepth !== 8 || !COLOR_CHANNELS.has(header.colorType) ||
      header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw pngError(
      'Pixel comparison supports non-interlaced 8-bit grayscale, indexed, RGB, grayscale-alpha, or RGBA PNG images.',
      'UNSUPPORTED_PNG_FORMAT'
    );
  }
  if (header.colorType === 3 && (!palette || palette.length / 3 > 256)) {
    throw pngError('Indexed PNG requires a valid palette.', 'UNSUPPORTED_PNG_FORMAT');
  }
  if ([0, 4].includes(header.colorType) && palette) {
    throw pngError('Grayscale PNG cannot contain a palette.');
  }
  if (header.colorType === 0 && transparency && transparency.length !== 2) {
    throw pngError('Grayscale PNG transparency has an invalid length.');
  }
  if (header.colorType === 2 && transparency && transparency.length !== 6) {
    throw pngError('RGB PNG transparency has an invalid length.');
  }
  if (header.colorType === 3 && transparency &&
      (!transparency.length ||
        transparency.length > (palette?.length ?? 0) / 3)) {
    throw pngError('Indexed PNG transparency exceeds the palette.');
  }
  if ([4, 6].includes(header.colorType) && transparency) {
    throw pngError('PNG with an alpha channel cannot also contain tRNS.');
  }
}

function unfilter(inflated, width, height, channels) {
  const { rowBytes, inflatedBytes } = checkedImageSize(width, height, channels);
  if (inflated.length !== inflatedBytes) {
    throw pngError('PNG decompressed data length does not match its dimensions.');
  }
  const output = Buffer.allocUnsafe(rowBytes * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    if (filter > 4) throw pngError('PNG contains an unsupported row filter.');
    const outputOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const source = inflated[inputOffset + column];
      const left = column >= channels ? output[outputOffset + column - channels] : 0;
      const above = row > 0 ? output[outputOffset + column - rowBytes] : 0;
      const upperLeft = row > 0 && column >= channels
        ? output[outputOffset + column - rowBytes - channels] : 0;
      let value = source;
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += Math.floor((left + above) / 2);
      else if (filter === 4) value += paeth(left, above, upperLeft);
      output[outputOffset + column] = value & 0xff;
    }
    inputOffset += rowBytes;
  }
  return output;
}

function toRgba(samples, header, palette, transparency) {
  const pixelCount = header.width * header.height;
  const rgba = Buffer.allocUnsafe(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const output = pixel * 4;
    if (header.colorType === 0) {
      const gray = samples[pixel];
      rgba[output] = gray;
      rgba[output + 1] = gray;
      rgba[output + 2] = gray;
      rgba[output + 3] = transparency && gray === transparency.readUInt16BE(0) ? 0 : 255;
    } else if (header.colorType === 2) {
      const input = pixel * 3;
      const red = samples[input];
      const green = samples[input + 1];
      const blue = samples[input + 2];
      rgba[output] = red;
      rgba[output + 1] = green;
      rgba[output + 2] = blue;
      rgba[output + 3] = transparency &&
        red === transparency.readUInt16BE(0) &&
        green === transparency.readUInt16BE(2) &&
        blue === transparency.readUInt16BE(4) ? 0 : 255;
    } else if (header.colorType === 3) {
      const index = samples[pixel];
      const input = index * 3;
      if (!palette || input + 2 >= palette.length) {
        throw pngError('Indexed PNG references a missing palette entry.');
      }
      rgba[output] = palette[input];
      rgba[output + 1] = palette[input + 1];
      rgba[output + 2] = palette[input + 2];
      rgba[output + 3] = transparency?.[index] ?? 255;
    } else if (header.colorType === 4) {
      const input = pixel * 2;
      rgba[output] = samples[input];
      rgba[output + 1] = samples[input];
      rgba[output + 2] = samples[input];
      rgba[output + 3] = samples[input + 1];
    } else {
      const input = pixel * 4;
      rgba[output] = samples[input];
      rgba[output + 1] = samples[input + 1];
      rgba[output + 2] = samples[input + 2];
      rgba[output + 3] = samples[input + 3];
    }
  }
  return rgba;
}

export function decodePng(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (!buffer.length || buffer.length > MAX_PNG_BYTES) {
    throw pngError(
      'PNG sources must be between 1 and ' + MAX_PNG_BYTES + ' bytes.',
      'PNG_BYTE_LIMIT'
    );
  }
  const { header, palette, transparency, idat } = decodeChunks(buffer);
  validateHeader(header, palette, transparency);
  const channels = COLOR_CHANNELS.get(header.colorType);
  const { inflatedBytes, pixelCount } = checkedImageSize(
    header.width,
    header.height,
    channels
  );
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: inflatedBytes });
  } catch (error) {
    throw pngError('PNG compressed pixel data could not be decoded: ' + error.message);
  }
  const samples = unfilter(inflated, header.width, header.height, channels);
  return {
    width: header.width,
    height: header.height,
    pixel_count: pixelCount,
    bit_depth: header.bitDepth,
    color_type: header.colorType,
    source_channels: channels,
    rgba: toRgba(samples, header, palette, transparency)
  };
}

export function encodeRgbaPng({ width, height, rgba }) {
  const { pixelCount, rowBytes } = checkedImageSize(width, height, 4);
  const pixels = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba ?? []);
  if (pixels.length !== pixelCount * 4) {
    throw pngError('RGBA pixel bytes do not match the requested PNG dimensions.');
  }
  const raw = Buffer.allocUnsafe((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (rowBytes + 1);
    raw[target] = 0;
    pixels.copy(raw, target + 1, row * rowBytes, (row + 1) * rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const output = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND')
  ]);
  if (output.length > MAX_PNG_BYTES) {
    throw pngError('Encoded PNG exceeds the fixed byte limit.', 'PNG_BYTE_LIMIT');
  }
  return output;
}
