'use client';

import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface EmailVerifyProps {
  email?: string;
}

export function EmailVerify({ email = '' }: EmailVerifyProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const checkVerification = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) return;

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.success && data.data?.emailVerified) {
          setVerified(true);
        }
      } catch (err) {
        console.error('Failed to check verification:', err);
      }
    };

    checkVerification();
  }, []);

  const handleSendVerification = async () => {
    setSending(true);
    setError(null);

    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Please login first');
      setSending(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to send verification email');
      }

      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (verified) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="text-green-500 w-5 h-5" />
          <div>
            <div className="text-green-500 font-medium">Email Verified</div>
            <div className="text-gray-400 text-sm">{email}</div>
          </div>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <Mail className="text-blue-500 w-5 h-5" />
          <div>
            <div className="text-blue-500 font-medium">Verification Email Sent</div>
            <div className="text-gray-400 text-sm">Please check your inbox and click the verification link</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mail className="text-gray-500 w-5 h-5" />
          <div>
            <div className="text-white font-medium">Email Verification</div>
            <div className="text-gray-500 text-sm">{email || 'No email provided'}</div>
          </div>
        </div>

        <button
          onClick={handleSendVerification}
          disabled={sending}
          className="bg-tiger-orange hover:bg-tiger-orange/80 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {sending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending...
            </span>
          ) : (
            'Verify Email'
          )}
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
}

export default EmailVerify;
