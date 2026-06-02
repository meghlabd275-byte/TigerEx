'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { OrderBook } from '@/components/trading/OrderBook';
import { OrderForm } from '@/components/trading/OrderForm';
import { OpenOrders } from '@/components/trading/OpenOrders';
import { RecentTrades } from '@/components/trading/RecentTrades';
import { PriceChart } from '@/components/charts/PriceChart';
import { 
  TrendingUp, TrendingDown, Star, Bell, Settings, 
  Wallet, ArrowRight, ChevronDown, Search 
} from 'lucide-react';

// Market interface
interface Market {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

// Mock markets
const mockMarkets: Market[] = [
  { symbol: 'BTC/USDT', price: 67245.50, change24h: 1234.50, changePercent24h: 1.87, volume24h: 2850000000, high24h: 68000, low24h: 65800 },
  { symbol: 'ETH/USDT', price: 3456.20, change24h: -45.30, changePercent24h: -1.29, volume24h: 1250000000, high24h: 3520, low24h: 3400 },
  { symbol: 'SOL/USDT', price: 145.80, change24h: 8.20, changePercent24h: 5.96, volume24h: 850000000, high24h: 148, low24h: 136 },
  { symbol: 'BNB/USDT', price: 580.40, change24h: -12.30, changePercent24h: -2.08, volume24h: 420000000, high24h: 595, low24h: 570 },
  { symbol: 'XRP/USDT', price: 0.5234, change24h: 0.0123, changePercent24h: 2.41, volume24h: 380000000, high24h: 0.54, low24h: 0.50 },
];

// Selected market state
export default function TradingPage({ 
  params 
}: { 
  params: { symbol?: string } 
}) {
  const [symbol] = useState(params.symbol || 'BTC/USDT');
  const [markets, setMarkets] = useState(mockMarkets);
  
  // Parse symbol
  const [baseAsset, quoteAsset] = symbol.split('/');
  const currentMarket = markets.find(m => m.symbol === symbol) || mockMarkets[0];

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 bg-[#0d0d1a]/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Left - Logo */}
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <span className="text-lg font-bold">T</span>
              </div>
              <span className="text-lg font-bold">TigerEx</span>
            </Link>
            
            {/* Search */}
            <div className="relative ml-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search markets..."
                className="bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-1.5 text-sm w-64"
              />
            </div>
          </div>
          
          {/* Right - Actions */}
          <div className="flex items-center gap-2">
            <Link href="/wallet" className="p-2 hover:bg-white/5 rounded-lg">
              <Wallet className="h-5 w-5" />
            </Link>
            <button className="p-2 hover:bg-white/5 rounded-lg relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" />
            </button>
            <button className="p-2 hover:bg-white/5 rounded-lg">
              <Settings className="h-5 w-5" />
            </button>
            <Link href="/login" className="ml-2 px-4 py-1.5 bg-orange-500 hover:bg-orange-600 rounded-lg text-sm font-medium">
              Log In
            </Link>
          </div>
        </div>
      </header>

      {/* Market Selection Bar */}
      <div className="bg-[#0d0d1a]/80 border-b border-white/10">
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
          {/* Favorites */}
          <button className="flex items-center gap-1 px-2 py-1 text-yellow-500 hover:bg-white/5 rounded">
            <Star className="h-4 w-4 fill-current" />
          </button>
          
          {/* Markets */}
          {markets.map((market) => (
            <button
              key={market.symbol}
              className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${
                market.symbol === symbol
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="font-medium">{market.symbol.replace('/USDT', '')}</span>
              <span className="ml-2 text-xs opacity-70">
                {market.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex">
        {/* Left Sidebar - Markets */}
        <div className="w-64 border-r border-white/10 flex flex-col">
          {/* Market Stats */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{currentMarket.price.toLocaleString()}</span>
              <span className="text-gray-400">{quoteAsset}</span>
            </div>
            <div className={`flex items-center gap-2 mt-1 ${
              currentMarket.change24h >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {currentMarket.change24h >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>{currentMarket.change24h > 0 ? '+' : ''}{currentMarket.change24h.toFixed(2)}</span>
              <span>({currentMarket.changePercent24h > 0 ? '+' : ''}{currentMarket.changePercent24h.toFixed(2)}%)</span>
            </div>
          </div>
          
          {/* 24h Stats */}
          <div className="p-4 space-y-2 text-sm border-b border-white/10">
            <div className="flex justify-between">
              <span className="text-gray-400">24h High</span>
              <span>{currentMarket.high24h.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">24h Low</span>
              <span>{currentMarket.low24h.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">24h Vol ({baseAsset})</span>
              <span>{(currentMarket.volume24h / currentMarket.price / 1000000).toFixed(2)}M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">24h Vol ({quoteAsset})</span>
              <span>${(currentMarket.volume24h / 1000000000).toFixed(2)}B</span>
            </div>
          </div>
          
          {/* All Markets */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-2">
              <div className="text-xs text-gray-500 px-2 py-1">All Markets</div>
              {markets.map((market) => (
                <Link
                  key={market.symbol}
                  href={`/trading/${market.symbol}`}
                  className={`flex items-center justify-between p-2 rounded-lg hover:bg-white/5 ${
                    market.symbol === symbol ? 'bg-white/5' : ''
                  }`}
                >
                  <div>
                    <div className="font-medium text-sm">{market.symbol.replace('/USDT', '')}</div>
                    <div className="text-xs text-gray-500">{market.symbol}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">{market.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    <div className={`text-xs ${market.changePercent24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {market.changePercent24h >= 0 ? '+' : ''}{market.changePercent24h.toFixed(2)}%
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Center - Chart & Trades */}
        <div className="flex-1 flex flex-col">
          {/* Price Chart */}
          <div className="flex-1 p-2">
            <PriceChart symbol={symbol} height={450} />
          </div>
          
          {/* Bottom - Recent Trades */}
          <div className="h-64 p-2 pt-0">
            <RecentTrades 
              symbol={symbol} 
              baseAsset={baseAsset} 
              quoteAsset={quoteAsset} 
              limit={20} 
            />
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-80 border-l border-white/10 flex flex-col">
          {/* Order Form */}
          <div className="p-2">
            <OrderForm 
              symbol={symbol}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
              currentPrice={currentMarket.price}
            />
          </div>
          
          {/* Order Book */}
          <div className="flex-1 p-2 pt-0">
            <OrderBook 
              symbol={symbol}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
            />
          </div>
        </div>
      </div>

      {/* Bottom Panel - Open Orders */}
      <div className="h-64 border-t border-white/10">
        <OpenOrders symbol={symbol} />
      </div>
    </div>
  );
}