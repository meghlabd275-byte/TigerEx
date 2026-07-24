'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Theme
const useTheme = () => {
  const [theme, setTheme] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('tigerex-theme');
    const isDark = saved === 'dark' || (!saved && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(isDark ? {
      mode: 'dark',
      colors: {
        primary: '#f97316', secondary: '#fb923c', background: '#0f172a', surface: '#1e293b',
        text: '#f8fafc', textSecondary: '#94a3b8', border: '#334155', error: '#f87171', success: '#4ade80'
      }
    } : {
      mode: 'light',
      colors: {
        primary: '#f97316', secondary: '#ea580c', background: '#ffffff', surface: '#f8fafc',
        text: '#0f172a', textSecondary: '#64748b', border: '#e2e8f0', error: '#ef4444', success: '#22c55e'
      }
    });
  }, []);

  const toggleTheme = () => {
    const newTheme = theme?.mode === 'light' 
      ? { mode: 'dark', colors: { primary: '#f97316', secondary: '#fb923c', background: '#0f172a', surface: '#1e293b', text: '#f8fafc', textSecondary: '#94a3b8', border: '#334155', error: '#f87171', success: '#4ade80' }}
      : { mode: 'light', colors: { primary: '#f97316', secondary: '#ea580c', background: '#ffffff', surface: '#f8fafc', text: '#0f172a', textSecondary: '#64748b', border: '#e2e8f0', error: '#ef4444', success: '#22c55e' }};
    setTheme(newTheme);
    localStorage.setItem('tigerex-theme', newTheme.mode);
  };

  return { theme, toggleTheme, mounted };
};

// Countries
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
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'PE', name: 'Peru', dialCode: '+51', flag: '🇵🇪' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
];

// Components
const Button: React.FC<any> = ({ children, variant = 'primary', loading = false, disabled, fullWidth, style, onClick, type, className }) => {
  const { theme } = useTheme();
  const variantStyles: any = {
    primary: { bg: theme?.colors.primary, color: 'white' },
    outline: { bg: 'transparent', color: theme?.colors.primary, border: `1px solid ${theme?.colors.primary}` },
  };
  const vs = variantStyles[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      className={`font-semibold rounded-lg transition-all duration-200 px-6 py-3 ${fullWidth ? 'w-full' : ''} ${className || ''}`}
      style={{ backgroundColor: disabled ? `${vs.bg}50` : vs.bg, color: vs.color, border: vs.border, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      {loading && <span className="inline-block animate-spin mr-2 h-4 w-4 border-2 border-t-transparent rounded-full" style={{ borderTopColor: 'white' }} />}
      {children}
    </button>
  );
};

const Input: React.FC<any> = ({ style, type = 'text', value, onChange, placeholder, autoFocus, className }) => {
  const { theme } = useTheme();
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus}
      className={`w-full px-4 py-3 rounded-lg outline-none transition-all ${className || ''}`}
      style={{ backgroundColor: theme?.colors.surface, color: theme?.colors.text, border: `1px solid ${theme?.colors.border}`, ...style }} />
  );
};

