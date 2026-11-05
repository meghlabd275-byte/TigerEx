/**
 * The account notification inbox.
 *
 * Rows live in the venue's own `notifications` table. A notification is
 * addressed to exactly one user, so every read is scoped by `user_id` and a
 * caller can never see another account's inbox.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';

export interface NotificationView {
  id: string;
  notification_id: string;
  type: string;
  title: string;
  message: string;
  body: string;
  severity: string;
  read: boolean;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  createdAt: string;
}

function toView(row: Record<string, unknown>): NotificationView {
  const readAt = row.read_at === null || row.read_at === undefined ? null : String(row.read_at);
  return {
    id: String(row.notification_id),
    notification_id: String(row.notification_id),
    type: String(row.type),
    title: String(row.title),
    message: String(row.body),
    body: String(row.body),
    severity: String(row.severity),
    read: readAt !== null,
    is_read: readAt !== null,
    read_at: readAt,
    created_at: String(row.created_at),
    createdAt: String(row.created_at),
  };
}

/**
 * The caller's notifications, newest first.
 *
 * `unreadOnly` filters to rows that have not been read. `limit` is clamped so
 * a caller cannot request an unbounded scan.
 */
export function listNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): NotificationView[] {
  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(Math.trunc(options.limit as number), 1), 200) : 20;
  const clauses = ['user_id = ?'];
  const params: Array<string | number> = [userId];
  if (options.unreadOnly) clauses.push('read_at IS NULL');

  const rows = getDb()
    .prepare(`SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, notification_id DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(toView);
}

/** The number of unread notifications for the account. */
export function unreadCount(userId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId) as { n: number } | undefined;
  return Number(row?.n) || 0;
}

/**
 * Mark one notification read.
 *
 * The row must belong to the caller; a notification that does not exist for
 * this user is reported as not found rather than silently ignored.
 */
export function markNotificationRead(userId: string, notificationId: string): NotificationView {
  const id = String(notificationId ?? '').trim();
  if (!id) throw new Error('A notification id is required');

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM notifications WHERE notification_id = ? AND user_id = ?')
    .get(id, userId) as Record<string, unknown> | undefined;
  if (!existing) throw Object.assign(new Error('No such notification'), { code: 'NOT_FOUND', status: 404 });

  if (existing.read_at === null || existing.read_at === undefined) {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE notification_id = ?").run(id);
  }

  const row = db.prepare('SELECT * FROM notifications WHERE notification_id = ?').get(id) as Record<string, unknown>;
  return toView(row);
}

/** Mark every unread notification read, returning how many were changed. */
export function markAllNotificationsRead(userId: string): number {
  const result = getDb()
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(userId);
  return Number(result.changes) || 0;
}
