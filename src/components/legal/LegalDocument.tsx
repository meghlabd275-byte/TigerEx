'use client';

import { useEffect, useState } from 'react';

interface LegalDocumentData {
  title: string;
  published: boolean;
  body: string | null;
  updatedAt: string | null;
}

/**
 * Render an operator-published legal document.
 *
 * The text is fetched from the exchange's own settings store. Until an operator
 * publishes the document the page states that plainly; it never substitutes
 * placeholder legal text, which would misrepresent the terms a user is agreeing
 * to.
 */
export default function LegalDocument({ doc, heading }: { doc: 'terms' | 'privacy'; heading: string }) {
  const [document, setDocument] = useState<LegalDocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/legal/${doc}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
        return body?.document as LegalDocumentData;
      })
      .then((result) => {
        if (!active) return;
        setDocument(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'The document could not be loaded');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [doc]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-gray-50 px-6 py-12 dark:bg-gray-950">
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-white">{heading}</h1>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && document && !document.published && (
        <p className="text-sm text-gray-500">
          This document has not been published yet. It appears here once the operator publishes it.
        </p>
      )}
      {!loading && !error && document?.published && (
        <>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {document.body}
          </pre>
          {document.updatedAt && (
            <p className="mt-6 text-xs text-gray-400">Last updated {document.updatedAt}</p>
          )}
        </>
      )}
    </main>
  );
}
