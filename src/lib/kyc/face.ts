/**
 * Face detection and comparison, self-built.
 *
 * This is a deterministic, dependency-free face detector: it builds a
 * skin-likelihood mask in YCbCr, cleans it morphologically, finds connected
 * components, and keeps the ones whose size, aspect ratio and fill are
 * plausible for a face. It then describes a detected face as a normalised
 * low-frequency luminance signature so two faces can be compared.
 *
 * It is a *signal* for the human reviewer — "a face was found", "the two faces
 * are similar" — not a certified biometric. The thresholds below are stated
 * explicitly so the reviewer sees what the number means, and an image the
 * detector cannot analyse yields "no face", never a fabricated match.
 */

import type { DecodedImage } from '@/lib/kyc/png';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fraction of the bounding box covered by skin, in [0, 1]. */
  fill: number;
}

/** A face is described at this grid resolution (rows x cols of luminance). */
const DESCRIPTOR_SIZE = 16;

function rgbToYcbcr(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

/** Whether a pixel is plausibly skin under both the YCbCr and RGB rules. */
function isSkin(r: number, g: number, b: number): boolean {
  const { cb, cr } = rgbToYcbcr(r, g, b);
  const ycbcr = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
  const rgbRule = r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15;
  return ycbcr && rgbRule;
}

/** Morphological open (erode then dilate) to remove speckle from the mask. */
function cleanMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const eroded = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!mask[(y + dy) * width + (x + dx)]) {
            all = 0;
            break;
          }
        }
      }
      eroded[y * width + x] = all;
    }
  }
  const dilated = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let any = 0;
      for (let dy = -1; dy <= 1 && !any; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (eroded[(y + dy) * width + (x + dx)]) {
            any = 1;
            break;
          }
        }
      }
      dilated[y * width + x] = any;
    }
  }
  return dilated;
}

/**
 * Detect faces in an image.
 *
 * Returns the plausible face boxes, largest first. An empty result means the
 * detector found no region meeting the size/aspect/fill thresholds — a refusal
 * signal, not a pass.
 */
export function detectFaces(image: DecodedImage): FaceBox[] {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    mask[i] = isSkin(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
  }
  const cleaned = cleanMask(mask, width, height);

  const visited = new Uint8Array(width * height);
  const boxes: FaceBox[] = [];
  const stack: number[] = [];

  for (let start = 0; start < cleaned.length; start += 1) {
    if (!cleaned[start] || visited[start]) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // 4-connectivity keeps the component walk cheap.
      if (x > 0 && cleaned[index - 1] && !visited[index - 1]) {
        visited[index - 1] = 1;
        stack.push(index - 1);
      }
      if (x < width - 1 && cleaned[index + 1] && !visited[index + 1]) {
        visited[index + 1] = 1;
        stack.push(index + 1);
      }
      if (y > 0 && cleaned[index - width] && !visited[index - width]) {
        visited[index - width] = 1;
        stack.push(index - width);
      }
      if (y < height - 1 && cleaned[index + width] && !visited[index + width]) {
        visited[index + width] = 1;
        stack.push(index + width);
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const boxArea = boxWidth * boxHeight;
    const fill = boxArea > 0 ? area / boxArea : 0;
    const aspect = boxWidth / boxHeight;
    const imageFraction = area / (width * height);

    // A face is roughly as wide as tall, is a meaningful part of the frame, and
    // fills much of its bounding box (a bare arm or a wooden desk does not).
    if (aspect < 0.5 || aspect > 2.0) continue;
    if (imageFraction < 0.02) continue;
    if (fill < 0.5) continue;

    boxes.push({ x: minX, y: minY, width: boxWidth, height: boxHeight, fill });
  }

  boxes.sort((a, b) => b.width * b.height - a.width * a.height);
  return boxes;
}

/**
 * Describe a face region as a normalised luminance signature.
 *
 * The box is divided into a `DESCRIPTOR_SIZE` grid; each cell's mean luminance
 * forms one element, and the vector is normalised to zero mean and unit
 * variance so a difference in exposure does not by itself change the match.
 */
export function faceDescriptor(image: DecodedImage, box: FaceBox): Float32Array {
  const { width, height, data } = image;
  const values = new Float32Array(DESCRIPTOR_SIZE * DESCRIPTOR_SIZE);
  for (let gy = 0; gy < DESCRIPTOR_SIZE; gy += 1) {
    for (let gx = 0; gx < DESCRIPTOR_SIZE; gx += 1) {
      const x0 = box.x + Math.floor((gx * box.width) / DESCRIPTOR_SIZE);
      const x1 = box.x + Math.floor(((gx + 1) * box.width) / DESCRIPTOR_SIZE);
      const y0 = box.y + Math.floor((gy * box.height) / DESCRIPTOR_SIZE);
      const y1 = box.y + Math.floor(((gy + 1) * box.height) / DESCRIPTOR_SIZE);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y += 1) {
        for (let x = x0; x < x1 && x < width; x += 1) {
          const p = (y * width + x) * 4;
          sum += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
          count += 1;
        }
      }
      values[gy * DESCRIPTOR_SIZE + gx] = count > 0 ? sum / count : 0;
    }
  }

  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  const std = Math.sqrt(variance / values.length) || 1;
  for (let i = 0; i < values.length; i += 1) values[i] = (values[i] - mean) / std;
  return values;
}

/**
 * Similarity of two face descriptors, in [0, 1].
 *
 * 1 is a perfect match, 0 is no correlation. A negative correlation is clamped
 * to 0 because it carries no evidence of a match.
 */
export function compareFaces(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Face descriptors must have the same length');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return Math.max(0, dot / denominator);
}
