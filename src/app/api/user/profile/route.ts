import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';

/** Profile for the authenticated user. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT user_id, email, phone, username, display_name, country_code, language,
                timezone, kyc_level, kyc_status, two_factor_enabled, anti_phishing_code,
                status, created_at, last_login_at, referral_code
           FROM users WHERE user_id = ?`,
      )
      .get(auth.user.userId) as Record<string, unknown> | undefined;

    if (!row) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          userId: row.user_id,
          email: row.email,
          phone: row.phone,
          username: row.username,
          displayName: row.display_name,
          countryCode: row.country_code,
          language: row.language,
          timezone: row.timezone,
          kycLevel: row.kyc_level,
          kycStatus: row.kyc_status,
          twoFactorEnabled: !!row.two_factor_enabled,
          antiPhishingCode: row.anti_phishing_code,
          status: row.status,
          createdAt: row.created_at,
          lastLoginAt: row.last_login_at,
          referralCode: row.referral_code,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('User profile GET error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}

/** Update the authenticated user's editable profile fields. */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.username !== undefined) {
    const username = String(body.username).trim();
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_USERNAME', message: 'Username must be 3-32 characters (letters, numbers, underscore)' } },
        { status: 400 },
      );
    }
    updates.push('username = ?');
    values.push(username);
  }

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName).trim();
    if (displayName.length > 64) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_DISPLAY_NAME', message: 'Display name is too long' } },
        { status: 400 },
      );
    }
    updates.push('display_name = ?');
    values.push(displayName);
  }

  if (body.language !== undefined) {
    updates.push('language = ?');
    values.push(String(body.language).slice(0, 16));
  }
  if (body.timezone !== undefined) {
    updates.push('timezone = ?');
    values.push(String(body.timezone).slice(0, 64));
  }
  if (body.antiPhishingCode !== undefined) {
    updates.push('anti_phishing_code = ?');
    values.push(String(body.antiPhishingCode).slice(0, 32));
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: 'NO_FIELDS', message: 'No updatable fields supplied' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    values.push(auth.user.userId);
    db.prepare(
      `UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now') WHERE user_id = ?`,
    ).run(...values);

    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return NextResponse.json(
        { success: false, error: { code: 'USERNAME_TAKEN', message: 'That username is already taken' } },
        { status: 409 },
      );
    }
    console.error('User profile PUT error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
