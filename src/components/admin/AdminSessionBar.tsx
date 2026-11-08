'use client';

/**
 * Admin console session control.
 *
 * Shows whether an admin session is present and lets the operator end it. The
 * token lives under `tigerex_admin_token`, so the bar reads the same key the
 * admin routes authenticate with; signing out calls the logout route (which
 * deletes the `admin_sessions` row) before clearing it locally.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut, ShieldCheck } from 'lucide-react';

export default function AdminSessionBar() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(localStorage.getItem('tigerex_admin_token')));
  }, []);

  async function signOut() {
    const token = localStorage.getItem('tigerex_admin_token');
    setBusy(true);
    try {
      if (token) {
        await fetch('/api/admin/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      localStorage.removeItem('tigerex_admin_token');
      setSignedIn(false);
      setBusy(false);
    }
  }

  if (signedIn === null) return null;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="inline-flex items-center gap-1 text-gray-500">
        <ShieldCheck className="h-4 w-4" /> {signedIn ? 'Session active' : 'No session'}
      </span>
      {signedIn ? (
        <button
          onClick={signOut}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      ) : (
        <Link href="/admin/login" className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">
          Sign in
        </Link>
      )}
    </div>
  );
}
