'use client';

import React, { useState } from 'react';
import { Shield, Check, Upload, User, Phone, Mail, MapPin, ChevronRight, AlertCircle } from 'lucide-react';

const KYC_STEPS = [
  { id: 1, title: 'Basic Info', description: 'Name, date of birth', status: 'completed' },
  { id: 2, title: 'ID Document', description: 'Passport, driver license, or ID', status: 'completed' },
  { id: 3, title: 'Selfie Verification', description: 'Take a photo with your ID', status: 'current' },
  { id: 4, title: 'Address Proof', description: 'Utility bill or bank statement', status: 'pending' },
];

export default function KYCVerification() {
  const [currentStep, setCurrentStep] = useState(3);
  const [documentType, setDocumentType] = useState('');
  const [files, setFiles] = useState({ id: false, selfie: false, proof: false });

  const verificationLevels = [
    { level: 'Unverified', limits: '$1,000/day', features: 'Basic trading' },
    { level: 'Basic', limits: '$10,000/day', features: 'Spot trading, P2P' },
    { level: 'Intermediate', limits: '$100,000/day', features: 'Futures, Staking' },
    { level: 'Advanced', limits: 'Unlimited', features: 'All features, Fiat' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#FF6B35]/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-[#FF6B35]" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Identity Verification</h1>
          <p className="text-gray-400">Complete verification to unlock all features</p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-between mb-8 relative">
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-[#14141A] -translate-y-1/2 z-0" />
          {KYC_STEPS.map((step, index) => (
            <div key={step.id} className="relative z-10 flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                step.status === 'completed' ? 'bg-green-500' : 
                step.status === 'current' ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}>
                {step.status === 'completed' ? <Check className="w-5 h-5" /> : <span className="text-sm">{step.id}</span>}
              </div>
              <p className="text-xs text-center">{step.title}</p>
            </div>
          ))}
        </div>

        {/* Current Step */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Step 3: Selfie Verification</h2>
          
          {/* Document Type Selection */}
          <div className="mb-6">
            <label className="text-sm text-gray-400 mb-2 block">Select ID Document Type</label>
            <div className="grid grid-cols-3 gap-3">
              {['Passport', 'Driver License', 'National ID'].map(type => (
                <button key={type} onClick={() => setDocumentType(type)}
                  className={`p-3 rounded-lg border ${documentType === type ? 'border-[#FF6B35] bg-[#FF6B35]/10' : 'border-[rgba(255,255,255,0.1)]'}`}>
                  <User className="w-5 h-5 mx-auto mb-1" />
                  <p className="text-sm">{type}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Upload Areas */}
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Upload ID Document (Front)</label>
              <div className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
                files.id ? 'border-green-500 bg-green-500/10' : 'border-[rgba(255,255,255,0.1)] hover:border-[#FF6B35]'
              }`}>
                <Upload className="w-8 h-8 mx-auto mb-2 text-gray-500" />
                <p className="text-sm text-gray-400">Click to upload or drag and drop</p>
                <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 10MB</p>
                {files.id && <p className="text-green-500 text-sm mt-2">✓ Uploaded</p>}
              </div>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-2 block">Take Selfie with ID</label>
              <div className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
                files.selfie ? 'border-green-500 bg-green-500/10' : 'border-[rgba(255,255,255,0.1)] hover:border-[#FF6B35]'
              }`}>
                <User className="w-8 h-8 mx-auto mb-2 text-gray-500" />
                <p className="text-sm text-gray-400">Click to take photo</p>
                <p className="text-xs text-gray-500 mt-1">Make sure your face and ID are clearly visible</p>
                {files.selfie && <p className="text-green-500 text-sm mt-2">✓ Photo captured</p>}
              </div>
            </div>
          </div>

          <button className="w-full mt-6 py-3 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg font-medium">
            Submit for Review
          </button>
        </div>

        {/* Verification Levels */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Verification Levels</h2>
          <div className="space-y-3">
            {verificationLevels.map((v, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[#0A0A0F] rounded-lg">
                <div>
                  <p className="font-medium">{v.level}</p>
                  <p className="text-xs text-gray-500">{v.features}</p>
                </div>
                <p className="text-sm text-gray-400">{v.limits}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Notice */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-yellow-500">Privacy Notice</p>
            <p className="text-xs text-gray-400 mt-1">Your data is encrypted and securely stored. We comply with all applicable data protection regulations.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
