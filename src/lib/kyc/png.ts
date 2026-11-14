/**
 * PNG decoder, self-built.
 *
 * Decodes a PNG stream to 8-bit RGBA pixels with no external dependency. It
 * implements the parts of the specification an identity document or a selfie
 * actually uses: the eight bit depths, colour types 0/2/3/4/6, all five row
 * filters, transparency, and Adam7 interlacing. A stream this decoder cannot
 * read raises rather than returning a blank image, so a corrupt upload is a
 * refusal, not a silently empty frame.
 *
 * Only `node:zlib` is used, for the DEFLATE stream the format mandates.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, top-left origin. */
  data: Uint8Array;
}

export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS_BY_COLOUR_TYPE: Record<number, number> = {
  0: 1, // grayscale
  2: 3, // truecolour
  3: 1, // indexed
  4: 2, // grayscale + alpha
  6: 4, // truecolour + alpha
};

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlace: number;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function parseHeader(bytes: Uint8Array): Ihdr {
  const ihdr = bytes.subarray(8, 8 + 4 + 4 + 13);
  const length = readUint32(ihdr, 0);
  if (length !== 13) throw new ImageDecodeError('PNG IHDR chunk has the wrong length');
  const type = String.fromCharCode(ihdr[4], ihdr[5], ihdr[6], ihdr[7]);
  if (type !== 'IHDR') throw new ImageDecodeError('PNG does not start with an IHDR chunk');
  const width = readUint32(ihdr, 8);
  const height = readUint32(ihdr, 12);
  const bitDepth = ihdr[16];
  const colourType = ihdr[17];
  const compression = ihdr[18];
  const filter = ihdr[19];
  const interlace = ihdr[20];
  if (width === 0 || height === 0) throw new ImageDecodeError('PNG has a zero dimension');
  if (width > 20000 || height > 20000) throw new ImageDecodeError('PNG is larger than the 20000px limit');
  if (!(colourType in CHANNELS_BY_COLOUR_TYPE)) throw new ImageDecodeError(`PNG colour type ${colourType} is not supported`);
  const validDepths: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!validDepths[colourType].includes(bitDepth)) {
    throw new ImageDecodeError(`PNG bit depth ${bitDepth} is invalid for colour type ${colourType}`);
  }
  if (compression !== 0) throw new ImageDecodeError('PNG uses an unsupported compression method');
  if (filter !== 0) throw new ImageDecodeError('PNG uses an unsupported filter method');
  if (interlace !== 0 && interlace !== 1) throw new ImageDecodeError('PNG has an invalid interlace method');
  return { width, height, bitDepth, colourType, interlace };
}

interface Chunks {
  idat: Uint8Array[];
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
}

function collectChunks(bytes: Uint8Array): Chunks {
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new ImageDecodeError('PNG chunk overruns the file');
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IEND') break;
    offset = dataEnd + 4; // skip the CRC
  }
  if (idat.length === 0) throw new ImageDecodeError('PNG has no image data');
  return { idat, palette, transparency };
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Paeth predictor from the PNG specification. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Reverse the per-row filters for one pass.
 *
 * `bytesPerPixel` is the filter unit (rounded up to at least one), which is what
 * the specification uses for Sub/Average/Paeth — not the sample size.
 */
function unfilter(raw: Uint8Array, width: number, height: number, bytesPerPixel: number, rowBytes: number): Uint8Array {
  const out = new Uint8Array(rowBytes * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[inputOffset];
    inputOffset += 1;
    const rowStart = y * rowBytes;
    const prevStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[inputOffset + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;
      let reconstructed: number;
      switch (filter) {
        case 0:
          reconstructed = value;
          break;
        case 1:
          reconstructed = value + left;
          break;
        case 2:
          reconstructed = value + up;
          break;
        case 3:
          reconstructed = value + ((left + up) >> 1);
          break;
        case 4:
          reconstructed = value + paeth(left, up, upLeft);
          break;
        default:
          throw new ImageDecodeError(`PNG row ${y} uses an unknown filter ${filter}`);
      }
      out[rowStart + x] = reconstructed & 0xff;
    }
    inputOffset += rowBytes;
  }
  return out;
}

/** Read the `index`-th sample of a row at the given bit depth. */
function readSample(row: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 8) return row[index];
  if (bitDepth === 16) return row[index * 2]; // take the high byte
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  const mask = (1 << bitDepth) - 1;
  return (byte >> shift) & mask;
}

function scaleSample(value: number, bitDepth: number): number {
  if (bitDepth === 8) return value;
  if (bitDepth === 16) return value;
  const max = (1 << bitDepth) - 1;
  return Math.round((value * 255) / max);
}

interface PassGeometry {
  width: number;
  height: number;
  xStart: number;
  yStart: number;
  xStep: number;
  yStep: number;
}

