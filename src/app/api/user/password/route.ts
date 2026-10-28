import { NextRequest, NextResponse } from 'next/server';
import { getDb, hashPassword, verifyPassword } from '@/lib/db';
import { requireSession } from '@/lib/db/session';

/**
 * Change the authenticated user's password.
 *
 * The current password is verified before the change, and all other sessions
 * are revoked so a stolen session cannot survive a password rotation.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const currentPassword = String(body.currentPassword ?? '');
  const newPassword = String(body.newPassword ?? '');

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_FIELDS', message: 'currentPassword and newPassword are required' } },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { success: false, error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 8 characters' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT password_hash FROM users WHERE user_id = ?')
      .get(auth.user.userId) as { password_hash: string } | undefined;
    if (!row) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 },
      );
    }

    if (!verifyPassword(currentPassword, row.password_hash)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } },
        { status: 401 },
      );
    }

    const newHash = hashPassword(newPassword);
    const token = request.headers.get('authorization')?.slice(7) ?? '';

    const apply = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
        newHash,
        auth.user.userId,
      );
      // Revoke every session except the one making the request.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND access_token != ?').run(
        auth.user.userId,
        token,
      );
    });
    apply();

    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
