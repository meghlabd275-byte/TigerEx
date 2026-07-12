'use client';

import React, { useState } from 'react';
import { Shield, Key, Smartphone, Mail, Eye, EyeOff, Check, X, AlertTriangle, Lock, Wifi, Monitor, Trash2 } from 'lucide-react';

const SECURITY_OPTIONS = [
  { id: '2fa', name: 'Two-Factor Authentication', description: 'Add an extra layer of security', enabled: true, icon: <Smartphone className="w-5 h-5" /> },
  { id: 'anti-phishing', name: 'Anti-Phishing Code', description: 'Verify authentic emails', enabled: false, icon: <Shield className="w-5 h-5" /> },
  { id: 'withdrawal-whitelist', name: 'Withdrawal Whitelist', description: 'Only withdraw to approved addresses', enabled: false, icon: <Lock className="w-5 h-5" /> },
  { id: 'login-alerts', name: 'Login Alerts', description: 'Get notified of new logins', enabled: true, icon: <Mail className="w-5 h-5" /> },
  { id: 'ip-whitelist', name: 'IP Whitelist', description: 'Restrict access to IP addresses', enabled: false, icon: <Wifi className="w-5 h-5" /> },
];

const LOGIN_DEVICES = [
  { id: 1, device: 'Chrome on Windows', location: 'New York, US', ip: '192.168.1.xxx', lastActive: 'Active now', current: true },
  { id: 2, device: 'Safari on iPhone', location: 'New York, US', ip: '192.168.1.xxx', lastActive: '2 hours ago', current: false },
  { id: 3, device: 'Firefox on MacOS', location: 'Los Angeles, US', ip: '10.0.0.xxx', lastActive: '3 days ago', current: false },
];

const API_KEYS = [
  { id: 1, name: 'Trading Bot', key: 'tk_live_xxxx...xxxx1234', permissions: 'Read, Trade', created: '2024-01-10', lastUsed: '1 hour ago' },
  { id: 2, name: 'Portfolio App', key: 'tk_live_xxxx...xxxx5678', permissions: 'Read Only', created: '2024-01-05', lastUsed: '2 days ago' },
];

export default function SecurityPage() {
  const [enabledOptions, setEnabledOptions] = useState(['2fa', 'login-alerts']);
  const [showApiKey, setShowApiKey] = useState<number | null>(null);

  const toggleOption = (id: string) => {
    if (enabledOptions.includes(id)) {
      setEnabledOptions(enabledOptions.filter(o => o !== id));
    } else {
      setEnabledOptions([...enabledOptions, id]);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Security</h1>
        <p className="text-gray-400 mb-6">Manage your account security settings</p>

        {/* Security Options */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Security Settings</h2>
          <div className="space-y-3">
            {SECURITY_OPTIONS.map(option => (
              <div key={option.id} className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#FF6B35]/20 flex items-center justify-center">
                    <span className="text-[#FF6B35]">{option.icon}</span>
                  </div>
                  <div>
                    <p className="font-medium">{option.name}</p>
                    <p className="text-xs text-gray-500">{option.description}</p>
                  </div>
                </div>
                <button onClick={() => toggleOption(option.id)}
                  className={`w-12 h-6 rounded-full transition ${enabledOptions.includes(option.id) ? 'bg-green-500' : 'bg-gray-600'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full transition ${enabledOptions.includes(option.id) ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Password */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Password</h2>
          <div className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg">
            <div>
              <p className="font-medium">Account Password</p>
              <p className="text-xs text-gray-500">Last changed 30 days ago</p>
            </div>
            <button className="px-4 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg text-sm">
              Change Password
            </button>
          </div>
        </div>

        {/* Login Devices */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Login Devices</h2>
          <div className="space-y-3">
            {LOGIN_DEVICES.map(device => (
              <div key={device.id} className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg">
                <div className="flex items-center gap-4">
                  <Monitor className="w-5 h-5 text-gray-500" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{device.device}</p>
                      {device.current && <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded">Current</span>}
                    </div>
                    <p className="text-xs text-gray-500">{device.location} · {device.ip} · {device.lastActive}</p>
                  </div>
                </div>
                {!device.current && (
                  <button className="p-2 hover:bg-red-500/20 rounded-lg">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">API Keys</h2>
            <button className="px-4 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg text-sm">
              Create API Key
            </button>
          </div>
          <div className="space-y-3">
            {API_KEYS.map(key => (
              <div key={key.id} className="p-4 bg-[#0A0A0F] rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">{key.name}</p>
                  <button className="p-2 hover:bg-red-500/20 rounded-lg">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
                <p className="text-sm text-gray-500 font-mono">{showApiKey === key.id ? key.key : '••••••••••••••••'}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span>Permissions: {key.permissions}</span>
                  <span>Created: {key.created}</span>
                  <span>Last used: {key.lastUsed}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2FA Setup */}
        {enabledOptions.includes('2fa') && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3 mb-6">
            <Check className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-green-500 font-medium">2FA is enabled</p>
              <p className="text-xs text-gray-400">Your account is protected with two-factor authentication</p>
            </div>
          </div>
        )}

        {/* Danger Zone */}
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-red-500 mb-4">Danger Zone</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg">
              <div>
                <p className="font-medium">Close Account</p>
                <p className="text-xs text-gray-500">Permanently delete your account and all data</p>
              </div>
              <button className="px-4 py-2 border border-red-500 text-red-500 hover:bg-red-500/20 rounded-lg text-sm">
                Close Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