const SmartInput = ({ value, onChange, placeholder, autoFocus, type = 'text' }: any) => {
  const { theme } = useTheme();
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const isPhone = type === 'tel';

  const detectType = (val: string) => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    const phoneDigits = val.replace(/[\s\-\(\)\.]+/g, '').replace(/^\+/, '');
    if (emailRegex.test(val)) return 'email';
    if (/^[1-9]\d{7,14}$/.test(phoneDigits) && phoneDigits.length >= 8) return 'phone';
    return 'unknown';
  };

  const handleCountrySelect = (country: any) => {
    setSelectedCountry(country);
    setShowDropdown(false);
    const current = value.replace(/^\+\d+\s*/, '');
    onChange(country.dialCode + ' ' + current);
  };

  return (
    <div className="relative">
      <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: theme?.colors.border, backgroundColor: theme?.colors.surface }}>
        {isPhone && (
          <button type="button" onClick={() => setShowDropdown(!showDropdown)} className="flex items-center px-3 py-3 border-r" style={{ borderColor: theme?.colors.border }}>
            <span className="mr-1">{selectedCountry.flag}</span>
            <span className="text-sm" style={{ color: theme?.colors.textSecondary }}>{selectedCountry.dialCode}</span>
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
        )}
        <input type={type} value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
          className="flex-1 px-4 py-3 outline-none" style={{ backgroundColor: 'transparent', color: theme?.colors.text }} />
      </div>
      {showDropdown && isPhone && (
        <div className="absolute z-50 w-full mt-1 rounded-lg shadow-lg max-h-60 overflow-y-auto" style={{ backgroundColor: theme?.colors.surface, border: `1px solid ${theme?.colors.border}` }}>
          {COUNTRIES.map((country: any) => (
            <button key={country.code} type="button" onClick={() => handleCountrySelect(country)} className="w-full px-4 py-2 flex items-center hover:opacity-80" style={{ color: theme?.colors.text }}>
              <span className="mr-3">{country.flag}</span>
              <span className="flex-1 text-left">{country.name}</span>
              <span style={{ color: theme?.colors.textSecondary }}>{country.dialCode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const PasswordInput = ({ value, onChange, placeholder }: any) => {
  const { theme } = useTheme();
  const [show, setShow] = useState(false);
  const [strength, setStrength] = useState({ score: 0, color: theme?.colors.error, message: '' });

  useEffect(() => {
    if (!value) { setStrength({ score: 0, color: theme?.colors.error, message: '' }); return; }
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
  }, [value, theme?.colors.error]);

  return (
    <div>
      <div className="relative">
        <Input type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} style={{ paddingRight: '3rem' }} />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2">
          {show ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
          : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
        </button>
      </div>
      {value && (
        <div className="mt-2">
          <div className="flex gap-1 mb-1">{[1,2,3,4,5].map(i => <div key={i} className="flex-1 h-1 rounded-full" style={{ backgroundColor: strength.score >= i ? strength.color : theme?.colors.border }} />)}</div>
          <p className="text-xs" style={{ color: strength.color }}>{strength.message}</p>
        </div>
      )}
    </div>
  );
};

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
          style={{ backgroundColor: theme?.colors.surface, color: theme?.colors.text, border: `2px solid ${theme?.colors.border}` }}
          onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
};

// Main Forgot Password Page
export default function ForgotPasswordPage() {
  const router = useRouter();
  const { theme, toggleTheme, mounted } = useTheme();
  
  const [step, setStep] = useState(1);
  const [credential, setCredential] = useState('');
  const [credentialType, setCredentialType] = useState<'email' | 'phone' | null>(null);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    const phoneRegex = /^[1-9]\d{7,14}$/;
    const phoneDigits = credential.replace(/[\s\-\(\)\.]+/g, '').replace(/^\+/, '');
    
    if (emailRegex.test(credential)) setCredentialType('email');
    else if (phoneRegex.test(phoneDigits) && phoneDigits.length >= 8) setCredentialType('phone');
    else setCredentialType(null);
  }, [credential]);

  const isValid = credentialType !== null;

  // Step 1: Check if account exists
  const handleCredentialSubmit = async () => {
    if (!isValid) return;
    setIsLoading(true);
    setError('');
    
    try {
      const checkRes = await fetch('/api/auth/check-existence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const checkData = await checkRes.json();
      
      if (!checkData.exists) {
        router.push(`/register?credential=${encodeURIComponent(credential)}`);
        return;
      }
      
      // Check if 2FA enabled
      if (checkData.twoFactorEnabled) {
        setRequires2FA(true);
      }
      
      // Send OTP
      const otpRes = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, type: 'password_reset' }),
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
        body: JSON.stringify({ credential, otp, type: 'password_reset' }),
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

  // Step 2b: Verify 2FA if enabled
  const handle2FAVerify = async () => {
    if (otp.length !== 6) return;
    setIsLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, code: otp }),
      });
      const data = await res.json();
      
      if (data.success) {
        setStep(3);
      } else {
        setError(data.message || 'Invalid 2FA code');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Reset password
  const handleResetPassword = async () => {
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    
    setIsLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, newPassword }),
      });
      const data = await res.json();
      
      if (data.success) {
        setSuccess('Password reset successfully! Redirecting to login...');
        setTimeout(() => router.push('/login'), 2000);
      } else {
        setError(data.message || 'Password reset failed');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ backgroundColor: theme?.colors.background }}>
      <div className="w-full max-w-md p-8 rounded-2xl shadow-xl" style={{ backgroundColor: theme?.colors.surface }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold" style={{ color: theme?.colors.primary }}>TigerEx</h1>
          <p style={{ color: theme?.colors.textSecondary }}>Reset Password</p>
        </div>

        {/* Steps */}
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3].map(s => (
            <div key={s} className="w-2 h-2 rounded-full transition-colors" style={{ backgroundColor: step >= s ? theme?.colors.primary : theme?.colors.border }} />
          ))}
        </div>

        {/* Error/Success */}
        {error && <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: `${theme?.colors.error}20`, color: theme?.colors.error }}>{error}</div>}
        {success && <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: `${theme?.colors.success}20`, color: theme?.colors.success }}>{success}</div>}

        {/* Step 1: Credential */}
        {step === 1 && (
          <div>
            <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Email or Phone Number</label>
            <SmartInput value={credential} onChange={setCredential} placeholder="Enter email or phone" autoFocus type={credentialType === 'phone' ? 'tel' : 'email'} />
            <Button onClick={handleCredentialSubmit} loading={isLoading} disabled={!isValid} fullWidth size="lg" className="mt-6">Continue</Button>
          </div>
        )}

        {/* Step 2: OTP/2FA Verification */}
        {step === 2 && (
          <div>
            <button onClick={() => setStep(1)} className="flex items-center mb-4 text-sm" style={{ color: theme?.colors.primary }}>← Back</button>
            <p className="text-center mb-6" style={{ color: theme?.colors.text }}>
              Enter the 6-digit code {requires2FA ? '(2FA)' : 'sent to your'} {credentialType === 'email' ? 'email' : 'phone'}
            </p>
            <OTPInput value={otp} onChange={setOtp} />
            <Button onClick={requires2FA ? handle2FAVerify : handleOTPVerify} loading={isLoading} disabled={otp.length !== 6} fullWidth size="lg" className="mt-6">
              {requires2FA ? 'Verify 2FA' : 'Verify'}
            </Button>
            {requires2FA && (
              <p className="mt-4 text-center text-sm" style={{ color: theme?.colors.textSecondary }}>
                Lost access to 2FA? <a href="/2fa-reset" style={{ color: theme?.colors.primary }}>Reset 2FA</a>
              </p>
            )}
            <p className="mt-4 text-center text-sm" style={{ color: theme?.colors.textSecondary }}>
              Didn't receive? <button className="font-semibold" style={{ color: theme?.colors.primary }}>Resend</button>
            </p>
          </div>
        )}

        {/* Step 3: New Password */}
        {step === 3 && (
          <div>
            <button onClick={() => setStep(2)} className="flex items-center mb-4 text-sm" style={{ color: theme?.colors.primary }}>← Back</button>
            
            <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>New Password</label>
            <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Create new password" />
            
            <label className="block mt-4 mb-2 font-medium" style={{ color: theme?.colors.text }}>Confirm Password</label>
            <Input type="password" value={confirmPassword} onChange={(e: any) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" />
            
            <Button onClick={handleResetPassword} loading={isLoading} disabled={!newPassword || !confirmPassword} fullWidth size="lg" className="mt-6">Reset Password</Button>
          </div>
        )}

        {/* Back to Login */}
        <p className="mt-6 text-center">
          <Link href="/login" className="text-sm flex items-center justify-center gap-1" style={{ color: theme?.colors.textSecondary }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to Login
          </Link>
        </p>
      </div>

      {/* Theme Toggle */}
      <button onClick={toggleTheme} className="fixed top-4 right-4 p-3 rounded-full shadow-lg" style={{ backgroundColor: theme?.colors.surface }} aria-label="Toggle theme">
        {theme?.mode === 'light' 
          ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          : <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
      </button>
    </div>
  );
}
