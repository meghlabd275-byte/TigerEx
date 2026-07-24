'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

// Reuse theme context from login page
interface Theme {
  mode: 'light' | 'dark';
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    error: string;
    success: string;
    warning: string;
    info: string;
  };
}

const lightTheme: Theme = {
  mode: 'light',
  colors: {
    primary: '#f97316',
    secondary: '#ea580c',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textSecondary: '#64748b',
    border: '#e2e8f0',
    error: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
};

const darkTheme: Theme = {
  mode: 'dark',
  colors: {
    primary: '#f97316',
    secondary: '#fb923c',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    border: '#334155',
    error: '#f87171',
    success: '#4ade80',
    warning: '#fbbf24',
    info: '#60a5fa',
  },
};

// Simple theme hook (same as login)
const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(lightTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('tigerex-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setTheme(darkTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const newTheme = prev.mode === 'light' ? darkTheme : lightTheme;
      localStorage.setItem('tigerex-theme', newTheme.mode);
      return newTheme;
    });
  }, []);

  return { theme, toggleTheme, mounted };
};

// Countries list (same as login)
const COUNTRIES = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰' },
  { code: 'AE', name: 'UAE', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
];

// Reusable components (simplified)
const Button: React.FC<any> = ({ children, variant = 'primary', size = 'md', loading = false, fullWidth = false, disabled, style, ...props }) => {
  const { theme } = useTheme();
  const sizeClasses = { sm: 'px-4 py-2 text-sm', md: 'px-6 py-3 text-base', lg: 'px-8 py-4 text-lg' };
  const variantStyles: any = {
    primary: { bg: theme.colors.primary, color: 'white' },
    outline: { bg: 'transparent', color: theme.colors.primary, border: `1px solid ${theme.colors.primary}` },
  };
  const vs = variantStyles[variant];
  return (
    <button disabled={disabled || loading} className={`font-semibold rounded-lg transition-all duration-200 ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''}`}
      style={{ backgroundColor: disabled ? `${vs.bg}50` : vs.bg, color: vs.color, border: vs.border, cursor: disabled ? 'not-allowed' : 'pointer', ...style }} {...props}>
      {loading && <span className="inline-block animate-spin mr-2 h-4 w-4 border-2 border-t-transparent rounded-full" style={{ borderTopColor: 'white' }} />}
      {children}
    </button>
  );
};

const Input: React.FC<any> = ({ style, ...props }) => {
  const { theme } = useTheme();
  return (
    <input className="w-full px-4 py-3 rounded-lg outline-none transition-all" style={{ backgroundColor: theme.colors.surface, color: theme.colors.text, border: `1px solid ${theme.colors.border}`, ...style }} {...props} />
  );
};

