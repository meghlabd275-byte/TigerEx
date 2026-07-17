"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  ArrowRight,
  Mail,
  Phone,
  Chrome,
  Apple,
  Send,
  ArrowLeft,
  Wallet,
  User,
  FileText
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import PasswordInput from '@/components/auth/PasswordInput, { PasswordStrength } from '@/components/auth/PasswordInput';
import { ThemeToggle } from '@/components/theme-toggle';

// Register steps
type RegisterStep = 'identity' | 'otp' | 'password' | 'success';

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Form state
  const [identity, setIdentity] = useState(searchParams.get('emailOrPhone') || '');
  const [identityType, setIdentityType] = useState<InputMode>('email');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries.find(c => c.code === 'US') || countries[0]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [otp, setOtp] = useState('');
  
  // UI state
  const [step, setStep] = useState<RegisterStep>('identity');
  const [loading, setLoading] = useState(false);
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Password strength
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength>('weak');
  
  // OTP timer
  const [otpTimer, setOtpTimer] = useState(0);
  
  // Social login dropdown
  const [showSocialDropdown, setShowSocialDropdown] = useState(false);

  // Check if account already exists
  const checkAccountExists = useCallback(async (value: string, type: InputMode) => {
    if (!value || value.length < 3) return false;
    
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
      
      if (response.ok && data.exists) {
        // Account exists - redirect to login
        router.push(`/login?emailOrPhone=${encodeURIComponent(value)}`);
        return true;
      }
      
      return false;
    } catch (err) {
      return false;
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
    
    setCheckingAccount(true);
    
    // Check if account already exists
    const exists = await checkAccountExists(identity, identityType);
    if (exists) {
      setCheckingAccount(false);
      return;
    }
    
    setCheckingAccount(false);
    
    // Send OTP
    setLoading(true);
    try {
      const response = await fetch('/api/auth/send-register-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          type: identityType === 'phone' ? 'phone' : 'email'
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Failed to send verification code');
        return;
      }
      
      setStep('otp');
      startOtpTimer();
      setSuccess('Verification code sent!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP verification
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/verify-register-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          code: otp,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Invalid verification code');
        return;
      }
      
      setStep('password');
    } catch (err) {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle resend OTP
  const handleResendOtp = async () => {
    if (otpTimer > 0) return;
    
    setLoading(true);
    try {
      await fetch('/api/auth/send-register-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          type: identityType === 'phone' ? 'phone' : 'email'
        }),
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

  // Handle password submission
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Validation
    if (!password) {
      setError('Please enter a password');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (!agreeToTerms) {
      setError('You must agree to the Terms of Service');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          password,
          referralCode: referralCode || undefined,
          agreeToTerms,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Registration failed');
        return;
      }
      
      setStep('success');
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (err) {
      setError('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Start OTP timer
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
      
      const response = await fetch('/api/auth/metamask/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: accounts[0] }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        setError(data.error?.message || 'MetaMask registration failed');
        return;
      }
      
      router.push('/dashboard');
    } catch (err) {
      setError('MetaMask registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Check password strength
  useEffect(() => {
    const checkStrength = () => {
      let score = 0;
      if (password.length >= 8) score++;
      if (/[A-Z]/.test(password)) score++;
      if (/[a-z]/.test(password)) score++;
      if (/[0-9]/.test(password)) score++;
      if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;
      
      if (score <= 2) return 'weak';
      if (score <= 4) return 'medium';
      return 'strong';
    };
    
    setPasswordStrength(checkStrength());
  }, [password]);

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
                <div className={`w-8 h-0.5 ${['otp', 'password', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-3 h-3 rounded-full ${step === 'otp' ? 'bg-blue-500' : ['otp', 'password', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-8 h-0.5 ${['password', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-3 h-3 rounded-full ${step === 'password' ? 'bg-blue-500' : step === 'success' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Step 1: Identity */}
            {step === 'identity' && (
              <form onSubmit={handleIdentitySubmit}>
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    Create Account
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    Enter your email or phone number to get started
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
                    Already have an account?{' '}
                    <Link href="/login" className="text-orange-500 hover:text-orange-600 font-medium">
                      Sign in
                    </Link>
                  </p>
                </div>
              </form>
            )}

            {/* Step 2: OTP Verification */}
            {step === 'otp' && (
              <form onSubmit={handleOtpSubmit}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    {identityType === 'email' ? (
                      <Mail className="w-8 h-8 text-blue-500" />
                    ) : (
                      <Phone className="w-8 h-8 text-blue-500" />
                    )}
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Verify Your {identityType === 'email' ? 'Email' : 'Phone'}
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    We sent a 6-digit code to
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">
                    {identity}
                  </p>
                </div>

                <div className="space-y-6">
                  <OtpInput
                    value={otp}
                    onChange={setOtp}
                    error={error}
                  />

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
                    onClick={() => setStep('identity')}
                    className="w-full flex items-center justify-center px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: Password */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Set Your Password
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    Create a strong password to secure your account
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
                      placeholder="Create a password"
                      showStrength
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Confirm Password
                    </label>
                    <PasswordInput
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      placeholder="Confirm your password"
                    />
                    {confirmPassword && password !== confirmPassword && (
                      <p className="mt-1 text-sm text-red-500">Passwords do not match</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Referral Code <span className="text-gray-400">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                      placeholder="Enter referral code"
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex items-start">
                    <input
                      type="checkbox"
                      checked={agreeToTerms}
                      onChange={(e) => setAgreeToTerms(e.target.checked)}
                      className="w-4 h-4 mt-1 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
                    />
                    <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
                      I agree to the{' '}
                      <Link href="/terms" className="text-orange-500 hover:text-orange-600">Terms of Service</Link>
                      {' '}and{' '}
                      <Link href="/privacy" className="text-orange-500 hover:text-orange-600">Privacy Policy</Link>
                    </span>
                  </div>

                  {error && (
                    <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                      <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !password || !agreeToTerms}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Create Account
                        <CheckCircle className="w-5 h-5 ml-2" />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep('otp')}
                    className="w-full flex items-center justify-center px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                </div>
              </form>
            )}

            {/* Step 4: Success */}
            {step === 'success' && (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Account Created!
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Welcome to TigerEx! Redirecting to your dashboard...
                </p>
                <div className="mt-6 flex justify-center">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
