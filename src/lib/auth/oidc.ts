/**
 * OpenID Connect sign-in.
 *
 * Real authorization-code flow with a server-side id_token check: the browser
 * is redirected to the provider, the provider redirects back with a code, the
 * code is exchanged for tokens at the provider's token endpoint, and the
 * returned id_token's RS256 signature is verified against the provider's
 * published JWKS before any claim is trusted. `iss`, `aud`, `exp` and the
 * `nonce` are all checked, so a token minted for another client or replayed
 * from another session cannot sign a user in.
 *
 * No provider is configured by default: `clientId`/`clientSecret` come from the
 * environment and a provider without them fails closed. Nothing here depends on
 * a third-party SDK.
 *
 * The module avoids `next/server` so the verification rules can be unit tested.
 */

import { createHmac, createPublicKey, createHash, randomBytes, timingSafeEqual, verify as cryptoVerify } from 'crypto';
import { getDb, generateId } from '@/lib/db';

export interface OidcProvider {
  id: string;
  label: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  scopes: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}

/**
 * The providers the exchange speaks to. Each is a genuine OIDC issuer, so the
 * id_token can be verified without provider-specific trust assumptions.
 */
export const OIDC_PROVIDERS: Record<string, OidcProvider> = {
  google: {
    id: 'google',
    label: 'Google',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    scopes: 'openid email profile',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  apple: {
    id: 'apple',
    label: 'Apple',
    issuer: 'https://appleid.apple.com',
    authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
    tokenEndpoint: 'https://appleid.apple.com/auth/token',
    jwksUri: 'https://appleid.apple.com/auth/keys',
    scopes: 'openid email name',
    clientIdEnv: 'APPLE_CLIENT_ID',
    clientSecretEnv: 'APPLE_CLIENT_SECRET',
  },
  microsoft: {
    id: 'microsoft',
    label: 'Microsoft',
    issuer: 'https://login.microsoftonline.com/common/v2.0',
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    scopes: 'openid email profile',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
  },
};

export class OidcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function providerById(id: string): OidcProvider | null {
  return OIDC_PROVIDERS[String(id ?? '').trim().toLowerCase()] ?? null;
}

/** The client credentials for a provider, or null when either is missing. */
export function providerCredentials(provider: OidcProvider): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Whether a provider can be used right now. */
export function providerConfigured(provider: OidcProvider): boolean {
  return providerCredentials(provider) !== null;
}

function stateKey(): Buffer {
  const configured = process.env.ENCRYPTION_KEY;
  if (!configured || configured.length < 32) {
    throw new OidcError('CONFIGURATION_ERROR', 'Sign-in is unavailable until ENCRYPTION_KEY is configured', 503);
  }
  return createHash('sha256').update(`oidc-state:${configured}`, 'utf8').digest();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

export interface OidcState {
  provider: string;
  nonce: string;
  redirect: string;
  issuedAt: number;
}

/**
 * Sign the per-attempt state.
 *
 * The state carries the provider, a nonce that must reappear inside the
 * id_token, and the post-login destination. It is HMAC-signed so a client
 * cannot swap in its own nonce or redirect, and it is single-use because the
 * callback deletes the row it is bound to.
 */
export function signState(state: OidcState): string {
  const payload = b64url(JSON.stringify(state));
  const mac = b64url(createHmac('sha256', stateKey()).update(payload).digest());
  return `${payload}.${mac}`;
}

export function verifyState(token: string, maxAgeMs = 10 * 60 * 1000): OidcState {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2) throw new OidcError('INVALID_STATE', 'The sign-in state is malformed');
  const [payload, mac] = parts;

  const expected = createHmac('sha256', stateKey()).update(payload).digest();
  const provided = fromB64url(mac);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new OidcError('INVALID_STATE', 'The sign-in state could not be verified');
  }

  let parsed: OidcState;
  try {
    parsed = JSON.parse(fromB64url(payload).toString('utf8'));
  } catch {
    throw new OidcError('INVALID_STATE', 'The sign-in state could not be read');
  }

  if (!parsed || typeof parsed.provider !== 'string' || typeof parsed.nonce !== 'string') {
    throw new OidcError('INVALID_STATE', 'The sign-in state is incomplete');
  }
  if (!Number.isFinite(parsed.issuedAt) || Date.now() - parsed.issuedAt > maxAgeMs) {
    throw new OidcError('EXPIRED_STATE', 'The sign-in attempt has expired; start again');
  }
  return parsed;
}

