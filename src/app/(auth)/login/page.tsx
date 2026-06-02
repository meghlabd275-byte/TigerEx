'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, Users, Shield, Zap, CreditCard, 
  Globe, Smartphone, Wallet, ArrowRight,
  Mail, Lock, Eye, EyeOff, AlertCircle
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Basic validation
    if (!email || !password) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    // Simulate login - in real app, this would call an API
    setTimeout(() => {
      setLoading(false);
      // Redirect to trading page on success
      router.push('/trading/BTC-USDT');
    }, 1500);
  };

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
            <h1 className="text-3xl font-bold text-white">Welcome back</h1>
            <p className="text-gray-400 mt-2">Enter your credentials to access your account</p>
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm text-gray-300">Password</label>
                <Link href="/forgot-password" className="text-sm text-orange-500 hover:underline">
                  Forgot password?
                </Link>
              </div>
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
            </div>

            {/* Remember + 2FA */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input type="checkbox" className="rounded bg-white/5 border-white/10" />
                Remember me
              </label>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          {/* Sign Up Link */}
          <div className="text-center text-sm text-gray-400">
            Don't have an account?{' '}
            <Link href="/register" className="text-orange-500 hover:underline font-medium">
              Create one
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