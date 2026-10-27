'use client';

import React, { useMemo, useState } from 'react';
import { Shield, Lock, Mail, Monitor, Trash2, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface SecuritySettings {
  two_factor_enabled?: boolean;
  anti_phishing_enabled?: boolean;
  withdrawal_whitelist_enabled?: boolean;
  login_alerts_enabled?: boolean;
  ip_whitelist_enabled?: boolean;
  password_changed_at?: string;
}

interface Session {
  id: string;
  device?: string;
  user_agent?: string;
  location?: string;
  ip?: string;
  ip_address?: string;
  last_active?: string;
  created_at?: string;
  current?: boolean;
}

interface ApiKey {
  id: string;
  name?: string;
  label?: string;
  permissions?: string[] | string;
  created_at?: string;
  last_used_at?: string;
}

const OPTION_DEFS: {
  key: keyof SecuritySettings;
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'two_factor_enabled',
    id: '2fa',
    name: 'Two-Factor Authentication',
    description: 'Add an extra layer of security',
    icon: <Shield className="w-5 h-5" />,
  },
  {
    key: 'anti_phishing_enabled',
    id: 'anti-phishing',
    name: 'Anti-Phishing Code',
    description: 'Verify authentic emails',
    icon: <Mail className="w-5 h-5" />,
  },
  {
    key: 'withdrawal_whitelist_enabled',
    id: 'withdrawal-whitelist',
    name: 'Withdrawal Whitelist',
    description: 'Only withdraw to approved addresses',
    icon: <Lock className="w-5 h-5" />,
  },
  {
    key: 'login_alerts_enabled',
    id: 'login-alerts',
    name: 'Login Alerts',
    description: 'Get notified of new logins',
    icon: <Mail className="w-5 h-5" />,
  },
  {
    key: 'ip_whitelist_enabled',
    id: 'ip-whitelist',
    name: 'IP Whitelist',
    description: 'Restrict access to IP addresses',
    icon: <Shield className="w-5 h-5" />,
  },
];

function formatDate(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function permissionsLabel(permissions?: string[] | string): string {
  if (!permissions) return '—';
  return Array.isArray(permissions) ? permissions.join(', ') : permissions;
}

export default function SecurityPage() {
  const security = useApiResource<unknown>('/api/user/security');
  const sessions = useApiResource<unknown>('/api/user/sessions');
  const apiKeys = useApiResource<unknown>('/api/user/apiKeys');

  const settings = (security.data && typeof security.data === 'object'
    ? ((security.data as Record<string, unknown>).data ?? security.data)
    : null) as SecuritySettings | null;

  const sessionList = useMemo(() => toArray<Session>(sessions.data), [sessions.data]);
  const apiKeyList = useMemo(() => toArray<ApiKey>(apiKeys.data), [apiKeys.data]);

  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const enabled = (option: (typeof OPTION_DEFS)[number]): boolean =>
    settings ? Boolean(settings[option.key]) : false;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Security</h1>
          <button
            onClick={security.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <p className="text-gray-400 mb-6">Manage your account security settings</p>

        {security.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load security settings: {security.error}
          </div>
        )}

        {/* Security Options */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Security Settings</h2>
          {security.loading && <p className="text-sm text-gray-500">Loading settings…</p>}
          <div className="space-y-3">
            {OPTION_DEFS.map((option) => {
              const isEnabled = enabled(option);
              return (
                <div
                  key={option.id}
                  className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#FF6B35]/20 flex items-center justify-center">
                      <span className="text-[#FF6B35]">{option.icon}</span>
                    </div>
                    <div>
                      <p className="font-medium">{option.name}</p>
                      <p className="text-xs text-gray-500">{option.description}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-3 py-1 rounded-full ${
                      isEnabled ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {security.loading ? '…' : isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Login Devices */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Login Devices</h2>
          {sessions.loading && <p className="text-sm text-gray-500">Loading devices…</p>}
          {sessions.error && (
            <p className="text-sm text-red-400">Could not load devices: {sessions.error}</p>
          )}
          {!sessions.loading && !sessions.error && sessionList.length === 0 && (
            <p className="text-sm text-gray-500">No active sessions.</p>
          )}
          <div className="space-y-3">
            {sessionList.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-4 bg-[#0A0A0F] rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <Monitor className="w-5 h-5 text-gray-500" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {session.device || session.user_agent || 'Unknown device'}
                      </p>
                      {session.current && (
                        <span className="text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {[session.location, session.ip || session.ip_address, formatDate(session.last_active || session.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
                {!session.current && (
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
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          {apiKeys.loading && <p className="text-sm text-gray-500">Loading API keys…</p>}
          {apiKeys.error && (
            <p className="text-sm text-red-400">Could not load API keys: {apiKeys.error}</p>
          )}
          {!apiKeys.loading && !apiKeys.error && apiKeyList.length === 0 && (
            <p className="text-sm text-gray-500">You have no API keys.</p>
          )}
          <div className="space-y-3">
            {apiKeyList.map((key) => (
              <div key={key.id} className="p-4 bg-[#0A0A0F] rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">{key.name || key.label || key.id}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRevealedKey(revealedKey === key.id ? null : key.id)}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      {revealedKey === key.id ? 'Hide' : 'Show'}
                    </button>
                    <button className="p-2 hover:bg-red-500/20 rounded-lg">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 font-mono">
                  {revealedKey === key.id ? key.id : '••••••••••••••••'}
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span>Permissions: {permissionsLabel(key.permissions)}</span>
                  <span>Created: {formatDate(key.created_at)}</span>
                  <span>Last used: {formatDate(key.last_used_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {settings?.two_factor_enabled && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3 mb-6">
            <Shield className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-green-500 font-medium">2FA is enabled</p>
              <p className="text-xs text-gray-400">
                Your account is protected with two-factor authentication
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
