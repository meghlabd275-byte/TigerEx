/**
 * Automated identity checks, self-built.
 *
 * Runs the in-house detectors over an application's own images and returns a
 * structured result: whether a portrait was found on the document and in the
 * selfie, how similar the two faces are, and the liveness signals from the
 * selfie. No external provider and no third-party model are consulted — every
 * number comes from pixels the applicant uploaded.
 *
 * Nothing here decides an outcome on its own. The result is recorded on the
 * application so a human reviewer sees the evidence, and a deployment can opt
 * into refusing a submission outright with `TIGEREX_KYC_REQUIRE_LIVENESS`.
 */

import { decodeImage, ImageDecodeError } from '@/lib/kyc/decode';
import { detectFaces, type FaceBox } from '@/lib/kyc/face';
import { assessLiveness, type LivenessResult } from '@/lib/kyc/liveness';
import { matchDocumentToSelfie, FACE_MATCH_THRESHOLD } from '@/lib/kyc/match';

export interface IdentityCheckResult {
  /** At least one image was decodable, so a check actually ran. */
  analysed: boolean;
  documentFaceFound: boolean;
  selfieFaceFound: boolean;
  /** Cosine similarity of the two portraits, or null when not comparable. */
  faceSimilarity: number | null;
  faceMatched: boolean;
  /** The match threshold the similarity was compared against. */
  faceMatchThreshold: number;
  /** The selfie liveness assessment, or null when the selfie was not decodable. */
  liveness: LivenessResult | null;
  /** Human-readable reasons a check could not run (never a silent pass). */
  notes: string[];
}

/** Decode a base64 image, returning null and a note when it cannot be read. */
function tryDecode(base64: string, label: string, notes: string[]): ReturnType<typeof decodeImage> | null {
  try {
    return decodeImage(new Uint8Array(Buffer.from(base64, 'base64')));
  } catch (error) {
    if (error instanceof ImageDecodeError) {
      notes.push(`${label} could not be analysed: ${error.message}`);
      return null;
    }
    throw error;
  }
}

/**
 * Run every in-house identity check over the supplied images.
 *
 * `documentFront` and `selfie` are base64 (no data-URL prefix). `extraFrames`
 * are optional additional selfie frames used for the motion check.
 */
export function runIdentityChecks(input: {
  documentFront: string;
  selfie: string;
  extraFrames?: string[];
}): IdentityCheckResult {
  const notes: string[] = [];
  const document = tryDecode(input.documentFront, 'The document image', notes);
  const selfieFrames = [input.selfie, ...(input.extraFrames ?? [])]
    .map((frame, index) => tryDecode(frame, index === 0 ? 'The selfie' : `Selfie frame ${index + 1}`, notes))
    .filter((frame): frame is NonNullable<typeof frame> => frame !== null);

  if (!document && selfieFrames.length === 0) {
    return {
      analysed: false,
      documentFaceFound: false,
      selfieFaceFound: false,
      faceSimilarity: null,
      faceMatched: false,
      faceMatchThreshold: FACE_MATCH_THRESHOLD,
      liveness: null,
      notes,
    };
  }

  const selfie = selfieFrames[0] ?? null;
  const selfieFace: FaceBox | null = selfie ? detectFaces(selfie)[0] ?? null : null;

  let documentFaceFound = false;
  let faceSimilarity: number | null = null;
  let faceMatched = false;
  if (document && selfie) {
    const match = matchDocumentToSelfie(document, selfie);
    documentFaceFound = match.documentFaceFound;
    faceSimilarity = match.similarity;
    faceMatched = match.matched;
    if (!match.documentFaceFound) notes.push('No portrait was located on the document image');
  }

  const liveness = selfie ? assessLiveness(selfieFrames, selfieFace) : null;

  return {
    analysed: true,
    documentFaceFound,
    selfieFaceFound: selfieFace !== null,
    faceSimilarity,
    faceMatched,
    faceMatchThreshold: FACE_MATCH_THRESHOLD,
    liveness,
    notes,
  };
}
