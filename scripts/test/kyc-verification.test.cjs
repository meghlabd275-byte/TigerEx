'use strict';
/**
 * KYC MRZ-verification integration tests against a real database.
 *
 * The submission path must refuse a document whose MRZ check digits do not
 * validate, an expired document, or an MRZ whose date of birth disagrees with
 * the declared one — and must accept a valid MRZ, recording that it was
 * verified rather than leaving the reviewer to assume it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-kyc-')), 'kyc.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { checkDigit } = require('../../.test-build/mrz.js');
const { submitApplication, applicationStatus, KycError } = require('../../.test-build/submission.js');

const db = getDb();

/** Build a TD3 passport MRZ with every check digit computed, so it is valid. */
function buildTd3({ docNo, nationality, dob, sex, expiry, personal }) {
  const cdDoc = checkDigit(docNo);
  const cdDob = checkDigit(dob);
  const cdExp = checkDigit(expiry);
  const cdPersonal = checkDigit(personal);
  const composite = `${docNo}${cdDoc}${dob}${cdDob}${expiry}${cdExp}${personal}${cdPersonal}`;
  const line2 = `${docNo}${cdDoc}${nationality}${dob}${cdDob}${sex}${expiry}${cdExp}${personal}${cdPersonal}${checkDigit(composite)}`;
  const line1 = `P<UTO${'ERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'.slice(0, 39)}`;
  assert.equal(line1.length, 44);
  assert.equal(line2.length, 44);
  return `${line1}\n${line2}`;
}

// Valid, unexpired (expires 2030-04-15), birth date 1974-08-12.
const VALID = buildTd3({ docNo: 'L898902C3', nationality: 'UTO', dob: '740812', sex: 'F', expiry: '300415', personal: 'ZE184226B<<<<<' });
// The same document, expired 2012-04-15.
const EXPIRED = buildTd3({ docNo: 'L898902C3', nationality: 'UTO', dob: '740812', sex: 'F', expiry: '120415', personal: 'ZE184226B<<<<<' });

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function seedVerifiedUser() {
  const userId = generateId();
  const email = `${userId}@example.com`;
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status, email_verified, kyc_status)
     VALUES (?, ?, ?, 'active', 1, 'none')`,
  ).run(userId, email, hashPassword('password123'));
  // The submission path requires a verified email/phone code. Record one the
  // same way the verify route does, so the test exercises the real gate.
  db.prepare(
    `INSERT INTO otp_codes (otp_id, user_id, email, code, type, purpose, expires_at, verified_at)
     VALUES (?, ?, ?, 'digest', 'numeric', 'email_verify', datetime('now', '+1 hour'), datetime('now'))`,
  ).run(generateId(), userId, email);
  return { userId, email };
}

function docs() {
  return [
    { kind: 'front', contentType: 'image/png', data: ONE_PIXEL_PNG },
    { kind: 'back', contentType: 'image/png', data: ONE_PIXEL_PNG },
    { kind: 'selfie', contentType: 'image/png', data: ONE_PIXEL_PNG },
  ];
}

const PERSONAL = {
  firstName: 'Anna',
  lastName: 'Eriksson',
  dateOfBirth: '1974-08-12',
  address: '1 Example Street',
  city: 'Zurich',
  country: 'CH',
};

test('a valid MRZ is verified and recorded as such', () => {
  const { userId } = seedVerifiedUser();
  const result = submitApplication(userId, {
    personalInfo: PERSONAL,
    documentType: 'passport',
    documents: docs(),
    mrz: VALID,
  });
  assert.equal(result.status, 'pending');

  const status = applicationStatus(userId);
  assert.equal(status.documents[0].mrzVerified, true);

  const row = db.prepare('SELECT mrz_verified, document_number, mrz_data FROM kyc_documents WHERE user_id = ?').get(userId);
  assert.equal(row.mrz_verified, 1);
  assert.equal(row.document_number, 'L898902C3');
  assert.ok(row.mrz_data, 'the verified MRZ is stored encrypted');
  assert.ok(!String(row.mrz_data).includes('ERIKSSON'), 'the MRZ is not stored in plaintext');
});

test('a tampered MRZ is refused and no document row is written', () => {
  const { userId } = seedVerifiedUser();
  const tampered = VALID.replace('L898902C36', 'L898902C99');
  assert.throws(
    () => submitApplication(userId, { personalInfo: PERSONAL, documentType: 'passport', documents: docs(), mrz: tampered }),
    (e) => e instanceof KycError && e.code === 'MRZ_CHECK_DIGIT',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kyc_documents WHERE user_id = ?').get(userId).n, 0);
});

test('an expired document is refused', () => {
  const { userId } = seedVerifiedUser();
  assert.throws(
    () => submitApplication(userId, { personalInfo: PERSONAL, documentType: 'passport', documents: docs(), mrz: EXPIRED }),
    (e) => e instanceof KycError && e.code === 'DOCUMENT_EXPIRED',
  );
});

test('an MRZ whose date of birth disagrees with the declared one is refused', () => {
  const { userId } = seedVerifiedUser();
  const otherDob = buildTd3({ docNo: 'L898902C3', nationality: 'UTO', dob: '750812', sex: 'F', expiry: '300415', personal: 'ZE184226B<<<<<' });
  assert.throws(
    () => submitApplication(userId, { personalInfo: PERSONAL, documentType: 'passport', documents: docs(), mrz: otherDob }),
    (e) => e instanceof KycError && e.code === 'MRZ_MISMATCH',
  );
});

test('a submission without an MRZ still reaches manual review', () => {
  const { userId } = seedVerifiedUser();
  const result = submitApplication(userId, {
    personalInfo: PERSONAL,
    documentType: 'passport',
    documents: docs(),
  });
  assert.equal(result.status, 'pending');
  const row = db.prepare('SELECT mrz_verified FROM kyc_documents WHERE user_id = ?').get(userId);
  assert.equal(row.mrz_verified, 0);
});
