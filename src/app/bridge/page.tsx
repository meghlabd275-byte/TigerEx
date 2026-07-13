'use client';

import { useState } from 'react';

interface BridgeRoute {
  from: string;
  to: string;
  fee: string;
  time: string;
  minAmount: string;
}

export default function BridgePage() {
  const [fromChain, setFromChain] = useState('ETH');
  const [toChain, setToChain] = useState('BSC');
  const [amount, setAmount] = useState('');
  const [bridging, setBridging] = useState(false);

  const routes: BridgeRoute[] = [
    { from: 'ETH', to: 'BSC', fee: '0.1%', time: '5-10 min', minAmount: '0.01' },
    { from: 'ETH', to: 'Polygon', fee: '0.1%', time: '5-10 min', minAmount: '0.01' },
    { from: 'BSC', to: 'ETH', fee: '0.15%', time: '10-20 min', minAmount: '0.01' },
    { from: 'SOL', to: 'ETH', fee: '0.2%', time: '15-30 min', minAmount: '0.1' },
  ];

  const handleBridge = async () => {
    setBridging(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/bridge/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fromChain, toChain, amount }),
      });
      const data = await response.json();
      if (data.success) {
        alert('Bridge transaction initiated');
      }
    } catch (error) {
      console.error('Bridge failed:', error);
    } finally {
      setBridging(false);
    }
  };

  const currentRoute = routes.find(r => r.from === fromChain && r.to === toChain);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Cross-Chain Bridge</h1>
        
        <div className="bg-white rounded-lg shadow p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">From Chain</label>
            <select
              className="w-full px-3 py-2 border rounded-lg"
              value={fromChain}
              onChange={(e) => setFromChain(e.target.value)}
            >
              <option value="ETH">Ethereum</option>
              <option value="BSC">BNB Chain</option>
              <option value="Polygon">Polygon</option>
              <option value="SOL">Solana</option>
              <option value="ARBITRUM">Arbitrum</option>
              <option value="OPTIMISM">Optimism</option>
            </select>
          </div>

          <div className="flex justify-center mb-4">
            <button className="p-2 bg-gray-100 rounded-full">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">To Chain</label>
            <select
              className="w-full px-3 py-2 border rounded-lg"
              value={toChain}
              onChange={(e) => setToChain(e.target.value)}
            >
              <option value="BSC">BNB Chain</option>
              <option value="ETH">Ethereum</option>
              <option value="Polygon">Polygon</option>
              <option value="SOL">Solana</option>
              <option value="ARBITRUM">Arbitrum</option>
              <option value="OPTIMISM">Optimism</option>
            </select>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">Amount</label>
            <input
              type="number"
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {currentRoute && (
            <div className="p-4 bg-gray-50 rounded-lg mb-6">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Fee</span>
                <span>{currentRoute.fee}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Estimated Time</span>
                <span>{currentRoute.time}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Min Amount</span>
                <span>{currentRoute.minAmount}</span>
              </div>
            </div>
          )}

          <button
            onClick={handleBridge}
            disabled={bridging || !amount}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {bridging ? 'Bridging...' : 'Bridge Assets'}
          </button>
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-4">Supported Routes</h2>
          <div className="bg-white rounded-lg shadow divide-y">
            {routes.map((route, i) => (
              <div key={i} className="p-4 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{route.from}</span>
                  <span>→</span>
                  <span className="font-medium">{route.to}</span>
                </div>
                <div className="text-sm text-gray-500">
                  {route.fee} · {route.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
