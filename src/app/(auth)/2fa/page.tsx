"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Key, Smartphone, Mail, Copy, CheckCircle, AlertTriangle } from "lucide-react";

export default function TwoFactorPage() {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(false);

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
        <h1 className="text-3xl font-bold text-white mb-2">Two-Factor Authentication</h1>
        <p className="text-gray-400 mb-6">Secure your account with 2FA</p>

        {enabled ? (
          <div className="rounded-xl border border-green-500/50 bg-green-500/10 p-6">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="h-6 w-6" />
              <span className="text-xl font-bold">2FA Enabled</span>
            </div>
            <p className="mt-2 text-gray-400">Your account is protected with two-factor authentication.</p>
            <button className="mt-4 rounded-lg border border-red-500/50 px-4 py-2 text-red-400 hover:bg-red-500/10">
              Disable 2FA
            </button>
          </div>
        ) : step === 1 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Choose 2FA Method</h3>
            <div className="space-y-3">
              <button onClick={() => setStep(2)} className="w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-8 w-8 text-tiger-orange" />
                  <div>
                    <div className="font-bold text-white">Authenticator App</div>
                    <div className="text-sm text-gray-400">Google Authenticator or similar</div>
                  </div>
                </div>
              </button>
              <button className="w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left opacity-50">
                <div className="flex items-center gap-3">
                  <Mail className="h-8 w-8 text-gray-400" />
                  <div>
                    <div className="font-bold text-white">SMS Authentication</div>
                    <div className="text-sm text-gray-400">Coming soon</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-lg font-bold text-white mb-4">Setup Authenticator</h3>
            <div className="mb-4 rounded-lg bg-white/5 p-4">
              <div className="text-sm text-gray-400 mb-2">Scan this QR code with your authenticator app</div>
              <div className="flex justify-center">
                <div className="h-32 w-32 rounded bg-white p-2">
                  <div className="h-full w-full bg-gray-200" />
                </div>
              </div>
            </div>
            <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-sm text-gray-400 mb-1">Or enter this key manually</div>
              <div className="font-mono text-white">JBSWY3KPCG7D4EJ2PDZIZZ</div>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm text-gray-400">Enter 6-digit code</label>
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" maxLength={6}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 px-4 font-mono text-white text-center text-2xl tracking-widest" />
            </div>
            <button onClick={() => setEnabled(true)} className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white">
              Enable 2FA
            </button>
          </div>
        )}
      </div>
    </div>
  );
}