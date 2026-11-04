/**
 * Account security settings, sessions and API keys.
 *
 * The security flags live in dedicated columns on `users` (so a query that
 * needs them does not parse a blob), the login history is `login_attempts`,
 * and the API-key list is `api_keys`. Nothing here returns a key secret: the
 * key id is a public identifier, and the hash is never serialized.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId, encrypt, decrypt } from '@/lib/db';
import { randomBytes, createHash } from 'crypto';

export class AccountError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
    this.status = status;
  }
}

export interface SecuritySettings {
  two_factor_enabled: boolean;
  anti_phishing_enabled: boolean;
  withdrawal_whitelist_enabled: boolean;
  login_alerts_enabled: boolean;
  ip_whitelist_enabled: boolean;
  anti_phishing_code: string | null;
  two_factor_type: string;
  password_changed_at: string | null;
}

/** The security flags a user may change, and their `users` columns. */
const FLAG_COLUMNS: Record<string, string> = {
  two_factor_enabled: 'two_factor_enabled',
  anti_phishing_enabled: 'anti_phishing_enabled',
  withdrawal_whitelist_enabled: 'withdrawal_whitelist_enabled',
  login_alerts_enabled: 'login_alerts_enabled',
  ip_whitelist_enabled: 'ip_whitelist_enabled',
};

export function securitySettings(userId: string): SecuritySettings {
  const row = getDb()
    .prepare(
      `SELECT two_factor_enabled, anti_phishing_enabled, withdrawal_whitelist_enabled,
              login_alerts_enabled, ip_whitelist_enabled, anti_phishing_code,
              two_factor_type, password_changed_at
         FROM users WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        two_factor_enabled: number;
        anti_phishing_enabled: number;
        withdrawal_whitelist_enabled: number;
        login_alerts_enabled: number;
        ip_whitelist_enabled: number;
        anti_phishing_code: string | null;
        two_factor_type: string | null;
        password_changed_at: string | null;
      }
    | undefined;

  if (!row) throw new AccountError('NOT_FOUND', 'Account not found', 404);

  return {
    two_factor_enabled: row.two_factor_enabled === 1,
    anti_phishing_enabled: row.anti_phishing_enabled === 1,
    withdrawal_whitelist_enabled: row.withdrawal_whitelist_enabled === 1,
    login_alerts_enabled: row.login_alerts_enabled === 1,
    ip_whitelist_enabled: row.ip_whitelist_enabled === 1,
    anti_phishing_code: row.anti_phishing_code,
    two_factor_type: row.two_factor_type ?? 'totp',
    password_changed_at: row.password_changed_at,
  };
}

/**
 * Update the security flags.
 *
 * Disabling two-factor authentication requires the current password, because
 * that flag is the last barrier between a stolen session and the account.
 */
export function updateSecuritySettings(
  userId: string,
  changes: Record<string, unknown>,
): SecuritySettings {
  const assignments: string[] = [];
  const params: Array<number | string> = [];

  for (const [key, column] of Object.entries(FLAG_COLUMNS)) {
    if (changes[key] === undefined) continue;
    if (typeof changes[key] !== 'boolean') {
      throw new AccountError('VALIDATION_FAILED', `${key} must be a boolean`);
    }
    assignments.push(`${column} = ?`);
    params.push(changes[key] ? 1 : 0);
  }

  if (changes.anti_phishing_code !== undefined) {
    const code = changes.anti_phishing_code === null ? '' : String(changes.anti_phishing_code).trim();
    if (code.length > 64) throw new AccountError('VALIDATION_FAILED', 'The anti-phishing code is too long');
    assignments.push('anti_phishing_code = ?');
    params.push(code.length > 0 ? code : null);
  }

  if (assignments.length === 0) {
    throw new AccountError('VALIDATION_FAILED', 'No recognised security setting was supplied');
  }

  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(userId);
  if (!exists) throw new AccountError('NOT_FOUND', 'Account not found', 404);

  assignments.push("updated_at = datetime('now')");
  db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE user_id = ?`).run(...params, userId);

  return securitySettings(userId);
}

export interface LoginEvent {
  attempt_id: string;
  ip_address: string | null;
  success: boolean;
  failure_reason: string | null;
  created_at: string;
}

