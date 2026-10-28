'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface FeeConfig {
  id: string;
  type?: string;
  asset?: string;
  network?: string;
  fee_type?: string;
  fee_amount?: number;
  min_fee?: number;
  max_fee?: number;
  updated_at?: string;
  updated_by?: string;
}

function formatFee(config: FeeConfig): string {
  const amount = config.fee_amount;
  if (amount === undefined || amount === null) return '—';
  if (config.fee_type === 'percentage') return `${amount}%`;
  return `${amount} ${config.asset || ''}`.trim();
}

export default function AdminFeesPage() {
  const fees = useApiResource<unknown>('/api/admin/fees');
  const configs = useMemo(() => toArray<FeeConfig>(fees.data), [fees.data]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (config: FeeConfig) => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) {
      setMessage({ ok: false, text: 'Enter a non-negative fee amount.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined'
          ? localStorage.getItem('tigerex_admin_token') || localStorage.getItem('admin_token')
          : null;
      const response = await fetch('/api/admin/fees', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: config.id, updates: { fee_amount: value } }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success !== false) {
        setMessage({ ok: true, text: 'Fee configuration updated.' });
        setEditingId(null);
        fees.reload();
      } else {
        setMessage({
          ok: false,
          text: body?.error?.message || body?.error || 'Could not update the fee configuration.',
        });
      }
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'Could not update the fee configuration.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Fee Configuration</h1>
          <button
            onClick={fees.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              message.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}

        {fees.loading && <p className="text-sm text-gray-500">Loading fee configurations…</p>}
        {fees.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Fee configuration is unavailable: {fees.error}
          </div>
        )}

        {!fees.loading && !fees.error && configs.length === 0 && (
          <div className="rounded-lg border bg-white px-4 py-8 text-center text-gray-500">
            No fee configurations are defined.
          </div>
        )}

        {configs.length > 0 && (
          <div className="overflow-hidden rounded-lg bg-white shadow">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Asset</th>
                  <th className="px-6 py-3">Network</th>
                  <th className="px-6 py-3">Fee</th>
                  <th className="px-6 py-3">Updated By</th>
                  <th className="px-6 py-3">Updated At</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {configs.map((config) => (
                  <tr key={config.id}>
                    <td className="px-6 py-4">{config.type || '—'}</td>
                    <td className="px-6 py-4">{config.asset || '—'}</td>
                    <td className="px-6 py-4">{config.network || '—'}</td>
                    <td className="px-6 py-4">
                      {editingId === config.id ? (
                        <input
                          type="number"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className="w-28 rounded border px-2 py-1"
                        />
                      ) : (
                        formatFee(config)
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{config.updated_by || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{config.updated_at || '—'}</td>
                    <td className="px-6 py-4">
                      {editingId === config.id ? (
                        <button
                          onClick={() => save(config)}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                        >
                          <Save className="h-3 w-3" /> Save
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingId(config.id);
                            setDraft(String(config.fee_amount ?? ''));
                          }}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
