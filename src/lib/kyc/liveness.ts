/**
 * Liveness assessment, self-built.
 *
 * A presentation attack (a printed photo or an image on a screen) is detectable
 * from signals the venue can compute itself:
 *
 *  - A real capture is sharp: a printed or re-photographed image loses
 *    high-frequency detail, so the variance of the Laplacian is low.
 *  - A live subject moves between frames: two frames of the same static photo
 *    are near-identical, while a person shifts slightly.
 *  - A live face fills a plausible part of the frame and is not clipped by the
 *    edge.
 *
 * Each check returns a named pass/fail with its measured value, so a reviewer
 * sees why a selfie was flagged. Nothing is asserted as "live" without a
 * measurement; a signal that cannot be computed fails closed.
 */

import type { DecodedImage } from '@/lib/kyc/png';
import type { FaceBox } from '@/lib/kyc/face';

export interface LivenessSignal {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
}

export interface LivenessResult {
  live: boolean;
  score: number;
  signals: LivenessSignal[];
}

/** Variance of the Laplacian over the face box, on a 0..255 luminance scale. */
export function sharpness(image: DecodedImage, box: FaceBox): number {
  const { width, height, data } = image;
  const lum = (x: number, y: number): number => {
    const p = (y * width + x) * 4;
    return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  };
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const x0 = Math.max(1, box.x);
  const y0 = Math.max(1, box.y);
  const x1 = Math.min(width - 1, box.x + box.width);
  const y1 = Math.min(height - 1, box.y + box.height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const laplacian =
        -4 * lum(x, y) + lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1);
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/**
 * Mean absolute luminance difference between two frames inside a box.
 *
 * Two captures of the same static scene differ by almost nothing; a live
 * subject, or a re-photographed screen that flickers, differs more. The value is
 * reported as-is so the reviewer can judge it against the threshold.
 */
export function frameMotion(a: DecodedImage, b: DecodedImage, box: FaceBox): number {
  if (a.width !== b.width || a.height !== b.height) return 0;
  const { width, data } = a;
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.width);
  const y1 = Math.min(a.height, box.y + box.height);
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = (y * width + x) * 4;
      const la = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      const lb = 0.299 * b.data[p] + 0.587 * b.data[p + 1] + 0.114 * b.data[p + 2];
      sum += Math.abs(la - lb);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

const MIN_FACE_FRACTION = 0.03;
const MAX_FACE_FRACTION = 0.85;
const MIN_SHARPNESS = 25;
const MIN_MOTION = 1.5;

/**
 * Assess liveness from one or more selfie frames.
 *
 * A single frame is judged on face presence, framing and sharpness. When two or
 * more frames are supplied, the frames must also differ (a static image
 * re-submitted as two frames does not count as movement).
 */
export function assessLiveness(frames: DecodedImage[], face: FaceBox | null): LivenessResult {
  const signals: LivenessSignal[] = [];

  if (!face) {
    return {
      live: false,
      score: 0,
      signals: [{ name: 'face_present', passed: false, value: 0, threshold: 1 }],
    };
  }

  const first = frames[0];
  const fraction = (face.width * face.height) / (first.width * first.height);
  signals.push({
    name: 'face_framing',
    passed: fraction >= MIN_FACE_FRACTION && fraction <= MAX_FACE_FRACTION,
    value: fraction,
    threshold: MIN_FACE_FRACTION,
  });

  const edgeMargin = 2;
  const touchesEdge =
    face.x <= edgeMargin ||
    face.y <= edgeMargin ||
    face.x + face.width >= first.width - edgeMargin ||
    face.y + face.height >= first.height - edgeMargin;
  signals.push({ name: 'face_inside_frame', passed: !touchesEdge, value: touchesEdge ? 1 : 0, threshold: 0 });

  const sharp = sharpness(first, face);
  signals.push({ name: 'sharpness', passed: sharp >= MIN_SHARPNESS, value: sharp, threshold: MIN_SHARPNESS });

  if (frames.length >= 2) {
    const motion = frameMotion(frames[0], frames[1], face);
    signals.push({ name: 'frame_motion', passed: motion >= MIN_MOTION, value: motion, threshold: MIN_MOTION });
  }

  const passed = signals.filter((signal) => signal.passed).length;
  const score = signals.length > 0 ? passed / signals.length : 0;
  return { live: signals.every((signal) => signal.passed), score, signals };
}
