'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { OrderBook } from '@/components/trading/OrderBook';
import { OrderForm } from '@/components/trading/OrderForm';
import { OpenOrders } from '@/components/trading/OpenOrders';
import { RecentTrades } from '@/components/trading/RecentTrades';
import { PriceChart } from '@/components/charts/PriceChart';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  LineChart, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Activity,
  ChevronDown,
  Settings,
  Bell,
  User,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  RefreshCw,
  Maximize2,
  MoreHorizontal,
  Zap
} from 'lucide-react';

// Types
interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  priceChange: number;
}

interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
}

interface Trade {
  id: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  time: string;
  timestamp: number;
}

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  isolated: boolean;
}

interface OpenOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'take_profit';
  price: number;
  stopPrice?: number;
  quantity: number;
  filled: number;
  status: 'new' | 'partially_filled' | 'filled' | 'canceled';
  createdAt: string;
}

// WebSocket Manager for real-time data
class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private subscriptions: Map<string, Set<(data: any) => void>> = new Map();
  
  connect(url: string) {
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.subscribeAll();
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      };
      
      this.ws.onclose = () => {
        this.handleDisconnect();
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
    }
  }
  
  private handleMessage(data: any) {
    const channel = data.channel;
    if (channel && this.subscriptions.has(channel)) {
      this.subscriptions.get(channel)?.forEach(callback => callback(data));
    }
  }
  
  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(''), this.reconnectDelay * this.reconnectAttempts);
    }
  }
  
  subscribe(channel: string, callback: (data: any) => void) {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)?.add(callback);
  }
  
  unsubscribe(channel: string, callback: (data: any) => void) {
    this.subscriptions.get(channel)?.delete(callback);
  }
  
  private subscribeAll() {
    // Re-subscribe to all channels on reconnect
  }
  
  send(message: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  disconnect() {
    this.ws?.close();
  }
}

// Price Formatter
const formatPrice = (price: number, precision: number = 2): string => {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
};

