'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface OrderBookEntry {
  price: string;
  quantity: string;
  total: number;
}

interface OrderBookProps {
  symbol?: string;
  depth?: number;
}

export function OrderBook({ symbol = 'BTC-USDT', depth = 15 }: OrderBookProps) {
  const [bids, setBids] = useState<OrderBookEntry[]>([]);
  const [asks, setAsks] = useState<OrderBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spread, setSpread] = useState<{ value: number; percent: number }>({ value: 0, percent: 0 });

  const fetchOrderBook = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/orderbook?symbol=${symbol}&limit=${depth}`);
      const data = await res.json();
      
      if (data.success && data.data) {
        // Process bids
        const processedBids: OrderBookEntry[] = [];
        let bidTotal = 0;
        (data.data.bids || []).forEach((bid: string[]) => {
          bidTotal += parseFloat(bid[1]);
          processedBids.push({
            price: bid[0],
            quantity: bid[1],
            total: bidTotal,
          });
        });
        setBids(processedBids.slice(0, depth));

        // Process asks
        const processedAsks: OrderBookEntry[] = [];
        let askTotal = 0;
        (data.data.asks || []).forEach((ask: string[]) => {
          askTotal += parseFloat(ask[1]);
          processedAsks.push({
            price: ask[0],
            quantity: ask[1],
            total: askTotal,
          });
        });
        setAsks(processedAsks.slice(0, depth));

        // Calculate spread
        if (processedBids.length > 0 && processedAsks.length > 0) {
          const bestBid = parseFloat(processedBids[0].price);
          const bestAsk = parseFloat(processedAsks[0].price);
          const spreadValue = bestAsk - bestBid;
          const spreadPercent = (spreadValue / bestAsk) * 100;
          setSpread({ value: spreadValue, percent: spreadPercent });
        }
        
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch order book:', err);
      setError('Failed to load order book');
    } finally {
      setLoading(false);
    }
  }, [symbol, depth]);

  useEffect(() => {
    fetchOrderBook();
    const intervalId = setInterval(fetchOrderBook, 2000); // Refresh every 2s
    return () => clearInterval(intervalId);
  }, [fetchOrderBook]);

  const formatPrice = (price: string) => {
    const p = parseFloat(price);
    if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(2);
    return p.toFixed(6);
  };

  const formatQty = (qty: string) => {
    const q = parseFloat(qty);
    if (q >= 1000) return q.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return q.toFixed(4);
  };

  const maxTotal = Math.max(
    bids.length > 0 ? bids[bids.length - 1].total : 0,
    asks.length > 0 ? asks[asks.length - 1].total : 0
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 rounded-lg p-4">
        <span className="text-gray-500 animate-pulse">Loading order book...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 rounded-lg p-4">
        <span className="text-red-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-2 overflow-hidden">
      <div className="flex justify-between items-center px-2 py-1 text-xs text-gray-500 border-b border-gray-800">
        <span>Price (USDT)</span>
        <span>Amount</span>
      </div>

      {/* Asks (Sell orders) - reversed to show lowest ask at bottom */}
      <div className="flex flex-col-reverse">
        {asks.map((ask, i) => (
          <div 
            key={`ask-${i}`} 
            className="flex justify-between items-center px-2 py-0.5 text-xs relative"
          >
            <div 
              className="absolute right-0 top-0 bottom-0 bg-red-500/20"
              style={{ width: `${(ask.total / maxTotal) * 100}%` }}
            />
            <span className="text-red-500 relative z-10">{formatPrice(ask.price)}</span>
            <span className="text-gray-300 relative z-10">{formatQty(ask.quantity)}</span>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div className="flex justify-center items-center py-2 border-y border-gray-800 my-1">
        <span className="text-tiger-orange font-semibold">
          {bids.length > 0 && asks.length > 0 
            ? `${formatPrice(bids[0].price)} / ${formatPrice(asks[0].price)}`
            : '--'
          }
        </span>
        <span className="ml-2 text-xs text-gray-500">
          Spread: {spread.value.toFixed(2)} ({spread.percent.toFixed(3)}%)
        </span>
      </div>

      {/* Bids (Buy orders) */}
      <div>
        {bids.map((bid, i) => (
          <div 
            key={`bid-${i}`} 
            className="flex justify-between items-center px-2 py-0.5 text-xs relative"
          >
            <div 
              className="absolute right-0 top-0 bottom-0 bg-green-500/20"
              style={{ width: `${(bid.total / maxTotal) * 100}%` }}
            />
            <span className="text-green-500 relative z-10">{formatPrice(bid.price)}</span>
            <span className="text-gray-300 relative z-10">{formatQty(bid.quantity)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default OrderBook;
