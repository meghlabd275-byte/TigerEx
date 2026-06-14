'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Apple, CheckCircle, ChevronDown, Chrome, Eye, EyeOff, Loader2, Lock, Wallet } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { isProbablyRegistered, passwordStrength, socialProviders } from '@/lib/authFlow';
import { SmartIdentityInput } from '@/components/auth/SmartIdentityInput';
import { buildIdentityState } from '@/lib/identity';

type Step = 'identifier' | 'verify' | 'password';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState('US');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [socialOpen, setSocialOpen] = useState(false);
  const identity = buildIdentityState(identifier, country);
  const fullIdentifier = identity.normalized;
  const strength = passwordStrength(password);

  const continueIdentifier = async () => {
    setError('');
    if (!identity.isValid) return setError(identity.validationMessage);
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setLoading(false);
    if (isProbablyRegistered(fullIdentifier)) {
      setMessage('Account already exists. Redirecting to Login...');
      setTimeout(() => router.push('/login'), 700);
      return;
    }
    setStep('verify');
  };

  const verifyCode = () => {
    if (code.length !== 6) return setError('Enter the six digit verification code.');
    setError('');
    setStep('password');
  };

  const register = async () => {
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters long.');
    if (strength.label === 'Weak') return setError('Use a stronger password with letters, numbers and symbols.');
    if (password !== confirmPassword) return setError('Password and confirm password must match.');
    if (!terms) return setError('Accept Terms & Conditions to continue.');
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    localStorage.setItem('tigerex-authenticated', 'true');
    router.push('/features');
  };

  const social = async (provider: string) => {
    setLoading(true);
    setMessage(`${provider} signup started...`);
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (provider === 'MetaMask') setMessage('MetaMask connected for built-in DEX access only.');
    else router.push('/features');
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between"><Link href="/" className="font-bold text-primary">← Back to home</Link><ThemeToggle /></div>
        <h1 className="text-3xl font-bold">Create TigerEx account</h1>
        <p className="mt-2 text-muted-foreground">Verify your contact, set a strong password and start trading.</p>
        {error && <div className="mt-4 flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"><AlertCircle className="h-4 w-4" />{error}</div>}
        {message && <div className="mt-4 flex gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400"><CheckCircle className="h-4 w-4" />{message}</div>}

        <div className="mt-6 space-y-4">
          {step === 'identifier' && <>
            <SmartIdentityInput value={identifier} country={country} onValueChange={setIdentifier} onCountryChange={setCountry} />
            <button onClick={continueIdentifier} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Continue'}</button>
          </>}
          {step === 'verify' && <><div className="rounded-xl border border-border p-4"><h2 className="font-semibold">{identity.type === 'phone' ? 'Phone verification required' : 'Mail verification required'}</h2><p className="text-sm text-muted-foreground">Enter the six digit code to continue.</p></div><input maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl border border-border bg-background p-4 text-center text-2xl tracking-[0.5em]" placeholder="000000" /><button onClick={verifyCode} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">Continue</button></>}
          {step === 'password' && <>
            {[['Password', password, setPassword], ['Confirm password', confirmPassword, setConfirmPassword]].map(([label, value, setter]) => <div key={label as string}><label className="mb-1 block text-sm font-medium">{label as string}</label><div className="relative"><Lock className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" /><input type={showPassword ? 'text' : 'password'} value={value as string} onChange={(e) => (setter as (value: string) => void)(e.target.value)} className="w-full rounded-xl border border-border bg-background py-3 pl-11 pr-12" placeholder="At least 8 characters" /><button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5">{showPassword ? <EyeOff /> : <Eye />}</button></div></div>)}
            <div><div className="mb-1 flex justify-between text-xs"><span>Password strength</span><span className={strength.text}>{strength.label}</span></div><div className="h-2 rounded-full bg-muted"><div className={`h-2 rounded-full ${strength.color}`} style={{ width: `${Math.max(20, strength.score * 20)}%` }} /></div></div>
            {confirmPassword && password === confirmPassword && <p className="text-sm text-green-400">✓ Passwords match</p>}
            <input value={referralCode} onChange={(e) => setReferralCode(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3" placeholder="Referral code (optional)" />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I agree to TigerEx Terms & Conditions.</label>
            <button onClick={register} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Register'}</button>
          </>}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => social('Google')} className="rounded-xl border border-border p-3"><Chrome className="mx-auto" />Google</button><button onClick={() => social('Apple')} className="rounded-xl border border-border p-3"><Apple className="mx-auto" />Apple</button></div>
        <button onClick={() => setSocialOpen(!socialOpen)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border p-3">More social authentication <ChevronDown className="h-4 w-4" /></button>
        {socialOpen && <div className="mt-3 grid grid-cols-2 gap-2">{socialProviders.slice(2).map((provider) => <button key={provider} onClick={() => social(provider)} className="rounded-lg bg-muted p-2 text-sm">{provider}</button>)}</div>}
        <div className="mt-3 grid grid-cols-2 gap-3"><button onClick={() => social('Passkey')} className="rounded-xl border border-border p-3">Passkey</button><button onClick={() => social('MetaMask')} className="rounded-xl border border-border p-3"><Wallet className="mx-auto" />MetaMask DEX</button></div>
      </div>
    </main>
  );
}
