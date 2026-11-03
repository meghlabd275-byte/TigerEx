import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';

/**
 * P2P administration.
 *
 * Disputes are the operator's main job here: an order whose buyer and seller
 * disagree is frozen until resolved, and the resolution records which side the
 * escrow was released to. The escrow state machine itself lives in the P2P
 * engine; this route only records the human decision.
 */

const DISPUTE_RESOLUTIONS = ['release_to_buyer', 'refund_to_seller', 'split'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const disputes = db
    .prepare(
      `SELECT d.dispute_id, d.order_id, d.opened_by, d.reason, d.status, d.resolution, d.created_at,
              o.asset, o.fiat, o.price, o.amount, o.escrow_amount, o.status AS order_status
         FROM p2p_disputes d
         LEFT JOIN p2p_orders o ON o.order_id = d.order_id
        ORDER BY d.created_at DESC LIMIT 500`,
    )
    .all() as Array<Record<string, unknown>>;

  const offers = db
    .prepare('SELECT * FROM p2p_offers ORDER BY created_at DESC LIMIT 500')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      disputes: disputes.map((row) => ({
        disputeId: row.dispute_id,
        orderId: row.order_id,
        openedBy: row.opened_by,
        reason: row.reason,
        status: row.status,
        resolution: row.resolution ?? null,
        createdAt: row.created_at,
        order: {
          asset: row.asset,
          fiat: row.fiat,
          price: row.price,
          amount: row.amount,
          escrowAmount: row.escrow_amount,
          status: row.order_status,
        },
      })),
      offers: offers.map((row) => ({
        offerId: row.offer_id,
        userId: row.user_id,
        side: row.side,
        asset: row.asset,
        fiat: row.fiat,
        price: row.price,
        minAmount: row.min_amount,
        maxAmount: row.max_amount,
        available: row.available,
        paymentMethods: parseJsonColumn<string[]>(row.payment_methods, []),
        status: row.status,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Resolve a P2P dispute. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.p2p');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const disputeId = typeof body.disputeId === 'string' ? body.disputeId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(disputeId)) return fail('VALIDATION_FAILED', 'Invalid dispute id');

  const resolution = String(body.resolution ?? '').toLowerCase();
  if (!DISPUTE_RESOLUTIONS.includes(resolution)) {
    return fail('VALIDATION_FAILED', `resolution must be one of ${DISPUTE_RESOLUTIONS.join(', ')}`);
  }

  const db = getDb();
  const dispute = db.prepare('SELECT status FROM p2p_disputes WHERE dispute_id = ?').get(disputeId) as
    | { status: string }
    | undefined;
  if (!dispute) return fail('UNKNOWN_DISPUTE', 'No such dispute', 404);
  if (dispute.status !== 'open') return fail('ALREADY_RESOLVED', `This dispute is already ${dispute.status}`, 409);

  db.prepare("UPDATE p2p_disputes SET status = 'resolved', resolution = ? WHERE dispute_id = ?").run(resolution, disputeId);

  recordAdminAction(request, auth.admin, 'p2p.dispute.resolve', {
    type: 'p2p_dispute',
    id: disputeId,
    detail: { resolution },
  });

  return NextResponse.json({ success: true, disputeId, resolution }, { headers: NO_STORE });
}
