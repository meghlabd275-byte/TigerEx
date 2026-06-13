"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, User, Camera, Upload, CheckCircle, Clock, AlertTriangle } from "lucide-react";

export default function KYCUploadPage() {
  const [step, setStep] = useState(1);
  const [verified, setVerified] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
              <span className="text-xl font-bold text-white">T</span>
            </div>
            <span className="text-xl font-bold text-white">TigerEx</span>
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold text-white mb-2">Identity Verification</h1>
        <p className="text-gray-400 mb-6">Complete KYC to unlock all features</p>

        {verified ? (
          <div className="rounded-xl border border-green-500/50 bg-green-500/10 p-6">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="h-6 w-6" />
              <span className="text-xl font-bold">Verified</span>
            </div>
            <p className="mt-2 text-gray-400">Your identity has been verified.</p>
          </div>
        ) : step === 1 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Select Document Type</h3>
            <div className="space-y-3">
              <button onClick={() => setStep(2)} className="w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
                <div className="flex items-center gap-3">
                  <User className="h-8 w-8 text-tiger-orange" />
                  <div>
                    <div className="font-bold text-white">Passport</div>
                    <div className="text-sm text-gray-400">Government-issued passport</div>
                  </div>
                </div>
              </button>
              <button onClick={() => setStep(2)} className="w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
                <div className="flex items-center gap-3">
                  <User className="h-8 w-8 text-tiger-orange" />
                  <div>
                    <div className="font-bold text-white">National ID</div>
                    <div className="text-sm text-gray-400">National identity card</div>
                  </div>
                </div>
              </button>
              <button onClick={() => setStep(2)} className="w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
                <div className="flex items-center gap-3">
                  <User className="h-8 w-8 text-tiger-orange" />
                  <div>
                    <div className="font-bold text-white">Driver's License</div>
                    <div className="text-sm text-gray-400">Valid driver's license</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : step === 2 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Upload Document</h3>
            <div className="mb-4 rounded-lg border-2 border-dashed border-white/20 p-8 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-gray-400">Click to upload or drag and drop</p>
              <p className="text-sm text-gray-500">PNG, JPG up to 10MB</p>
            </div>
            <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-gray-400">
                <Camera className="h-4 w-4" />
                <span className="text-sm">Take a photo with your camera</span>
              </div>
            </div>
            <button onClick={() => setStep(3)} className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">
              Continue
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Selfie Verification</h3>
            <div className="mb-4 rounded-lg border-2 border-dashed border-white/20 p-8 text-center">
              <Camera className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-gray-400">Take a selfie with your document</p>
            </div>
            <div className="mb-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                <p className="text-sm text-yellow-400">Make sure your face is clearly visible and matches the document photo.</p>
              </div>
            </div>
            <button onClick={() => setVerified(true)} className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">
              Submit for Verification
            </button>
          </div>
        )}

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            <Shield className="mx-auto mb-2 h-6 w-6 text-green-400" />
            <div className="text-sm text-gray-400">Encrypted</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            <Clock className="mx-auto mb-2 h-6 w-6 text-tiger-orange" />
            <div className="text-sm text-gray-400">24h review</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            <CheckCircle className="mx-auto mb-2 h-6 w-6 text-green-400" />
            <div className="text-sm text-gray-400">Secure</div>
          </div>
        </div>
      </div>
    </div>
  );
}