import React, { useState, useEffect, useCallback } from 'react';

interface Market {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  price: number;
  change24h: number;
  volume24h: number;
}

interface OrderBookLevel {
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: string;
}

interface Trade {
  id: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  timestamp: string;
}

export const TradingInterface: React.FC = () => {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('limit');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const ws = new WebSocket('wss://api.tigerex.com/ws');
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ 
        method: 'SUBSCRIBE', 
        params: ['btcusdt@bookTicker', 'btcusdt@trades', 'btcusdt@depth'],
        id: 1 
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.e === 'bookTicker') {
        setSelectedMarket(prev => prev ? {
          ...prev,
          price: parseFloat(data.c)
        } : null);
      } else if (data.e === 'trade') {
        setRecentTrades(prev => [data, ...prev].slice(0, 50));
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    fetch('/api/markets').then(res => res.json()).then(setMarkets);
  }, []);

  useEffect(() => {
    if (price && quantity) {
      setTotal(parseFloat(price) * parseFloat(quantity));
    }
  }, [price, quantity]);

  const handleOrderSubmit = useCallback(async () => {
    if (!selectedMarket || !quantity) return;

    const order = {
      symbol: selectedMarket.symbol,
      side,
      type: orderType,
      price: orderType === 'market' ? undefined : parseFloat(price),
      quantity: parseFloat(quantity),
    };

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    if (response.ok) {
      const newOrder = await response.json();
      setOpenOrders(prev => [newOrder, ...prev]);
      setQuantity('');
      setPrice('');
    }
  }, [selectedMarket, side, orderType, price, quantity]);

  const cancelOrder = useCallback(async (orderId: string) => {
    const response = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
    if (response.ok) {
      setOpenOrders(prev => prev.filter(o => o.id !== orderId));
    }
  }, []);

  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Market List */}
      <div className="w-64 border-r border-gray-700 overflow-y-auto">
        <div className="p-4 border-b border-gray-700">
          <input 
            type="text" 
            placeholder="Search markets..." 
            className="w-full bg-gray-800 rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="divide-y divide-gray-700">
          {markets.map(market => (
            <div
              key={market.symbol}
              onClick={() => setSelectedMarket(market)}
              className={`p-4 cursor-pointer hover:bg-gray-800 ${selectedMarket?.symbol === market.symbol ? 'bg-gray-800' : ''}`}
            >
              <div className="flex justify-between items-center">
                <span className="font-medium">{market.baseCurrency}/{market.quoteCurrency}</span>
                <span className={market.change24h >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {market.change24h >= 0 ? '+' : ''}{market.change24h.toFixed(2)}%
                </span>
              </div>
              <div className="text-sm text-gray-400 mt-1">
                ${formatPrice(market.price)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Trading Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              {selectedMarket?.baseCurrency}/{selectedMarket?.quoteCurrency}
            </h1>
            <span className="text-2xl font-bold text-blue-500">
              ${selectedMarket ? formatPrice(selectedMarket.price) : '0.00'}
            </span>
          </div>
          <div className="flex gap-8 text-sm">
            <div>
              <span className="text-gray-400">24h Change</span>
              <div className={selectedMarket && selectedMarket.change24h >= 0 ? 'text-green-500' : 'text-red-500'}>
                {selectedMarket ? `${selectedMarket.change24h >= 0 ? '+' : ''}${selectedMarket.change24h.toFixed(2)}%` : '0.00%'}
              </div>
            </div>
            <div>
              <span className="text-gray-400">24h Volume</span>
              <div>${selectedMarket ? formatNumber(selectedMarket.volume24h) : '0'}</div>
            </div>
          </div>
        </div>

        {/* Charts placeholder */}
        <div className="flex-1 p-4">
          <div className="bg-gray-800 rounded-lg h-64 flex items-center justify-center">
            <span className="text-gray-500">TradingView Chart Placeholder</span>
          </div>
        </div>

        {/* Order Entry */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex gap-4 mb-4">
            <button
              onClick={() => setSide('buy')}
              className={`flex-1 py-3 rounded font-medium ${side === 'buy' ? 'bg-green-500' : 'bg-gray-700'}`}
            >
              Buy
            </button>
            <button
              onClick={() => setSide('sell')}
              className={`flex-1 py-3 rounded font-medium ${side === 'sell' ? 'bg-red-500' : 'bg-gray-700'}`}
            >
              Sell
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setOrderType('limit')}
              className={`px-4 py-2 rounded ${orderType === 'limit' ? 'bg-blue-500' : 'bg-gray-700'}`}
            >
              Limit
            </button>
            <button
              onClick={() => setOrderType('market')}
              className={`px-4 py-2 rounded ${orderType === 'market' ? 'bg-blue-500' : 'bg-gray-700'}`}
            >
              Market
            </button>
          </div>

          {orderType === 'limit' && (
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Price (USDT)</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-800 rounded px-3 py-2"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Amount ({selectedMarket?.baseCurrency})</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-800 rounded px-3 py-2"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Total</label>
            <div className="bg-gray-800 rounded px-3 py-2">
              {formatNumber(total)} {selectedMarket?.quoteCurrency || 'USDT'}
            </div>
          </div>

          <button
            onClick={handleOrderSubmit}
            className={`w-full py-3 rounded font-medium ${side === 'buy' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
          >
            {side === 'buy' ? 'Buy' : 'Sell'} {selectedMarket?.baseCurrency || ''}
          </button>
        </div>
      </div>

      {/* Order Book & Recent Trades */}
      <div className="w-80 border-l border-gray-700 flex flex-col">
        {/* Order Book */}
        <div className="flex-1 p-4 overflow-y-auto">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Order Book</h3>
          
          {/* Asks */}
          <div className="mb-2">
            <div className="grid grid-cols-3 text-xs text-gray-400 mb-1">
              <span>Price</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Total</span>
            </div>
            <div className="space-y-1">
              {orderBook.asks.slice(0, 10).reverse().map((level, i) => (
                <div key={i} className="grid grid-cols-3 text-xs relative">
                  <div className="absolute inset-0 bg-red-500/10" />
                  <span className="text-red-500">{formatPrice(level.price)}</span>
                  <span className="text-right">{formatNumber(level.quantity, 4)}</span>
                  <span className="text-right text-gray-400">{(level.price * level.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Spread */}
          <div className="py-2 text-center border-y border-gray-700">
            <span className="text-sm font-medium">
              Spread: {orderBook.asks.length > 0 && orderBook.bids.length > 0 
                ? (orderBook.asks[0].price - orderBook.bids[0].price).toFixed(2) 
                : '0.00'}
            </span>
          </div>

          {/* Bids */}
          <div className="mt-2">
            <div className="space-y-1">
              {orderBook.bids.slice(0, 10).map((level, i) => (
                <div key={i} className="grid grid-cols-3 text-xs relative">
                  <div className="absolute inset-0 bg-green-500/10" />
                  <span className="text-green-500">{formatPrice(level.price)}</span>
                  <span className="text-right">{formatNumber(level.quantity, 4)}</span>
                  <span className="text-right text-gray-400">{(level.price * level.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Trades */}
        <div className="h-64 border-t border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Trades</h3>
          <div className="space-y-1">
            {recentTrades.map(trade => (
              <div key={trade.id} className="grid grid-cols-3 text-xs">
                <span className={trade.side === 'buy' ? 'text-green-500' : 'text-red-500'}>
                  {formatPrice(trade.price)}
                </span>
                <span className="text-right">{formatNumber(trade.quantity, 4)}</span>
                <span className="text-right text-gray-400">
                  {new Date(trade.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TradingInterface;