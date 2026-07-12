'use client';

import React, { useState, useEffect } from 'react';
import { Shield, Smartphone, CheckCircle, AlertCircle, Loader2, Copy } from 'lucide-react';

interface TwoFactorAuthProps {
  enabled?: boolean;
}

export function TwoFactorAuth({ enabled = false }: TwoFactorAuthProps) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [loading, setLoading] = useState(false);
  const [setupStep, setSetupStep] = useState<'init' | 'scan' | 'verify'>('init');
  const [secret, setSecret] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Check 2FA status on mount
  useEffect(() => {
    const checkStatus = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) return;

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.success && data.data) {
          setIsEnabled(data.data.twoFactorEnabled || false);
        }
      } catch (err) {
        console.error('Failed to check 2FA status:', err);
      }
    };

    checkStatus();
  }, []);

  const handleSetup = async () => {
    setLoading(true);
    setError(null);

    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Please login first');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to setup 2FA');
      }

      setSecret(data.data.secret);
      setQrCode(data.data.qrCode);
      setSetupStep('scan');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);

    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Please login first');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/2fa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Invalid verification code');
      }

      setIsEnabled(true);
      setSuccess(true);
      setSetupStep('init');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
      return;
    }

    setLoading(true);
    setError(null);

    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Please login first');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/2fa', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to disable 2FA');
      }

      setIsEnabled(false);
      setSetupStep('init');
      setCode('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
  };

  if (success) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-6 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-green-500 text-lg font-semibold mb-2">2FA Enabled Successfully!</h3>
        <p className="text-gray-400">Your account is now protected with two-factor authentication.</p>
      </div>
    );
  }

  if (isEnabled) {
    return (
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="text-green-500 w-8 h-8" />
            <div>
              <h3 className="text-white font-semibold">Two-Factor Authentication</h3>
              <p className="text-gray-400 text-sm">Your account is protected</p>
            </div>
          </div>
          <button
            onClick={handleDisable}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Disable'}
          </button>
        </div>
      </div>
    );
  }

  if (setupStep === 'init') {
    return (
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="text-gray-500 w-8 h-8" />
          <div>
            <h3 className="text-white font-semibold">Two-Factor Authentication</h3>
            <p className="text-gray-400 text-sm">Add an extra layer of security to your account</p>
          </div>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <Smartphone className="text-blue-500 w-5 h-5 mt-0.5" />
            <div className="text-sm text-gray-300">
              <p className="font-medium mb-1">Why enable 2FA?</p>
              <ul className="list-disc list-inside space-y-1 text-gray-400">
                <li>Protects your account even if password is compromised</li>
                <li>Required for withdrawals and API key creation</li>
                <li>Compatible with Google Authenticator, Authy, etc.</li>
              </ul>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 p-3 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <button
          onClick={handleSetup}
          disabled={loading}
          className="w-full bg-tiger-orange hover:bg-tiger-orange/80 disabled:opacity-50 py-3 rounded-lg font-medium transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Setting up...
            </span>
          ) : (
            'Enable 2FA'
          )}
        </button>
      </div>
    );
  }

  if (setupStep === 'scan') {
    return (
      <div className="bg-gray-900 rounded-lg p-6">
        <h3 className="text-white font-semibold mb-4">Scan QR Code</h3>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <div className="w-48 h-48 bg-white rounded-lg flex items-center justify-center">
            <span className="text-gray-400">QR Code</span>
          </div>
        </div>

        {/* Secret */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Or enter this code manually:</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={secret}
              readOnly
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg py-2 px-3 text-white font-mono text-sm"
            />
            <button
              onClick={copySecret}
              className="bg-gray-700 hover:bg-gray-600 px-3 rounded-lg"
            >
              <Copy className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Verification Code */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Enter 6-digit code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            placeholder="000000"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white text-center text-2xl font-mono tracking-widest"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 p-3 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setSetupStep('init')}
            className="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded-lg font-medium"
          >
            Back
          </button>
          <button
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            className="flex-1 bg-tiger-orange hover:bg-tiger-orange/80 disabled:opacity-50 py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Verify'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default TwoFactorAuth;
