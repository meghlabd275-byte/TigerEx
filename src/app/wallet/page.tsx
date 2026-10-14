'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, CreditCard, History, RefreshCw, Search } from 'lucide-react';
import { api, walletService } from '@/lib/api/client';
import type { Transaction, Wallet } from '@/lib/api/types';

function decimal(value: string | number | undefined): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

export default function WalletPage() {
  const [balances, setBalances] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [wallets, history] = await Promise.all([walletService.getBalances(), walletService.getHistory({ page: 1, limit: 10 })]);
      setBalances(wallets ?? []);
      setTransactions(history?.items ?? []);
    } catch (cause) {
      setBalances([]); setTransactions([]);
      setError(cause instanceof Error ? cause.message : 'Wallet data is unavailable.');
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    if (!api.getToken()) { setError('Sign in to view your wallet.'); setLoading(false); return; }
    void load();
  }, []);

  const filteredBalances = useMemo(() => balances.filter((wallet) => !searchQuery || wallet.currency.toLowerCase().includes(searchQuery.toLowerCase())), [balances, searchQuery]);
  const totalAvailable = balances.reduce((sum, wallet) => sum + decimal(wallet.available_balance), 0);
  const totalLocked = balances.reduce((sum, wallet) => sum + decimal(wallet.locked_balance), 0);

  return (
    <main className="min-h-screen bg-[#0a0a14] text-white">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/10 bg-[#0d0d1a]/95 px-4 backdrop-blur-md">
        <div className="flex items-center gap-4"><Link href="/" className="text-xl font-bold">TigerEx</Link><h1 className="font-semibold">Wallet</h1></div>
        <div className="flex items-center gap-2"><button onClick={() => { setRefreshing(true); void load(); }} disabled={refreshing} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh</button><Link href="/wallet/deposit" className="rounded-lg bg-green-500/20 px-3 py-1.5 text-sm text-green-300">Deposit</Link><Link href="/wallet/withdraw" className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm">Withdraw</Link></div>
      </header>
      <section className="space-y-4 p-4">
        {error && <div role="alert" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">{error}</div>}
        <div className="rounded-xl border border-white/10 bg-gradient-to-r from-orange-500/20 to-purple-500/20 p-6"><div className="text-sm text-gray-400">Total available assets (native units)</div><div className="mt-1 text-3xl font-bold">{loading ? '—' : totalAvailable.toLocaleString()}</div><div className="mt-2 text-sm text-gray-400">Locked: {loading ? '—' : totalLocked.toLocaleString()}</div></div>
        <div className="grid grid-cols-4 gap-2">{[ ['/wallet/deposit', ArrowDownRight, 'Deposit'], ['/wallet/withdraw', ArrowUpRight, 'Withdraw'], ['/buy', CreditCard, 'Buy Crypto'], ['/wallet/history', History, 'History'] ].map(([href, Icon, label]) => <Link key={String(href)} href={String(href)} className="flex flex-col items-center gap-1 rounded-lg bg-white/5 p-3 text-xs hover:bg-white/10"><Icon size={18} />{String(label)}</Link>)}</div>
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d1a]"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><h2 className="font-semibold">Assets</h2><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search assets" className="w-40 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-sm" /></div></div>{loading ? <p className="p-6 text-sm text-gray-500">Loading verified wallet balances…</p> : filteredBalances.length === 0 ? <p className="p-6 text-sm text-gray-500">No wallet balances are available from the configured custody service.</p> : <div className="divide-y divide-white/5">{filteredBalances.map((wallet) => <div key={`${wallet.wallet_type}:${wallet.currency}`} className="flex items-center justify-between p-4"><div><div className="font-medium">{wallet.currency}</div><div className="text-xs text-gray-500">{wallet.wallet_type} · {wallet.deposit_enabled ? 'deposits enabled' : 'deposits unavailable'}</div></div><div className="text-right"><div>{wallet.available_balance} available</div><div className="text-xs text-gray-500">{wallet.locked_balance} locked</div></div></div>)}</div>}</section>
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d1a]"><div className="border-b border-white/10 px-4 py-3"><h2 className="font-semibold">Recent transactions</h2></div>{transactions.length === 0 ? <p className="p-6 text-sm text-gray-500">No verified transaction history is available.</p> : <div className="divide-y divide-white/5">{transactions.map((transaction) => <div key={transaction.id} className="flex items-center justify-between p-4 text-sm"><div><div className="capitalize">{transaction.type} · {transaction.currency}</div><div className="text-xs text-gray-500">{new Date(transaction.created_at).toLocaleString()} · {transaction.status}</div></div><div className="text-right">{transaction.amount} {transaction.currency}<div className="text-xs text-gray-500">{transaction.tx_hash ?? 'No chain hash'}</div></div></div>)}</div>}</section>
      </section>
    </main>
  );
}
