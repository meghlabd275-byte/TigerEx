'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency, formatNumber, formatPercent, getPriceClass } from '@/lib/utils';
import { AreaChart, CandlestickChart, LineChart } from 'lucide-react';

interface Order {
  id: string;
  price: number;
  quantity: number;
  total: number;
}

interface Trade {
  id: string;
  price: number;
  quantity: number;
  time: string;
  type: 'buy' | 'sell';
}

interface Market {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
}

export default function TradePage({ params }: { params: { symbol: string } }) {
  const symbol = params?.symbol || 'BTC/USDT';
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('43250.00');
  const [quantity, setQuantity] = useState('');
  const [activeTab, setActiveTab] = useState<'orderbook' | 'trades' | 'orders'>('orderbook');

  const mockMarket: Market = {
    symbol: 'BTC/USDT',
    name: 'Bitcoin',
    price: 43250.00,
    change: 1250.00,
    changePercent: 2.98,
    high: 44500.00,
    low: 41800.00,
    volume: 2850000000,
  };

  const bids: Order[] = [
    { id: '1', price: 43245.00, quantity: 2.5, total: 108612.50 },
    { id: '2', price: 43240.00, quantity: 1.8, total: 77832.00 },
    { id: '3', price: 43235.00, quantity: 3.2, total: 138344.00 },
    { id: '4', price: 43230.00, quantity: 0.5, total: 21615.00 },
    { id: '5', price: 43225.00, quantity: 4.1, total: 177222.50 },
  ];

  const asks: Order[] = [
    { id: '1', price: 43255.00, quantity: 1.2, total: 51906.00 },
    { id: '2', price: 43260.00, quantity: 2.8, total: 121128.00 },
    { id: '3', price: 43265.00, quantity: 0.9, total: 38938.50 },
    { id: '4', price: 43270.00, quantity: 3.5, total: 151445.00 },
    { id: '5', price: 43275.00, quantity: 1.1, total: 47602.50 },
  ];

  const trades: Trade[] = [
    { id: '1', price: 43250.00, quantity: 0.5, time: '18:05:23', type: 'buy' },
    { id: '2', price: 43248.00, quantity: 1.2, time: '18:04:55', type: 'sell' },
    { id: '3', price: 43252.00, quantity: 0.8, time: '18:04:12', type: 'buy' },
    { id: '4', price: 43245.00, quantity: 2.0, time: '18:03:44', type: 'sell' },
    { id: '5', price: 43260.00, quantity: 0.3, time: '18:03:21', type: 'buy' },
  ];

  const total = parseFloat(quantity || '0') * mockMarket.price;

  return (
    <div className="min-h-screen bg-tiger-black text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
                <span className="text-xl font-bold text-white">T</span>
              </div>
              <span className="text-lg font-bold">TigerEx</span>
            </div>
            <div className="h-6 w-px bg-white/20" />
            <div>
              <h1 className="text-lg font-semibold">{mockMarket.symbol}</h1>
              <p className="text-xs text-gray-400">{mockMarket.name}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xl font-bold">${formatCurrency(mockMarket.price)}</p>
              <p className={cn('text-sm', getPriceClass(mockMarket.change))}>
                {formatPercent(mockMarket.changePercent)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <LineChart className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <CandlestickChart className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <AreaChart className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Order Form */}
          <div className="lg:col-span-1 space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/5 p-1">
              <button
                onClick={() => setSide('buy')}
                className={cn('rounded-md py-2 font-medium transition-colors', side === 'buy' ? 'bg-profit text-white' : 'text-gray-400 hover:text-white')}
              >
                Buy
              </button>
              <button
                onClick={() => setSide('sell')}
                className={cn('rounded-md py-2 font-medium transition-colors', side === 'sell' ? 'bg-loss text-white' : 'text-gray-400 hover:text-white')}
              >
                Sell
              </button>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => setOrderType('limit')}
                  className={cn('flex-1 rounded-md py-1.5 text-sm font-medium', orderType === 'limit' ? 'bg-white/10 text-white' : 'text-gray-400')}
                >
                  Limit
                </button>
                <button
                  onClick={() => setOrderType('market')}
                  className={cn('flex-1 rounded-md py-1.5 text-sm font-medium', orderType === 'market' ? 'bg-white/10 text-white' : 'text-gray-400')}
                >
                  Market
                </button>
              </div>

              <div className="mb-4 rounded-md bg-white/5 p-3">
                <p className="text-xs text-gray-400">Available</p>
                <p className="text-sm font-medium">12,450.00 USDT</p>
              </div>

              {orderType === 'limit' && (
                <div className="mb-4">
                  <label className="mb-1 block text-xs text-gray-400">Price (USDT)</label>
                  <input
                    type="text"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="mb-1 block text-xs text-gray-400">Amount</label>
                <input
                  type="text"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                />
              </div>

              <div className="mb-4 rounded-md bg-white/5 p-3">
                <p className="text-xs text-gray-400">Total</p>
                <p className="text-sm font-medium">${formatNumber(total)}</p>
              </div>

              <Button
                className={cn('w-full py-3 font-semibold', side === 'buy' ? 'bg-profit hover:bg-profit-light' : 'bg-loss hover:bg-loss-light')}
              >
                {side === 'buy' ? 'Buy BTC' : 'Sell BTC'}
              </Button>
            </div>
          </div>

          {/* Chart */}
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4" style={{ height: '500px' }}>
              <div className="flex h-full items-center justify-center text-gray-500">
                <div className="text-center">
                  <AreaChart className="mx-auto h-16 w-16 opacity-50" />
                  <p className="mt-2">TradingView Chart</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-4">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-gray-400">24h Change</p>
                <p className={cn('text-sm font-medium', getPriceClass(mockMarket.change))}>{formatPercent(mockMarket.changePercent)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-gray-400">24h High</p>
                <p className="text-sm font-medium">${formatCurrency(mockMarket.high)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-gray-400">24h Low</p>
                <p className="text-sm font-medium">${formatCurrency(mockMarket.low)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-gray-400">24h Volume</p>
                <p className="text-sm font-medium">${formatNumber(mockMarket.volume)}</p>
              </div>
            </div>
          </div>

          {/* Order Book */}
          <div className="lg:col-span-1">
            <div className="rounded-lg border border-white/10 bg-white/5">
              <div className="flex border-b border-white/10">
                <button onClick={() => setActiveTab('orderbook')} className={cn('flex-1 py-2 text-sm font-medium', activeTab === 'orderbook' ? 'border-b-2 border-tiger-orange text-white' : 'text-gray-400')}>Order Book</button>
                <button onClick={() => setActiveTab('trades')} className={cn('flex-1 py-2 text-sm font-medium', activeTab === 'trades' ? 'border-b-2 border-tiger-orange text-white' : 'text-gray-400')}>Trades</button>
              </div>

              {activeTab === 'orderbook' && (
                <div className="p-2">
                  <div className="space-y-0.5">
                    {[...asks].reverse().map((ask) => (
                      <div key={ask.id} className="relative flex px-2 py-1 text-xs">
                        <div className="absolute inset-0 bg-loss/10" style={{ width: `${(ask.total / asks[0].total) * 100}%`, right: 0 }} />
                        <span className="flex-1 relative z-10 text-loss">{ask.price.toFixed(2)}</span>
                        <span className="flex-1 relative z-10 text-right">{ask.quantity}</span>
                        <span className="flex-1 relative z-10 text-right">{formatNumber(ask.total)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="my-2 py-2 text-center border-y border-white/10">
                    <p className="text-xl font-bold text-profit">${formatCurrency(mockMarket.price)}</p>
                  </div>

                  <div className="space-y-0.5">
                    {bids.map((bid) => (
                      <div key={bid.id} className="relative flex px-2 py-1 text-xs">
                        <div className="absolute inset-0 bg-profit/10" style={{ width: `${(bid.total / bids[0].total) * 100}%`, right: 0 }} />
                        <span className="flex-1 relative z-10 text-profit">{bid.price.toFixed(2)}</span>
                        <span className="flex-1 relative z-10 text-right">{bid.quantity}</span>
                        <span className="flex-1 relative z-10 text-right">{formatNumber(bid.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'trades' && (
                <div className="p-2">
                  {trades.map((trade) => (
                    <div key={trade.id} className="flex px-2 py-1 text-xs">
                      <span className={cn('flex-1', trade.type === 'buy' ? 'text-profit' : 'text-loss')}>{trade.price.toFixed(2)}</span>
                      <span className="flex-1 text-right">{trade.quantity}</span>
                      <span className="flex-1 text-right text-gray-500">{trade.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}