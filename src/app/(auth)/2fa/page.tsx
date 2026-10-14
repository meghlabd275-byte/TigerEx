"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";

export default function TwoFactorPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestEnrollment() {
    setBusy(true);
    setMessage("");
    try {
      const token = localStorage.getItem("tigerex_access_token");
      if (!token) {
        setMessage("Sign in before configuring account security.");
        return;
      }
      const response = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        setMessage(body?.error?.message ?? body?.error ?? "Secure authenticator enrollment is not available.");
        return;
      }
      setMessage("The security service returned an enrollment response. Follow only the secret and QR data returned by the server.");
    } catch {
      setMessage("The security service could not be reached. No authenticator was enabled.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12 text-white">
      <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6">
        <Link href="/" className="text-sm text-gray-400 hover:text-white">← TigerEx home</Link>
        <div className="mt-6 flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-orange-400" />
          <div>
            <h1 className="text-2xl font-bold">Two-factor authentication</h1>
            <p className="text-sm text-gray-400">Protect account access with a verified authenticator.</p>
          </div>
        </div>
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex gap-2 text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">TigerEx will not display a sample secret, fake QR code, or claim 2FA is enabled without server-side secret storage and code verification.</p>
          </div>
        </div>
        <button onClick={() => void requestEnrollment()} disabled={busy} className="mt-6 w-full rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "Checking security service…" : "Request secure authenticator setup"}
        </button>
        {message && <p role="status" className="mt-4 break-words rounded-lg border border-white/10 p-3 text-sm text-gray-200">{message}</p>}
        <p className="mt-4 text-xs text-gray-500">Enrollment and disable operations remain unavailable until the server implements encrypted secret storage, authenticated session checks, and real TOTP verification.</p>
      </section>
    </main>
  );
}
