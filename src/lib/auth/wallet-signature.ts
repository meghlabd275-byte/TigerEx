/**
 * Pure helpers for wallet-signature (EIP-191) authentication.
 *
 * These functions contain no database or network access so they can be unit
 * tested directly; the challenge store and the signature recovery live in
 * `wallet.ts`.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Normalize an EVM address to its canonical lower-case form.
 *
 * Returns null for anything that is not a 20-byte hex address, so a malformed
 * address is rejected rather than silently coerced.
 */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * The human-readable message a wallet signs.
 *
 * The address and nonce are included so a signature cannot be replayed against
 * a different account, and the issued-at time lets the server bound the age of
 * a challenge. The nonce is the single-use secret: only the server that issued
 * it can accept a signature over it.
 */
export function buildChallengeMessage(address: string, nonce: string, issuedAtMs: number): string {
  const normalized = normalizeAddress(address);
  if (!normalized) throw new Error('invalid address');
  if (!nonce || nonce.length < 16) throw new Error('nonce must be at least 16 characters');
  return [
    'TigerEx wants you to sign in with your wallet:',
    normalized,
    '',
    'Signing this message proves you control this address. It authorises no transfer.',
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAtMs).toISOString()}`,
  ].join('\n');
}

/** Whether two addresses refer to the same account, ignoring case. */
export function sameAddress(a: string, b: string): boolean {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  return left !== null && right !== null && left === right;
}

/** Whether a challenge issued at `issuedAtMs` is still within its window. */
export function isChallengeFresh(issuedAtMs: number, nowMs: number, windowMs: number): boolean {
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(windowMs)) return false;
  if (windowMs <= 0) return false;
  const age = nowMs - issuedAtMs;
  // A challenge from the future is treated as invalid rather than trusted, so a
  // skewed clock cannot extend its life.
  return age >= 0 && age <= windowMs;
}
