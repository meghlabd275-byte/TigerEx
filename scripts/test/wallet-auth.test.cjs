'use strict';
/**
 * Wallet-signature (EIP-191) authentication tests.
 *
 * A throwaway key signs the challenge the server issues, and the real recovery
 * path must accept it. The same challenge is then replayed, tampered with, and
 * signed by a different key, and each attempt must be refused. The account
 * lookup, session creation and challenge store are exercised against the real
 * database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-wallet-')), 'wallet.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { Wallet } = require('ethers');
const { getDb } = require('../../.test-build/index.js');
const {
  normalizeAddress,
  buildChallengeMessage,
  sameAddress,
  isChallengeFresh,
} = require('../../.test-build/wallet-signature.js');
const {
  issueChallenge,
  verifyChallenge,
  openWalletSession,
  WalletAuthError,
} = require('../../.test-build/wallet.js');

const db = getDb();

const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const other = new Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');

async function sign(w, message) {
  return w.signMessage(message);
}

test('normalizeAddress accepts only 20-byte hex and lower-cases', () => {
  assert.equal(normalizeAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'), '0xabcdef0123456789abcdef0123456789abcdef01');
  assert.equal(normalizeAddress('0x123'), null);
  assert.equal(normalizeAddress('not-an-address'), null);
  assert.equal(normalizeAddress(null), null);
});

test('sameAddress ignores case and rejects malformed input', () => {
  assert.equal(sameAddress(wallet.address, '0x' + wallet.address.slice(2).toUpperCase()), true);
  assert.equal(sameAddress(wallet.address, other.address), false);
  assert.equal(sameAddress('nonsense', 'nonsense'), false);
});

test('isChallengeFresh rejects future and expired stamps', () => {
  assert.equal(isChallengeFresh(1000, 2000, 5000), true);
  assert.equal(isChallengeFresh(1000, 9000, 5000), false);
  assert.equal(isChallengeFresh(5000, 1000, 5000), false);
  assert.equal(isChallengeFresh(1000, 2000, 0), false);
});

test('buildChallengeMessage embeds the address and nonce', () => {
  const message = buildChallengeMessage(wallet.address, 'a'.repeat(24), 1700000000000);
  assert.ok(message.includes(wallet.address.toLowerCase()));
  assert.ok(message.includes('a'.repeat(24)));
  assert.throws(() => buildChallengeMessage('bad', 'a'.repeat(24), 0));
  assert.throws(() => buildChallengeMessage(wallet.address, 'short', 0));
});

test('a signed challenge verifies and yields the signer address', async () => {
  const challenge = issueChallenge(wallet.address);
  const signature = await sign(wallet, challenge.message);
  const recovered = verifyChallenge(challenge.challengeId, signature);
  assert.equal(recovered, wallet.address.toLowerCase());
});

test('a challenge cannot be replayed', async () => {
  const challenge = issueChallenge(wallet.address);
  const signature = await sign(wallet, challenge.message);
  verifyChallenge(challenge.challengeId, signature);
  assert.throws(
    () => verifyChallenge(challenge.challengeId, signature),
    (e) => e instanceof WalletAuthError && e.code === 'CHALLENGE_USED',
  );
});

test('a signature from a different key is refused', async () => {
  const challenge = issueChallenge(wallet.address);
  const signature = await sign(other, challenge.message);
  assert.throws(
    () => verifyChallenge(challenge.challengeId, signature),
    (e) => e instanceof WalletAuthError && e.code === 'SIGNATURE_MISMATCH',
  );
});

test('a tampered message does not recover the challenge address', async () => {
  const challenge = issueChallenge(wallet.address);
  const signature = await sign(wallet, `${challenge.message} extra`);
  assert.throws(
    () => verifyChallenge(challenge.challengeId, signature),
    (e) => e instanceof WalletAuthError,
  );
});

test('unknown challenge ids and malformed signatures are refused', () => {
  assert.throws(
    () => verifyChallenge('does-not-exist', '0xdeadbeef'),
    (e) => e instanceof WalletAuthError && e.code === 'UNKNOWN_CHALLENGE',
  );
  const challenge = issueChallenge(wallet.address);
  assert.throws(
    () => verifyChallenge(challenge.challengeId, 'not-hex'),
    (e) => e instanceof WalletAuthError && e.code === 'INVALID_SIGNATURE',
  );
});

test('login refuses an address that has not registered', async () => {
  const challenge = issueChallenge(other.address);
  const signature = await sign(other, challenge.message);
  const address = verifyChallenge(challenge.challengeId, signature);
  assert.throws(
    () => openWalletSession(address, { create: false }),
    (e) => e instanceof WalletAuthError && e.code === 'ACCOUNT_NOT_FOUND',
  );
});

test('registration creates an account and a session, and login reuses it', async () => {
  const register = issueChallenge(other.address);
  const registerSig = await sign(other, register.message);
  const address = verifyChallenge(register.challengeId, registerSig);
  const created = openWalletSession(address, { create: true, email: 'wallet@example.com' });
  assert.equal(created.address, other.address.toLowerCase());
  assert.ok(created.accessToken.length >= 32);

  const session = db
    .prepare('SELECT user_id, access_token FROM sessions WHERE access_token = ?')
    .get(created.accessToken);
  assert.equal(session.user_id, created.userId);

  const link = db
    .prepare('SELECT user_id FROM social_logins WHERE provider = ? AND provider_user_id = ?')
    .get('wallet', other.address.toLowerCase());
  assert.equal(link.user_id, created.userId);

  const login = issueChallenge(other.address);
  const loginSig = await sign(other, login.message);
  const loginAddress = verifyChallenge(login.challengeId, loginSig);
  const loggedIn = openWalletSession(loginAddress, { create: false });
  assert.equal(loggedIn.userId, created.userId);
  assert.notEqual(loggedIn.accessToken, created.accessToken);
});

test('registration rejects an email already in use', async () => {
  const challenge = issueChallenge(wallet.address);
  const signature = await sign(wallet, challenge.message);
  const address = verifyChallenge(challenge.challengeId, signature);
  assert.throws(
    () => openWalletSession(address, { create: true, email: 'wallet@example.com' }),
    (e) => e instanceof WalletAuthError && e.code === 'EMAIL_IN_USE',
  );
});

test('re-issuing a challenge invalidates the previous unconsumed one', () => {
  const first = issueChallenge(wallet.address);
  const second = issueChallenge(wallet.address);
  const remaining = db
    .prepare('SELECT COUNT(*) AS n FROM wallet_challenges WHERE address = ? AND consumed_at IS NULL')
    .get(wallet.address.toLowerCase());
  assert.equal(remaining.n, 1);
  assert.notEqual(first.challengeId, second.challengeId);
});
