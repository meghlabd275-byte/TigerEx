'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
      colors: { primary: '#f97316', secondary: '#fb923c', background: '#0f172a', surface: '#1e293b', text: '#f8fafc', textSecondary: '#94a3b8', border: '#334155', error: '#f87171', success: '#4ade80', warning: '#fbbf24', info: '#60a5fa' }
    } : {
      mode: 'light',
      colors: { primary: '#f97316', secondary: '#ea580c', background: '#ffffff', surface: '#f8fafc', text: '#0f172a', textSecondary: '#64748b', border: '#e2e8f0', error: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#3b82f6' }
    });
  }, []);

  const toggleTheme = () => {
    const newTheme = theme?.mode === 'light' 
      ? { mode: 'dark', colors: { primary: '#f97316', secondary: '#fb923c', background: '#0f172a', surface: '#1e293b', text: '#f8fafc', textSecondary: '#94a3b8', border: '#334155', error: '#f87171', success: '#4ade80', warning: '#fbbf24', info: '#60a5fa' }}
      : { mode: 'light', colors: { primary: '#f97316', secondary: '#ea580c', background: '#ffffff', surface: '#f8fafc', text: '#0f172a', textSecondary: '#64748b', border: '#e2e8f0', error: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#3b82f6' }};
    setTheme(newTheme);
    localStorage.setItem('tigerex-theme', newTheme.mode);
  };

  return { theme, toggleTheme, mounted };
};

// Countries
const COUNTRIES = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' }, { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' }, { code: 'JP', name: 'Japan' }, { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' }, { code: 'IN', name: 'India' }, { code: 'BR', name: 'Brazil' },
  { code: 'RU', name: 'Russia' }, { code: 'AU', name: 'Australia' }, { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' }, { code: 'NL', name: 'Netherlands' }, { code: 'SE', name: 'Sweden' },
  { code: 'CA', name: 'Canada' }, { code: 'SG', name: 'Singapore' }, { code: 'HK', name: 'Hong Kong' },
  { code: 'AE', name: 'UAE' }, { code: 'SA', name: 'Saudi Arabia' }, { code: 'TR', name: 'Turkey' },
  { code: 'TH', name: 'Thailand' }, { code: 'VN', name: 'Vietnam' }, { code: 'ID', name: 'Indonesia' },
  { code: 'MY', name: 'Malaysia' }, { code: 'PH', name: 'Philippines' }, { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' }, { code: 'EG', name: 'Egypt' }, { code: 'BD', name: 'Bangladesh' },
  { code: 'PK', name: 'Pakistan' }, { code: 'MX', name: 'Mexico' }, { code: 'PL', name: 'Poland' },
  { code: 'RO', name: 'Romania' }, { code: 'UA', name: 'Ukraine' }, { code: 'CO', name: 'Colombia' },
  { code: 'CL', name: 'Chile' }, { code: 'PE', name: 'Peru' }, { code: 'AR', name: 'Argentina' },
];

// Components
const Button: React.FC<any> = ({ children, variant = 'primary', loading = false, disabled, fullWidth, style, onClick, type, className, icon }) => {
  const { theme } = useTheme();
  const variantStyles: any = {
    primary: { bg: theme?.colors.primary, color: 'white' },
    outline: { bg: 'transparent', color: theme?.colors.primary, border: `1px solid ${theme?.colors.primary}` },
    ghost: { bg: 'transparent', color: theme?.colors.text },
  };
  const vs = variantStyles[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      className={`font-semibold rounded-lg transition-all duration-200 px-6 py-3 ${fullWidth ? 'w-full' : ''} ${className || ''}`}
      style={{ backgroundColor: disabled ? `${vs.bg}50` : vs.bg, color: vs.color, border: vs.border, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      {loading && <span className="inline-block animate-spin mr-2 h-4 w-4 border-2 border-t-transparent rounded-full" style={{ borderTopColor: 'white' }} />}
      {icon && <span className="mr-2">{icon}</span>}
      {children}
    </button>
  );
};

const Input: React.FC<any> = ({ style, type = 'text', value, onChange, placeholder, className, selectOptions }) => {
  const { theme } = useTheme();
  if (selectOptions) {
    return (
      <select value={value} onChange={onChange}
        className={`w-full px-4 py-3 rounded-lg outline-none transition-all ${className || ''}`}
        style={{ backgroundColor: theme?.colors.surface, color: theme?.colors.text, border: `1px solid ${theme?.colors.border}`, ...style }}>
        <option value="">{placeholder}</option>
        {selectOptions.map((opt: any) => <option key={opt.code} value={opt.code}>{opt.name}</option>)}
      </select>
    );
  }
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className={`w-full px-4 py-3 rounded-lg outline-none transition-all ${className || ''}`}
      style={{ backgroundColor: theme?.colors.surface, color: theme?.colors.text, border: `1px solid ${theme?.colors.border}`, ...style }} />
  );
};

const FileUpload: React.FC<any> = ({ label, onChange, accept, icon }) => {
  const { theme } = useTheme();
  const [preview, setPreview] = useState<string | null>(null);

  const handleChange = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
      onChange(file);
    }
  };

  return (
    <div>
      <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>{label}</label>
      <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:opacity-80 transition-opacity"
        style={{ borderColor: theme?.colors.border, backgroundColor: theme?.colors.surface }}
        onClick={() => document.getElementById(`file-${label}`)?.click()}>
        <input id={`file-${label}`} type="file" accept={accept} onChange={handleChange} className="hidden" />
        {preview ? (
          <img src={preview} alt={label} className="max-h-40 mx-auto rounded-lg" />
        ) : (
          <div style={{ color: theme?.colors.textSecondary }}>
            {icon || '📄'}
            <p className="mt-2">Click to upload</p>
            <p className="text-xs">{accept}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Liveness Check Component
const LivenessCheck: React.FC<{ onComplete: (success: boolean) => void }> = ({ onComplete }) => {
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const [instructions, setInstructions] = useState([
    'Please look straight at the camera',
    'Turn your head slightly to the left',
    'Turn your head slightly to the right',
    'Blink slowly',
    'Smile for the camera',
  ]);
  const [progress, setProgress] = useState(0);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (step < instructions.length) {
      const timer = setTimeout(() => {
        setProgress(((step + 1) / instructions.length) * 100);
        setStep(step + 1);
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setIsChecking(true);
      setTimeout(() => {
        setIsChecking(false);
        onComplete(true);
      }, 1500);
    }
  }, [step]);

  return (
    <div className="text-center">
      <div className="w-48 h-48 mx-auto mb-4 rounded-full flex items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: theme?.colors.surface, border: `2px solid ${theme?.colors.border}` }}>
        {isChecking ? (
          <div style={{ color: theme?.colors.success }}>✓</div>
        ) : (
          <div style={{ color: theme?.colors.textSecondary }}>📷</div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full border-4" style={{ borderColor: theme?.colors.primary, borderTopColor: 'transparent' }} />
        </div>
      </div>
      <p className="text-lg font-medium mb-4" style={{ color: theme?.colors.text }}>
        {isChecking ? 'Verifying...' : instructions[step] || 'Complete!'}
      </p>
      <div className="w-full h-2 rounded-full" style={{ backgroundColor: theme?.colors.border }}>
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: theme?.colors.primary }} />
      </div>
      <p className="mt-2 text-sm" style={{ color: theme?.colors.textSecondary }}>{Math.round(progress)}% complete</p>
    </div>
  );
};

// Main KYC Page
export default function KYCPage() {
  const router = useRouter();
  const { theme, toggleTheme, mounted } = useTheme();
  
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [kycStatus, setKycStatus] = useState<'none' | 'pending' | 'reviewing' | 'approved' | 'rejected'>('none');
  
  // Form data
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    title: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    documentType: 'passport',
    documentFront: null as File | null,
    documentBack: null as File | null,
    selfieWithDoc: null as File | null,
  });

  const updateField = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
    setError('');
  };

  // Step 1: Personal Information
  const handlePersonalInfoSubmit = async () => {
    if (!formData.firstName || !formData.lastName || !formData.country) {
      setError('Please fill in all required fields');
      return;
    }
    setStep(2);
  };

  // Step 2: Document Upload
  const handleDocumentSubmit = async () => {
    if (!formData.documentFront || !formData.selfieWithDoc) {
      setError('Please upload required documents');
      return;
    }
    setStep(3);
  };

  // Step 3: Liveness Check
  const handleLivenessComplete = async (success: boolean) => {
    if (!success) {
      setError('Liveness check failed. Please try again.');
      return;
    }
    setIsLoading(true);
    
    try {
      // Submit KYC application
      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      
      if (data.success) {
        setKycStatus('pending');
        setStep(4);
      } else {
        setError(data.message || 'KYC submission failed');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle document types
  const documentTypes = [
    { value: 'passport', label: 'Passport' },
    { value: 'national_id', label: 'National ID' },
    { value: 'drivers_license', label: "Driver's License" },
    { value: 'voter_id', label: 'Voter ID' },
  ];

  if (!mounted) return null;

  return (
    <div className="min-h-screen py-8" style={{ backgroundColor: theme?.colors.background }}>
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold" style={{ color: theme?.colors.primary }}>TigerEx</h1>
          <p style={{ color: theme?.colors.textSecondary }}>Identity Verification (KYC)</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {[
            { num: 1, label: 'Personal Info' },
            { num: 2, label: 'Documents' },
            { num: 3, label: 'Verification' },
            { num: 4, label: 'Complete' },
          ].map((s, i) => (
            <React.Fragment key={s.num}>
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${step >= s.num ? 'text-white' : ''}`}
                  style={{ backgroundColor: step >= s.num ? theme?.colors.primary : theme?.colors.border, color: step >= s.num ? 'white' : theme?.colors.textSecondary }}>
                  {step > s.num ? '✓' : s.num}
                </div>
                <span className="text-xs mt-1" style={{ color: theme?.colors.textSecondary }}>{s.label}</span>
              </div>
              {i < 3 && <div className="w-16 h-1 mx-2" style={{ backgroundColor: step > s.num ? theme?.colors.primary : theme?.colors.border }} />}
            </React.Fragment>
          ))}
        </div>

        {/* Error */}
        {error && <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: `${theme?.colors.error}20`, color: theme?.colors.error }}>{error}</div>}

        {/* Card */}
        <div className="p-8 rounded-2xl shadow-xl" style={{ backgroundColor: theme?.colors.surface }}>
          {/* Step 1: Personal Information */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold mb-6" style={{ color: theme?.colors.text }}>Personal Information</h2>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Title *</label>
                  <Input selectOptions={[{code:'', label:'Select Title'}, {code:'mr',label:'Mr.'}, {code:'mrs',label:'Mrs.'}, {code:'ms',label:'Ms.'}, {code:'dr',label:'Dr.'}]} value={formData.title} onChange={(e: any) => updateField('title', e.target.value)} placeholder="Select Title" />
                </div>
                <div></div>
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>First Name *</label>
                  <Input value={formData.firstName} onChange={(e: any) => updateField('firstName', e.target.value)} placeholder="First Name" />
                </div>
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Last Name *</label>
                  <Input value={formData.lastName} onChange={(e: any) => updateField('lastName', e.target.value)} placeholder="Last Name" />
                </div>
              </div>

              <div className="mt-4">
                <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Address</label>
                <Input value={formData.address} onChange={(e: any) => updateField('address', e.target.value)} placeholder="Street Address" />
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>City</label>
                  <Input value={formData.city} onChange={(e: any) => updateField('city', e.target.value)} placeholder="City" />
                </div>
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>State/Province</label>
                  <Input value={formData.state} onChange={(e: any) => updateField('state', e.target.value)} placeholder="State/Province" />
                </div>
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Postal Code</label>
                  <Input value={formData.postalCode} onChange={(e: any) => updateField('postalCode', e.target.value)} placeholder="Postal Code" />
                </div>
                <div>
                  <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Country *</label>
                  <Input selectOptions={COUNTRIES} value={formData.country} onChange={(e: any) => updateField('country', e.target.value)} placeholder="Select Country" />
                </div>
              </div>

              <Button onClick={handlePersonalInfoSubmit} fullWidth size="lg" className="mt-6">Continue</Button>
            </div>
          )}

          {/* Step 2: Document Upload */}
          {step === 2 && (
            <div>
              <button onClick={() => setStep(1)} className="flex items-center mb-4 text-sm" style={{ color: theme?.colors.primary }}>← Back</button>
              <h2 className="text-xl font-bold mb-6" style={{ color: theme?.colors.text }}>Document Verification</h2>
              
              <div className="mb-4">
                <label className="block mb-2 font-medium" style={{ color: theme?.colors.text }}>Document Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {documentTypes.map((doc) => (
                    <button key={doc.value} onClick={() => updateField('documentType', doc.value)}
                      className={`p-3 rounded-lg border-2 transition-all ${formData.documentType === doc.value ? 'border-orange-500' : ''}`}
                      style={{ borderColor: formData.documentType === doc.value ? theme?.colors.primary : theme?.colors.border, backgroundColor: theme?.colors.surface }}>
                      <span style={{ color: theme?.colors.text }}>{doc.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <FileUpload label="Document Front *" accept="image/*,.pdf" icon="🪪" onChange={(file: any) => updateField('documentFront', file)} />
              
              {formData.documentType !== 'passport' && (
                <div className="mt-4">
                  <FileUpload label="Document Back" accept="image/*,.pdf" icon="🪪" onChange={(file: any) => updateField('documentBack', file)} />
                </div>
              )}
              
              <div className="mt-4">
                <FileUpload label="Selfie with Document *" accept="image/*" icon="🤳" onChange={(file: any) => updateField('selfieWithDoc', file)} />
              </div>

              <Button onClick={handleDocumentSubmit} fullWidth size="lg" className="mt-6">Continue to Verification</Button>
            </div>
          )}

          {/* Step 3: Liveness Check */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold mb-6" style={{ color: theme?.colors.text }}>Liveness Verification</h2>
              <p className="mb-6" style={{ color: theme?.colors.textSecondary }}>
                Please follow the instructions below for face verification. This helps us ensure you're a real person.
              </p>
              <LivenessCheck onComplete={handleLivenessComplete} />
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 4 && (
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${theme?.colors.success}20` }}>
                <span style={{ color: theme?.colors.success, fontSize: '3rem' }}>✓</span>
              </div>
              <h2 className="text-xl font-bold mb-4" style={{ color: theme?.colors.text }}>Verification Submitted!</h2>
              <p className="mb-6" style={{ color: theme?.colors.textSecondary }}>
                Your identity verification has been submitted for review. This typically takes 1-3 business days.
              </p>
              <div className="p-4 rounded-lg mb-6" style={{ backgroundColor: theme?.colors.background }}>
                <p className="text-sm" style={{ color: theme?.colors.textSecondary }}>Status: <span style={{ color: theme?.colors.warning, fontWeight: 'bold' }}>Pending Review</span></p>
              </div>
              <Button onClick={() => router.push('/dashboard')} fullWidth>Go to Dashboard</Button>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: `${theme?.colors.info}10`, border: `1px solid ${theme?.colors.info}30` }}>
          <p className="text-sm" style={{ color: theme?.colors.text }}>
            <strong>Note:</strong> Your KYC data is securely encrypted and stored. Without approved KYC, you cannot withdraw funds. 
            Any changes to email, phone, password, or 2FA will trigger a 48-hour withdrawal freeze for security.
          </p>
        </div>
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
