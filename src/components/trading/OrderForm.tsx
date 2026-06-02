'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';

// Order type definitions
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'stop_limit' | 'stop_market';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'GTT';

interface OrderFormProps {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  currentPrice?: number;
  balances?: {
    available: number;
    locked: number;
  };
  onSubmitOrder?: (order: OrderSubmission) => void;
}

export interface OrderSubmission {
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price: number;
  stopPrice?: number;
  timeInForce: TimeInForce;
  total: number;
}

export function OrderForm({
  symbol = 'BTC/USDT',
  baseAsset = 'BTC',
  quoteAsset = 'USDT',
  currentPrice = 67245.50,
  balances = { available: 10000, locked: 500 },
  onSubmitOrder,
}: OrderFormProps) {
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [quantity, setQuantity] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('GTC');

  // Initialize price with current price
  useEffect(() => {
    if (currentPrice && !price) {
      setPrice(currentPrice.toFixed(2));
    }
  }, [currentPrice]);

  // Calculate total
  const total = useMemo(() => {
    const qty = parseFloat(quantity) || 0;
    const prc = parseFloat(price) || currentPrice;
    return qty * prc;
  }, [quantity, price, currentPrice]);

  // Get possible quantity for sell
  const getPossibleQuantity = useCallback(() => {
    const prc = parseFloat(price) || currentPrice;
    if (prc <= 0) return 0;
    return balances.available / prc;
  }, [price, currentPrice, balances.available]);

  // Handle percentage button
  const handlePercentage = (pct: number) => {
    if (side === 'buy') {
      const maxTotal = balances.available * (pct / 100);
      const prc = parseFloat(price) || currentPrice;
      setQuantity((maxTotal / prc).toFixed(6));
    } else {
      const qty = getPossibleQuantity() * (pct / 100);
      setQuantity(qty.toFixed(6));
    }
  };

  // Validate order
  const canSubmit = useMemo(() => {
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return false;
    
    if (orderType === 'limit' || orderType === 'stop_limit') {
      const prc = parseFloat(price);
      if (isNaN(prc) || prc <= 0) return false;
      
      if (orderType.includes('stop')) {
        const stop = parseFloat(stopPrice);
        if (side === 'buy' && stop <= prc) return false;
        if (side === 'sell' && stop >= prc) return false;
      }
    }
    
    if (side === 'buy' && total > balances.available) return false;
    if (side === 'sell' && qty > getPossibleQuantity()) return false;
    
    return true;
  }, [quantity, price, total, orderType, side, balances.available, currentPrice, stopPrice]);

  // Submit order
  const handleSubmit = () => {
    if (!canSubmit) return;
    
    const order: OrderSubmission = {
      side,
      type: orderType,
      quantity: parseFloat(quantity),
      price: parseFloat(price) || currentPrice,
      stopPrice: orderType.includes('stop') ? parseFloat(stopPrice) : undefined,
      timeInForce,
      total,
    };
    
    onSubmitOrder?.(order);
    setQuantity('');
  };

  return (
    <div className="flex flex-col bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="font-semibold text-white">Place Order</h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Buy/Sell Toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide('buy')}
            className={`py-2.5 rounded-lg font-medium transition-all ${
              side === 'buy'
                ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setSide('sell')}
            className={`py-2.5 rounded-lg font-medium transition-all ${
              side === 'sell'
                ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
            }`}
          >
            Sell
          </button>
        </div>

        {/* Order Type */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Order Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as OrderType)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
          >
            <option value="limit">Limit</option>
            <option value="market">Market</option>
            <option value="stop_limit">Stop-Limit</option>
            <option value="stop_market">Stop-Market</option>
          </select>
        </div>

        {/* Price */}
        {(orderType === 'limit' || orderType === 'stop_limit') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Price ({quoteAsset})</label>
            <div className="relative">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{quoteAsset}</span>
            </div>
          </div>
        )}

        {/* Stop Price */}
        {(orderType === 'stop_limit' || orderType === 'stop_market') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Stop Price ({quoteAsset})</label>
            <div className="relative">
              <input
                type="number"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{quoteAsset}</span>
            </div>
          </div>
        )}

        {/* Quantity */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Amount ({baseAsset})</label>
          <div className="relative">
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.000000"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-16"
            />
            <button
              onClick={() => setQuantity(getPossibleQuantity().toFixed(6))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange-500 hover:underline"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Percentage Buttons */}
        <div className="grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => handlePercentage(pct)}
              className="py-1.5 text-xs bg-white/5 text-gray-400 rounded hover:bg-white/10"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Time in Force */}
        {(orderType === 'limit' || orderType === 'stop_limit') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Time in Force</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['GTC', 'IOC', 'FOK'] as TimeInForce[]).map((tif) => (
                <button
                  key={tif}
                  onClick={() => setTimeInForce(tif)}
                  className={`py-1.5 text-xs rounded transition-all ${
                    timeInForce === tif
                      ? 'bg-orange-500 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {tif}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between py-3 border-t border-white/10">
          <div className="text-gray-400 text-sm">Total</div>
          <div className="text-white font-medium">{total.toFixed(2)} {quoteAsset}</div>
        </div>

        {/* Available */}
        <div className="flex items-center justify-between">
          <div className="text-gray-400 text-sm">Available</div>
          <div className="text-gray-300">
            {balances.available.toFixed(2)} {side === 'buy' ? quoteAsset : baseAsset}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full py-3 rounded-lg font-medium transition-all ${
            side === 'buy'
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {baseAsset}
        </button>
      </div>
    </div>
  );
}