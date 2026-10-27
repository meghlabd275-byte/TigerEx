'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface OTCQuote {
  id: string;
  asset?: string;
  side?: string;
  amount?: number;
  quotePrice?: number;
  quote_price?: number;
  finalPrice?: number;
  fee?: number;
  status?: string;
  expiresAt?: number;
  createdAt?: number;
}

interface OTCQuoteResponse {
  success?: boolean;
  error?: string;
}

function formatPrice(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatTime(value: number | undefined): string {
  if (!value) return '—';
  // Unix seconds are the convention used by the institutional service.
  const ms = value < 1e12 ? value * 1000 : value;
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export default function OTCPage() {
  const history = useApiResource<unknown>('/api/otc/history');
  const quotes = useMemo(() => toArray<OTCQuote>(history.data), [history.data]);

  const [asset, setAsset] = useState('BTC');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const requestQuote = async () => {
    setResult(null);
    setSubmitting(true);
    try {
      const token =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('token') || window.localStorage.getItem('auth_token')
          : null;
      const response = await fetch(
        `/api/otc/quote?symbol=${encodeURIComponent(asset)}&amount=${encodeURIComponent(amount)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }
      );
      const data = (await response.json()) as OTCQuoteResponse & Partial<OTCQuote>;
      if (response.ok && data.success !== false) {
        setResult({
          ok: true,
          message: `Quote received: ${formatPrice(data.quotePrice ?? data.quote_price)} ${
            data.id ? `(id ${data.id})` : ''
          }`,
        });
        history.reload();
      } else {
        setResult({ ok: false, message: data.error || 'Could not obtain a quote.' });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Could not obtain a quote.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">OTC Trading</h1>
            <p className="text-gray-400">
              Request block quotes for large orders without moving the book
            </p>
          </div>
          <button
            onClick={history.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* Quote request */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Request a Quote</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0A0A0F] px-4 py-2.5 text-sm"
            >
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="USDT">USDT</option>
              <option value="USDC">USDC</option>
            </select>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}
              className="rounded-lg border border-white/10 bg-[#0A0A0F] px-4 py-2.5 text-sm"
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              className="rounded-lg border border-white/10 bg-[#0A0A0F] px-4 py-2.5 text-sm"
            />
            <button
              onClick={requestQuote}
              disabled={submitting || !(Number(amount) > 0)}
              className="rounded-lg bg-[#FF6B35] px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            >
              {submitting ? 'Requesting…' : 'Get Quote'}
            </button>
          </div>

          {result && (
            <div
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}
            >
              {result.message}
            </div>
          )}
        </div>

        {/* Quote history */}
        <div className="bg-[#14141A] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Quote History</h2>
          {history.loading && <p className="text-sm text-gray-500">Loading quotes…</p>}
          {history.error && (
            <p className="text-sm text-red-400">Could not load quotes: {history.error}</p>
          )}
          {!history.loading && !history.error && quotes.length === 0 && (
            <p className="text-sm text-gray-500">No OTC quotes requested yet.</p>
          )}
          {quotes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.1)]">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Side</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Asset</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">Amount</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">Quote Price</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">Fee</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Status</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="border-b border-[rgba(255,255,255,0.05)]">
                      <td className="py-3 px-4 capitalize">{quote.side ?? '—'}</td>
                      <td className="py-3 px-4">{quote.asset ?? '—'}</td>
                      <td className="py-3 px-4 text-right">
                        {quote.amount?.toLocaleString() ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatPrice(quote.quotePrice ?? quote.quote_price)}
                      </td>
                      <td className="py-3 px-4 text-right">{formatPrice(quote.fee)}</td>
                      <td className="py-3 px-4 capitalize text-gray-400">{quote.status ?? '—'}</td>
                      <td className="py-3 px-4 text-gray-400">{formatTime(quote.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
