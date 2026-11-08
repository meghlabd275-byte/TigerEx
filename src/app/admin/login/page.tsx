'use client';

/**
 * Administrator sign-in.
 *
 * Posts credentials to `/api/admin/auth/login`, which verifies them against
 * `admin_users` and opens a row in `admin_sessions`. The returned session token
 * is stored under `tigerex_admin_token`, the key every admin route reads. No
 * account or password is pre-filled: an unprovisioned deployment returns the
 * same generic failure an operator would see for a wrong password.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.accessToken) {
        throw new Error(body?.error?.message ?? 'Sign-in failed');
      }
      localStorage.setItem('tigerex_admin_token', body.accessToken);
      router.push('/admin/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A0A0F] p-4 text-white">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-[#14141A] p-6">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-[#FF6B35]" />
          <h1 className="text-xl font-bold">Admin Console</h1>
        </div>

        {error && <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

        <label className="mb-3 block text-sm">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-white/10 bg-transparent p-2"
          />
        </label>

        <label className="mb-5 block text-sm">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-white/10 bg-transparent p-2"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#FF6B35] px-4 py-2 font-medium disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
        </button>
      </form>
    </main>
  );
}
