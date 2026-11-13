'use strict';
/**
 * SMS delivery of verification codes.
 *
 * Phone registration is a supported sign-up path, so its code must actually be
 * carried by a provider. These tests drive the real `issueOtp` path: with no
 * provider configured it fails closed, with a provider it posts the code to the
 * gateway, and a gateway error removes the record so the flow cannot proceed on
 * an undelivered code.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tigerex-sms-')), 'sms.db');
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef0123456789';

const BUILD = path.join(__dirname, '..', '..', '.test-build');
const { getDb } = require(path.join(BUILD, 'index.js'));
const { issueOtp, verifyOtp } = require(path.join(BUILD, 'otp.js'));
const { resetSmsSender } = require(path.join(BUILD, 'sms.js'));

const db = getDb();

function reset() {
  db.prepare('DELETE FROM otp_codes').run();
  delete process.env.TIGEREX_SMS_WEBHOOK_URL;
  delete process.env.TIGEREX_SMS_API_KEY;
  resetSmsSender();
}

test('a phone code fails closed when no SMS provider is configured', async () => {
  reset();
  const result = await issueOtp({ purpose: 'register', phone: '+15551230001' });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'SMS_DELIVERY_NOT_CONFIGURED');
  // No record is written for an undelivered code.
  const count = db.prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE purpose = 'register'").get();
  assert.equal(count.n, 0);
});

test('a configured provider carries the code and it verifies', async () => {
  reset();
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received = { auth: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200).end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  process.env.TIGEREX_SMS_WEBHOOK_URL = `http://127.0.0.1:${port}/send`;
  process.env.TIGEREX_SMS_API_KEY = 'secret-key';
  resetSmsSender();

  try {
    const result = await issueOtp({ purpose: 'register', phone: '+15551230002' });
    assert.equal(result.delivered, true);
    assert.equal(received.auth, 'Bearer secret-key');
    assert.equal(received.body.to, '+15551230002');
    assert.equal(received.body.from, 'TigerEx');

    // The delivered code verifies for that phone.
    const code = received.body.text.match(/(\d{6})/)[1];
    const verified = verifyOtp('register', { phone: '+15551230002' }, code);
    assert.equal(verified.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a provider error removes the record and reports a failure', async () => {
  reset();
  const server = http.createServer((req, res) => {
    res.writeHead(500).end('nope');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  process.env.TIGEREX_SMS_WEBHOOK_URL = `http://127.0.0.1:${port}/send`;
  process.env.TIGEREX_SMS_API_KEY = 'secret-key';
  resetSmsSender();

  try {
    const result = await issueOtp({ purpose: 'register', phone: '+15551230003' });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, 'DELIVERY_FAILED');
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE phone = '+15551230003'")
      .get();
    assert.equal(count.n, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
