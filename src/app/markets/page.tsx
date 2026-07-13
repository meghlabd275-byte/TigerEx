'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Star, Search, Filter, Grid, List, ChevronUp, ChevronDown } from 'lucide-react';

// Market interface
interface Market {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  trades24h: number;
  marketCap: number;
  circulatingSupply: number;
  maxSupply: number;
  isFavorite?: boolean;
}

// Real trading pairs (14 initial pairs)
const demoMarkets: Market[] = [
  { id: 'btcusdt', symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', price: 67245.50, change24h: 1234.50, changePercent24h: 1.87, volume24h: 2850000000, high24h: 68000, low24h: 65800, trades24h: 425000, marketCap: 1320000000000, circulatingSupply: 19600000, maxSupply: 21000000 },
  { id: 'ethusdt', symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', price: 3456.20, change24h: -45.30, changePercent24h: -1.29, volume24h: 1250000000, high24h: 3520, low24h: 3400, trades24h: 380000, marketCap: 415000000000, circulatingSupply: 120200000, maxSupply: nil },
  { id: 'bnbusdt', symbol: 'BNB/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', price: 580.40, change24h: -12.30, changePercent24h: -2.08, volume24h: 420000000, high24h: 595, low24h: 570, trades24h: 95000, marketCap: 87000000000, circulatingSupply: 150000000, maxSupply: 200000000 },
  { id: 'solusdt', symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', price: 145.80, change24h: 8.20, changePercent24h: 5.96, volume24h: 850000000, high24h: 148, low24h: 136, trades24h: 125000, marketCap: 64000000000, circulatingSupply: 440000000, maxSupply: nil },
  { id: 'xrpusdt', symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', price: 0.5234, change24h: 0.0123, changePercent24h: 2.41, volume24h: 380000000, high24h: 0.54, low24h: 0.50, trades24h: 280000, marketCap: 28000000000, circulatingSupply: 53500000000, maxSupply: 100000000000 },
  { id: 'adausdt', symbol: 'ADA/USDT', baseAsset: 'ADA', quoteAsset: 'USDT', price: 0.452, change24h: -0.008, changePercent24h: -1.74, volume24h: 180000000, high24h: 0.47, low24h: 0.44, trades24h: 95000, marketCap: 16000000000, circulatingSupply: 35000000000, maxSupply: 45000000000 },
  { id: 'dogeusdt', symbol: 'DOGE/USDT', baseAsset: 'DOGE', quoteAsset: 'USDT', price: 0.1234, change24h: 0.0045, changePercent24h: 3.79, volume24h: 145000000, high24h: 0.13, low24h: 0.11, trades24h: 75000, marketCap: 17500000000, circulatingSupply: 142000000000, maxSupply: nil },
  { id: 'dotusdt', symbol: 'DOT/USDT', baseAsset: 'DOT', quoteAsset: 'USDT', price: 7.23, change24h: -0.15, changePercent24h: -2.03, volume24h: 95000000, high24h: 7.45, low24h: 7.05, trades24h: 45000, marketCap: 9500000000, circulatingSupply: 1314000000, maxSupply: nil },
  { id: 'avaxusdt', symbol: 'AVAX/USDT', baseAsset: 'AVAX', quoteAsset: 'USDT', price: 35.80, change24h: 2.30, changePercent24h: 6.87, volume24h: 245000000, high24h: 36.5, low24h: 33.2, trades24h: 125000, marketCap: 13500000000, circulatingSupply: 377000000, maxSupply: 720000000 },
  { id: 'maticusdt', symbol: 'MATIC/USDT', baseAsset: 'MATIC', quoteAsset: 'USDT', price: 0.856, change24h: 0.023, changePercent24h: 2.76, volume24h: 78000000, high24h: 0.88, low24h: 0.82, trades24h: 65000, marketCap: 7800000000, circulatingSupply: 9100000000, maxSupply: 10000000000 },
  { id: 'linkusdt', symbol: 'LINK/USDT', baseAsset: 'LINK', quoteAsset: 'USDT', price: 14.52, change24h: 0.32, changePercent24h: 2.26, volume24h: 125000000, high24h: 14.85, low24h: 14.10, trades24h: 55000, marketCap: 8500000000, circulatingSupply: 585000000, maxSupply: 1000000000 },
  { id: 'atomusdt', symbol: 'ATOM/USDT', baseAsset: 'ATOM', quoteAsset: 'USDT', price: 8.45, change24h: 0.18, changePercent24h: 2.18, volume24h: 55000000, high24h: 8.60, low24h: 8.20, trades24h: 32000, marketCap: 3200000000, circulatingSupply: 379000000, maxSupply: nil },
  { id: 'ltcusdt', symbol: 'LTC/USDT', baseAsset: 'LTC', quoteAsset: 'USDT', price: 85.20, change24h: -1.50, changePercent24h: -1.73, volume24h: 95000000, high24h: 87.50, low24h: 84.20, trades24h: 42000, marketCap: 6400000000, circulatingSupply: 75000000, maxSupply: 84000000 },
  { id: 'uniusdt', symbol: 'UNI/USDT', baseAsset: 'UNI', quoteAsset: 'USDT', price: 9.85, change24h: -0.22, changePercent24h: -2.18, volume24h: 64000000, high24h: 10.15, low24h: 9.65, trades24h: 35000, marketCap: 5900000000, circulatingSupply: 599000000, maxSupply: 1000000000 },
];
  { symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', price: 67245.50, change24h: 1234.50, changePercent24h: 1.87, volume24h: 2850000000, high24h: 68000, low24h: 65800, trades24h: 425000 },
  { symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', price: 3456.20, change24h: -45.30, changePercent24h: -1.29, volume24h: 1250000000, high24h: 3520, low24h: 3400, trades24h: 380000 },
  { symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', price: 145.80, change24h: 8.20, changePercent24h: 5.96, volume24h: 850000000, high24h: 148, low24h: 136, trades24h: 125000 },
  { symbol: 'BNB/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', price: 580.40, change24h: -12.30, changePercent24h: -2.08, volume24h: 420000000, high24h: 595, low24h: 570, trades24h: 95000 },
  { symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', price: 0.5234, change24h: 0.0123, changePercent24h: 2.41, volume24h: 380000000, high24h: 0.54, low24h: 0.50, trades24h: 280000 },
  { symbol: 'ADA/USDT', baseAsset: 'ADA', quoteAsset: 'USDT', price: 0.452, change24h: -0.008, changePercent24h: -1.74, volume24h: 180000000, high24h: 0.47, low24h: 0.44, trades24h: 95000 },
  { symbol: 'DOGE/USDT', baseAsset: 'DOGE', quoteAsset: 'USDT', price: 0.1234, change24h: 0.0045, changePercent24h: 3.79, volume24h: 145000000, high24h: 0.13, low24h: 0.11, trades24h: 75000 },
  { symbol: 'AVAX/USDT', baseAsset: 'AVAX', quoteAsset: 'USDT', price: 35.80, change24h: 2.30, changePercent24h: 6.87, volume24h: 245000000, high24h: 36.5, low24h: 33.2, trades24h: 125000 },
  { symbol: 'DOT/USDT', baseAsset: 'DOT', quoteAsset: 'USDT', price: 7.23, change24h: -0.15, changePercent24h: -2.03, volume24h: 95000000, high24h: 7.45, low24h: 7.05, trades24h: 45000 },
  { symbol: 'MATIC/USDT', baseAsset: 'MATIC', quoteAsset: 'USDT', price: 0.856, change24h: 0.023, changePercent24h: 2.76, volume24h: 78000000, high24h: 0.88, low24h: 0.82, trades24h: 65000 },
  { symbol: 'LINK/USDT', baseAsset: 'LINK', quoteAsset: 'USDT', price: 14.52, change24h: 0.32, changePercent24h: 2.26, volume24h: 125000000, high24h: 14.85, low24h: 14.10, trades24h: 55000 },
  { symbol: 'UNI/USDT', baseAsset: 'UNI', quoteAsset: 'USDT', price: 9.85, change24h: -0.22, changePercent24h: -2.18, volume24h: 64000000, high24h: 10.15, low24h: 9.65, trades24h: 35000 },
  { symbol: 'ATOM/USDT', baseAsset: 'ATOM', quoteAsset: 'USDT', price: 8.45, change24h: 0.18, changePercent24h: 2.18, volume24h: 55000000, high24h: 8.60, low24h: 8.20, trades24h: 32000 },
  { symbol: 'LTC/USDT', baseAsset: 'LTC', quoteAsset: 'USDT', price: 85.20, change24h: -1.50, changePercent24h: -1.73, volume24h: 95000000, high24h: 87.50, low24h: 84.20, trades24h: 42000 },
  { symbol: 'BCH/USDT', baseAsset: 'BCH', quoteAsset: 'USDT', price: 245.30, change24h: 5.20, changePercent24h: 2.17, volume24h: 78000000, high24h: 248, low24h: 238, trades24h: 28000 },
  { symbol: 'ETH/BTC', baseAsset: 'ETH', quoteAsset: 'BTC', price: 0.05142, change24h: -0.0003, changePercent24h: -0.58, volume24h: 45000000, high24h: 0.0521, low24h: 0.0508, trades24h: 18000 },
];

export default function MarketsPage() {
  const [markets, setMarkets] = useState(demoMarkets);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'volume' | 'price' | 'change'>('volume');
  const [showFavorites, setShowFavorites] = useState(false);

  const sortedMarkets = [...markets]
    .filter(m => !showFavorites || m.isFavorite)
    .filter(m => 
      !searchQuery || 
      m.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.baseAsset.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'volume': return b.volume24h - a.volume24h;
        case 'price': return b.price - a.price;
        case 'change': return b.changePercent24h - a.changePercent24h;
        default: return 0;
      }
    });

  const formatVolume = (vol: number) => {
    if (vol >= 1000000000) return `$${(vol / 1000000000).toFixed(2)}B`;
    if (vol >= 1000000) return `$${(vol / 1000000).toFixed(2)}M`;
    return `$${(vol / 1000).toFixed(2)}K`;
  };

  const toggleFavorite = (symbol: string) => {
    setMarkets(prev => prev.map(m => 
      m.symbol === symbol ? { ...m, isFavorite: !m.isFavorite } : m
    ));
  };

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      <header className="sticky top-0 z-50 bg-[#0d0d1a]/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between h-14 px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <span className="text-lg font-bold">T</span>
            </div>
          </Link>
          <h1 className="text-xl font-bold">Markets</h1>
        </div>
      </header>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => setShowFavorites(!showFavorites)}
            className={`p-2 rounded-lg ${showFavorites ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-gray-400'}`}
          >
            <Star className={`h-5 w-5 ${showFavorites && 'fill-current'}`} />
          </button>
        </div>

        <div className="flex gap-2">
          {[
            { value: 'volume', label: 'Volume' },
            { value: 'price', label: 'Price' },
            { value: 'change', label: '% Change' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSortBy(tab.value as typeof sortBy)}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                sortBy === tab.value
                  ? 'bg-orange-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-[#0d0d1a] rounded-xl border border-white/10 overflow-hidden">
          <div className="hidden md:grid grid-cols-5 gap-4 px-4 py-3 border-b border-white/10 text-xs text-gray-500">
            <div>Pair</div>
            <div className="text-right">Price</div>
            <div className="text-right">24h Change</div>
            <div className="text-right">24h Volume</div>
            <div className="text-right">Actions</div>
          </div>

          <div className="divide-y divide-white/5">
            {sortedMarkets.map((market) => (
              <Link
                key={market.symbol}
                href={`/trading/${market.symbol}`}
                className="block hover:bg-white/5"
              >
                <div className="grid grid-cols-5 gap-4 px-4 py-3 items-center">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        toggleFavorite(market.symbol);
                      }}
                      className="text-gray-500 hover:text-yellow-400"
                    >
                      <Star className={`h-4 w-4 ${market.isFavorite && 'fill-current text-yellow-400'}`} />
                    </button>
                    <div>
                      <div className="font-medium">{market.baseAsset}/{market.quoteAsset}</div>
                    </div>
                  </div>

                  <div className="text-right md:text-left">
                    {market.price >= 1 ? market.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : market.price.toFixed(6)}
                  </div>

                  <div className={`text-right ${market.changePercent24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <div className="flex items-center justify-end gap-1">
                      {market.changePercent24h >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {market.changePercent24h >= 0 ? '+' : ''}{market.changePercent24h.toFixed(2)}%
                    </div>
                  </div>

                  <div className="text-right text-gray-400">{formatVolume(market.volume24h)}</div>

                  <div className="flex items-center justify-end">
                    <button className="px-3 py-1 bg-orange-500/20 text-orange-400 rounded text-sm hover:bg-orange-500/30">Trade</button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}