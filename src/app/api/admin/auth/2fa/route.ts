import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import {
  adminTotpStatus,
  beginAdminTotpEnrolment,
  confirmAdminTotpEnrolment,
  disableAdminTotp,
} from '@/lib/auth/admin-2fa';
import { renderQrDataUrl } from '@/lib/security/totp';
import { enforceRequestGuards } from '@/lib/api/route-guards';

/**
 * Administrator authenticator (TOTP) management.
 *
 * GET  — the current status.
 * POST — begin enrolment (no `code`) or confirm it (`code` present).
 * DELETE — turn 2FA off after a verified code.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json(
    { success: true, data: adminTotpStatus(auth.admin.adminId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'admin.2fa', 10, 60_000);
  if (guard) return guard;
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: { code?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const code = body.code === undefined ? '' : String(body.code).trim();
  const adminId = auth.admin.adminId;

  try {
    if (!code) {
      if (adminTotpStatus(adminId).enabled) {
        return NextResponse.json(
          { success: false, error: { code: 'ALREADY_ENABLED', message: '2FA is already enabled. Disable it before re-enrolling.' } },
          { status: 409 },
        );
      }
      const { secret, otpauthUrl } = beginAdminTotpEnrolment(adminId);
      const qrDataUrl = await renderQrDataUrl(otpauthUrl);
      return NextResponse.json(
        { success: true, data: { secret, otpauthUrl, qrDataUrl } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (!confirmAdminTotpEnrolment(adminId, code)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CODE', message: 'That code is not valid. Check your authenticator clock and try again.' } },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, data: { enabled: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NO_PENDING_SECRET') {
      return NextResponse.json(
        { success: false, error: { code: 'NO_PENDING_SECRET', message: 'Start enrolment before submitting a code' } },
        { status: 400 },
      );
    }
    console.error('admin 2FA error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'admin.2fa', 10, 60_000);
  if (guard) return guard;
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: { code?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const code = String(body.code ?? '').trim();
  if (!code) {
    return NextResponse.json(
      { success: false, error: { code: 'MISSING_CODE', message: 'Authenticator code is required' } },
      { status: 400 },
    );
  }
  if (!disableAdminTotp(auth.admin.adminId, code)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_CODE', message: 'That code is not valid' } },
      { status: 400 },
    );
  }
  return NextResponse.json({ success: true, data: { enabled: false } });
}
