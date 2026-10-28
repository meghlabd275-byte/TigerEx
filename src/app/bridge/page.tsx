'use client';

import { useState } from 'react';

const CHAINS = ['ETH', 'BSC', 'Polygon', 'SOL', 'ARBITRUM', 'OPTIMISM'];

export default function BridgePage() {
  const [fromChain, setFromChain] = useState('ETH');
  const [toChain, setToChain] = useState('BSC');
  const [tokenSymbol, setTokenSymbol] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [bridging, setBridging] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleBridge = async () => {
    setBridging(true);
    setResult(null);
    try {
      const token = localStorage.getItem('tigerex_access_token') || localStorage.getItem('admin_token');
      const response = await fetch('/api/crossChain/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fromChain, toChain, token: tokenSymbol, amount, toAddress }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || body?.error || 'Bridge request failed');
      }
      setResult('Bridge transfer submitted. Track its status in your transaction history.');
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Bridge request failed');
    } finally {
      setBridging(false);
    }
  };

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
              {CHAINS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-center mb-4">
            <button
              type="button"
              onClick={() => {
                setFromChain(toChain);
                setToChain(fromChain);
              }}
              className="p-2 bg-gray-100 rounded-full"
              aria-label="Swap chains"
            >
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
              {CHAINS.filter((c) => c !== fromChain).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Asset</label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-lg"
              value={tokenSymbol}
              onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. USDT"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Amount</label>
            <input
              type="number"
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">Destination Address</label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
              placeholder="0x…"
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
            />
          </div>

          <p className="mb-4 text-xs text-gray-500">
            The bridge fee and estimated time are quoted by the bridge service when the transfer is
            submitted.
          </p>

          <button
            onClick={handleBridge}
            disabled={bridging || !amount || !toAddress || fromChain === toChain}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {bridging ? 'Bridging...' : 'Bridge Assets'}
          </button>
          {result && <p className="mt-3 text-sm text-gray-700">{result}</p>}
        </div>
      </div>
    </div>
  );
}
