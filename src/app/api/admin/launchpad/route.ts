import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, positive, upper, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Launchpad administration.
 *
 * A project sells a token allocation at a fixed price during a sale window. The
 * window must be ordered and the price positive; a project cannot start selling
 * before the window opens. The operator can create, edit and cancel a sale.
 */

const STATUSES = ['upcoming', 'live', 'completed', 'cancelled'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const projects = db.prepare('SELECT * FROM launchpad_projects ORDER BY start_ns DESC').all() as Array<Record<string, unknown>>;
  const subscriptions = db
    .prepare('SELECT project_id, COUNT(*) AS subscribers, COALESCE(SUM(amount), 0) AS committed FROM launchpad_subscriptions GROUP BY project_id')
    .all() as Array<{ project_id: string; subscribers: number; committed: number }>;

  return NextResponse.json(
    {
      success: true,
      projects: projects.map((row) => {
        const stats = subscriptions.find((s) => s.project_id === row.project_id);
        return {
          projectId: row.project_id,
          tokenSymbol: row.token_symbol,
          name: row.name,
          salePrice: row.sale_price,
          totalAllocation: row.total_allocation,
          raised: row.raised,
          startNs: row.start_ns,
          endNs: row.end_ns,
          vesting: row.vesting,
          status: row.status,
          createdAt: row.created_at,
          subscribers: stats?.subscribers ?? 0,
          committed: stats ? Number(stats.committed) : 0,
        };
      }),
    },
    { headers: NO_STORE },
  );
}

/** Create or edit a launchpad project. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.launchpad');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const tokenSymbol = upper(body.tokenSymbol);
  if (!/^[A-Z0-9]{2,20}$/.test(tokenSymbol)) return fail('VALIDATION_FAILED', 'tokenSymbol is required');

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 120) return fail('VALIDATION_FAILED', 'name is required');

  const salePrice = positive(body.salePrice);
  if (salePrice === null) return fail('VALIDATION_FAILED', 'salePrice must be a positive number');

  const totalAllocation = positive(body.totalAllocation);
  if (totalAllocation === null) return fail('VALIDATION_FAILED', 'totalAllocation must be a positive number');

  const startNs = Number(body.startNs);
  const endNs = Number(body.endNs);
  if (!Number.isInteger(startNs) || !Number.isInteger(endNs) || startNs <= 0 || endNs <= 0) {
    return fail('VALIDATION_FAILED', 'startNs and endNs must be positive integer nanosecond timestamps');
  }
  if (endNs <= startNs) return fail('VALIDATION_FAILED', 'endNs must be after startNs');

  const vesting = body.vesting === undefined ? {} : body.vesting;
  const status = String(body.status ?? 'upcoming').toLowerCase();
  if (!STATUSES.includes(status)) return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);

  const db = getDb();
  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null;

  if (projectId) {
    const existing = db.prepare('SELECT project_id FROM launchpad_projects WHERE project_id = ?').get(projectId);
    if (!existing) return fail('UNKNOWN_PROJECT', 'No such project', 404);
    db.prepare(
      `UPDATE launchpad_projects
          SET token_symbol = ?, name = ?, sale_price = ?, total_allocation = ?, start_ns = ?, end_ns = ?,
              vesting = ?, status = ?
        WHERE project_id = ?`,
    ).run(tokenSymbol, name, salePrice, totalAllocation, startNs, endNs, JSON.stringify(vesting), status, projectId);
    recordAdminAction(request, auth.admin, 'launchpad.update', { type: 'launchpad_project', id: projectId, detail: { tokenSymbol, name, salePrice, status } });
    return NextResponse.json({ success: true, projectId }, { headers: NO_STORE });
  }

  const newId = generateId();
  db.prepare(
    `INSERT INTO launchpad_projects (project_id, token_symbol, name, sale_price, total_allocation, start_ns, end_ns, vesting, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId, tokenSymbol, name, salePrice, totalAllocation, startNs, endNs, JSON.stringify(vesting), status);

  recordAdminAction(request, auth.admin, 'launchpad.create', { type: 'launchpad_project', id: newId, detail: { tokenSymbol, name, salePrice, status } });
  return NextResponse.json({ success: true, projectId: newId }, { status: 201, headers: NO_STORE });
}

/** Cancel a project. Subscriptions remain so allocations can be refunded. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.launchpad.cancel');
  if (guard) return guard;

  const projectId = request.nextUrl.searchParams.get('projectId')?.trim();
  if (!projectId || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
    return fail('VALIDATION_FAILED', 'projectId query parameter is required');
  }

  const db = getDb();
  const result = db.prepare("UPDATE launchpad_projects SET status = 'cancelled' WHERE project_id = ?").run(projectId);
  if (result.changes === 0) return fail('UNKNOWN_PROJECT', 'No such project', 404);

  recordAdminAction(request, auth.admin, 'launchpad.cancel', { type: 'launchpad_project', id: projectId });
  return NextResponse.json({ success: true, projectId, status: 'cancelled' }, { headers: NO_STORE });
}
