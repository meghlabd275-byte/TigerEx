'use client';

import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, Clock, Activity } from 'lucide-react';

// Trade interface
export interface Trade {
  id: string;
  price: number;
  quantity: number;
  time: number;
  side: 'buy' | 'sell';
  isbuyerMaker: boolean;
}

// Recent Trades Props
interface RecentTradesProps {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  limit?: number;
  onSelectTrade?: (price: number, side: 'buy' | 'sell') => void;
  trades?: Trade[];
}

export function RecentTrades({
  symbol = 'BTC/USDT',
  baseAsset = 'BTC',
  quoteAsset = 'USDT',
  limit = 50,
  onSelectTrade,
  trades: propTrades,
}: RecentTradesProps) {
  const [trades, setTrades] = useState<Trade[]>(propTrades || []);
  const [pricePrecision, setPricePrecision] = useState(2);

  // Render only actual trades supplied by the connected market-data client.
  useEffect(() => {
    setTrades(propTrades || []);
  }, [propTrades]);

  const formatPrice = (price: number) => {
    return price.toFixed(pricePrecision);
  };

  const formatQty = (qty: number) => {
    return qty >= 1 ? qty.toFixed(4) : qty.toFixed(6);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-400" />
          <h3 className="font-semibold text-white">Recent Trades</h3>
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={pricePrecision}
            onChange={(e) => setPricePrecision(Number(e.target.value))}
            className="bg-white/5 text-xs text-gray-400 border border-white/10 rounded px-2 py-1"
          >
            <option value={2}>$0.01</option>
            <option value={1}>$0.1</option>
            <option value={0}>$1</option>
          </select>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 gap-2 px-4 py-2 text-xs text-gray-500 border-b border-white/5">
        <div className="text-left">Price ({quoteAsset})</div>
        <div className="text-right">Amount ({baseAsset})</div>
        <div className="text-right">Time</div>
      </div>

      {/* Trades */}
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-500">Waiting for live trade data</div>
        ) : trades.slice(0, limit).map((trade, i) => (
          <div 
            key={trade.id}
            className="grid grid-cols-3 gap-2 px-4 py-1 text-sm cursor-pointer hover:bg-white/5"
            onClick={() => onSelectTrade?.(trade.price, trade.side)}
          >
            <div className={trade.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
              {formatPrice(trade.price)}
            </div>
            <div className="text-right text-gray-300">{formatQty(trade.quantity)}</div>
            <div className="text-right text-gray-500">{formatTime(trade.time)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}