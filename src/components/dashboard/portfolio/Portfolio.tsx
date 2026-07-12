'use client';

import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Wallet, Percent, PieChart } from 'lucide-react';

interface PortfolioPosition {
  symbol: string;
  amount: number;
  value: number;
  pnl: number;
  pnlPercent: number;
}

export function Portfolio() {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [totalPnL, setTotalPnL] = useState(0);
  const [totalPnLPercent, setTotalPnLPercent] = useState(0);

  useEffect(() => {
    const fetchPortfolio = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/portfolio', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.data) {
          setPositions(data.data.positions || []);
          setTotalValue(data.data.totalValue || 0);
          setTotalPnL(data.data.totalPnL || 0);
          setTotalPnLPercent(data.data.totalPnLPercent || 0);
        }
      } catch (err) {
        console.error('Failed to fetch portfolio:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPortfolio();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse bg-gray-800 h-24 rounded-xl" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-gray-800 h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="text-tiger-orange" />
            <span className="text-gray-400">Total Value</span>
          </div>
          <div className="text-2xl font-bold">${totalValue.toLocaleString()}</div>
        </div>

        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className={totalPnL >= 0 ? 'text-green-500' : 'text-red-500'} />
            <span className="text-gray-400">Total P&L</span>
          </div>
          <div className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString()}
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <Percent className={totalPnLPercent >= 0 ? 'text-green-500' : 'text-red-500'} />
            <span className="text-gray-400">Return</span>
          </div>
          <div className={`text-2xl font-bold ${totalPnLPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Positions */}
      {positions.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="text-tiger-orange" />
            <h3 className="text-white font-semibold">Positions</h3>
          </div>

          <div className="space-y-3">
            {positions.map((position, i) => (
              <div 
                key={i}
                className="flex items-center justify-between py-3 border-b border-gray-700 last:border-0"
              >
                <div>
                  <div className="text-white font-medium">{position.symbol}</div>
                  <div className="text-gray-500 text-sm">{position.amount.toFixed(6)}</div>
                </div>
                <div className="text-right">
                  <div className="text-white font-medium">${position.value.toLocaleString()}</div>
                  <div className={`text-sm ${position.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)} ({position.pnlPercent.toFixed(2)}%)
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {positions.length === 0 && (
        <div className="bg-gray-800 rounded-xl p-6 text-center">
          <p className="text-gray-500">No open positions</p>
        </div>
      )}
    </div>
  );
}

export default Portfolio;
