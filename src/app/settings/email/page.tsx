"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  ArrowRight,
  ArrowLeft,
  Mail,
  Camera,
  Shield,
  KeyRound
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import { ThemeToggle } from '@/components/theme-toggle';

// Steps
type ChangeStep = 'current-email' | 'new-email' | 'verify-current' | 'verify-new' | 'success';

export default function EmailChangePage() {
  const router = useRouter();
  
  // Form state
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [currentOtp, setCurrentOtp] = useState('');
  const [newOtp, setNewOtp] = useState('');
  
  // UI state
  const [step, setStep] = useState<ChangeStep>('current-email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // OTP timer
  const [otpTimer, setOtpTimer] = useState(0);

  // Handle current email submission
  const handleCurrentEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!currentEmail.trim()) {
      setError('Please enter your current email');
      return;
    }
    
    setLoading(true);
    
    try {
      // Send OTP to current email
      await fetch('/api/settings/send-current-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail }),
      });
      
      setStep('verify-current');
      startOtpTimer();
    } catch (err) {
      setError('Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  // Handle verify current email
  const handleVerifyCurrent = async () => {
    if (currentOtp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/settings/verify-current-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, code: currentOtp }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Invalid verification code');
        return;
      }
      
      setStep('new-email');
    } catch (err) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle new email submission
  const handleNewEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!newEmail.trim()) {
      setError('Please enter your new email');
      return;
    }
    
    if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setError('New email must be different from current email');
      return;
    }
    
    setLoading(true);
    
    try {
      // Send OTP to new email
      await fetch('/api/settings/send-new-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      });
      
      setStep('verify-new');
      startOtpTimer();
    } catch (err) {
      setError('Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  // Handle verify new email
  const handleVerifyNew = async () => {
    if (newOtp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/settings/verify-new-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, code: newOtp }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Invalid verification code');
        return;
      }
      
      await completeEmailChange();
    } catch (err) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // Complete email change
  const completeEmailChange = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          currentEmail,
          newEmail,
        }),
      });
      
      if (response.ok) {
        setStep('success');
      } else {
        setError('Failed to change email');
      }
    } catch (err) {
      setError('An error occurred');
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

  // Resend OTP
  const handleResendOtp = async (type: 'current' | 'new') => {
    if (otpTimer > 0) return;
    
    setLoading(true);
    try {
      await fetch(type === 'current' ? '/api/settings/send-current-email-otp' : '/api/settings/send-new-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: type === 'current' ? currentEmail : newEmail }),
      });
      startOtpTimer();
      setSuccess('Code resent');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
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
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto py-12 px-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          {/* Step 1: Current Email */}
          {step === 'current-email' && (
            <form onSubmit={handleCurrentEmailSubmit}>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-8 h-8 text-blue-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Change Email Address
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  First, verify your current email address
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Current Email Address
                  </label>
                  <input
                    type="email"
                    value={currentEmail}
                    onChange={(e) => setCurrentEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="Enter your current email"
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
                  disabled={loading || !currentEmail.trim()}
                  className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
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

                <Link href="/settings" className="block text-center text-gray-500 hover:text-gray-600">
                  <ArrowLeft className="w-4 h-4 inline mr-1" />
                  Back to Settings
                </Link>
              </div>
            </form>
          )}

          {/* Step 2: Verify Current Email */}
          {step === 'verify-current' && (
            <div>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Verify Current Email
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Enter the code sent to {currentEmail}
                </p>
              </div>

              <div className="space-y-6">
                <OtpInput value={currentOtp} onChange={setCurrentOtp} error={error} />

                {error && (
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleVerifyCurrent}
                  disabled={loading || currentOtp.length !== 6}
                  className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify'}
                </button>

                <div className="text-center">
                  {otpTimer > 0 ? (
                    <p className="text-sm text-gray-500">Resend in {otpTimer}s</p>
                  ) : (
                    <button type="button" onClick={() => handleResendOtp('current')} className="text-sm text-orange-500">
                      Resend code
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: New Email */}
          {step === 'new-email' && (
            <form onSubmit={handleNewEmailSubmit}>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Enter New Email
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Enter your new email address
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    New Email Address
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="Enter your new email"
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
                  disabled={loading || !newEmail.trim()}
                  className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
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
              </div>
            </form>
          )}

          {/* Step 4: Verify New Email */}
          {step === 'verify-new' && (
            <div>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Verify New Email
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Enter the code sent to {newEmail}
                </p>
              </div>

              <div className="space-y-6">
                <OtpInput value={newOtp} onChange={setNewOtp} error={error} />

                {error && (
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleVerifyNew}
                  disabled={loading || newOtp.length !== 6}
                  className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify'}
                </button>

                <div className="text-center">
                  {otpTimer > 0 ? (
                    <p className="text-sm text-gray-500">Resend in {otpTimer}s</p>
                  ) : (
                    <button type="button" onClick={() => handleResendOtp('new')} className="text-sm text-orange-500">
                      Resend code
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Liveness Verification */}
          {/* Step 6: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Email Changed Successfully!
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Your email has been updated to {newEmail}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Withdrawal will be disabled for 48 hours
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center mt-6 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg"
              >
                Go to Dashboard
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
