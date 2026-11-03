import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Support desk.
 *
 * A ticket carries a subject, a category and a priority; its messages are
 * append-only so a support conversation cannot be rewritten. The operator can
 * assign, reprioritise, reply and close.
 */

const STATUSES = ['open', 'pending', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CATEGORIES = ['account', 'deposit', 'withdrawal', 'trading', 'kyc', 'api', 'other'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim();
  const ticketId = request.nextUrl.searchParams.get('ticketId')?.trim();
  const db = getDb();

  if (ticketId) {
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE ticket_id = ?').get(ticketId);
    if (!ticket) return fail('UNKNOWN_TICKET', 'No such ticket', 404);
    const messages = db
      .prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(ticketId);
    return NextResponse.json({ success: true, ticket, messages }, { headers: NO_STORE });
  }

  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(`SELECT * FROM support_tickets${where} ORDER BY created_at DESC LIMIT 500`)
    .all(...params);

  return NextResponse.json({ success: true, tickets: rows }, { headers: NO_STORE });
}

/**
 * Update a ticket or append a reply.
 *
 * A reply is a message with `authorType = admin`; changing status to `closed`
 * is recorded. The message body is stored as plain text.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.support');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const ticketId = typeof body.ticketId === 'string' ? body.ticketId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ticketId)) return fail('VALIDATION_FAILED', 'Invalid ticket id');

  const db = getDb();
  const ticket = db.prepare('SELECT status FROM support_tickets WHERE ticket_id = ?').get(ticketId) as
    | { status: string }
    | undefined;
  if (!ticket) return fail('UNKNOWN_TICKET', 'No such ticket', 404);

  const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
  if (reply.length > 10000) return fail('VALIDATION_FAILED', 'reply is too long');

  const status = body.status === undefined ? null : String(body.status).toLowerCase();
  if (status !== null && !STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const priority = body.priority === undefined ? null : String(body.priority).toLowerCase();
  if (priority !== null && !PRIORITIES.includes(priority)) {
    return fail('VALIDATION_FAILED', `priority must be one of ${PRIORITIES.join(', ')}`);
  }

  const assignedTo = body.assignedTo === undefined ? null : String(body.assignedTo).slice(0, 64);

  if (reply.length > 0) {
    db.prepare(
      `INSERT INTO support_messages (message_id, ticket_id, author_type, author_id, body)
       VALUES (?, ?, 'admin', ?, ?)`,
    ).run(generateId(), ticketId, auth.admin.adminId, reply);
  }

  db.prepare(
    `UPDATE support_tickets
        SET status = COALESCE(?, status), priority = COALESCE(?, priority),
            assigned_to = COALESCE(?, assigned_to), updated_at = datetime('now')
      WHERE ticket_id = ?`,
  ).run(status, priority, assignedTo, ticketId);

  recordAdminAction(request, auth.admin, 'support.ticket.update', {
    type: 'support_ticket',
    id: ticketId,
    detail: { status, priority, assignedTo, replied: reply.length > 0 },
  });

  return NextResponse.json({ success: true, ticketId, status: status ?? ticket.status }, { headers: NO_STORE });
}

/** Open a ticket on behalf of a user (for example from an email report). */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.support.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (subject.length === 0 || subject.length > 200) {
    return fail('VALIDATION_FAILED', 'subject is required and must be at most 200 characters');
  }

  const category = String(body.category ?? '').toLowerCase();
  if (!CATEGORIES.includes(category)) {
    return fail('VALIDATION_FAILED', `category must be one of ${CATEGORIES.join(', ')}`);
  }

  const priority = String(body.priority ?? 'normal').toLowerCase();
  if (!PRIORITIES.includes(priority)) {
    return fail('VALIDATION_FAILED', `priority must be one of ${PRIORITIES.join(', ')}`);
  }

  const userId = body.userId === undefined || body.userId === null ? null : String(body.userId).slice(0, 64);

  const ticketId = generateId();
  const db = getDb();
  db.prepare(
    `INSERT INTO support_tickets (ticket_id, user_id, subject, category, priority, status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
  ).run(ticketId, userId, subject, category, priority);

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > 0) {
    db.prepare(
      `INSERT INTO support_messages (message_id, ticket_id, author_type, author_id, body)
       VALUES (?, ?, 'admin', ?, ?)`,
    ).run(generateId(), ticketId, auth.admin.adminId, message);
  }

  recordAdminAction(request, auth.admin, 'support.ticket.create', {
    type: 'support_ticket',
    id: ticketId,
    detail: { subject, category, priority, userId },
  });

  return NextResponse.json({ success: true, ticketId }, { status: 201, headers: NO_STORE });
}
