"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

interface LoginResponse {
  success: boolean;
  data?: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    user?: {
      id: string;
      email: string;
      username: string;
      kyc_level: number;
      status: string;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  // Validate email format
  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Handle login submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    // Client-side validation
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const requestBody: Record<string, string> = {
        email: email.trim().toLowerCase(),
        password,
      };

      // Add 2FA code if provided
      if (show2FA && twoFactorCode) {
        requestBody.twoFactorCode = twoFactorCode;
      }

      // Get device ID for tracking
      const deviceId = localStorage.getItem('tigerex_device_id') || 
        crypto.randomUUID();
      localStorage.setItem('tigerex_device_id', deviceId);
      requestBody.deviceId = deviceId;

      // Get client IP (would be done server-side in production)
      requestBody.ipAddress = 'client';
      requestBody.userAgent = navigator.userAgent;

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const payload: LoginResponse = await response.json();

      if (!response.ok) {
        const msg = payload.error?.message || 'Login failed';
        
        // Handle 2FA required
        if (response.status === 402 || msg.toLowerCase().includes('2fa')) {
          setShow2FA(true);
          setError('Please enter your 2FA code');
          return;
        }
        
        // Handle account locked
        if (msg.toLowerCase().includes('locked') || msg.toLowerCase().includes('suspended')) {
          setError(`${msg}. Please try again later or contact support.`);
          return;
        }
        
        throw new Error(msg);
      }

      if (!payload.success || !payload.data) {
        throw new Error('Invalid response from server');
      }

      const { access_token, refresh_token, expires_at, user } = payload.data;

      if (!access_token) {
        throw new Error('No access token returned');
      }

      // Store tokens securely
      localStorage.setItem('tigerex_token', access_token);
      localStorage.setItem('tigerex_refresh_token', refresh_token || '');
      localStorage.setItem('tigerex_token_expires', String(expires_at));
      
      // Store user info
      if (user) {
        localStorage.setItem('tigerex_user', JSON.stringify(user));
      }

      setSuccess('Login successful! Redirecting...');
      
      // Redirect to dashboard
      setTimeout(() => {
        router.push('/dashboard');
      }, 500);
      
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="bg-gray-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-gray-700/50 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">Welcome Back</h1>
          <p className="text-gray-400 mt-2">Sign in to your TigerEx account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/50 text-green-400 px-4 py-3 rounded-lg text-sm">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              {success}
            </div>
          )}

          {/* Email Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="your@email.com"
              autoComplete="email"
              required
              disabled={loading}
            />
          </div>

          {/* Password Input with visibility toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* 2FA Input - conditionally shown */}
          {show2FA && (
            <div className="animate-fade-in">
              <label className="block text-sm font-medium text-gray-300 mb-2">2FA Code</label>
              <input
                type="text"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-center text-2xl tracking-widest"
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
                disabled={loading}
              />
              <p className="text-xs text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>

          {/* Forgot Password Link */}
          <div className="text-center">
            <Link href="/password/reset" className="text-sm text-gray-400 hover:text-purple-400 transition-colors">
              Forgot your password?
            </Link>
          </div>
        </form>

        <p className="text-center text-gray-400 mt-6">
          Don't have an account?{' '}
          <Link href="/register" className="text-purple-400 hover:text-purple-300 font-medium">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
