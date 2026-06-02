'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowUp, ArrowDown, RefreshCw, Settings } from 'lucide-react';

// Order Book Level Interface
interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
  orders?: number; // Number of orders at this level
  timestamp?: number;
}

interface Trade {
  id: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  time: string;
}

// Order Book Props
interface OrderBookProps {
  bids?: OrderBookLevel[];
  asks?: OrderBookLevel[];
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  onSelectPrice?: (price: number, side: 'buy' | 'sell') => void;
  showTrades?: boolean;
}

// Generate mock data if none provided
const generateMockBids = (): OrderBookLevel[] => {
  const basePrice = 67432.50;
  return Array.from({ length: 15 }, (_, i) => ({
    price: basePrice - (i * 0.50) - (Math.random() * 0.25),
    quantity: Math.random() * 10 + 1,
    total: 0,
    orders: Math.floor(Math.random() * 10) + 1,
    timestamp: Date.now() - Math.random() * 10000,
  }));
};

const generateMockAsks = (): OrderBookLevel[] => {
  const basePrice = 67432.50;
  return Array.from({ length: 15 }, (_, i) => ({
    price: basePrice + (i * 0.50) + (Math.random() * 0.25),
    quantity: Math.random() * 10 + 1,
    total: 0,
    orders: Math.floor(Math.random() * 10) + 1,
    timestamp: Date.now() - Math.random() * 10000,
  }));
};

const generateMockTrades = (): Trade[] => {
  const basePrice = 67432.50;
  return Array.from({ length: 20 }, (_, i) => ({
    id: `trade_${Date.now()}_${i}`,
    price: basePrice + (Math.random() - 0.5) * 20,
    quantity: Math.random() * 2 + 0.1,
    side: Math.random() > 0.5 ? 'buy' : 'sell',
    time: new Date(Date.now() - i * 5000).toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    }),
  }));
};

