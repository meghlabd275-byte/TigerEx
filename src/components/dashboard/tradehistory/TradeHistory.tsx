'use client';

import React, { useState, useEffect } from 'react';
import { History, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  total: number;
  fee: number;
  timestamp: number;
}

export function TradeHistory({ limit = 20 }: { limit?: number }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/trades/history?limit=${limit}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.data) {
          setTrades(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch trades:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTrades();
  }, [limit]);

  const formatPrice = (price: number) => {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-800 h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-gray-800">
        <History className="text-tiger-orange" />
        <h3 className="text-white font-semibold">Trade History</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-gray-500 text-sm border-b border-gray-800">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Pair</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Fee</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No trades yet
                </td>
              </tr>
            ) : (
              trades.map((trade, i) => (
                <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {formatTime(trade.timestamp)}
                  </td>
                  <td className="px-4 py-3 text-white font-medium">
                    {trade.symbol}
                  </td>
                  <td className="px-4 py-3">
                    <div className={`flex items-center gap-1 ${
                      trade.side === 'buy' ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {trade.side === 'buy' ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4" />
                      )}
                      {trade.side.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white text-right">
                    ${formatPrice(trade.price)}
                  </td>
                  <td className="px-4 py-3 text-white text-right">
                    {trade.quantity.toFixed(6)}
                  </td>
                  <td className="px-4 py-3 text-white text-right">
                    ${formatPrice(trade.total)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-right">
                    ${trade.fee.toFixed(6)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TradeHistory;
