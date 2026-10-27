'use client';

import React, { useMemo } from 'react';
import {
  Bot,
  Play,
  Pause,
  Settings,
  Trash2,
  Activity,
  Grid3X3,
  Timer,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface TradingBot {
  id: string;
  name?: string;
  type?: string;
  strategy?: string;
  pair?: string;
  symbol?: string;
  status?: string;
  profit?: number;
  pnl?: number;
  roi?: number;
}

// Bot strategies the engine supports. These describe capabilities, not
// running state, so they are safe to render before any bot exists.
const BOT_TEMPLATES = [
  {
    type: 'Grid',
    description: 'Buy low, sell high within a price range',
    icon: <Grid3X3 className="w-6 h-6" />,
  },
  {
    type: 'DCA',
    description: 'Dollar-cost averaging to reduce entry price',
    icon: <Timer className="w-6 h-6" />,
  },
  {
    type: 'Martingale',
    description: 'Double position after each loss',
    icon: <Activity className="w-6 h-6" />,
  },
  {
    type: 'TWAP',
    description: 'Time-weighted average price execution',
    icon: <BarChart3 className="w-6 h-6" />,
  },
  {
    type: 'Market Maker',
    description: 'Continuous two-sided quotes around the mid price',
    icon: <Bot className="w-6 h-6" />,
  },
];

function botStatus(bot: TradingBot): string {
  return (bot.status || 'unknown').toLowerCase();
}

function botPair(bot: TradingBot): string {
  return bot.pair || bot.symbol || '—';
}

function formatPnl(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, {
    maximumFractionDigits: 8,
  })}`;
}

function formatRoi(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

export default function TradingBotsPage() {
  const bots = useApiResource<unknown>('/api/bot/trading');
  const botList = useMemo(() => toArray<TradingBot>(bots.data), [bots.data]);

  const running = botList.filter((b) => botStatus(b) === 'running').length;
  const totalPnl = botList.reduce((sum, b) => sum + (b.pnl ?? b.profit ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Trading Bots</h1>
            <p className="text-gray-400">Automate your trading strategies</p>
          </div>
          <button
            onClick={bots.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {bots.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load your bots: {bots.error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Active Bots</p>
            <p className="text-2xl font-bold">{bots.loading ? '…' : running}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total P&amp;L</p>
            <p
              className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}
            >
              {bots.loading ? '…' : formatPnl(totalPnl)}
            </p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Bots</p>
            <p className="text-2xl font-bold">{bots.loading ? '…' : botList.length}</p>
          </div>
        </div>

        {/* Bot Templates */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Bot Strategies</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {BOT_TEMPLATES.map((bot) => (
              <div
                key={bot.type}
                className="bg-[#14141A] rounded-xl p-4 text-center"
                title={bot.description}
              >
                <div className="w-12 h-12 bg-[#FF6B35]/20 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[#FF6B35]">{bot.icon}</span>
                </div>
                <p className="font-medium text-sm">{bot.type}</p>
                <p className="text-xs text-gray-500 mt-1">{bot.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Active Bots */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Your Bots</h2>
          {bots.loading && <p className="text-sm text-gray-500">Loading bots…</p>}
          <div className="space-y-3">
            {botList.map((bot) => {
              const status = botStatus(bot);
              const isRunning = status === 'running';
              const pnl = bot.pnl ?? bot.profit;
              return (
                <div key={bot.id} className="bg-[#14141A] rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          isRunning ? 'bg-green-500/20' : 'bg-gray-500/20'
                        }`}
                      >
                        <Bot
                          className={`w-5 h-5 ${
                            isRunning ? 'text-green-500' : 'text-gray-500'
                          }`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{bot.name || bot.id}</p>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              isRunning
                                ? 'bg-green-500/20 text-green-500'
                                : 'bg-gray-500/20 text-gray-500'
                            }`}
                          >
                            {status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {bot.type || bot.strategy || '—'} · {botPair(bot)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p
                          className={`font-bold ${
                            (pnl ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {formatPnl(pnl)}
                        </p>
                        <p className="text-xs text-gray-500">{formatRoi(bot.roi)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="p-2 bg-[#FF6B35]/20 hover:bg-[#FF6B35]/30 rounded-lg">
                          <Settings className="w-4 h-4 text-[#FF6B35]" />
                        </button>
                        <button className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg">
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {!bots.loading && !bots.error && botList.length === 0 && (
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
