/**
 * Public API-key authentication for the REST gateway.
 *
 * A request is signed with the secret issued once at key creation:
 *
 *   base = METHOD \n PATH \n TIMESTAMP \n SHA256(body)
 *   signature = HMAC-SHA256(secret, base)
 *
 * The secret is stored only as a hash plus an encrypted copy, so it can be used
 * to verify a signature but never recovered from the database. Every rejection
 * is explicit; there is no anonymous fallback and no partial match.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '@/lib/db';
import { decrypt } from '@/lib/db';
import { verifyApiSecret } from '@/lib/security/account';

/** How far a request timestamp may drift from the server clock. */
export const MAX_CLOCK_SKEW_MS = 30_000;

export type ApiPermission = 'read' | 'trade' | 'withdraw';

export interface ApiCredential {
  apiKey: string;
  timestamp: string;
  signature: string;
}

export interface ApiAuthResult {
  userId: string;
  keyId: string;
  permissions: string[];
}

export class ApiAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The canonical string a client signs. Exported so clients can reproduce it. */
export function signatureBase(method: string, path: string, timestamp: string, body: string): string {
  const bodyHash = createHash('sha256').update(body ?? '').digest('hex');
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

/** HMAC-SHA256 of the canonical string, hex encoded. */
export function signRequest(secret: string, method: string, path: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(signatureBase(method, path, timestamp, body)).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Authenticate a signed API request.
 *
 * Checks, in order: the key exists and is enabled, the timestamp is inside the
 * allowed skew, the signature matches, the caller's address is on the key's
 * whitelist when one is set, and the key holds the permission the endpoint
 * requires. `last_used_at` is only stamped after a successful check.
 */
export function authenticateApiRequest(
  credential: ApiCredential,
  method: string,
  path: string,
  body: string,
  requiredPermission: ApiPermission,
  clientIp: string | null,
  now: number = Date.now(),
): ApiAuthResult {
  const apiKey = String(credential.apiKey ?? '').trim();
  const timestamp = String(credential.timestamp ?? '').trim();
  const signature = String(credential.signature ?? '').trim();

  if (!apiKey || !timestamp || !signature) {
    throw new ApiAuthError('UNAUTHORIZED', 'API key, timestamp and signature are required');
  }

  const keyId = apiKey.startsWith('tgx_') ? apiKey.slice(4) : apiKey;
  const row = getDb()
    .prepare(
      `SELECT key_id, user_id, key_hash, permissions, ip_whitelist, enabled, expires_at
         FROM api_keys WHERE key_id = ?`,
    )
    .get(keyId) as
    | {
        key_id: string;
        user_id: string;
        key_hash: string;
        permissions: string | null;
        ip_whitelist: string | null;
        enabled: number;
        expires_at: string | null;
      }
    | undefined;

  if (!row || row.enabled !== 1) {
    throw new ApiAuthError('UNAUTHORIZED', 'Unknown or disabled API key');
  }
  if (row.expires_at && Date.parse(row.expires_at) <= now) {
    throw new ApiAuthError('UNAUTHORIZED', 'This API key has expired');
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) {
    throw new ApiAuthError('TIMESTAMP_OUT_OF_RANGE', 'The request timestamp is outside the allowed window');
  }

  const separator = row.key_hash.indexOf(':');
  if (separator < 1) throw new ApiAuthError('UNAUTHORIZED', 'This API key cannot be verified');
  const encryptedSecret = row.key_hash.slice(separator + 1);
  let secret: string;
  try {
    secret = decrypt(encryptedSecret);
  } catch {
    throw new ApiAuthError('UNAUTHORIZED', 'This API key cannot be verified');
  }

  const expected = signRequest(secret, method, path, timestamp, body);
  if (!constantTimeEquals(expected, signature)) {
    throw new ApiAuthError('SIGNATURE_INVALID', 'The request signature does not match');
  }

  const whitelist = parseList(row.ip_whitelist);
  if (whitelist.length > 0) {
    if (!clientIp || !whitelist.includes(clientIp)) {
      throw new ApiAuthError('IP_NOT_ALLOWED', 'This address is not permitted for the API key', 403);
    }
  }

  const permissions = parseList(row.permissions).map((p) => p.toLowerCase());
  if (!permissions.includes(requiredPermission)) {
    throw new ApiAuthError('PERMISSION_DENIED', `This key does not hold the ${requiredPermission} permission`, 403);
  }

  getDb().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE key_id = ?").run(keyId);

  return { userId: row.user_id, keyId: row.key_id, permissions };
}

/** Re-export so callers can verify a secret without importing the account lib. */
export { verifyApiSecret };

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
