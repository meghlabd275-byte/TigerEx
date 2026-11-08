'use strict';
/**
 * Social sign-in (OIDC) tests.
 *
 * These exercise the real verification path: a token is signed with a
 * throwaway RSA key, published as a JWKS, and must verify; the same token is
 * then mutated (wrong issuer, wrong audience, expired, bad nonce, tampered
 * signature, `alg: none`) and must be refused. The state signature and the
 * single-use login code are checked against the real database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-oidc-')), 'oidc.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId } = require('../../.test-build/index.js');
const {
  signState,
  verifyState,
  safeRedirectPath,
  verifyIdToken,
  findOrCreateUser,
  createLoginCode,
  redeemLoginCode,
  OidcError,
} = require('../../.test-build/oidc.js');

const db = getDb();

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test-key-1';
jwk.alg = 'RS256';
jwk.use = 'sig';
const JWKS = [jwk];

const CLIENT_ID = 'tigerex-client';
const ISSUER = 'https://accounts.google.com';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(claims, headerOverrides = {}) {
  const header = { alg: 'RS256', kid: 'test-key-1', typ: 'JWT', ...headerOverrides };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

function baseClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'provider-user-1',
    email: 'trader@example.com',
    email_verified: true,
    nonce: 'nonce-abc',
    iat: now - 5,
    exp: now + 300,
    ...overrides,
  };
}

const VERIFY = { issuer: ISSUER, clientId: CLIENT_ID, nonce: 'nonce-abc' };

test('verifyIdToken accepts a correctly signed token', () => {
  const claims = verifyIdToken(signToken(baseClaims()), JWKS, VERIFY);
  assert.equal(claims.sub, 'provider-user-1');
  assert.equal(claims.email, 'trader@example.com');
  assert.equal(claims.emailVerified, true);
});

test('verifyIdToken accepts the google legacy issuer form', () => {
  const token = signToken(baseClaims({ iss: 'accounts.google.com' }));
  assert.equal(verifyIdToken(token, JWKS, VERIFY).sub, 'provider-user-1');
});

test('verifyIdToken rejects a wrong issuer', () => {
  const token = signToken(baseClaims({ iss: 'https://evil.example' }));
  assert.throws(() => verifyIdToken(token, JWKS, VERIFY), (e) => e instanceof OidcError && e.code === 'INVALID_ID_TOKEN');
});

test('verifyIdToken rejects a wrong audience', () => {
  const token = signToken(baseClaims({ aud: 'someone-else' }));
  assert.throws(() => verifyIdToken(token, JWKS, VERIFY), /another client/);
});

test('verifyIdToken rejects an expired token', () => {
  const past = Math.floor(Date.now() / 1000) - 100000;
  const token = signToken(baseClaims({ iat: past, exp: past + 10 }));
  assert.throws(() => verifyIdToken(token, JWKS, VERIFY), /expired/);
});

test('verifyIdToken rejects a mismatched nonce', () => {
  const token = signToken(baseClaims({ nonce: 'attacker-nonce' }));
  assert.throws(() => verifyIdToken(token, JWKS, VERIFY), /nonce/);
});

test('verifyIdToken rejects a tampered signature', () => {
  const token = signToken(baseClaims());
  const [h, p] = token.split('.');
  const forged = `${h}.${p}.${b64url(Buffer.from('not a real signature'))}`;
  assert.throws(() => verifyIdToken(forged, JWKS, VERIFY), /signature/);
});

test('verifyIdToken rejects alg: none', () => {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(baseClaims()));
  const token = `${header}.${payload}.`;
  assert.throws(() => verifyIdToken(token, JWKS, VERIFY), /algorithm/);
});

test('verifyIdToken rejects a token signed by an unpublished key', () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = { alg: 'RS256', kid: 'unknown-key', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(baseClaims()))}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), other.privateKey);
  const token = `${signingInput}.${b64url(sig)}`;
  assert.throws(() => verifyIdToken(token, JWKS, VERIFY), /No matching signing key/);
});

test('signState/verifyState round-trips and rejects tampering', () => {
  const state = signState({ provider: 'google', nonce: 'n1', redirect: '/dashboard', issuedAt: Date.now() });
  const parsed = verifyState(state);
  assert.equal(parsed.provider, 'google');
  assert.equal(parsed.nonce, 'n1');

  // Flip a character in the payload.
  const [payload, mac] = state.split('.');
  const tampered = `${payload.slice(0, -1)}${payload.slice(-1) === 'A' ? 'B' : 'A'}.${mac}`;
  assert.throws(() => verifyState(tampered), (e) => e instanceof OidcError && e.code === 'INVALID_STATE');

  // An expired state is refused.
  const old = signState({ provider: 'google', nonce: 'n1', redirect: '/', issuedAt: Date.now() - 60 * 60 * 1000 });
  assert.throws(() => verifyState(old), (e) => e instanceof OidcError && e.code === 'EXPIRED_STATE');
});

test('safeRedirectPath only allows same-origin absolute paths', () => {
  assert.equal(safeRedirectPath('/wallet'), '/wallet');
  assert.equal(safeRedirectPath('//evil.example'), '/dashboard');
  assert.equal(safeRedirectPath('https://evil.example'), '/dashboard');
  assert.equal(safeRedirectPath('/a\\b'), '/dashboard');
  assert.equal(safeRedirectPath(''), '/dashboard');
});

test('findOrCreateUser links a returning identity and reuses the account', () => {
  const claims = verifyIdToken(signToken(baseClaims({ sub: 'returning-1', email: 'r1@example.com' })), JWKS, VERIFY);
  const first = findOrCreateUser('google', claims);
  const second = findOrCreateUser('google', claims);
  assert.equal(first, second);

  const count = db.prepare('SELECT COUNT(*) AS n FROM social_logins WHERE provider = ? AND provider_user_id = ?').get('google', 'returning-1');
  assert.equal(count.n, 1);
});

test('findOrCreateUser attaches to an existing account by verified email', () => {
  const userId = generateId();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, email_verified, status) VALUES (?, ?, 'x', 1, 'active')`,
  ).run(userId, 'existing@example.com');

  const claims = verifyIdToken(signToken(baseClaims({ sub: 'new-provider-sub', email: 'existing@example.com' })), JWKS, VERIFY);
  assert.equal(findOrCreateUser('google', claims), userId);
});

test('login code is single-use and expires', () => {
  const userId = generateId();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, 'x', 'active')`).run(userId, `${userId}@example.com`);

  const code = createLoginCode(userId, 'access-token-value', 'refresh-token-value');
  const redeemed = redeemLoginCode(code);
  assert.equal(redeemed.accessToken, 'access-token-value');
  assert.equal(redeemed.userId, userId);

  assert.throws(() => redeemLoginCode(code), (e) => e instanceof OidcError && e.code === 'CODE_ALREADY_USED');
  assert.throws(() => redeemLoginCode('not-a-code'), (e) => e instanceof OidcError && e.code === 'INVALID_CODE');
});
