import { NextRequest, NextResponse } from 'next/server';
import { getDb, decrypt } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Summarise a stored identity-check result for the reviewer.
 *
 * The blob is encrypted at rest; it is decrypted only here, for an authenticated
 * admin, and reduced to the fields the reviewer reads. A missing or unreadable
 * blob yields null rather than a fabricated verdict.
 */
function identitySummary(encrypted: unknown): Record<string, unknown> | null {
  if (typeof encrypted !== 'string' || encrypted.length === 0) return null;
  try {
    const parsed = JSON.parse(decrypt(encrypted)) as {
      analysed?: boolean;
      documentFaceFound?: boolean;
      selfieFaceFound?: boolean;
      faceSimilarity?: number | null;
      faceMatched?: boolean;
      liveness?: { live?: boolean; score?: number; signals?: Array<{ name: string; passed: boolean; value: number; threshold: number }> } | null;
      notes?: string[];
    };
    return {
      analysed: parsed.analysed === true,
      documentFaceFound: parsed.documentFaceFound === true,
      selfieFaceFound: parsed.selfieFaceFound === true,
      faceSimilarity: typeof parsed.faceSimilarity === 'number' ? parsed.faceSimilarity : null,
      faceMatched: parsed.faceMatched === true,
      liveness: parsed.liveness
        ? { live: parsed.liveness.live === true, score: parsed.liveness.score ?? 0, signals: parsed.liveness.signals ?? [] }
        : null,
      notes: parsed.notes ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * The KYC review queue.
 *
 * Each pending application is a user whose submitted documents are awaiting a
 * decision. The console shows the identity fields the reviewer needs; document
 * image references are returned as stored references, never as inline data.
 */

function toUnixSeconds(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status')?.trim() || 'pending';
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 100) || 100, 1), 500);

  const rows = getDb()
    .prepare(
      `SELECT u.user_id, u.email, u.kyc_level, u.kyc_status, u.country_code,
              d.document_type, d.document_number, d.status AS document_status,
              d.created_at AS submitted_at, d.reviewed_at, d.rejection_reason,
              d.identity_checks
         FROM users u
         LEFT JOIN kyc_documents d ON d.user_id = u.user_id
        WHERE u.kyc_status = ?
        ORDER BY u.kyc_submitted_at DESC, u.created_at DESC
        LIMIT ?`,
    )
    .all(status, limit) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      data: rows.map((row) => ({
        id: row.user_id,
        userId: row.user_id,
        email: row.email,
        country: row.country_code ?? null,
        documentType: row.document_type ?? null,
        documentNumber: row.document_number ?? null,
        level: Number(row.kyc_level === 'none' ? 0 : row.kyc_level) || 0,
        status: row.kyc_status ?? 'pending',
        submittedAt: toUnixSeconds(row.submitted_at),
        reviewedAt: toUnixSeconds(row.reviewed_at),
        rejectReason: row.rejection_reason ?? null,
        identityChecks: identitySummary(row.identity_checks),
      })),
    },
    { headers: NO_STORE },
  );
}
