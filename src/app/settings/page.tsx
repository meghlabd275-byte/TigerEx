"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  User, 
  Shield, 
  Bell, 
  Key, 
  CreditCard, 
  Globe,
  Moon,
  Sun,
  Eye,
  EyeOff,
  Save,
  Copy,
  Check,
  X,
  AlertCircle,
  CheckCircle,
  Smartphone,
  Mail,
  Lock,
  LogOut
} from 'lucide-react';

interface User {
  id: string;
  email: string;
  username: string;
  kyc_level: number;
  phone?: string;
  created_at?: string;
}

type Tab = 'profile' | 'security' | 'notifications' | 'api' | 'preferences';

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Profile state
  const [profileData, setProfileData] = useState({
    username: '',
    email: '',
    phone: '',
  });

  // Security state
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  // Notification preferences
  const [notifications, setNotifications] = useState({
    emailOrders: true,
    emailDeposits: true,
    emailWithdrawals: true,
    emailSecurity: true,
    emailMarketing: false,
    pushOrders: true,
    pushDeposits: true,
    pushWithdrawals: true,
  });

  // Preferences
  const [preferences, setPreferences] = useState({
    theme: 'dark' as 'dark' | 'light',
    language: 'en',
    timezone: 'UTC',
    fiatCurrency: 'USD',
  });

  // Load user data
  useEffect(() => {
    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      router.push('/login');
      return;
    }

    const userStr = localStorage.getItem('tigerex_user');
    if (userStr) {
      try {
        const userData = JSON.parse(userStr);
        setUser(userData);
        setProfileData({
          username: userData.username || '',
          email: userData.email || '',
          phone: userData.phone || '',
        });
      } catch (e) {
        console.error('Failed to parse user data');
      }
    }
  }, [router]);

  // Handle profile update
  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setSuccess('Profile updated successfully!');
    setLoading(false);
  };

  // Handle password change
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (passwords.new !== passwords.confirm) {
      setError('New passwords do not match');
      return;
    }

    if (passwords.new.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setSuccess('Password changed successfully!');
    setPasswords({ current: '', new: '', confirm: '' });
    setLoading(false);
  };

  // Handle 2FA toggle
  const handle2FAToggle = async () => {
    if (!twoFactorEnabled) {
      // Would redirect to 2FA setup
      setSuccess('2FA setup initiated. Please use your authenticator app.');
    } else {
      setSuccess('2FA has been disabled.');
    }
    setTwoFactorEnabled(!twoFactorEnabled);
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('tigerex_token');
    localStorage.removeItem('tigerex_refresh_token');
    localStorage.removeItem('tigerex_token_expires');
    localStorage.removeItem('tigerex_user');
    router.push('/login');
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User className="w-5 h-5" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-5 h-5" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-5 h-5" /> },
    { id: 'api', label: 'API Keys', icon: <Key className="w-5 h-5" /> },
    { id: 'preferences', label: 'Preferences', icon: <Globe className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="h-16 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">T</span>
            </div>
            <span className="text-white font-bold">TigerEx</span>
          </Link>
        </div>
        <Link href="/dashboard" className="text-gray-400 hover:text-white">
          ← Back to Dashboard
        </Link>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-800 border-r border-gray-700 min-h-screen p-4">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-purple-600/20 text-purple-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          
          <div className="mt-8 pt-4 border-t border-gray-700">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Logout
            </button>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 p-6">
          {/* Success/Error Messages */}
          {success && (
            <div className="mb-6 flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg">
              <CheckCircle className="w-5 h-5" />
              {success}
            </div>
          )}
          {error && (
            <div className="mb-6 flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Profile Settings</h2>
                <p className="text-gray-400">Manage your account information</p>
              </div>

              <form onSubmit={handleProfileUpdate} className="space-y-6 max-w-xl">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-2xl font-bold text-white">
                    {profileData.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <p className="text-white font-medium">{profileData.username || 'User'}</p>
                    <p className="text-gray-400 text-sm">Member since {new Date().getFullYear()}</p>
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                  <input
                    type="text"
                    value={profileData.username}
                    onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                  <input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    placeholder="+1 (555) 000-0000"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  Save Changes
                </button>
              </form>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Security Settings</h2>
                <p className="text-gray-400">Manage your account security</p>
              </div>

              {/* Change Password */}
              <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6 max-w-xl">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  Change Password
                </h3>
                
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Current Password</label>
                    <div className="relative">
                      <input
                        type={showPasswords.current ? 'text' : 'password'}
                        value={passwords.current}
                        onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                        className="w-full px-4 py-3 pr-12 bg-gray-900 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        {showPasswords.current ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">New Password</label>
                    <div className="relative">
                      <input
                        type={showPasswords.new ? 'text' : 'password'}
                        value={passwords.new}
                        onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                        className="w-full px-4 py-3 pr-12 bg-gray-900 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        {showPasswords.new ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Confirm New Password</label>
                    <div className="relative">
                      <input
                        type={showPasswords.confirm ? 'text' : 'password'}
                        value={passwords.confirm}
                        onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                        className="w-full px-4 py-3 pr-12 bg-gray-900 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                      >
                        {showPasswords.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Lock className="w-5 h-5" />
                    Update Password
                  </button>
                </form>
              </div>

              {/* Two-Factor Auth */}
              <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6 max-w-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gray-700/50 rounded-lg">
                      <Smartphone className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">Two-Factor Authentication</h3>
                      <p className="text-gray-400 text-sm">Add an extra layer of security to your account</p>
                    </div>
                  </div>
                  <button
                    onClick={handle2FAToggle}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      twoFactorEnabled 
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {twoFactorEnabled ? 'Enabled' : 'Enable'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Notification Preferences</h2>
                <p className="text-gray-400">Choose how you want to be notified</p>
              </div>

              <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6 max-w-xl space-y-6">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Email Notifications
                </h3>
                
                {[
                  { key: 'emailOrders', label: 'Order updates', desc: 'Get notified about order status changes' },
                  { key: 'emailDeposits', label: 'Deposit confirmations', desc: 'Receive emails when deposits are confirmed' },
                  { key: 'emailWithdrawals', label: 'Withdrawal confirmations', desc: 'Receive emails when withdrawals are processed' },
                  { key: 'emailSecurity', label: 'Security alerts', desc: 'Important security notifications' },
                  { key: 'emailMarketing', label: 'Marketing emails', desc: 'Promotions and platform updates' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{item.label}</p>
                      <p className="text-gray-400 text-sm">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => setNotifications({ ...notifications, [item.key]: !notifications[item.key as keyof typeof notifications] })}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        notifications[item.key as keyof typeof notifications] ? 'bg-purple-600' : 'bg-gray-600'
                      }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                        notifications[item.key as keyof typeof notifications] ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* API Keys Tab */}
          {activeTab === 'api' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">API Keys</h2>
                  <p className="text-gray-400">Manage your API keys for external integrations</p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors">
                  <Key className="w-5 h-5" />
                  Create API Key
                </button>
              </div>

              <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6">
                <div className="text-center py-8">
                  <Key className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                  <p className="text-gray-400">No API keys yet</p>
                  <p className="text-gray-500 text-sm">Create your first API key to start integrating</p>
                </div>
              </div>
            </div>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Preferences</h2>
                <p className="text-gray-400">Customize your experience</p>
              </div>

              <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6 max-w-xl space-y-6">
                {/* Theme */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {preferences.theme === 'dark' ? <Moon className="w-5 h-5 text-purple-400" /> : <Sun className="w-5 h-5 text-yellow-400" />}
                    <div>
                      <p className="text-white font-medium">Theme</p>
                      <p className="text-gray-400 text-sm">Choose your preferred appearance</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPreferences({ ...preferences, theme: 'light' })}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        preferences.theme === 'light' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      Light
                    </button>
                    <button
                      onClick={() => setPreferences({ ...preferences, theme: 'dark' })}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        preferences.theme === 'dark' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      Dark
                    </button>
                  </div>
                </div>

                {/* Language */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Globe className="w-5 h-5 text-purple-400" />
                    <div>
                      <p className="text-white font-medium">Language</p>
                      <p className="text-gray-400 text-sm">Select your preferred language</p>
                    </div>
                  </div>
                  <select
                    value={preferences.language}
                    onChange={(e) => setPreferences({ ...preferences, language: e.target.value })}
                    className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="zh">中文</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                  </select>
                </div>

                {/* Fiat Currency */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <CreditCard className="w-5 h-5 text-purple-400" />
                    <div>
                      <p className="text-white font-medium">Fiat Currency</p>
                      <p className="text-gray-400 text-sm">Default currency for fiat transactions</p>
                    </div>
                  </div>
                  <select
                    value={preferences.fiatCurrency}
                    onChange={(e) => setPreferences({ ...preferences, fiatCurrency: e.target.value })}
                    className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                    <option value="KRW">KRW</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
