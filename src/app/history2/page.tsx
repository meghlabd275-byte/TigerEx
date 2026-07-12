'use client';

import React, { useState } from 'react';
import { Search, Filter, Download, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Clock, Check, X, ExternalLink } from 'lucide-react';

const TRANSACTIONS = [
  { id: 'tx1', type: 'deposit', symbol: 'USDT', amount: '1,500.00', status: 'completed', network: 'TRC20', date: '2024-01-15 14:32', hash: '0x1234...5678' },
  { id: 'tx2', type: 'withdraw', symbol: 'ETH', amount: '0.5', status: 'completed', network: 'Ethereum', date: '2024-01-14 09:15', hash: '0xabcd...efgh' },
  { id: 'tx3', type: 'buy', symbol: 'TGR', amount: '250.00', status: 'completed', pair: 'TGR/USDT', date: '2024-01-13 18:45', hash: 'order_123' },
  { id: 'tx4', type: 'sell', symbol: 'BTC', amount: '0.025', status: 'completed', pair: 'BTC/USDT', date: '2024-01-12 11:20', hash: 'order_456' },
  { id: 'tx5', type: 'transfer', symbol: 'USDC', amount: '500.00', status: 'pending', network: 'Polygon', date: '2024-01-11 16:00', hash: '0xxyz...999' },
  { id: 'tx6', type: 'swap', symbol: 'ETH → USDT', amount: '2.5', status: 'completed', date: '2024-01-10 20:30', hash: 'swap_789' },
  { id: 'tx7', type: 'deposit', symbol: 'BTC', amount: '0.1', status: 'completed', network: 'Bitcoin', date: '2024-01-09 08:00', hash: 'bc1q...abc' },
  { id: 'tx8', type: 'withdraw', symbol: 'SOL', amount: '25', status: 'failed', network: 'Solana', date: '2024-01-08 14:00', hash: 'sol...xyz' },
];

export default function TransactionHistory() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filteredTransactions = TRANSACTIONS.filter(tx => {
    const matchesFilter = filter === 'all' || tx.type === filter;
    const matchesSearch = search === '' || tx.symbol.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'deposit': return <ArrowDownLeft className="w-4 h-4 text-green-500" />;
      case 'withdraw': return <ArrowUpRight className="w-4 h-4 text-red-500" />;
      case 'buy': return <ArrowDownLeft className="w-4 h-4 text-green-500" />;
      case 'sell': return <ArrowUpRight className="w-4 h-4 text-red-500" />;
      case 'swap': return <ArrowLeftRight className="w-4 h-4 text-blue-500" />;
      case 'transfer': return <ArrowLeftRight className="w-4 h-4 text-yellow-500" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-500 bg-green-500/10';
      case 'pending': return 'text-yellow-500 bg-yellow-500/10';
      case 'failed': return 'text-red-500 bg-red-500/10';
      default: return 'text-gray-500 bg-gray-500/10';
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Transaction History</h1>
            <p className="text-gray-400">{filteredTransactions.length} transactions</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-[#14141A] rounded-lg hover:bg-[#1E1E24]">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>

        {/* Search & Filter */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by symbol..." 
              className="w-full bg-[#14141A] rounded-lg py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:border-[#FF6B35]" />
          </div>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {['all', 'deposit', 'withdraw', 'buy', 'sell', 'swap', 'transfer'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm capitalize whitespace-nowrap ${filter === f ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Transactions List */}
        <div className="space-y-2">
          {filteredTransactions.map(tx => (
            <div key={tx.id} className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#0A0A0F] flex items-center justify-center">
                    {getIcon(tx.type)}
                  </div>
                  <div>
                    <p className="font-medium capitalize">{tx.type} {tx.symbol}</p>
                    <p className="text-xs text-gray-500">{tx.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">{tx.amount} {tx.symbol.includes('→') ? '' : ''}</p>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(tx.status)}`}>
                    {tx.status}
                  </span>
                </div>
              </div>
              {tx.network && (
                <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.05)] flex items-center justify-between text-sm text-gray-500">
                  <span>Network: {tx.network}</span>
                  {tx.hash && <span className="font-mono">{tx.hash}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        {filteredTransactions.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No transactions found</p>
          </div>
        )}
      </div>
    </div>
  );
}
