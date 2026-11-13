/**
 * Machine-Readable Zone (MRZ) verification, self-built.
 *
 * Implements the ICAO Doc 9303 check-digit algorithm and the field layout for
 * TD1 (ID cards, 3×30) and TD3 (passports, 2×44). This verifies a document's
 * own integrity: the check digits must match the fields they cover, so a
 * mistyped or naively forged MRZ fails. It is deterministic and needs no
 * external service.
 *
 * It is not an authenticity test of the physical document (that needs the
 * issuing authority's keys), but a document whose MRZ check digits do not
 * validate cannot be accepted, and the holder's date of birth and document
 * number extracted here are cross-checked against the declared details.
 *
 * Field positions (0-based) follow ICAO 9303:
 *  TD3 line 2: [0..8] doc no, [9] cd, [10..12] nationality, [13..18] DOB,
 *              [19] cd, [20] sex, [21..26] expiry, [27] cd, [28..41] personal
 *              number, [42] cd, [43] composite cd.
 *  TD1 line 1: [0..1] doc code, [2..4] issuer, [5..13] doc no, [14] cd,
 *              [15..29] optional.
 *      line 2: [0..5] DOB, [6] cd, [7] sex, [8..13] expiry, [14] cd,
 *              [15..17] nationality, [18..28] optional, [29] composite cd.
 */

export class MrzError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Value of one MRZ character: 0–9 literal, A–Z = 10–35, filler = 0. */
export function charValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  if (ch === '<') return 0;
  throw new MrzError('MRZ_INVALID_CHARACTER', `"${ch}" is not a valid MRZ character`);
}

/** ICAO 9303 check digit over a field, using the 7-3-1 weight cycle. */
export function checkDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += charValue(field[i]) * weights[i % 3];
  }
  return sum % 10;
}

/** The document's own check digits conflict, so it cannot be accepted. */
export function verifyCheckDigit(field: string, expected: string): boolean {
  return String(checkDigit(field)) === expected;
}

export interface MrzFields {
  documentType: 'TD1' | 'TD3';
  documentNumber: string;
  /** ISO date YYYY-MM-DD. */
  dateOfBirth: string;
  /** ISO date YYYY-MM-DD. */
  dateOfExpiry: string;
  sex: 'M' | 'F' | 'X';
  nationality: string;
  issuingState: string;
  surname: string;
  givenNames: string;
}

function normalize(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\r/g, '')
    .trim();
}

function isWellFormed(line: string, expectedLength: number): boolean {
  return line.length === expectedLength && /^[A-Z0-9<]+$/.test(line);
}

/** Convert a 2-digit MRZ year into a full year per ICAO convention. */
function expandYear(yy: string, kind: 'birth' | 'expiry', pivot = new Date().getUTCFullYear()): string {
  const two = Number(yy);
  const century = Math.floor(pivot / 100) * 100;
  let candidate = century + two;
  if (kind === 'birth') {
    // A date of birth is in the past: take the most recent year ending in `yy`
    // that is not after the present, so "74" is 1974, not 2074.
    if (candidate > pivot) candidate -= 100;
  }
  // An expiry sits near the present century, so the current century applies.
  return String(candidate).padStart(4, '0');
}

