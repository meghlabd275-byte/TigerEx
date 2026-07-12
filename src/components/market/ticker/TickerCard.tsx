'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface TickerData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
}

interface MarketListProps {
  limit?: number;
}

export function MarketList({ limit = 10 }: MarketListProps) {
  const [markets, setMarkets] = useState<TickerData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const res = await fetch('/api/markets');
        const data = await res.json();

        if (data.success && data.data) {
          setMarkets(data.data.slice(0, limit));
        }
      } catch (err) {
        console.error('Failed to fetch markets:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 5000);
    return () => clearInterval(interval);
  }, [limit]);

  const formatPrice = (price: number) => {
    if (price >= 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(6)}`;
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(2)}M`;
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(2)}K`;
    return `$${vol.toFixed(2)}`;
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-green-500';
    if (change < 0) return 'text-red-500';
    return 'text-gray-500';
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-800 h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {markets.map((market) => {
        const [base, quote] = market.symbol.split('-');
        
        return (
          <Link
            key={market.symbol}
            href={`/trade/${market.symbol}`}
            className="flex items-center justify-between bg-gray-900 hover:bg-gray-800 rounded-lg p-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              {/* Icon */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                base === 'BTC' ? 'bg-orange-500' :
                base === 'ETH' ? 'bg-blue-500' :
                base === 'BNB' ? 'bg-yellow-500' :
                base === 'SOL' ? 'bg-purple-500' :
                'bg-gray-500'
              }`}>
                {base.slice(0, 2)}
              </div>
              
              {/* Symbol */}
              <div>
                <div className="text-white font-medium">{base}</div>
                <div className="text-gray-500 text-xs">{quote}</div>
              </div>
            </div>

            {/* Price & Change */}
            <div className="text-right">
              <div className="text-white font-medium">{formatPrice(market.price)}</div>
              <div className={`text-xs ${getChangeColor(market.priceChangePercent)}`}>
                {market.priceChangePercent > 0 ? '+' : ''}{market.priceChangePercent.toFixed(2)}%
              </div>
            </div>

            {/* Volume */}
            <div className="text-right w-20">
              <div className="text-gray-400 text-sm">{formatVolume(market.quoteVolume)}</div>
              <div className="text-gray-500 text-xs">Vol</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default MarketList;
