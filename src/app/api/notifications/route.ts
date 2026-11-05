import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listNotifications, unreadCount, markNotificationRead, markAllNotificationsRead } from '@/lib/notifications/inbox';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's notification inbox.
 *
 * Read from the exchange's own `notifications` table. An account that has no
 * notifications gets an empty list and a zero unread count, never a fabricated
 * message.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const unreadOnly = params.get('unread') === 'true';
  const limit = Number(params.get('limit') ?? 20);

  const notifications = listNotifications(auth.user.userId, {
    limit: Number.isFinite(limit) ? limit : 20,
    unreadOnly,
  });

  return NextResponse.json(
    {
      success: true,
      notifications,
      data: notifications,
      unread: unreadCount(auth.user.userId),
    },
    { headers: NO_STORE },
  );
}

/** Mark one notification, or the whole inbox, as read. */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'notifications.read');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const all = body.all === true;
  if (all) {
    const updated = markAllNotificationsRead(auth.user.userId);
    return NextResponse.json({ success: true, updated, unread: 0 }, { headers: NO_STORE });
  }

  const notificationId = String(body.notificationId ?? body.id ?? '').trim();
  if (!notificationId) return fail('VALIDATION_FAILED', 'notificationId is required');

  try {
    const notification = markNotificationRead(auth.user.userId, notificationId);
    return NextResponse.json(
      { success: true, notification, unread: unreadCount(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400;
    const code = (error as { code?: string }).code ?? 'VALIDATION_FAILED';
    return fail(code, (error as Error).message, status);
  }
}
