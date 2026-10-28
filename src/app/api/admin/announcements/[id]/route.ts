import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function error(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Delete an announcement through the admin backend.
export async function DELETE(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return error('Authorization required', 401);

  const id = request.nextUrl.pathname.split('/').filter(Boolean).pop() ?? '';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return error('Invalid announcement id', 400);

  if (!ADMIN_API_URL) {
    return error(
      'TIGEREX_ADMIN_API_URL is not configured; announcement management is disabled.',
      503,
    );
  }
  try {
    const response = await fetch(`${ADMIN_API_URL}/admin/announcements/${id}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: token },
      cache: 'no-store',
    });
    const payload = await response
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return error('Admin backend is unavailable; no announcement state was changed.', 502);
  }
}
