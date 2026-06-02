// =============================================================================
// TIGGEREX v3.0 - COMPLETE FRONTEND TRADING INTERFACE
// Professional cryptocurrency trading platform with all features
// =============================================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  TrendingUp, TrendingDown, Wallet, Bell, Settings, Search, 
  ChevronDown, ChevronUp, RefreshCw, Maximize2, Moon, Sun,
  Activity, BarChart3, PieChart, LineChart, Clock, Filter,
  ArrowUpRight, ArrowDownRight, ExternalLink, Copy, Trash2,
  Plus, Minus, AlertTriangle, Check, X, Info, Lock
} from 'lucide-react';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface User {
  userId: string;
  email: string;
  username: string;
  kycLevel: 'none' | 'basic' | 'intermediate' | 'advanced' | 'institutional';
  twoFactorEnabled: boolean;
}

interface Balance {
  currency: string;
  available: string;
  locked: string;
  total: string;
  usdValue: string;
}

interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: string;
  priceChange24h: string;
  priceChangePercent24h: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  quoteVolume24h: string;
}

interface OrderBookLevel {
  price: string;
  quantity: string;
  total: string;
}

interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: string;
  spreadPercent: string;
}

interface Trade {
  tradeId: string;
  price: string;
  quantity: string;
  time: string;
  side: 'buy' | 'sell';
}

interface Order {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_loss' | 'stop_limit' | 'stop_market' | 'take_profit' | 'trailing_stop' | 'oco';
  price: string;
  stopPrice?: string;
  quantity: string;
  filledQuantity: string;
  status: 'pending_new' | 'new' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
  createdAt: string;
}

interface Position {
  positionId: string;
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  unrealizedPnl: string;
  unrealizedPnlPercent: string;
  leverage: string;
  margin: string;
  marginRatio: string;
}

interface Ticker {
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  quoteVolume24h: string;
  bidPrice: string;
  askPrice: string;
}

// =============================================================================
// CONTEXT & STATE MANAGEMENT
// =============================================================================

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  selectedMarket: Market | null;
  setSelectedMarket: (market: Market | null) => void;
  balances: Balance[];
  setBalances: (balances: Balance[]) => void;
}

const AppContext = React.createContext<AppContextType | null>(null);

const useApp = () => {
  const context = React.useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

// =============================================================================
// API SERVICE
// =============================================================================

class ApiService {
  private baseUrl: string = '/api';
  private wsUrl: string = 'wss://stream.tigerex.com';
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }

  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }

  connectWebSocket(onMessage: (data: any) => void) {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connectWebSocket(onMessage);
        }, 1000 * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  subscribe(channel: string, symbol?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        channel,
        symbol
      }));
    }
  }

  unsubscribe(channel: string, symbol?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'unsubscribe',
        channel,
        symbol
      }));
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}

const apiService = new ApiService();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const formatNumber = (num: string | number, decimals: number = 2): string => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

const formatPrice = (price: string | number): string => {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(p)) return '0.00';
  if (p >= 1000) return formatNumber(p, 2);
  if (p >= 1) return formatNumber(p, 4);
  if (p >= 0.0001) return formatNumber(p, 6);
  return formatNumber(p, 8);
};

const formatQuantity = (qty: string | number): string => {
  const q = typeof qty === 'string' ? parseFloat(qty) : qty;
  if (isNaN(q)) return '0';
  return formatNumber(q, 4);
};

