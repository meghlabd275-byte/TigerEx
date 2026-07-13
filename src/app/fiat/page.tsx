'use client';

import { useState } from 'react';

interface FiatProvider {
  id: string;
  name: string;
  logo: string;
  paymentMethods: string[];
  minLimit: number;
  maxLimit: number;
  fee: string;
}

export default function FiatPage() {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [fiat, setFiat] = useState('USD');
  const [crypto, setCrypto] = useState('USDT');
  const [amount, setAmount] = useState('');

  const providers: FiatProvider[] = [
    { id: '1', name: 'Simplex', logo: '💳', paymentMethods: ['Credit Card', 'Debit Card'], minLimit: 50, maxLimit: 20000, fee: '3.5%' },
    { id: '2', name: 'MoonPay', logo: '🌙', paymentMethods: ['Credit Card', 'Bank Transfer'], minLimit: 20, maxLimit: 50000, fee: '2.5%' },
    { id: '3', name: 'Transak', logo: '🔄', paymentMethods: ['Credit Card', 'SEPA', 'FPS'], minLimit: 30, maxLimit: 100000, fee: '2%' },
  ];

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
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
                <option value="BNB">BNB</option>
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
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Available Providers</h2>
          <div className="space-y-4">
            {providers.map((provider) => (
              <div key={provider.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{provider.logo}</span>
                    <div>
                      <div className="font-semibold">{provider.name}</div>
                      <div className="text-sm text-gray-500">
                        {provider.paymentMethods.join(', ')}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-green-600">{provider.fee}</div>
                    <div className="text-sm text-gray-500">fee</div>
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm text-gray-500 mb-3">
                  <span>Limit: {provider.minLimit} - {provider.maxLimit.toLocaleString()} {fiat}</span>
                </div>
                <button className={`w-full py-2 rounded-lg font-semibold ${
                  direction === 'buy' ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'
                }`}>
                  {direction === 'buy' ? 'Buy' : 'Sell'} with {provider.name}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
          <div className="space-y-3">
            {[
              { type: 'buy', amount: '500 USD → 500 USDT', provider: 'Simplex', status: 'completed', date: 'Today' },
              { type: 'buy', amount: '1000 EUR → 1000 USDT', provider: 'MoonPay', status: 'completed', date: 'Yesterday' },
              { type: 'sell', amount: '200 USDT → 200 USD', provider: 'Transak', status: 'pending', date: 'Jan 12' },
            ].map((tx, i) => (
              <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium">{tx.amount}</div>
                  <div className="text-sm text-gray-500">{tx.provider} · {tx.date}</div>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  tx.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {tx.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