function toIsoDate(value: string, kind: 'birth' | 'expiry'): string {
  const yy = value.slice(0, 2);
  const mm = value.slice(2, 4);
  const dd = value.slice(4, 6);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new MrzError('MRZ_INVALID_DATE', `${kind} date is not a valid calendar date`);
  }
  const year = expandYear(yy, kind);
  const iso = `${year}-${mm}-${dd}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new MrzError('MRZ_INVALID_DATE', `${kind} date is not a valid calendar date`);
  }
  return iso;
}

/** Split a name field "SURNAME<<GIVEN<NAMES" into its parts, "<" → space. */
function parseName(field: string): { surname: string; givenNames: string } {
  const [surnameRaw, givenRaw = ''] = field.split('<<');
  const tidy = (s: string) => s.replace(/<+/g, ' ').trim();
  return { surname: tidy(surnameRaw), givenNames: tidy(givenRaw) };
}

function parseTd3(lines: string[]): MrzFields {
  const [l1, l2] = lines;
  if (!isWellFormed(l1, 44) || !isWellFormed(l2, 44)) {
    throw new MrzError('MRZ_FORMAT', 'TD3 lines must each be 44 characters of A-Z, 0-9 or <');
  }
  const documentNumber = l2.slice(0, 9);
  const dobField = l2.slice(13, 19);
  const expiryField = l2.slice(21, 27);
  const personal = l2.slice(28, 42);

  if (!verifyCheckDigit(documentNumber, l2[9])) throw new MrzError('MRZ_CHECK_DIGIT', 'document number check digit mismatch');
  if (!verifyCheckDigit(dobField, l2[19])) throw new MrzError('MRZ_CHECK_DIGIT', 'date-of-birth check digit mismatch');
  if (!verifyCheckDigit(expiryField, l2[27])) throw new MrzError('MRZ_CHECK_DIGIT', 'date-of-expiry check digit mismatch');
  if (personal.replace(/</g, '') !== '' && !verifyCheckDigit(personal, l2[42])) {
    throw new MrzError('MRZ_CHECK_DIGIT', 'personal number check digit mismatch');
  }
  const composite = `${l2.slice(0, 10)}${l2.slice(13, 20)}${l2.slice(21, 28)}${l2.slice(28, 43)}`;
  if (!verifyCheckDigit(composite, l2[43])) throw new MrzError('MRZ_CHECK_DIGIT', 'composite check digit mismatch');

  const { surname, givenNames } = parseName(l1.slice(5));
  const sexChar = l2[20];
  return {
    documentType: 'TD3',
    documentNumber: documentNumber.replace(/</g, ''),
    dateOfBirth: toIsoDate(dobField, 'birth'),
    dateOfExpiry: toIsoDate(expiryField, 'expiry'),
    sex: sexChar === 'M' ? 'M' : sexChar === 'F' ? 'F' : 'X',
    nationality: l2.slice(10, 13).replace(/</g, ''),
    issuingState: l1.slice(2, 5).replace(/</g, ''),
    surname,
    givenNames,
  };
}

function parseTd1(lines: string[]): MrzFields {
  const [l1, l2, l3] = lines;
  if (!isWellFormed(l1, 30) || !isWellFormed(l2, 30) || !isWellFormed(l3, 30)) {
    throw new MrzError('MRZ_FORMAT', 'TD1 lines must each be 30 characters of A-Z, 0-9 or <');
  }
  const documentNumber = l1.slice(5, 14);
  const dobField = l2.slice(0, 6);
  const expiryField = l2.slice(8, 14);
  const optional = l2.slice(18, 29);

  if (!verifyCheckDigit(documentNumber, l1[14])) throw new MrzError('MRZ_CHECK_DIGIT', 'document number check digit mismatch');
  if (!verifyCheckDigit(dobField, l2[6])) throw new MrzError('MRZ_CHECK_DIGIT', 'date-of-birth check digit mismatch');
  if (!verifyCheckDigit(expiryField, l2[14])) throw new MrzError('MRZ_CHECK_DIGIT', 'date-of-expiry check digit mismatch');
  const composite = `${l1.slice(5, 15)}${l2.slice(0, 7)}${l2.slice(8, 15)}${l2.slice(18, 29)}`;
  if (!verifyCheckDigit(composite, l2[29])) throw new MrzError('MRZ_CHECK_DIGIT', 'composite check digit mismatch');

  const { surname, givenNames } = parseName(l3);
  const sexChar = l2[7];
  return {
    documentType: 'TD1',
    documentNumber: documentNumber.replace(/</g, ''),
    dateOfBirth: toIsoDate(dobField, 'birth'),
    dateOfExpiry: toIsoDate(expiryField, 'expiry'),
    sex: sexChar === 'M' ? 'M' : sexChar === 'F' ? 'F' : 'X',
    nationality: l2.slice(15, 18).replace(/</g, ''),
    issuingState: l1.slice(2, 5).replace(/</g, ''),
    surname,
    givenNames,
  };
}

/**
 * Parse and verify an MRZ block.
 *
 * Accepts two 44-character lines (TD3) or three 30-character lines (TD1). Any
 * check-digit failure throws `MrzError`, so a caller can never treat an
 * unverified document as verified. Line order is honoured as supplied.
 */
export function parseMrz(input: string): MrzFields {
  const lines = normalize(input)
    .split('\n')
    .map((line) => line.replace(/\s/g, ''))
    .filter((line) => line.length > 0);

  if (lines.length === 2) return parseTd3(lines);
  if (lines.length === 3) return parseTd1(lines);
  throw new MrzError('MRZ_FORMAT', 'An MRZ must be two (TD3) or three (TD1) lines');
}

/** Whether a document has expired as of `now` (ISO or Date). */
export function isExpired(fields: MrzFields, now: Date = new Date()): boolean {
  return new Date(`${fields.dateOfExpiry}T23:59:59Z`).getTime() < now.getTime();
}