const formatPercent = (percent: string | number): string => {
  const p = typeof percent === 'string' ? parseFloat(percent) : percent;
  if (isNaN(p)) return '0.00%';
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(2)}%`;
};

const formatTime = (timestamp: string): string => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const abbreviateNumber = (num: number): string => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

// =============================================================================
// CUSTOM HOOKS
// =============================================================================

function useWebSocket(symbol: string) {
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [], spread: '0', spreadPercent: '0' });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const handleMessage = (data: any) => {
      switch (data.channel) {
        case 'orderbook':
          setOrderBook(data.data);
          break;
        case 'trade':
          setTrades(prev => [data.data, ...prev.slice(0, 99)]);
          break;
        case 'ticker':
          setTicker(data.data);
          break;
      }
    };

    apiService.connectWebSocket(handleMessage);
    apiService.subscribe('orderbook', symbol);
    apiService.subscribe('trade', symbol);
    apiService.subscribe('ticker', symbol);

    return () => {
      apiService.unsubscribe('orderbook', symbol);
      apiService.unsubscribe('trade', symbol);
      apiService.unsubscribe('ticker', symbol);
    };
  }, [symbol]);

  return { orderBook, trades, ticker };
}

function useOrderForm(symbol: string) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop_limit' | 'stop_market' | 'trailing_stop' | 'oco'>('limit');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingDelta, setTrailingDelta] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [timeInForce, setTimeInForce] = useState<'GTC' | 'IOC' | 'FOK'>('GTC');
  const [leverage, setLeverage] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = useMemo(() => {
    const p = parseFloat(price) || 0;
    const q = parseFloat(quantity) || 0;
    return p * q;
  }, [price, quantity]);

  const submitOrder = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const order = {
        symbol,
        side,
        type: orderType,
        price: orderType !== 'market' ? price : undefined,
        quantity,
        stopPrice: ['stop_limit', 'stop_market'].includes(orderType) ? stopPrice : undefined,
        trailingDelta: orderType === 'trailing_stop' ? trailingDelta : undefined,
        reduceOnly,
        postOnly,
        timeInForce,
        leverage
      };
      await apiService.post('/orders', order);
      setPrice('');
      setQuantity('');
      setStopPrice('');
      setTrailingDelta('');
    } catch (error) {
      console.error('Order submission failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const setPercentage = (percent: number) => {
    const balance = 1000; // Would fetch from context
    const p = parseFloat(price) || 0;
    if (p > 0) {
      setQuantity((balance * percent / p).toFixed(8));
    }
  };

  return {
    side, setSide,
    orderType, setOrderType,
    price, setPrice,
    quantity, setQuantity,
    stopPrice, setStopPrice,
    trailingDelta, setTrailingDelta,
    reduceOnly, setReduceOnly,
    postOnly, setPostOnly,
    timeInForce, setTimeInForce,
    leverage, setLeverage,
    total,
    submitOrder,
    setPercentage,
    isSubmitting
  };
}

function useOpenOrders(symbol: string) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiService.get<Order[]>(`/orders?symbol=${symbol}&status=new,partially_filled`);
      setOrders(data);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const cancelOrder = async (orderId: string) => {
    try {
      await apiService.post(`/orders/${orderId}/cancel`, {});
      setOrders(prev => prev.filter(o => o.orderId !== orderId));
    } catch (error) {
      console.error('Cancel order failed:', error);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  return { orders, loading, cancelOrder, refetch: fetchOrders };
}

function usePositions() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiService.get<Position[]>('/positions');
      setPositions(data);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  return { positions, loading, refetch: fetchPositions };
}

// =============================================================================
// COMPONENTS
// =============================================================================

// Header Component
const Header: React.FC = () => {
  const { user, theme, setTheme } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4">
      {/* Logo */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="font-bold text-lg text-gray-900 dark:text-white">TigerEx</span>
        </div>
        
        {/* Markets Dropdown */}
        <MarketSelector />
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md mx-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search markets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg relative">
          <Bell className="w-5 h-5" />
          {notifications.length > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>

        {/* Wallet */}
        <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
          <Wallet className="w-5 h-5" />
        </button>

        {/* User Menu */}
        {user ? (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900 dark:text-white">{user.username}</div>
              <div className="text-xs text-gray-500">
                {user.kycLevel === 'none' ? 'Unverified' : `${user.kycLevel} Verified`}
              </div>
            </div>
            <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
              {user.username[0].toUpperCase()}
            </div>
          </div>
        ) : (
          <button className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium">
            Log In
          </button>
        )}
      </div>
    </header>
  );
};

// Market Selector
const MarketSelector: React.FC = () => {
  const { selectedMarket, setSelectedMarket } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const fetchMarkets = async () => {
      const data = await apiService.get<Market[]>('/markets');
      setMarkets(data);
    };
    fetchMarkets();
  }, []);

  const filteredMarkets = useMemo(() => {
    return markets.filter(m => 
      m.symbol.toLowerCase().includes(filter.toLowerCase()) ||
      m.baseAsset.toLowerCase().includes(filter.toLowerCase())
    );
  }, [markets, filter]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
      >
        <span className="font-medium text-gray-900 dark:text-white">
          {selectedMarket?.symbol || 'Select Market'}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-80 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 z-50">
            <div className="p-2">
              <input
                type="text"
                placeholder="Search markets..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {filteredMarkets.map((market) => (
                <button
                  key={market.symbol}
                  onClick={() => {
                    setSelectedMarket(market);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    selectedMarket?.symbol === market.symbol ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                  }`}
                >
                  <div className="text-left">
                    <div className="font-medium text-gray-900 dark:text-white">{market.symbol}</div>
                    <div className="text-xs text-gray-500">{market.quoteVolume24h}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-gray-900 dark:text-white">${formatPrice(market.price)}</div>
                    <div className={`text-xs ${parseFloat(market.priceChangePercent24h) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatPercent(market.priceChangePercent24h)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Price Ticker
const PriceTicker: React.FC<{ ticker: Ticker | null; symbol: string }> = ({ ticker, symbol }) => {
  if (!ticker) return null;

  const price = parseFloat(ticker.lastPrice);
  const change = parseFloat(ticker.priceChange);
  const isPositive = change >= 0;

  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">
          ${formatPrice(ticker.lastPrice)}
        </span>
        <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {formatPercent(ticker.priceChangePercent)}
        </span>
      </div>
      
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <div>
          <span className="text-gray-400">24h High </span>
          <span className="text-gray-900 dark:text-white">${formatPrice(ticker.high24h)}</span>
        </div>
        <div>
          <span className="text-gray-400">24h Low </span>
          <span className="text-gray-900 dark:text-white">${formatPrice(ticker.low24h)}</span>
        </div>
        <div>
          <span className="text-gray-400">24h Vol </span>
          <span className="text-gray-900 dark:text-white">{abbreviateNumber(parseFloat(ticker.quoteVolume24h))} {symbol.split('/')[1]}</span>
        </div>
      </div>
    </div>
  );
};

// Order Book Component
const OrderBook: React.FC<{ data: OrderBook; precision?: number }> = ({ data, precision = 2 }) => {
  const maxQuantity = useMemo(() => {
    const allQuantities = [...data.bids.map(b => parseFloat(b.quantity)), ...data.asks.map(a => parseFloat(a.quantity))];
    return Math.max(...allQuantities, 1);
  }, [data]);

  const renderLevel = (level: OrderBookLevel, side: 'bid' | 'ask', index: number) => {
    const qty = parseFloat(level.quantity);
    const depth = (qty / maxQuantity) * 100;
    
    return (
      <div
        key={index}
        className="relative h-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer group"
      >
        <div
          className={`absolute inset-y-0 ${side === 'bid' ? 'right-0 bg-green-500/10' : 'right-0 bg-red-500/10'}`}
          style={{ width: `${depth}%` }}
        />
        <div className="absolute inset-y-0 flex items-center px-2 text-xs">
          <span className={`w-24 text-right ${side === 'bid' ? 'text-green-500' : 'text-red-500'}`}>
            {formatPrice(level.price)}
          </span>
          <span className="w-24 text-right text-gray-900 dark:text-white">
            {formatQuantity(level.quantity)}
          </span>
          <span className="w-24 text-right text-gray-500">
            {formatQuantity(level.total)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white">Order Book</h3>
      </div>
      
      <div className="text-xs text-gray-500 flex px-2 py-1 bg-gray-50 dark:bg-gray-800">
        <span className="w-24 text-right">Price ({data.asks[0]?.price ? 'USDT' : ''})</span>
        <span className="w-24 text-right">Amount</span>
        <span className="w-24 text-right">Total</span>
      </div>
      
      <div className="max-h-64 overflow-y-auto">
        {/* Asks (sells) - reversed to show lowest at bottom */}
        {[...data.asks].reverse().map((level, i) => renderLevel(level, 'ask', i)).slice(0, 15)}
        
        {/* Spread */}
        <div className="flex items-center justify-center py-2 bg-gray-50 dark:bg-gray-800">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            ${formatPrice(data.bids[0]?.price || 0)}
          </span>
          <span className="mx-2 text-xs text-gray-400">Spread</span>
          <span className="text-xs text-gray-500">
            {data.spread} ({data.spreadPercent}%)
          </span>
        </div>
        
        {/* Bids (buys) */}
        {data.bids.slice(0, 15).map((level, i) => renderLevel(level, 'bid', i))}
      </div>
    </div>
  );
};

// Trade History
const TradeHistory: React.FC<{ trades: Trade[] }> = ({ trades }) => {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white">Recent Trades</h3>
      </div>
      
      <div className="text-xs text-gray-500 flex px-2 py-1 bg-gray-50 dark:bg-gray-800">
        <span className="flex-1">Price</span>
        <span className="flex-1 text-right">Amount</span>
        <span className="flex-1 text-right">Time</span>
      </div>
      
      <div className="max-h-48 overflow-y-auto">
        {trades.map((trade, i) => (
          <div key={i} className="flex items-center px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-xs">
            <span className={`flex-1 ${trade.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
              {formatPrice(trade.price)}
            </span>
            <span className="flex-1 text-right text-gray-900 dark:text-white">
              {formatQuantity(trade.quantity)}
            </span>
            <span className="flex-1 text-right text-gray-500">
              {formatTime(trade.time)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// TradingView Chart Integration
const TradingChart: React.FC<{ symbol: string }> = ({ symbol }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // In production, initialize TradingView widget
    // This is a placeholder for the TradingView integration
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (typeof TradingView !== 'undefined' && containerRef.current) {
        new TradingView.widget({
          symbol: symbol,
          interval: '15',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#1a1a2e',
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: true,
          container_id: containerRef.current.id,
          autosize: true,
          height: '100%',
          width: '100%'
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [symbol]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 h-full">
      <div className="h-full min-h-[400px]" ref={containerRef} id="tradingview_chart" />
    </div>
  );
};

// Order Form Component
const OrderForm: React.FC<{ symbol: string; price: string }> = ({ symbol, price }) => {
  const {
    side, setSide,
    orderType, setOrderType,
    price: orderPrice, setPrice,
    quantity, setQuantity,
    stopPrice, setStopPrice,
    leverage, setLeverage,
    total,
    submitOrder,
    setPercentage,
    isSubmitting
  } = useOrderForm(symbol);

  const leverageOptions = [1, 2, 3, 5, 10, 20, 50, 100];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      {/* Side Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-3 text-center font-medium transition-colors ${
            side === 'buy'
              ? 'text-green-500 border-b-2 border-green-500'
              : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-3 text-center font-medium transition-colors ${
            side === 'sell'
              ? 'text-red-500 border-b-2 border-red-500'
              : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          Sell
        </button>
      </div>

      <div className="p-4">
        {/* Order Type */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Order Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as any)}
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
          >
            <option value="limit">Limit</option>
            <option value="market">Market</option>
            <option value="stop_limit">Stop Limit</option>
            <option value="stop_market">Stop Market</option>
            <option value="trailing_stop">Trailing Stop</option>
            <option value="oco">OCO</option>
          </select>
        </div>

        {/* Leverage (for margin/futures) */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">Leverage</label>
            <span className="text-xs text-orange-500 font-medium">{leverage}x</span>
          </div>
          <div className="flex gap-1">
            {leverageOptions.filter(l => l <= 100).slice(0, 5).map(l => (
              <button
                key={l}
                onClick={() => setLeverage(l)}
                className={`flex-1 py-1 text-xs rounded ${
                  leverage === l
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                {l}x
              </button>
            ))}
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
            className="w-full mt-2 accent-orange-500"
          />
        </div>

        {/* Price */}
        {orderType !== 'market' && (
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">
              {orderType === 'oco' ? 'Primary Price' : 'Price'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={orderPrice}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={price || '0.00'}
                className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm text-right"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                {symbol.split('/')[1]}
              </span>
            </div>
          </div>
        )}

        {/* Stop Price */}
        {['stop_limit', 'stop_market', 'oco'].includes(orderType) && (
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Stop Price</label>
            <div className="relative">
              <input
                type="text"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm text-right"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                {symbol.split('/')[1]}
              </span>
            </div>
          </div>
        )}

        {/* Quantity */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Amount</label>
          <div className="relative">
            <input
              type="text"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm text-right"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
              {symbol.split('/')[0]}
            </span>
          </div>
          
          {/* Percentage Buttons */}
          <div className="flex gap-1 mt-2">
            {[0.25, 0.5, 0.75, 1].map(pct => (
              <button
                key={pct}
                onClick={() => setPercentage(pct)}
                className="flex-1 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                {pct * 100}%
              </button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="flex gap-4 mb-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={false}
              onChange={() => {}}
              className="rounded border-gray-300"
            />
            <span className="text-gray-600 dark:text-gray-400">Reduce Only</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={false}
              onChange={() => {}}
              className="rounded border-gray-300"
            />
            <span className="text-gray-600 dark:text-gray-400">Post Only</span>
          </label>
        </div>

        {/* Total */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Total</span>
            <span className="font-medium text-gray-900 dark:text-white">
              ${formatNumber(total)} {symbol.split('/')[1]}
            </span>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={submitOrder}
          disabled={isSubmitting || !quantity}
          className={`w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            side === 'buy'
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
          }`}
        >
          {isSubmitting ? 'Processing...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol.split('/')[0]}`}
        </button>
      </div>
    </div>
  );
};

// Open Orders Component
const OpenOrders: React.FC<{ symbol: string }> = ({ symbol }) => {
  const { orders, loading, cancelOrder } = useOpenOrders(symbol);

  if (loading && orders.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <div className="text-gray-400 text-sm">No open orders</div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white">Open Orders ({orders.length})</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left text-gray-500">Time</th>
              <th className="px-3 py-2 text-left text-gray-500">Type</th>
              <th className="px-3 py-2 text-left text-gray-500">Side</th>
              <th className="px-3 py-2 text-right text-gray-500">Price</th>
              <th className="px-3 py-2 text-right text-gray-500">Amount</th>
              <th className="px-3 py-2 text-right text-gray-500">Filled</th>
              <th className="px-3 py-2 text-right text-gray-500">Total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.orderId} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-3 py-2 text-gray-500">{formatTime(order.createdAt)}</td>
                <td className="px-3 py-2 text-gray-900 dark:text-white uppercase">{order.type}</td>
                <td className={`px-3 py-2 font-medium ${order.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                  {order.side.toUpperCase()}
                </td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                  {formatPrice(order.price)}
                </td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                  {formatQuantity(order.quantity)}
                </td>
                <td className="px-3 py-2 text-right text-gray-500">
                  {((parseFloat(order.filledQuantity) / parseFloat(order.quantity)) * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                  ${formatNumber(parseFloat(order.price) * parseFloat(order.quantity))}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => cancelOrder(order.orderId)}
                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Positions Component
const Positions: React.FC = () => {
  const { positions, loading } = usePositions();

  if (loading && positions.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-12 bg-gray-200 dark:bg-gray-800 rounded" />
          <div className="h-12 bg-gray-200 dark:bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <div className="text-gray-400 text-sm">No open positions</div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white">Positions ({positions.length})</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left text-gray-500">Symbol</th>
              <th className="px-3 py-2 text-left text-gray-500">Side</th>
              <th className="px-3 py-2 text-right text-gray-500">Size</th>
              <th className="px-3 py-2 text-right text-gray-500">Entry</th>
              <th className="px-3 py-2 text-right text-gray-500">Mark</th>
              <th className="px-3 py-2 text-right text-gray-500">Liq. Price</th>
              <th className="px-3 py-2 text-right text-gray-500">PnL</th>
              <th className="px-3 py-2 text-right text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => {
              const pnl = parseFloat(pos.unrealizedPnl);
              const isProfit = pnl >= 0;
              
              return (
                <tr key={pos.positionId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{pos.symbol}</td>
                  <td className={`px-3 py-2 font-medium ${pos.side === 'long' ? 'text-green-500' : 'text-red-500'}`}>
                    {pos.side.toUpperCase()}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                    {formatQuantity(pos.size)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                    ${formatPrice(pos.entryPrice)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                    ${formatPrice(pos.markPrice)}
                  </td>
                  <td className="px-3 py-2 text-right text-orange-500">
                    ${formatPrice(pos.liquidationPrice)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                    ${formatNumber(pnl)} ({pos.unrealizedPnlPercent}%)
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <button className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs hover:bg-gray-200 dark:hover:bg-gray-700">
                        +Add
                      </button>
                      <button className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs hover:bg-gray-200 dark:hover:bg-gray-700">
                        Reduce
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Trade History (Full)
const TradeHistoryFull: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    const fetchTrades = async () => {
      const data = await apiService.get<Trade[]>(`/trades?symbol=${symbol}`);
      setTrades(data);
    };
    fetchTrades();
  }, [symbol]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white">Trade History</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left text-gray-500">Price</th>
              <th className="px-3 py-2 text-right text-gray-500">Amount</th>
              <th className="px-3 py-2 text-right text-gray-500">Total</th>
              <th className="px-3 py-2 text-right text-gray-500">Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                <td className={`px-3 py-2 ${trade.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                  {formatPrice(trade.price)}
                </td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                  {formatQuantity(trade.quantity)}
                </td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                  ${formatNumber(parseFloat(trade.price) * parseFloat(trade.quantity))}
                </td>
                <td className="px-3 py-2 text-right text-gray-500">
                  {formatTime(trade.time)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Balance Widget
const BalanceWidget: React.FC = () => {
  const { balances } = useApp();
  const [showAll, setShowAll] = useState(false);

  const displayBalances = showAll ? balances : balances.slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Assets</h3>
        <button 
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-orange-500 hover:underline"
        >
          {showAll ? 'Show Less' : 'Show All'}
        </button>
      </div>
      
      <div className="p-2">
        {displayBalances.map(balance => (
          <div key={balance.currency} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold">
                {balance.currency.slice(0, 2)}
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{balance.currency}</div>
                <div className="text-xs text-gray-500">${balance.usdValue}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-gray-900 dark:text-white">{formatNumber(balance.total)}</div>
              <div className="text-xs text-gray-500">
                {balance.locked !== '0' && `🔒 ${balance.locked}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Main Trading Page Component
const TradingPage: React.FC = () => {
  const { selectedMarket, setSelectedMarket } = useApp();
  const [view, setView] = useState<'spot' | 'margin' | 'futures'>('spot');
  const { orderBook, trades, ticker } = useWebSocket(selectedMarket?.symbol || 'BTC/USDT');

  // Default market if none selected
  useEffect(() => {
    if (!selectedMarket) {
      setSelectedMarket({
        symbol: 'BTC/USDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        price: '0',
        priceChange24h: '0',
        priceChangePercent24h: '0',
        high24h: '0',
        low24h: '0',
        volume24h: '0',
        quoteVolume24h: '0'
      });
    }
  }, [selectedMarket, setSelectedMarket]);

  const symbol = selectedMarket?.symbol || 'BTC/USDT';

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Left Sidebar - Markets List */}
      <div className="w-64 border-r border-gray-200 dark:border-gray-800 overflow-y-auto p-2">
        <MarketList />
      </div>

      {/* Main Trading Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Ticker Bar */}
        <div className="h-12 border-b border-gray-200 dark:border-gray-800 px-4 flex items-center">
          <PriceTicker ticker={ticker} symbol={symbol} />
        </div>

        {/* Trading View */}
        <div className="flex-1 grid grid-cols-12 gap-2 p-2 min-h-0">
          {/* Chart */}
          <div className="col-span-8 row-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
            <TradingChart symbol={symbol} />
          </div>

          {/* Order Book */}
          <div className="col-span-4">
            <OrderBook data={orderBook} />
          </div>

          {/* Trade History */}
          <div className="col-span-4">
            <TradeHistory trades={trades} />
          </div>
        </div>

        {/* Order Form & Positions */}
        <div className="h-80 border-t border-gray-200 dark:border-gray-800 p-2">
          {/* Tabs */}
          <div className="flex gap-2 mb-2">
            {['Orders', 'Positions', 'Order History', 'Trade History'].map(tab => (
              <button
                key={tab}
                className="px-4 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
              >
                {tab}
              </button>
            ))}
          </div>
          
          <div className="grid grid-cols-12 gap-2 h-[calc(100%-2.5rem)]">
            {/* Order Form */}
            <div className="col-span-3">
              <OrderForm symbol={symbol} price={ticker?.lastPrice || '0'} />
            </div>

            {/* Open Orders */}
            <div className="col-span-4">
              <OpenOrders symbol={symbol} />
            </div>

            {/* Positions */}
            <div className="col-span-5">
              <Positions />
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Balances */}
      <div className="w-64 border-l border-gray-200 dark:border-gray-800 p-2 overflow-y-auto">
        <BalanceWidget />
      </div>
    </div>
  );
};

// Market List Component
const MarketList: React.FC = () => {
  const { selectedMarket, setSelectedMarket } = useApp();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [filter, setFilter] = useState('all'); // all, favorites, gainers, losers
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchMarkets = async () => {
      const data = await apiService.get<Market[]>('/markets');
      setMarkets(data);
    };
    fetchMarkets();
  }, []);

  const filteredMarkets = useMemo(() => {
    let result = markets;

    if (search) {
      result = result.filter(m =>
        m.symbol.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (filter === 'gainers') {
      result = result.filter(m => parseFloat(m.priceChangePercent24h) > 0);
    } else if (filter === 'losers') {
      result = result.filter(m => parseFloat(m.priceChangePercent24h) < 0);
    }

    return result.sort((a, b) => parseFloat(b.quoteVolume24h) - parseFloat(a.quoteVolume24h));
  }, [markets, filter, search]);

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-2 py-1.5 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-xs"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 text-xs">
        {['all', 'gainers', 'losers'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 rounded ${
              filter === f
                ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Market List */}
      <div className="space-y-1">
        {filteredMarkets.map(market => (
          <button
            key={market.symbol}
            onClick={() => setSelectedMarket(market)}
            className={`w-full p-2 rounded-lg text-left transition-colors ${
              selectedMarket?.symbol === market.symbol
                ? 'bg-orange-100 dark:bg-orange-900/20'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-gray-900 dark:text-white">
                {market.symbol}
              </span>
              <span className={`text-xs ${
                parseFloat(market.priceChangePercent24h) >= 0
                  ? 'text-green-500'
                  : 'text-red-500'
              }`}>
                {formatPercent(market.priceChangePercent24h)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-900 dark:text-white font-medium">
                ${formatPrice(market.price)}
              </span>
              <span className="text-gray-500">
                {abbreviateNumber(parseFloat(market.quoteVolume24h))}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// MAIN APP COMPONENT
// =============================================================================

export function TradingApp() {
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);

  useEffect(() => {
    // Check for saved theme preference
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    // Apply theme to document
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Mock user for demo
  useEffect(() => {
    setUser({
      userId: 'demo-user-1',
      email: 'demo@tigerex.com',
      username: 'DemoTrader',
      kycLevel: 'intermediate',
      twoFactorEnabled: true
    });
  }, []);

  // Mock balances for demo
  useEffect(() => {
    setBalances([
      { currency: 'BTC', available: '0.5432', locked: '0.1', total: '0.6432', usdValue: '21,500' },
      { currency: 'ETH', available: '5.2341', locked: '0', total: '5.2341', usdValue: '10,200' },
      { currency: 'USDT', available: '10,000', locked: '500', total: '10,500', usdValue: '10,500' },
      { currency: 'BNB', available: '25.5', locked: '0', total: '25.5', usdValue: '7,650' },
      { currency: 'SOL', available: '100', locked: '10', total: '110', usdValue: '12,100' },
      { currency: 'XRP', available: '5000', locked: '0', total: '5000', usdValue: '2,500' },
      { currency: 'ADA', available: '10000', locked: '0', total: '10000', usdValue: '4,000' },
    ]);
  }, []);

  return (
    <AppContext.Provider value={{
      user, setUser,
      theme, setTheme,
      selectedMarket, setSelectedMarket,
      balances, setBalances
    }}>
      <div className={`min-h-screen bg-gray-50 dark:bg-gray-950 ${theme}`}>
        <Header />
        <TradingPage />
      </div>
    </AppContext.Provider>
  );
}

export default TradingApp;