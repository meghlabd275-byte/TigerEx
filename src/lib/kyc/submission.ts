/**
 * KYC application intake.
 *
 * An applicant supplies identity details and document images. The details and
 * the images are encrypted before they are stored, and images are never
 * returned inline. A submission is only accepted once a code proving control of
 * the applicant's email or phone has been verified, so the flow cannot be run
 * against someone else's address.
 *
 * Nothing here decides an outcome: the application is held for a human reviewer
 * and approval is an administrative action.
 */

import { getDb, generateId, encrypt } from '@/lib/db';
import { isOtpVerified } from '@/lib/security/otp';
import { parseMrz, isExpired, MrzError, type MrzFields } from '@/lib/kyc/mrz';

export class KycError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type DocumentKind = 'front' | 'back' | 'selfie';
export type DocumentType = 'passport' | 'national_id' | 'drivers_license';

const DOCUMENT_TYPES: DocumentType[] = ['passport', 'national_id', 'drivers_license'];
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Minimum age, in whole years, at which an account may complete KYC. */
const MIN_AGE = 18;

export interface SubmittedDocument {
  kind: DocumentKind;
  contentType: string;
  /** Base64 of the raw file, without a data-URL prefix. */
  data: string;
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  address: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

export interface SubmitInput {
  personalInfo: unknown;
  documentType: unknown;
  documents: unknown;
  /** The document's machine-readable zone, when the client could read one. */
  mrz?: unknown;
}

/**
 * Verify a supplied MRZ against the declared details.
 *
 * A submission that supplies an MRZ is held to it: the check digits must pass,
 * the document must not be expired, and the date of birth must match what the
 * applicant declared. Supplying no MRZ is allowed (the document then rests on
 * manual review), but supplying one that does not validate is refused — an
 * unreadable MRZ on a document that has one is a forgery signal, not a reason
 * to fall back to a human.
 */
export function verifyMrzForSubmission(raw: unknown, dateOfBirth: string): MrzFields | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  let fields: MrzFields;
  try {
    fields = parseMrz(text);
  } catch (error) {
    if (error instanceof MrzError) {
      throw new KycError(error.code, `Document MRZ failed verification: ${error.message}`);
    }
    throw error;
  }

  if (isExpired(fields)) {
    throw new KycError('DOCUMENT_EXPIRED', 'The identity document has expired');
  }
  if (fields.dateOfBirth !== dateOfBirth) {
    throw new KycError('MRZ_MISMATCH', 'The MRZ date of birth does not match the declared date of birth');
  }
  return fields;
}

function requireText(value: unknown, field: string, max = 128): string {
  const text = String(value ?? '').trim();
  if (!text) throw new KycError('VALIDATION_FAILED', `${field} is required`);
  if (text.length > max) throw new KycError('VALIDATION_FAILED', `${field} is too long`);
  return text;
}

function parsePersonalInfo(raw: unknown): PersonalInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new KycError('VALIDATION_FAILED', 'Personal information is required');
  }
  const info = raw as Record<string, unknown>;

  const dateOfBirth = requireText(info.dateOfBirth, 'dateOfBirth', 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    throw new KycError('VALIDATION_FAILED', 'dateOfBirth must be an ISO date (YYYY-MM-DD)');
  }
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || born.getTime() > Date.now()) {
    throw new KycError('VALIDATION_FAILED', 'dateOfBirth is not a valid past date');
  }
  const age = (Date.now() - born.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < MIN_AGE) {
    throw new KycError('UNDERAGE', `An applicant must be at least ${MIN_AGE} years old`);
  }

  const country = requireText(info.country, 'country', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new KycError('VALIDATION_FAILED', 'country must be a two-letter ISO code');
  }

  return {
    firstName: requireText(info.firstName, 'firstName', 64),
    lastName: requireText(info.lastName, 'lastName', 64),
    dateOfBirth,
    address: requireText(info.address, 'address', 256),
    city: requireText(info.city, 'city', 64),
    state: info.state === undefined || info.state === null ? undefined : requireText(info.state, 'state', 64),
    postalCode:
      info.postalCode === undefined || info.postalCode === null
        ? undefined
        : requireText(info.postalCode, 'postalCode', 32),
    country,
  };
}

