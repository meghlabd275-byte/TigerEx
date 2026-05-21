/**
 * TigerEx TypeScript Frontend - Trading Terminal
 * 
 * LANGUAGE: TypeScript + React + Next.js
 * 
 * Features:
 * - Real-time trading interface
 * - Advanced charting
 * - Order book visualization
 * - Portfolio management
 */

import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// ========================================================================
// TYPES
// ========================================================================

interface Ticker {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

interface Order {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop_loss';
  price: number;
  quantity: number;
  filled: number;
  status: 'pending' | 'filled' | 'cancelled';
}

interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

// ========================================================================
// WEBSOCKET HOOK
// ========================================================================

export function useWebSocket(url: string) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages((prev) => [...prev.slice(-100), data]);
    };

    setSocket(ws);

    return () => ws.close();
  }, [url]);

  const send = useCallback((data: any) => {
    socket?.send(JSON.stringify(data));
  }, [socket]);

  return { connected, messages, send };
}

// ========================================================================
// TRADING COMPONENTS
// ========================================================================

interface TradingPairSelectorProps {
  pairs: string[];
  selected: string;
  onSelect: (pair: string) => void;
}

export function TradingPairSelector({ pairs, selected, onSelect }: TradingPairSelectorProps) {
  return (
    <div className="pair-selector">
      <select value={selected} onChange={(e) => onSelect(e.target.value)}>
        {pairs.map((pair) => (
          <option key={pair} value={pair}>{pair}</option>
        ))}
      </select>
    </div>
  );
}

interface PriceChartProps {
  data: { time: string; price: number }[];
  symbol: string;
}

