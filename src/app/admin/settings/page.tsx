'use client';

/**
 * Exchange settings. Values are read from the admin backend, which is the only
 * source of truth; every field is stored as a key/value pair.
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface SystemSetting {
  key: string;
  value: string;
  category: string;
  updated_at: string;
  updated_by: string;
}

interface Draft {
  [key: string]: string;
}

const BOOLEAN_KEYS = new Set([
  'maintenance_mode',
  'registration_enabled',
  'withdrawal_enabled',
  'trading_enabled',
  'p2p_enabled',
  'kyc_required_for_withdrawal',
]);

function label(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const authToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authToken();
      if (!token) {
        setError('Admin authentication is required. Sign in, then reload this page.');
        setSettings([]);
        return;
      }
      const response = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
        throw new Error(
          payload?.error?.message || payload?.error || `Unable to load settings (HTTP ${response.status}).`,
        );
      }
      const rows = payload.data as SystemSetting[];
      setSettings(rows);
      setDraft(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    } catch (cause) {
      setSettings([]);
      setError(cause instanceof Error ? cause.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (key: string) => {
    const value = draft[key] ?? '';
    setSavingKey(key);
    setError(null);
    setNotice(null);
    try {
      const token = authToken();
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ key, value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error?.message || payload?.error || 'The setting was not saved.');
      }
      setNotice(`${label(key)} updated.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The setting was not saved.');
    } finally {
      setSavingKey(null);
    }
  };

  const grouped = settings.reduce<Record<string, SystemSetting[]>>((acc, setting) => {
    (acc[setting.category] ??= []).push(setting);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Exchange Settings</h1>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading settings…</p>
        ) : settings.length === 0 && !error ? (
          <p className="text-sm text-gray-500">The backend returned no settings.</p>
        ) : (
          Object.entries(grouped).map(([category, rows]) => (
            <div key={category} className="mb-6 rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-lg font-semibold capitalize">{category}</h2>
              <div className="space-y-4">
                {rows.map((setting) => (
                  <div key={setting.key} className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-center">
                    <label className="text-sm font-medium" htmlFor={setting.key}>
                      {label(setting.key)}
                    </label>
                    <div className="sm:col-span-2 flex items-center gap-2">
                      {BOOLEAN_KEYS.has(setting.key) ? (
                        <select
                          id={setting.key}
                          className="w-full rounded-lg border px-3 py-2"
                          value={draft[setting.key] ?? ''}
                          onChange={(event) =>
                            setDraft({ ...draft, [setting.key]: event.target.value })
                          }
                        >
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      ) : (
                        <input
                          id={setting.key}
                          type="text"
                          className="w-full rounded-lg border px-3 py-2"
                          value={draft[setting.key] ?? ''}
                          onChange={(event) =>
                            setDraft({ ...draft, [setting.key]: event.target.value })
                          }
                        />
                      )}
                      <button
                        onClick={() => void save(setting.key)}
                        disabled={savingKey === setting.key || draft[setting.key] === setting.value}
                        className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingKey === setting.key ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