function parseDocuments(raw: unknown, documentType: DocumentType): SubmittedDocument[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new KycError('VALIDATION_FAILED', 'At least one document image is required');
  }

  const documents: SubmittedDocument[] = [];
  const seen = new Set<DocumentKind>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new KycError('VALIDATION_FAILED', 'Each document must be an object');
    }
    const doc = entry as Record<string, unknown>;
    const kind = String(doc.kind ?? '').trim() as DocumentKind;
    if (kind !== 'front' && kind !== 'back' && kind !== 'selfie') {
      throw new KycError('VALIDATION_FAILED', 'Document kind must be front, back or selfie');
    }
    if (seen.has(kind)) {
      throw new KycError('VALIDATION_FAILED', `Duplicate ${kind} document`);
    }

    const contentType = String(doc.contentType ?? '').trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new KycError('UNSUPPORTED_DOCUMENT', 'Documents must be JPEG, PNG, WebP or PDF');
    }

    const data = String(doc.data ?? '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new KycError('VALIDATION_FAILED', `${kind} document is not valid base64`);
    }
    // Four base64 characters encode three bytes; padding is not data.
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    const byteLength = (data.length / 4) * 3 - padding;
    if (byteLength <= 0) throw new KycError('VALIDATION_FAILED', `${kind} document is empty`);
    if (byteLength > MAX_DOCUMENT_BYTES) {
      throw new KycError('DOCUMENT_TOO_LARGE', `${kind} document exceeds 10 MB`);
    }

    seen.add(kind);
    documents.push({ kind, contentType, data });
  }

  if (!seen.has('front')) throw new KycError('VALIDATION_FAILED', 'The front of the document is required');
  if (documentType !== 'passport' && !seen.has('back')) {
    throw new KycError('VALIDATION_FAILED', 'The back of the document is required for this document type');
  }
  if (!seen.has('selfie')) {
    throw new KycError('VALIDATION_FAILED', 'A selfie holding the document is required');
  }

  return documents;
}

/**
 * Submit a KYC application for review.
 *
 * Refused unless a code was verified for the applicant's own email or phone,
 * the details are complete and plausible, and the required images are present
 * and within limits. A resubmission supersedes the earlier attempt rather than
 * stacking rows.
 */
export function submitApplication(userId: string, input: SubmitInput): { status: string; documents: number } {
  const db = getDb();
  const user = db.prepare('SELECT user_id, email, phone, kyc_status FROM users WHERE user_id = ?').get(userId) as
    | { user_id: string; email: string | null; phone: string | null; kyc_status: string }
    | undefined;
  if (!user) throw new KycError('NOT_FOUND', 'Account not found', 404);
  if (user.kyc_status === 'approved') {
    throw new KycError('ALREADY_VERIFIED', 'This account is already verified', 409);
  }

  const verified =
    (user.email ? isOtpVerified('email_verify', { email: user.email }) : false) ||
    (user.phone ? isOtpVerified('phone_verify', { phone: user.phone }) : false);
  if (!verified) {
    throw new KycError('IDENTITY_NOT_VERIFIED', 'Verify your email or phone before submitting KYC', 403);
  }

  const documentType = String(input.documentType ?? '').trim() as DocumentType;
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw new KycError('VALIDATION_FAILED', 'documentType must be passport, national_id or drivers_license');
  }

  const personal = parsePersonalInfo(input.personalInfo);
  const documents = parseDocuments(input.documents, documentType);
  const mrz = verifyMrzForSubmission(input.mrz, personal.dateOfBirth);

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM kyc_documents WHERE user_id = ? AND status IN ('pending', 'rejected')").run(userId);

    const front = documents.find((doc) => doc.kind === 'front');
    const back = documents.find((doc) => doc.kind === 'back');
    const selfie = documents.find((doc) => doc.kind === 'selfie');
    db.prepare(
      `INSERT INTO kyc_documents
         (document_id, user_id, document_type, document_number, front_image, back_image, selfie_image,
          mrz_verified, mrz_data, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    ).run(
      generateId(),
      userId,
      documentType,
      mrz ? mrz.documentNumber : null,
      front ? encrypt(front.data) : null,
      back ? encrypt(back.data) : null,
      selfie ? encrypt(selfie.data) : null,
      mrz ? 1 : 0,
      mrz ? encrypt(JSON.stringify(mrz)) : null,
    );

    db.prepare(
      `UPDATE users
          SET kyc_status = 'pending', kyc_submitted_at = ?, kyc_rejection_reason = NULL,
              kyc_personal_encrypted = ?, updated_at = datetime('now')
        WHERE user_id = ?`,
    ).run(now, encrypt(JSON.stringify(personal)), userId);
  })();

  return { status: 'pending', documents: documents.length };
}

/** The applicant's own KYC state, without any document contents. */
export function applicationStatus(userId: string): Record<string, unknown> {
  const db = getDb();
  const user = db
    .prepare(
      `SELECT kyc_level, kyc_status, kyc_submitted_at, kyc_verified_at, kyc_rejection_reason
         FROM users WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        kyc_level: string | null;
        kyc_status: string | null;
        kyc_submitted_at: string | null;
        kyc_verified_at: string | null;
        kyc_rejection_reason: string | null;
      }
    | undefined;
  if (!user) throw new KycError('NOT_FOUND', 'Account not found', 404);

  const documents = db
    .prepare('SELECT document_type, status, created_at, mrz_verified FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Array<{ document_type: string; status: string; created_at: string; mrz_verified: number | null }>;

  return {
    level: user.kyc_level === 'none' || user.kyc_level === null ? 0 : Number(user.kyc_level) || 0,
    status: user.kyc_status ?? 'pending',
    submittedAt: user.kyc_submitted_at,
    verifiedAt: user.kyc_verified_at,
    rejectionReason: user.kyc_rejection_reason,
    documents: documents.map((doc) => ({
      type: doc.document_type,
      status: doc.status,
      submittedAt: doc.created_at,
      mrzVerified: doc.mrz_verified === 1,
    })),
  };
}
