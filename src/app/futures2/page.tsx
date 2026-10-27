'use client';

import React, { useMemo, useState } from 'react';
import { Settings, RefreshCw, BarChart3, Info } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface FuturesContract {
  id: string;
  symbol: string;
  contract_type?: string;
  max_leverage: number;
  mark_price: number;
  index_price: number;
  funding_rate: number;
  status: string;
}

interface FuturesPosition {
  id: string;
  contract_symbol: string;
  side: string;
  leverage: number;
  entry_price: number;
  mark_price: number;
  quantity: number;
  unrealized_pnl: number;
}

function formatNumber(value: number | undefined | null, digits = 4): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function FuturesTrading() {
  const contracts = useApiResource<unknown>('/api/futures/contracts');
  const positions = useApiResource<unknown>('/api/futures/positions');

  const contractList = useMemo(() => toArray<FuturesContract>(contracts.data), [contracts.data]);
  const positionList = useMemo(() => toArray<FuturesPosition>(positions.data), [positions.data]);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [leverage, setLeverage] = useState(10);
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState('limit');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');

  const currentPair =
    contractList.find((c) => c.symbol === selectedSymbol) || contractList[0] || null;

  const cost = useMemo(() => {
    const priceValue = parseFloat(price);
    const amountValue = parseFloat(amount);
    if (!Number.isFinite(priceValue) || !Number.isFinite(amountValue)) return null;
    return (priceValue * amountValue) / leverage;
  }, [price, amount, leverage]);

  return (
    <div className="h-screen bg-[#0A0A0F] text-white flex">
      {/* Left - Pairs */}
      <div className="w-56 border-r border-[rgba(255,255,255,0.1)]">
        <div className="p-3 border-b border-[rgba(255,255,255,0.1)] flex items-center justify-between">
          <h3 className="text-sm font-medium">Futures</h3>
          <button onClick={contracts.reload} className="p-1 hover:bg-[#1E1E24] rounded">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="overflow-y-auto">
          {contracts.loading && <p className="p-3 text-xs text-gray-500">Loading contracts…</p>}
          {contracts.error && (
            <p className="p-3 text-xs text-red-400">Could not load contracts: {contracts.error}</p>
          )}
          {!contracts.loading && !contracts.error && contractList.length === 0 && (
            <p className="p-3 text-xs text-gray-500">
              No futures markets are listed yet. Markets appear here once an admin lists them.
            </p>
          )}
          {contractList.map((pair) => (
            <button
              key={pair.symbol}
              onClick={() => {
                setSelectedSymbol(pair.symbol);
                setPrice(String(pair.mark_price ?? ''));
              }}
              className={`w-full p-3 flex justify-between hover:bg-[#1E1E24] ${
                currentPair?.symbol === pair.symbol
                  ? 'bg-[#1E1E24] border-l-2 border-[#FF6B35]'
                  : ''
              }`}
            >
              <div className="text-left">
                <p className="text-xs font-medium">{pair.symbol}</p>
                <p className="text-xs text-gray-500">{pair.contract_type ?? 'perpetual'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs">{formatNumber(pair.mark_price)}</p>
                <p className="text-xs text-gray-500">
                  funding {formatNumber((pair.funding_rate ?? 0) * 100, 4)}%
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center - Chart */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-[rgba(255,255,255,0.1)]">
          {currentPair ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">{currentPair.symbol}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xl font-bold">
                      {formatNumber(currentPair.mark_price)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="p-2 hover:bg-[#1E1E24] rounded-lg">
                    <Settings className="w-4 h-4" />
                  </button>
                  <button onClick={contracts.reload} className="p-2 hover:bg-[#1E1E24] rounded-lg">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-xs text-gray-500">
                <span>Mark: {formatNumber(currentPair.mark_price)}</span>
                <span>Index: {formatNumber(currentPair.index_price)}</span>
                <span>Funding: {formatNumber((currentPair.funding_rate ?? 0) * 100, 4)}%</span>
                <span>Max leverage: {currentPair.max_leverage}x</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">Select a market to trade.</p>
          )}
        </div>

        <div className="flex-1 bg-[#0D0D12] flex items-center justify-center">
          <div className="text-center text-gray-500">
            <BarChart3 className="w-16 h-16 mx-auto mb-2 opacity-50" />
            <p>Chart data is served by the market data service.</p>
          </div>
        </div>

        {/* Positions */}
        <div className="h-48 border-t border-[rgba(255,255,255,0.1)] p-4 overflow-y-auto">
          <h3 className="text-sm font-medium mb-3">Open Positions</h3>
          {positions.loading && <p className="text-sm text-gray-500">Loading positions…</p>}
          {positions.error && (
            <p className="text-sm text-red-400">Could not load positions: {positions.error}</p>
          )}
          {!positions.loading && !positions.error && positionList.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-4">No open positions</div>
          )}
          {positionList.map((position) => (
            <div
              key={position.id}
              className="grid grid-cols-6 gap-2 text-xs py-2 border-b border-[rgba(255,255,255,0.05)]"
            >
              <span className="font-medium">{position.contract_symbol}</span>
              <span className={position.side === 'long' ? 'text-green-500' : 'text-red-500'}>
                {position.side}
              </span>
              <span>{position.leverage}x</span>
              <span>{formatNumber(position.quantity)}</span>
              <span>{formatNumber(position.entry_price)}</span>
              <span className={position.unrealized_pnl >= 0 ? 'text-green-500' : 'text-red-500'}>
                {formatNumber(position.unrealized_pnl, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right - Order Form */}
      <div className="w-72 border-l border-[rgba(255,255,255,0.1)] p-4">
        <div className="flex rounded-lg overflow-hidden mb-4">
          <button
            onClick={() => setSide('long')}
            className={`flex-1 py-2 text-center font-medium ${
              side === 'long' ? 'bg-green-600' : 'bg-[#14141A] text-gray-500'
            }`}
          >
            Long
          </button>
          <button
            onClick={() => setSide('short')}
            className={`flex-1 py-2 text-center font-medium ${
              side === 'short' ? 'bg-red-600' : 'bg-[#14141A] text-gray-500'
            }`}
          >
            Short
          </button>
        </div>

        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Leverage</span>
            <span className="text-[#FF6B35]">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max={currentPair?.max_leverage ?? 125}
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1x</span>
            <span>{currentPair?.max_leverage ?? 125}x</span>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {['limit', 'market', 'stop_limit'].map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className={`flex-1 py-1.5 text-xs rounded-lg ${
                orderType === type ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}
            >
              {type === 'stop_limit' ? 'Stop' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        {orderType !== 'market' && (
          <div className="mb-3">
            <label className="text-xs text-gray-500">Price</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-[#14141A] rounded-lg py-2 px-3 text-sm"
            />
          </div>
        )}

        <div className="mb-3">
          <label className="text-xs text-gray-500">Amount (Contracts)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-[#14141A] rounded-lg py-2 px-3 text-sm"
          />
        </div>

        <div className="flex justify-between text-sm mb-4">
          <span className="text-gray-500">Cost</span>
          <span>{cost === null ? '—' : cost.toFixed(2)}</span>
        </div>

        <button
          disabled={!currentPair}
          className={`w-full py-3 rounded-lg font-medium disabled:opacity-50 ${
            side === 'long' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {side === 'long' ? 'Long' : 'Short'} {currentPair?.symbol ?? ''}
        </button>

        <div className="mt-4 flex items-start gap-2 text-xs text-gray-500">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Balances and positions come from your account. Nothing is simulated.</span>
        </div>
      </div>
    </div>
  );
}
