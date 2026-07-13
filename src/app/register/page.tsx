"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react';

interface AuthResponse {
  success: boolean;
  data?: {
    accessToken?: string;
    access_token?: string;
    refreshToken?: string;
    refresh_token?: string;
    expiresIn?: number;
    expires_at?: number;
    tokenType?: string;
    user?: {
      id: string;
      email: string;
      username: string;
      kycLevel?: number;
      kyc_level?: number;
      status?: string;
    };
  };
  error?: {
    code?: number;
    message: string;
  };
}

interface ValidationErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  referralCode?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    referralCode: '',
    agreeTerms: false,
    agreePrivacy: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [passwordStrength, setPasswordStrength] = useState({
    score: 0,
    label: '',
    color: '',
  });

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const isValidUsername = (value: string) => /^[a-zA-Z0-9_]{3,20}$/.test(value);

  useEffect(() => {
    const password = formData.password;
    let score = 0;

    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;

    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-400', 'bg-green-500'];

    setPasswordStrength({
      score,
      label: labels[Math.min(score, 4)],
      color: colors[Math.min(score, 4)],
    });
  }, [formData.password]);

  const validateForm = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (!isValidUsername(formData.username)) {
      newErrors.username = 'Username must be 3-20 characters (letters, numbers, underscores)';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/[A-Z]/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one uppercase letter';
    } else if (!/[a-z]/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one lowercase letter';
    } else if (!/\d/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one number';
    } else if (!/[!@#$%^&*]/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one special character (!@#$%^&*)';
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.agreeTerms || !formData.agreePrivacy) {
      setError('You must agree to the Terms of Service and Privacy Policy');
      setErrors(newErrors);
      return false;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (errors[name as keyof ValidationErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setErrors({});

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const requestBody = {
        username: formData.username.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        referralCode: formData.referralCode.trim() || undefined,
      };

      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data: AuthResponse = await response.json();

      if (!response.ok) {
        const msg = data.error?.message || 'Registration failed';
        if (msg.toLowerCase().includes('email')) {
          setErrors(prev => ({ ...prev, email: msg }));
        } else if (msg.toLowerCase().includes('username')) {
          setErrors(prev => ({ ...prev, username: msg }));
        } else {
          setError(msg);
        }
        return;
      }

      if (!data.success || !data.data) {
        throw new Error('Invalid response from server');
      }

      const accessToken = data.data.accessToken || data.data.access_token;
      const refreshToken = data.data.refreshToken || data.data.refresh_token;
      const expiresAt = data.data.expiresIn || data.data.expires_at;
      const user = data.data.user;

      if (accessToken) {
        localStorage.setItem('tigerex_token', accessToken);
      }
      if (refreshToken) {
        localStorage.setItem('tigerex_refresh_token', refreshToken);
      }
      if (expiresAt !== undefined) {
        localStorage.setItem('tigerex_token_expires', String(expiresAt));
      }
      if (user) {
        localStorage.setItem('tigerex_user', JSON.stringify(user));
      }

      setSuccess('Account created successfully! Redirecting...');
      setTimeout(() => {
        router.push('/dashboard');
      }, 800);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 py-12 px-4">
      <div className="bg-gray-800/50 backdrop-blur-xl p-8 rounded-2xl shadow-2xl border border-gray-700/50 w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">Create Account</h1>
          <p className="text-gray-400 mt-2">Join TigerEx and start trading</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/50 text-green-400 px-4 py-3 rounded-lg text-sm">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              {success}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              className={`w-full px-4 py-3 bg-gray-900/50 border rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all ${errors.username ? 'border-red-500' : 'border-gray-600'}`}
              placeholder="Choose a username"
              autoComplete="username"
              disabled={loading}
            />
            {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={`w-full px-4 py-3 bg-gray-900/50 border rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all ${errors.email ? 'border-red-500' : 'border-gray-600'}`}
              placeholder="your@email.com"
              autoComplete="email"
              disabled={loading}
            />
            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                className={`w-full px-4 py-3 pr-12 bg-gray-900/50 border rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all ${errors.password ? 'border-red-500' : 'border-gray-600'}`}
                placeholder="Create a strong password"
                autoComplete="new-password"
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
            {formData.password && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map(level => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded-full transition-all ${level <= passwordStrength.score ? passwordStrength.color : 'bg-gray-700'}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-400">Strength: <span className={passwordStrength.color.replace('bg-', 'text-')}>{passwordStrength.label}</span></p>
                </div>
              </div>
            )}
            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Confirm Password</label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className={`w-full px-4 py-3 bg-gray-900/50 border rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all ${errors.confirmPassword ? 'border-red-500' : 'border-gray-600'}`}
              placeholder="Confirm your password"
              autoComplete="new-password"
              disabled={loading}
            />
            {errors.confirmPassword && <p className="text-red-400 text-xs mt-1">{errors.confirmPassword}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Referral Code (Optional)</label>
            <input
              type="text"
              name="referralCode"
              value={formData.referralCode}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              placeholder="Enter referral code"
              disabled={loading}
            />
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="agreeTerms"
                checked={formData.agreeTerms}
                onChange={handleChange}
                className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-900 text-purple-500 focus:ring-purple-500"
                disabled={loading}
              />
              <span className="text-sm text-gray-400">
                I agree to the{' '}
                <Link href="/terms" className="text-purple-400 hover:text-purple-300">Terms of Service</Link>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="agreePrivacy"
                checked={formData.agreePrivacy}
                onChange={handleChange}
                className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-900 text-purple-500 focus:ring-purple-500"
                disabled={loading}
              />
              <span className="text-sm text-gray-400">
                I agree to the{' '}
                <Link href="/privacy" className="text-purple-400 hover:text-purple-300">Privacy Policy</Link>
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>

          <div className="bg-gray-900/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
              <Info className="w-4 h-4" />
              <span className="font-medium">Password Requirements</span>
            </div>
            <ul className="text-xs text-gray-500 space-y-1">
              <li className={formData.password.length >= 8 ? 'text-green-400' : ''}>• At least 8 characters</li>
              <li className={/[A-Z]/.test(formData.password) ? 'text-green-400' : ''}>• One uppercase letter (A-Z)</li>
              <li className={/[a-z]/.test(formData.password) ? 'text-green-400' : ''}>• One lowercase letter (a-z)</li>
              <li className={/\d/.test(formData.password) ? 'text-green-400' : ''}>• One number (0-9)</li>
              <li className={/[!@#$%^&*]/.test(formData.password) ? 'text-green-400' : ''}>• One special character (!@#$%^&*)</li>
            </ul>
          </div>
        </form>

        <p className="text-center text-gray-400 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
