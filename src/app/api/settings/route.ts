import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { securitySettings } from '@/lib/security/account';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The caller's account settings.
 *
 * Notification and preference blobs are the exchange's own `user_settings`
 * row; the security flags are read from the account's dedicated columns so a
 * client sees the same values the security controls enforce.
 */
function readSettings(userId: string): { notifications: Record<string, unknown>; preferences: Record<string, unknown> } {
  const row = getDb()
    .prepare('SELECT notifications, preferences FROM user_settings WHERE user_id = ?')
    .get(userId) as { notifications: string; preferences: string } | undefined;

  const parse = (raw: string | undefined): Record<string, unknown> => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  return { notifications: parse(row?.notifications), preferences: parse(row?.preferences) };
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const settings = { ...readSettings(auth.user.userId), security: securitySettings(auth.user.userId) };
  return NextResponse.json({ success: true, settings, data: settings }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'settings.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const notifications = body.notifications;
  const preferences = body.preferences;
  if (notifications !== undefined && (typeof notifications !== 'object' || notifications === null || Array.isArray(notifications))) {
    return fail('VALIDATION_FAILED', 'notifications must be an object');
  }
  if (preferences !== undefined && (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences))) {
    return fail('VALIDATION_FAILED', 'preferences must be an object');
  }

  const db = getDb();
  const current = readSettings(auth.user.userId);
  const nextNotifications = notifications === undefined ? current.notifications : { ...current.notifications, ...(notifications as Record<string, unknown>) };
  const nextPreferences = preferences === undefined ? current.preferences : { ...current.preferences, ...(preferences as Record<string, unknown>) };

  db.prepare(
    `INSERT INTO user_settings (user_id, notifications, preferences, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET notifications = excluded.notifications,
       preferences = excluded.preferences, updated_at = datetime('now')`,
  ).run(auth.user.userId, JSON.stringify(nextNotifications), JSON.stringify(nextPreferences));

  const settings = { notifications: nextNotifications, preferences: nextPreferences, security: securitySettings(auth.user.userId) };
  return NextResponse.json({ success: true, settings, data: settings }, { headers: NO_STORE });
}
