'use client';

import { useState } from 'react';

export default function ConvertPage() {
  const [fromAsset, setFromAsset] = useState('USDT');
  const [toAsset, setToAsset] = useState('BTC');
  const [amount, setAmount] = useState('');
  const [converting, setConverting] = useState(false);

  const handleConvert = async () => {
    setConverting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/convert/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fromAsset, toAsset, amount }),
      });
      const data = await response.json();
      if (data.success) {
        alert('Conversion completed successfully');
      }
    } catch (error) {
      console.error('Conversion failed:', error);
    } finally {
      setConverting(false);
    }
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
                <option value="USDT">USDT</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
                <option value="BNB">BNB</option>
                <option value="USDC">USDC</option>
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
            <button className="p-2 bg-gray-100 rounded-full">
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
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="BNB">BNB</option>
              <option value="USDT">USDT</option>
              <option value="USDC">USDC</option>
            </select>
          </div>

          <div className="p-4 bg-gray-50 rounded-lg mb-6">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Exchange Rate</span>
              <span>1 {fromAsset} ≈ 0.000023 {toAsset}</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-gray-500">Fee (0.1%)</span>
              <span>{amount ? (parseFloat(amount) * 0.001).toFixed(4) : '0'} {fromAsset}</span>
            </div>
          </div>

          <button
            onClick={handleConvert}
            disabled={converting || !amount}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {converting ? 'Converting...' : 'Convert'}
          </button>
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-4">Recent Conversions</h2>
          <div className="bg-white rounded-lg shadow divide-y">
            {[
              { from: '100 USDT', to: '0.0023 BTC', time: '2 hours ago' },
              { from: '0.5 ETH', to: '850 USDT', time: '5 hours ago' },
              { from: '200 USDT', to: '0.0046 BTC', time: '1 day ago' },
            ].map((item, i) => (
              <div key={i} className="p-4">
                <div className="font-medium">{item.from} → {item.to}</div>
                <div className="text-sm text-gray-500">{item.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
