'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Shield, Lock, Mail, Monitor, Plus, Trash2, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';
import { apiRequest, ApiError } from '@/lib/api/client-request';

interface SecuritySettings {
  two_factor_enabled?: boolean;
  anti_phishing_enabled?: boolean;
  withdrawal_whitelist_enabled?: boolean;
  login_alerts_enabled?: boolean;
  ip_whitelist_enabled?: boolean;
  anti_phishing_code?: string | null;
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

interface IpEntry {
  id: string;
  cidr: string;
  label?: string | null;
  created_at?: string;
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
  const ipAllowlist = useApiResource<unknown>('/api/user/ipAllowlist');

  const settings = (security.data && typeof security.data === 'object'
    ? ((security.data as Record<string, unknown>).data ?? security.data)
    : null) as SecuritySettings | null;

  const sessionList = useMemo(() => toArray<Session>(sessions.data), [sessions.data]);
  const apiKeyList = useMemo(() => toArray<ApiKey>(apiKeys.data), [apiKeys.data]);
  const ipList = useMemo(() => toArray<IpEntry>(ipAllowlist.data), [ipAllowlist.data]);
  const ipEnabled = Boolean(
    ipAllowlist.data && typeof ipAllowlist.data === 'object'
      ? (ipAllowlist.data as Record<string, unknown>).enabled
      : false,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [newCidr, setNewCidr] = useState('');

  const enabled = (option: (typeof OPTION_DEFS)[number]): boolean =>
    settings ? Boolean(settings[option.key]) : false;

  const run = useCallback(
    async (action: () => Promise<void>, notice: string) => {
      setBusy(true);
      setActionError(null);
      setActionNotice(null);
      try {
        await action();
        setActionNotice(notice);
      } catch (cause) {
        setActionError(cause instanceof ApiError ? cause.message : 'The action failed.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const toggleOption = (key: keyof SecuritySettings) =>
    run(async () => {
      await apiRequest('/api/user/security', { method: 'PUT', body: { [key]: !enabled({ key } as never) } });
      security.reload();
    }, 'Security setting updated.');

  const revokeSession = (sessionId: string) =>
    run(async () => {
      await apiRequest(`/api/user/sessions?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      sessions.reload();
    }, 'Device signed out.');

  const signOutOthers = () =>
    run(async () => {
      await apiRequest('/api/user/sessions', { method: 'POST', body: {} });
      sessions.reload();
    }, 'Other devices signed out.');

  const createKey = () =>
    run(async () => {
      const result = await apiRequest<{ apiKey: { apiSecret: string } }>('/api/user/apiKeys', {
        method: 'POST',
        body: { name: newKeyName.trim(), permissions: ['read', 'trade'] },
      });
      setNewKeySecret(result.apiKey.apiSecret);
      setNewKeyName('');
      apiKeys.reload();
    }, 'API key created. Copy the secret now; it will not be shown again.');

  const revokeKey = (keyId: string) =>
    run(async () => {
      await apiRequest(`/api/user/apiKeys?keyId=${encodeURIComponent(keyId)}`, { method: 'DELETE' });
      apiKeys.reload();
    }, 'API key revoked.');

  const addIpEntry = () =>
    run(async () => {
      await apiRequest('/api/user/ipAllowlist', {
        method: 'POST',
        body: { cidr: newCidr.trim() },
      });
      setNewCidr('');
      ipAllowlist.reload();
    }, 'IP address added to the allowlist.');

  const removeIpEntry = (entryId: string) =>
    run(async () => {
      await apiRequest(`/api/user/ipAllowlist?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      ipAllowlist.reload();
    }, 'IP address removed.');

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
        {actionError && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{actionError}</div>
        )}
        {actionNotice && (
          <div className="mb-4 rounded-lg bg-green-500/10 px-4 py-3 text-sm text-green-400">{actionNotice}</div>
        )}
        {newKeySecret && (
          <div className="mb-4 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            New API secret (shown once): <span className="font-mono break-all">{newKeySecret}</span>
          </div>
        )}

        {/* Security Options */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Security Settings</h2>
          {security.loading && <p className="text-sm text-gray-500">Loading settings…</p>}
          <div className="space-y-3">
            {OPTION_DEFS.map((option) => {
              const isEnabled = enabled(option);
              const toggleable = option.key !== 'two_factor_enabled';
              const stateLabel = security.loading ? '…' : isEnabled ? 'Enabled' : 'Disabled';
              const stateClass = isEnabled
                ? 'bg-green-500/20 text-green-500'
                : 'bg-gray-500/20 text-gray-400';
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
                  {toggleable ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={option.name}
                      disabled={busy || security.loading}
                      onClick={() => toggleOption(option.key)}
                      className={`text-xs px-3 py-1 rounded-full disabled:opacity-50 ${stateClass}`}
                    >
                      {stateLabel}
                    </button>
                  ) : (
                    // 2FA needs a password and a live code, so it is configured
                    // on its own page rather than toggled from a session alone.
                    <Link
                      href="/2fa"
                      className={`text-xs px-3 py-1 rounded-full ${stateClass}`}
                      aria-label={`${option.name}: ${stateLabel}. Open the 2FA settings.`}
                    >
                      {stateLabel} · Manage
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Login Devices */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Login Devices</h2>
            {sessionList.some((session) => !session.current) && (
              <button
                onClick={signOutOthers}
                disabled={busy}
                className="text-xs text-gray-400 hover:text-white disabled:opacity-50"
              >
                Sign out all other devices
              </button>
            )}
          </div>
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
                  <button
                    onClick={() => revokeSession(session.id)}
                    disabled={busy}
                    title="Sign out this device"
                    className="p-2 hover:bg-red-500/20 rounded-lg disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold">API Keys</h2>
            <div className="flex items-center gap-2">
              <input
                value={newKeyName}
                onChange={(event) => setNewKeyName(event.target.value)}
                placeholder="Key name"
                className="rounded bg-[#0A0A0F] px-3 py-1 text-sm text-white"
              />
              <button
                onClick={createKey}
                disabled={busy || newKeyName.trim().length === 0}
                className="inline-flex items-center gap-1 rounded bg-[#FF6B35] px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                <Plus className="w-3 h-3" /> Create
              </button>
            </div>
          </div>
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
                      onClick={() => revokeKey(key.id)}
                      disabled={busy}
                      title="Revoke this key"
                      className="p-2 hover:bg-red-500/20 rounded-lg disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 font-mono">
                  Key ID: {key.id}
                </p>
                <p className="text-xs text-gray-600">
                  The secret is shown once when the key is created and is never stored in plaintext.
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

        {/* Sign-in IP allowlist */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Allowed Sign-in IPs</h2>
              <p className="text-xs text-gray-500">
                {ipEnabled
                  ? 'Sign-in is restricted to the addresses below.'
                  : 'Turn on IP Whitelist above to restrict sign-in to these addresses.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={newCidr}
                onChange={(event) => setNewCidr(event.target.value)}
                placeholder="203.0.113.0/24"
                className="rounded bg-[#0A0A0F] px-3 py-1 text-sm text-white font-mono"
              />
              <button
                onClick={addIpEntry}
                disabled={busy || newCidr.trim().length === 0}
                className="inline-flex items-center gap-1 rounded bg-[#FF6B35] px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>
          {ipAllowlist.loading && <p className="text-sm text-gray-500">Loading allowlist…</p>}
          {ipAllowlist.error && (
            <p className="text-sm text-red-400">Could not load the allowlist: {ipAllowlist.error}</p>
          )}
          {!ipAllowlist.loading && !ipAllowlist.error && ipList.length === 0 && (
            <p className="text-sm text-gray-500">No addresses are allowlisted.</p>
          )}
          <div className="space-y-2">
            {ipList.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between p-3 bg-[#0A0A0F] rounded-lg">
                <div>
                  <p className="font-mono text-sm">{entry.cidr}</p>
                  {entry.label && <p className="text-xs text-gray-500">{entry.label}</p>}
                </div>
                <button
                  onClick={() => removeIpEntry(entry.id)}
                  disabled={busy}
                  title="Remove this address"
                  className="p-2 hover:bg-red-500/20 rounded-lg disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
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
