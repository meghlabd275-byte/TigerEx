'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  TrendingUp, Users, Shield, Zap, CreditCard, 
  Globe, Smartphone, Wallet, ArrowRight,
  Mail, Lock, Eye, EyeOff, AlertCircle, Loader2,
  CheckCircle, XCircle, ArrowLeft, MailOTP, Phone,
  Chrome, Apple, Send, Key, Fingerprint
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Country codes with flags
const COUNTRIES = [
  { code: "+1", name: "United States", flag: "🇺🇸" },
  { code: "+44", name: "United Kingdom", flag: "🇬🇧" },
  { code: "+91", name: "India", flag: "🇮🇳" },
  { code: "+86", name: "China", flag: "🇨🇳" },
  { code: "+81", name: "Japan", flag: "🇯🇵" },
  { code: "+49", name: "Germany", flag: "🇩🇪" },
  { code: "+33", name: "France", flag: "🇫🇷" },
  { code: "+82", name: "South Korea", flag: "🇰🇷" },
  { code: "+55", name: "Brazil", flag: "🇧🇷" },
  { code: "+7", name: "Russia", flag: "🇷🇺" },
  { code: "+61", name: "Australia", flag: "🇦🇺" },
  { code: "+971", name: "UAE", flag: "🇦🇪" },
  { code: "+973", name: "Bahrain", flag: "🇧🇭" },
  { code: "+20", name: "Egypt", flag: "🇪🇬" },
  { code: "+234", name: "Nigeria", flag: "🇳🇬" },
  { code: "+254", name: "Kenya", flag: "🇰🇪" },
  { code: "+255", name: "Tanzania", flag: "🇹🇿" },
  { code: "+256", name: "Uganda", flag: "🇺🇬" },
  { code: "+260", name: "Zambia", flag: "🇿🇲" },
  { code: "+263", name: "Zimbabwe", flag: "🇿🇼" },
];

// Social login providers
const SOCIAL_PROVIDERS = [
  { id: "google", name: "Google", icon: Chrome, color: "#4285F4" },
  { id: "apple", name: "Apple", icon: Apple, color: "#000000" },
  { id: "telegram", name: "Telegram", icon: Send, color: "#0088CC" },
  { id: "metamask", name: "MetaMask", icon: Wallet, color: "#F68519" },
];

