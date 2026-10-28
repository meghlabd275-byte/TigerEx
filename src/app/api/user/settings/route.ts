import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Notification and preference settings for the authenticated user. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT notifications, preferences FROM user_settings WHERE user_id = ?')
      .get(auth.user.userId) as { notifications: string; preferences: string } | undefined;

    return NextResponse.json(
      {
        success: true,
        data: {
          notifications: row ? parseJson(row.notifications) : {},
          preferences: row ? parseJson(row.preferences) : {},
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('User settings GET error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}

/** Upsert the authenticated user's settings. Only known boolean/number keys are stored. */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { notifications?: unknown; preferences?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const sanitize = (input: unknown): Record<string, boolean | string> => {
    const out: Record<string, boolean | string> = {};
    if (input && typeof input === 'object') {
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
        if (typeof value === 'boolean') out[key] = value;
        else if (typeof value === 'string') out[key] = value.slice(0, 64);
      }
    }
    return out;
  };

  const notifications = sanitize(body.notifications);
  const preferences = sanitize(body.preferences);

  try {
    const db = getDb();
    const existing = db
      .prepare('SELECT notifications, preferences FROM user_settings WHERE user_id = ?')
      .get(auth.user.userId) as { notifications: string; preferences: string } | undefined;

    const mergedNotifications = { ...(existing ? parseJson(existing.notifications) : {}), ...notifications };
    const mergedPreferences = { ...(existing ? parseJson(existing.preferences) : {}), ...preferences };

    db.prepare(
      `INSERT INTO user_settings (user_id, notifications, preferences, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         notifications = excluded.notifications,
         preferences = excluded.preferences,
         updated_at = datetime('now')`,
    ).run(auth.user.userId, JSON.stringify(mergedNotifications), JSON.stringify(mergedPreferences));

    return NextResponse.json(
      { success: true, data: { notifications: mergedNotifications, preferences: mergedPreferences } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('User settings PUT error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