export function PriceChart({ data, symbol }: PriceChartProps) {
  return (
    <div className="price-chart">
      <h3>{symbol}</h3>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <XAxis dataKey="time" />
          <YAxis domain={['auto', 'auto']} />
          <Tooltip />
          <Line type="monotone" dataKey="price" stroke="#00C853" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface OrderBookProps {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  onPriceClick: (price: number) => void;
}

export function OrderBook({ bids, asks, onPriceClick }: OrderBookProps) {
  const maxTotal = Math.max(
    ...bids.map((b) => b.total),
    ...asks.map((a) => a.total)
  );

  return (
    <div className="order-book">
      <div className="order-book-header">
        <span>Price</span>
        <span>Amount</span>
        <span>Total</span>
      </div>
      
      <div className="asks">
        {asks.slice(0, 15).reverse().map((ask, i) => (
          <div key={i} className="order-book-row ask" onClick={() => onPriceClick(ask.price)}>
            <span className="price" style={{ color: '#FF5252' }}>{ask.price.toFixed(2)}</span>
            <span className="amount">{ask.amount.toFixed(4)}</span>
            <span className="total">{ask.total.toFixed(4)}</span>
            <div className="depth-bar" style={{ width: `${(ask.total / maxTotal) * 100}%` }} />
          </div>
        ))}
      </div>
      
      <div className="spread">
        Spread: {((asks[0]?.price || 0) - (bids[0]?.price || 0)).toFixed(2)}
      </div>
      
      <div className="bids">
        {bids.slice(0, 15).map((bid, i) => (
          <div key={i} className="order-book-row bid" onClick={() => onPriceClick(bid.price)}>
            <span className="price" style={{ color: '#00C853' }}>{bid.price.toFixed(2)}</span>
            <span className="amount">{bid.amount.toFixed(4)}</span>
            <span className="total">{bid.total.toFixed(4)}</span>
            <div className="depth-bar" style={{ width: `${(bid.total / maxTotal) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface OrderFormProps {
  symbol: string;
  currentPrice: number;
  onSubmit: (order: Omit<Order, 'orderId' | 'status' | 'filled'>) => void;
}

export function OrderForm({ symbol, currentPrice, onSubmit }: OrderFormProps) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState(currentPrice.toString());
  const [quantity, setQuantity] = useState('');
  const [leverage, setLeverage] = useState(1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      symbol,
      side,
      type: type as 'limit' | 'market',
      price: parseFloat(price),
      quantity: parseFloat(quantity),
    });
  };

  const total = parseFloat(quantity || '0') * parseFloat(price || '0');

  return (
    <form className="order-form" onSubmit={handleSubmit}>
      <div className="order-type-tabs">
        <button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>
          Buy
        </button>
        <button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>
          Sell
        </button>
      </div>

      <div className="order-options">
        <label>
          <input type="radio" name="orderType" checked={type === 'limit'} onChange={() => setType('limit')} />
          Limit
        </label>
        <label>
          <input type="radio" name="orderType" checked={type === 'market'} onChange={() => setType('market')} />
          Market
        </label>
      </div>

      {type === 'limit' && (
        <div className="form-group">
          <label>Price</label>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} step="0.01" />
        </div>
      )}

      <div className="form-group">
        <label>Amount</label>
        <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} step="0.001" />
      </div>

      <div className="form-group">
        <label>Leverage: {leverage}x</label>
        <input type="range" min="1" max="125" value={leverage} onChange={(e) => setLeverage(parseInt(e.target.value))} />
      </div>

      <div className="order-summary">
        <div>Total: {total.toFixed(2)} USDT</div>
      </div>

      <button type="submit" className={`submit-btn ${side}`}>
        {side === 'buy' ? 'Buy' : 'Sell'} {symbol.split('/')[0]}
      </button>
    </form>
  );
}

interface PositionsTableProps {
  positions: Position[];
}

export function PositionsTable({ positions }: PositionsTableProps) {
  return (
    <div className="positions-table">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Size</th>
            <th>Entry</th>
            <th>Mark Price</th>
            <th>PNL</th>
            <th>Leverage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos, i) => (
            <tr key={i}>
              <td>{pos.symbol}</td>
              <td className={pos.side === 'long' ? 'long' : 'short'}>{pos.side.toUpperCase()}</td>
              <td>{pos.size.toFixed(4)}</td>
              <td>{pos.entryPrice.toFixed(2)}</td>
              <td>{pos.markPrice.toFixed(2)}</td>
              <td className={pos.unrealizedPnl >= 0 ? 'profit' : 'loss'}>
                {pos.unrealizedPnl.toFixed(2)} USDT ({((pos.unrealizedPnl / (pos.entryPrice * pos.size)) * 100).toFixed(2)}%)
              </td>
              <td>{pos.leverage}x</td>
              <td>
                <button>Close</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ========================================================================
// MAIN TRADING PAGE
// ========================================================================

export default function TradingPage() {
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookEntry[]; asks: OrderBookEntry[] }>({ bids: [], asks: [] });
  const [positions, setPositions] = useState<Position[]>([]);
  const [chartData, setChartData] = useState<{ time: string; price: number }[]>([]);

  const { connected, messages } = useWebSocket('wss://api.tigerex.com/ws');

  // Simulated data for demo
  useEffect(() => {
    setTicker({
      symbol: 'BTC/USDT',
      price: 50000,
      change24h: 2.5,
      volume24h: 1000000000,
      high24h: 51000,
      low24h: 49000,
    });

    const bids: OrderBookEntry[] = [];
    const asks: OrderBookEntry[] = [];
    let bidTotal = 0, askTotal = 0;

    for (let i = 0; i < 20; i++) {
      bidTotal += Math.random() * 2;
      bids.push({ price: 50000 - i * 5, amount: Math.random() * 2, total: bidTotal });
      
      askTotal += Math.random() * 2;
      asks.push({ price: 50005 + i * 5, amount: Math.random() * 2, total: askTotal });
    }

    setOrderBook({ bids, asks });

    // Generate chart data
    const data = [];
    let price = 50000;
    for (let i = 0; i < 100; i++) {
      price += (Math.random() - 0.5) * 100;
      data.push({ time: new Date(Date.now() - (100 - i) * 60000).toLocaleTimeString(), price });
    }
    setChartData(data);

    setPositions([
      { symbol: 'BTC/USDT', side: 'long', size: 0.5, entryPrice: 49000, markPrice: 50000, unrealizedPnl: 500, leverage: 10 },
      { symbol: 'ETH/USDT', side: 'short', size: 10, entryPrice: 2800, markPrice: 2750, unrealizedPnl: 500, leverage: 5 },
    ]);
  }, []);

  const handleOrderSubmit = (order: any) => {
    console.log('Order submitted:', order);
    alert(`Order ${order.side} ${order.quantity} ${order.symbol} at ${order.price}`);
  };

  if (!ticker) return <div>Loading...</div>;

  return (
    <div className="trading-page">
      <header className="trading-header">
        <h1>TigerEx</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : ''}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <div className="trading-main">
        <aside className="markets-sidebar">
          <h3>Markets</h3>
          <TradingPairSelector
            pairs={['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT']}
            selected={symbol}
            onSelect={setSymbol}
          />
        </aside>

        <main className="chart-area">
          <PriceChart data={chartData} symbol={symbol} />
        </main>

        <aside className="order-book-sidebar">
          <OrderBook
            bids={orderBook.bids}
            asks={orderBook.asks}
            onPriceClick={(price) => console.log('Clicked price:', price)}
          />
        </aside>

        <aside className="trading-panel">
          <OrderForm
            symbol={symbol}
            currentPrice={ticker.price}
            onSubmit={handleOrderSubmit}
          />

          <div className="positions-section">
            <h3>Positions</h3>
            <PositionsTable positions={positions} />
          </div>
        </aside>
      </div>
    </div>
  );
}