export default function LoginPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);
  
  // Auth step: 'credentials' | 'email-verify' | '2fa' | 'passwordless'
  const [step, setStep] = useState<"credentials" | "email-verify" | "2fa" | "passwordless">("credentials");
  
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState("+1");
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Email verification
  const [emailCode, setEmailCode] = useState(['', '', '', '', '', '']);
  const [emailVerified, setEmailVerified] = useState(false);
  
  // Phone verification
  const [phoneOtp, setPhoneOtp] = useState(['', '', '', '', '', '']);
  const [phoneVerified, setPhoneVerified] = useState(false);
  
  // 2FA
  const [twoFactorCode, setTwoFactorCode] = useState(['', '', '', '', '', '']);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  
  // Remember me
  const [rememberMe, setRememberMe] = useState(false);
  const [passwordless, setPasswordless] = useState(false);
  
  // Social login dropdown
  const [showSocial, setShowSocial] = useState(false);
  
  // Check registration status
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [checkingReg, setCheckingReg] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("tigerex-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    }
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("tigerex-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  // Check if email/phone is registered
  const checkRegistration = async (value: string) => {
    if (!value) return;
    setCheckingReg(true);
    setIsRegistered(null);
    
    // Simulate API check
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Mock: always registered for demo
    setIsRegistered(true);
    setCheckingReg(false);
  };

  // Handle email input change
  const handleEmailChange = (value: string) => {
    setEmail(value);
    setError('');
    if (value.includes('@')) {
      checkRegistration(value);
    }
  };

  // Handle phone input change
  const handlePhoneChange = (value: string) => {
    setPhone(value);
    setError('');
    if (value.length >= 5) {
      checkRegistration(value);
    }
  };

  // Handle code input
  const handleCodeInput = (index: number, value: string, setter: React.Dispatch<React.SetStateAction<string[]>>, onComplete: () => void) => {
    const newCode = [...Array(6).fill('')];
    newCode[index] = value.slice(-1);
    setter(newCode);
    
    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`code-${index + 1}`);
      nextInput?.focus();
    }
    
    // Check if complete
    if (newCode.every(c => c) && onComplete) {
      onComplete();
    }
  };

  // Handle credentials submission
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (lockedUntil && Date.now() < lockedUntil) {
      setError(`Account locked. Try again in ${Math.ceil((lockedUntil - Date.now()) / 60000)} minutes`);
      return;
    }
    
    if (!email && !phone) {
      setError('Please enter email or phone number');
      return;
    }
    
    if (!isRegistered) {
      router.push('/register');
      return;
    }
    
    setLoading(true);
    setLoadingMsg('Verifying credentials...');
    
    // Simulate verification
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    if (!emailVerified && !phoneVerified) {
      // Need to verify email/phone first
      if (email) {
        setStep('email-verify');
        setLoading(false);
        setLoadingMsg('');
        return;
      }
    }
    
    // Check 2FA
    if (twoFactorEnabled) {
      setStep('2fa');
      setLoading(false);
      return;
    }
    
    // Login successful
    setSuccess('Login successful!');
    await new Promise(resolve => setTimeout(resolve, 1000));
    router.push('/markets');
  };

  // Handle email verification
  const handleEmailVerify = async () => {
    const code = emailCode.join('');
    if (code.length !== 6) {
      setError('Please enter 6-digit code');
      return;
    }
    
    setLoading(true);
    setLoadingMsg('Verifying email...');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setEmailVerified(true);
    setSuccess('Email verified!');
    
    // Check if need 2FA
    if (twoFactorEnabled) {
      setStep('2fa');
    } else {
      router.push('/markets');
    }
    setLoading(false);
  };

  // Handle phone verification
  const handlePhoneVerify = async () => {
    const code = phoneOtp.join('');
    if (code.length !== 6) {
      setError('Please enter 6-digit code');
      return;
    }
    
    setLoading(true);
    setLoadingMsg('Verifying phone...');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setPhoneVerified(true);
    setSuccess('Phone verified!');
    router.push('/markets');
    setLoading(false);
  };

  // Handle 2FA verification
  const handle2FAVerify = async () => {
    const code = twoFactorCode.join('');
    if (code.length !== 6) {
      setError('Please enter 6-digit code');
      return;
    }
    
    setLoading(true);
    setLoadingMsg('Verifying 2FA...');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Success
    if (rememberMe) {
      localStorage.setItem('tigerex-session', '30days');
    }
    router.push('/markets');
  };

  // Handle passwordless login
  const handlePasswordlessSubmit = async () => {
    if (!emailVerified && !phoneVerified) {
      setError('Please verify email or phone first');
      return;
    }
    
    setLoading(true);
    setLoadingMsg('Sending login link...');
    
    await new Promise(resolve => setTimeout(resolve, 800));
    
    setSuccess('Login link sent! Check your email.');
    setLoading(false);
  };

  // Password strength indicator
  const getPasswordStrength = (pwd: string): { level: string; color: string; width: string } => {
    if (!pwd) return { level: '', color: 'bg-gray-200', width: 'w-0' };
    if (pwd.length < 6) return { level: 'Weak', color: 'bg-red-500', width: 'w-1/4' };
    if (pwd.length < 8) return { level: 'Medium', color: 'bg-yellow-500', width: 'w-1/2' };
    if (!/[A-Z]/.test(pwd) || !/[0-9]/.test(pwd)) return { level: 'Medium', color: 'bg-yellow-500', width: 'w-1/2' };
    return { level: 'Strong', color: 'bg-green-500', width: 'w-full' };
  };

  const passwordStrength = getPasswordStrength(password);

  // Theme-aware styles
  const isDark = theme === "dark";
  const bgPrimary = isDark ? "bg-[#0A0A0F]" : "bg-white";
  const bgSecondary = isDark ? "bg-[#14141A]" : "bg-gray-50";
  const textPrimary = isDark ? "text-white" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-600";
  const borderColor = isDark ? "border-white/10" : "border-gray-200";
  const inputBg = isDark ? "bg-white/5" : "bg-gray-50";
  const cardBg = isDark ? "bg-white/5" : "bg-gray-100";

  if (!mounted) {
    return <div className={`min-h-screen ${bgPrimary}`} />;
  }

  return (
    <div className={`min-h-screen flex ${bgPrimary} ${textPrimary}`}>
      {/* Theme Toggle - Always Visible */}
      <button
        onClick={toggleTheme}
        className={`fixed top-4 right-4 z-50 p-2 rounded-lg ${isDark ? "bg-white/10 hover:bg-white/20" : "bg-gray-100 hover:bg-gray-200"}`}
      >
        {isDark ? <Sun className="h-5 w-5 text-yellow-400" /> : <Moon className="h-5 w-5 text-gray-600" />}
      </button>

      {/* Left Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Logo + Back Link */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
                  <span className="text-xl font-bold text-white">T</span>
                </div>
                <span className={`text-2xl font-bold ${textPrimary}`}>TigerEx</span>
              </Link>
            </div>
            <Link href="/" className={`text-sm ${textSecondary} hover:text-orange-500 flex items-center gap-1`}>
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
          </div>

          {/* Step-based content */}
          {step === "credentials" && (
            <>
              {/* Heading */}
              <div>
                <h1 className={`text-3xl font-bold ${textPrimary}`}>Welcome back</h1>
                <p className={`mt-2 ${textSecondary}`}>Enter your credentials to access your account</p>
              </div>

              {/* Error/Success Messages */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  {success}
                </div>
              )}

              {/* Loading Overlay */}
              {loading && (
                <div className="flex items-center justify-center gap-2 p-4 bg-orange-500/10 rounded-lg">
                  <Loader2 className="h-5 w-5 text-orange-500 animate-spin" />
                  <span className="text-orange-400">{loadingMsg}</span>
                </div>
              )}

              {/* Registration Status */}
              {isRegistered === true && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  Account found
                </div>
              )}
              {isRegistered === false && (
                <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
                  <XCircle className="h-4 w-4" />
                  No account found. Redirecting to register...
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleCredentialsSubmit} className="space-y-5">
                {/* Login Mode Toggle */}
                <div className="flex rounded-lg border border-white/10 bg-white/5 p-1">
                  <button type="button" className={`flex-1 py-2 rounded ${!passwordless ? "bg-white/10 text-white" : "text-gray-400"}`}>
                    <Mail className="inline h-4 w-4 mr-1" /> Email
                  </button>
                  <button type="button" className={`flex-1 py-2 rounded ${passwordless ? "bg-white/10 text-white" : "text-gray-400"}`}>
                    <Smartphone className="inline h-4 w-4 mr-1" /> Phone
                  </button>
                </div>

                {/* Email Input */}
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1.5`}>Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      placeholder="name@example.com"
                      className={`w-full ${inputBg} ${borderColor} rounded-lg pl-11 pr-4 py-3 ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:border-orange-500`}
                    />
                    {checkingReg && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500 animate-spin" />}
                  </div>
                </div>

                {/* Phone Input with Country Code */}
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1.5`}>Phone</label>
                  <div className="flex gap-2">
                    <select
                      value={phoneCode}
                      onChange={(e) => setPhoneCode(e.target.value)}
                      className={`${inputBg} ${borderColor} rounded-lg px-2 py-3 ${textPrimary}`}
                    >
                      {COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="1234567890"
                      className={`flex-1 ${inputBg} ${borderColor} rounded-lg pl-4 pr-4 py-3 ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:border-orange-500`}
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`text-sm ${textSecondary}`}>Password</label>
                    <Link href="/forgot-password" className="text-sm text-orange-500 hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`w-full ${inputBg} ${borderColor} rounded-lg pl-11 pr-11 py-3 ${textPrimary} placeholder:text-gray-500 focus:outline-none focus:border-orange-500`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </div>
                </div>

                {/* Remember + Passwordless Options */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <input 
                      type="checkbox" 
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded bg-white/5 border-white/10" 
                    />
                    Remember me (30 days)
                  </label>
                  <button type="button" className="text-sm text-orange-500 hover:underline">
                    Passwordless login
                  </button>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || !isRegistered}
                  className={`w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2`}
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign In"}
                </button>
              </form>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className={`w-full ${borderColor}`} />
                </div>
                <div className="relative flex justify-center">
                  <span className={`px-4 ${bgPrimary} ${textSecondary} text-sm`}>or continue with</span>
                </div>
              </div>

              {/* Social Login */}
              <div className="space-y-3">
                {/* Social Buttons */}
                <div className="grid grid-cols-4 gap-3">
                  {SOCIAL_PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={`flex items-center justify-center gap-2 py-3 rounded-lg ${inputBg} ${borderColor} hover:bg-white/10 transition-colors`}
                    >
                      <provider.icon className="h-5 w-5" style={{ color: provider.color }} />
                    </button>
                  ))}
                </div>

                {/* More Social - Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSocial(!showSocial)}
                    className={`w-full py-3 rounded-lg ${inputBg} ${borderColor} text-sm ${textSecondary} flex items-center justify-center gap-2`}
                  >
                    More options <ArrowRight className="h-4 w-4" />
                  </button>
                  {showSocial && (
                    <div className={`absolute top-full left-0 right-0 mt-2 rounded-lg border ${borderColor} ${bgSecondary} overflow-hidden z-10`}>
                      {SOCIAL_PROVIDERS.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          className={`w-full py-3 px-4 flex items-center gap-3 hover:bg-white/5 ${textPrimary}`}
                        >
                          <provider.icon className="h-5 w-5" style={{ color: provider.color }} />
                          {provider.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Passkey */}
                <button
                  type="button"
                  className={`w-full py-3 rounded-lg ${inputBg} ${borderColor} flex items-center justify-center gap-2 ${textSecondary} hover:bg-white/10`}
                >
                  <Key className="h-5 w-5" /> Passkey
                </button>
              </div>

              {/* Sign Up Link */}
              <div className={`text-center text-sm ${textSecondary}`}>
                Don't have an account?{' '}
                <Link href="/register" className="text-orange-500 hover:underline font-medium">
                  Create one
                </Link>
              </div>
            </>
          )}

          {/* Email Verification Step */}
          {step === "email-verify" && (
            <div className="space-y-6">
              <div className="text-center">
                <Mail className="h-12 w-12 text-orange-500 mx-auto mb-4" />
                <h2 className={`text-2xl font-bold ${textPrimary}`}>Verify your email</h2>
                <p className={`mt-2 ${textSecondary}`}>Enter the 6-digit code sent to {email}</p>
              </div>

              <div className="flex justify-center gap-2">
                {emailCode.map((_, i) => (
                  <input
                    key={i}
                    id={`code-${i}`}
                    type="text"
                    maxLength={1}
                    value={emailCode[i]}
                    onChange={(e) => handleCodeInput(i, e.target.value, setEmailCode, () => {})}
                    className={`w-12 h-14 text-center text-xl font-bold ${inputBg} ${borderColor} rounded-lg ${textPrimary} focus:outline-none focus:border-orange-500`}
                  />
                ))}
              </div>

              <button
                onClick={handleEmailVerify}
                disabled={loading}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify"}
              </button>

              <button onClick={() => setStep("credentials")} className={`w-full py-3 text-sm ${textSecondary}`}>
                <ArrowLeft className="inline h-4 w-4 mr-1" /> Back
              </button>
            </div>
          )}

          {/* 2FA Step */}
          {step === "2fa" && (
            <div className="space-y-6">
              <div className="text-center">
                <Shield className="h-12 w-12 text-orange-500 mx-auto mb-4" />
                <h2 className={`text-2xl font-bold ${textPrimary}`}>2FA Verification</h2>
                <p className={`mt-2 ${textSecondary}`}>Enter your 2FA code</p>
              </div>

              <div className="flex justify-center gap-2">
                {twoFactorCode.map((_, i) => (
                  <input
                    key={i}
                    id={`2fa-${i}`}
                    type="text"
                    maxLength={1}
                    value={twoFactorCode[i]}
                    onChange={(e) => handleCodeInput(i, e.target.value, setTwoFactorCode, () => {})}
                    className={`w-12 h-14 text-center text-xl font-bold ${inputBg} ${borderColor} rounded-lg ${textPrimary} focus:outline-none focus:border-orange-500`}
                  />
                ))}
              </div>

              <button
                onClick={handle2FAVerify}
                disabled={loading}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Background */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-orange-500/20 to-purple-500/20 items-center justify-center p-12">
        <div className="max-w-lg text-center">
          <div className="grid grid-cols-3 gap-8 mb-8">
            {[
              { icon: TrendingUp, label: '99.9% Uptime' },
              { icon: Shield, label: 'Bank-Grade Security' },
              { icon: Zap, label: 'Fast Execution' },
              { icon: Globe, label: '150+ Countries' },
              { icon: Users, label: '10M+ Users' },
              { icon: CreditCard, label: '200+ Assets' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                  <item.icon className="h-6 w-6 text-orange-500" />
                </div>
                <span className="text-sm text-gray-300">{item.label}</span>
              </div>
            ))}
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-4">
            Trade with Confidence
          </h2>
          <p className="text-gray-400">
            Join millions of traders worldwide on the most secure cryptocurrency exchange platform.
          </p>
        </div>
      </div>
    </div>
  );
}