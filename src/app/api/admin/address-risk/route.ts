import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { listAddressRisk, setAddressRisk, removeAddressRisk, type RiskBand } from '@/lib/compliance/address-risk';

/**
 * Destination-address risk administration.
 *
 * GET lists the operator's risk entries. POST adds or updates one (band low /
 * medium / high / blocked, with an optional reason). DELETE removes one. A
 * `blocked` entry refuses withdrawals to that address; medium/high raise the
 * score so a withdrawal is held for review. Every mutation is audited.
 */
export const dynamic = 'force-dynamic';

const BANDS: RiskBand[] = ['low', 'medium', 'high', 'blocked'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? 200);
  return NextResponse.json({ success: true, entries: listAddressRisk(limit) }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.address_risk.write');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const address = String(body.address ?? '').trim();
  const network = String(body.network ?? '').trim();
  const band = String(body.band ?? '').trim() as RiskBand;
  if (!address || !network) return fail('VALIDATION_FAILED', 'address and network are required');
  if (!BANDS.includes(band)) return fail('VALIDATION_FAILED', 'band must be low, medium, high or blocked');

  setAddressRisk(address, network, band, body.reason ? String(body.reason) : null);
  recordAdminAction(request, auth.admin, 'address_risk.set', {
    type: 'address_risk',
    id: address,
    detail: { network, band },
  });
  return NextResponse.json({ success: true }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address') ?? '';
  const network = searchParams.get('network') ?? '';
  if (!address || !network) return fail('VALIDATION_FAILED', 'address and network query params are required');

  const removed = removeAddressRisk(address, network);
  if (!removed) return fail('NOT_FOUND', 'No risk entry for that address and network', 404);
  recordAdminAction(request, auth.admin, 'address_risk.remove', {
    type: 'address_risk',
    id: address,
    detail: { network },
  });
  return NextResponse.json({ success: true }, { headers: NO_STORE });
}
