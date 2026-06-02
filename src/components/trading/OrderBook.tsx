'use client';

import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

// Order Book Level Interface
interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
}

// Order Book Props
interface OrderBookProps {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  onSelectPrice?: (price: number, side: 'buy' | 'sell') => void;
}

// Mock initial data
const initialBids: OrderBookLevel[] = [
  { price: 67245.50, quantity: 2.543, total: 0 },
  { price: 67244.80, quantity: 1.892, total: 0 },
  { price: 67243.20, quantity: 3.215, total: 0 },
  { price: 67242.50, quantity: 0.543, total: 0 },
  { price: 67241.00, quantity: 5.432, total: 0 },
  { price: 67240.25, quantity: 2.123, total: 0 },
  { price: 67239.50, quantity: 1.234, total: 0 },
  { price: 67238.00, quantity: 4.567, total: 0 },
  { price: 67236.80, quantity: 0.891, total: 0 },
  { price: 67235.50, quantity: 3.456, total: 0 },
];

const initialAsks: OrderBookLevel[] = [
  { price: 67246.20, quantity: 1.234, total: 0 },
  { price: 67247.00, quantity: 2.567, total: 0 },
  { price: 67248.50, quantity: 0.876, total: 0 },
  { price: 67249.80, quantity: 3.234, total: 0 },
  { price: 67250.50, quantity: 1.543, total: 0 },
  { price: 67252.00, quantity: 2.109, total: 0 },
  { price: 67253.25, quantity: 0.654, total: 0 },
  { price: 67255.00, quantity: 4.321, total: 0 },
  { price: 67256.80, quantity: 1.987, total: 0 },
  { price: 67258.50, quantity: 2.543, total: 0 },
];

export function OrderBook({ 
  symbol = 'BTC/USDT', 
  baseAsset = 'BTC', 
  quoteAsset = 'USDT',
  onSelectPrice 
}: OrderBookProps) {
  const [bids, setBids] = useState<OrderBookLevel[]>(initialBids);
  const [asks, setAsks] = useState<OrderBookLevel[]>(initialAsks);
  const [precision, setPrecision] = useState(2);
  const [depth, setDepth] = useState(10);

  // Calculate cumulative totals
  useEffect(() => {
    let cumBid = 0;
    const newBids = bids.map(b => {
      cumBid += b.quantity;
      return { ...b, total: cumBid };
    });
    setBids(newBids);

    let cumAsk = 0;
    const newAsks = [...asks].reverse().map(a => {
      cumAsk += a.quantity;
      return { ...a, total: cumAsk };
    }).reverse();
    setAsks(newAsks);
  }, []);

  // Get max total for width calculation
  const maxBidTotal = Math.max(...bids.map(b => b.total), ...asks.map(a => a.total));

  // Format price with precision
  const formatPrice = (price: number) => {
    return price.toFixed(precision);
  };

  // Format quantity
  const formatQty = (qty: number) => {
    return qty >= 1 ? qty.toFixed(4) : qty.toFixed(6);
  };

  // Calculate spread
  const spread = asks.length > 0 && bids.length > 0 
    ? asks[0].price - bids[0].price 
    : 0;
  const spreadPercent = bids.length > 0 
    ? (spread / bids[0].price) * 100 
    : 0;

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="font-semibold text-white">Order Book</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{symbol}</span>
          <select 
            value={precision}
            onChange={(e) => setPrecision(Number(e.target.value))}
            className="bg-white/5 text-xs text-gray-400 border border-white/10 rounded px-2 py-1"
          >
            <option value={2}>$0.01</option>
            <option value={1}>$0.1</option>
            <option value={0}>$1</option>
            <option value={-1}>$10</option>
          </select>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 gap-2 px-4 py-2 text-xs text-gray-500 border-b border-white/5">
        <div className="text-left">Price ({quoteAsset})</div>
        <div className="text-right">Amount ({baseAsset})</div>
        <div className="text-right">Total</div>
      </div>

      {/* Asks (Sells) - Red */}
      <div className="flex-1 overflow-hidden flex flex-col-reverse">
        {asks.slice(0, depth).map((ask, i) => (
          <div 
            key={`ask-${i}`}
            className="relative grid grid-cols-3 gap-2 px-4 py-0.5 text-sm cursor-pointer hover:bg-white/5"
            onClick={() => onSelectPrice?.(ask.price, 'sell')}
          >
            {/* Background depth indicator */}
            <div 
              className="absolute right-0 top-0 bottom-0 bg-red-500/20"
              style={{ width: `${(ask.total / maxBidTotal) * 100}%` }}
            />
            <div className="relative text-red-400">{formatPrice(ask.price)}</div>
            <div className="relative text-right text-gray-300">{formatQty(ask.quantity)}</div>
            <div className="relative text-right text-gray-400">{ask.total.toFixed(4)}</div>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div className="flex items-center justify-center gap-2 py-2 border-y border-white/10 bg-white/5">
        <span className="text-green-400 text-sm font-medium">
          {formatPrice(bids[0]?.price || 0)}
        </span>
        <ArrowUp className="h-4 w-4 text-gray-500" />
        <span className="text-red-400 text-sm font-medium">
          {formatPrice(asks[0]?.price || 0)}
        </span>
        <span className="text-xs text-gray-500 ml-2">
          Spread: {spread.toFixed(2)} ({spreadPercent.toFixed(3)}%)
        </span>
      </div>

      {/* Bids (Buys) - Green */}
      <div className="flex-1 overflow-hidden">
        {bids.slice(0, depth).map((bid, i) => (
          <div 
            key={`bid-${i}`}
            className="relative grid grid-cols-3 gap-2 px-4 py-0.5 text-sm cursor-pointer hover:bg-white/5"
            onClick={() => onSelectPrice?.(bid.price, 'buy')}
          >
            {/* Background depth indicator */}
            <div 
              className="absolute right-0 top-0 bottom-0 bg-green-500/20"
              style={{ width: `${(bid.total / maxBidTotal) * 100}%` }}
            />
            <div className="relative text-green-400">{formatPrice(bid.price)}</div>
            <div className="relative text-right text-gray-300">{formatQty(bid.quantity)}</div>
            <div className="relative text-right text-gray-400">{bid.total.toFixed(4)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}