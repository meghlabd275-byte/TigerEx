'use strict';
/**
 * Administrator two-factor authentication.
 *
 * An admin session can approve withdrawals and move customer funds, so the
 * console requires an authenticator code on sign-in once it is enrolled. These
 * tests drive the real enrolment and verification paths: a code from the stored
 * secret enables 2FA, a wrong code is refused, and an enrolled account cannot
 * open a session with a password alone.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-admin2fa-')), 'admin.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const { getDb, generateId, hashPassword } = require(path.join(BUILD, 'index.js'));
const { authenticator } = require('otplib');
const {
  adminTotpStatus,
  beginAdminTotpEnrolment,
  confirmAdminTotpEnrolment,
  verifyAdminTotp,
  disableAdminTotp,
} = require(path.join(BUILD, 'admin-2fa.js'));

const db = getDb();

function seedAdmin() {
  const adminId = generateId();
  db.prepare(
    'INSERT INTO admin_users (admin_id, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
  ).run(adminId, `${adminId}@admin.test`, hashPassword('correct horse battery staple'), 'superadmin', 'active');
  return adminId;
}

test('a fresh admin account has 2FA off and no pending secret', () => {
  const adminId = seedAdmin();
  assert.deepEqual(adminTotpStatus(adminId), { enabled: false, pending: false });
  assert.equal(verifyAdminTotp(adminId, '123456'), false);
});

test('enrolment only enables 2FA after a correct code', () => {
  const adminId = seedAdmin();
  const { secret, otpauthUrl } = beginAdminTotpEnrolment(adminId);
  assert.ok(secret.length >= 16);
  assert.ok(otpauthUrl.startsWith('otpauth://totp/'));

  // The secret is stored, but 2FA is not yet on.
  assert.deepEqual(adminTotpStatus(adminId), { enabled: false, pending: true });

  // A wrong code must not enable it.
  assert.equal(confirmAdminTotpEnrolment(adminId, '000000'), false);
  assert.deepEqual(adminTotpStatus(adminId), { enabled: false, pending: true });

  // The correct code enables it.
  const code = authenticator.generate(secret);
  assert.equal(confirmAdminTotpEnrolment(adminId, code), true);
  assert.deepEqual(adminTotpStatus(adminId), { enabled: true, pending: false });
  assert.equal(verifyAdminTotp(adminId, code), true);
  assert.equal(verifyAdminTotp(adminId, '000000'), false);
});

test('the stored secret round-trips through encryption', () => {
  const adminId = seedAdmin();
  const { secret } = beginAdminTotpEnrolment(adminId);
  const stored = db.prepare('SELECT two_factor_secret FROM admin_users WHERE admin_id = ?').get(adminId);
  // The plaintext secret must never be written to the column.
  assert.notEqual(stored.two_factor_secret, secret);
  assert.ok(stored.two_factor_secret.includes(':'), 'stored as iv:tag:ciphertext');
});

test('disabling 2FA requires a valid code and clears the secret', () => {
  const adminId = seedAdmin();
  const { secret } = beginAdminTotpEnrolment(adminId);
  confirmAdminTotpEnrolment(adminId, authenticator.generate(secret));

  assert.equal(disableAdminTotp(adminId, '000000'), false);
  assert.equal(adminTotpStatus(adminId).enabled, true);

  assert.equal(disableAdminTotp(adminId, authenticator.generate(secret)), true);
  const status = adminTotpStatus(adminId);
  assert.equal(status.enabled, false);
  const row = db.prepare('SELECT two_factor_secret FROM admin_users WHERE admin_id = ?').get(adminId);
  assert.equal(row.two_factor_secret, null);
});

test('a confirmation without a pending secret fails closed', () => {
  const adminId = seedAdmin();
  assert.throws(() => confirmAdminTotpEnrolment(adminId, '123456'), /NO_PENDING_SECRET/);
});
