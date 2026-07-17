"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Eye, 
  EyeOff, 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  ArrowRight,
  Mail,
  Phone,
  Smartphone,
  KeyRound,
  Shield,
  Chrome,
  Apple,
  Send,
  ArrowLeft,
  Wallet
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import PasswordInput from '@/components/auth/PasswordInput';
import { useAuth } from '@/components/auth/AuthContext';
import { ThemeToggle } from '@/components/theme-toggle';

// Login steps
type LoginStep = 'identity' | 'password' | 'email-otp' | 'phone-otp' | 'two-factor' | 'success';

interface AccountStatus {
  exists: boolean;
  email?: string;
  phone?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  lockedUntil?: string;
  failedAttempts: number;
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  
  // Form state
  const [identity, setIdentity] = useState('');
  const [identityType, setIdentityType] = useState<InputMode>('email');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries.find(c => c.code === 'US') || countries[0]);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [trustedDevice, setTrustedDevice] = useState(false);
  const [otp, setOtp] = useState('');
  
  // UI state
  const [step, setStep] = useState<LoginStep>('identity');
  const [loading, setLoading] = useState(false);
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Account status
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  
  // Resend OTP timer
  const [otpTimer, setOtpTimer] = useState(0);
  
  // Social login dropdown
  const [showSocialDropdown, setShowSocialDropdown] = useState(false);

  // Check account existence
  const checkAccount = useCallback(async (value: string, type: InputMode) => {
    if (!value || value.length < 3) return;
    
    setCheckingAccount(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/check-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: value,
          type: type === 'phone' ? 'phone' : 'email'
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (data.error?.code === 'ACCOUNT_NOT_FOUND') {
          // Redirect to register
          router.push(`/register?emailOrPhone=${encodeURIComponent(value)}`);
          return;
        }
        setError(data.error?.message || 'Failed to check account');
        return;
      }
      
      setAccountStatus(data);
      
      // If account is locked
      if (data.lockedUntil) {
        const lockTime = new Date(data.lockedUntil);
        const now = new Date();
        if (lockTime > now) {
          const minutes = Math.ceil((lockTime.getTime() - now.getTime()) / 60000);
          setError(`Account is locked. Please try again in ${minutes} minutes.`);
          return;
        }
      }
      
      // Move to password step
      setStep('password');
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setCheckingAccount(false);
    }
  }, [router]);

  // Handle identity submission
  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!identity.trim()) {
      setError('Please enter your email or phone number');
      return;
    }
    
    await checkAccount(identity, identityType);
  };

  // Handle password submission
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    
    try {
      const result = await login(identity, password);
      
      if (result.requiresTwoFactor && accountStatus?.twoFactorEnabled) {
        // Need 2FA verification
        if (accountStatus.emailVerified) {
          setStep('email-otp');
          startOtpTimer();
        } else if (accountStatus.phoneVerified) {
          setStep('phone-otp');
          startOtpTimer();
        } else {
          setStep('two-factor');
        }
      } else if (result.success) {
        setStep('success');
        setTimeout(() => {
          router.push('/dashboard');
        }, 1500);
      } else {
        // Check if account is now locked
        const attempts = (accountStatus?.failedAttempts || 0) + 1;
        if (attempts >= 5) {
          setError('Too many failed attempts. Account locked for 48 hours.');
        } else {
          setError(result.error || 'Invalid credentials');
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP verification
  const handleOtpVerify = async (otpCode: string) => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/verify-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          code: otpCode,
          trustedDevice: trustedDevice && rememberMe,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Invalid code');
        return;
      }
      
      // Success - complete login
      if (rememberMe && trustedDevice) {
        localStorage.setItem('tigerex_trusted_device', 'true');
        localStorage.setItem('tigerex_trusted_expires', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
      }
      
      setStep('success');
      setTimeout(() => {
        router.push('/dashboard');
      }, 1500);
    } catch (err) {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle 2FA verification
  const handleTwoFactorVerify = async () => {
    if (otp.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const result = await login(identity, password, otp);
      
      if (result.success) {
        setStep('success');
        setTimeout(() => {
          router.push('/dashboard');
        }, 1500);
      } else {
        setError(result.error || 'Invalid code');
      }
    } catch (err) {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Start OTP resend timer
  const startOtpTimer = () => {
    setOtpTimer(60);
    const interval = setInterval(() => {
      setOtpTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (otpTimer > 0) return;
    
    setLoading(true);
    try {
      await fetch('/api/auth/resend-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrPhone: identity }),
      });
      startOtpTimer();
      setSuccess('Code resent successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  // Social login handlers
  const handleSocialLogin = (provider: string) => {
    window.location.href = `/api/auth/social/${provider}?redirect=/dashboard`;
  };

  // MetaMask login
  const handleMetaMaskLogin = async () => {
    if (typeof window.ethereum === 'undefined') {
      setError('Please install MetaMask to use this feature');
      return;
    }
    
    setLoading(true);
    try {
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      // In production, verify the address with backend
      const response = await fetch('/api/auth/metamask/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: accounts[0] }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.message || 'MetaMask login failed');
        return;
      }
      
      router.push('/dashboard');
    } catch (err) {
      setError('MetaMask login failed');
    } finally {
      setLoading(false);
    }
  };

  // Check for trusted device login
  useEffect(() => {
    const trusted = localStorage.getItem('tigerex_trusted_device');
    const expires = localStorage.getItem('tigerex_trusted_expires');
    
    if (trusted && expires && parseInt(expires) > Date.now()) {
      setTrustedDevice(true);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xl">T</span>
                </div>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">TigerEx</span>
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <Link 
                href="/" 
                className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex items-center justify-center min-h-[calc(100vh-4rem)] py-12 px-4">
        <div className="w-full max-w-md">
          {/* Progress Steps */}
          {step !== 'success' && (
            <div className="mb-8">
              <div className="flex items-center justify-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${step === 'identity' ? 'bg-blue-500' : 'bg-green-500'}`} />
                <div className={`w-8 h-0.5 ${step !== 'identity' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-3 h-3 rounded-full ${step === 'password' ? 'bg-blue-500' : step !== 'identity' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-8 h-0.5 ${['email-otp', 'phone-otp', 'two-factor', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-3 h-3 rounded-full ${['email-otp', 'phone-otp', 'two-factor'].includes(step) ? 'bg-blue-500' : ['email-otp', 'phone-otp', 'two-factor', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Step 1: Identity */}
            {step === 'identity' && (
              <form onSubmit={handleIdentitySubmit}>
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    Welcome Back
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    Enter your email or phone number to continue
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Email or Phone Number
                    </label>
                    <SmartInput
                      value={identity}
                      onChange={(value, type) => {
                        setIdentity(value);
                        setIdentityType(type);
                      }}
                      onCountryChange={setSelectedCountry}
                      selectedCountry={selectedCountry}
                      placeholder="Enter email or phone number"
                      autoFocus
                    />
                    {checkingAccount && (
                      <div className="flex items-center mt-2 text-sm text-blue-500">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Checking account...
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                      <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={checkingAccount || !identity.trim()}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkingAccount ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Continue
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </>
                    )}
                  </button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-300 dark:border-gray-600" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">or continue with</span>
                    </div>
                  </div>

                  {/* Social Login Buttons */}
                  <div className="grid grid-cols-4 gap-3">
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('google')}
                      className="flex items-center justify-center p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Chrome className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSocialLogin('apple')}
                      className="flex items-center justify-center p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Apple className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSocialDropdown(!showSocialDropdown)}
                      className="flex items-center justify-center p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors relative"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleMetaMaskLogin}
                      className="flex items-center justify-center p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Wallet className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Social Dropdown */}
                  {showSocialDropdown && (
                    <div className="absolute mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-10">
                      {['telegram', 'twitter', 'discord', 'facebook'].map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => {
                            handleSocialLogin(provider);
                            setShowSocialDropdown(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 capitalize first:rounded-t-lg last:rounded-b-lg"
                        >
                          {provider}
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                    Don&apos;t have an account?{' '}
                    <Link href="/register" className="text-orange-500 hover:text-orange-600 font-medium">
                      Sign up
                    </Link>
                  </p>
                </div>
              </form>
            )}

            {/* Step 2: Password */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit}>
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    Enter Password
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    {identityType === 'email' ? (
                      <span className="flex items-center justify-center">
                        <Mail className="w-4 h-4 mr-1" />
                        {identity}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center">
                        <Phone className="w-4 h-4 mr-1" />
                        {identity}
                      </span>
                    )}
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Password
                    </label>
                    <PasswordInput
                      value={password}
                      onChange={setPassword}
                      placeholder="Enter your password"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Remember me</span>
                    </label>
                    <Link href="/forgot-password" className="text-sm text-orange-500 hover:text-orange-600">
                      Forgot password?
                    </Link>
                  </div>

                  {trustedDevice && rememberMe && (
                    <div className="flex items-center p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <Smartphone className="w-5 h-5 text-blue-500 mr-2" />
                      <span className="text-sm text-blue-600 dark:text-blue-400">
                        Login without password for 30 days
                      </span>
                      <input
                        type="checkbox"
                        checked={trustedDevice}
                        onChange={() => {}}
                        className="ml-auto w-4 h-4 text-blue-500 border-gray-300 rounded"
                        disabled
                      />
                    </div>
                  )}

                  {error && (
                    <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                      <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                    </div>
                  )}

                  {success && (
                    <div className="flex items-center p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                      <span className="text-sm text-green-600 dark:text-green-400">{success}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !password}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      'Login'
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep('identity')}
                    className="w-full flex items-center justify-center px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: Email OTP */}
            {step === 'email-otp' && (
              <div>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mail className="w-8 h-8 text-blue-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Verify Your Email
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    We sent a 6-digit code to your email
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {identity}
                  </p>
                </div>

                <div className="space-y-6">
                  <OtpInput
                    value={otp}
                    onChange={setOtp}
                    error={error}
                  />

                  <div className="flex items-center justify-between">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                        Trust this device (30 days passwordless login)
                      </span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleTwoFactorVerify}
                    disabled={loading || otp.length !== 6}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      'Verify'
                    )}
                  </button>

                  <div className="text-center">
                    {otpTimer > 0 ? (
                      <p className="text-sm text-gray-500">
                        Resend code in {otpTimer}s
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        className="text-sm text-orange-500 hover:text-orange-600"
                      >
                        Resend code
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (accountStatus?.phoneVerified) {
                        setStep('phone-otp');
                        startOtpTimer();
                      } else {
                        setStep('password');
                      }
                    }}
                    className="w-full flex items-center justify-center px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Try another method
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Phone OTP */}
            {step === 'phone-otp' && (
              <div>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Phone className="w-8 h-8 text-green-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Verify Your Phone
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    We sent a 6-digit code to your phone
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {identity}
                  </p>
                </div>

                <div className="space-y-6">
                  <OtpInput
                    value={otp}
                    onChange={setOtp}
                    error={error}
                  />

                  <div className="flex items-center justify-between">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                        Trust this device (30 days passwordless login)
                      </span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleTwoFactorVerify}
                    disabled={loading || otp.length !== 6}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      'Verify'
                    )}
                  </button>

                  <div className="text-center">
                    {otpTimer > 0 ? (
                      <p className="text-sm text-gray-500">
                        Resend code in {otpTimer}s
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        className="text-sm text-orange-500 hover:text-orange-600"
                      >
                        Resend code
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (accountStatus?.emailVerified) {
                        setStep('email-otp');
                        startOtpTimer();
                      } else {
                        setStep('password');
                      }
                    }}
                    className="w-full flex items-center justify-center px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Try another method
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: 2FA */}
            {step === 'two-factor' && (
              <div>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-8 h-8 text-purple-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Two-Factor Authentication
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    Enter the 6-digit code from your authenticator app
                  </p>
                </div>

                <div className="space-y-6">
                  <OtpInput
                    value={otp}
                    onChange={setOtp}
                    error={error}
                  />

                  <button
                    type="button"
                    onClick={handleTwoFactorVerify}
                    disabled={loading || otp.length !== 6}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      'Verify'
                    )}
                  </button>

                  <div className="text-center">
                    <Link 
                      href="/2fa-reset" 
                      className="text-sm text-orange-500 hover:text-orange-600"
                    >
                      Lost access to 2FA?
                    </Link>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep('password')}
                    className="w-full flex items-center justify-center px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                </div>
              </div>
            )}

            {/* Step 6: Success */}
            {step === 'success' && (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Login Successful!
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Redirecting to your dashboard...
                </p>
                <div className="mt-6 flex justify-center">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
            By logging in, you agree to our{' '}
            <Link href="/terms" className="text-orange-500 hover:text-orange-600">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-orange-500 hover:text-orange-600">Privacy Policy</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
