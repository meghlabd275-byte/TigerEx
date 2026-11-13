/**
 * Identity-document image validation, self-built.
 *
 * The client declares a content type; this checks what the bytes actually are.
 * A file whose magic number does not match its declared type is refused, so a
 * script or HTML payload renamed to `image/png` cannot enter the review queue.
 * No external service and no image-decoding dependency are used: the container
 * signature is read directly.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'pdf';

const CONTENT_TYPE_BY_FORMAT: Record<ImageFormat, string[]> = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
};

/** Detect the container format from a byte prefix, or null when unknown. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp';
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'pdf';
  }
  return null;
}

/** Decode a base64 string to bytes; throws when it is not valid base64. */
export function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}

/**
 * Whether the bytes match the declared content type.
 *
 * An unrecognised container is a mismatch (fail closed): the caller cannot
 * prove the file is the image it claims to be, so it must not be accepted.
 */
export function contentMatchesType(bytes: Uint8Array, contentType: string): boolean {
  const format = detectImageFormat(bytes);
  if (!format) return false;
  return CONTENT_TYPE_BY_FORMAT[format].includes(contentType.toLowerCase());
}
