'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';

interface TokensResponse {
  tokens: Array<{
    symbol: string;
    name: string;
    decimals: number;
    chain: string;
    contractAddress: string | null;
    coingeckoId: string | null;
    priceFeed: string | null;
    tags: string[];
    verified: boolean;
    spam: boolean;
    status: string;
  }>;
}

const EMPTY = {
  symbol: '',
  name: '',
  decimals: '18',
  chain: 'tigerex',
  contractAddress: '',
  coingeckoId: '',
  priceFeed: '',
  tags: '',
};

export default function AdminDexTokensPage() {
  const tokens = useApiResource<TokensResponse>('/api/admin/dex/tokens');
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = tokens.data?.tokens ?? [];

  const payload = () => ({
    symbol: form.symbol,
    name: form.name,
    decimals: Number(form.decimals),
    chain: form.chain,
    contractAddress: form.contractAddress || null,
    coingeckoId: form.coingeckoId || null,
    priceFeed: form.priceFeed || null,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  });

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/tokens', { method: 'POST', body: payload() });
      setMessage({ ok: true, text: `${form.symbol} listed.` });
      setForm({ ...EMPTY });
      tokens.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not list the token.' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (symbol: string, field: 'verified' | 'spam', next: boolean) => {
    const token = rows.find((row) => row.symbol === symbol);
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/tokens', {
        method: 'PUT',
        body: {
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          chain: token.chain,
          contractAddress: token.contractAddress,
          coingeckoId: token.coingeckoId,
          priceFeed: token.priceFeed,
          tags: token.tags,
          verified: field === 'verified' ? next : token.verified,
          spam: field === 'spam' ? next : token.spam,
          status: token.status,
        },
      });
      setMessage({ ok: true, text: `${symbol} updated.` });
      tokens.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not update the token.' });
    } finally {
      setBusy(false);
    }
  };

  const delist = async (symbol: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/dex/tokens?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      setMessage({ ok: true, text: `${symbol} delisted.` });
      tokens.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not delist the token.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Token listing"
      subtitle="List a token, mark it verified or spam, and delist it. A token that is in a live pool must be removed from the pool first."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="List a token">
          <Field label="Symbol" value={form.symbol} onChange={(value) => setForm((f) => ({ ...f, symbol: value.toUpperCase() }))} />
          <Field label="Name" value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <Field label="Decimals" type="number" value={form.decimals} onChange={(value) => setForm((f) => ({ ...f, decimals: value }))} />
          <Field label="Chain" value={form.chain} onChange={(value) => setForm((f) => ({ ...f, chain: value }))} />
          <Field
            label="Contract address (optional)"
            value={form.contractAddress}
            onChange={(value) => setForm((f) => ({ ...f, contractAddress: value }))}
            placeholder="0x… or base58"
          />
          <Field label="CoinGecko id (optional)" value={form.coingeckoId} onChange={(value) => setForm((f) => ({ ...f, coingeckoId: value }))} />
          <Field label="Price feed (optional)" value={form.priceFeed} onChange={(value) => setForm((f) => ({ ...f, priceFeed: value }))} />
          <Field label="Tags (comma separated)" value={form.tags} onChange={(value) => setForm((f) => ({ ...f, tags: value }))} />
          <button
            onClick={create}
            disabled={busy || !form.symbol || !form.name}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            List token
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Listed tokens">
            {tokens.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading tokens…</p>}
            {tokens.error && <p className="text-sm text-red-600 dark:text-red-400">{tokens.error}</p>}
            {!tokens.loading && rows.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">No token is listed.</p>
            )}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Symbol</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Name</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Chain</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Flags</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((token) => (
                      <tr key={token.symbol}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{token.symbol}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{token.name}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{token.chain}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{token.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {token.verified && <span className="mr-1 rounded bg-blue-100 px-1 text-xs text-blue-700">verified</span>}
                          {token.spam && <span className="rounded bg-red-100 px-1 text-xs text-red-700">spam</span>}
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => toggle(token.symbol, 'verified', !token.verified)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              {token.verified ? 'Unverify' : 'Verify'}
                            </button>
                            <button
                              onClick={() => toggle(token.symbol, 'spam', !token.spam)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              {token.spam ? 'Unflag' : 'Flag spam'}
                            </button>
                            <button
                              onClick={() => delist(token.symbol)}
                              disabled={busy || token.status === 'delisted'}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              Delist
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminDexShell>
  );
}
