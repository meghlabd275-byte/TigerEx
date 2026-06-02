'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Wallet, ArrowUpRight, ArrowDownRight, Plus, Search, Filter, CreditCard, Lock, History, ExternalLink } from 'lucide-react';

// Wallet balance interface
interface WalletBalance {
  currency: string;
  available: number;
  locked: number;
  usdValue: number;
  icon?: string;
}

// Demo balances
const demoBalances: WalletBalance[] = [
  { currency: 'BTC', available: 1.5432, locked: 0.25, usdValue: 103834.75, icon: '₿' },
  { currency: 'USDT', available: 25430.50, locked: 1200, usdValue: 26630.50, icon: '$' },
  { currency: 'ETH', available: 12.543, locked: 1.2, usdValue: 43367.27, icon: 'Ξ' },
  { currency: 'BNB', available: 45.32, locked: 5, usdValue: 26285.60, icon: '⬡' },
  { currency: 'SOL', available: 234.5, locked: 20, usdValue: 34180.70, icon: '◎' },
  { currency: 'XRP', available: 15000, locked: 0, usdValue: 7845.00, icon: '✕' },
];

// Transaction interface
interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'trade' | 'transfer';
  currency: string;
  amount: number;
  status: 'completed' | 'pending' | 'failed';
  date: string;
  hash?: string;
}

const demoTransactions: Transaction[] = [
  { id: '1', type: 'trade', currency: 'BTC/USDT', amount: 0.5, status: 'completed', date: '2026-06-01 14:32' },
  { id: '2', type: 'deposit', currency: 'ETH', amount: 5.0, status: 'completed', date: '2026-06-01 10:15', hash: '0x1234...' },
  { id: '3', type: 'withdrawal', currency: 'USDT', amount: -5000, status: 'pending', date: '2026-05-31 18:45' },
  { id: '4', type: 'trade', currency: 'ETH/USDT', amount: 2.0, status: 'completed', date: '2026-05-30 09:20' },
  { id: '5', type: 'deposit', currency: 'BTC', amount: 0.25, status: 'completed', date: '2026-05-29 16:30', hash: '0xabcd...' },
];

export default function WalletPage() {
  const [balances, setBalances] = useState(demoBalances);
  const [transactions, setTransactions] = useState(demoTransactions);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Calculate totals
  const totalAvailable = balances.reduce((sum, b) => sum + b.usdValue, 0);
  const totalLocked = balances.reduce((sum, b) => sum + (b.locked * 0), 0); // Simplified

  // Format currency
  const formatCurrency = (currency: string) => {
    return currency === 'USDT' ? 'USDT' : currency;
  };

  // Get currency icon
  const getCurrencyIcon = (currency: string) => {
    const balance = balances.find(b => b.currency === currency);
    return balance?.icon || currency[0];
  };

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0d0d1a]/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <span className="text-lg font-bold">T</span>
              </div>
            </Link>
            <h1 className="text-xl font-bold">Wallet</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Link href="/wallet/deposit" className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm hover:bg-green-500/30">
              <ArrowDownRight className="h-4 w-4" />
              Deposit
            </Link>
            <Link href="/wallet/withdraw" className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">
              <ArrowUpRight className="h-4 w-4" />
              Withdraw
            </Link>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Total Balance Card */}
        <div className="bg-gradient-to-r from-orange-500/20 to-purple-500/20 rounded-xl p-6 border border-white/10">
          <div className="text-gray-400 text-sm mb-1">Total Assets</div>
          <div className="text-3xl font-bold">${totalAvailable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
            <span>Available: ${totalAvailable.toLocaleString()}</span>
            <span>|</span>
            <span>Locked: ${totalLocked.toLocaleString()}</span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: ArrowDownRight, label: 'Deposit', href: '/wallet/deposit', color: 'text-green-400' },
            { icon: ArrowUpRight, label: 'Withdraw', href: '/wallet/withdraw', color: 'text-orange-400' },
            { icon: CreditCard, label: 'Buy Crypto', href: '/buy', color: 'text-blue-400' },
            { icon: History, label: 'History', href: '/wallet/history', color: 'text-purple-400' },
          ].map((action, i) => (
            <Link
              key={i}
              href={action.href}
              className="flex flex-col items-center gap-1 p-3 bg-white/5 rounded-lg hover:bg-white/10"
            >
              <action.icon className={`h-5 w-5 ${action.color}`} />
              <span className="text-xs">{action.label}</span>
            </Link>
          ))}
        </div>

        {/* Balances */}
        <div className="bg-[#0d0d1a] rounded-xl border border-white/10">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h2 className="font-semibold">Assets</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-sm w-40"
              />
            </div>
          </div>

          <div className="divide-y divide-white/5">
            {balances.filter(b => !searchQuery || b.currency.toLowerCase().includes(searchQuery.toLowerCase())).map((balance) => (
              <div
                key={balance.currency}
                className="flex items-center justify-between p-4 hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold">
                    {getCurrencyIcon(balance.currency)}
                  </div>
                  <div>
                    <div className="font-medium">{balance.currency}</div>
                    <div className="text-xs text-gray-500">
                      {balance.available.toLocaleString()} available
                      {balance.locked > 0 && ` • ${balance.locked.toLocaleString()} locked`}
                    </div>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="font-medium">${balance.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-gray-500">
                    {balance.available.toLocaleString()} {balance.currency}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-[#0d0d1a] rounded-xl border border-white/10">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h2 className="font-semibold">Recent Transactions</h2>
            <Link href="/wallet/history" className="text-xs text-orange-500 hover:underline">
              View All
            </Link>
          </div>

          <div className="divide-y divide-white/5">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-4 hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.type === 'deposit' ? 'bg-green-500/20 text-green-400' :
                    tx.type === 'withdrawal' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {tx.type === 'deposit' ? <ArrowDownRight className="h-4 w-4" /> :
                     tx.type === 'withdrawal' ? <ArrowUpRight className="h-4 w-4" /> :
                     <CreditCard className="h-4 w-4" />}
                  </div>
                  <div>
                    <div className="font-medium capitalize">{tx.type} {tx.currency}</div>
                    <div className="text-xs text-gray-500">
                      {tx.date}
                      {tx.hash && ` • ${tx.hash}`}
                    </div>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className={`font-medium ${
                    tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount} {tx.currency}
                  </div>
                  <div className={`text-xs ${
                    tx.status === 'completed' ? 'text-green-400' :
                    tx.status === 'pending' ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {tx.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}