'use strict';
/**
 * Sign-in IP allowlist tests.
 *
 * The matcher is pure logic, so these exercise the real parser and comparator:
 * IPv4 and IPv6, `::` compression, CIDR ranges, and the fail-closed cases where
 * an entry or an address cannot be parsed. The account-level helpers are then
 * checked against a real database, including that the control is inert until it
 * is switched on and that an empty list never blocks a valid sign-in.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-ipallow-')), 'ipallow.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const { getDb, generateId, hashPassword } = require('../../.test-build/index.js');
const { parseIp, parseCidr, cidrContains, ipAllowed } = require('../../.test-build/ip-allowlist.js');
const {
  listIpAllowlist,
  addIpAllowlistEntry,
  removeIpAllowlistEntry,
  isSignInIpAllowed,
  updateSecuritySettings,
  AccountError,
} = require('../../.test-build/account.js');

const db = getDb();

function seedUser() {
  const userId = generateId();
  db.prepare('INSERT INTO users (user_id, email, password_hash, status) VALUES (?, ?, ?, ?)').run(
    userId,
    `${userId}@example.com`,
    hashPassword('password123'),
    'active',
  );
  return userId;
}

test('an IPv4 address parses to four bytes and a bare address is a host route', () => {
  const ip = parseIp('192.168.1.10');
  assert.equal(ip.version, 4);
  assert.deepEqual(Array.from(ip.bytes), [192, 168, 1, 10]);

  const host = parseCidr('192.168.1.10');
  assert.equal(host.prefix, 32);
  assert.equal(cidrContains(host, parseIp('192.168.1.10')), true);
  assert.equal(cidrContains(host, parseIp('192.168.1.11')), false);
});

test('invalid IPv4 is rejected rather than guessed at', () => {
  assert.equal(parseIp('256.0.0.1'), null);
  assert.equal(parseIp('1.2.3'), null);
  assert.equal(parseIp('01.2.3.4'), null, 'a leading zero is not a valid octet');
  assert.equal(parseIp('1.2.3.4.5'), null);
  assert.equal(parseCidr('10.0.0.0/33'), null, 'an out-of-range prefix is refused');
  assert.equal(parseCidr('10.0.0.0/abc'), null);
});

test('IPv6 parses, including :: compression and a dotted-quad tail', () => {
  assert.deepEqual(Array.from(parseIp('::1').bytes), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const loopback = parseCidr('::1/128');
  assert.equal(cidrContains(loopback, parseIp('::1')), true);
  assert.equal(cidrContains(loopback, parseIp('::2')), false);

  const v4mapped = parseIp('::ffff:192.168.0.1');
  assert.equal(v4mapped.version, 6);
  assert.deepEqual(
    Array.from(v4mapped.bytes),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 168, 0, 1],
  );

  assert.equal(parseIp('fe80::1%eth0') !== null, true, 'a zone index is stripped, not rejected');
  assert.equal(parseIp('12345::1'), null, 'an over-long group is refused');
  assert.equal(parseIp('1::2::3'), null, 'only one :: is allowed');
});

test('a CIDR range matches its members and nothing outside it', () => {
  const cidr = parseCidr('10.20.0.0/16');
  assert.equal(cidr.prefix, 16);
  assert.equal(cidrContains(cidr, parseIp('10.20.5.5')), true);
  assert.equal(cidrContains(cidr, parseIp('10.21.0.1')), false);
  // Host bits in the input are masked away, so a sloppy range still works.
  assert.deepEqual(Array.from(parseCidr('10.20.99.99/16').bytes), [10, 20, 0, 0]);
});

test('a v4 entry never matches a v6 address', () => {
  assert.equal(cidrContains(parseCidr('0.0.0.0/0'), parseIp('::1')), false);
});

test('an unparseable address or an empty list matches nothing', () => {
  assert.equal(ipAllowed('not-an-ip', ['0.0.0.0/0']), false);
  assert.equal(ipAllowed('10.0.0.1', []), false);
  assert.equal(ipAllowed('10.0.0.1', ['garbage']), false, 'a bad entry cannot widen access');
  assert.equal(ipAllowed('10.0.0.1', ['10.0.0.0/8']), true);
});

test('allowlist entries are validated, canonicalised, listed and removed', () => {
  const userId = seedUser();

  const added = addIpAllowlistEntry(userId, '203.0.113.9', 'office');
  assert.equal(added.cidr, '203.0.113.9/32', 'a bare address is stored as a host route');
  assert.throws(
    () => addIpAllowlistEntry(userId, 'nonsense', null),
    (error) => error instanceof AccountError && error.code === 'INVALID_CIDR',
  );

  // A second add of the same range is idempotent, not a duplicate row.
  addIpAllowlistEntry(userId, '203.0.113.9', 'office again');
  assert.equal(listIpAllowlist(userId).length, 1);

  removeIpAllowlistEntry(userId, added.id);
  assert.equal(listIpAllowlist(userId).length, 0);
  assert.throws(
    () => removeIpAllowlistEntry(userId, added.id),
    (error) => error instanceof AccountError && error.code === 'NOT_FOUND',
  );
});

test('sign-in is unrestricted until the control is switched on', () => {
  const userId = seedUser();
  assert.equal(isSignInIpAllowed(userId, '198.51.100.7'), true, 'the flag defaults to off');
});

test('once enabled, only a listed address may sign in', () => {
  const userId = seedUser();
  updateSecuritySettings(userId, { ip_whitelist_enabled: true });

  // Enabled but empty: the account would lock itself out, so an empty list is
  // treated as "no restriction yet" rather than blocking every sign-in.
  assert.equal(isSignInIpAllowed(userId, '198.51.100.7'), true);

  addIpAllowlistEntry(userId, '198.51.100.0/24', 'vpn');
  assert.equal(isSignInIpAllowed(userId, '198.51.100.7'), true);
  assert.equal(isSignInIpAllowed(userId, '203.0.113.7'), false);
  assert.equal(isSignInIpAllowed(userId, null), false, 'an unknown address fails closed');
});
