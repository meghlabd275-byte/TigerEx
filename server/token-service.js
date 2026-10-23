"use strict";

/**
 * Access/refresh token minting and verification.
 *
 * Kept in its own module so the security-critical verification path can be
 * unit tested without booting the HTTP server (which requires Postgres and
 * Redis). Every token is signed with a pinned algorithm and validated against
 * a fixed issuer/audience; an access token is never accepted where a refresh
 * token is expected, and vice versa.
 */

const jwt = require("jsonwebtoken");

const JWT_ALGORITHM = "HS256";
const ACCESS_TOKEN_TTL = "24h";
const REFRESH_TOKEN_TTL = "7d";

function createTokenService({
  accessSecret,
  refreshSecret,
  issuer = "tigerex-api",
  audience = "tigerex-client",
}) {
  if (typeof accessSecret !== "string" || accessSecret.length === 0) {
    throw new Error("Access token secret must be a non-empty string");
  }
  if (typeof refreshSecret !== "string" || refreshSecret.length === 0) {
    throw new Error("Refresh token secret must be a non-empty string");
  }
  if (accessSecret === refreshSecret) {
    throw new Error("Access and refresh token secrets must differ");
  }

  function secretFor(type) {
    if (type === "access") return accessSecret;
    if (type === "refresh") return refreshSecret;
    throw new Error(`Unknown token type: ${type}`);
  }

  function generateToken(userId, type = "access") {
    if (userId === undefined || userId === null || userId === "") {
      throw new Error("userId is required to mint a token");
    }
    const secret = secretFor(type);
    return jwt.sign({ userId, type }, secret, {
      algorithm: JWT_ALGORITHM,
      expiresIn: type === "access" ? ACCESS_TOKEN_TTL : REFRESH_TOKEN_TTL,
      issuer,
      audience,
    });
  }

  function verifyToken(token, type = "access") {
    let secret;
    try {
      secret = secretFor(type);
    } catch {
      return null;
    }
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: [JWT_ALGORITHM],
        issuer,
        audience,
      });
      if (!decoded || decoded.type !== type) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  return { generateToken, verifyToken };
}

module.exports = { createTokenService, JWT_ALGORITHM };