export function OrderBook({ 
  bids: propBids,
  asks: propAsks,
  symbol = 'BTC/USDT', 
  baseAsset = 'BTC', 
  quoteAsset = 'USDT',
  onSelectPrice,
  showTrades = false 
}: OrderBookProps) {
  const [bids, setBids] = useState<OrderBookLevel[]>(propBids || generateMockBids());
  const [asks, setAsks] = useState<OrderBookLevel[]>(propAsks || generateMockAsks());
  const [trades, setTrades] = useState<Trade[]>(generateMockTrades());
  const [precision, setPrecision] = useState(2);
  const [depth, setDepth] = useState(10);
  const [grouping, setGrouping] = useState(0.01);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(Date.now());

  // Calculate cumulative totals
  useEffect(() => {
    if (!propBids) {
      let cumBid = 0;
      const newBids = bids.map(b => {
        cumBid += b.quantity;
        return { ...b, total: cumBid };
      });
      setBids(newBids);
    }

    if (!propAsks) {
      let cumAsk = 0;
      const newAsks = asks.map(a => {
        cumAsk += a.quantity;
        return { ...a, total: cumAsk };
      });
      setAsks(newAsks);
    }
  }, [bids, asks, propBids, propAsks]);

  // Auto-refresh simulation
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      setLastUpdate(Date.now());
      
      // Simulate order book updates
      setBids(prev => prev.map(level => ({
        ...level,
        quantity: Math.max(0.1, level.quantity + (Math.random() - 0.5) * 0.5),
        timestamp: Date.now(),
      })));
      
      setAsks(prev => prev.map(level => ({
        ...level,
        quantity: Math.max(0.1, level.quantity + (Math.random() - 0.5) * 0.5),
        timestamp: Date.now(),
      })));

      // Add new trades occasionally
      if (Math.random() > 0.7) {
        const basePrice = 67432.50;
        const newTrade: Trade = {
          id: `trade_${Date.now()}`,
          price: basePrice + (Math.random() - 0.5) * 10,
          quantity: Math.random() * 1 + 0.1,
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          time: new Date().toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
          }),
        };
        setTrades(prev => [newTrade, ...prev.slice(0, 19)]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Calculate totals
  const calculateTotals = useCallback((levels: OrderBookLevel[]) => {
    let cumulative = 0;
    return levels.map(level => {
      cumulative += level.quantity;
      return { ...level, total: cumulative };
    });
  }, []);

  // Get max total for width calculation
  const allTotals = [...bids.map(b => b.total), ...asks.map(a => a.total)];
  const maxTotal = Math.max(...allTotals, 1);

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

  // Calculate mid price
  const midPrice = bids.length > 0 && asks.length > 0
    ? (bids[0].price + asks[0].price) / 2
    : 0;

  // Calculate VWAP
  const calculateVWAP = () => {
    let totalValue = 0;
    let totalQty = 0;
    [...bids, ...asks].forEach(level => {
      totalValue += level.price * level.quantity;
      totalQty += level.quantity;
    });
    return totalQty > 0 ? totalValue / totalQty : midPrice;
  };

  const vwap = calculateVWAP();

  // Group orders by price level
  const groupOrders = (levels: OrderBookLevel[], groupSize: number) => {
    const grouped = new Map<number, OrderBookLevel>();
    levels.forEach(level => {
      const groupedPrice = Math.floor(level.price / groupSize) * groupSize;
      const existing = grouped.get(groupedPrice);
      if (existing) {
        existing.quantity += level.quantity;
        existing.orders = (existing.orders || 1) + (level.orders || 1);
      } else {
        grouped.set(groupedPrice, { ...level, price: groupedPrice });
      }
    });
    return Array.from(grouped.values());
  };

  // Get grouped data if grouping > 0.01
  const groupedBids = grouping > 0.01 ? groupOrders(bids, grouping) : bids;
  const groupedAsks = grouping > 0.01 ? groupOrders(asks, grouping) : asks;

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white">Order Book</h3>
          <span className="text-xs text-gray-500">{symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded ${autoRefresh ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-gray-400'}`}
            title="Auto Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
          </button>
          <select 
            value={grouping}
            onChange={(e) => setGrouping(Number(e.target.value))}
            className="bg-white/5 text-xs text-gray-400 border border-white/10 rounded px-2 py-1"
          >
            <option value={0.01}>0.01</option>
            <option value={0.1}>0.1</option>
            <option value={1}>1</option>
            <option value={10}>10</option>
          </select>
          <select 
            value={precision}
            onChange={(e) => setPrecision(Number(e.target.value))}
            className="bg-white/5 text-xs text-gray-400 border border-white/10 rounded px-2 py-1"
          >
            <option value={2}>$0.01</option>
            <option value={1}>$0.1</option>
            <option value={0}>$1</option>
          </select>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-4 gap-2 px-4 py-2 text-xs text-gray-500 border-b border-white/5">
        <div className="text-left">Price ({quoteAsset})</div>
        <div className="text-right">Amount ({baseAsset})</div>
        <div className="text-right">Total</div>
        <div className="text-right">Orders</div>
      </div>

      {/* Asks (Sells) - Red */}
      <div className="flex-1 overflow-hidden flex flex-col-reverse max-h-[200px]">
        {groupedAsks.slice(0, depth).map((ask, i) => (
          <div 
            key={`ask-${i}`}
            className="relative grid grid-cols-4 gap-2 px-4 py-1 text-xs cursor-pointer hover:bg-red-500/10 transition-colors"
            onClick={() => onSelectPrice?.(ask.price, 'sell')}
          >
            {/* Background depth indicator */}
            <div 
              className="absolute right-0 top-0 bottom-0 bg-red-500/20"
              style={{ width: `${(ask.total / maxTotal) * 100}%` }}
            />
            <div className="relative text-red-400 font-medium">{formatPrice(ask.price)}</div>
            <div className="relative text-right text-gray-300">{formatQty(ask.quantity)}</div>
            <div className="relative text-right text-gray-400">{ask.total.toFixed(4)}</div>
            <div className="relative text-right text-gray-500">{ask.orders || 1}</div>
          </div>
        ))}
      </div>

      {/* Spread & Mid Price */}
      <div className="flex items-center justify-between px-4 py-3 border-y border-white/10 bg-white/5">
        <div className="flex items-center gap-2">
          <span className="text-green-400 text-sm font-bold">
            {formatPrice(bids[0]?.price || 0)}
          </span>
          <ArrowUp className="h-3 w-3 text-gray-500" />
          <span className="text-red-400 text-sm font-bold">
            {formatPrice(asks[0]?.price || 0)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-gray-500">Mid:</span>
            <span className="text-white ml-1">{formatPrice(midPrice)}</span>
          </div>
          <div>
            <span className="text-gray-500">VWAP:</span>
            <span className="text-white ml-1">{formatPrice(vwap)}</span>
          </div>
          <div>
            <span className="text-gray-500">Spread:</span>
            <span className="text-gray-400 ml-1">{spread.toFixed(2)} ({spreadPercent.toFixed(3)}%)</span>
          </div>
        </div>
      </div>

      {/* Bids (Buys) - Green */}
      <div className="flex-1 overflow-hidden max-h-[200px]">
        {groupedBids.slice(0, depth).map((bid, i) => (
          <div 
            key={`bid-${i}`}
            className="relative grid grid-cols-4 gap-2 px-4 py-1 text-xs cursor-pointer hover:bg-green-500/10 transition-colors"
            onClick={() => onSelectPrice?.(bid.price, 'buy')}
          >
            {/* Background depth indicator */}
            <div 
              className="absolute right-0 top-0 bottom-0 bg-green-500/20"
              style={{ width: `${(bid.total / maxTotal) * 100}%` }}
            />
            <div className="relative text-green-400 font-medium">{formatPrice(bid.price)}</div>
            <div className="relative text-right text-gray-300">{formatQty(bid.quantity)}</div>
            <div className="relative text-right text-gray-400">{bid.total.toFixed(4)}</div>
            <div className="relative text-right text-gray-500">{bid.orders || 1}</div>
          </div>
        ))}
      </div>

      {/* Recent Trades (if enabled) */}
      {showTrades && (
        <>
          <div className="px-4 py-2 border-t border-white/10">
            <h4 className="text-xs text-gray-500 font-medium">Recent Trades</h4>
          </div>
          <div className="max-h-[150px] overflow-y-auto">
            {trades.slice(0, 10).map((trade, i) => (
              <div key={trade.id} className="grid grid-cols-3 gap-2 px-4 py-1 text-xs">
                <span className={trade.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {formatPrice(trade.price)}
                </span>
                <span className="text-right text-gray-300">{trade.quantity.toFixed(4)}</span>
                <span className="text-right text-gray-500">{trade.time}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Footer Stats */}
      <div className="px-4 py-2 border-t border-white/10 text-xs text-gray-500 flex items-center justify-between">
        <span>Last update: {new Date(lastUpdate).toLocaleTimeString()}</span>
        <span>Total bids: {bids.length} | Total asks: {asks.length}</span>
      </div>
    </div>
  );
}