/** The seven Adam7 passes, each with its origin and step. */
const ADAM7: PassGeometry[] = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8, width: 0, height: 0 },
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8, width: 0, height: 0 },
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8, width: 0, height: 0 },
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4, width: 0, height: 0 },
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4, width: 0, height: 0 },
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2, width: 0, height: 0 },
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2, width: 0, height: 0 },
];

function passSize(full: number, start: number, step: number): number {
  if (full <= start) return 0;
  return Math.ceil((full - start) / step);
}

/**
 * Expand one unfiltered pass's samples into the shared RGBA buffer.
 *
 * The pass writes only the pixels its geometry covers; a later pass fills the
 * gaps, so the buffer is complete after the last pass.
 */
function blitPass(
  rgba: Uint8Array,
  imageWidth: number,
  samples: Uint8Array,
  geometry: PassGeometry,
  ihdr: Ihdr,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): void {
  const channels = CHANNELS_BY_COLOUR_TYPE[ihdr.colourType];
  let sampleIndex = 0;
  for (let py = 0; py < geometry.height; py += 1) {
    for (let px = 0; px < geometry.width; px += 1) {
      const values: number[] = [];
      for (let c = 0; c < channels; c += 1) values.push(readSample(samples, sampleIndex++, ihdr.bitDepth));
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (ihdr.colourType === 0) {
        r = g = b = scaleSample(values[0], ihdr.bitDepth);
      } else if (ihdr.colourType === 4) {
        r = g = b = scaleSample(values[0], ihdr.bitDepth);
        a = scaleSample(values[1], ihdr.bitDepth);
      } else if (ihdr.colourType === 2) {
        r = scaleSample(values[0], ihdr.bitDepth);
        g = scaleSample(values[1], ihdr.bitDepth);
        b = scaleSample(values[2], ihdr.bitDepth);
      } else if (ihdr.colourType === 6) {
        r = scaleSample(values[0], ihdr.bitDepth);
        g = scaleSample(values[1], ihdr.bitDepth);
        b = scaleSample(values[2], ihdr.bitDepth);
        a = scaleSample(values[3], ihdr.bitDepth);
      } else {
        // Indexed: the palette entry is a colour type 2 triplet.
        const index = values[0];
        if (!palette) throw new ImageDecodeError('Indexed PNG is missing its palette');
        r = palette[index * 3] ?? 0;
        g = palette[index * 3 + 1] ?? 0;
        b = palette[index * 3 + 2] ?? 0;
        if (transparency && index < transparency.length) a = transparency[index];
      }
      const x = geometry.xStart + px * geometry.xStep;
      const y = geometry.yStart + py * geometry.yStep;
      const outIndex = (y * imageWidth + x) * 4;
      rgba[outIndex] = r;
      rgba[outIndex + 1] = g;
      rgba[outIndex + 2] = b;
      rgba[outIndex + 3] = a;
    }
  }
}

/** Decode a PNG stream to RGBA pixels. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (!isPng(bytes)) throw new ImageDecodeError('Not a PNG stream');
  const ihdr = parseHeader(bytes);
  const { idat, palette, transparency } = collectChunks(bytes);
  const inflated = new Uint8Array(inflateSync(concat(idat)));

  const rgba = new Uint8Array(ihdr.width * ihdr.height * 4);
  const channels = CHANNELS_BY_COLOUR_TYPE[ihdr.colourType];
  const bitsPerPixel = channels * ihdr.bitDepth;

  if (ihdr.interlace === 0) {
    const rowBytes = Math.ceil((ihdr.width * bitsPerPixel) / 8);
    const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const samples = unfilter(inflated, ihdr.width, ihdr.height, bytesPerPixel, rowBytes);
    blitPass(
      rgba,
      ihdr.width,
      samples,
      { width: ihdr.width, height: ihdr.height, xStart: 0, yStart: 0, xStep: 1, yStep: 1 },
      ihdr,
      palette,
      transparency,
    );
    return { width: ihdr.width, height: ihdr.height, data: rgba };
  }

  let offset = 0;
  for (const base of ADAM7) {
    const geometry: PassGeometry = {
      ...base,
      width: passSize(ihdr.width, base.xStart, base.xStep),
      height: passSize(ihdr.height, base.yStart, base.yStep),
    };
    if (geometry.width === 0 || geometry.height === 0) continue;
    const rowBytes = Math.ceil((geometry.width * bitsPerPixel) / 8);
    const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const passBytes = (rowBytes + 1) * geometry.height;
    const raw = inflated.subarray(offset, offset + passBytes);
    if (raw.length < passBytes) throw new ImageDecodeError('PNG interlace data is truncated');
    const samples = unfilter(raw, geometry.width, geometry.height, bytesPerPixel, rowBytes);
    blitPass(rgba, ihdr.width, samples, geometry, ihdr, palette, transparency);
    offset += passBytes;
  }
  return { width: ihdr.width, height: ihdr.height, data: rgba };
}

export { isPng };
