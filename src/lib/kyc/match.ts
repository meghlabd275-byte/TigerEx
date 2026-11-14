/**
 * Document-to-selfie face comparison, self-built.
 *
 * The portrait on an identity document and the applicant's selfie are each
 * detected and described, then compared. The result is a similarity in [0, 1]
 * reported with its threshold, so the reviewer sees the number rather than a
 * verdict pulled from nowhere.
 *
 * A document whose portrait cannot be detected is reported as such — the check
 * is skipped and flagged, never silently passed.
 */

import type { DecodedImage } from '@/lib/kyc/png';
import { detectFaces, faceDescriptor, compareFaces } from '@/lib/kyc/face';

/** Similarity at or above which two faces are considered a likely match. */
export const FACE_MATCH_THRESHOLD = 0.5;

export interface FaceMatchResult {
  /** The document portrait was located. */
  documentFaceFound: boolean;
  /** A face was located in the selfie. */
  selfieFaceFound: boolean;
  /** Cosine similarity of the two descriptors, or null when not comparable. */
  similarity: number | null;
  matched: boolean;
}

/**
 * Compare the portrait on a document with a selfie.
 *
 * Returns a structured result; `matched` is only true when both faces were found
 * and their similarity meets the threshold. Anything else is a non-match that
 * the reviewer must resolve.
 */
export function matchDocumentToSelfie(document: DecodedImage, selfie: DecodedImage): FaceMatchResult {
  const documentFaces = detectFaces(document);
  const selfieFaces = detectFaces(selfie);

  const documentFace = documentFaces[0] ?? null;
  const selfieFace = selfieFaces[0] ?? null;

  if (!documentFace || !selfieFace) {
    return {
      documentFaceFound: documentFace !== null,
      selfieFaceFound: selfieFace !== null,
      similarity: null,
      matched: false,
    };
  }

  const similarity = compareFaces(faceDescriptor(document, documentFace), faceDescriptor(selfie, selfieFace));
  return {
    documentFaceFound: true,
    selfieFaceFound: true,
    similarity,
    matched: similarity >= FACE_MATCH_THRESHOLD,
  };
}
