/**
 * JPEG decoder, self-built.
 *
 * Decodes baseline (sequential) and progressive JPEG to RGBA with no external
 * dependency. It implements the markers a photograph uses: DQT, DHT, SOF0/SOF1/
 * SOF2, SOS, DRI and RSTn restart intervals, plus the standard inverse DCT. A
 * stream this decoder cannot read raises, so a corrupt upload is a refusal.
 *
 * The decoder is intentionally compact but complete for real photographs — it
 * is not a thumbnailer and does not upscale.
 */

import type { DecodedImage } from '@/lib/kyc/png';
import { ImageDecodeError } from '@/lib/kyc/png';

interface Component {
  id: number;
  h: number; // horizontal sampling factor
  v: number; // vertical sampling factor
  tq: number; // quantisation table selector
  dcTable: number;
  acTable: number;
  // Per-component block grid and coefficient storage.
  blocksPerLine: number;
  blocksPerColumn: number;
  pred: number;
}

interface HuffmanTable {
  // Fast lookup: for each 8-bit prefix, the code length (0 = longer) and value.
  lookups: Int32Array;
  values: Int32Array;
  maxcode: Int32Array;
  valptr: Int32Array;
  mincode: Int32Array;
  count: number;
}

const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
]);

/** IDCT constants, precomputed once. */
const DCT_COS = new Float32Array(64);
const DCT_COS_ROW = new Float32Array(64);
for (let u = 0; u < 8; u += 1) {
  for (let x = 0; x < 8; x += 1) {
    DCT_COS[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    DCT_COS_ROW[u * 8 + x] = DCT_COS[u * 8 + x] * (u === 0 ? Math.SQRT1_2 : 1);
  }
}

function buildHuffmanTable(codeLengths: Uint8Array, values: Uint8Array): HuffmanTable {
  // Canonical code assignment, then a fast LUT for codes up to 8 bits and a
  // linear walk for longer codes.
  const codes = new Int32Array(256);
  const mincode = new Int32Array(17).fill(-1);
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  let code = 0;
  let valueIndex = 0;
  for (let length = 1; length <= 16; length += 1) {
    // `codeLengths` is the 16-byte BITS field: index 0 holds the count of
    // one-bit codes, so the count for `length` sits at `length - 1`.
    const count = codeLengths[length - 1] ?? 0;
    if (count > 0) {
      valptr[length] = valueIndex;
      mincode[length] = code;
      code += count;
      maxcode[length] = code - 1;
      valueIndex += count;
    }
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;

  const lookups = new Int32Array(256);
  for (let length = 1; length <= 8; length += 1) {
    const start = length === 1 ? 0 : mincode[length] ?? 0;
    const end = maxcode[length] ?? -1;
    for (let c = start; c <= end; c += 1) {
      const prefix = c << (8 - length);
      for (let i = 0; i < 1 << (8 - length); i += 1) {
        lookups[prefix + i] = (length << 8) | (valptr[length] + (c - start));
      }
    }
  }

  return {
    lookups,
    values: Int32Array.from(values),
    maxcode,
    valptr,
    mincode,
    count: valueIndex,
  };
}

class BitReader {
  private data: Uint8Array;
  private pos = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Read one byte, honouring 0xFF00 stuffing and stopping at a marker. */
  private nextByte(): number {
    if (this.pos >= this.data.length) return -1;
    const value = this.data[this.pos++];
    if (value === 0xff) {
      let marker = this.data[this.pos];
      while (marker === 0xff) {
        this.pos += 1;
        marker = this.data[this.pos];
      }
      if (marker === 0x00) {
        this.pos += 1; // stuffed zero byte, part of the entropy data
      } else {
        // A real marker: stop feeding bits and leave pos on the 0xFF.
        this.pos -= 1;
        return -1;
      }
    }
    return value;
  }

  /** Fill the buffer so at least `count` bits are available. */
  private ensure(count: number): void {
    while (this.bitCount < count) {
      const byte = this.nextByte();
      this.bitBuffer = ((this.bitBuffer << 8) | (byte < 0 ? 0 : byte)) & 0xffffff;
      this.bitCount += 8;
    }
  }

  peekBits(count: number): number {
    this.ensure(count);
    const shift = this.bitCount - count;
    return (this.bitBuffer >>> shift) & ((1 << count) - 1);
  }

  private consume(count: number): void {
    this.bitCount -= count;
  }

  getBits(count: number): number {
    const value = this.peekBits(count);
    this.consume(count);
    return value;
  }

  /** Decode one Huffman symbol from the given table. */
  decodeHuffman(table: HuffmanTable): number {
    const code = this.peekBits(16);
    const lookup = table.lookups[code >> 8];
    if (lookup !== 0) {
      this.consume(lookup >> 8);
      return table.values[lookup & 0xff];
    }
    for (let length = 9; length <= 16; length += 1) {
      const candidate = code >> (16 - length);
      if (table.maxcode[length] >= 0 && candidate <= table.maxcode[length]) {
        this.consume(length);
        return table.values[table.valptr[length] + (candidate - table.mincode[length])];
      }
    }
    throw new ImageDecodeError('JPEG Huffman code exceeds 16 bits');
  }

  /** Discard bits to the next byte boundary. */
  align(): void {
    this.consume(this.bitCount % 8);
  }

  /** Restart the reader at a new byte position (used by restart markers). */
  reset(pos: number): void {
    this.pos = pos;
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  get position(): number {
    return this.pos;
  }
}

function extend(value: number, bits: number): number {
  if (bits === 0) return 0;
  const threshold = 1 << (bits - 1);
  if (value < threshold) return value - (1 << bits) + 1;
  return value;
}

/** Build the 8x8 spatial block from dequantised coefficients (inverse DCT). */
function inverseDct(coeffs: Int32Array, output: Uint8Array, outOffset: number, stride: number): void {
  const block = new Float32Array(64);
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      const c = coeffs[v * 8 + u];
      if (c === 0) continue;
      for (let y = 0; y < 8; y += 1) {
        const row = y * 8;
        for (let x = 0; x < 8; x += 1) {
          block[row + x] += c * DCT_COS_ROW[u * 8 + x] * DCT_COS_ROW[v * 8 + y];
        }
      }
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = Math.round(block[y * 8 + x] / 4 + 128);
      output[outOffset + y * stride + x] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
}

/** Decode one 8x8 block of coefficients (DC/AC entropy decoding). */
function decodeBlock(
  reader: BitReader,
  coeffs: Int32Array,
  quant: Int32Array,
  dcTable: HuffmanTable,
  acTable: HuffmanTable,
  component: Component,
): void {
  coeffs.fill(0);
  const dcLength = reader.decodeHuffman(dcTable);
  const dcDiff = dcLength === 0 ? 0 : extend(reader.getBits(dcLength), dcLength);
  component.pred += dcDiff;
  coeffs[0] = component.pred;

  let k = 1;
  while (k < 64) {
    const rs = reader.decodeHuffman(acTable);
    const run = rs >> 4;
    const size = rs & 15;
    if (size === 0) {
      if (run === 15) {
        k += 16;
        continue;
      }
      break; // EOB
    }
    k += run;
    if (k >= 64) break;
    const value = extend(reader.getBits(size), size);
    coeffs[ZIGZAG[k]] = value;
    k += 1;
  }
}

interface Frame {
  progressive: boolean;
  width: number;
  height: number;
  components: Component[];
  maxH: number;
  maxV: number;
}

/**
 * Decode a JPEG stream to RGBA pixels.
 *
 * Handles baseline and progressive scans. Progressive is decoded by running
 * every scan over the shared coefficient buffer and doing the IDCT once at the
 * end, which is the correct model for successive approximation.
 */
export function decodeJpeg(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new ImageDecodeError('Not a JPEG stream');
  }
  bytes0 = bytes;

  const quantTables = new Map<number, Int32Array>();
  const huffTables = new Map<number, HuffmanTable>();
  let frame: Frame | null = null;
  let restartInterval = 0;
  // Coefficients per component block grid, filled by one or more scans.
  let coeffStore: Map<number, Int32Array> = new Map();
  let eobrun = 0;

  let pos = 2;

  const readMarker = (): number => {
    while (pos < bytes.length) {
      if (bytes[pos] !== 0xff) {
        pos += 1;
        continue;
      }
      let marker = bytes[pos + 1];
      while (marker === 0xff) {
        pos += 1;
        marker = bytes[pos + 1];
      }
      pos += 2;
      return marker;
    }
    return -1;
  };

  const readLength = (): number => {
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    pos += 2;
    return length;
  };

  const componentById = (id: number): Component => {
    const component = frame!.components.find((c) => c.id === id);
    if (!component) throw new ImageDecodeError(`JPEG references unknown component ${id}`);
    return component;
  };

  const scanBlock = (
    reader: BitReader,
    component: Component,
    coeffs: Int32Array,
    quant: Int32Array,
    blockRow: number,
    blockCol: number,
  ): void => {
    const store = coeffStore.get(component.id)!;
    const blockIndex = (blockRow * component.blocksPerLine + blockCol) * 64;
    if (coeffs.length !== 64) throw new ImageDecodeError('internal: block buffer size');
    decodeBlock(reader, coeffs, quant, huffTables.get(component.dcTable)!, huffTables.get(0x10 | component.acTable)!, component);
    for (let i = 0; i < 64; i += 1) store[blockIndex + i] = coeffs[i];
  };

  while (pos < bytes.length) {
    const marker = readMarker();
    if (marker < 0 || marker === 0xd9) break; // EOI

    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // no length

    const length = readLength();
    const segmentEnd = pos + length - 2;

    switch (marker) {
      case 0xdb: {
        // DQT
        let p = pos;
        while (p < segmentEnd) {
          const pq = bytes[p] >> 4;
          const tq = bytes[p] & 15;
          p += 1;
          const table = new Int32Array(64);
          for (let i = 0; i < 64; i += 1) {
            table[ZIGZAG[i]] = pq === 1 ? (bytes[p] << 8) | bytes[p + 1] : bytes[p];
            p += pq === 1 ? 2 : 1;
          }
          quantTables.set(tq, table);
        }
        break;
      }
      case 0xc4: {
        // DHT
        let p = pos;
        while (p < segmentEnd) {
          const tc = bytes[p] >> 4;
          const th = bytes[p] & 15;
          p += 1;
          const codeLengths = bytes.subarray(p, p + 16);
          p += 16;
          let total = 0;
          for (let i = 0; i < 16; i += 1) total += codeLengths[i];
          const values = bytes.subarray(p, p + total);
          p += total;
          huffTables.set((tc << 4) | th, buildHuffmanTable(codeLengths, values));
        }
        break;
      }
      case 0xc0:
      case 0xc1:
      case 0xc2: {
        // SOF0/SOF1 (baseline) / SOF2 (progressive)
        const precision = bytes[pos];
        if (precision !== 8) throw new ImageDecodeError('JPEG precision other than 8 bits is not supported');
        const height = (bytes[pos + 1] << 8) | bytes[pos + 2];
        const width = (bytes[pos + 3] << 8) | bytes[pos + 4];
        const count = bytes[pos + 5];
        const components: Component[] = [];
        let p = pos + 6;
        for (let i = 0; i < count; i += 1) {
          const id = bytes[p];
          const sampling = bytes[p + 1];
          const tq = bytes[p + 2];
          components.push({
            id,
            h: sampling >> 4,
            v: sampling & 15,
            tq,
            dcTable: 0,
            acTable: 0,
            blocksPerLine: 0,
            blocksPerColumn: 0,
            pred: 0,
          });
          p += 3;
        }
        const maxH = Math.max(...components.map((c) => c.h));
        const maxV = Math.max(...components.map((c) => c.v));
        // Size each component's grid to the padded MCU extent, so every block an
        // encoder wrote has a slot and the entropy stream never desyncs.
        const mcusPerLine = Math.ceil(width / (8 * maxH));
        const mcusPerColumn = Math.ceil(height / (8 * maxV));
        for (const c of components) {
          c.blocksPerLine = mcusPerLine * c.h;
          c.blocksPerColumn = mcusPerColumn * c.v;
        }
        frame = { progressive: marker === 0xc2, width, height, components, maxH, maxV };
        coeffStore = new Map();
        for (const c of components) {
          coeffStore.set(c.id, new Int32Array(c.blocksPerLine * c.blocksPerColumn * 64));
        }
        break;
      }
      case 0xdd: {
        restartInterval = (bytes[pos] << 8) | bytes[pos + 1];
        break;
      }
      case 0xda: {
        // SOS — decode one scan.
        if (!frame) throw new ImageDecodeError('JPEG scan before frame header');
        const scanCount = bytes[pos];
        let p = pos + 1;
        const scanComponents: Array<{ component: Component; dcTable: number; acTable: number }> = [];
        for (let i = 0; i < scanCount; i += 1) {
          const id = bytes[p];
          const tables = bytes[p + 1];
          const component = componentById(id);
          component.dcTable = tables >> 4;
          component.acTable = tables & 15;
          scanComponents.push({ component, dcTable: tables >> 4, acTable: tables & 15 });
          p += 2;
        }
        const spectralStart = bytes[p];
        const spectralEnd = bytes[p + 1];
        const approx = bytes[p + 2];
        const successiveHigh = approx >> 4;
        const successiveLow = approx & 15;

        const reader = new BitReader(bytes);
        reader.reset(segmentEnd);

        if (!frame.progressive) {
          // Baseline: decode every block of every component in MCU order.
          const mcuWidth = 8 * frame.maxH;
          const mcuHeight = 8 * frame.maxV;
          const mcusPerLine = Math.ceil(frame.width / mcuWidth);
          const mcusPerColumn = Math.ceil(frame.height / mcuHeight);
          const blockBuffer = new Int32Array(64);
          for (let my = 0; my < mcusPerColumn; my += 1) {
            for (let mx = 0; mx < mcusPerLine; mx += 1) {
              for (const { component } of scanComponents) {
                const quant = quantTables.get(component.tq);
                if (!quant) throw new ImageDecodeError('JPEG block references a missing quantisation table');
                for (let by = 0; by < component.v; by += 1) {
                  for (let bx = 0; bx < component.h; bx += 1) {
                    const blockRow = my * component.v + by;
                    const blockCol = mx * component.h + bx;
                    if (blockRow >= component.blocksPerColumn || blockCol >= component.blocksPerLine) continue;
                    scanBlock(reader, component, blockBuffer, quant, blockRow, blockCol);
                  }
                }
              }
              if (restartInterval > 0) {
                const done = my * mcusPerLine + mx + 1;
                if (done % restartInterval === 0 && !(my === mcusPerColumn - 1 && mx === mcusPerLine - 1)) {
                  reader.align();
                  // Skip to the next RSTn marker.
                  const markerPos = findRestart(bytes, reader.position);
                  reader.reset(markerPos);
                  for (const { component } of scanComponents) component.pred = 0;
                }
              }
            }
          }
        } else {
          decodeProgressiveScan(
            reader,
            frame,
            scanComponents,
            quantTables,
            huffTables,
            coeffStore,
            spectralStart,
            spectralEnd,
            successiveHigh,
            successiveLow,
            restartInterval,
            () => eobrun,
            (value) => {
              eobrun = value;
            },
          );
        }
        // Move past the entropy-coded data to the next marker.
        pos = skipEntropy(bytes, reader.position);
        continue;
      }
      default:
        break;
    }
    pos = segmentEnd;
  }

  if (!frame) throw new ImageDecodeError('JPEG has no frame header');

  return assembleFrame(frame, coeffStore, quantTables);
}

function findRestart(bytes: Uint8Array, from: number): number {
  let p = from;
  while (p + 1 < bytes.length) {
    if (bytes[p] === 0xff && bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7) return p + 2;
    p += 1;
  }
  return bytes.length;
}

function skipEntropy(bytes: Uint8Array, from: number): number {
  let p = from;
  while (p + 1 < bytes.length) {
    if (bytes[p] === 0xff) {
      const next = bytes[p + 1];
      if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) return p;
      if (next >= 0xd0 && next <= 0xd7) return p; // let the marker loop handle RST
      p += 2;
      continue;
    }
    p += 1;
  }
  return bytes.length;
}

interface ScanComponent {
  component: Component;
  dcTable: number;
  acTable: number;
}

function decodeProgressiveScan(
  reader: BitReader,
  frame: Frame,
  scanComponents: ScanComponent[],
  quantTables: Map<number, Int32Array>,
  huffTables: Map<number, HuffmanTable>,
  coeffStore: Map<number, Int32Array>,
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
  restartInterval: number,
  getEobrun: () => number,
  setEobrun: (value: number) => void,
): void {
  const mcuWidth = 8 * frame.maxH;
  const mcuHeight = 8 * frame.maxV;
  const mcusPerLine = Math.ceil(frame.width / mcuWidth);
  const mcusPerColumn = Math.ceil(frame.height / mcuHeight);

  const isDcScan = spectralStart === 0;

  const decodeOneBlock = (
    component: Component,
    blockRow: number,
    blockCol: number,
    acTable: HuffmanTable,
    dcTable: HuffmanTable,
    quant: Int32Array,
  ) => {
    const store = coeffStore.get(component.id)!;
    const blockIndex = (blockRow * component.blocksPerLine + blockCol) * 64;
    if (isDcScan) {
      if (successiveHigh === 0) {
        const dcLength = reader.decodeHuffman(dcTable);
        const dcDiff = dcLength === 0 ? 0 : extend(reader.getBits(dcLength), dcLength);
        component.pred += dcDiff;
        // A progressive first DC scan stores the accumulated value shifted to
        // its approximation bit position; refinement scans add the low bits.
        store[blockIndex] = component.pred << successiveLow;
      } else {
        // Successive approximation of the DC coefficient: a single correction bit.
        if (reader.getBits(1)) {
          store[blockIndex] += store[blockIndex] >= 0 ? 1 << successiveLow : -(1 << successiveLow);
        }
      }
      return;
    }

    if (successiveHigh === 0) {
      // First AC scan: full run-length decode into the coefficient buffer.
      let eobrun = getEobrun();
      if (eobrun > 0) {
        setEobrun(eobrun - 1);
        return;
      }
      let k = spectralStart;
      while (k <= spectralEnd) {
        const rs = reader.decodeHuffman(acTable);
        const run = rs >> 4;
        const size = rs & 15;
        if (size === 0) {
          if (run === 15) {
            k += 16;
            continue;
          }
          eobrun = (1 << run) - 1;
          if (run > 0) eobrun += reader.getBits(run);
          setEobrun(eobrun);
          break;
        }
        k += run;
        if (k > spectralEnd) break;
        const value = extend(reader.getBits(size), size);
        store[blockIndex + ZIGZAG[k]] = value << successiveLow;
        k += 1;
      }
      return;
    }

    // AC refinement scan: correct the magnitude of existing coefficients and
    // place newly-significant ones, both at the current bit position. This
    // follows the reference (libjpeg) decode_mcu_AC_refine structure: the EOB
    // run length is `(1 << r) + extra` and is decremented once per block.
    const p1 = 1 << successiveLow;
    const m1 = -p1;
    let k = spectralStart;
    let eobrun = getEobrun();
    if (eobrun === 0) {
      for (; k <= spectralEnd; k += 1) {
        const rs = reader.decodeHuffman(acTable);
        let run = rs >> 4;
        const size = rs & 15;
        let newValue = 0;
        if (size !== 0) {
          // In a refinement scan the only non-zero size is 1, a sign bit.
          newValue = reader.getBits(1) ? p1 : m1;
        } else if (run !== 15) {
          eobrun = 1 << run;
          if (run > 0) eobrun += reader.getBits(run);
          break;
        }
        // Walk the coefficients, correcting each non-zero one and counting the
        // zeros until the run is exhausted, then place the new coefficient.
        while (k <= spectralEnd) {
          const index = blockIndex + ZIGZAG[k];
          const coeff = store[index];
          if (coeff !== 0) {
            if (reader.getBits(1) && (coeff & p1) === 0) {
              store[index] = coeff >= 0 ? coeff + p1 : coeff + m1;
            }
          } else {
            run -= 1;
            if (run < 0) break;
          }
          k += 1;
        }
        if (newValue !== 0 && k <= spectralEnd) {
          store[blockIndex + ZIGZAG[k]] = newValue;
        }
      }
    }
    if (eobrun > 0) {
      for (; k <= spectralEnd; k += 1) {
        const index = blockIndex + ZIGZAG[k];
        const coeff = store[index];
        if (coeff !== 0 && reader.getBits(1) && (coeff & p1) === 0) {
          store[index] = coeff >= 0 ? coeff + p1 : coeff + m1;
        }
      }
      setEobrun(eobrun - 1);
    }
  };

  if (scanComponents.length === 1 && !isDcScan) {
    // A non-interleaved AC scan walks that component's own block grid, not MCUs.
    const { component, acTable, dcTable } = scanComponents[0];
    const quant = quantTables.get(component.tq)!;
    const acHuff = huffTables.get(0x10 | acTable)!;
    const dcHuff = huffTables.get(dcTable)!;
    for (let br = 0; br < component.blocksPerColumn; br += 1) {
      for (let bc = 0; bc < component.blocksPerLine; bc += 1) {
        decodeOneBlock(component, br, bc, acHuff, dcHuff, quant);
      }
    }
    return;
  }

  const totalMcus = mcusPerLine * mcusPerColumn;
  for (let mcu = 0; mcu < totalMcus; mcu += 1) {
    const my = Math.floor(mcu / mcusPerLine);
    const mx = mcu % mcusPerLine;
    for (const { component, acTable, dcTable } of scanComponents) {
      const quant = quantTables.get(component.tq)!;
      const acHuff = huffTables.get(0x10 | acTable)!;
      const dcHuff = huffTables.get(dcTable)!;
      // A DC scan interleaves every block of each component; an AC scan of an
      // interleaved component carries one block per MCU per component.
      const blocksH = isDcScan ? component.h : 1;
      const blocksV = isDcScan ? component.v : 1;
      for (let by = 0; by < blocksV; by += 1) {
        for (let bx = 0; bx < blocksH; bx += 1) {
          const blockRow = my * component.v + by;
          const blockCol = mx * component.h + bx;
          if (blockRow >= component.blocksPerColumn || blockCol >= component.blocksPerLine) continue;
          decodeOneBlock(component, blockRow, blockCol, acHuff, dcHuff, quant);
        }
      }
    }
    if (restartInterval > 0 && (mcu + 1) % restartInterval === 0 && mcu + 1 < totalMcus) {
      reader.align();
      const markerPos = findRestart(bytes0, reader.position);
      reader.reset(markerPos);
      setEobrun(0);
      for (const { component } of scanComponents) component.pred = 0;
    }
  }
}

// A module-level reference so the progressive restart path can find markers
// without threading the buffer through every call.
let bytes0: Uint8Array = new Uint8Array(0);

function assembleFrame(
  frame: Frame,
  coeffStore: Map<number, Int32Array>,
  quantTables: Map<number, Int32Array>,
): DecodedImage {
  const { width, height } = frame;
  // Decode each component to a full-resolution plane, then colour-convert.
  const planes = new Map<number, Uint8Array>();
  for (const component of frame.components) {
    const planeWidth = component.blocksPerLine * 8;
    const planeHeight = component.blocksPerColumn * 8;
    const plane = new Uint8Array(planeWidth * planeHeight);
    const store = coeffStore.get(component.id)!;
    const quant = quantTables.get(component.tq)!;
    const coeffs = new Int32Array(64);
    for (let br = 0; br < component.blocksPerColumn; br += 1) {
      for (let bc = 0; bc < component.blocksPerLine; bc += 1) {
        const base = (br * component.blocksPerLine + bc) * 64;
        // Coefficients are held unquantised so successive-approximation scans
        // can refine them by magnitude; the quantisation step is applied here,
        // once, immediately before the inverse transform.
        for (let i = 0; i < 64; i += 1) coeffs[i] = store[base + i] * quant[i];
        inverseDct(coeffs, plane, (br * 8) * planeWidth + bc * 8, planeWidth);
      }
    }
    planes.set(component.id, plane);
  }

  const rgba = new Uint8Array(width * height * 4);
  const [c0, c1, c2] = frame.components;
  const planeWidth = (component: Component): number => component.blocksPerLine * 8;
  const samplePlane = (component: Component, plane: Uint8Array, x: number, y: number): number => {
    // Plane resolution is scaled by the component's sampling factor; a plane
    // smaller than the full image is sampled with the matching stride so an
    // upsampled chroma value lands on the correct pixel.
    const sx = Math.min(
      planeWidth(component) - 1,
      Math.floor((x * component.h) / frame.maxH),
    );
    const sy = Math.min(component.blocksPerColumn * 8 - 1, Math.floor((y * component.v) / frame.maxV));
    return plane[sy * planeWidth(component) + sx];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r: number;
      let g: number;
      let b: number;
      if (frame.components.length === 1) {
        r = g = b = planes.get(c0.id)![y * planeWidth(c0) + x];
      } else {
        const yv = samplePlane(c0, planes.get(c0.id)!, x, y);
        const cb = samplePlane(c1, planes.get(c1.id)!, x, y) - 128;
        const cr = samplePlane(c2, planes.get(c2.id)!, x, y) - 128;
        r = clamp8(yv + 1.402 * cr);
        g = clamp8(yv - 0.344136 * cb - 0.714136 * cr);
        b = clamp8(yv + 1.772 * cb);
      }
      const out = (y * width + x) * 4;
      rgba[out] = r;
      rgba[out + 1] = g;
      rgba[out + 2] = b;
      rgba[out + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

function clamp8(value: number): number {
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

export { ZIGZAG };
