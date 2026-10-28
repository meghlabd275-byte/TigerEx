import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export interface SessionUser {
  userId: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  kycLevel: string;
  kycStatus: string;
  status: string;
}

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the authenticated user for a native API route.
 *
 * Returns either the user or a ready-to-send error response. Callers must
 * return the response when `error` is present; there is no anonymous fallback,
 * so a missing or expired session can never be treated as a valid account.
 */
export async function requireSession(
  request: NextRequest,
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const token = readBearerToken(request);
  if (!token) {
    return {
      error: NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authorization required' } },
        { status: 401 },
      ),
    };
  }

  const db = getDb();
  const session = db
    .prepare(
      `SELECT s.user_id, u.email, u.phone, u.username, u.kyc_level, u.kyc_status, u.status
         FROM sessions s
         JOIN users u ON s.user_id = u.user_id
        WHERE s.access_token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as
    | {
        user_id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        kyc_level: string;
        kyc_status: string;
        status: string;
      }
    | undefined;

  if (!session) {
    return {
      error: NextResponse.json(
        { success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } },
        { status: 401 },
      ),
    };
  }

  return {
    user: {
      userId: session.user_id,
      email: session.email,
      phone: session.phone,
      username: session.username,
      kycLevel: session.kyc_level,
      kycStatus: session.kyc_status,
      status: session.status,
    },
  };
}
