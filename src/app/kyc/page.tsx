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
  Upload,
  Camera,
  User,
  FileText,
  Shield,
  Check
} from 'lucide-react';
import SmartInput, { InputMode, Country, countries } from '@/components/auth/SmartInput';
import OtpInput from '@/components/auth/OtpInput';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/components/auth/AuthContext';

// Steps
type KycStep = 'identity' | 'personal' | 'documents' | 'liveness' | 'review' | 'success';

// Document types
type DocType = 'passport' | 'national_id' | 'drivers_license';

interface PersonalInfo {
  firstName: string;
  lastName: string;
  title: string;
  dateOfBirth: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const countries_list = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SG', name: 'Singapore' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
];

const livenessInstructions = [
  { id: 1, text: "Look straight at the camera", icon: "👀" },
  { id: 2, text: "Turn your face slightly left", icon: "↩️" },
  { id: 3, text: "Turn your face slightly right", icon: "↪️" },
  { id: 4, text: "Smile briefly", icon: "😊" },
];

export default function KycPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form state
  const [identity, setIdentity] = useState('');
  const [identityType, setIdentityType] = useState<InputMode>('email');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries.find(c => c.code === 'US') || countries[0]);
  const [otp, setOtp] = useState('');
  
  // Personal info
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>({
    firstName: '',
    lastName: '',
    title: '',
    dateOfBirth: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  });
  
  // Documents
  const [docType, setDocType] = useState<DocType>('passport');
  const [frontDoc, setFrontDoc] = useState<File | null>(null);
  const [backDoc, setBackDoc] = useState<File | null>(null);
  const [selfieDoc, setSelfieDoc] = useState<File | null>(null);
  
  // UI state
  const [step, setStep] = useState<KycStep>('identity');
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
      await fetch('/api/kyc/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          emailOrPhone: identity,
          type: identityType === 'phone' ? 'phone' : 'email'
        }),
      });
      
      setStep('personal');
      startOtpTimer();
    } catch (err) {
      setError('Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP verification for identity
  const handleIdentityVerify = async () => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/kyc/verify-identity-otp', {
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
      
      setStep('documents');
    } catch (err) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle document upload
  const handleFileUpload = (type: 'front' | 'back' | 'selfie') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }
    
    if (type === 'front') setFrontDoc(file);
    if (type === 'back') setBackDoc(file);
    if (type === 'selfie') setSelfieDoc(file);
    
    setError('');
  };

  // Handle documents submission
  const handleDocumentsSubmit = () => {
    if (!frontDoc) {
      setError('Please upload front of your document');
      return;
    }
    if (!selfieDoc) {
      setError('Please upload a selfie with your document');
      return;
    }
    
    // Start liveness verification
    startLivenessVerification();
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
        
        // Submit for review
        submitKyc();
      } else {
        setIsVerifying(false);
      }
    }, 2000);
  }, [livenessStep, cameraStream, isVerifying]);

  // Submit KYC
  const submitKyc = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('personalInfo', JSON.stringify(personalInfo));
      formData.append('documentType', docType);
      if (frontDoc) formData.append('frontDocument', frontDoc);
      if (backDoc) formData.append('backDocument', backDoc);
      if (selfieDoc) formData.append('selfieDocument', selfieDoc);
      
      const response = await fetch('/api/kyc/submit', {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        setStep('success');
      } else {
        setError('Failed to submit KYC. Please try again.');
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
      await fetch('/api/kyc/send-verification-otp', {
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
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto py-12 px-4">
        {/* Progress Steps */}
        {step !== 'success' && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {['identity', 'personal', 'documents', 'liveness'].map((s, i) => (
                <div key={s} className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                    ${['identity', 'personal', 'documents', 'liveness'].indexOf(step) >= i 
                      ? 'bg-orange-500 text-white' 
                      : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < 3 && (
                    <div className={`w-16 sm:w-24 h-1 mx-2 
                      ${['identity', 'personal', 'documents', 'liveness'].indexOf(step) > i 
                        ? 'bg-orange-500' 
                        : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>Verify</span>
              <span>Personal</span>
              <span>Documents</span>
              <span>Liveness</span>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          {/* Step 1: Identity Verification */}
          {step === 'identity' && (
            <form onSubmit={handleIdentitySubmit}>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-blue-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  KYC Verification
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  First, verify your email or phone number
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

          {/* Step 1b: OTP for Identity */}
          {step === 'personal' && (
            <div>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  {identityType === 'email' ? (
                    <Mail className="w-8 h-8 text-green-500" />
                  ) : (
                    <Phone className="w-8 h-8 text-green-500" />
                  )}
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Verify Your {identityType === 'email' ? 'Email' : 'Phone'}
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
                  onClick={handleIdentityVerify}
                  disabled={loading || otp.length !== 6}
                  className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    'Verify'
                  )}
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

          {/* Step 2: Personal Info */}
          {step === 'documents' && (
            <div>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <User className="w-8 h-8 text-purple-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Personal Information
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Please fill in your personal details
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
                    <select
                      value={personalInfo.title}
                      onChange={(e) => setPersonalInfo({ ...personalInfo, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      <option value="">Select</option>
                      <option value="Mr">Mr</option>
                      <option value="Mrs">Mrs</option>
                      <option value="Ms">Ms</option>
                      <option value="Dr">Dr</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
                    <input
                      type="text"
                      value={personalInfo.firstName}
                      onChange={(e) => setPersonalInfo({ ...personalInfo, firstName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      placeholder="First name"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={personalInfo.lastName}
                    onChange={(e) => setPersonalInfo({ ...personalInfo, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="Last name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={personalInfo.dateOfBirth}
                    onChange={(e) => setPersonalInfo({ ...personalInfo, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                  <input
                    type="text"
                    value={personalInfo.address}
                    onChange={(e) => setPersonalInfo({ ...personalInfo, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="Street address"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
                    <input
                      type="text"
                      value={personalInfo.city}
                      onChange={(e) => setPersonalInfo({ ...personalInfo, city: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State/Province</label>
                    <input
                      type="text"
                      value={personalInfo.state}
                      onChange={(e) => setPersonalInfo({ ...personalInfo, state: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Postal Code</label>
                    <input
                      type="text"
                      value={personalInfo.postalCode}
                      onChange={(e) => setPersonalInfo({ ...personalInfo, postalCode: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Country</label>
                    <select
                      value={personalInfo.country}
                      onChange={(e) => setPersonalInfo({ ...personalInfo, country: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      <option value="">Select</option>
                      {countries_list.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleDocumentsSubmit}
                  disabled={loading || !personalInfo.firstName || !personalInfo.lastName || !personalInfo.country}
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
            </div>
          )}

          {/* Step 3: Documents */}
          {step === 'liveness' && (
            <div>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Camera className="w-8 h-8 text-purple-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Document Upload & Liveness
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Upload your documents and complete face verification
                </p>
              </div>

              <div className="space-y-6">
                {/* Document Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Document Type</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['passport', 'national_id', 'drivers_license'] as DocType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setDocType(type)}
                        className={`p-3 border rounded-lg text-sm font-medium transition-all
                          ${docType === type 
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-500' 
                            : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                          }`}
                      >
                        {type === 'passport' && '📘 Passport'}
                        {type === 'national_id' && '🪪 National ID'}
                        {type === 'drivers_license' && '🚗 Driver License'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Front Document */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Front of Document</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-orange-500 transition-colors"
                  >
                    {frontDoc ? (
                      <div className="flex items-center justify-center text-green-500">
                        <CheckCircle className="w-6 h-6 mr-2" />
                        {frontDoc.name}
                      </div>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400">
                        <Upload className="w-8 h-8 mx-auto mb-2" />
                        <p>Click to upload</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload('front')}
                    className="hidden"
                  />
                </div>

                {/* Selfie with Document */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Selfie with Document</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-orange-500 transition-colors"
                  >
                    {selfieDoc ? (
                      <div className="flex items-center justify-center text-green-500">
                        <CheckCircle className="w-6 h-6 mr-2" />
                        {selfieDoc.name}
                      </div>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400">
                        <Camera className="w-8 h-8 mx-auto mb-2" />
                        <p>Upload selfie with document</p>
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload('selfie')}
                    className="hidden"
                  />
                </div>

                {/* Liveness Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Face Verification</h3>
                  
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
                  <div className="relative rounded-lg overflow-hidden bg-gray-900 aspect-video mb-4">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    
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
                </div>

                {error && (
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                KYC Submitted Successfully!
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Your documents have been submitted for review. This typically takes 1-3 business days.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                You will receive an email notification once your verification is complete.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center mt-6 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all"
              >
                Go to Dashboard
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
