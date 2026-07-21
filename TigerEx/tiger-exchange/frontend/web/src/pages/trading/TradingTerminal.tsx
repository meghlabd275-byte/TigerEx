import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  status: string;
  createdAt: string;
}

interface Market {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export default function TradingTerminal() {
  const { user } = useAuth();
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch market data
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const response = await api.get('/api/v1/ticker/24hr');
        if (response.data.success) {
          setMarkets(response.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch markets:', err);
      }
    };

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch user's open orders
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const response = await api.get('/api/v1/openOrders');
        if (response.data.success) {
          setOrders(response.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      }
    };

    fetchOrders();
    const interval = setInterval(fetchOrders, 3000); // Update every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const orderData = {
        symbol: selectedSymbol,
        side,
        type: orderType,
        quantity: parseFloat(quantity),
        price: orderType === 'limit' ? parseFloat(price) : undefined,
      };

      const response = await api.post('/api/v1/order', orderData);
      
      if (response.data.success) {
        // Reset form
        setPrice('');
        setQuantity('');
        // Refresh orders
        const ordersResponse = await api.get('/api/v1/openOrders');
        if (ordersResponse.data.success) {
          setOrders(ordersResponse.data.data);
        }
      } else {
        setError(response.data.error || 'Failed to place order');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const currentMarket = markets.find(m => m.symbol === selectedSymbol);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Trading Terminal</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Market Data */}
          <div className="lg:col-span-2 bg-gray-800 rounded-lg p-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-4">Market Data</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {markets.slice(0, 8).map((market) => (
                  <button
                    key={market.symbol}
                    onClick={() => setSelectedSymbol(market.symbol)}
                    className={`p-3 rounded-lg transition ${
                      selectedSymbol === market.symbol
                        ? 'bg-blue-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <div className="font-semibold text-sm">{market.symbol}</div>
                    <div className="text-xs text-gray-300">${market.lastPrice.toFixed(2)}</div>
                    <div
                      className={`text-xs ${
                        market.priceChangePercent >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {market.priceChangePercent >= 0 ? '+' : ''}
                      {market.priceChangePercent.toFixed(2)}%
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Current Market Info */}
            {currentMarket && (
              <div className="bg-gray-700 rounded-lg p-4 mb-6">
                <h3 className="text-lg font-semibold mb-3">{selectedSymbol}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-gray-400">Last Price</div>
                    <div className="text-lg font-semibold">${currentMarket.lastPrice.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">24h High</div>
                    <div className="text-lg font-semibold">${currentMarket.high24h.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">24h Low</div>
                    <div className="text-lg font-semibold">${currentMarket.low24h.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">24h Volume</div>
                    <div className="text-lg font-semibold">{currentMarket.volume24h.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Open Orders */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Open Orders</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left">Symbol</th>
                      <th className="px-4 py-2 text-left">Side</th>
                      <th className="px-4 py-2 text-right">Price</th>
                      <th className="px-4 py-2 text-right">Quantity</th>
                      <th className="px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length > 0 ? (
                      orders.map((order) => (
                        <tr key={order.id} className="border-t border-gray-700">
                          <td className="px-4 py-2">{order.symbol}</td>
                          <td className={`px-4 py-2 ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {order.side.toUpperCase()}
                          </td>
                          <td className="px-4 py-2 text-right">${order.price.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">{order.quantity.toFixed(8)}</td>
                          <td className="px-4 py-2">{order.status}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-2 text-center text-gray-400">
                          No open orders
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Order Form */}
          <div className="bg-gray-800 rounded-lg p-6 h-fit">
            <h2 className="text-xl font-semibold mb-4">Place Order</h2>
            
            {error && (
              <div className="bg-red-900 text-red-200 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handlePlaceOrder} className="space-y-4">
              {/* Order Type */}
              <div>
                <label className="block text-sm font-medium mb-2">Order Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderType('market')}
                    className={`flex-1 py-2 rounded-lg transition ${
                      orderType === 'market'
                        ? 'bg-blue-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    Market
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderType('limit')}
                    className={`flex-1 py-2 rounded-lg transition ${
                      orderType === 'limit'
                        ? 'bg-blue-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    Limit
                  </button>
                </div>
              </div>

              {/* Side */}
              <div>
                <label className="block text-sm font-medium mb-2">Side</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`flex-1 py-2 rounded-lg transition ${
                      side === 'buy'
                        ? 'bg-green-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide('sell')}
                    className={`flex-1 py-2 rounded-lg transition ${
                      side === 'sell'
                        ? 'bg-red-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    Sell
                  </button>
                </div>
              </div>

              {/* Price (for limit orders) */}
              {orderType === 'limit' && (
                <div>
                  <label className="block text-sm font-medium mb-2">Price</label>
                  <input
                    type="number"
                    step="0.00000001"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Enter price"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    required={orderType === 'limit'}
                  />
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium mb-2">Quantity</label>
                <input
                  type="number"
                  step="0.00000001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter quantity"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-2 rounded-lg font-semibold transition ${
                  side === 'buy'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {loading ? 'Placing Order...' : `${side.toUpperCase()} ${selectedSymbol}`}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
