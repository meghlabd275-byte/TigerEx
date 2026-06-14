'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Apple, CheckCircle, ChevronDown, Chrome, Eye, EyeOff, KeyRound, Loader2, Shield, Wallet } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { isProbablyRegistered, socialProviders } from '@/lib/authFlow';
import { SmartIdentityInput } from '@/components/auth/SmartIdentityInput';
import { buildIdentityState } from '@/lib/identity';

type Step = 'identifier' | 'password' | 'mail' | 'phone' | 'twofa';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [country, setCountry] = useState('US');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [trustedLogin, setTrustedLogin] = useState(false);
  const [mailCode, setMailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twofaCode, setTwofaCode] = useState('');
  const [twofaEnabled, setTwofaEnabled] = useState(true);
  const [socialOpen, setSocialOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('tigerex-remembered-login');
    if (saved) {
      setIdentifier(saved);
      setRememberMe(true);
    }
  }, []);

  const identity = buildIdentityState(identifier, country);
  const fullIdentifier = identity.normalized;

  const continueIdentifier = async () => {
    setError('');
    if (!identity.isValid) return setError(identity.validationMessage);
    setChecking(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setChecking(false);
    if (!isProbablyRegistered(fullIdentifier)) {
      setMessage('No account found. Redirecting to Sign Up...');
      setTimeout(() => router.push('/register'), 700);
      return;
    }
    setStep('password');
  };

  const submitPassword = async () => {
    setError('');
    const attempts = Number(localStorage.getItem(`tigerex-login-fails:${fullIdentifier}`) || '0');
    const lockedUntil = Number(localStorage.getItem(`tigerex-lock:${fullIdentifier}`) || '0');
    if (lockedUntil > Date.now()) {
      router.push('/reset-password?reason=locked');
      return;
    }
    if (!password) return setError('Enter your password.');
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (password.toLowerCase() === 'wrong') {
      const next = attempts + 1;
      localStorage.setItem(`tigerex-login-fails:${fullIdentifier}`, String(next));
      setLoading(false);
      if (next > 5) {
        localStorage.setItem(`tigerex-lock:${fullIdentifier}`, String(Date.now() + 48 * 60 * 60 * 1000));
        router.push('/reset-password?reason=locked');
      } else {
        setError(`Wrong password. ${6 - next} attempts remaining before 48 hour lock.`);
      }
      return;
    }
    localStorage.removeItem(`tigerex-login-fails:${fullIdentifier}`);
    if (rememberMe) localStorage.setItem('tigerex-remembered-login', identifier);
    setLoading(false);
    setStep(identity.type === 'email' ? 'mail' : 'phone');
  };

  const finishLogin = async () => {
    setError('');
    if (step === 'mail' && mailCode.length !== 6) return setError('Enter the six digit mail code.');
    if (step === 'phone' && phoneCode.length !== 6) return setError('Enter the six digit phone code.');
    if (step === 'twofa' && twofaCode.length !== 6) return setError('Enter the six digit 2FA code.');
    if ((step === 'mail' || step === 'phone') && twofaEnabled) {
      setStep('twofa');
      return;
    }
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (trustedLogin) localStorage.setItem('tigerex-trusted-login-until', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
    localStorage.setItem('tigerex-authenticated', 'true');
    router.push('/features');
  };

  const startSocial = async (provider: string) => {
    setLoading(true);
    setMessage(`${provider} authentication started...`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (provider === 'MetaMask') {
      setMessage('MetaMask connected for built-in DEX access only.');
      setLoading(false);
      return;
    }
    setMessage(`${provider} verified. Complete mail/phone and 2FA checks to finish login.`);
    setLoading(false);
    setStep('mail');
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="font-bold text-primary">← Back to home</Link>
          <ThemeToggle />
        </div>
        <h1 className="text-3xl font-bold">Log in to TigerEx</h1>
        <p className="mt-2 text-muted-foreground">Secure account, wallet and trading access.</p>

        {error && <div className="mt-4 flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"><AlertCircle className="h-4 w-4" />{error}</div>}
        {message && <div className="mt-4 flex gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400"><CheckCircle className="h-4 w-4" />{message}</div>}

        <div className="mt-6 space-y-4">
          {step === 'identifier' && <>
            <SmartIdentityInput value={identifier} country={country} onValueChange={setIdentifier} onCountryChange={setCountry} />
            <button onClick={continueIdentifier} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">{checking ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Continue'}</button>
          </>}

          {step === 'password' && <>
            <label className="block text-sm font-medium">Password</label>
            <div className="relative"><KeyRound className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" /><input type={showPassword ? 'text' : 'password'} className="w-full rounded-xl border border-border bg-background py-3 pl-11 pr-12" placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)} /><button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5">{showPassword ? <EyeOff /> : <Eye />}</button></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> Remember me</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trustedLogin} onChange={(e) => setTrustedLogin(e.target.checked)} /> Passwordless / authentication-less login for 30 days on this device</label>
            <button onClick={submitPassword} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Login'}</button>
            <Link href="/reset-password" className="block text-center text-sm text-primary">Forgot password?</Link>
          </>}

          {(step === 'mail' || step === 'phone' || step === 'twofa') && <>
            <div className="rounded-xl border border-border p-4"><Shield className="mb-2 h-6 w-6 text-primary" /><h2 className="font-semibold">{step === 'mail' ? 'Verify mail' : step === 'phone' ? 'Verify phone' : '2FA verification'}</h2><p className="text-sm text-muted-foreground">Enter the six digit code sent to your secure channel.</p></div>
            <input maxLength={6} value={step === 'mail' ? mailCode : step === 'phone' ? phoneCode : twofaCode} onChange={(e) => step === 'mail' ? setMailCode(e.target.value.replace(/\D/g, '')) : step === 'phone' ? setPhoneCode(e.target.value.replace(/\D/g, '')) : setTwofaCode(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl border border-border bg-background p-4 text-center text-2xl tracking-[0.5em]" placeholder="000000" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={twofaEnabled} onChange={(e) => setTwofaEnabled(e.target.checked)} /> 2FA enabled on account</label>
            <button onClick={finishLogin} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : step === 'twofa' || !twofaEnabled ? 'Finish login' : 'Continue'}</button>
          </>}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => startSocial('Google')} className="rounded-xl border border-border p-3"><Chrome className="mx-auto" />Google</button><button onClick={() => startSocial('Apple')} className="rounded-xl border border-border p-3"><Apple className="mx-auto" />Apple</button></div>
        <button onClick={() => setSocialOpen(!socialOpen)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border p-3">More social authentication <ChevronDown className="h-4 w-4" /></button>
        {socialOpen && <div className="mt-3 grid grid-cols-2 gap-2">{socialProviders.slice(2).map((provider) => <button key={provider} onClick={() => startSocial(provider)} className="rounded-lg bg-muted p-2 text-sm">{provider}</button>)}</div>}
        <div className="mt-3 grid grid-cols-2 gap-3"><button onClick={() => startSocial('Passkey')} className="rounded-xl border border-border p-3"><KeyRound className="mx-auto" />Passkey</button><button onClick={() => startSocial('MetaMask')} className="rounded-xl border border-border p-3"><Wallet className="mx-auto" />MetaMask DEX</button></div>
      </div>
    </main>
  );
}
