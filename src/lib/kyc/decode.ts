/**
 * Image decode entrypoint, self-built.
 *
 * Picks the decoder from the container signature (never from a caller-supplied
 * content type) and returns RGBA pixels. A format the venue cannot decode is a
 * refusal, not a pass, so a document that arrives in an unexpected container is
 * held rather than silently skipped.
 */

import { decodePng, isPng, ImageDecodeError, type DecodedImage } from '@/lib/kyc/png';
import { decodeJpeg } from '@/lib/kyc/jpeg';

export type { DecodedImage };
export { ImageDecodeError };

export type DecodedFormat = 'png' | 'jpeg';

/** Detect the decodable format from the bytes, or null when unsupported. */
export function detectDecodableFormat(bytes: Uint8Array): DecodedFormat | null {
  if (isPng(bytes)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/**
 * Decode an image to RGBA pixels.
 *
 * Throws `ImageDecodeError` for an unsupported or malformed container, so the
 * caller can refuse the upload with a precise reason.
 */
export function decodeImage(bytes: Uint8Array): DecodedImage {
  const format = detectDecodableFormat(bytes);
  if (format === 'png') return decodePng(bytes);
  if (format === 'jpeg') return decodeJpeg(bytes);
  throw new ImageDecodeError('The image is not a PNG or JPEG the venue can decode');
}

/** Downscale to a bounded working size so downstream analysis is deterministic. */
export function downscale(image: DecodedImage, maxEdge: number): DecodedImage {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  if (width === image.width && height === image.height) return image;

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      out[dst] = image.data[src];
      out[dst + 1] = image.data[src + 1];
      out[dst + 2] = image.data[src + 2];
      out[dst + 3] = image.data[src + 3];
    }
  }
  return { width, height, data: out };
}
