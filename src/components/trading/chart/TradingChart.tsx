'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingChartProps {
  symbol?: string;
  interval?: string;
  height?: number;
}

export function TradingChart({ 
  symbol = 'BTC-USDT', 
  interval = '1h',
  height = 400 
}: TradingChartProps) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCandles = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${interval}&limit=100`);
      const data = await res.json();
      
      if (data.success && data.data) {
        const parsedCandles: Candle[] = data.data.map((c: any[]) => ({
          time: c[0] as number,
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]),
        }));
        setCandles(parsedCandles);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch candles:', err);
      setError('Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, [symbol, interval]);

  useEffect(() => {
    fetchCandles();
    const intervalId = setInterval(fetchCandles, 30000); // Refresh every 30s
    return () => clearInterval(intervalId);
  }, [fetchCandles]);

  if (loading) {
    return (
      <div 
        className="flex items-center justify-center bg-gray-900 rounded-lg"
        style={{ height }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-2 border-tiger-orange border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500">Loading chart...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div 
        className="flex items-center justify-center bg-gray-900 rounded-lg"
        style={{ height }}
      >
        <span className="text-red-500">{error}</span>
      </div>
    );
  }

  const formatTime = (time: number) => {
    const date = new Date(time * 1000);
    return interval === '1d' 
      ? date.toLocaleDateString() 
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (value: number) => {
    if (value >= 1000) return `$${value.toLocaleString()}`;
    if (value >= 1) return `$${value.toFixed(2)}`;
    return `$${value.toFixed(6)}`;
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={candles} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="time" 
            tickFormatter={formatTime}
            stroke="#6b7280"
            tick={{ fontSize: 10 }}
          />
          <YAxis 
            domain={['auto', 'auto']}
            tickFormatter={formatPrice}
            stroke="#6b7280"
            tick={{ fontSize: 10 }}
            width={80}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1f2937', 
              border: '1px solid #374151',
              borderRadius: '8px'
            }}
            labelFormatter={(time) => new Date(time * 1000).toLocaleString()}
            formatter={(value: number) => [formatPrice(value), 'Price']}
          />
          <Area 
            type="monotone" 
            dataKey="close" 
            stroke="#f97316" 
            strokeWidth={2}
            fillOpacity={1} 
            fill="url(#colorClose)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TradingChart;
