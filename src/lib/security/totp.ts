import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { encrypt, decrypt } from '@/lib/db';

/**
 * Time-based one-time passwords (RFC 6238) for authenticator apps.
 *
 * Secrets are stored AES-256-GCM encrypted and are only ever decrypted
 * server-side to check a submitted code. The plaintext secret is returned
 * exactly once, at enrolment, so the user can add it to their authenticator.
 */

const ISSUER = 'TigerEx';

// Allow one adjacent window so a code submitted at a window boundary is not
// rejected purely because of clock skew.
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(secret: string, accountLabel: string): string {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

export async function renderQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
}

export function verifyTotp(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  try {
    return authenticator.verify({ token: code.replace(/\s+/g, ''), secret });
  } catch {
    return false;
  }
}

export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptSecret(stored: string): string {
  return decrypt(stored);
}
