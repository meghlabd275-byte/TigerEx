'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

/**
 * Social sign-in landing page.
 *
 * The provider callback redirects here with a single-use `loginCode` (never a
 * token). This page exchanges the code for session tokens, stores them the same
 * way a password sign-in does, and forwards to the dashboard. Any failure is
 * shown plainly rather than leaving the user on a blank screen.
 */
export default function SocialCallbackPage() {
  return (
    <Suspense fallback={<Shell />}>
      <SocialCallback />
    </Suspense>
  );
}

function SocialCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loginCode = params.get('loginCode');
    const providerError = params.get('error');

    if (providerError) {
      setError(humanize(providerError));
      return;
    }
    if (!loginCode) {
      setError('This sign-in link is missing its code. Start the sign-in again.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/auth/social/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: loginCode }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error?.message || 'Sign-in could not be completed');
        }

        localStorage.setItem('tigerex_access_token', data.accessToken);
        if (data.refreshToken) {
          localStorage.setItem('tigerex_refresh_token', data.refreshToken);
        }
        const next = params.get('next');
        const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
        if (!cancelled) router.replace(safeNext);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Sign-in failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return <Shell error={error} />;
}

function Shell({ error = null }: { error?: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-tiger-black px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        {error ? (
          <>
            <h1 className="mb-2 text-xl font-bold text-white">Sign-in failed</h1>
            <p className="mb-6 text-sm text-red-400">{error}</p>
            <Link
              href="/login"
              className="inline-block rounded-lg bg-tiger-orange px-6 py-3 font-bold text-white"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-tiger-orange" />
            <p className="text-sm text-gray-400">Completing your sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
}

function humanize(code: string): string {
  switch (code) {
    case 'provider_not_configured':
      return 'That sign-in provider is not configured on this deployment.';
    case 'provider_denied':
      return 'The provider declined the sign-in request.';
    case 'unknown_provider':
      return 'That sign-in provider is not supported.';
    case 'invalid_id_token':
    case 'invalid_state':
      return 'The sign-in response could not be verified. Please try again.';
    default:
      return 'Sign-in could not be completed. Please try again.';
  }
}
