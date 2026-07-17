"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
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
  Camera,
  Trash2,
  AlertTriangle,
  UserX
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import { ThemeToggle } from '@/components/theme-toggle';

// Steps
type DeleteStep = 'identity' | 'verify' | 'liveness' | 'confirm' | 'success';

const livenessInstructions = [
  { id: 1, text: "Look straight at the camera", icon: "👀" },
  { id: 2, text: "Blink your eyes slowly", icon: "👁️" },
  { id: 3, text: "Smile briefly", icon: "😊" },
];

export default function AccountDeletionPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Form state
  const [identity, setIdentity] = useState('');
  const [identityType, setIdentityType] = useState<InputMode>('email');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries.find(c => c.code === 'US') || countries[0]);
  const [otp, setOtp] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [withdrawAssets, setWithdrawAssets] = useState(false);
  
  // UI state
  const [step, setStep] = useState<DeleteStep>('identity');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Liveness state
  const [livenessStep, setLivenessStep] = useState(0);
  const [livenessProgress, setLivenessProgress] = useState(0);
  const [isLivenessComplete, setIsLivenessComplete] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  
  // OTP timer
  const [otpTimer, setOtpTimer] = useState(0);

  // Handle identity submission
  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!identity.trim()) {
      setError('Please enter your email or phone number');
      return;
    }
    
    setLoading(true);
    
    try {
      // Send OTP
      await fetch('/api/settings/send-deletion-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          type: identityType === 'phone' ? 'phone' : 'email'
        }),
      });
      
      setStep('verify');
      startOtpTimer();
    } catch (err) {
      setError('Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP verification
  const handleVerify = async () => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/settings/verify-deletion-otp', {
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
      
      // Start liveness verification
      startLivenessVerification();
    } catch (err) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // Start liveness verification
  const startLivenessVerification = async () => {
    setStep('liveness');
    setLivenessStep(0);
    setLivenessProgress(0);
    setIsLivenessComplete(false);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      setCameraStream(stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setError('Please allow camera access for identity verification');
    }
  };

  // Handle liveness capture
  const handleLivenessCapture = useCallback(() => {
    if (isVerifying) return;
    
    setIsVerifying(true);
    
    setTimeout(() => {
      const nextStep = livenessStep + 1;
      const progress = (nextStep / livenessInstructions.length) * 100;
      
      setLivenessStep(nextStep);
      setLivenessProgress(progress);
      
      if (nextStep >= livenessInstructions.length) {
        setIsLivenessComplete(true);
        
        if (cameraStream) {
          cameraStream.getTracks().forEach(track => track.stop());
        }
        
        // Proceed to confirmation
        setStep('confirm');
      } else {
        setIsVerifying(false);
      }
    }, 2000);
  }, [livenessStep, cameraStream, isVerifying]);

  // Handle final confirmation
  const handleConfirmDeletion = async () => {
    if (confirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }
    
    if (!withdrawAssets) {
      setError('Please confirm that you have withdrawn all assets');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await fetch('/api/settings/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrPhone: identity }),
      });
      
      if (response.ok) {
        setStep('success');
        // Logout user
        localStorage.removeItem('tigerex_access_token');
        localStorage.removeItem('tigerex_refresh_token');
      } else {
        setError('Failed to delete account');
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
  const handleResendOtp = async () => {
    if (otpTimer > 0) return;
    
    setLoading(true);
    try {
      await fetch('/api/settings/send-deletion-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          type: identityType === 'phone' ? 'phone' : 'email'
        }),
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

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
          {/* Warning Banner */}
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">Warning: Irreversible Action</p>
                <p className="text-sm text-red-500 dark:text-red-400">
                  Account deletion cannot be undone. Please withdraw all assets before proceeding.
                </p>
              </div>
            </div>
          </div>

          {/* Step 1: Identity */}
          {step === 'identity' && (
            <form onSubmit={handleIdentitySubmit}>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <UserX className="w-8 h-8 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Delete Account
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Enter your email or phone to verify ownership
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
                    placeholder="Enter your email or phone"
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
                  className="w-full flex items-center justify-center px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all disabled:opacity-50"
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

                <Link href="/dashboard" className="block text-center text-gray-500 hover:text-gray-600">
                  <ArrowLeft className="w-4 h-4 inline mr-1" />
                  Cancel
                </Link>
              </div>
            </form>
          )}

          {/* Step 2: Verify */}
          {step === 'verify' && (
            <div>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Verify Your Identity
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Enter the code sent to {identity}
                </p>
              </div>

              <div className="space-y-6">
                <OtpInput value={otp} onChange={setOtp} error={error} />

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
                  type="button"
                  onClick={handleVerify}
                  disabled={loading || otp.length !== 6}
                  className="w-full flex items-center justify-center px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify'}
                </button>

                <div className="text-center">
                  {otpTimer > 0 ? (
                    <p className="text-sm text-gray-500">Resend in {otpTimer}s</p>
                  ) : (
                    <button type="button" onClick={handleResendOtp} className="text-sm text-orange-500">
                      Resend code
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Liveness */}
          {step === 'liveness' && (
            <div>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Camera className="w-8 h-8 text-purple-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Face Verification
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Verify it's really you requesting deletion
                </p>
              </div>

              <div className="space-y-6">
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                    <span>Progress</span>
                    <span>{Math.round(livenessProgress)}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
                      style={{ width: `${livenessProgress}%` }}
                    />
                  </div>
                </div>

                <div className="relative rounded-lg overflow-hidden bg-gray-900 aspect-video">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  
                  {livenessStep < livenessInstructions.length && !isLivenessComplete && (
                    <div className="absolute bottom-4 left-4 right-4 bg-black/70 rounded-lg p-4 text-white">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{livenessInstructions[livenessStep].icon}</span>
                        <div>
                          <p className="font-medium">{livenessInstructions[livenessStep].text}</p>
                          <p className="text-sm text-gray-300">{livenessStep + 1} of {livenessInstructions.length}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {!isLivenessComplete && (
                  <button
                    type="button"
                    onClick={handleLivenessCapture}
                    disabled={isVerifying}
                    className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-50"
                  >
                    {isVerifying ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Camera className="w-5 h-5 mr-2" />}
                    {isVerifying ? 'Verifying...' : 'Capture'}
                  </button>
                )}

                {error && (
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 'confirm' && (
            <div>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-8 h-8 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Confirm Deletion
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  This action cannot be undone
                </p>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">
                    <strong>Important:</strong> Your account will be marked for deletion. 
                    You have 30 days to log in and cancel this request. 
                    After 30 days, all your data will be permanently deleted.
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="withdrawAssets"
                    checked={withdrawAssets}
                    onChange={(e) => setWithdrawAssets(e.target.checked)}
                    className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-500"
                  />
                  <label htmlFor="withdrawAssets" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                    I confirm that I have withdrawn all my assets
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Type <span className="font-mono font-bold">DELETE</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="Type DELETE"
                  />
                </div>

                {error && (
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleConfirmDeletion}
                  disabled={loading || confirmText !== 'DELETE' || !withdrawAssets}
                  className="w-full flex items-center justify-center px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5 mr-2" />
                      Delete My Account
                    </>
                  )}
                </button>

                <Link href="/dashboard" className="block text-center text-gray-500 hover:text-gray-600">
                  <ArrowLeft className="w-4 h-4 inline mr-1" />
                  Cancel and go back
                </Link>
              </div>
            </div>
          )}

          {/* Step 5: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Account Deletion Requested!
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Your account has been marked for deletion.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                You have 30 days to log in and cancel this request.
              </p>
              <div className="mt-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Logging you out automatically...
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
