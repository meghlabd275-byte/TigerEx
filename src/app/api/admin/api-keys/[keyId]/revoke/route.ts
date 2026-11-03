import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Revoke an API key.
 *
 * Revocation disables the key and stamps its expiry, so it can no longer
 * authenticate. The key row is kept so the audit trail still resolves the key
 * id to a name.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { keyId: string } },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.api-keys.revoke');
  if (guard) return guard;

  const keyId = params.keyId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) {
    return fail('VALIDATION_FAILED', 'Invalid key id');
  }

  const db = getDb();
  const key = db.prepare('SELECT key_id, name, enabled FROM api_keys WHERE key_id = ?').get(keyId) as
    | { key_id: string; name: string; enabled: number }
    | undefined;
  if (!key) return fail('UNKNOWN_KEY', 'No such API key', 404);

  const now = new Date().toISOString();
  db.prepare('UPDATE api_keys SET enabled = 0, expires_at = ? WHERE key_id = ?').run(now, keyId);

  recordAdminAction(request, auth.admin, 'api_key.revoke', {
    type: 'api_key',
    id: keyId,
    detail: { name: key.name },
  });

  return NextResponse.json({ success: true, keyId, enabled: false }, { headers: NO_STORE });
}
