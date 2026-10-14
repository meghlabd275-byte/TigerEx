'use client';

import { useCallback, useEffect, useState } from 'react';

interface APIKey {
  id: string;
  userId: string;
  keyId: string;
  name: string;
  permissions: string[];
  ipWhitelist: string[];
  rateLimit: number;
  status: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const ADMIN_API_BASE = (process.env.NEXT_PUBLIC_ADMIN_API_URL || '').replace(/\\/$/, '');

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function AdminAPIPage() {
  const [apiKeys, setAPIKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAPIKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined'
        ? (localStorage.getItem('tigerex_admin_token') ||
           localStorage.getItem('tigerex_access_token') ||
           localStorage.getItem('tigerex_token'))
        : null;
      if (!token) {
        setAPIKeys([]);
        setError('Admin authentication is required. Sign in to the admin console, then reload this page.');
        return;
      }

      const response = await fetch(`${ADMIN_API_BASE}/admin/api-keys`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
        throw new Error(payload?.error?.message || payload?.error || `Unable to load API keys (HTTP ${response.status}).`);
      }
      setAPIKeys(payload.data as APIKey[]);
    } catch (cause) {
      setAPIKeys([]);
      setError(cause instanceof Error ? cause.message : 'Unable to load API keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAPIKeys(); }, [loadAPIKeys]);

  const revokeKey = async (key: APIKey) => {
    if (key.status.toLowerCase() === 'revoked') return;
    if (!window.confirm(`Revoke API key “${key.name}”? This action cannot be undone.`)) return;

    const token = localStorage.getItem('tigerex_admin_token') ||
      localStorage.getItem('tigerex_access_token') ||
      localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Admin authentication is required.');
      return;
    }

    setBusyKey(key.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `${ADMIN_API_BASE}/admin/api-keys/${encodeURIComponent(key.id)}/revoke`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          cache: 'no-store',
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error?.message || payload?.error || `Unable to revoke key (HTTP ${response.status}).`);
      }
      setNotice(`API key “${key.name}” was revoked by the server.`);
      await loadAPIKeys();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke API key.');
    } finally {
      setBusyKey(null);
    }
  };

  const activeCount = apiKeys.filter(key => key.status.toLowerCase() === 'active').length;

  return (
    <main className="min-h-screen bg-gray-950 p-4 text-gray-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">API Key Management</h1>
            <p className="mt-1 text-sm text-gray-400">
              Live records from the authenticated admin API. Secret key material is never displayed here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAPIKeys()}
            disabled={loading}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-200">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">API keys returned by server</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? '—' : apiKeys.length}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Active keys</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{loading ? '—' : activeCount}</p>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-5 py-4">
            <h2 className="font-semibold">Registered API keys</h2>
          </div>
          {loading ? (
            <p className="p-8 text-center text-sm text-gray-400">Loading records from the server…</p>
          ) : apiKeys.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              No API key records were returned. This is not a usage metric; no sample records are inserted.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-950/60 text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Name / ID</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Permissions</th>
                    <th className="px-4 py-3">Rate limit</th>
                    <th className="px-4 py-3">Last used</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {apiKeys.map(key => (
                    <tr key={key.id} className="align-top hover:bg-gray-800/40">
                      <td className="px-4 py-4">
                        <div className="font-medium">{key.name}</div>
                        <div className="mt-1 font-mono text-xs text-gray-500">{key.keyId || key.id}</div>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-gray-400">{key.userId || '—'}</td>
                      <td className="px-4 py-4">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {(key.permissions || []).map(permission => (
                            <span key={permission} className="rounded bg-gray-800 px-2 py-1 text-xs">{permission}</span>
                          ))}
                        </div>
                        {key.ipWhitelist?.length > 0 && (
                          <p className="mt-2 text-xs text-gray-500">{key.ipWhitelist.length} IP allowlisted</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums">{key.rateLimit}/min</td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-400">{formatDate(key.lastUsedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-gray-400">{formatDate(key.createdAt)}</td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-2 py-1 text-xs ${key.status.toLowerCase() === 'active' ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}`}>
                          {key.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => void revokeKey(key)}
                          disabled={key.status.toLowerCase() === 'revoked' || busyKey === key.id}
                          className="rounded border border-red-900 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyKey === key.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <p className="text-xs text-gray-500">
          Key creation is intentionally not offered here because the current admin API exposes listing and revocation, but no verified creation endpoint.
        </p>
      </div>
    </main>
  );
}
