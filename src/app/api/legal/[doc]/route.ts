import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fail, NO_STORE } from '@/lib/api/route-guards';

/**
 * Published legal documents.
 *
 * The text of the terms of service and the privacy policy is operator-authored
 * content held in `system_settings` under `legal_terms` and `legal_privacy`.
 * Nothing is hard-coded here: until an operator publishes a document the
 * endpoint reports it as unpublished, so the site never presents invented legal
 * text. This route is public, like the documents it serves.
 */
const DOCUMENTS: Record<string, { key: string; title: string }> = {
  terms: { key: 'legal_terms', title: 'Terms of Service' },
  privacy: { key: 'legal_privacy', title: 'Privacy Policy' },
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ doc: string }> },
) {
  const { doc } = await context.params;
  const entry = DOCUMENTS[String(doc ?? '').trim().toLowerCase()];
  if (!entry) return fail('UNKNOWN_DOCUMENT', 'No such legal document', 404);

  const row = getDb()
    .prepare('SELECT value, updated_at FROM system_settings WHERE key = ?')
    .get(entry.key) as { value: string; updated_at: string } | undefined;

  return NextResponse.json(
    {
      success: true,
      document: {
        id: entry.key,
        title: entry.title,
        published: Boolean(row?.value),
        body: row?.value ?? null,
        updatedAt: row?.updated_at ?? null,
      },
    },
    { headers: NO_STORE },
  );
}
