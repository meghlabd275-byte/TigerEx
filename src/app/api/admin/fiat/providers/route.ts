import { NextRequest, NextResponse } from 'next/server';
import { enforceRequestGuards } from '@/lib/api/route-guards';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { listFiatProviders } from '@/lib/fiat/ramp';

export const dynamic = 'force-dynamic';

/**
 * Fiat on/off-ramp provider administration.
 *
 * The operator lists the PSPs it has contracted with; the exchange itself has
 * no built-in provider, so an empty table means no fiat ramp. Every mutation is
 * audited. A provider that has pending orders cannot be deleted.
 */

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ success: true, data: listFiatProviders() });
}

interface ProviderInput {
  providerId?: string;
  name: string;
  logo?: string | null;
  paymentMethods?: string[];
  minLimit?: number;
  maxLimit?: number;
  feePercent?: number;
  status?: string;
}

function validate(input: ProviderInput): string | null {
  if (!input.name || !input.name.trim()) return 'name is required';
  const min = Number(input.minLimit ?? 0);
  const max = Number(input.maxLimit ?? 0);
  const fee = Number(input.feePercent ?? 0);
  if (!Number.isFinite(min) || min < 0) return 'minLimit must be a non-negative number';
  if (!Number.isFinite(max) || max <= 0) return 'maxLimit must be a positive number';
  if (max < min) return 'maxLimit must be at least minLimit';
  if (!Number.isFinite(fee) || fee < 0 || fee >= 100) return 'feePercent must be a percentage in [0, 100)';
  if (input.paymentMethods && !Array.isArray(input.paymentMethods)) return 'paymentMethods must be an array';
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.fiat.providers.post');
  if (guard) return guard;

  let body: ProviderInput;
  try {
    body = (await request.json()) as ProviderInput;
  } catch {
    return fail('INVALID_BODY', 'Invalid JSON body');
  }

  const problem = validate(body);
  if (problem) return fail('VALIDATION_FAILED', problem);

  const db = getDb();
  const providerId = body.providerId?.trim() || generateId();
  const existing = db.prepare('SELECT provider_id FROM fiat_providers WHERE provider_id = ?').get(providerId);
  if (existing) return fail('DUPLICATE_PROVIDER', 'A provider with that id already exists', 409);

  db.prepare(
    `INSERT INTO fiat_providers
       (provider_id, name, logo, payment_methods, min_limit, max_limit, fee_percent, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    providerId,
    body.name.trim(),
    body.logo ?? null,
    JSON.stringify(body.paymentMethods ?? []),
    Number(body.minLimit ?? 0),
    Number(body.maxLimit ?? 0),
    Number(body.feePercent ?? 0),
    body.status ?? 'active',
  );

  recordAdminAction(request, auth.admin, 'fiat.provider.create', { type: 'fiat_provider', id: providerId, detail: { name: body.name } });
  return NextResponse.json({ success: true, data: { providerId } }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.fiat.providers.put');
  if (guard) return guard;

  let body: ProviderInput & { providerId: string };
  try {
    body = (await request.json()) as ProviderInput & { providerId: string };
  } catch {
    return fail('INVALID_BODY', 'Invalid JSON body');
  }
  if (!body.providerId) return fail('VALIDATION_FAILED', 'providerId is required');

  const db = getDb();
  const existing = db.prepare('SELECT provider_id FROM fiat_providers WHERE provider_id = ?').get(body.providerId);
  if (!existing) return fail('PROVIDER_NOT_FOUND', 'No such provider', 404);

  // Partial update: write only the fields present so a status toggle does not
  // rewrite limits or fees.
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    values.push(body.name);
  }
  if (body.logo !== undefined) {
    sets.push('logo = ?');
    values.push(body.logo);
  }
  if (body.paymentMethods !== undefined) {
    sets.push('payment_methods = ?');
    values.push(JSON.stringify(body.paymentMethods));
  }
  if (body.minLimit !== undefined) {
    sets.push('min_limit = ?');
    values.push(Number(body.minLimit));
  }
  if (body.maxLimit !== undefined) {
    sets.push('max_limit = ?');
    values.push(Number(body.maxLimit));
  }
  if (body.feePercent !== undefined) {
    sets.push('fee_percent = ?');
    values.push(Number(body.feePercent));
  }
  if (body.status !== undefined) {
    sets.push('status = ?');
    values.push(body.status);
  }
  if (sets.length === 0) return fail('NO_CHANGES', 'No updatable fields were provided');

  values.push(body.providerId);
  db.prepare(`UPDATE fiat_providers SET ${sets.join(', ')} WHERE provider_id = ?`).run(...values);
  recordAdminAction(request, auth.admin, 'fiat.provider.update', { type: 'fiat_provider', id: body.providerId, detail: { fields: sets.length } });
  return NextResponse.json({ success: true, data: { providerId: body.providerId } });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const providerId = request.nextUrl.searchParams.get('providerId');
  if (!providerId) return fail('VALIDATION_FAILED', 'providerId is required');

  const db = getDb();
  const pending = db
    .prepare("SELECT COUNT(*) AS count FROM fiat_orders WHERE provider_id = ? AND status = 'pending'")
    .get(providerId) as { count: number };
  if (Number(pending.count) > 0) {
    return fail('PROVIDER_HAS_PENDING_ORDERS', 'A provider with pending orders cannot be removed', 409);
  }

  const result = db.prepare('DELETE FROM fiat_providers WHERE provider_id = ?').run(providerId);
  if (result.changes === 0) return fail('PROVIDER_NOT_FOUND', 'No such provider', 404);
  recordAdminAction(request, auth.admin, 'fiat.provider.delete', { type: 'fiat_provider', id: providerId });
  return NextResponse.json({ success: true });
}
