'use client';

import React, { useMemo, useState } from 'react';
import {
  Search,
  Download,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Clock,
} from 'lucide-react';
import { useMergedResource } from '@/lib/useApiResource';

interface Transaction {
  id: string;
  type?: string;
  symbol?: string;
  coin?: string;
  asset?: string;
  amount?: number | string;
  status?: string;
  network?: string;
  created_at?: string;
  time?: string;
  date?: string;
  txid?: string;
  hash?: string;
}

const SOURCES = [
  { path: '/api/deposit/history', type: 'deposit' },
  { path: '/api/withdraw/history', type: 'withdraw' },
  { path: '/api/trades/history', type: 'trade' },
  { path: '/api/transfer/history', type: 'transfer' },
];

function txType(tx: Transaction, fallback: string): string {
  return (tx.type || fallback).toLowerCase();
}

function txSymbol(tx: Transaction): string {
  return tx.symbol || tx.coin || tx.asset || '—';
}

function txAmount(tx: Transaction): string {
  if (tx.amount === undefined || tx.amount === null) return '—';
  const numeric = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
  if (!Number.isFinite(numeric)) return String(tx.amount);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function txDate(tx: Transaction): string {
  const raw = tx.created_at || tx.time || tx.date;
  if (!raw) return '—';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
}

export default function TransactionHistory() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const history = useMergedResource<Transaction>(SOURCES.map((s) => s.path));
  const typeByPath = useMemo(
    () => Object.fromEntries(SOURCES.map((s) => [s.path, s.type])),
    []
  );

  const transactions = useMemo(() => {
    const list = history.data ?? [];
    return list.map((tx, index) => ({
      ...tx,
      id: tx.id || tx.txid || tx.hash || `${typeByPath}-${index}`,
      _type: txType(tx, 'unknown'),
    }));
  }, [history.data, typeByPath]);

  const filtered = transactions.filter((tx) => {
    const matchesFilter = filter === 'all' || tx._type === filter;
    const symbol = txSymbol(tx).toLowerCase();
    return matchesFilter && (search === '' || symbol.includes(search.toLowerCase()));
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownLeft className="w-4 h-4 text-green-500" />;
      case 'withdraw':
        return <ArrowUpRight className="w-4 h-4 text-red-500" />;
      case 'trade':
      case 'buy':
      case 'sell':
        return <ArrowLeftRight className="w-4 h-4 text-blue-500" />;
      case 'transfer':
        return <ArrowLeftRight className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch ((status || '').toLowerCase()) {
      case 'completed':
      case 'success':
      case 'filled':
        return 'text-green-500 bg-green-500/10';
      case 'pending':
      case 'processing':
        return 'text-yellow-500 bg-yellow-500/10';
      case 'failed':
      case 'rejected':
        return 'text-red-500 bg-red-500/10';
      default:
        return 'text-gray-500 bg-gray-500/10';
    }
  };

  const exportCsv = () => {
    const header = ['id', 'type', 'symbol', 'amount', 'status', 'network', 'date'];
    const rows = filtered.map((tx) => [
      tx.id,
      tx._type,
      txSymbol(tx),
      txAmount(tx),
      tx.status ?? '',
      tx.network ?? '',
      txDate(tx),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tigerex-transactions.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Transaction History</h1>
            <p className="text-gray-400">
              {history.loading ? 'Loading…' : `${filtered.length} transactions`}
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#14141A] rounded-lg hover:bg-[#1E1E24] disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>

        {history.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load transaction history: {history.error}
          </div>
        )}

        {/* Search & Filter */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by symbol..."
              className="w-full bg-[#14141A] rounded-lg py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:border-[#FF6B35]"
            />
          </div>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {['all', 'deposit', 'withdraw', 'trade', 'transfer'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm capitalize whitespace-nowrap ${
                filter === f ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Transactions List */}
        <div className="space-y-2">
          {filtered.map((tx) => (
            <div
              key={tx.id}
              className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#0A0A0F] flex items-center justify-center">
                    {getIcon(tx._type)}
                  </div>
                  <div>
                    <p className="font-medium capitalize">
                      {tx._type} {txSymbol(tx)}
                    </p>
                    <p className="text-xs text-gray-500">{txDate(tx)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">{txAmount(tx)}</p>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(tx.status)}`}>
                    {tx.status ?? 'unknown'}
                  </span>
                </div>
              </div>
              {tx.network && (
                <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between text-sm text-gray-500">
                  <span>Network: {tx.network}</span>
                  {(tx.txid || tx.hash) && (
                    <span className="font-mono">{tx.txid || tx.hash}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {!history.loading && !history.error && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No transactions found</p>
          </div>
        )}
      </div>
    </div>
  );
}
