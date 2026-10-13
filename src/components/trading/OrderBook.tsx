'use client';

import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

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
  trades?: Trade[];
}

export function OrderBook({ 
  bids: propBids,
  asks: propAsks,
  symbol = 'BTC/USDT', 
  baseAsset = 'BTC', 
  quoteAsset = 'USDT',
  onSelectPrice,
  showTrades = false,
  trades: propTrades,
}: OrderBookProps) {
  const [bids, setBids] = useState<OrderBookLevel[]>(propBids || []);
  const [asks, setAsks] = useState<OrderBookLevel[]>(propAsks || []);
  const [trades, setTrades] = useState<Trade[]>(propTrades || []);
  const [precision, setPrecision] = useState(2);
  const [depth, setDepth] = useState(10);
  const [grouping, setGrouping] = useState(0.01);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  // Only update the view from data supplied by the connected market-data client.
  useEffect(() => {
    const totals = (levels: OrderBookLevel[]) => {
      let cumulative = 0;
      return levels.map(level => {
        cumulative += level.quantity;
        return { ...level, total: cumulative };
      });
    };
    if (propBids !== undefined) setBids(totals(propBids));
    if (propAsks !== undefined) setAsks(totals(propAsks));
    if (propTrades !== undefined) setTrades(propTrades);
    if (propBids !== undefined || propAsks !== undefined || propTrades !== undefined) {
      setLastUpdate(Date.now());
    }
  }, [propBids, propAsks, propTrades]);

  // Totals are calculated when live data arrives.
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
        {groupedAsks.length === 0 ? <div className="px-4 py-6 text-center text-xs text-gray-500">Waiting for live ask data</div> : groupedAsks.slice(0, depth).map((ask, i) => (
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
            {bids.length ? formatPrice(bids[0].price) : "—"}
          </span>
          <ArrowUp className="h-3 w-3 text-gray-500" />
          <span className="text-red-400 text-sm font-bold">
            {asks.length ? formatPrice(asks[0].price) : "—"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-gray-500">Mid:</span>
            <span className="text-white ml-1">{midPrice > 0 ? formatPrice(midPrice) : "—"}</span>
          </div>
          <div>
            <span className="text-gray-500">VWAP:</span>
            <span className="text-white ml-1">{bids.length + asks.length > 0 ? formatPrice(vwap) : "—"}</span>
          </div>
          <div>
            <span className="text-gray-500">Spread:</span>
            <span className="text-gray-400 ml-1">{bids.length > 0 && asks.length > 0 ? spread.toFixed(2) + " (" + spreadPercent.toFixed(3) + "%)" : "—"}</span>
          </div>
        </div>
      </div>

      {/* Bids (Buys) - Green */}
      <div className="flex-1 overflow-hidden max-h-[200px]">
        {groupedBids.length === 0 ? <div className="px-4 py-6 text-center text-xs text-gray-500">Waiting for live bid data</div> : groupedBids.slice(0, depth).map((bid, i) => (
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
            {trades.length === 0 ? <div className="px-4 py-4 text-center text-xs text-gray-500">Waiting for live trades</div> : trades.slice(0, 10).map((trade, i) => (
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
        <span>Last update: {lastUpdate === null ? "—" : new Date(lastUpdate).toLocaleTimeString()}</span>
        <span>Total bids: {bids.length} | Total asks: {asks.length}</span>
      </div>
    </div>
  );
}