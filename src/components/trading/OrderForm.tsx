'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Loader2, Info, AlertTriangle, CheckCircle } from 'lucide-react';

// Order type definitions
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit' | 'trailing_stop' | 'oco';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'GTT';

interface OrderFormProps {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  currentPrice?: number;
  balances?: {
    base: { available: number; locked: number };
    quote: { available: number; locked: number };
  };
  onSubmit?: (order: OrderSubmission) => void;
  type?: string;
}

export interface OrderSubmission {
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price: number;
  stopPrice?: number;
  trailingDelta?: number;
  timeInForce: TimeInForce;
  total: number;
  reduceOnly?: boolean;
  postOnly?: boolean;
  triggerCondition?: 'last_price' | 'mark_price' | 'index_price';
}

export function OrderForm({
  symbol = 'BTC/USDT',
  baseAsset = 'BTC',
  quoteAsset = 'USDT',
  currentPrice = 67245.50,
  balances = {
    base: { available: 2.5432, locked: 0.5 },
    quote: { available: 15000, locked: 2500 },
  },
  onSubmit,
  type = 'limit',
}: OrderFormProps) {
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [quantity, setQuantity] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [trailingDelta, setTrailingDelta] = useState<string>('0.5');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('GTC');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [triggerCondition, setTriggerCondition] = useState<'last_price' | 'mark_price'>('last_price');
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  // Get available balance
  const availableBalance = side === 'buy' ? balances.quote.available : balances.base.available;
  const balanceAsset = side === 'buy' ? quoteAsset : baseAsset;

  // Get possible quantity for sell
  const getPossibleQuantity = useCallback(() => {
    const prc = parseFloat(price) || currentPrice;
    if (prc <= 0) return 0;
    return balances.base.available;
  }, [price, currentPrice, balances.base.available]);

  // Handle percentage button
  const handlePercentage = (pct: number) => {
    if (side === 'buy') {
      const maxTotal = balances.quote.available * (pct / 100);
      const prc = parseFloat(price) || currentPrice;
      if (prc > 0) {
        setQuantity((maxTotal / prc).toFixed(6));
      }
    } else {
      const qty = getPossibleQuantity() * (pct / 100);
      setQuantity(qty.toFixed(6));
    }
  };

  // Get estimated fee
  const estimatedFee = useMemo(() => {
    return total * 0.001; // 0.1% fee
  }, [total]);

  // Validate order
  const validation = useMemo(() => {
    const errors: string[] = [];
    const qty = parseFloat(quantity);
    
    if (isNaN(qty) || qty <= 0) {
      errors.push('Enter a valid quantity');
    }
    
    if (orderType === 'limit' || orderType === 'stop_limit' || orderType === 'take_profit') {
      const prc = parseFloat(price);
      if (isNaN(prc) || prc <= 0) {
        errors.push('Enter a valid price');
      }
    }
    
    if (orderType.includes('stop') || orderType === 'take_profit') {
      const stop = parseFloat(stopPrice);
      if (isNaN(stop) || stop <= 0) {
        errors.push('Enter a valid stop price');
      } else {
        // Validate stop price conditions
        const prc = parseFloat(price) || currentPrice;
        if (side === 'buy' && stop <= prc && orderType !== 'take_profit') {
          errors.push('Stop price must be above current price for buy orders');
        }
        if (side === 'sell' && stop >= prc && orderType !== 'take_profit') {
          errors.push('Stop price must be below current price for sell orders');
        }
        if (side === 'buy' && stop >= prc && orderType === 'take_profit') {
          errors.push('Take profit price must be above current price for buy orders');
        }
        if (side === 'sell' && stop <= prc && orderType === 'take_profit') {
          errors.push('Take profit price must be below current price for sell orders');
        }
      }
    }
    
    if (orderType === 'trailing_stop') {
      const delta = parseFloat(trailingDelta);
      if (isNaN(delta) || delta <= 0) {
        errors.push('Enter a valid trailing delta');
      }
    }
    
    if (side === 'buy' && total > balances.quote.available) {
      errors.push(`Insufficient ${quoteAsset} balance`);
    }
    if (side === 'sell' && qty > getPossibleQuantity()) {
      errors.push(`Insufficient ${baseAsset} balance`);
    }
    
    return errors;
  }, [quantity, price, stopPrice, total, orderType, side, balances, currentPrice, trailingDelta, baseAsset, quoteAsset]);

  const canSubmit = validation.length === 0 && parseFloat(quantity) > 0;

  // Submit order
  const handleSubmit = async () => {
    if (!canSubmit) return;
    
    setSubmitting(true);
    
    const order: OrderSubmission = {
      side,
      type: orderType,
      quantity: parseFloat(quantity),
      price: parseFloat(price) || currentPrice,
      stopPrice: (orderType.includes('stop') || orderType === 'take_profit') ? parseFloat(stopPrice) : undefined,
      trailingDelta: orderType === 'trailing_stop' ? parseFloat(trailingDelta) : undefined,
      timeInForce,
      total,
      reduceOnly,
      postOnly,
      triggerCondition,
    };
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    onSubmit?.(order);
    setQuantity('');
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-semibold text-white">Place Order</h3>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
        >
          <Info className="w-3 h-3" />
          {showAdvanced ? 'Hide' : 'Show'} Advanced
        </button>
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
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-tiger-orange"
          >
            <option value="limit">Limit</option>
            <option value="market">Market</option>
            <option value="stop_limit">Stop Limit</option>
            <option value="stop_market">Stop Market</option>
            <option value="take_profit">Take Profit</option>
            <option value="trailing_stop">Trailing Stop</option>
            <option value="oco">OCO (One-Cancels-Other)</option>
          </select>
        </div>

        {/* Trigger Condition */}
        {(orderType.includes('stop') || orderType === 'take_profit') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Trigger Condition</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setTriggerCondition('last_price')}
                className={`py-1.5 text-xs rounded transition-all ${
                  triggerCondition === 'last_price'
                    ? 'bg-orange-500 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                Last Price
              </button>
              <button
                onClick={() => setTriggerCondition('mark_price')}
                className={`py-1.5 text-xs rounded transition-all ${
                  triggerCondition === 'mark_price'
                    ? 'bg-orange-500 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                Mark Price
              </button>
            </div>
          </div>
        )}

        {/* Price */}
        {(orderType === 'limit' || orderType === 'stop_limit' || orderType === 'take_profit') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Price ({quoteAsset})</label>
            <div className="relative">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-12 focus:outline-none focus:border-tiger-orange"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{quoteAsset}</span>
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {[1, 2, 5].map((pct) => (
                <button
                  key={pct}
                  onClick={() => {
                    const newPrice = currentPrice * (side === 'buy' ? (1 - pct / 100) : (1 + pct / 100));
                    setPrice(newPrice.toFixed(2));
                  }}
                  className="text-xs text-gray-400 hover:text-orange-400 bg-white/5 px-2 py-0.5 rounded"
                >
                  -{pct}%
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stop Price */}
        {(orderType.includes('stop') || orderType === 'take_profit') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              {orderType === 'take_profit' ? 'Take Profit Price' : 'Stop Price'} ({quoteAsset})
            </label>
            <div className="relative">
              <input
                type="number"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-12 focus:outline-none focus:border-tiger-orange"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{quoteAsset}</span>
            </div>
            {stopPrice && (
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                <AlertTriangle className="w-3 h-3" />
                <span>Order triggers when {triggerCondition === 'last_price' ? 'last' : 'mark'} price {side === 'buy' ? 'reaches' : 'reaches'} ${stopPrice}</span>
              </div>
            )}
          </div>
        )}

        {/* Trailing Delta */}
        {orderType === 'trailing_stop' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Trailing Delta (%)</label>
            <div className="relative">
              <input
                type="number"
                value={trailingDelta}
                onChange={(e) => setTrailingDelta(e.target.value)}
                placeholder="0.50"
                step="0.01"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-12 focus:outline-none focus:border-tiger-orange"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Activates when price moves {trailingDelta}% in your favor</p>
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-right pr-16 focus:outline-none focus:border-tiger-orange"
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
              className="py-1.5 text-xs bg-white/5 text-gray-400 rounded hover:bg-white/10 transition-colors"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Time in Force */}
        {(orderType === 'limit' || orderType === 'stop_limit') && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Time in Force</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['GTC', 'IOC', 'FOK', 'GTX'] as TimeInForce[]).map((tif) => (
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
            <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
              <span>GTC: Good Till Cancel</span>
              <span>IOC: Immediate or Cancel</span>
            </div>
          </div>
        )}

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="space-y-3 p-3 bg-white/5 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-white">Post Only</span>
                <p className="text-xs text-gray-500">Only place as maker</p>
              </div>
              <button
                onClick={() => setPostOnly(!postOnly)}
                className={`w-10 h-5 rounded-full transition-colors ${postOnly ? 'bg-orange-500' : 'bg-gray-600'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${postOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-white">Reduce Only</span>
                <p className="text-xs text-gray-500">Only reduce position</p>
              </div>
              <button
                onClick={() => setReduceOnly(!reduceOnly)}
                className={`w-10 h-5 rounded-full transition-colors ${reduceOnly ? 'bg-orange-500' : 'bg-gray-600'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${reduceOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}

        {/* Order Summary */}
        <div className="space-y-2 py-3 border-t border-white/10">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Order Value</span>
            <span className="text-white">{total.toFixed(2)} {quoteAsset}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Est. Fee (0.1%)</span>
            <span className="text-gray-300">{estimatedFee.toFixed(4)} {quoteAsset}</span>
          </div>
          {postOnly && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Fee Rebate (Post Only)</span>
              <span className="text-green-400">-{estimatedFee.toFixed(4)} {quoteAsset}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Net Total</span>
            <span className="text-white font-medium">{(total - (postOnly ? estimatedFee : estimatedFee * 2)).toFixed(2)} {quoteAsset}</span>
          </div>
        </div>

        {/* Available Balance */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Available</span>
          <span className="text-gray-300">
            {availableBalance.toFixed(4)} {balanceAsset}
          </span>
        </div>

        {/* Validation Errors */}
        {validation.length > 0 && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            {validation.map((error, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-red-400 mb-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            ))}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className={`w-full py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
            side === 'buy'
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Placing Order...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              {side === 'buy' ? 'Buy' : 'Sell'} {baseAsset}
            </>
          )}
        </button>
      </div>
    </div>
  );
}