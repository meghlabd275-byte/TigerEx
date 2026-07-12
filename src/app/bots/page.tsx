'use client';

import React, { useState } from 'react';
import { Bot, Play, Pause, Settings, Trash2, TrendingUp, Activity, Grid3X3, Timer, BarChart3 } from 'lucide-react';

const BOTS = [
  { id: 1, name: 'BTC Grid', type: 'Grid', pair: 'BTC/USDT', status: 'running', profit: '+234.50', roi: '+5.2%', pairs: 3, config: { upperPrice: 70000, lowerPrice: 60000, gridCount: 10 } },
  { id: 2, name: 'ETH DCA', type: 'DCA', pair: 'ETH/USDT', status: 'running', profit: '+89.20', roi: '+3.1%', pairs: 1, config: { buyInterval: '4h', buyAmount: 100, maxPosition: 10 } },
  { id: 3, name: 'SOL Martingale', type: 'Martingale', pair: 'SOL/USDT', status: 'stopped', profit: '+45.30', roi: '+1.8%', pairs: 1, config: { multiplier: 2, maxCycles: 5 } },
];

const BOT_TEMPLATES = [
  { type: 'Grid', description: 'Buy low, sell high within a price range', icon: <Grid3X3 className="w-6 h-6" />, minInvestment: 100 },
  { type: 'DCA', description: 'Dollar-cost averaging to reduce entry price', icon: <Timer className="w-6 h-6" />, minInvestment: 50 },
  { type: 'Martingale', description: 'Double position after each loss', icon: <Activity className="w-6 h-6" />, minInvestment: 200 },
  { type: 'TWAP', description: 'Time-weighted average price execution', icon: <BarChart3 className="w-6 h-6" />, minInvestment: 1000 },
  { type: 'AI Trading', description: 'AI-powered signal trading', icon: <Bot className="w-6 h-6" />, minInvestment: 500 },
];

export default function TradingBotsPage() {
  const [bots, setBots] = useState(BOTS);
  const [showCreate, setShowCreate] = useState(false);

  const toggleBot = (id: number) => {
    setBots(bots.map(b => b.id === id ? { ...b, status: b.status === 'running' ? 'stopped' : 'running' } : b));
  };

  const deleteBot = (id: number) => {
    setBots(bots.filter(b => b.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Trading Bots</h1>
            <p className="text-gray-400">Automate your trading strategies</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg flex items-center gap-2">
            <Bot className="w-4 h-4" /> Create Bot
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Active Bots</p>
            <p className="text-2xl font-bold">{bots.filter(b => b.status === 'running').length}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Profit</p>
            <p className="text-2xl font-bold text-green-500">+${bots.reduce((a, b) => a + parseFloat(b.profit.replace('+', '')), 0).toFixed(2)}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Running For</p>
            <p className="text-2xl font-bold">15d 3h</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Avg ROI</p>
            <p className="text-2xl font-bold text-[#FF6B35]">+3.4%</p>
          </div>
        </div>

        {/* Bot Templates */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Bot Templates</h2>
          <div className="grid grid-cols-5 gap-3">
            {BOT_TEMPLATES.map((bot, i) => (
              <button key={i} onClick={() => setShowCreate(true)} className="bg-[#14141A] hover:bg-[#1E1E24] rounded-xl p-4 text-center transition">
                <div className="w-12 h-12 bg-[#FF6B35]/20 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[#FF6B35]">{bot.icon}</span>
                </div>
                <p className="font-medium text-sm">{bot.type}</p>
                <p className="text-xs text-gray-500 mt-1">${bot.minInvestment}+</p>
              </button>
            ))}
          </div>
        </div>

        {/* Active Bots */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Your Bots</h2>
          <div className="space-y-3">
            {bots.map(bot => (
              <div key={bot.id} className="bg-[#14141A] rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bot.status === 'running' ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                      <Bot className={`w-5 h-5 ${bot.status === 'running' ? 'text-green-500' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{bot.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded ${bot.status === 'running' ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}`}>
                          {bot.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{bot.type} · {bot.pair}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="font-bold text-green-500">{bot.profit}</p>
                      <p className="text-xs text-gray-500">{bot.roi}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => toggleBot(bot.id)} className={`p-2 rounded-lg ${bot.status === 'running' ? 'bg-yellow-500/20 hover:bg-yellow-500/30' : 'bg-green-500/20 hover:bg-green-500/30'}`}>
                        {bot.status === 'running' ? <Pause className="w-4 h-4 text-yellow-500" /> : <Play className="w-4 h-4 text-green-500" />}
                      </button>
                      <button className="p-2 bg-[#FF6B35]/20 hover:bg-[#FF6B35]/30 rounded-lg">
                        <Settings className="w-4 h-4 text-[#FF6B35]" />
                      </button>
                      <button onClick={() => deleteBot(bot.id)} className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg">
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {bots.length === 0 && (
          <div className="text-center py-12 text-gray-500 bg-[#14141A] rounded-xl">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No bots created yet</p>
            <p className="text-sm">Create your first trading bot</p>
          </div>
        )}
      </div>
    </div>
  );
}