/** Only same-origin absolute paths are accepted as a post-login destination. */
export function safeRedirectPath(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  return '/dashboard';
}

export function buildAuthorizationUrl(
  provider: OidcProvider,
  params: { clientId: string; redirectUri: string; state: string; nonce: string },
): string {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scopes);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface IdTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  nonce: string | null;
  exp: number;
  iat: number | null;
}

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/** Verify the compact JWS signature against a matching RSA public key. */
function verifySignature(idToken: string, jwks: Jwk[]): void {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('INVALID_ID_TOKEN', 'The id_token is not a compact JWS');
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string; typ?: string };
  try {
    header = JSON.parse(fromB64url(headerB64).toString('utf8'));
  } catch {
    throw new OidcError('INVALID_ID_TOKEN', 'The id_token header could not be read');
  }
  if (header.alg !== 'RS256') {
    // Only RS256 is accepted; "none" and HMAC are rejected outright so a token
    // cannot be forged with a public value as the key.
    throw new OidcError('INVALID_ID_TOKEN', `Unsupported id_token algorithm: ${header.alg ?? 'none'}`);
  }

  const candidates = jwks.filter(
    (key) => key.kty === 'RSA' && (header.kid ? key.kid === header.kid : true),
  );
  if (candidates.length === 0) {
    throw new OidcError('INVALID_ID_TOKEN', 'No matching signing key was published by the provider');
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = fromB64url(signatureB64);

  for (const jwk of candidates) {
    try {
      const key = createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: 'jwk' } as never);
      if (cryptoVerify('sha256', signingInput, key, signature)) return;
    } catch {
      // A key this runtime cannot import is skipped, not trusted.
    }
  }
  throw new OidcError('INVALID_ID_TOKEN', 'The id_token signature did not verify');
}

export interface VerifyOptions {
  issuer: string;
  clientId: string;
  nonce: string | null;
  now?: number;
  clockSkewSeconds?: number;
}

/** Verify a provider id_token end to end and return its claims. */
export function verifyIdToken(idToken: string, jwks: Jwk[], options: VerifyOptions): IdTokenClaims {
  verifySignature(idToken, jwks);

  const parts = idToken.split('.');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch {
    throw new OidcError('INVALID_ID_TOKEN', 'The id_token payload could not be read');
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 120;

  const iss = String(claims.iss ?? '');
  // Google issues both forms of the issuer for the same account.
  const issuerMatches =
    iss === options.issuer ||
    (options.issuer === 'https://accounts.google.com' && iss === 'accounts.google.com');
  if (!issuerMatches) throw new OidcError('INVALID_ID_TOKEN', 'The id_token issuer is not trusted');

  const aud = claims.aud;
  const audienceOk = Array.isArray(aud) ? aud.includes(options.clientId) : aud === options.clientId;
  if (!audienceOk) throw new OidcError('INVALID_ID_TOKEN', 'The id_token was issued for another client');

  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp + skew < now) {
    throw new OidcError('INVALID_ID_TOKEN', 'The id_token has expired');
  }
  const iat = Number(claims.iat);

  const nonce = claims.nonce === undefined || claims.nonce === null ? null : String(claims.nonce);
  if (options.nonce !== null && nonce !== options.nonce) {
    throw new OidcError('INVALID_ID_TOKEN', 'The id_token nonce does not match this sign-in attempt');
  }

  const sub = String(claims.sub ?? '');
  if (!sub) throw new OidcError('INVALID_ID_TOKEN', 'The id_token has no subject');

  return {
    iss,
    aud: Array.isArray(aud) ? String(aud[0]) : String(aud ?? ''),
    sub,
    email: claims.email ? String(claims.email).toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    nonce,
    exp,
    iat: Number.isFinite(iat) ? iat : null,
  };
}

interface CachedJwks {
  keys: Jwk[];
  fetchedAt: number;
}

