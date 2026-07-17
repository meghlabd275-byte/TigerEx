"use client";

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  ArrowRight,
  ArrowLeft,
  Mail,
  Phone,
  KeyRound
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import PasswordInput from '@/components/auth/PasswordInput';
import { ThemeToggle } from '@/components/theme-toggle';

// Steps
type ResetStep = 'identity' | 'otp' | 'reset' | 'success';

export default function ForgotPasswordPage() {
  const router = useRouter();
  
  // Form state
  const [identity, setIdentity] = useState('');
  const [identityType, setIdentityType] = useState<InputMode>('email');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries.find(c => c.code === 'US') || countries[0]);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // UI state
  const [step, setStep] = useState<ResetStep>('identity');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Account info
  const [accountVerified, setAccountVerified] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  
  // OTP timer
  const [otpTimer, setOtpTimer] = useState(0);

  // Check account existence
  const checkAccount = useCallback(async (value: string, type: InputMode) => {
    if (!value || value.length < 3) return;
    
    setLoading(true);
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
      
      // Account found
      setAccountVerified(true);
      setTwoFactorEnabled(data.twoFactorEnabled || false);
      
      // Send OTP
      const otpResponse = await fetch('/api/auth/send-password-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: value,
          type: type === 'phone' ? 'phone' : 'email'
        }),
      });
      
      if (otpResponse.ok) {
        setStep('otp');
        startOtpTimer();
      } else {
        setError('Failed to send verification code');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
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
      const response = await fetch('/api/auth/verify-password-reset-otp', {
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
      
      // If 2FA enabled, require 2FA verification
      if (twoFactorEnabled) {
        // For now, proceed to reset step (in production, require 2FA)
        setStep('reset');
      } else {
        setStep('reset');
      }
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
      await fetch('/api/auth/send-password-reset-otp', {
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

  // Handle password reset
  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Validation
    if (!newPassword) {
      setError('Please enter a new password');
      return;
    }
    
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          code: otp,
          newPassword,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Password reset failed');
        return;
      }
      
      setStep('success');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err) {
      setError('Password reset failed. Please try again.');
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
                <div className={`w-8 h-0.5 ${['otp', 'reset', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-3 h-3 rounded-full ${step === 'otp' ? 'bg-blue-500' : ['otp', 'reset', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-8 h-0.5 ${['reset', 'success'].includes(step) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className={`w-3 h-3 rounded-full ${step === 'reset' ? 'bg-blue-500' : step === 'success' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Step 1: Identity */}
            {step === 'identity' && (
              <form onSubmit={handleIdentitySubmit}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <KeyRound className="w-8 h-8 text-orange-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Reset Password
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    Enter your email or phone number to verify your identity
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
                      placeholder="Enter your email or phone number"
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                      <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !identity.trim()}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Continue
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </>
                    )}
                  </button>

                  <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                    Remember your password?{' '}
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

            {/* Step 3: Reset Password */}
            {step === 'reset' && (
              <form onSubmit={handlePasswordReset}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <KeyRound className="w-8 h-8 text-green-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Set New Password
                  </h1>
                  <p className="text-gray-600 dark:text-gray-400">
                    Create a strong password for your account
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      New Password
                    </label>
                    <PasswordInput
                      value={newPassword}
                      onChange={setNewPassword}
                      placeholder="Create a new password"
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
                      placeholder="Confirm your new password"
                    />
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="mt-1 text-sm text-red-500">Passwords do not match</p>
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
                    disabled={loading || !newPassword || !confirmPassword}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      'Reset Password'
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
                  Password Reset Successful!
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Redirecting to login...
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
