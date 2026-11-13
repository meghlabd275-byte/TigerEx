'use client';

/**
 * Administrator security — authenticator (2FA) enrolment.
 *
 * Reads and writes `/api/admin/auth/2fa` with the admin token. The QR code and
 * secret are shown once, at enrolment; the secret is never re-served.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';

function adminToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
}

export default function AdminSecurityPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (method: string, body?: unknown) => {
    const token = adminToken();
    if (!token) throw new Error('Admin authentication is required.');
    const response = await fetch('/api/admin/auth/2fa', {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      throw new Error(payload?.error?.message ?? `Request failed (HTTP ${response.status})`);
    }
    return payload.data;
  }, []);

  useEffect(() => {
    call('GET')
      .then((data) => setEnabled(Boolean(data?.enabled)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load status'));
  }, [call]);

  async function startEnrolment() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await call('POST', {});
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start enrolment');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment() {
    setBusy(true);
    setError(null);
    try {
      await call('POST', { code });
      setEnabled(true);
      setQrDataUrl(null);
      setSecret(null);
      setCode('');
      setNotice('Two-factor authentication is now enabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await call('DELETE', { code });
      setEnabled(false);
      setCode('');
      setNotice('Two-factor authentication is disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6 text-white">
      <div className="mb-6 flex items-center gap-2">
        {enabled ? <ShieldCheck className="h-6 w-6 text-green-400" /> : <ShieldOff className="h-6 w-6 text-yellow-400" />}
        <h1 className="text-xl font-bold">Admin Security</h1>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
      {notice && <div className="mb-4 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">{notice}</div>}

      {enabled === null && <p className="text-sm text-white/60">Loading…</p>}

      {enabled === false && !qrDataUrl && (
        <div className="rounded-2xl bg-[#14141A] p-6">
          <p className="mb-4 text-sm text-white/70">
            Add an authenticator app (Google Authenticator, Authy, 1Password) to protect the admin
            console. An admin session can move customer funds, so 2FA is strongly recommended.
          </p>
          <button
            onClick={startEnrolment}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#FF6B35] px-4 py-2 font-medium disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enable 2FA
          </button>
        </div>
      )}

      {qrDataUrl && (
        <div className="rounded-2xl bg-[#14141A] p-6">
          <p className="mb-3 text-sm text-white/70">Scan this QR code, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="Authenticator QR code" className="mb-3 rounded bg-white p-2" width={240} height={240} />
          {secret && (
            <p className="mb-4 break-all text-xs text-white/50">
              Manual entry key: <span className="font-mono">{secret}</span>
            </p>
          )}
          <div className="flex items-end gap-3">
            <label className="text-sm">
              Code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                maxLength={6}
                inputMode="numeric"
                className="mt-1 block w-40 rounded border border-white/10 bg-transparent p-2 tracking-widest"
              />
            </label>
            <button
              onClick={confirmEnrolment}
              disabled={busy || code.length !== 6}
              className="rounded-lg bg-[#FF6B35] px-4 py-2 font-medium disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {enabled === true && (
        <div className="rounded-2xl bg-[#14141A] p-6">
          <p className="mb-4 text-sm text-green-400">Two-factor authentication is enabled.</p>
          <div className="flex items-end gap-3">
            <label className="text-sm">
              Current code (to disable)
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                maxLength={6}
                inputMode="numeric"
                className="mt-1 block w-40 rounded border border-white/10 bg-transparent p-2 tracking-widest"
              />
            </label>
            <button
              onClick={disable}
              disabled={busy || code.length !== 6}
              className="rounded-lg border border-red-500/40 px-4 py-2 font-medium text-red-400 disabled:opacity-50"
            >
              Disable 2FA
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