const jwksCache = new Map<string, CachedJwks>();
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Fetch (and briefly cache) a provider's JWKS. A fetch failure is an error. */
export async function fetchJwks(provider: OidcProvider, force = false): Promise<Jwk[]> {
  const cached = jwksCache.get(provider.id);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const response = await fetch(provider.jwksUri, { cache: 'no-store' });
  if (!response.ok) {
    throw new OidcError('JWKS_UNAVAILABLE', 'The sign-in provider keys could not be fetched', 502);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (keys.length === 0) {
    throw new OidcError('JWKS_UNAVAILABLE', 'The sign-in provider published no signing keys', 502);
  }
  jwksCache.set(provider.id, { keys, fetchedAt: Date.now() });
  return keys;
}

export interface TokenResponse {
  idToken: string;
}

/** Exchange an authorization code for tokens at the provider. */
export async function exchangeCode(
  provider: OidcProvider,
  params: { code: string; redirectUri: string; clientId: string; clientSecret: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const response = await fetch(provider.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    throw new OidcError('TOKEN_EXCHANGE_FAILED', 'The sign-in provider rejected the authorization code', 502);
  }

  let parsed: { id_token?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OidcError('TOKEN_EXCHANGE_FAILED', 'The sign-in provider returned an unreadable response', 502);
  }
  if (!parsed.id_token) {
    throw new OidcError('TOKEN_EXCHANGE_FAILED', 'The sign-in provider returned no id_token', 502);
  }
  return { idToken: parsed.id_token };
}

/**
 * Find or create the local account for a verified provider identity.
 *
 * The link is keyed on (provider, provider_user_id), so a returning user is
 * matched to their existing account and a new provider identity is attached to
 * the account with the same verified email. An unverified provider email is
 * never used to attach to an existing account.
 */
export function findOrCreateUser(providerId: string, claims: IdTokenClaims): string {
  const db = getDb();

  const link = db
    .prepare('SELECT user_id FROM social_logins WHERE provider = ? AND provider_user_id = ?')
    .get(providerId, claims.sub) as { user_id: string } | undefined;
  if (link) return link.user_id;

  let userId: string | null = null;
  if (claims.email && claims.emailVerified) {
    const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(claims.email) as
      | { user_id: string }
      | undefined;
    if (existing) userId = existing.user_id;
  }

  if (!userId) {
    if (!claims.email) {
      throw new OidcError('EMAIL_REQUIRED', 'The provider did not return an email address', 400);
    }
    userId = generateId();
    db.prepare(
      `INSERT INTO users (user_id, email, password_hash, email_verified, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    ).run(userId, claims.email, `oidc:${providerId}:${claims.sub}`, claims.emailVerified ? 1 : 0);
  }

  db.prepare(
    `INSERT INTO social_logins (social_id, user_id, provider, provider_user_id, email)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET email = excluded.email`,
  ).run(generateId(), userId, providerId, claims.sub, claims.email ?? null);

  return userId;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Mint a single-use, short-lived code that the browser exchanges for its
 * session tokens.
 *
 * The access token is never placed in a redirect URL; the callback redirects
 * with this opaque code instead, and the code is hashed at rest and marked
 * redeemed on first use so it cannot be replayed.
 */
export function createLoginCode(userId: string, accessToken: string, refreshToken: string | null): string {
  const code = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO oauth_login_codes (code_id, code_hash, user_id, access_token, refresh_token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(generateId(), hashCode(code), userId, accessToken, refreshToken, expiresAt);
  return code;
}

export interface RedeemedLogin {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
}

/** Redeem a login code exactly once, before it expires. */
export function redeemLoginCode(code: string): RedeemedLogin {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT code_id, user_id, access_token, refresh_token, expires_at, redeemed_at
         FROM oauth_login_codes WHERE code_hash = ?`,
    )
    .get(hashCode(String(code ?? ''))) as
    | {
        code_id: string;
        user_id: string;
        access_token: string;
        refresh_token: string | null;
        expires_at: string;
        redeemed_at: string | null;
      }
    | undefined;

  if (!row) throw new OidcError('INVALID_CODE', 'That sign-in code is not recognised', 400);
  if (row.redeemed_at) throw new OidcError('CODE_ALREADY_USED', 'That sign-in code was already used', 409);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OidcError('CODE_EXPIRED', 'That sign-in code has expired', 400);
  }

  db.prepare(`UPDATE oauth_login_codes SET redeemed_at = datetime('now') WHERE code_id = ?`).run(row.code_id);
  return { accessToken: row.access_token, refreshToken: row.refresh_token, userId: row.user_id };
}
