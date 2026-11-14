import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { listAlerts, resolveAlert, runSurveillanceCycle } from '@/lib/compliance/surveillance';

/**
 * Market-integrity surveillance administration.
 *
 * GET lists the recorded alerts (open by default). POST runs a surveillance pass
 * on demand and returns the alerts it newly raised. PUT records a disposition on
 * one alert so the trail shows it was reviewed. Every mutation is appended to
 * the admin audit log. Alerts are derived only from the venue's own recorded
 * trades and orders — nothing is fabricated.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'open';
  const limit = Number(searchParams.get('limit') ?? 200);
  return NextResponse.json({ success: true, alerts: listAlerts({ status, limit }) }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.surveillance.run');
  if (guard) return guard;

  const body = (await readJson(request)) ?? {};
  const rawLookback = Number(body.lookbackMs);
  const lookbackMs = Number.isFinite(rawLookback) && rawLookback > 0 ? rawLookback : undefined;
  const result = runSurveillanceCycle(Date.now(), lookbackMs);
  recordAdminAction(request, auth.admin, 'surveillance.run', {
    detail: { scanned: result.scanned, raised: result.alerts.length },
  });
  return NextResponse.json(
    { success: true, scanned: result.scanned, raised: result.alerts.length, alerts: result.alerts },
    { headers: NO_STORE },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const alertId = String(body.alertId ?? '').trim();
  const status = String(body.status ?? '').trim();
  if (!alertId) return fail('VALIDATION_FAILED', 'alertId is required');
  if (!['reviewed', 'dismissed', 'escalated'].includes(status)) {
    return fail('VALIDATION_FAILED', 'status must be reviewed, dismissed or escalated');
  }

  const changed = resolveAlert(alertId, status as 'reviewed' | 'dismissed' | 'escalated');
  if (!changed) return fail('NOT_FOUND', 'No open alert with that id', 404);
  recordAdminAction(request, auth.admin, 'surveillance.resolve', {
    type: 'surveillance_alert',
    id: alertId,
    detail: { status },
  });
  return NextResponse.json({ success: true }, { headers: NO_STORE });
}