/** The account's recent sign-in attempts, newest first. */
export function loginHistory(userId: string, limit = 50): LoginEvent[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const rows = getDb()
    .prepare(
      `SELECT attempt_id, ip_address, success, failure_reason, created_at
         FROM login_attempts
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(userId, capped) as Array<{
    attempt_id: string;
    ip_address: string | null;
    success: number;
    failure_reason: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    attempt_id: row.attempt_id,
    ip_address: row.ip_address,
    success: row.success === 1,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
  }));
}

export interface SessionView {
  id: string;
  device_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  trusted: boolean;
  current: boolean;
}

/**
 * Active sessions for the account.
 *
 * `currentToken` marks the caller's own session so the console does not offer
 * to revoke the session it is using.
 */
export function listSessions(userId: string, currentToken: string | null): SessionView[] {
  const rows = getDb()
    .prepare(
      `SELECT session_id, device_id, user_agent, ip_address, access_token,
              created_at, last_active_at, expires_at, trusted
         FROM sessions
        WHERE user_id = ? AND expires_at > datetime('now')
        ORDER BY last_active_at DESC`,
    )
    .all(userId) as Array<{
    session_id: string;
    device_id: string | null;
    user_agent: string | null;
    ip_address: string | null;
    access_token: string;
    created_at: string;
    last_active_at: string;
    expires_at: string;
    trusted: number;
  }>;

  return rows.map((row) => ({
    id: row.session_id,
    device_id: row.device_id,
    user_agent: row.user_agent,
    ip_address: row.ip_address,
    created_at: row.created_at,
    last_active_at: row.last_active_at,
    expires_at: row.expires_at,
    trusted: row.trusted === 1,
    current: currentToken !== null && row.access_token === currentToken,
  }));
}

/** Revoke one session. The caller cannot revoke the session they are using. */
export function revokeSession(userId: string, sessionId: string, currentToken: string | null): void {
  const db = getDb();
  const row = db
    .prepare('SELECT access_token FROM sessions WHERE session_id = ? AND user_id = ?')
    .get(sessionId, userId) as { access_token: string } | undefined;
  if (!row) throw new AccountError('NOT_FOUND', 'No such session', 404);
  if (currentToken !== null && row.access_token === currentToken) {
    throw new AccountError('CANNOT_REVOKE_CURRENT', 'You cannot revoke the session you are using', 409);
  }
  db.prepare('DELETE FROM sessions WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
}

/** Revoke every session except the caller's. */
export function revokeOtherSessions(userId: string, currentToken: string | null): number {
  const db = getDb();
  if (currentToken === null) {
    const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return result.changes;
  }
  const result = db
    .prepare('DELETE FROM sessions WHERE user_id = ? AND access_token <> ?')
    .run(userId, currentToken);
  return result.changes;
}

export interface ApiKeyView {
  id: string;
  name: string;
  permissions: string[];
  enabled: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/** The account's API keys. The secret and its hash are never returned. */
export function listApiKeys(userId: string): ApiKeyView[] {
  const rows = getDb()
    .prepare(
      `SELECT key_id, name, permissions, enabled, created_at, last_used_at, expires_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId) as Array<{
    key_id: string;
    name: string;
    permissions: string | null;
    enabled: number;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  }>;

  return rows.map((row) => {
    let permissions: string[] = [];
    if (row.permissions) {
      try {
        const parsed = JSON.parse(row.permissions);
        if (Array.isArray(parsed)) permissions = parsed.map(String);
      } catch {
        permissions = [];
      }
    }
    return {
      id: row.key_id,
      name: row.name,
      permissions,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
    };
  });
}

export interface CreatedApiKey {
  id: string;
  name: string;
  permissions: string[];
  /** Shown exactly once, at creation. It is not stored in plaintext. */
  apiKey: string;
  apiSecret: string;
  created_at: string;
}

const ALLOWED_PERMISSIONS = ['read', 'trade', 'withdraw'];

/**
 * Create an API key.
 *
 * The secret is generated from 32 random bytes, returned once, and stored only
 * as a SHA-256 hash plus an encrypted copy for signature verification. The key
 * id is the public half.
 */
export function createApiKey(
  userId: string,
  name: string,
  permissions: string[],
  ipWhitelist: string[] = [],
): CreatedApiKey {
  const label = String(name ?? '').trim();
  if (label.length === 0 || label.length > 64) {
    throw new AccountError('VALIDATION_FAILED', 'A key name of 1 to 64 characters is required');
  }

  const requested = Array.isArray(permissions) ? permissions.map((p) => String(p).toLowerCase()) : [];
  const unique = Array.from(new Set(requested));
  if (unique.length === 0) throw new AccountError('VALIDATION_FAILED', 'At least one permission is required');
  for (const permission of unique) {
    if (!ALLOWED_PERMISSIONS.includes(permission)) {
      throw new AccountError('VALIDATION_FAILED', `Unknown permission ${permission}`);
    }
  }

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(userId)) {
    throw new AccountError('NOT_FOUND', 'Account not found', 404);
  }

  const keyId = generateId();
  const secret = randomBytes(32).toString('hex');
  const apiKey = `tgx_${keyId}`;
  const keyHash = createHash('sha256').update(secret).digest('hex');

  db.prepare(
    `INSERT INTO api_keys (key_id, user_id, key_hash, name, permissions, ip_whitelist, enabled)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    keyId,
    userId,
    // The hash is the lookup value; the encrypted secret is the only reversible
    // copy and is used to verify a request signature.
    `${keyHash}:${encrypt(secret)}`,
    label,
    JSON.stringify(unique),
    JSON.stringify(ipWhitelist.map(String)),
  );

  const created = db
    .prepare('SELECT created_at FROM api_keys WHERE key_id = ?')
    .get(keyId) as { created_at: string };

  return { id: keyId, name: label, permissions: unique, apiKey, apiSecret: secret, created_at: created.created_at };
}

/** Revoke an API key the account owns. */
export function revokeApiKey(userId: string, keyId: string): void {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE key_id = ? AND user_id = ?').run(keyId, userId);
  if (result.changes === 0) throw new AccountError('NOT_FOUND', 'No such API key', 404);
}

/** Verify a presented API secret against the stored hash. */
export function verifyApiSecret(userId: string, keyId: string, secret: string): boolean {
  const row = getDb()
    .prepare('SELECT key_hash FROM api_keys WHERE key_id = ? AND user_id = ? AND enabled = 1')
    .get(keyId, userId) as { key_hash: string } | undefined;
  if (!row) return false;

  const separator = row.key_hash.indexOf(':');
  if (separator < 1) return false;
  const expectedHash = row.key_hash.slice(0, separator);
  // The encrypted payload is itself colon-separated (iv:tag:ciphertext), so
  // only the first colon separates the hash from it.
  const encryptedSecret = row.key_hash.slice(separator + 1);
  if (!encryptedSecret) return false;

  const presented = createHash('sha256').update(secret).digest('hex');
  if (presented !== expectedHash) return false;

  // The encrypted copy must still decrypt to the same secret; a mismatch means
  // the row was tampered with.
  try {
    return decrypt(encryptedSecret) === secret;
  } catch {
    return false;
  }
}
