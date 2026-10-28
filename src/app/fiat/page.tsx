'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface FiatProvider {
  id?: string;
  name?: string;
  logo?: string | null;
  paymentMethods?: string[];
  minLimit?: number;
  maxLimit?: number;
  feePercent?: number;
}

interface FiatOrder {
  orderId?: string;
  direction?: string;
  fiatCurrency?: string;
  cryptoCurrency?: string;
  fiatAmount?: number;
  cryptoAmount?: number | null;
  fee?: number;
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

export default function FiatPage() {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [fiat, setFiat] = useState('USD');
  const [crypto, setCrypto] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const providersRes = useApiResource<unknown>('/api/fiat/paymentMethods');
  const ordersRes = useApiResource<unknown>('/api/fiat/orders?limit=10');

  const providers = toArray<FiatProvider>(providersRes.data);
  const orders = toArray<FiatOrder>(ordersRes.data);

  const placeOrder = async (providerId?: string) => {
    const numeric = parseFloat(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setResult({ ok: false, message: 'Enter a valid amount first' });
      return;
    }
    setPlacing(true);
    setResult(null);
    try {
      const token =
        localStorage.getItem('tigerex_access_token') || localStorage.getItem('admin_token');
      const response = await fetch('/api/fiat/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          direction,
          fiatCurrency: fiat,
          cryptoCurrency: crypto,
          fiatAmount: numeric,
          providerId,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Could not place the order');
      }
      setResult({ ok: true, message: 'Order placed. It will settle once the provider confirms payment.' });
      setAmount('');
      ordersRes.reload();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Could not place the order' });
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Fiat Gateway</h1>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setDirection('buy')}
            className={`flex-1 py-3 rounded-lg font-semibold ${direction === 'buy' ? 'bg-green-600 text-white' : 'bg-white border'}`}
          >
            Buy Crypto
          </button>
          <button
            onClick={() => setDirection('sell')}
            className={`flex-1 py-3 rounded-lg font-semibold ${direction === 'sell' ? 'bg-red-600 text-white' : 'bg-white border'}`}
          >
            Sell Crypto
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Fiat Currency</label>
              <select
                className="w-full px-3 py-2 border rounded-lg"
                value={fiat}
                onChange={(e) => setFiat(e.target.value)}
              >
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="JPY">JPY - Japanese Yen</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Crypto</label>
              <select
                className="w-full px-3 py-2 border rounded-lg"
                value={crypto}
                onChange={(e) => setCrypto(e.target.value)}
              >
                <option value="USDT">USDT</option>
                <option value="USDC">USDC</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input
                type="number"
                className="w-full px-3 py-2 border rounded-lg"
                placeholder={`Amount in ${fiat}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {result && (
            <p className={`mt-3 text-sm ${result.ok ? 'text-green-700' : 'text-red-600'}`}>
              {result.message}
            </p>
          )}
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Available Providers</h2>
          {providersRes.loading ? (
            <p className="text-sm text-gray-500">Loading providers…</p>
          ) : providersRes.error ? (
            <div className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
              <span>{providersRes.error}</span>
              <button onClick={providersRes.reload} className="flex items-center gap-1">
                <RefreshCw className="w-4 h-4" /> Retry
              </button>
            </div>
          ) : providers.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-sm text-gray-500">
              No fiat providers are configured. Fiat on/off-ramp will appear here once a provider
              contract is live.
            </div>
          ) : (
            <div className="space-y-4">
              {providers.map((provider) => (
                <div key={provider.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{provider.logo ?? '💳'}</span>
                      <div>
                        <div className="font-semibold">{provider.name}</div>
                        <div className="text-sm text-gray-500">
                          {(provider.paymentMethods ?? []).join(', ')}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-green-600">{provider.feePercent ?? 0}%</div>
                      <div className="text-sm text-gray-500">fee</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm text-gray-500 mb-3">
                    <span>
                      Limit: {provider.minLimit ?? 0} - {(provider.maxLimit ?? 0).toLocaleString()} {fiat}
                    </span>
                  </div>
                  <button
                    onClick={() => placeOrder(provider.id)}
                    disabled={placing}
                    className={`w-full py-2 rounded-lg font-semibold text-white disabled:opacity-50 ${
                      direction === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {direction === 'buy' ? 'Buy' : 'Sell'} with {provider.name}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
          {ordersRes.loading ? (
            <p className="text-sm text-gray-500">Loading transactions…</p>
          ) : ordersRes.error ? (
            <p className="text-sm text-red-600">{ordersRes.error}</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-gray-500">No fiat transactions yet.</p>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div key={order.orderId} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium">
                      {order.direction === 'sell'
                        ? `${order.cryptoAmount ?? '—'} ${order.cryptoCurrency} → ${order.fiatAmount} ${order.fiatCurrency}`
                        : `${order.fiatAmount} ${order.fiatCurrency} → ${order.cryptoAmount ?? '—'} ${order.cryptoCurrency}`}
                    </div>
                    <div className="text-sm text-gray-500">
                      {order.createdAt ? new Date(order.createdAt).toLocaleString() : '—'}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      order.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {order.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
