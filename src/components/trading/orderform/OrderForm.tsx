'use client';

import React, { useState, useEffect } from 'react';

type OrderSide = 'buy' | 'sell';
type OrderType = 'limit' | 'market';

interface OrderFormProps {
  symbol?: string;
  currentPrice?: number;
  onOrderSubmit?: (order: OrderRequest) => void;
}

interface OrderRequest {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
}

export function OrderForm({ symbol = 'BTC-USDT', currentPrice = 0, onOrderSubmit }: OrderFormProps) {
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [price, setPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [total, setTotal] = useState<string>('0.00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ [key: string]: number }>({});

  // Fetch user balances
  useEffect(() => {
    const fetchBalances = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) return;

      try {
        const res = await fetch('/api/wallet/balances', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.success && data.data) {
          const balanceMap: { [key: string]: number } = {};
          data.data.forEach((w: any) => {
            balanceMap[w.currency] = w.available;
          });
          setBalances(balanceMap);
        }
      } catch (err) {
        console.error('Failed to fetch balances:', err);
      }
    };

    fetchBalances();
  }, []);

  // Update price when current price changes
  useEffect(() => {
    if (currentPrice && orderType === 'limit' && !price) {
      setPrice(currentPrice.toString());
    }
  }, [currentPrice, orderType, price]);

  // Calculate total
  useEffect(() => {
    const qty = parseFloat(quantity) || 0;
    const p = orderType === 'market' ? currentPrice : (parseFloat(price) || 0);
    setTotal((qty * p).toFixed(2));
  }, [quantity, price, currentPrice, orderType]);

  const baseCurrency = symbol.split('-')[0];
  const quoteCurrency = symbol.split('-')[1];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Please login first');
      setLoading(false);
      return;
    }

    const order: OrderRequest = {
      symbol,
      side,
      orderType,
      quantity: parseFloat(quantity),
    };

    if (orderType === 'limit') {
      order.price = parseFloat(price);
    }

    try {
      const res = await fetch('/api/spot/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(order),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Order failed');
      }

      // Reset form
      setQuantity('');
      if (orderType === 'limit') {
        setPrice('');
      }

      if (onOrderSubmit) {
        onOrderSubmit(order);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const availableBalance = side === 'buy' 
    ? balances[quoteCurrency] || 0 
    : balances[baseCurrency] || 0;

  const percentButtons = [25, 50, 75, 100];

  const handlePercent = (percent: number) => {
    if (side === 'buy') {
      const maxQty = availableBalance / (orderType === 'market' ? currentPrice : parseFloat(price) || 0);
      setQuantity((maxQty * percent / 100).toFixed(6));
    } else {
      setQuantity((availableBalance * percent / 100).toFixed(6));
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex mb-4 bg-gray-800 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setSide('buy')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            side === 'buy' 
              ? 'bg-green-600 text-white' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide('sell')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            side === 'sell' 
              ? 'bg-red-600 text-white' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Sell
        </button>
      </div>

      <div className="flex mb-4 bg-gray-800 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setOrderType('limit')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            orderType === 'limit' 
              ? 'bg-gray-700 text-white' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Limit
        </button>
        <button
          type="button"
          onClick={() => setOrderType('market')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            orderType === 'market' 
              ? 'bg-gray-700 text-white' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Market
        </button>
      </div>

      <div className="text-xs text-gray-500 mb-2">
        Available: <span className="text-white">{availableBalance.toFixed(4)} {side === 'buy' ? quoteCurrency : baseCurrency}</span>
      </div>

      {orderType === 'limit' && (
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">Price</label>
          <div className="relative">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-md py-2 px-3 text-white text-sm focus:outline-none focus:border-tiger-orange"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
              {quoteCurrency}
            </span>
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-1">Amount</label>
        <div className="relative">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-md py-2 px-3 text-white text-sm focus:outline-none focus:border-tiger-orange"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
            {baseCurrency}
          </span>
        </div>
        <div className="flex gap-1 mt-2">
          {percentButtons.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handlePercent(p)}
              className="flex-1 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700"
            >
              {p}%
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Total</span>
          <span className="text-white">{total} {quoteCurrency}</span>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-500 bg-red-500/10 p-2 rounded">
          {error}
        </div>
      )}

      <button
        type="submit"
        onClick={handleSubmit}
        disabled={loading || !quantity || (orderType === 'limit' && !price)}
        className={`w-full py-3 rounded-md font-medium text-white transition-colors ${
          side === 'buy'
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-red-600 hover:bg-red-700'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {loading 
          ? 'Processing...' 
          : `${side === 'buy' ? 'Buy' : 'Sell'} ${baseCurrency}`
        }
      </button>
    </div>
  );
}

export default OrderForm;
