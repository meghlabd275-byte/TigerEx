import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listApiKeys, createApiKey, revokeApiKey, AccountError } from '@/lib/security/account';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's trading API keys.
 *
 * The list never contains a secret. A new key's secret is returned exactly once
 * by the create call and is stored only as a hash plus an encrypted copy, so a
 * later read cannot reconstruct it.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const keys = listApiKeys(auth.user.userId);
  return NextResponse.json({ success: true, apiKeys: keys, data: keys }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.apiKeys.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const name = String(body.name ?? '').trim();
  const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
  const ipWhitelist = Array.isArray(body.ipWhitelist) ? body.ipWhitelist.map(String) : [];

  try {
    const created = createApiKey(auth.user.userId, name, permissions, ipWhitelist);
    return NextResponse.json(
      { success: true, apiKey: created, secret: created.apiSecret },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.apiKeys.revoke');
  if (guard) return guard;

  const keyId = request.nextUrl.searchParams.get('keyId')?.trim();
  if (!keyId) return fail('VALIDATION_FAILED', 'A keyId is required');

  try {
    revokeApiKey(auth.user.userId, keyId);
    return NextResponse.json({ success: true, keyId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
