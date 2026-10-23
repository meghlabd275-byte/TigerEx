"use strict";

/**
 * Regression tests for the token service.
 *
 * These exercise the real jsonwebtoken library against real signed tokens;
 * nothing here is mocked. Run with: node --test server/token-service.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const { createTokenService } = require("./token-service");

const ACCESS_SECRET = "a".repeat(48);
const REFRESH_SECRET = "b".repeat(48);

function service(overrides = {}) {
  return createTokenService({
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    ...overrides,
  });
}

test("mints an access token that verifies as an access token", () => {
  const { generateToken, verifyToken } = service();
  const token = generateToken("user-1", "access");
  const decoded = verifyToken(token, "access");
  assert.ok(decoded, "access token should verify");
  assert.equal(decoded.userId, "user-1");
  assert.equal(decoded.type, "access");
});

test("rejects an access token presented as a refresh token", () => {
  const { generateToken, verifyToken } = service();
  const accessToken = generateToken("user-1", "access");
  assert.equal(verifyToken(accessToken, "refresh"), null);
});

test("rejects a refresh token presented as an access token", () => {
  const { generateToken, verifyToken } = service();
  const refreshToken = generateToken("user-1", "refresh");
  assert.equal(verifyToken(refreshToken, "access"), null);
});

test("rejects an unsigned alg=none token", () => {
  const { verifyToken } = service();
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ userId: "attacker", type: "access" })
  ).toString("base64url");
  const forged = `${header}.${payload}.`;
  assert.equal(verifyToken(forged, "access"), null);
});

test("rejects a token signed with the wrong secret", () => {
  const { verifyToken } = service();
  const forged = jwt.sign({ userId: "attacker", type: "access" }, "c".repeat(48), {
    algorithm: "HS256",
    issuer: "tigerex-api",
    audience: "tigerex-client",
  });
  assert.equal(verifyToken(forged, "access"), null);
});

test("rejects a token with an unexpected issuer", () => {
  const { verifyToken } = service();
  const forged = jwt.sign({ userId: "attacker", type: "access" }, ACCESS_SECRET, {
    algorithm: "HS256",
    issuer: "some-other-service",
    audience: "tigerex-client",
  });
  assert.equal(verifyToken(forged, "access"), null);
});

test("rejects a token with an unexpected audience", () => {
  const { verifyToken } = service();
  const forged = jwt.sign({ userId: "attacker", type: "access" }, ACCESS_SECRET, {
    algorithm: "HS256",
    issuer: "tigerex-api",
    audience: "some-other-client",
  });
  assert.equal(verifyToken(forged, "access"), null);
});

test("rejects an expired token", () => {
  const { verifyToken } = service();
  const expired = jwt.sign({ userId: "user-1", type: "access" }, ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: "-1s",
    issuer: "tigerex-api",
    audience: "tigerex-client",
  });
  assert.equal(verifyToken(expired, "access"), null);
});

test("rejects garbage and non-string input without throwing", () => {
  const { verifyToken } = service();
  for (const bad of ["", "not-a-token", "a.b.c", null, undefined, 42, {}]) {
    assert.equal(verifyToken(bad, "access"), null);
  }
});

test("refuses to construct a service with identical secrets", () => {
  assert.throws(
    () => createTokenService({ accessSecret: ACCESS_SECRET, refreshSecret: ACCESS_SECRET }),
    /must differ/
  );
});

test("refuses to construct a service with an empty secret", () => {
  assert.throws(
    () => createTokenService({ accessSecret: "", refreshSecret: REFRESH_SECRET }),
    /non-empty/
  );
});
