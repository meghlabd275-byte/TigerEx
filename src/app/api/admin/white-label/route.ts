import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function responseError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

async function forward(path: string, token: string, method = 'GET', body?: unknown) {
  if (!ADMIN_API_URL) {
    return responseError('TIGEREX_ADMIN_API_URL is not configured; white-label operations are disabled.', 503);
  }
  try {
    const headers = new Headers({ Accept: 'application/json', Authorization: token });
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    const upstream = await fetch(ADMIN_API_URL + path, init);
    const payload = await upstream.json().catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return responseError('Admin backend is unavailable; no white-label state was changed.', 502);
  }
}

export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);
  const status = new URL(request.url).searchParams.get('status');
  const query = status ? '?status=' + encodeURIComponent(status) : '';
  return forward('/admin/white-label/exchanges' + query, token);
}

export async function POST(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return responseError('Invalid JSON body', 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  const plan = typeof body.plan === 'string' ? body.plan.trim() : '';
  if (!name || name.length > 120 || !plan || plan.length > 40) {
    return responseError('Valid name and plan are required', 400);
  }
  if (domain && (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))) {
    return responseError('A valid fully qualified domain name is required', 400);
  }

  const slugSource = domain || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const backendBody = {
    name,
    slug: slugSource.slice(0, 100),
    status: 'pending',
    branding: body.branding && typeof body.branding === 'object' ? body.branding : {},
    domains: domain ? [domain] : [],
    liquiditySources: [],
    tradingPairSources: [],
    infrastructure: {},
    modules: body.features && typeof body.features === 'object' ? body.features : {},
    adminPermissions: [],
    deploymentConfig: { plan },
  };
  return forward('/admin/white-label/exchanges', token, 'POST', backendBody);
}

export async function PUT(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);

  let body: { whiteLabelId?: string; updates?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return responseError('Invalid JSON body', 400);
  }
  const id = body.whiteLabelId?.trim();
  const updates = body.updates;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !updates || typeof updates !== 'object') {
    return responseError('A valid whiteLabelId and updates object are required', 400);
  }

  // The durable API currently replaces the full configuration, not a partial patch.
  // Refuse partial updates instead of silently clearing omitted fields.
  const required = ['name', 'slug', 'status', 'branding', 'domains', 'liquiditySources',
    'tradingPairSources', 'infrastructure', 'modules', 'adminPermissions', 'deploymentConfig'];
  if (!required.every(key => Object.prototype.hasOwnProperty.call(updates, key))) {
    return responseError('The backend requires a complete white-label configuration for updates; no changes were made.', 501);
  }
  return forward('/admin/white-label/exchanges/' + encodeURIComponent(id), token, 'PUT', updates);
}

export async function DELETE(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);
  const id = new URL(request.url).searchParams.get('id')?.trim();
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return responseError('A valid white-label ID is required', 400);
  }
  return forward('/admin/white-label/exchanges/' + encodeURIComponent(id), token, 'DELETE');
}
