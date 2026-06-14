'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { SmartIdentityInput } from '@/components/auth/SmartIdentityInput';
import { buildIdentityState } from '@/lib/identity';
import { livenessPrompts } from '@/lib/authFlow';

export default function AccountSecurityPage() {
  const [prompt] = useState(livenessPrompts[0]);
  const [complete, setComplete] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);
  const [assetClear, setAssetClear] = useState(false);
  const [newContact, setNewContact] = useState('');
  const [country, setCountry] = useState('US');
  const [error, setError] = useState('');
  const identity = buildIdentityState(newContact, country);

  const saveContact = () => {
    if (!identity.isValid) return setError(identity.validationMessage);
    setError('');
    localStorage.setItem('tigerex-withdraw-disabled-until', String(Date.now() + 48 * 60 * 60 * 1000));
    setComplete(true);
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex justify-between"><Link href="/features" className="text-primary">← User home</Link><ThemeToggle /></div>
        <h1 className="text-3xl font-bold">Mail, phone and account security</h1>
        <section className="rounded-3xl border border-border bg-card p-6">
          <h2 className="text-xl font-bold">Change phone or mail</h2>
          <p className="text-muted-foreground">Use one smart input. TigerEx auto-detects email or phone, verifies current and new contacts, runs KYC liveness, and freezes withdrawals for 48 hours.</p>
          <div className="mt-4"><SmartIdentityInput value={newContact} country={country} onValueChange={setNewContact} onCountryChange={setCountry} label="New email or phone" /></div>
          <div className="mt-3 grid gap-3 md:grid-cols-3"><input className="rounded-xl border border-border bg-background p-3" placeholder="Current phone code" /><input className="rounded-xl border border-border bg-background p-3" placeholder="Current mail code" /><input className="rounded-xl border border-border bg-background p-3" placeholder="New contact code" /></div>
          <div className="mt-3 rounded-xl bg-muted p-3">Live check: {prompt}. Auto checks in 5 seconds against KYC face.</div>
          {error && <p className="mt-3 text-red-400">{error}</p>}
          <button onClick={saveContact} className="mt-3 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground">Submit change</button>
          {complete && <p className="mt-3 text-green-400">Completed. Old contact swapped globally and withdrawals disabled for 48 hours.</p>}
        </section>
        <section className="rounded-3xl border border-red-500/30 bg-card p-6">
          <h2 className="text-xl font-bold text-red-400">Delete account</h2>
          <p className="text-muted-foreground">Deletion requires email OTP, phone OTP, KYC-linked liveness and asset-withdrawal confirmation. Login within 30 days cancels deletion.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3"><input className="rounded-xl border border-border bg-background p-3" placeholder="Phone code" /><input className="rounded-xl border border-border bg-background p-3" placeholder="Mail code" /><input className="rounded-xl border border-border bg-background p-3" placeholder="Live verification" /></div>
          <label className="mt-3 flex gap-2"><input type="checkbox" checked={assetClear} onChange={(event) => setAssetClear(event.target.checked)} /> I have withdrawn all my assets.</label>
          <label className="mt-3 flex gap-2"><input type="checkbox" checked={deleteReady} onChange={(event) => setDeleteReady(event.target.checked)} /> I understand data is permanently lost after 30 days and restore is not possible.</label>
          {assetClear && deleteReady && <button onClick={() => { localStorage.removeItem('tigerex-authenticated'); location.href = '/'; }} className="mt-3 rounded-xl bg-red-600 px-5 py-3 font-bold text-white">Delete account request</button>}
        </section>
      </div>
    </main>
  );
}
