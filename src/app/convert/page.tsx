'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

const ASSETS = ['USDT', 'USDC', 'RUSD', 'BTC', 'ETH', 'BNB', 'TGR'];

interface ConvertQuote {
  fromAsset?: string;
  toAsset?: string;
  fromAmount?: number;
  rate?: number;
  fee?: number;
  feeAsset?: string;
  toAmount?: number;
}

interface ConvertRecord {
  transactionId?: string;
  amount?: number;
  fee?: number;
  currency?: string;
  memo?: string | null;
  status?: string;
  createdAt?: string;
}

function unwrap<T>(payload: unknown): T | null {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as Record<string, unknown>).data as T;
  }
  return (payload as T) ?? null;
}

function toArray<T>(payload: unknown): T[] {
  const inner = unwrap<unknown>(payload);
  if (Array.isArray(inner)) return inner as T[];
  if (Array.isArray(payload)) return payload as T[];
  return [];
}

export default function ConvertPage() {
  const [fromAsset, setFromAsset] = useState('USDT');
  const [toAsset, setToAsset] = useState('BTC');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<ConvertQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const history = useApiResource<unknown>('/api/convert/trade?limit=20');
  const conversions = toArray<ConvertRecord>(history.data);

  // Re-quote whenever the inputs change. The rate is always the server's,
  // never computed in the browser from a hardcoded number.
  useEffect(() => {
    const numeric = parseFloat(amount);
    if (!amount || !Number.isFinite(numeric) || numeric <= 0 || fromAsset === toAsset) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    const controller = new AbortController();
    setQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(() => {
      fetch(`/api/convert/quote?fromAsset=${fromAsset}&toAsset=${toAsset}&amount=${numeric}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(body?.error?.message || 'Quote unavailable');
          }
          setQuote(unwrap<ConvertQuote>(body));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : 'Quote unavailable');
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoting(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fromAsset, toAsset, amount]);

  const handleConvert = async () => {
    const numeric = parseFloat(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setConverting(true);
    setResult(null);
    try {
      const token =
        localStorage.getItem('tigerex_access_token') || localStorage.getItem('admin_token');
      const response = await fetch('/api/convert/trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fromAsset, toAsset, amount: numeric }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Conversion failed');
      }
      const done = unwrap<ConvertQuote>(body);
      setResult(
        `Converted ${done?.fromAmount} ${done?.fromAsset} to ${done?.toAmount?.toFixed(8)} ${done?.toAsset}`,
      );
      setAmount('');
      history.reload();
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const rateLabel = () => {
    if (quoting) return 'Fetching…';
    if (quoteError) return quoteError;
    if (!quote || quote.rate === undefined) return '—';
    return `1 ${fromAsset} ≈ ${quote.rate.toLocaleString(undefined, { maximumSignificantDigits: 8 })} ${toAsset}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Convert</h1>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">From</label>
            <div className="flex gap-2">
              <select
                className="px-3 py-2 border rounded-lg"
                value={fromAsset}
                onChange={(e) => setFromAsset(e.target.value)}
              >
                {ASSETS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <input
                type="number"
                className="flex-1 px-3 py-2 border rounded-lg"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-center mb-4">
            <button
              type="button"
              onClick={() => {
                setFromAsset(toAsset);
                setToAsset(fromAsset);
              }}
              className="p-2 bg-gray-100 rounded-full"
              aria-label="Swap assets"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">To</label>
            <select
              className="w-full px-3 py-2 border rounded-lg"
              value={toAsset}
              onChange={(e) => setToAsset(e.target.value)}
            >
              {ASSETS.filter((a) => a !== fromAsset).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Exchange Rate</span>
              <span className={quoteError ? 'text-red-600' : ''}>{rateLabel()}</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-gray-500">Fee (0.1%)</span>
              <span>
                {quote?.fee !== undefined ? `${quote.fee.toFixed(8)} ${fromAsset}` : '—'}
              </span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-gray-500">You Receive</span>
              <span>
                {quote?.toAmount !== undefined
                  ? `${quote.toAmount.toFixed(8)} ${toAsset}`
                  : '—'}
              </span>
            </div>
          </div>

          <button
            onClick={handleConvert}
            disabled={converting || !quote || quoting}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {converting ? 'Converting...' : 'Convert'}
          </button>
          {result && <p className="mt-3 text-sm text-gray-700">{result}</p>}
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-4">Recent Conversions</h2>
          <div className="bg-white rounded-lg shadow divide-y">
            {history.loading ? (
              <div className="p-4 text-sm text-gray-500">Loading conversions…</div>
            ) : history.error ? (
              <div className="p-4 flex items-center justify-between text-sm text-red-600">
                <span>{history.error}</span>
                <button onClick={history.reload} className="flex items-center gap-1">
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
              </div>
            ) : conversions.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No conversions yet.</div>
            ) : (
              conversions.map((item) => (
                <div key={item.transactionId} className="p-4">
                  <div className="font-medium">{item.memo ?? 'Conversion'}</div>
                  <div className="text-sm text-gray-500">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'} · {item.status ?? ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