const formatNumber = (num: number, decimals: number = 2): string => {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatVolume = (num: number): string => {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
};

export default function TradingPage({ params }: { params: { symbol: string } }) {
  const symbol = params?.symbol || 'BTC/USDT';
  const [market, setMarket] = useState<Market>({
    symbol: 'BTC/USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    price: 67432.50,
    change24h: 1234.50,
    changePercent24h: 1.86,
    high24h: 68100.00,
    low24h: 66200.00,
    volume24h: 32456.78,
    quoteVolume24h: 2187654321.50,
    priceChange: 1234.50,
  });
  
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({
    bids: [
      { price: 67430.00, quantity: 12.5, total: 12.5 },
      { price: 67428.50, quantity: 8.3, total: 20.8 },
      { price: 67425.00, quantity: 25.4, total: 46.2 },
      { price: 67420.00, quantity: 15.7, total: 61.9 },
      { price: 67418.00, quantity: 32.1, total: 94.0 },
      { price: 67415.00, quantity: 18.9, total: 112.9 },
      { price: 67410.00, quantity: 22.3, total: 135.2 },
      { price: 67405.00, quantity: 28.6, total: 163.8 },
      { price: 67400.00, quantity: 45.2, total: 209.0 },
      { price: 67395.00, quantity: 16.8, total: 225.8 },
    ],
    asks: [
      { price: 67435.00, quantity: 18.2, total: 18.2 },
      { price: 67438.00, quantity: 25.6, total: 43.8 },
      { price: 67440.00, quantity: 12.9, total: 56.7 },
      { price: 67445.00, quantity: 35.4, total: 92.1 },
      { price: 67448.00, quantity: 28.7, total: 120.8 },
      { price: 67450.00, quantity: 42.1, total: 162.9 },
      { price: 67455.00, quantity: 19.8, total: 182.7 },
      { price: 67460.00, quantity: 23.4, total: 206.1 },
      { price: 67465.00, quantity: 31.2, total: 237.3 },
      { price: 67470.00, quantity: 15.5, total: 252.8 },
    ],
  });

  const [recentTrades, setRecentTrades] = useState<Trade[]>([
    { id: '1', price: 67432.50, quantity: 0.5432, side: 'buy', time: '12:34:56', timestamp: Date.now() },
    { id: '2', price: 67430.00, quantity: 1.2345, side: 'sell', time: '12:34:55', timestamp: Date.now() - 1000 },
    { id: '3', price: 67431.00, quantity: 0.8765, side: 'buy', time: '12:34:54', timestamp: Date.now() - 2000 },
    { id: '4', price: 67428.00, quantity: 2.1567, side: 'sell', time: '12:34:53', timestamp: Date.now() - 3000 },
    { id: '5', price: 67435.00, quantity: 0.4321, side: 'buy', time: '12:34:52', timestamp: Date.now() - 4000 },
    { id: '6', price: 67440.00, quantity: 1.0987, side: 'sell', time: '12:34:51', timestamp: Date.now() - 5000 },
    { id: '7', price: 67438.00, quantity: 0.7654, side: 'buy', time: '12:34:50', timestamp: Date.now() - 6000 },
    { id: '8', price: 67435.00, quantity: 1.5432, side: 'sell', time: '12:34:49', timestamp: Date.now() - 7000 },
    { id: '9', price: 67432.00, quantity: 0.9876, side: 'buy', time: '12:34:48', timestamp: Date.now() - 8000 },
    { id: '10', price: 67430.00, quantity: 1.2345, side: 'sell', time: '12:34:47', timestamp: Date.now() - 9000 },
  ]);

  const [positions, setPositions] = useState<Position[]>([
    {
      id: 'pos_1',
      symbol: 'BTC/USDT',
      side: 'long',
      size: 0.5,
      entryPrice: 67000.00,
      markPrice: 67432.50,
      liquidationPrice: 58000.00,
      leverage: 10,
      margin: 3350.00,
      unrealizedPnl: 216.25,
      unrealizedPnlPercent: 6.45,
      isolated: false,
    }
  ]);

  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([
    {
      id: 'ord_1',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      price: 66500.00,
      quantity: 0.1,
      filled: 0,
      status: 'new',
      createdAt: '12:30:00',
    },
    {
      id: 'ord_2',
      symbol: 'BTC/USDT',
      side: 'sell',
      type: 'stop_limit',
      price: 68000.00,
      stopPrice: 67500.00,
      quantity: 0.2,
      filled: 0,
      status: 'new',
      createdAt: '12:25:00',
    }
  ]);

  const [activeTab, setActiveTab] = useState('limit');
  const [selectedPair, setSelectedPair] = useState('BTC/USDT');
  const [showOrderBook, setShowOrderBook] = useState(true);
  const [showPositions, setShowPositions] = useState(true);
  const [leverage, setLeverage] = useState(10);
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');

  const pairs = [
    { symbol: 'BTC/USDT', name: 'Bitcoin', price: 67432.50, change: 1.86 },
    { symbol: 'ETH/USDT', name: 'Ethereum', price: 3521.80, change: 2.45 },
    { symbol: 'BNB/USDT', name: 'BNB', price: 598.50, change: -0.52 },
    { symbol: 'SOL/USDT', name: 'Solana', price: 172.30, change: 5.21 },
    { symbol: 'XRP/USDT', name: 'Ripple', price: 0.5234, change: -1.23 },
    { symbol: 'ADA/USDT', name: 'Cardano', price: 0.4521, change: 3.15 },
    { symbol: 'DOGE/USDT', name: 'Dogecoin', price: 0.1234, change: -2.45 },
    { symbol: 'AVAX/USDT', name: 'Avalanche', price: 35.67, change: 4.32 },
  ];

  const spread = useMemo(() => {
    if (orderBook.asks.length > 0 && orderBook.bids.length > 0) {
      return orderBook.asks[0].price - orderBook.bids[0].price;
    }
    return 0;
  }, [orderBook]);

  const spreadPercent = useMemo(() => {
    if (orderBook.bids.length > 0 && spread > 0) {
      return (spread / orderBook.bids[0].price) * 100;
    }
    return 0;
  }, [spread, orderBook]);

  // Simulate real-time price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setMarket(prev => {
        const changePercent = (Math.random() - 0.5) * 0.1;
        const newPrice = prev.price * (1 + changePercent / 100);
        return {
          ...prev,
          price: newPrice,
          change24h: prev.change24h + changePercent * prev.price / 100,
          changePercent24h: ((newPrice - (prev.price - prev.change24h)) / (prev.price - prev.change24h)) * 100,
        };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Simulate order book updates
  useEffect(() => {
    const interval = setInterval(() => {
      setOrderBook(prev => {
        const newBids = prev.bids.map(level => ({
          ...level,
          quantity: Math.max(0.1, level.quantity + (Math.random() - 0.5) * 2),
        }));
        
        const newAsks = prev.asks.map(level => ({
          ...level,
          quantity: Math.max(0.1, level.quantity + (Math.random() - 0.5) * 2),
        }));

        // Recalculate totals
        let bidTotal = 0;
        newBids.forEach(level => {
          bidTotal += level.quantity;
          level.total = bidTotal;
        });

        let askTotal = 0;
        newAsks.forEach(level => {
          askTotal += level.quantity;
          level.total = askTotal;
        });

        return { bids: newBids, asks: newAsks };
      });
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const handlePlaceOrder = useCallback((orderData: any) => {
    console.log('Placing order:', orderData);
    
    const newOrder: OpenOrder = {
      id: `ord_${Date.now()}`,
      symbol: symbol,
      side: orderData.side,
      type: orderData.type,
      price: orderData.price,
      stopPrice: orderData.stopPrice,
      quantity: orderData.quantity,
      filled: 0,
      status: 'new',
      createdAt: new Date().toLocaleTimeString(),
    };

    setOpenOrders(prev => [newOrder, ...prev]);
  }, [symbol]);

  const handleCancelOrder = useCallback((orderId: string) => {
    setOpenOrders(prev => prev.map(order => 
      order.id === orderId ? { ...order, status: 'canceled' as const } : order
    ));
  }, []);

  const handleClosePosition = useCallback((positionId: string) => {
    setPositions(prev => prev.filter(pos => pos.id !== positionId));
  }, []);

  const setLeverageLevel = useCallback((level: number) => {
    setLeverage(level);
  }, []);

  return (
    <div className="min-h-screen bg-[#0d0d1a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0d0d1a]/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
                <span className="text-xl font-bold text-white">T</span>
              </div>
              <span className="text-xl font-bold text-white">TigerEx</span>
            </div>
            
            {/* Pair Selector */}
            <div className="relative">
              <button className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10">
                <span className="text-lg font-semibold">{market.symbol}</span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-8 text-sm">
              <div className="text-center">
                <span className="text-gray-400 block text-xs">Price</span>
                <span className="font-semibold">${formatPrice(market.price)}</span>
              </div>
              <div className="text-center">
                <span className="text-gray-400 block text-xs">24h Change</span>
                <span className={`font-semibold ${market.changePercent24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {market.changePercent24h >= 0 ? '+' : ''}{formatPrice(market.changePercent24h)}%
                </span>
              </div>
              <div className="text-center">
                <span className="text-gray-400 block text-xs">24h High</span>
                <span className="font-semibold">${formatPrice(market.high24h)}</span>
              </div>
              <div className="text-center">
                <span className="text-gray-400 block text-xs">24h Low</span>
                <span className="font-semibold">${formatPrice(market.low24h)}</span>
              </div>
              <div className="text-center">
                <span className="text-gray-400 block text-xs">24h Volume</span>
                <span className="font-semibold">{formatVolume(market.quoteVolume24h)}</span>
              </div>
              <div className="text-center">
                <span className="text-gray-400 block text-xs">Spread</span>
                <span className="font-semibold">{formatPrice(spread)} ({spreadPercent.toFixed(3)}%)</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" title="Notifications">
                <Bell className="w-5 h-5" />
              </Button>
              <Button variant="ghost" size="icon" title="Settings">
                <Settings className="w-5 h-5" />
              </Button>
              <Button variant="ghost" size="icon" title="Account">
                <User className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Main Content */}
        <div className="flex-1 p-4">
          <div className="grid grid-cols-12 gap-4">
            {/* Chart Area */}
            <div className="col-span-8 space-y-4">
              {/* Price Chart */}
              <Card className="bg-[#1a1a2e] border-white/10">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="flex items-center gap-4">
                    <CardTitle className="text-lg">{market.baseAsset}/{market.quoteAsset}</CardTitle>
                    <div className="flex items-center gap-1">
                      {['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map((interval) => (
                        <Button 
                          key={interval} 
                          variant="ghost" 
                          size="sm" 
                          className={`h-7 text-xs ${interval === '1h' ? 'bg-white/10' : ''}`}
                        >
                          {interval}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Refresh">
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Fullscreen">
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Chart Type">
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="h-[450px]">
                  <PriceChart />
                </CardContent>
              </Card>

              {/* Order Book and Recent Trades */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-[#1a1a2e] border-white/10">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Order Book</CardTitle>
                      <span className="text-xs text-gray-500">Spread: {formatPrice(spread)}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <OrderBook bids={orderBook.bids} asks={orderBook.asks} />
                  </CardContent>
                </Card>

                <Card className="bg-[#1a1a2e] border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Recent Trades</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RecentTrades trades={recentTrades} />
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Trading Panel */}
            <div className="col-span-4 space-y-4">
              {/* Order Form */}
              <Card className="bg-[#1a1a2e] border-white/10">
                <CardContent className="p-4">
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-4 bg-[#0d0d1a]">
                      <TabsTrigger value="limit" className="text-xs">Limit</TabsTrigger>
                      <TabsTrigger value="market" className="text-xs">Market</TabsTrigger>
                      <TabsTrigger value="stop" className="text-xs">Stop</TabsTrigger>
                      <TabsTrigger value="stop-limit" className="text-xs">Stop Limit</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="limit" className="mt-4">
                      <OrderForm type="limit" onSubmit={handlePlaceOrder} />
                    </TabsContent>
                    <TabsContent value="market" className="mt-4">
                      <OrderForm type="market" onSubmit={handlePlaceOrder} />
                    </TabsContent>
                    <TabsContent value="stop" className="mt-4">
                      <OrderForm type="stop" onSubmit={handlePlaceOrder} />
                    </TabsContent>
                    <TabsContent value="stop-limit" className="mt-4">
                      <OrderForm type="stop-limit" onSubmit={handlePlaceOrder} />
                    </TabsContent>
                  </Tabs>
                  
                  {/* Leverage Control */}
                  <div className="mt-4 p-3 bg-[#0d0d1a] rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">Leverage</span>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0"
                          onClick={() => setLeverageLevel(Math.max(1, leverage - 1))}
                        >
                          -
                        </Button>
                        <span className="text-sm font-semibold text-tiger-orange">{leverage}x</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 w-6 p-0"
                          onClick={() => setLeverageLevel(Math.min(125, leverage + 1))}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 5, 10, 20, 50, 100].map((level) => (
                        <button
                          key={level}
                          onClick={() => setLeverageLevel(level)}
                          className={`flex-1 py-1 text-xs rounded ${
                            leverage === level 
                              ? 'bg-tiger-orange text-white' 
                              : 'bg-white/5 text-gray-400 hover:bg-white/10'
                          }`}
                        >
                          {level}x
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Margin Mode */}
                  <div className="mt-3 flex gap-2">
                    <Button 
                      variant={marginMode === 'cross' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 ${marginMode === 'cross' ? 'bg-tiger-orange' : ''}`}
                      onClick={() => setMarginMode('cross')}
                    >
                      Cross
                    </Button>
                    <Button 
                      variant={marginMode === 'isolated' ? 'default' : 'outline'}
                      size="sm"
                      className={`flex-1 ${marginMode === 'isolated' ? 'bg-tiger-orange' : ''}`}
                      onClick={() => setMarginMode('isolated')}
                    >
                      Isolated
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Open Orders */}
              <Card className="bg-[#1a1a2e] border-white/10">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Open Orders ({openOrders.length})</CardTitle>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">View All</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <OpenOrders orders={openOrders} onCancel={handleCancelOrder} />
                </CardContent>
              </Card>

              {/* Positions */}
              <Card className="bg-[#1a1a2e] border-white/10">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Positions ({positions.length})</CardTitle>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs bg-white/10">Cross</Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">Isolated</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {positions.length > 0 ? (
                    <div className="space-y-2">
                      {positions.map((position) => (
                        <div key={position.id} className="p-3 bg-[#0d0d1a] rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 text-xs rounded ${
                                position.side === 'long' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                              }`}>
                                {position.side.toUpperCase()}
                              </span>
                              <span className="text-sm font-medium">{position.symbol}</span>
                              <span className="text-xs text-gray-500">{position.leverage}x</span>
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500">
                              ×
                            </Button>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-gray-500">Size</span>
                              <p className="font-medium">{position.size}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Entry</span>
                              <p className="font-medium">${formatPrice(position.entryPrice)}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Mark</span>
                              <p className="font-medium">${formatPrice(position.markPrice)}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">PnL</span>
                              <p className={`font-medium ${position.unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {position.unrealizedPnl >= 0 ? '+' : ''}{formatPrice(position.unrealizedPnl)} ({position.unrealizedPnlPercent.toFixed(2)}%)
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      No open positions
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Trade History */}
              <Card className="bg-[#1a1a2e] border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Trade History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 pb-2 border-b border-white/5">
                      <span>Time</span>
                      <span>Price</span>
                      <span>Amount</span>
                    </div>
                    {recentTrades.slice(0, 8).map((trade, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs py-1">
                        <span className="text-gray-500">{trade.time}</span>
                        <span className={trade.side === 'buy' ? 'text-green-500' : 'text-red-500'}>
                          {formatPrice(trade.price)}
                        </span>
                        <span className="text-white">{trade.quantity}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Markets Sidebar */}
        <div className="w-72 border-l border-white/10 bg-[#0d0d1a] p-4 overflow-y-auto">
          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search markets..."
              className="w-full px-3 py-2 bg-[#1a1a2e] border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-tiger-orange"
            />
          </div>
          
          {/* Favorites */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-gray-400">Favorites</span>
            </div>
            {pairs.slice(0, 3).map((pair) => (
              <div
                key={pair.symbol}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-white/10 ${
                  selectedPair === pair.symbol ? 'bg-white/10 border border-tiger-orange/50' : ''
                }`}
                onClick={() => setSelectedPair(pair.symbol)}
              >
                <div className="flex items-center gap-2">
                  <button className="text-gray-400 hover:text-yellow-500">
                    <Star className="w-4 h-4" fill={selectedPair === pair.symbol ? 'currentColor' : 'none'} />
                  </button>
                  <div>
                    <div className="text-sm font-medium">{pair.symbol}</div>
                    <div className="text-xs text-gray-400">{pair.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm">${formatPrice(pair.price)}</div>
                  <div className={`text-xs ${pair.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {pair.change >= 0 ? '+' : ''}{pair.change.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* All Markets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">All Markets</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2">Spot</Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2">Futures</Button>
              </div>
            </div>
            <div className="space-y-1">
              {pairs.map((pair) => (
                <div
                  key={pair.symbol}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-white/10 ${
                    selectedPair === pair.symbol ? 'bg-white/10' : ''
                  }`}
                  onClick={() => setSelectedPair(pair.symbol)}
                >
                  <div>
                    <div className="text-sm font-medium">{pair.symbol}</div>
                    <div className="text-xs text-gray-400">Vol: {(Math.random() * 1000).toFixed(0)}M</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">${formatPrice(pair.price)}</div>
                    <div className={`text-xs ${pair.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {pair.change >= 0 ? '+' : ''}{pair.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-6 pt-4 border-t border-white/10">
            <div className="text-xs text-gray-400 mb-2">Quick Actions</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="text-xs">
                <Zap className="w-3 h-3 mr-1" />
                Convert
              </Button>
              <Button variant="outline" size="sm" className="text-xs">
                <Activity className="w-3 h-3 mr-1" />
                Signals
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}