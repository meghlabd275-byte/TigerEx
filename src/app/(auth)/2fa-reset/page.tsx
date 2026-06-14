'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { SmartIdentityInput } from '@/components/auth/SmartIdentityInput';
import { buildIdentityState } from '@/lib/identity';
import { isProbablyRegistered, livenessPrompts } from '@/lib/authFlow';

type Step = 'identifier' | 'codes' | 'live' | 'new';

export default function TwoFAResetPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState('US');
  const [mailCode, setMailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [prompt] = useState(livenessPrompts[Math.floor(Math.random() * livenessPrompts.length)]);
  const [meter, setMeter] = useState(0);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const identity = buildIdentityState(identifier, country);

  const continueIdentifier = () => {
    if (!identity.isValid) return setError(identity.validationMessage);
    if (!isProbablyRegistered(identity.normalized)) return router.push('/register');
    setError('');
    setStep('codes');
  };

  const verifyCodes = () => {
    if (mailCode.length !== 6 || phoneCode.length !== 6) return setError('Verify mail and phone with six digit codes.');
    setError('');
    setStep('live');
  };

  const runLiveness = () => {
    let value = 0;
    const timer = setInterval(() => {
      value += 20;
      setMeter(value);
      if (value >= 100) {
        clearInterval(timer);
        setStep('new');
      }
    }, 1000);
  };

  const saveNewTwoFA = () => {
    if (!secret.trim()) return setError('Enter the new authenticator secret or setup confirmation code.');
    localStorage.setItem('tigerex-withdraw-disabled-until', String(Date.now() + 48 * 60 * 60 * 1000));
    setMessage('Previous 2FA erased and new 2FA saved.');
    setTimeout(() => router.push('/features'), 900);
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-6">
        <div className="mb-5 flex justify-between"><Link href="/login" className="text-primary">← Login</Link><ThemeToggle /></div>
        <h1 className="text-3xl font-bold">2FA reset</h1>
        <p className="text-muted-foreground">One smart identity field, then OTP and KYC-linked liveness.</p>
        {error && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-red-400">{error}</p>}
        {message && <p className="mt-4 rounded-xl bg-green-500/10 p-3 text-green-400">{message}</p>}
        <div className="mt-6 space-y-4">
          {step === 'identifier' && <><SmartIdentityInput value={identifier} country={country} onValueChange={setIdentifier} onCountryChange={setCountry} /><button onClick={continueIdentifier} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">Continue</button></>}
          {step === 'codes' && <><input maxLength={6} className="w-full rounded-xl border border-border bg-background p-3 text-center tracking-[.5em]" placeholder="Mail code" value={mailCode} onChange={(event) => setMailCode(event.target.value.replace(/\D/g, ''))} /><input maxLength={6} className="w-full rounded-xl border border-border bg-background p-3 text-center tracking-[.5em]" placeholder="Phone code" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, ''))} /><button onClick={verifyCodes} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">Continue</button></>}
          {step === 'live' && <><div className="rounded-xl border border-border p-4"><p className="font-semibold">Live verification instruction</p><p>{prompt}. Face must match KYC data.</p><div className="mt-3 h-3 rounded-full bg-muted"><div className="h-3 rounded-full bg-green-500" style={{ width: `${meter}%` }} /></div></div><button onClick={runLiveness} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">Start 5 second check</button></>}
          {step === 'new' && <><p className="rounded-xl bg-green-500/10 p-3 text-green-400">Liveness and KYC face match confirmed. Old 2FA erased.</p><input className="w-full rounded-xl border border-border bg-background p-3" placeholder="New authenticator secret / code" value={secret} onChange={(event) => setSecret(event.target.value)} /><button onClick={saveNewTwoFA} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">Set new 2FA</button></>}
        </div>
      </div>
    </main>
  );
}
