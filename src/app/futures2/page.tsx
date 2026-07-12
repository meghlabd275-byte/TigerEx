'use client';

import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Settings, RefreshCw, BarChart3, ChevronDown, Info } from 'lucide-react';

const FUTURES_PAIRS = [
  { symbol: 'TGR/USDT', price: '2.4567', change: '+5.23%', volume: '45M', funding: '0.01%', openInterest: '12M' },
  { symbol: 'BTC/USDT', price: '67,234', change: '+2.15%', volume: '890M', funding: '0.01%', openInterest: '450M' },
  { symbol: 'ETH/USDT', price: '3,456', change: '+1.89%', volume: '456M', funding: '0.01%', openInterest: '180M' },
  { symbol: 'BNB/USDT', price: '598', change: '-0.45%', volume: '234M', funding: '0.02%', openInterest: '45M' },
  { symbol: 'SOL/USDT', price: '145', change: '+8.12%', volume: '178M', funding: '0.01%', openInterest: '67M' },
  { symbol: 'XRP/USDT', price: '0.5234', change: '-1.23%', volume: '156M', funding: '-0.01%', openInterest: '34M' },
];

export default function FuturesTrading() {
  const [selectedPair, setSelectedPair] = useState('TGR/USDT');
  const [leverage, setLeverage] = useState(10);
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState('limit');
  const [price, setPrice] = useState('2.4567');
  const [amount, setAmount] = useState('');

  const currentPair = FUTURES_PAIRS.find(p => p.symbol === selectedPair) || FUTURES_PAIRS[0];
  const isPositive = parseFloat(currentPair.change) >= 0;

  return (
    <div className="h-screen bg-[#0A0A0F] text-white flex">
      {/* Left - Pairs */}
      <div className="w-56 border-r border-[rgba(255,255,255,0.1)]">
        <div className="p-3 border-b border-[rgba(255,255,255,0.1)]">
          <h3 className="text-sm font-medium">Futures</h3>
        </div>
        <div className="overflow-y-auto">
          {FUTURES_PAIRS.map(pair => (
            <button key={pair.symbol} onClick={() => setSelectedPair(pair.symbol)}
              className={`w-full p-3 flex justify-between hover:bg-[#1E1E24] ${selectedPair === pair.symbol ? 'bg-[#1E1E24] border-l-2 border-[#FF6B35]' : ''}`}>
              <div className="text-left">
                <p className="text-xs font-medium">{pair.symbol}</p>
                <p className="text-xs text-gray-500">{pair.volume}</p>
              </div>
              <div className="text-right">
                <p className="text-xs">{pair.price}</p>
                <p className={`text-xs ${parseFloat(pair.change) >= 0 ? 'text-green-500' : 'text-red-500'}`}>{pair.change}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center - Chart */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-[rgba(255,255,255,0.1)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">{currentPair.symbol} Perpetual</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-bold">{currentPair.price}</span>
                <span className={`text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>{currentPair.change}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="p-2 hover:bg-[#1E1E24] rounded-lg"><Settings className="w-4 h-4" /></button>
              <button className="p-2 hover:bg-[#1E1E24] rounded-lg"><RefreshCw className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span>24h Vol: {currentPair.volume}</span>
            <span>Open Interest: {currentPair.openInterest}</span>
            <span>Funding: {currentPair.funding}</span>
          </div>
        </div>
        
        <div className="flex-1 bg-[#0D0D12] flex items-center justify-center">
          <div className="text-center text-gray-500">
            <BarChart3 className="w-16 h-16 mx-auto mb-2 opacity-50" />
            <p>Futures Chart</p>
          </div>
        </div>

        {/* Positions */}
        <div className="h-48 border-t border-[rgba(255,255,255,0.1)] p-4">
          <h3 className="text-sm font-medium mb-3">Open Positions</h3>
          <div className="text-center text-gray-500 text-sm py-4">No open positions</div>
        </div>
      </div>

      {/* Right - Order Form */}
      <div className="w-72 border-l border-[rgba(255,255,255,0.1)] p-4">
        {/* Long/Short */}
        <div className="flex rounded-lg overflow-hidden mb-4">
          <button onClick={() => setSide('long')} className={`flex-1 py-2 text-center font-medium ${side === 'long' ? 'bg-green-600' : 'bg-[#14141A] text-gray-500'}`}>Long</button>
          <button onClick={() => setSide('short')} className={`flex-1 py-2 text-center font-medium ${side === 'short' ? 'bg-red-600' : 'bg-[#14141A] text-gray-500'}`}>Short</button>
        </div>

        {/* Leverage */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Leverage</span>
            <span className="text-[#FF6B35]">{leverage}x</span>
          </div>
          <input type="range" min="1" max="125" value={leverage} onChange={(e) => setLeverage(parseInt(e.target.value))} className="w-full" />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1x</span><span>25x</span><span>50x</span><span>75x</span><span>100x</span><span>125x</span>
          </div>
        </div>

        {/* Order Type */}
        <div className="flex gap-2 mb-4">
          {['limit', 'market', 'stop_limit'].map(type => (
            <button key={type} onClick={() => setOrderType(type)} className={`flex-1 py-1.5 text-xs rounded-lg ${orderType === type ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {type === 'stop_limit' ? 'Stop' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        {/* Price */}
        {orderType !== 'market' && (
          <div className="mb-3">
            <label className="text-xs text-gray-500">Price</label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-[#14141A] rounded-lg py-2 px-3 text-sm" />
          </div>
        )}

        {/* Amount */}
        <div className="mb-3">
          <label className="text-xs text-gray-500">Amount (Contracts)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="w-full bg-[#14141A] rounded-lg py-2 px-3 text-sm" />
        </div>

        {/* Cost */}
        <div className="flex justify-between text-sm mb-4">
          <span className="text-gray-500">Cost</span>
          <span>${((parseFloat(amount || '0') * parseFloat(price)) / leverage).toFixed(2)}</span>
        </div>

        {/* Submit */}
        <button className={`w-full py-3 rounded-lg font-medium ${side === 'long' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
          {side === 'long' ? 'Long' : 'Short'} {currentPair.symbol}
        </button>

        {/* Balance */}
        <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.1)]">
          <div className="flex justify-between text-xs text-gray-500"><span>Available</span><span>10,000 USDT</span></div>
          <div className="flex justify-between text-xs text-gray-500"><span>Margin</span><span>0.00 USDT</span></div>
          <div className="flex justify-between text-xs text-gray-500"><span>Unrealized PnL</span><span className="text-green-500">0.00 USDT</span></div>
        </div>
      </div>
    </div>
  );
}
