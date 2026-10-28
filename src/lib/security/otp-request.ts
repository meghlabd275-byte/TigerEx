import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { issueOtp, type OtpPurpose } from '@/lib/security/otp';
import { emailDeliveryUnavailable } from '@/lib/security/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedDestination {
  email: string | null;
  phone: string | null;
}

/** Interpret a submitted identifier as an email or a normalised phone number. */
export function parseDestination(value: unknown): ParsedDestination | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 254) return null;
  if (EMAIL_RE.test(raw)) return { email: raw.toLowerCase(), phone: null };
  const phone = raw.replace(/[^0-9+]/g, '');
  if (phone.replace(/\D/g, '').length < 6) return null;
  return { email: null, phone };
}

export interface SendResult {
  response: NextResponse | null;
}

/**
 * Issue and deliver a verification code for an account that exists.
 *
 * Delivery failures are surfaced as errors, never as success, so the client
 * only advances once a code was genuinely sent.
 */
export async function sendOtpToExistingUser(
  purpose: OtpPurpose,
  destination: ParsedDestination,
): Promise<NextResponse> {
  const db = getDb();
  const user = destination.email
    ? (db.prepare('SELECT user_id FROM users WHERE email = ?').get(destination.email) as
        | { user_id: string }
        | undefined)
    : (db.prepare('SELECT user_id FROM users WHERE phone = ?').get(destination.phone) as
        | { user_id: string }
        | undefined);

  if (!user) {
    // Do not reveal whether the account exists.
    return NextResponse.json({ success: true, data: { sent: true } }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const result = await issueOtp({
    purpose,
    userId: user.user_id,
    email: destination.email,
    phone: destination.phone,
  });

  if (!result.delivered) {
    if (result.reason === 'EMAIL_DELIVERY_NOT_CONFIGURED' || result.reason === 'SMS_DELIVERY_NOT_CONFIGURED') {
      return emailDeliveryUnavailable();
    }
    return NextResponse.json(
      { success: false, error: { code: result.reason || 'DELIVERY_FAILED', message: 'Verification code could not be delivered' } },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, data: { sent: true } }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Issue and deliver a registration code for an address that is not yet taken.
 */
export async function sendRegistrationOtp(destination: ParsedDestination): Promise<NextResponse> {
  const db = getDb();
  if (destination.email) {
    const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(destination.email);
    if (existing) {
      return NextResponse.json(
        { success: false, error: { code: 'EMAIL_TAKEN', message: 'An account already uses this email' } },
        { status: 409 },
      );
    }
  }
  if (destination.phone) {
    const existing = db.prepare('SELECT user_id FROM users WHERE phone = ?').get(destination.phone);
    if (existing) {
      return NextResponse.json(
        { success: false, error: { code: 'PHONE_TAKEN', message: 'An account already uses this phone number' } },
        { status: 409 },
      );
    }
  }

  const result = await issueOtp({
    purpose: 'register',
    email: destination.email,
    phone: destination.phone,
  });

  if (!result.delivered) {
    if (result.reason === 'EMAIL_DELIVERY_NOT_CONFIGURED' || result.reason === 'SMS_DELIVERY_NOT_CONFIGURED') {
      return emailDeliveryUnavailable();
    }
    return NextResponse.json(
      { success: false, error: { code: result.reason || 'DELIVERY_FAILED', message: 'Verification code could not be delivered' } },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, data: { sent: true } }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
