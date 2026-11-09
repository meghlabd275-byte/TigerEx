import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { scanPositions, processQueue } from '@/lib/trading/risk-supervisor';
import { runAdl, runArmedAdl, AdlError } from '@/lib/trading/adl';

/**
 * The liquidation work queue.
 *
 * A row is an instruction to a liquidation bot, not a fabricated order: it is
 * created by the risk engine when a position breaches its maintenance margin.
 * An operator can list the queue, claim an entry for a bot, or mark it executed
 * once the close is confirmed on the book.
 */

const STATUSES = ['pending', 'claimed', 'executed', 'cancelled'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM liquidation_queue${where} ORDER BY created_at ASC LIMIT 1000`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, queue: rows }, { headers: NO_STORE });
}

/**
 * Advance a queue entry's status.
 *
 * `claimed` records the bot handling it; `executed` stamps the completion time.
 * The allowed transitions are enforced so a cancelled entry cannot be marked
 * executed.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.liquidation');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const entryId = String(body.entryId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(entryId)) return fail('VALIDATION_FAILED', 'Invalid entry id');

  const status = String(body.status ?? '').toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const db = getDb();
  const entry = db.prepare('SELECT status FROM liquidation_queue WHERE entry_id = ?').get(entryId) as
    | { status: string }
    | undefined;
  if (!entry) return fail('UNKNOWN_ENTRY', 'No such liquidation entry', 404);

  if (entry.status === 'executed' || entry.status === 'cancelled') {
    return fail('TERMINAL_STATE', `This entry is already ${entry.status}`, 409);
  }

  if (status === 'executed') {
    db.prepare("UPDATE liquidation_queue SET status = 'executed', executed_at = datetime('now') WHERE entry_id = ?").run(entryId);
  } else {
    db.prepare('UPDATE liquidation_queue SET status = ? WHERE entry_id = ?').run(status, entryId);
  }

  recordAdminAction(request, auth.admin, 'liquidation.update', {
    type: 'liquidation_entry',
    id: entryId,
    detail: { from: entry.status, to: status },
  });

  return NextResponse.json({ success: true, entryId, status }, { headers: NO_STORE });
}

/**
 * Run the liquidation cycle.
 *
 * `action: 'scan'` re-prices every open position and enqueues the ones that
 * have breached maintenance margin; `action: 'execute'` closes the queued
 * positions at the mark and settles the insurance fund. Both are audited.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.liquidation.run');
  if (guard) return guard;

  const body = await readJson(request);
  const action = String(body?.action ?? 'scan').toLowerCase();
  if (!['scan', 'execute', 'adl'].includes(action)) {
    return fail('VALIDATION_FAILED', "action must be 'scan', 'execute' or 'adl'");
  }

  if (action === 'scan') {
    const result = scanPositions();
    recordAdminAction(request, auth.admin, 'liquidation.scan', {
      type: 'liquidation_cycle',
      detail: { scanned: result.scanned, queued: result.queued.length, unpriced: result.unpriced.length },
    });
    return NextResponse.json({ success: true, action, ...result }, { headers: NO_STORE });
  }

  if (action === 'adl') {
    // A named contract runs ADL for that contract alone; otherwise every fund
    // that has armed ADL is swept.
    const contract = body?.contract === undefined ? null : String(body.contract).trim().toUpperCase();
    if (contract && !/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(contract)) {
      return fail('VALIDATION_FAILED', 'contract must be of the form BASE/QUOTE');
    }
    try {
      const results = contract ? [runAdl(contract)] : runArmedAdl();
      const ran = results.filter((result) => result.ran);
      recordAdminAction(request, auth.admin, 'liquidation.adl', {
        type: 'liquidation_cycle',
        detail: {
          contract,
          contracts: ran.map((result) => result.contract),
          clawedBack: ran.reduce((sum, result) => sum + result.clawedBack, 0),
        },
      });
      return NextResponse.json({ success: true, action, results }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof AdlError) return fail(error.code, error.message, error.status);
      throw error;
    }
  }

  const limit = body?.limit === undefined ? 50 : Number(body.limit);
  const result = processQueue(Number.isFinite(limit) ? limit : 50);
  recordAdminAction(request, auth.admin, 'liquidation.execute', {
    type: 'liquidation_cycle',
    detail: { processed: result.processed.length, skipped: result.skipped.length },
  });
  return NextResponse.json({ success: true, action, ...result }, { headers: NO_STORE });
}
