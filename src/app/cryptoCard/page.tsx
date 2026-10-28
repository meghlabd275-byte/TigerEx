'use client';

import { useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface CardRecord {
  cardId?: string;
  type?: string;
  brand?: string;
  last4?: string | null;
  currency?: string;
  status?: string;
}

interface CardListData {
  cards?: CardRecord[];
  monthSpend?: number;
  cashback?: number;
  activeCards?: number;
}

interface CardTransaction {
  transactionId?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  cashback?: number;
  status?: string;
  createdAt?: string;
  last4?: string | null;
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

function money(value: number | undefined, currency = 'USD'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

export default function CryptoCardPage() {
  const [cardType, setCardType] = useState('virtual');
  const [currency, setCurrency] = useState('USDT');
  const [submitting, setSubmitting] = useState(false);
  const [orderMessage, setOrderMessage] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  const list = useApiResource<unknown>('/api/card/list');
  const transactions = useApiResource<unknown>('/api/card/transactions?limit=10');

  const listData = unwrap<CardListData>(list.data);
  const cards = listData?.cards ?? [];
  const txns = toArray<CardTransaction>(transactions.data);

  const orderCard = async () => {
    setSubmitting(true);
    setOrderMessage(null);
    setOrderError(null);
    try {
      const response = await fetch('/api/card/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardType, currency }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || body?.error || 'Could not submit card request');
      }
      setOrderMessage('Card request submitted. It will appear here once issued.');
      list.reload();
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Could not submit card request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">TigerEx Card</h1>

        {list.error && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
            <span>{list.error}</span>
            <button
              onClick={list.reload}
              className="flex items-center gap-1 rounded border border-red-400 px-3 py-1.5 hover:bg-red-100"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Spend (Month)</div>
            <div className="text-2xl font-bold">
              {list.loading ? '—' : money(listData?.monthSpend ?? 0)}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Cashback Earned</div>
            <div className="text-2xl font-bold text-green-600">
              {list.loading ? '—' : money(listData?.cashback ?? 0)}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Active Cards</div>
            <div className="text-2xl font-bold">{list.loading ? '—' : listData?.activeCards ?? 0}</div>
          </div>
        </div>

        {cards.length === 0 && !list.loading ? (
          <div className="bg-white p-8 rounded-lg shadow mb-6 text-center text-gray-500">
            <CreditCard className="w-10 h-10 mx-auto mb-3 text-gray-400" />
            You have no cards yet. Order one below.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {cards.map((card) => (
              <div
                key={card.cardId}
                className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-6 text-white"
              >
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <div className="text-sm opacity-75">TigerEx Card</div>
                    <div className="text-xl font-bold capitalize">{card.type ?? '—'}</div>
                  </div>
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <span className="text-lg">🐯</span>
                  </div>
                </div>
                <div className="text-2xl font-mono mb-4">
                  {card.last4 ? `•••• •••• •••• ${card.last4}` : '•••• •••• •••• ••••'}
                </div>
                <div className="flex justify-between">
                  <div>
                    <div className="text-xs opacity-75">Currency</div>
                    <div className="font-semibold">{card.currency ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs opacity-75">Status</div>
                    <div className="font-semibold capitalize">{card.status ?? '—'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Order New Card</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Card Type</label>
              <select
                className="w-full px-3 py-2 border rounded-lg"
                value={cardType}
                onChange={(e) => setCardType(e.target.value)}
              >
                <option value="virtual">Virtual Card (Instant)</option>
                <option value="physical">Physical Card (5-7 days)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Spending Currency</label>
              <select
                className="w-full px-3 py-2 border rounded-lg"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="USDT">USDT</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
          <button
            onClick={orderCard}
            disabled={submitting}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Order Card'}
          </button>
          {orderMessage && <p className="mt-3 text-sm text-green-700">{orderMessage}</p>}
          {orderError && <p className="mt-3 text-sm text-red-600">{orderError}</p>}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
          {transactions.loading ? (
            <p className="text-sm text-gray-500">Loading transactions…</p>
          ) : transactions.error ? (
            <p className="text-sm text-red-600">{transactions.error}</p>
          ) : txns.length === 0 ? (
            <p className="text-sm text-gray-500">No card transactions yet.</p>
          ) : (
            <div className="space-y-3">
              {txns.map((tx, i) => {
                const amount = tx.amount ?? 0;
                const isCredit = amount >= 0;
                return (
                  <div key={tx.transactionId ?? i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-5 h-5 text-gray-400" />
                      <div>
                        <div className="font-medium">{tx.merchant ?? 'Unknown merchant'}</div>
                        <div className="text-sm text-gray-500">
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '—'}
                          {tx.last4 ? ` · ••••${tx.last4}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className={`font-semibold ${isCredit ? 'text-green-600' : ''}`}>
                      {isCredit ? '+' : '-'}
                      {money(Math.abs(amount), tx.currency ?? 'USD')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
