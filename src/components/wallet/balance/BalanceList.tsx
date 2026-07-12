'use client';

import React, { useState, useEffect } from 'react';

interface WalletBalance {
  currency: string;
  network: string;
  type: string;
  balance: number;
  locked: number;
  available: number;
}

interface BalanceListProps {
  compact?: boolean;
}

export function BalanceList({ compact = false }: BalanceListProps) {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalUSD, setTotalUSD] = useState(0);

  // Mock prices for USD conversion
  const prices: { [key: string]: number } = {
    'BTC': 65000,
    'ETH': 3500,
    'USDT': 1,
    'USDC': 1,
    'BNB': 600,
    'SOL': 150,
    'XRP': 0.6,
    'ADA': 0.5,
    'DOGE': 0.15,
    'SOL': 150,
  };

  useEffect(() => {
    const fetchBalances = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) {
        setError('Please login to view balances');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/wallet/balances', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.data) {
          setBalances(data.data);
          
          // Calculate total USD
          let total = 0;
          data.data.forEach((w: WalletBalance) => {
            const price = prices[w.currency] || 0;
            total += w.available * price;
          });
          setTotalUSD(total);
          setError(null);
        } else {
          setError(data.error?.message || 'Failed to load balances');
        }
      } catch (err) {
        setError('Failed to connect to server');
      } finally {
        setLoading(false);
      }
    };

    fetchBalances();
  }, []);

  const formatBalance = (balance: number, currency: string) => {
    if (balance === 0) return '0';
    if (balance < 0.0001) return balance.toExponential(2);
    if (balance < 1) return balance.toFixed(6);
    if (balance < 1000) return balance.toFixed(4);
    return balance.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const formatUSD = (value: number) => {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getCurrencyIcon = (currency: string) => {
    // Return first letter as placeholder
    return currency.slice(0, 2);
  };

  const getCurrencyColor = (currency: string) => {
    const colors: { [key: string]: string } = {
      'BTC': 'bg-orange-500',
      'ETH': 'bg-blue-500',
      'USDT': 'bg-green-500',
      'USDC': 'bg-blue-400',
      'BNB': 'bg-yellow-500',
      'SOL': 'bg-purple-500',
    };
    return colors[currency] || 'bg-gray-500';
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-gray-800 h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-center">
        <span className="text-gray-500">{error}</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-1">
        {balances.slice(0, 5).map((balance, i) => (
          <div key={i} className="flex justify-between items-center py-2">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full ${getCurrencyColor(balance.currency)} flex items-center justify-center text-xs font-bold text-white`}>
                {getCurrencyIcon(balance.currency)}
              </div>
              <span className="text-white font-medium">{balance.currency}</span>
            </div>
            <div className="text-right">
              <div className="text-white">{formatBalance(balance.available, balance.currency)}</div>
              <div className="text-gray-500 text-xs">${formatUSD(balance.available * (prices[balance.currency] || 0))}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Total Balance Card */}
      <div className="bg-gradient-to-r from-tiger-orange to-orange-600 rounded-lg p-6">
        <div className="text-white/80 text-sm">Total Assets</div>
        <div className="text-3xl font-bold text-white mt-1">${formatUSD(totalUSD)}</div>
      </div>

      {/* Balance List */}
      <div className="space-y-2">
        {balances.map((balance, i) => (
          <div 
            key={i} 
            className="flex items-center justify-between bg-gray-900 rounded-lg p-4 hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${getCurrencyColor(balance.currency)} flex items-center justify-center text-sm font-bold text-white`}>
                {getCurrencyIcon(balance.currency)}
              </div>
              <div>
                <div className="text-white font-medium">{balance.currency}</div>
                <div className="text-gray-500 text-xs">{balance.network}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-white">{formatBalance(balance.available, balance.currency)}</div>
              <div className="text-gray-500 text-xs">
                ${formatUSD(balance.available * (prices[balance.currency] || 0))}
              </div>
              {balance.locked > 0 && (
                <div className="text-yellow-500 text-xs">
                  Locked: {formatBalance(balance.locked, balance.currency)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default BalanceList;
