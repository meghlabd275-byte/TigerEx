'use client';

import { useState } from 'react';

export default function CryptoCardPage() {
  const [cardType, setCardType] = useState('virtual');
  const [currency, setCurrency] = useState('USDT');

  const cards = [
    { id: '1', type: 'virtual', last4: '4521', currency: 'USDT', status: 'active', balance: 1500 },
    { id: '2', type: 'physical', last4: '8832', currency: 'USD', status: 'active', balance: 2500 },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">TigerEx Card</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Spend (Month)</div>
            <div className="text-2xl font-bold">$3,250</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Cashback Earned</div>
            <div className="text-2xl font-bold text-green-600">$48.50</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Active Cards</div>
            <div className="text-2xl font-bold">{cards.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {cards.map((card) => (
            <div key={card.id} className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-6 text-white">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <div className="text-sm opacity-75">TigerEx Card</div>
                  <div className="text-xl font-bold">{card.type === 'virtual' ? 'Virtual' : 'Physical'}</div>
                </div>
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <span className="text-lg">🐯</span>
                </div>
              </div>
              <div className="text-2xl font-mono mb-4">•••• •••• •••• {card.last4}</div>
              <div className="flex justify-between">
                <div>
                  <div className="text-xs opacity-75">Balance</div>
                  <div className="font-semibold">${card.balance.toLocaleString()} {card.currency}</div>
                </div>
                <div>
                  <div className="text-xs opacity-75">Status</div>
                  <div className="font-semibold capitalize">{card.status}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

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
          <button className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Order Card
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
          <div className="space-y-3">
            {[
              { merchant: 'Amazon', amount: '- $45.99', date: 'Today', icon: '🛒' },
              { merchant: 'Netflix', amount: '- $15.99', date: 'Yesterday', icon: '🎬' },
              { merchant: 'Apple Store', amount: '- $199.00', date: 'Jan 12', icon: '🍎' },
              { merchant: 'Cashback', amount: '+$2.30', date: 'Jan 11', icon: '💰' },
            ].map((tx, i) => (
              <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{tx.icon}</span>
                  <div>
                    <div className="font-medium">{tx.merchant}</div>
                    <div className="text-sm text-gray-500">{tx.date}</div>
                  </div>
                </div>
                <div className={`font-semibold ${tx.amount.startsWith('+') ? 'text-green-600' : ''}`}>
                  {tx.amount}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
