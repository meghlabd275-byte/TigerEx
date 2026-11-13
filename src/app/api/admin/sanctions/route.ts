import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import {
  addSanctionsEntry,
  validateSanctionsEntry,
  markSanctionsListLoaded,
  sanctionsListLoaded,
  sanctionsEnforced,
  SanctionsError,
} from '@/lib/compliance/sanctions';

/**
 * Sanctions list administration.
 *
 * The list is operator data. This route lists the entries, adds one, and records
 * that a list has been loaded (so a non-match becomes meaningful). Every mutation
 * is appended to the audit log. No entry is ever fabricated; an empty list with
 * enforcement on is a refusal at transaction time, which is the intended state
 * until the operator loads a real list.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 200) || 200, 1), 1000);

  const rows = getDb()
    .prepare(
      `SELECT entry_id, kind, value, list_name, reason, created_at
         FROM sanctions_entries ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      enforced: sanctionsEnforced(),
      listLoaded: sanctionsListLoaded(),
      entries: rows.map((row) => ({
        id: row.entry_id,
        kind: row.kind,
        value: row.value,
        listName: row.list_name,
        reason: row.reason ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.sanctions.write');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const entryId = addSanctionsEntry(validateSanctionsEntry(body));
    // Adding an entry implies a list is now loaded.
    markSanctionsListLoaded(true);
    recordAdminAction(request, auth.admin, 'sanctions.add', { type: 'sanctions_entry', id: entryId });
    return NextResponse.json({ success: true, id: entryId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SanctionsError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** Record that a list has been loaded, or that it has not. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const loaded = body.listLoaded !== false;
  markSanctionsListLoaded(loaded);
  recordAdminAction(request, auth.admin, 'sanctions.list_loaded', { detail: { loaded } });
  return NextResponse.json({ success: true, listLoaded: loaded }, { headers: NO_STORE });
}
