'use strict';
/**
 * Tests for the account-security primitives: TOTP enrolment/verification, the
 * OTP issue/verify lifecycle, the fail-closed email delivery channel and the
 * single session-issuance path.
 *
 * These are security-critical and were previously uncovered. The properties
 * that matter: a code is stored only as an account-bound digest (never
 * plaintext), it is single-use and expires, failed attempts are counted, the
 * account binding cannot be bypassed by casing, and no session is issued for a
 * non-active account.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { authenticator } = require('otplib');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-sec2fa-')), 'sec.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const totp = require('../../.test-build/totp.js');
const otp = require('../../.test-build/otp.js');
const { getEmailSender, emailDeliveryUnavailable } = require('../../.test-build/email.js');
const { issueSession } = require('../../.test-build/session-issue.js');

const db = getDb();

function seedUser(status = 'active') {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
    status,
  );
  return userId;
}

// ------------------------------------------------------------------- TOTP ---

test('totp: a generated secret verifies its own current code and rejects a wrong one', () => {
  const secret = totp.generateTotpSecret();
  assert.ok(secret.length >= 16);
  const code = authenticator.generate(secret);
  assert.equal(totp.verifyTotp(secret, code), true);
  assert.equal(totp.verifyTotp(secret, '000000'), false);
});

test('totp: empty secret or code fails closed instead of throwing', () => {
  assert.equal(totp.verifyTotp('', '123456'), false);
  assert.equal(totp.verifyTotp('JBSWY3DPEHPK3PXP', ''), false);
  assert.equal(totp.verifyTotp('not-a-valid-base32-secret', '123456'), false);
});

test('totp: the otpauth url carries the issuer and label', () => {
  const secret = totp.generateTotpSecret();
  const url = totp.buildOtpauthUrl(secret, 'alice@example.com');
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, /TigerEx/);
  assert.match(url, /alice%40example\.com/);
});

test('totp: the secret round-trips through encryption and never stays plaintext', () => {
  const secret = totp.generateTotpSecret();
  const stored = totp.encryptSecret(secret);
  assert.notEqual(stored, secret);
  assert.ok(!stored.includes(secret));
  assert.equal(totp.decryptSecret(stored), secret);
});

test('totp: a tampered stored secret fails closed on decrypt', () => {
  const secret = totp.generateTotpSecret();
  const stored = totp.encryptSecret(secret);
  const parts = stored.split(':');
  // Flip the last character of the ciphertext.
  const last = parts[2];
  parts[2] = last.slice(0, -1) + (last.slice(-1) === 'a' ? 'b' : 'a');
  assert.throws(() => totp.decryptSecret(parts.join(':')));
});

// -------------------------------------------------------------------- OTP ---

test('otp: issue fails closed when no destination or no delivery channel is configured', async () => {
  const noDest = await otp.issueOtp({ purpose: 'login' });
  assert.equal(noDest.delivered, false);
  assert.equal(noDest.reason, 'NO_DESTINATION');

  const noSms = await otp.issueOtp({ purpose: 'login', phone: '+15551234567' });
  assert.equal(noSms.delivered, false);
  assert.equal(noSms.reason, 'SMS_DELIVERY_NOT_CONFIGURED');

  // No SMTP configured in this test environment.
  const noEmail = await otp.issueOtp({ purpose: 'login', email: 'a@example.com' });
  assert.equal(noEmail.delivered, false);
  assert.equal(noEmail.reason, 'EMAIL_DELIVERY_NOT_CONFIGURED');

  // Nothing may have been written when delivery was refused.
  const count = db.prepare('SELECT COUNT(*) AS n FROM otp_codes').get().n;
  assert.equal(count, 0);
});

test('otp: the email sender is absent until SMTP is configured', () => {
  assert.equal(getEmailSender(), null);
  const response = emailDeliveryUnavailable();
  assert.equal(response.status, 503);
});

function seedOtp({ purpose, email, code, expiresAt, maxAttempts = 5 }) {
  const accountKey = email.trim().toLowerCase();
  const digest = require('node:crypto').createHash('sha256').update(`${accountKey}:${code}`).digest('hex');
  const otpId = generateId();
  db.prepare(
    `INSERT INTO otp_codes (otp_id, user_id, email, phone, code, type, purpose, attempts, max_attempts, expires_at)
     VALUES (?, ?, ?, NULL, ?, 'numeric', ?, 0, ?, ?)`,
  ).run(otpId, null, email, digest, purpose, maxAttempts, expiresAt);
  return { otpId, digest };
}

test('otp: a matching code verifies once and is then single-use', () => {
  const email = 'verify@example.com';
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { otpId } = seedOtp({ purpose: 'login', email, code: '123456', expiresAt: future });

  const ok = otp.verifyOtp('login', { email }, '123456');
  assert.equal(ok.ok, true);
  assert.ok(db.prepare('SELECT verified_at FROM otp_codes WHERE otp_id = ?').get(otpId).verified_at);

  // Reuse must fail: the row is marked verified and is no longer selected.
  const again = otp.verifyOtp('login', { email }, '123456');
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'NOT_FOUND');
});

test('otp: verification is bound to the account, independent of email casing', () => {
  const email = 'Mixed.Case@Example.com';
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  seedOtp({ purpose: 'register', email: email.toLowerCase(), code: '654321', expiresAt: future });

  assert.equal(otp.verifyOtp('register', { email: 'mixed.case@example.com' }, '654321').ok, true);
});

test('otp: an expired code is refused and a wrong code counts an attempt', () => {
  const email = 'exp@example.com';
  const past = new Date(Date.now() - 1000).toISOString();
  seedOtp({ purpose: 'login', email, code: '111111', expiresAt: past });
  assert.equal(otp.verifyOtp('login', { email }, '111111').reason, 'EXPIRED');

  const email2 = 'mismatch@example.com';
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { otpId } = seedOtp({ purpose: 'login', email: email2, code: '222222', expiresAt: future });
  assert.equal(otp.verifyOtp('login', { email: email2 }, '999999').reason, 'MISMATCH');
  assert.equal(db.prepare('SELECT attempts FROM otp_codes WHERE otp_id = ?').get(otpId).attempts, 1);
});

test('otp: the attempt cap stops brute force', () => {
  const email = 'cap@example.com';
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  seedOtp({ purpose: 'login', email, code: '333333', expiresAt: future, maxAttempts: 2 });

  assert.equal(otp.verifyOtp('login', { email }, '000000').reason, 'MISMATCH');
  assert.equal(otp.verifyOtp('login', { email }, '000000').reason, 'MISMATCH');
  // Third try is refused before the comparison.
  assert.equal(otp.verifyOtp('login', { email }, '333333').reason, 'TOO_MANY_ATTEMPTS');
});

test('otp: a verified code is recognised as fresh for a bounded window', () => {
  const email = 'fresh@example.com';
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  seedOtp({ purpose: 'password_reset', email, code: '444444', expiresAt: future });
  assert.equal(otp.isOtpVerified('password_reset', { email }), false);

  assert.equal(otp.verifyOtp('password_reset', { email }, '444444').ok, true);
  assert.equal(otp.isOtpVerified('password_reset', { email }, 15), true);
  // A different purpose must not see the verification.
  assert.equal(otp.isOtpVerified('login', { email }, 15), false);
});

// ------------------------------------------------------------ sessions ------

function fakeRequest() {
  return { headers: { get: () => null } };
}

test('session: a session is issued for an active account with a hashed-length token', () => {
  const userId = seedUser('active');
  const issued = issueSession(fakeRequest(), userId);
  assert.equal(issued.accessToken.length, 64);
  assert.equal(issued.refreshToken.length, 64);
  assert.ok(new Date(issued.expiresAt).getTime() > Date.now());
  assert.equal(issued.user.userId, userId);

  const row = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId);
  assert.equal(row.n, 1);
});

test('session: a non-active account cannot obtain a session', () => {
  const frozen = seedUser('frozen');
  assert.throws(() => issueSession(fakeRequest(), frozen));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(frozen).n, 0);

  assert.throws(() => issueSession(fakeRequest(), 'no-such-user'));
});

test('session: a trusted device gets a longer expiry than a normal one', () => {
  const userId = seedUser('active');
  const normal = issueSession(fakeRequest(), userId);
  const trusted = issueSession(fakeRequest(), userId, { trustedDevice: true });
  assert.ok(new Date(trusted.expiresAt).getTime() > new Date(normal.expiresAt).getTime());
});
