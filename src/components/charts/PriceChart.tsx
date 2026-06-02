'use client';

import { useEffect, useRef, useState } from 'react';
import { 
  TrendingUp, 
  Clock, 
  Settings, 
  Maximize2,
  RefreshCw,
  Indicator
} from 'lucide-react';

interface ChartProps {
  symbol?: string;
  interval?: string;
  height?: number;
}

// Chart intervals
const intervals = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
  { label: '1w', value: '1w' },
];

// Chart types
const chartTypes = [
  { label: 'Candles', value: 'candles' },
  { label: 'Depth', value: 'depth' },
  { label: 'Line', value: 'line' },
  { label: 'Area', value: 'area' },
];

export function PriceChart({
  symbol = 'BTCUSDT',
  interval = '1h',
  height = 400,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedInterval, setSelectedInterval] = useState(interval);
  const [chartType, setChartType] = useState('candles');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Simulated OHLCV data generator
  const generateOHLCV = (count: number) => {
    const data = [];
    let price = 67000;
    const now = Date.now();
    
    for (let i = count; i > 0; i--) {
      const volatility = price * 0.002;
      const open = price;
      const change = (Math.random() - 0.48) * volatility * 2;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * volatility;
      const low = Math.min(open, close) - Math.random() * volatility;
      const volume = Math.random() * 100 + 10;
      
      data.push({
        time: Math.floor((now - i * 3600000) / 1000),
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round(volume * 100) / 100,
      });
      
      price = close;
    }
    
    return data;
  };

  // Simple candle rendering
  const renderCandles = () => {
    const data = generateOHLCV(50);
    const containerWidth = containerRef.current?.clientWidth || 800;
    const candleWidth = Math.max(4, (containerWidth - 100) / data.length - 2);
    const maxPrice = Math.max(...data.map(d => d.high));
    const minPrice = Math.min(...data.map(d => d.low));
    const priceRange = maxPrice - minPrice;
    const padding = priceRange * 0.1;
    const chartHeight = height - 60;
    
    return (
      <div className="flex items-end h-full pb-4">
        {data.map((candle, i) => {
          const x = (i / data.length) * (containerWidth - 100) + 50;
          const yHigh = chartHeight - ((candle.high - minPrice + padding) / (priceRange + padding * 2)) * chartHeight;
          const yLow = chartHeight - ((candle.low - minPrice + padding) / (priceRange + padding * 2)) * chartHeight;
          const yOpen = chartHeight - ((candle.open - minPrice + padding) / (priceRange + padding * 2)) * chartHeight;
          const yClose = chartHeight - ((candle.close - minPrice + padding) / (priceRange + padding * 2)) * chartHeight;
          const isGreen = candle.close >= candle.open;
          
          return (
            <div
              key={i}
              className="relative flex flex-col items-center"
              style={{
                position: 'absolute',
                left: x,
                height: chartHeight,
              }}
            >
              {/* Wick */}
              <div
                className={`absolute w-0.5 ${isGreen ? 'bg-green-500' : 'bg-red-500'}`}
                style={{
                  top: yHigh,
                  height: yLow - yHigh,
                }}
              />
              {/* Body */}
              <div
                className={`absolute w-full ${isGreen ? 'bg-green-500' : 'bg-red-500'}`}
                style={{
                  top: Math.min(yOpen, yClose),
                  height: Math.abs(yClose - yOpen) || candleWidth,
                }}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div 
      ref={containerRef}
      className={`bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-4">
          {/* Interval Buttons */}
          {intervals.map((int) => (
            <button
              key={int.value}
              onClick={() => setSelectedInterval(int.value)}
              className={`px-2 py-1 text-xs rounded transition-all ${
                selectedInterval === int.value
                  ? 'bg-orange-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {int.label}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Chart Type */}
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-400"
          >
            {chartTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          
          {/* Indicators */}
          <button className="p-1.5 text-gray-400 hover:text-white" title="Indicators">
            <Indicator className="h-4 w-4" />
          </button>
          
          {/* Fullscreen */}
          <button 
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-gray-400 hover:text-white" 
            title="Fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Price Scale */}
      <div className="flex">
        <div className="w-16 border-r border-white/10">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 px-1 text-xs text-gray-500 border-b border-white/5 text-right">
              {(67000 - i * 1000).toLocaleString()}
            </div>
          ))}
        </div>
        
        {/* Chart Area */}
        <div className="flex-1 relative" style={{ height }}>
          {/* Grid Lines */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute w-full h-px bg-white/5"
              style={{ top: i * 80 }}
            />
          ))}
          
          {/* Candles */}
          {renderCandles()}
        </div>
      </div>

      {/* Volume Scale */}
      <div className="flex">
        <div className="w-16 border-r border-white/10 bg-black/20">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 px-1 text-xs text-gray-500 border-b border-white/5 text-right">
              {100 - i * 30}
            </div>
          ))}
        </div>
        
        {/* Volume Bars */}
        <div className="flex-1 h-20 flex items-end gap-px px-1">
          {[...Array(50)].map((_, i) => {
            const height = Math.random() * 80 + 10;
            const isGreen = Math.random() > 0.4;
            return (
              <div
                key={i}
                className={`flex-1 ${isGreen ? 'bg-green-500/50' : 'bg-red-500/50'}`}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}