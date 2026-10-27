'use client';

import React, { useMemo, useState } from 'react';
import { Search, Download, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Clock } from 'lucide-react';
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
  txid?: string;
  hash?: string;
}

const SOURCES = [
  { path: '/api/deposit/history', type: 'deposit' },
  { path: '/api/withdraw/history', type: 'withdraw' },
  { path: '/api/trades/history', type: 'trade' },
  { path: '/api/wallet/transfers', type: 'transfer' },
];

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
  const raw = tx.created_at || tx.time;
  if (!raw) return '—';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
}

export default function WalletHistoryPage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const history = useMergedResource<Transaction>(SOURCES.map((s) => s.path));

  const transactions = useMemo(() => {
    const list = history.data ?? [];
    return list.map((tx, index) => ({
      ...tx,
      id: tx.id || tx.txid || tx.hash || `tx-${index}`,
      _type: (tx.type || 'unknown').toLowerCase(),
    }));
  }, [history.data]);

  const filtered = transactions.filter((tx) => {
    const matchesFilter = filter === 'all' || tx._type === filter;
    const symbol = txSymbol(tx).toLowerCase();
    return matchesFilter && (search === '' || symbol.includes(search.toLowerCase()));
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownLeft className="h-4 w-4 text-green-400" />;
      case 'withdraw':
        return <ArrowUpRight className="h-4 w-4 text-red-400" />;
      case 'transfer':
        return <ArrowLeftRight className="h-4 w-4 text-blue-400" />;
      default:
        return <Clock className="h-4 w-4 text-[#FF6B35]" />;
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
    link.download = 'tigerex-wallet-history.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-white">Transaction History</h1>
            <p className="text-sm text-gray-400">
              {history.loading ? 'Loading…' : `${filtered.length} transactions`}
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>

        {history.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load transaction history: {history.error}
          </div>
        )}

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by coin..."
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-9 pr-4 text-sm text-white focus:border-tiger-orange focus:outline-none"
          />
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
          {['all', 'deposit', 'withdraw', 'trade', 'transfer'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm capitalize ${
                filter === f ? 'bg-tiger-orange text-white' : 'bg-white/5 text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map((tx) => (
            <div
              key={tx.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tiger-black">
                    {getIcon(tx._type)}
                  </div>
                  <div>
                    <p className="font-medium capitalize text-white">
                      {tx._type} {txSymbol(tx)}
                    </p>
                    <p className="text-xs text-gray-500">{txDate(tx)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-white">{txAmount(tx)}</p>
                  <span className="text-xs text-gray-400">{tx.status ?? 'unknown'}</span>
                </div>
              </div>
              {(tx.network || tx.txid || tx.hash) && (
                <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-sm text-gray-500">
                  <span>{tx.network ? `Network: ${tx.network}` : ''}</span>
                  {(tx.txid || tx.hash) && <span className="font-mono">{tx.txid || tx.hash}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        {!history.loading && !history.error && filtered.length === 0 && (
          <div className="py-12 text-center text-gray-500">
            <Clock className="mx-auto mb-3 h-12 w-12 opacity-50" />
            <p>No transactions found</p>
          </div>
        )}
      </div>
    </div>
  );
}
