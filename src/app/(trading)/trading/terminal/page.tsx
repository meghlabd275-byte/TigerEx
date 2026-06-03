'use client';

/**
 * TradingTerminal - Complete Trading Terminal
 * Production-grade trading interface with order book, charts, order management
 */

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

// Types
interface Order {
  id: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop_limit';
  price: number;
  amount: number;
  filled: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled';
  createdAt: number;
}

interface Trade {
  id: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  time: number;
}

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  markPrice: number;
  amount: number;
  leverage: number;
  unrealizedPNL: number;
  liquidationPrice: number;
  marginUsed: number;
}

interface Ticker {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  change24h: number;
  changePercent24h: number;
  timestamp: number;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Component: TradingView Chart
const TradingChart = ({ symbol, theme = 'dark' }: { symbol?: string; theme?: 'light' | 'dark' }) => {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCandles = async () => {
      try {
        const res = await fetch(`/api/market/candles?symbol=${symbol || 'BTCUSDT'}&interval=1h&limit=100`);
        const data = await res.json();
        setCandles(data.candles || []);
      } catch (err) {
        console.error('Failed to fetch candles:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCandles();
    const interval = setInterval(fetchCandles, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <span className="text-gray-500 animate-pulse">Loading chart...</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={candles}>
        <defs>
          <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis 
          dataKey="time" 
          tickFormatter={(t) => new Date(t * 1000).toLocaleTimeString()}
          stroke="#6B7280"
          fontSize={10}
        />
        <YAxis 
          domain={['auto', 'auto']}
          tickFormatter={(v) => v.toFixed(0)}
          stroke="#6B7280"
          fontSize={10}
          width={60}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }}
          labelFormatter={(t) => new Date(t * 1000).toLocaleString()}
          formatter={(v: number) => [v.toFixed(2), 'Price']}
        />
        <Area type="monotone" dataKey="close" stroke="#10B981" fillOpacity={1} fill="url(#colorClose)" />
      </AreaChart>
    </ResponsiveContainer>
  );
};

// Component: Order Book
const OrderBookPanel = ({ symbol, theme = 'dark' }: { symbol?: string; theme?: 'light' | 'dark' }) => {
  const [bids, setBids] = useState<Array<{ price: number; amount: number; total: number }>>([]);
  const [asks, setAsks] = useState<Array<{ price: number; amount: number; total: number }>>([]);
  const [spread, setSpread] = useState(0);
  const [midPrice, setMidPrice] = useState(0);

  useEffect(() => {
    const fetchOrderBook = async () => {
      try {
        const res = await fetch(`/api/market/orderbook?symbol=${symbol || 'BTCUSDT'}&limit=20`);
        const data = await res.json();
        setBids(data.bids || []);
        setAsks(data.asks || []);
        setSpread(data.spread || 0);
        setMidPrice(data.midPrice || 0);
      } catch (err) {
        console.error('Failed to fetch order book:', err);
      }
    };

    fetchOrderBook();
    const interval = setInterval(fetchOrderBook, 500);
    return () => clearInterval(interval);
  }, [symbol]);

  const maxAskTotal = Math.max(...asks.map(a => a.total), 1);
  const maxBidTotal = Math.max(...bids.map(b => b.total), 1);

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex justify-between px-2 py-1 text-gray-400 font-medium">
        <span>Price</span>
        <span>Amount</span>
        <span>Total</span>
      </div>

      {/* Asks - reversed */}
      <div className="flex-1 overflow-y-auto flex flex-col-reverse">
        {asks.slice(0, 15).map((ask, i) => (
          <div key={i} className="flex justify-between px-2 py-0.5 relative">
            <div className="absolute right-0 top-0 bottom-0 bg-red-500/20" style={{ width: `${(ask.total / maxAskTotal) * 100}%` }} />
            <span className="text-red-500 relative z-10">{ask.price.toFixed(2)}</span>
            <span className="text-gray-300">{ask.amount.toFixed(4)}</span>
            <span className="text-gray-500">{ask.total.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div className="flex justify-center py-2 border-y border-gray-700">
        <span className="text-lg font-bold text-green-500">{midPrice > 0 ? midPrice.toFixed(2) : '--'}</span>
        <span className="ml-2 text-xs text-gray-500">Spread: {spread > 0 ? spread.toFixed(2) : '--'}</span>
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-y-auto">
        {bids.slice(0, 15).map((bid, i) => (
          <div key={i} className="flex justify-between px-2 py-0.5 relative">
            <div className="absolute right-0 top-0 bottom-0 bg-green-500/20" style={{ width: `${(bid.total / maxBidTotal) * 100}%` }} />
            <span className="text-green-500 relative z-10">{bid.price.toFixed(2)}</span>
            <span className="text-gray-300">{bid.amount.toFixed(4)}</span>
            <span className="text-gray-500">{bid.total.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Component: Order Form
const OrderEntry = ({ 
  symbol = 'BTCUSDT', 
  currentPrice, 
  balances = {},
  theme = 'dark'
}: { 
  symbol?: string; 
  currentPrice: number; 
  balances?: Record<string, number>;
  theme?: 'light' | 'dark';
}) => {
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState(currentPrice);
  const [amount, setAmount] = useState(0);
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const baseCurrency = symbol.replace('USDT', '');
  const quoteCurrency = 'USDT';
  const availableQuote = balances[quoteCurrency] || 0;
  const availableBase = balances[baseCurrency] || 0;

  const total = orderType === 'limit' ? price * amount : currentPrice * amount;
  const fee = total * 0.001;
  const totalWithFee = side === 'buy' ? total + fee : total - fee;

  const maxBuyAmount = availableQuote > 0 ? (availableQuote / currentPrice) * 0.99 : 0;
  const maxSellAmount = availableBase * 0.99;

  useEffect(() => {
    if (orderType === 'market') {
      setPrice(currentPrice);
    }
  }, [orderType, currentPrice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) return;
    
    setSubmitting(true);
    try {
      const order = {
        symbol,
        side,
        type: orderType,
        price: orderType === 'market' ? currentPrice : price,
        amount,
        postOnly,
        reduceOnly,
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });

      if (!res.ok) throw new Error('Order failed');
      setAmount(0);
    } catch (err) {
      console.error('Order failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const setPercent = (pct: number) => {
    const max = side === 'buy' ? maxBuyAmount : maxSellAmount;
    setAmount(max * pct);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
      {/* Order Type */}
      <div className="flex rounded-lg overflow-hidden bg-gray-800">
        <button type="button" onClick={() => setOrderType('limit')} className={`flex-1 py-2 text-sm font-medium ${orderType === 'limit' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
          Limit
        </button>
        <button type="button" onClick={() => setOrderType('market')} className={`flex-1 py-2 text-sm font-medium ${orderType === 'market' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
          Market
        </button>
      </div>

      {/* Side */}
      <div className="flex rounded-lg overflow-hidden bg-gray-800">
        <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-2 text-sm font-medium ${side === 'buy' ? 'bg-green-500 text-white' : 'text-gray-400'}`}>
          Buy
        </button>
        <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-2 text-sm font-medium ${side === 'sell' ? 'bg-red-500 text-white' : 'text-gray-400'}`}>
          Sell
        </button>
      </div>

      {/* Price */}
      {orderType === 'limit' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Price</label>
          <input type="number" value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white" step="0.01" />
        </div>
      )}

      {/* Amount */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Amount ({baseCurrency})</label>
        <input type="number" value={amount} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white" step="0.0001" />
        <div className="flex gap-1">
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <button key={p} type="button" onClick={() => setPercent(p)} className="flex-1 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600">
              {p * 100}%
            </button>
          ))}
        </div>
      </div>

      {/* Available */}
      <div className="flex justify-between text-xs text-gray-400">
        <span>Available:</span>
        <span>{side === 'buy' ? `${availableQuote.toFixed(2)} USDT` : `${availableBase.toFixed(4)} ${baseCurrency}`}</span>
      </div>

      {/* Options */}
      <div className="flex gap-4 text-xs text-gray-400">
        <label className="flex items-center gap-1"><input type="checkbox" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />Post Only</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />Reduce Only</label>
      </div>

      {/* Summary */}
      <div className="p-3 bg-gray-800 rounded-lg">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Total:</span><span>{total.toFixed(4)} USDT</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">Total {side === 'buy' ? 'Pay' : 'Receive'}:</span>
          <span className={side === 'buy' ? 'text-green-500' : 'text-red-500'}>{totalWithFee.toFixed(4)} USDT</span>
        </div>
      </div>

      {/* Submit */}
      <button type="submit" disabled={submitting || amount <= 0} className={`w-full py-3 rounded-lg font-semibold ${side === 'buy' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'} text-white disabled:opacity-50`}>
        {submitting ? 'Processing...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${baseCurrency}`}
      </button>
    </form>
  );
};

// Component: Open Orders
const OrdersPanel = ({ orders = [], onCancel, theme = 'dark' }: { orders?: Order[]; onCancel?: (id: string) => void; theme?: 'light' | 'dark' }) => {
  const handleCancel = async (orderId: string) => {
    try {
      await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
      onCancel?.(orderId);
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex justify-between px-2 py-1 text-gray-400 font-medium">
        <span>Type</span><span>Price</span><span>Amount</span><span>Filled</span><span></span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">No open orders</div>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="flex justify-between px-2 py-2 border-b border-gray-700">
              <span className={order.side === 'buy' ? 'text-green-500' : 'text-red-500'}>{order.side} {order.type}</span>
              <span>{order.price.toFixed(2)}</span>
              <span>{order.amount.toFixed(4)}</span>
              <span>{order.filled.toFixed(4)}</span>
              <button onClick={() => handleCancel(order.id)} className="text-red-500 hover:text-red-400">Cancel</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// Component: Positions
const PositionsPanel = ({ positions = [], onClose, theme = 'dark' }: { positions?: Position[]; onClose?: (id: string) => void; theme?: 'light' | 'dark' }) => {
  return (
    <div className="flex flex-col h-full">
      {positions.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500">No positions</div>
      ) : (
        positions.map((pos) => (
          <div key={pos.id} className="p-3 border-b border-gray-700">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span className={pos.side === 'long' ? 'text-green-500' : 'text-red-500'}>{pos.side.toUpperCase()}</span>
                <span className="font-medium">{pos.symbol}</span>
                <span className="text-xs px-1 bg-gray-700 rounded">{pos.leverage}x</span>
              </div>
              <button onClick={() => onClose?.(pos.id)} className="px-2 py-1 text-xs bg-red-500/20 text-red-500 rounded">Close</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-500">Entry:</span> <span>{pos.entryPrice.toFixed(2)}</span></div>
              <div><span className="text-gray-500">Mark:</span> <span>{pos.markPrice.toFixed(2)}</span></div>
              <div><span className="text-gray-500">Amount:</span> <span>{pos.amount.toFixed(4)}</span></div>
              <div><span className="text-gray-500">Liq:</span> <span className="text-red-500">{pos.liquidationPrice.toFixed(2)}</span></div>
              <div className="col-span-2"><span className="text-gray-500">PNL:</span> <span className={pos.unrealizedPNL >= 0 ? 'text-green-500' : 'text-red-500'}>{pos.unrealizedPNL >= 0 ? '+' : ''}{pos.unrealizedPNL.toFixed(2)}</span></div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// Component: Market Stats
const MarketStats = ({ ticker, theme = 'dark' }: { ticker?: Ticker | null; theme?: 'light' | 'dark' }) => {
  if (!ticker) return <div className="h-8 bg-gray-800 animate-pulse" />;

  const changeColor = ticker.last >= ticker.open ? 'text-green-500' : 'text-red-500';
  const changeAmt = ticker.last - ticker.open;
  const changePct = (changeAmt / ticker.open) * 100;

  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-gray-800 text-sm">
      <div>
        <span className="font-bold text-lg">{ticker.symbol}</span>
        <span className={`ml-3 ${changeColor}`}>
          {ticker.last.toFixed(2)} USDT
          <span className="ml-2 text-xs">{changeAmt >= 0 ? '+' : ''}{changeAmt.toFixed(2)} ({changePct.toFixed(2)}%)</span>
        </span>
      </div>
      <div className="flex flex-col text-xs text-gray-400">
        <span>24h High</span><span>{ticker.high.toFixed(2)}</span>
      </div>
      <div className="flex flex-col text-xs text-gray-400">
        <span>24h Low</span><span>{ticker.low.toFixed(2)}</span>
      </div>
      <div className="flex flex-col text-xs text-gray-400">
        <span>24h Vol</span><span>{ticker.volume.toFixed(2)}</span>
      </div>
      <div className="flex flex-col text-xs text-gray-400">
        <span>Bid/Ask</span>
        <span><span className="text-green-500">{ticker.bid.toFixed(2)}</span>/<span className="text-red-500">{ticker.ask.toFixed(2)}</span></span>
      </div>
    </div>
  );
};

// Main: Trading Terminal Page
export default function TradingTerminalPage() {
  const [symbol] = useState('BTCUSDT');
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [currentView, setCurrentView] = useState<'orders' | 'positions' | 'history'>('orders');
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tickerRes, ordersRes, positionsRes, balancesRes] = await Promise.all([
          fetch(`/api/market/ticker?symbol=${symbol}`),
          fetch('/api/orders'),
          fetch('/api/positions'),
          fetch('/api/balances'),
        ]);

        setTicker(await tickerRes.json());
        setOrders((await ordersRes.json()).orders || []);
        setPositions((await positionsRes.json()).positions || []);
        setBalances((await balancesRes.json()).balances || {});
      } catch (err) {
        console.error('Fetch failed:', err);
      }
    };

    fetchData();

    // WebSocket for real-time updates
    const ws = new WebSocket(`wss://api.tigerex.com/ws/${symbol.toLowerCase()}`);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'ticker') setTicker(data);
      if (data.type === 'order_update') setOrders(prev => [...prev.filter(o => o.id !== data.order.id), data.order]);
      if (data.type === 'position_update') setPositions(prev => [...prev.filter(p => p.id !== data.position.id), data.position]);
    };

    return () => ws.close();
  }, [symbol]);

  const handleCancelOrder = (orderId: string) => setOrders(prev => prev.filter(o => o.id !== orderId));
  const handleClosePosition = async (positionId: string) => {
    try {
      await fetch(`/api/positions/${positionId}/close`, { method: 'POST' });
      setPositions(prev => prev.filter(p => p.id !== positionId));
    } catch (err) {
      console.error('Close failed:', err);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header Stats */}
      <MarketStats ticker={ticker} />
      
      {/* Connection Status */}
      <div className="flex items-center gap-2 px-4 py-1 text-xs">
        <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className={wsConnected ? 'text-green-500' : 'text-red-500'}>{wsConnected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Order Book */}
        <div className="w-64 border-r border-gray-700 flex flex-col">
          <div className="flex-1 p-2 bg-gray-800">
            <OrderBookPanel symbol={symbol} />
          </div>
        </div>

        {/* Center: Chart + Order Form */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-2">
            <TradingChart symbol={symbol} />
          </div>
          <div className="h-[380px] border-t border-gray-700">
            <OrderEntry symbol={symbol} currentPrice={ticker?.last || 0} balances={balances} />
          </div>
        </div>

        {/* Right: Orders/Positions */}
        <div className="w-80 border-l border-gray-700 flex flex-col">
          <div className="flex border-b border-gray-700">
            {(['orders', 'positions'] as const).map((tab) => (
              <button key={tab} onClick={() => setCurrentView(tab)} className={`flex-1 py-2 text-sm font-medium ${currentView === tab ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-400'}`}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1 p-2">
            {currentView === 'orders' && <OrdersPanel orders={orders} onCancel={handleCancelOrder} />}
            {currentView === 'positions' && <PositionsPanel positions={positions} onClose={handleClosePosition} />}
          </div>
        </div>
      </div>
    </div>
  );
}