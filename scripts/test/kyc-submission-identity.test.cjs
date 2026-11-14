'use strict';
/**
 * KYC submission integration tests for the in-house identity checks.
 *
 * A real database is seeded and a real application is submitted with real PNG
 * bytes. The checks run over the applicant's own images and the result is
 * recorded encrypted on the document row — the submission path must not silently
 * pass a submission whose selfie fails liveness when the deployment opts in.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-kycid-')), 'kyc.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword, decrypt } = require('../../.test-build/index.js');
const { submitApplication, KycError } = require('../../.test-build/submission.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'kyc');
const b64 = (name) => fs.readFileSync(path.join(FIXTURES, name)).toString('base64');

const db = getDb();

function seedVerifiedUser() {
  const userId = generateId();
  const email = `${userId}@example.com`;
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, status, email_verified, kyc_status)
     VALUES (?, ?, ?, 'active', 1, 'none')`,
  ).run(userId, email, hashPassword('password123'));
  db.prepare(
    `INSERT INTO otp_codes (otp_id, user_id, email, code, type, purpose, expires_at, verified_at)
     VALUES (?, ?, ?, 'digest', 'numeric', 'email_verify', datetime('now', '+1 hour'), datetime('now'))`,
  ).run(generateId(), userId, email);
  return { userId, email };
}

function documents() {
  return [
    { kind: 'front', contentType: 'image/png', data: b64('doc_face.png') },
    { kind: 'back', contentType: 'image/png', data: b64('no_face.png') },
    { kind: 'selfie', contentType: 'image/png', data: b64('selfie_face.png') },
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

test('a submission records an encrypted identity-check result', () => {
  const { userId } = seedVerifiedUser();
  const result = submitApplication(userId, {
    personalInfo: PERSONAL,
    documentType: 'passport',
    documents: documents(),
  });
  assert.equal(result.status, 'pending');
  assert.ok(result.identity, 'the checks ran');
  assert.equal(result.identity.analysed, true);
  assert.equal(result.identity.selfieFaceFound, true);

  const row = db.prepare('SELECT identity_checks FROM kyc_documents WHERE user_id = ?').get(userId);
  assert.ok(row.identity_checks, 'the result is stored');
  assert.ok(!String(row.identity_checks).includes('faceSimilarity'), 'the blob is not stored in plaintext');
  const decoded = JSON.parse(decrypt(row.identity_checks));
  assert.equal(decoded.analysed, true);
  assert.equal(typeof decoded.faceMatched, 'boolean');
});

test('a blurred selfie is refused when liveness is required', () => {
  const { userId } = seedVerifiedUser();
  const docs = documents();
  docs[2] = { kind: 'selfie', contentType: 'image/png', data: b64('selfie_blurred.png') };
  process.env.TIGEREX_KYC_REQUIRE_LIVENESS = '1';
  try {
    assert.throws(
      () => submitApplication(userId, { personalInfo: PERSONAL, documentType: 'passport', documents: docs }),
      (error) => error instanceof KycError && error.code === 'LIVENESS_CHECK_FAILED',
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kyc_documents WHERE user_id = ?').get(userId).n, 0);
  } finally {
    delete process.env.TIGEREX_KYC_REQUIRE_LIVENESS;
  }
});

test('without the liveness flag a blurred selfie still reaches manual review', () => {
  const { userId } = seedVerifiedUser();
  const docs = documents();
  docs[2] = { kind: 'selfie', contentType: 'image/png', data: b64('selfie_blurred.png') };
  const result = submitApplication(userId, { personalInfo: PERSONAL, documentType: 'passport', documents: docs });
  assert.equal(result.status, 'pending');
  assert.equal(result.identity.liveness.live, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kyc_documents WHERE user_id = ?').get(userId).n, 1);
});
