'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { SmartIdentityInput } from '@/components/auth/SmartIdentityInput';
import { buildIdentityState } from '@/lib/identity';
import { isProbablyRegistered, passwordStrength } from '@/lib/authFlow';

type Step = 'identifier' | 'verify' | 'reset';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState('US');
  const [mailCode, setMailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twofaCode, setTwofaCode] = useState('');
  const [twofaEnabled, setTwofaEnabled] = useState(true);
  const [lostTwofa, setLostTwofa] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const identity = buildIdentityState(identifier, country);
  const strength = passwordStrength(password);

  const checkAccount = async () => {
    setError('');
    if (!identity.isValid) return setError(identity.validationMessage);
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setLoading(false);
    if (!isProbablyRegistered(identity.normalized)) {
      setMessage('Account not found. Redirecting to Sign Up...');
      setTimeout(() => router.push('/register'), 700);
      return;
    }
    setStep('verify');
  };

  const verifyCodes = () => {
    if (mailCode.length !== 6 || phoneCode.length !== 6) return setError('Verify mail and phone with six digit codes.');
    if (twofaEnabled && twofaCode.length !== 6) {
      if (lostTwofa) return router.push('/2fa-reset');
      return setError('Enter 2FA code or choose the 2FA lost recovery flow.');
    }
    setError('');
    setStep('reset');
  };

  const resetPassword = async () => {
    if (password.length < 8 || strength.label === 'Weak') return setError('Use a stronger password.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    localStorage.setItem('tigerex-withdraw-disabled-until', String(Date.now() + 48 * 60 * 60 * 1000));
    router.push('/features');
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-6">
        <div className="mb-5 flex justify-between"><Link href="/login" className="text-primary">← Login</Link><ThemeToggle /></div>
        <h1 className="text-3xl font-bold">Reset password</h1>
        <p className="text-muted-foreground">Use one smart field; TigerEx detects email or phone automatically.</p>
        {error && <p className="mt-4 flex gap-2 rounded-xl bg-red-500/10 p-3 text-red-400"><AlertCircle /> {error}</p>}
        {message && <p className="mt-4 flex gap-2 rounded-xl bg-green-500/10 p-3 text-green-400"><CheckCircle /> {message}</p>}
        <div className="mt-6 space-y-4">
          {step === 'identifier' && <><SmartIdentityInput value={identifier} country={country} onValueChange={setIdentifier} onCountryChange={setCountry} /><button onClick={checkAccount} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">{loading ? <Loader2 className="mx-auto animate-spin" /> : 'Continue'}</button></>}
          {step === 'verify' && <><input maxLength={6} className="w-full rounded-xl border border-border bg-background p-3 text-center tracking-[.5em]" placeholder="Mail code" value={mailCode} onChange={(event) => setMailCode(event.target.value.replace(/\D/g, ''))} /><input maxLength={6} className="w-full rounded-xl border border-border bg-background p-3 text-center tracking-[.5em]" placeholder="Phone code" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, ''))} /><label className="flex gap-2"><input type="checkbox" checked={twofaEnabled} onChange={(event) => setTwofaEnabled(event.target.checked)} /> 2FA enabled</label>{twofaEnabled && <input maxLength={6} className="w-full rounded-xl border border-border bg-background p-3 text-center tracking-[.5em]" placeholder="2FA code" value={twofaCode} onChange={(event) => setTwofaCode(event.target.value.replace(/\D/g, ''))} />}<label className="flex gap-2"><input type="checkbox" checked={lostTwofa} onChange={(event) => setLostTwofa(event.target.checked)} /> I lost 2FA</label><button onClick={verifyCodes} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">Continue</button></>}
          {step === 'reset' && <><div className="relative"><input type={showPassword ? 'text' : 'password'} className="w-full rounded-xl border border-border bg-background p-3 pr-12" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="absolute right-3 top-3" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff /> : <Eye />}</button></div><input type={showPassword ? 'text' : 'password'} className="w-full rounded-xl border border-border bg-background p-3" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><p className={strength.text}>Strength: {strength.label}</p><button onClick={resetPassword} className="w-full rounded-xl bg-primary p-3 font-bold text-primary-foreground">Reset password</button></>}
        </div>
      </div>
    </main>
  );
}
