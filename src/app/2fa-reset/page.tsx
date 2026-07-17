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
  Shield,
  Camera,
  User,
  RefreshCw
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import { ThemeToggle } from '@/components/theme-toggle';

// Steps
type ResetStep = 'identity' | 'email-otp' | 'phone-otp' | 'liveness' | 'success';

interface LivenessInstruction {
  id: number;
  text: string;
  icon: string;
}

const livenessInstructions: LivenessInstruction[] = [
  { id: 1, text: "Look straight at the camera", icon: "👀" },
  { id: 2, text: "Turn your face slightly left", icon: "↩️" },
  { id: 3, text: "Turn your face slightly right", icon: "↪️" },
  { id: 4, text: "Smile briefly", icon: "😊" },
  { id: 5, text: "Blink your eyes slowly", icon: "👁️" },
];

export default function TwoFactorResetPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Form state
  const [identity, setIdentity] = useState('');
  const [identityType, setIdentityType] = useState<InputMode>('email');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries.find(c => c.code === 'US') || countries[0]);
  const [otp, setOtp] = useState('');
  
  // UI state
  const [step, setStep] = useState<ResetStep>('identity');
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
      
      if (!response.ok || !data.exists) {
        router.push(`/register?emailOrPhone=${encodeURIComponent(value)}`);
        return;
      }
      
      // Send OTPs
      await fetch('/api/auth/send-2fa-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: value,
        }),
      });
      
      setStep('email-otp');
      startOtpTimer();
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
  const handleOtpSubmit = async (currentStep: ResetStep) => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/verify-2fa-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          code: otp,
          type: currentStep === 'email-otp' ? 'email' : 'phone',
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error?.message || 'Invalid verification code');
        return;
      }
      
      // Move to next step
      if (currentStep === 'email-otp') {
        setStep('phone-otp');
        setOtp('');
        startOtpTimer();
      } else if (currentStep === 'phone-otp') {
        // Start liveness verification
        startLivenessVerification();
      }
    } catch (err) {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (otpTimer > 0) return;
    
    setLoading(true);
    try {
      await fetch('/api/auth/send-2fa-reset-otp', {
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

  // Simulate liveness check
  const handleLivenessCapture = useCallback(() => {
    if (isVerifying) return;
    
    setIsVerifying(true);
    
    // Simulate processing time
    setTimeout(() => {
      const nextStep = livenessStep + 1;
      const progress = (nextStep / livenessInstructions.length) * 100;
      
      setLivenessStep(nextStep);
      setLivenessProgress(progress);
      
      if (nextStep >= livenessInstructions.length) {
        // Liveness complete
        setIsLivenessComplete(true);
        
        // Stop camera
        if (cameraStream) {
          cameraStream.getTracks().forEach(track => track.stop());
        }
        
        // Proceed to 2FA reset
        complete2FAReset();
      } else {
        setIsVerifying(false);
      }
    }, 2000);
  }, [livenessStep, cameraStream, isVerifying]);

  // Complete 2FA reset
  const complete2FAReset = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
        }),
      });
      
      if (response.ok) {
        setStep('success');
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      } else {
        setError('Failed to reset 2FA');
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

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

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
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            {/* Step 1: Identity */}
            {step === 'identity' && (
              <form onSubmit={handleIdentitySubmit}>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-8 h-8 text-purple-500" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    Reset 2FA
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
                </div>
              </form>
            )}

            {/* Step 2: Email OTP */}
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
                    type="button"
                    onClick={() => handleOtpSubmit('email-otp')}
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
                      <p className="text-sm text-gray-500">Resend code in {otpTimer}s</p>
                    ) : (
                      <button type="button" onClick={handleResendOtp} className="text-sm text-orange-500 hover:text-orange-600">
                        Resend code
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Phone OTP */}
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

                  <button
                    type="button"
                    onClick={() => handleOtpSubmit('phone-otp')}
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
                      <p className="text-sm text-gray-500">Resend code in {otpTimer}s</p>
                    ) : (
                      <button type="button" onClick={handleResendOtp} className="text-sm text-orange-500 hover:text-orange-600">
                        Resend code
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Liveness Verification */}
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
                    Follow the instructions below for identity verification
                  </p>
                </div>

                <div className="space-y-6">
                  {/* Progress */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                      <span>Verification Progress</span>
                      <span>{Math.round(livenessProgress)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-500"
                        style={{ width: `${livenessProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Camera */}
                  <div className="relative rounded-lg overflow-hidden bg-gray-900 aspect-video">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    
                    {/* Instructions overlay */}
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
                    
                    {isLivenessComplete && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="text-white text-center">
                          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-2" />
                          <p className="font-medium">Verification Complete!</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Capture button */}
                  {!isLivenessComplete && (
                    <button
                      type="button"
                      onClick={handleLivenessCapture}
                      disabled={isVerifying}
                      className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
                    >
                      {isVerifying ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin mr-2" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <Camera className="w-5 h-5 mr-2" />
                          Capture
                        </>
                      )}
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

            {/* Step 5: Success */}
            {step === 'success' && (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  2FA Reset Complete!
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