// Smart input (simplified)
const SmartInput = ({ value, onChange, placeholder, autoFocus, type = 'text' }: any) => {
  const { theme } = useTheme();
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const isPhone = type === 'tel';

  const handleCountrySelect = (country: any) => {
    setSelectedCountry(country);
    setShowDropdown(false);
    const current = value.replace(/^\+\d+\s*/, '');
    onChange(country.dialCode + ' ' + current);
  };

  return (
    <div className="relative">
      <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
        {isPhone && (
          <button type="button" onClick={() => setShowDropdown(!showDropdown)} className="flex items-center px-3 py-3 border-r" style={{ borderColor: theme.colors.border }}>
            <span className="mr-1">{selectedCountry.flag}</span>
            <span className="text-sm" style={{ color: theme.colors.textSecondary }}>{selectedCountry.dialCode}</span>
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
        )}
        <input type={type} value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
          className="flex-1 px-4 py-3 outline-none" style={{ backgroundColor: 'transparent', color: theme.colors.text }} />
      </div>
      {showDropdown && isPhone && (
        <div className="absolute z-50 w-full mt-1 rounded-lg shadow-lg max-h-60 overflow-y-auto" style={{ backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}` }}>
          {COUNTRIES.map((country: any) => (
            <button key={country.code} type="button" onClick={() => handleCountrySelect(country)} className="w-full px-4 py-2 flex items-center hover:opacity-80" style={{ color: theme.colors.text }}>
              <span className="mr-3">{country.flag}</span>
              <span className="flex-1 text-left">{country.name}</span>
              <span style={{ color: theme.colors.textSecondary }}>{country.dialCode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Password strength indicator
const PasswordInput = ({ value, onChange, placeholder }: any) => {
  const { theme } = useTheme();
  const [show, setShow] = useState(false);
  const [strength, setStrength] = useState({ score: 0, color: theme.colors.error, message: '' });

  useEffect(() => {
    if (!value) { setStrength({ score: 0, color: theme.colors.error, message: '' }); return; }
    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[a-z]/.test(value)) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[!@#$%^&*]/.test(value)) score++;
    
    let color = '#ef4444', message = 'Very Weak';
    if (score <= 2) { color = '#ef4444'; message = 'Very Weak'; }
    else if (score <= 3) { color = '#f97316'; message = 'Weak'; }
    else if (score <= 5) { color = '#eab308'; message = 'Medium'; }
    else { color = '#22c55e'; message = 'Strong'; }
    
    setStrength({ score, color, message });
  }, [value, theme.colors.error]);

  return (
    <div>
      <div className="relative">
        <Input type={show ? 'text' : 'password'} value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder}
          style={{ paddingRight: '3rem' }} />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2">
          {show ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
            : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
        </button>
      </div>
      {value && (
        <div className="mt-2">
          <div className="flex gap-1 mb-1">{[1,2,3,4,5].map(i => <div key={i} className="flex-1 h-1 rounded-full" style={{ backgroundColor: strength.score >= i ? strength.color : theme.colors.border }} />)}</div>
          <p className="text-xs" style={{ color: strength.color }}>{strength.message}</p>
        </div>
      )}
    </div>
  );
};

// OTP Input
const OTPInput = ({ value, onChange, length = 6 }: any) => {
  const { theme } = useTheme();
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (idx: number, char: string) => {
    if (!/^\d*$/.test(char)) return;
    const v = value.padEnd(length, ' ').split('');
    v[idx] = char;
    onChange(v.slice(0, length).join(''));
    if (char && idx < length - 1) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx: number, e: any) => {
    if (e.key === 'Backspace' && !value[idx] && idx > 0) refs.current[idx - 1]?.focus();
  };

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length }, (_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={value[i] || ''}
          onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-12 h-14 text-center text-xl font-bold rounded-lg outline-none"
          style={{ backgroundColor: theme.colors.surface, color: theme.colors.text, border: `2px solid ${theme.colors.border}` }}
          onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
};

// Main Register Page
export default function RegisterPage() {
  const router = useRouter();
  const { theme, toggleTheme, mounted } = useTheme();
  
  const [step, setStep] = useState(1);
  const [credential, setCredential] = useState('');
  const [credentialType, setCredentialType] = useState<'email' | 'phone' | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Detect credential type
  useEffect(() => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    const phoneRegex = /^[1-9]\d{7,14}$/;
    const phoneDigits = credential.replace(/[\s\-\(\)\.]+/g, '').replace(/^\+/, '');
    
    if (emailRegex.test(credential)) setCredentialType('email');
    else if (phoneRegex.test(phoneDigits) && phoneDigits.length >= 8) setCredentialType('phone');
    else setCredentialType(null);
  }, [credential]);

  const isValid = credentialType !== null;

  // Step 1: Check if user exists, then send OTP
  const handleCredentialSubmit = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError('');
    
    try {
      // Check if already exists
      const checkRes = await fetch('/api/auth/check-existence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const checkData = await checkRes.json();
      
      if (checkData.exists) {
        // Already registered - redirect to login
        router.push(`/login?credential=${encodeURIComponent(credential)}`);
        return;
      }
      
      // Send OTP
      const otpRes = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, type: credentialType }),
      });
      const otpData = await otpRes.json();
      
      if (otpData.success) {
        setStep(2);
      } else {
        setError(otpData.message || 'Failed to send OTP');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleOTPVerify = async () => {
    if (otp.length !== 6) return;
    setIsLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, otp, type: 'register' }),
      });
      const data = await res.json();
      
      if (data.success) {
        setStep(3);
      } else {
        setError(data.message || 'Invalid OTP');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Password and complete registration
  const handleRegister = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!termsAccepted) { setError('Please accept the terms and conditions'); return; }
    
    setIsLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, password, referralCode, termsAccepted }),
      });
      const data = await res.json();
      
      if (data.success) {
        localStorage.setItem('tigerex_access_token', data.accessToken || '');
        router.push('/dashboard');
      } else {
        setError(data.message || 'Registration failed');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ backgroundColor: theme.colors.background }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md p-8 rounded-2xl shadow-xl" style={{ backgroundColor: theme.colors.surface }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold" style={{ color: theme.colors.primary }}>TigerEx</h1>
          <p style={{ color: theme.colors.textSecondary }}>Create your account</p>
        </div>

        {/* Steps */}
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3].map(s => (
            <div key={s} className="w-2 h-2 rounded-full transition-colors" style={{ backgroundColor: step >= s ? theme.colors.primary : theme.colors.border }} />
          ))}
        </div>

        {/* Error */}
        {error && <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: `${theme.colors.error}20`, color: theme.colors.error }}>{error}</div>}

        {/* Step 1: Credential */}
        {step === 1 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>Email or Phone Number</label>
            <SmartInput value={credential} onChange={setCredential} placeholder="Enter email or phone" autoFocus type={credentialType === 'phone' ? 'tel' : 'email'} />
            <Button onClick={handleCredentialSubmit} loading={isLoading} disabled={!isValid} fullWidth size="lg" className="mt-6">Continue</Button>
          </motion.div>
        )}

        {/* Step 2: OTP Verification */}
        {step === 2 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <button onClick={() => setStep(1)} className="flex items-center mb-4 text-sm" style={{ color: theme.colors.primary }}>← Back</button>
            <p className="text-center mb-6" style={{ color: theme.colors.text }}>
              Enter the 6-digit code sent to your {credentialType === 'email' ? 'email' : 'phone'}
            </p>
            <OTPInput value={otp} onChange={setOtp} />
            <Button onClick={handleOTPVerify} loading={isLoading} disabled={otp.length !== 6} fullWidth size="lg" className="mt-6">Verify</Button>
            <p className="mt-4 text-center text-sm" style={{ color: theme.colors.textSecondary }}>
              Didn't receive? <button className="font-semibold" style={{ color: theme.colors.primary }}>Resend</button>
            </p>
          </motion.div>
        )}

        {/* Step 3: Password */}
        {step === 3 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <button onClick={() => setStep(2)} className="flex items-center mb-4 text-sm" style={{ color: theme.colors.primary }}>← Back</button>
            
            <label className="block mb-2 font-medium" style={{ color: theme.colors.text }}>Password</label>
            <PasswordInput value={password} onChange={setPassword} placeholder="Create a password" />
            
            <label className="block mt-4 mb-2 font-medium" style={{ color: theme.colors.text }}>Confirm Password</label>
            <Input type="password" value={confirmPassword} onChange={(e: any) => setConfirmPassword(e.target.value)} placeholder="Confirm your password" />
            
            <label className="block mt-4 mb-2 font-medium" style={{ color: theme.colors.text }}>Referral Code (Optional)</label>
            <Input value={referralCode} onChange={(e: any) => setReferralCode(e.target.value)} placeholder="Enter referral code" />
            
            <label className="flex items-center mt-4 cursor-pointer">
              <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: theme.colors.primary }} />
              <span className="ml-2 text-sm" style={{ color: theme.colors.textSecondary }}>
                I agree to the <a href="/terms" style={{ color: theme.colors.primary }}>Terms</a> and <a href="/privacy" style={{ color: theme.colors.primary }}>Privacy Policy</a>
              </span>
            </label>
            
            <Button onClick={handleRegister} loading={isLoading} disabled={!password || !confirmPassword || !termsAccepted} fullWidth size="lg" className="mt-6">Create Account</Button>
          </motion.div>
        )}

        {/* Social Login */}
        {step === 1 && (
          <div className="mt-8">
            <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t" style={{ borderColor: theme.colors.border }} /></div>
              <div className="relative flex justify-center text-sm"><span className="px-2" style={{ backgroundColor: theme.colors.surface, color: theme.colors.textSecondary }}>Or continue with</span></div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {['G', '🍎', '✈️', '🦊'].map((icon, i) => (
                <button key={i} type="button" className="flex items-center justify-center p-3 rounded-lg border" style={{ borderColor: theme.colors.border }}>
                  <span className="text-lg">{icon}</span>
                </button>
              ))}
            </div>
            <p className="mt-6 text-center text-sm" style={{ color: theme.colors.textSecondary }}>
              Already have an account? <a href="/login" className="font-semibold" style={{ color: theme.colors.primary }}>Login</a>
            </p>
          </div>
        )}

        <p className="mt-6 text-center">
          <a href="/" className="text-sm flex items-center justify-center gap-1" style={{ color: theme.colors.textSecondary }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to home
          </a>
        </p>
      </motion.div>

      {/* Theme Toggle */}
      <button onClick={toggleTheme} className="fixed top-4 right-4 p-3 rounded-full shadow-lg" style={{ backgroundColor: theme.colors.surface }} aria-label="Toggle theme">
        {theme.mode === 'light' ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          : <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
      </button>
    </div>
  );
}
