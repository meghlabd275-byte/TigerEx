'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, Users, Shield, Zap, CreditCard, 
  Globe, Smartphone, Wallet, ArrowRight,
  Mail, Lock, Eye, EyeOff, AlertCircle, Check
} from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    if (!agreeTerms) {
      setError('Please agree to the Terms of Service');
      setLoading(false);
      return;
    }

    setTimeout(() => {
      setLoading(false);
      router.push('/trading/BTC-USDT');
    }, 1500);
  };

  // Password strength check
  const getPasswordStrength = () => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/)) strength++;
    if (password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;
    return strength;
  };

  const passwordStrength = getPasswordStrength();
  const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-green-500'];

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <span className="text-xl font-bold text-white">T</span>
            </div>
            <span className="text-2xl font-bold text-white">TigerEx</span>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-3xl font-bold text-white">Create Account</h1>
            <p className="text-gray-400 mt-2">Start your crypto journey today</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-11 pr-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-11 pr-11 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              
              {/* Password Strength */}
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full ${
                          i <= passwordStrength ? strengthColors[passwordStrength - 1] : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="text-xs text-gray-500">
                    Password strength: {strengthLabels[passwordStrength - 1] || 'Very Weak'}
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-11 pr-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500"
                />
              </div>
              {confirmPassword && password === confirmPassword && (
                <div className="flex items-center gap-1 mt-1 text-xs text-green-400">
                  <Check className="h-3 w-3" /> Passwords match
                </div>
              )}
            </div>

            {/* Terms */}
            <div>
              <label className="flex items-start gap-2 text-sm text-gray-400">
                <input 
                  type="checkbox" 
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 rounded bg-white/5 border-white/10" 
                />
                <span>
                  I agree to the{' '}
                  <Link href="/terms" className="text-orange-500 hover:underline">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="text-orange-500 hover:underline">
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          {/* Sign In Link */}
          <div className="text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="text-orange-500 hover:underline font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Right Panel - Background */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-orange-500/20 to-purple-500/20 items-center justify-center p-12">
        <div className="max-w-lg text-center">
          <div className="grid grid-cols-3 gap-8 mb-8">
            {[
              { icon: TrendingUp, label: '99.9% Uptime' },
              { icon: Shield, label: 'Bank-Grade Security' },
              { icon: Zap, label: 'Fast Execution' },
              { icon: Globe, label: '150+ Countries' },
              { icon: Users, label: '10M+ Users' },
              { icon: CreditCard, label: '200+ Assets' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                  <item.icon className="h-6 w-6 text-orange-500" />
                </div>
                <span className="text-sm text-gray-300">{item.label}</span>
              </div>
            ))}
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-4">
            Trade with Confidence
          </h2>
          <p className="text-gray-400">
            Join millions of traders worldwide on the most secure cryptocurrency exchange platform.
          </p>
        </div>
      </div>
    </div>
  );
}