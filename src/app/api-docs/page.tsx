'use client';

import React, { useState } from 'react';
import { Code, Copy, Check, Key, Globe, Clock } from 'lucide-react';
import { API_BASE_URL, WS_BASE_URL } from '@/lib/config';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/v1/markets', description: 'List every active trading pair with its live 24h statistics', category: 'Market' },
  { method: 'GET', path: '/api/v1/ticker', description: '24h ticker for every pair, or one pair with ?symbol=BTC/RUSD', category: 'Market' },
  { method: 'GET', path: '/api/v1/depth', description: 'Aggregated order-book depth (?symbol=BTC/RUSD&limit=20)', category: 'Market' },
  { method: 'GET', path: '/api/v1/trades', description: 'Recent settled trades (?symbol=BTC/RUSD&limit=50)', category: 'Market' },
  { method: 'POST', path: '/api/v1/order', description: 'Place a spot order (trade permission)', category: 'Trading' },
  { method: 'GET', path: '/api/v1/order/:id', description: 'Fetch one of your orders (read permission)', category: 'Trading' },
  { method: 'DELETE', path: '/api/v1/order/:id', description: 'Cancel a resting order (trade permission)', category: 'Trading' },
  { method: 'GET', path: '/api/v1/orders', description: 'Open orders, or history with ?history=true (read permission)', category: 'Trading' },
  { method: 'GET', path: '/api/v1/positions', description: 'Open futures positions with mark price and liquidation price', category: 'Trading' },
  { method: 'GET', path: '/api/v1/balance', description: 'Account balances with a live USD valuation (read permission)', category: 'Account' },
  { method: 'POST', path: '/api/v1/withdraw', description: 'Request a withdrawal; the amount is locked and queued for review', category: 'Account' },
  { method: 'GET', path: '/api/v1/deposits', description: 'Deposit history (read permission)', category: 'Account' },
  { method: 'GET', path: '/api/v1/withdrawals', description: 'Withdrawal history (read permission)', category: 'Account' },
];
export default function APIDocumentation() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [copiedEndpoint, setCopiedEndpoint] = useState('');

  const categories = ['all', 'Market', 'Trading', 'Account'];
  const filteredEndpoints = selectedCategory === 'all' ? API_ENDPOINTS : API_ENDPOINTS.filter(e => e.category === selectedCategory);

  const copyEndpoint = (path: string) => {
    navigator.clipboard.writeText(`${API_BASE_URL}${path}`);
    setCopiedEndpoint(path);
    setTimeout(() => setCopiedEndpoint(''), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#FF6B35]/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Code className="w-8 h-8 text-[#FF6B35]" />
          </div>
          <h1 className="text-2xl font-bold mb-2">API Documentation</h1>
          <p className="text-gray-400">Integrate with TigerEx API</p>
        </div>

        {/* Authentication */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Key className="w-5 h-5 text-[#FF6B35]" /> Authentication
          </h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-400 mb-2">API Key Header</p>
              <div className="bg-[#0A0A0F] rounded-lg p-3 font-mono text-sm flex items-center justify-between">
                <span>X-TigerEx-API-Key: your_api_key</span>
                <button className="text-gray-500 hover:text-white"><Copy className="w-4 h-4" /></button>
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-2">Signature Header</p>
              <div className="bg-[#0A0A0F] rounded-lg p-3 font-mono text-sm flex items-center justify-between">
                <span>X-TigerEx-Signature: hmac_sha256(secret, canonical)</span>
                <button className="text-gray-500 hover:text-white"><Copy className="w-4 h-4" /></button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Sign <code>METHOD \n PATH \n TIMESTAMP \n SHA256(body)</code> with HMAC-SHA256 using
                your API secret. The timestamp must be within 30 seconds of the server clock.
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-2">Timestamp Header</p>
              <div className="bg-[#0A0A0F] rounded-lg p-3 font-mono text-sm flex items-center justify-between">
                <span>X-TigerEx-Timestamp: 1699999999999</span>
                <button className="text-gray-500 hover:text-white"><Copy className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>

        {/* Rate Limits */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#FF6B35]" /> Rate Limits
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#0A0A0F] rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-[#FF6B35]">600</p>
              <p className="text-sm text-gray-500">Requests/minute</p>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-[#FF6B35]">120</p>
              <p className="text-sm text-gray-500">Orders/minute</p>
            </div>
            <div className="bg-[#0A0A0F] rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-[#FF6B35]">30</p>
              <p className="text-sm text-gray-500">Withdrawals/minute</p>
            </div>
          </div>
        </div>

        {/* Endpoints */}
        <div className="flex gap-2 mb-4">
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-lg text-sm capitalize ${selectedCategory === cat ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filteredEndpoints.map((endpoint, i) => (
            <div key={i} className="bg-[#14141A] rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    endpoint.method === 'GET' ? 'bg-green-500/20 text-green-500' :
                    endpoint.method === 'POST' ? 'bg-blue-500/20 text-blue-500' :
                    endpoint.method === 'DELETE' ? 'bg-red-500/20 text-red-500' : 'bg-yellow-500/20 text-yellow-500'
                  }`}>
                    {endpoint.method}
                  </span>
                  <code className="font-mono text-sm">{endpoint.path}</code>
                </div>
                <button onClick={() => copyEndpoint(endpoint.path)} className="text-gray-500 hover:text-white">
                  {copiedEndpoint === endpoint.path ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-sm text-gray-400 mt-2">{endpoint.description}</p>
            </div>
          ))}
        </div>

        {/* WebSocket */}
        <div className="bg-[#14141A] rounded-xl p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#FF6B35]" /> WebSocket API
          </h2>
          <div className="space-y-3">
            <div className="bg-[#0A0A0F] rounded-lg p-3">
              <p className="font-mono text-sm text-green-500">{WS_BASE_URL}/v1/ws</p>
            </div>
            <p className="text-sm text-gray-400">Subscribe to real-time market data, order updates, and trade executions.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
