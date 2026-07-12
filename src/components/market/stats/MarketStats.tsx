'use client';

import React, { useState, useEffect } from 'react';

interface TickerData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  tradesCount: number;
}

interface MarketStatsProps {
  symbol?: string;
}

export function MarketStats({ symbol = 'BTC-USDT' }: MarketStatsProps) {
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTicker = async () => {
      try {
        const res = await fetch(`/api/market/ticker?symbol=${symbol}`);
        const data = await res.json();

        if (data.success && data.data) {
          setTicker(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch ticker:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTicker();
    const interval = setInterval(fetchTicker, 3000);
    return () => clearInterval(interval);
  }, [symbol]);

  const formatPrice = (price: number) => {
    if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(6);
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
    if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
    if (vol >= 1e3) return (vol / 1e3).toFixed(2) + 'K';
    return vol.toFixed(2);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-800 h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!ticker) {
    return null;
  }

  const stats = [
    { label: 'Last Price', value: `$${formatPrice(ticker.price)}` },
    { label: '24h Change', value: `${ticker.priceChangePercent > 0 ? '+' : ''}${ticker.priceChangePercent.toFixed(2)}%`, 
      className: ticker.priceChangePercent >= 0 ? 'text-green-500' : 'text-red-500' },
    { label: '24h High', value: `$${formatPrice(ticker.highPrice)}` },
    { label: '24h Low', value: `$${formatPrice(ticker.lowPrice)}` },
    { label: '24h Volume', value: formatVolume(ticker.volume) },
    { label: '24h Quote Volume', value: `$${formatVolume(ticker.quoteVolume)}` },
    { label: 'Trades', value: formatVolume(ticker.tradesCount) },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div key={i} className="bg-gray-900 rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">{stat.label}</div>
          <div className={`text-white font-semibold ${stat.className || ''}`}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export default MarketStats;
