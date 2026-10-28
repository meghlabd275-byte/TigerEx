"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldCheck, ShieldOff } from "lucide-react";

interface EnrollmentData {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

function authHeaders(): Record<string, string> | null {
  const token = typeof window !== "undefined" ? localStorage.getItem("tigerex_access_token") : null;
  if (!token) return null;
  return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

export default function TwoFactorPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) {
      setError("Sign in before configuring account security.");
      return;
    }
    try {
      const response = await fetch("/api/auth/2fa", { headers, cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error?.message ?? "Could not read the 2FA state.");
        return;
      }
      setEnabled(!!body?.data?.enabled);
      setError("");
    } catch {
      setError("The security service could not be reached.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function beginEnrollment() {
    const headers = authHeaders();
    if (!headers) {
      setError("Sign in before configuring account security.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/2fa/enable", { method: "POST", headers, cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data?.secret) {
        setError(body?.error?.message ?? "Enrollment could not be started.");
        return;
      }
      setEnrollment(body.data as EnrollmentData);
      setMessage("Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.");
    } catch {
      setError("The security service could not be reached. No authenticator was enabled.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment() {
    const headers = authHeaders();
    if (!headers) {
      setError("Sign in before configuring account security.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code shown in your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        setError(body?.error?.message ?? "That code was not accepted.");
        return;
      }
      setEnrollment(null);
      setCode("");
      setMessage("Two-factor authentication is now enabled.");
      await loadStatus();
    } catch {
      setError("The security service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  async function disableTwoFactor() {
    const headers = authHeaders();
    if (!headers) {
      setError("Sign in before changing account security.");
      return;
    }
    if (!disablePassword || !/^\d{6}$/.test(disableCode.trim())) {
      setError("Enter your password and a current authenticator code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ password: disablePassword, code: disableCode.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        setError(body?.error?.message ?? "2FA could not be disabled.");
        return;
      }
      setDisablePassword("");
      setDisableCode("");
      setMessage("Two-factor authentication is now disabled.");
      await loadStatus();
    } catch {
      setError("The security service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12 text-white">
      <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6">
        <Link href="/" className="text-sm text-gray-400 hover:text-white">
          ← TigerEx home
        </Link>
        <div className="mt-6 flex items-center gap-3">
          {enabled ? (
            <ShieldCheck className="h-8 w-8 text-green-400" />
          ) : (
            <ShieldOff className="h-8 w-8 text-orange-400" />
          )}
          <div>
            <h1 className="text-2xl font-bold">Two-factor authentication</h1>
            <p className="text-sm text-gray-400">
              {enabled === null
                ? "Checking current state…"
                : enabled
                  ? "Authenticator protection is active on this account."
                  : "Add an authenticator app to protect account access."}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-6 flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <p role="status" className="mt-6 break-words rounded-lg border border-white/10 p-3 text-sm text-gray-200">
            {message}
          </p>
        )}

        {!enabled && !enrollment && (
          <button
            onClick={() => void beginEnrollment()}
            disabled={busy || enabled === null}
            className="mt-6 w-full rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Set up authenticator"}
          </button>
        )}

        {enrollment && (
          <div className="mt-6 space-y-4">
            {/* The QR encodes the account's real otpauth URL returned by the server. */}
            <img
              src={enrollment.qrDataUrl}
              alt="Authenticator QR code"
              className="mx-auto h-60 w-60 rounded-lg bg-white p-2"
            />
            <div className="rounded-lg border border-white/10 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-400">Manual entry key</p>
              <code className="mt-1 block break-all text-sm text-gray-100">{enrollment.secret}</code>
            </div>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              maxLength={6}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-center text-lg tracking-widest"
            />
            <button
              onClick={() => void confirmEnrollment()}
              disabled={busy}
              className="w-full rounded-lg bg-green-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Confirm and enable"}
            </button>
          </div>
        )}

        {enabled && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-gray-300">Disable 2FA</p>
            <input
              type="password"
              value={disablePassword}
              onChange={(event) => setDisablePassword(event.target.value)}
              placeholder="Account password"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3"
            />
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value)}
              placeholder="Authenticator code"
              maxLength={6}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3"
            />
            <button
              onClick={() => void disableTwoFactor()}
              disabled={busy}
              className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 font-semibold text-red-200 disabled:opacity-50"
            >
              {busy ? "Working…" : "Disable 2FA"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
