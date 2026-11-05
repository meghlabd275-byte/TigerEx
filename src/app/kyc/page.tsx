"use client";

import { useState, useRef, useEffect } from 'react';
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
import { apiRequest, ApiError } from '@/lib/api/client-request';

// Steps
type KycStep = 'identity' | 'personal' | 'documents' | 'upload' | 'success';

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

/** Read a selected file as base64, without the data-URL prefix. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(new Error('The file could not be read'));
    reader.readAsDataURL(file);
  });
}

export default function KycPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
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
      await apiRequest('/api/kyc/send-verification-otp', {
        method: 'POST',
        body: { type: identityType === 'phone' ? 'phone' : 'email' },
      });
      setStep('personal');
      startOtpTimer();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send verification code');
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
    
    setStep('upload');
  };

  // Submit KYC
  const submitKyc = async () => {
    if (!frontDoc || !selfieDoc) {
      setError('Upload the front of your document and a selfie holding it.');
      return;
    }
    if (docType !== 'passport' && !backDoc) {
      setError('Upload the back of your document.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const selected: Array<[string, File]> = [['front', frontDoc]];
      if (backDoc) selected.push(['back', backDoc]);
      selected.push(['selfie', selfieDoc]);

      const documents = await Promise.all(
        selected.map(async ([kind, file]) => ({
          kind,
          contentType: file.type || 'image/jpeg',
          data: await fileToBase64(file),
        })),
      );

      await apiRequest('/api/kyc/submit', {
        method: 'POST',
        body: { personalInfo, documentType: docType, documents },
      });
      setStep('success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An error occurred');
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
              {['identity', 'personal', 'documents', 'upload'].map((s, i) => (
                <div key={s} className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                    ${['identity', 'personal', 'documents', 'upload'].indexOf(step) >= i 
                      ? 'bg-orange-500 text-white' 
                      : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < 3 && (
                    <div className={`w-16 sm:w-24 h-1 mx-2 
                      ${['identity', 'personal', 'documents', 'upload'].indexOf(step) > i 
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
              <span>Upload</span>
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

          {/* Step 3: Document Upload */}
          {step === 'upload' && (
            <div>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-purple-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Document Upload
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Upload a clear photo of your identity document
                </p>
              </div>

              <div className="space-y-6">
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Front of Document</label>
                  <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                    {frontDoc ? (
                      <div className="flex items-center justify-center text-green-500">
                        <CheckCircle className="w-6 h-6 mr-2" />
                        {frontDoc.name}
                      </div>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400">
                        <Upload className="w-8 h-8 mx-auto mb-2" />
                        <p>JPEG, PNG, WebP or PDF up to 10 MB</p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload('front')}
                      className="mt-3 text-sm"
                    />
                  </div>
                </div>

                {docType !== 'passport' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Back of Document</label>
                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                      {backDoc ? (
                        <div className="flex items-center justify-center text-green-500">
                          <CheckCircle className="w-6 h-6 mr-2" />
                          {backDoc.name}
                        </div>
                      ) : (
                        <div className="text-gray-500 dark:text-gray-400">
                          <Upload className="w-8 h-8 mx-auto mb-2" />
                          <p>Upload the back of your document</p>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleFileUpload('back')}
                        className="mt-3 text-sm"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Selfie Holding the Document</label>
                  <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                    {selfieDoc ? (
                      <div className="flex items-center justify-center text-green-500">
                        <CheckCircle className="w-6 h-6 mr-2" />
                        {selfieDoc.name}
                      </div>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400">
                        <Camera className="w-8 h-8 mx-auto mb-2" />
                        <p>Upload a selfie holding your document</p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload('selfie')}
                      className="mt-3 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={submitKyc}
                  disabled={loading || !frontDoc || !selfieDoc || (docType !== 'passport' && !backDoc)}
                  className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition-all disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Submit for review<ArrowRight className="w-5 h-5 ml-2" /></>}
                </button>

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
