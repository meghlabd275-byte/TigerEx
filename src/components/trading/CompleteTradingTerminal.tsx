// =============================================================================
// TIGEREX v3.0 - COMPLETE TRADING TERMINAL
// Professional-grade trading interface with all order types
// =============================================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  TrendingUp, TrendingDown, Wallet, Bell, Settings, Search, 
  ChevronDown, ChevronUp, RefreshCw, Maximize2, Moon, Sun,
  Activity, BarChart3, PieChart, LineChart, Clock, Filter,
  ArrowUpRight, ArrowDownRight, ExternalLink, Copy, Trash2,
  Plus, Minus, AlertTriangle, Check, X, Info, Lock, 
  Zap, Shield, Globe, Smartphone, Users, CreditCard,
  ArrowRightLeft, Eye, EyeOff, RefreshCcw, Pause, Play,
  AlertCircle, CheckCircle, XCircle, InfoCircle, Warning
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
  marginEnabled: boolean;
  futuresEnabled: boolean;
  tradingExperience: 'beginner' | 'intermediate' | 'advanced' | 'professional';
}

interface Balance {
  currency: string;
  available: string;
  locked: string;
  total: string;
  usdValue: string;
  change24h: string;
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
  lastUpdate: number;
}

interface OrderBookLevel {
  price: string;
  quantity: string;
  total: string;
  percentage?: number;
}

interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: string;
  spreadPercent: string;
  midPrice: string;
}

interface Trade {
  id: string;
  price: string;
  quantity: string;
  time: string;
  side: 'buy' | 'sell';
  timestamp: number;
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
  status: 'pending' | 'new' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'GTT';
  createdAt: string;
  expiresAt?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
}

interface Position {
  id: string;
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
  mode: 'cross' | 'isolated';
  stopLoss?: string;
  takeProfit?: string;
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
  openPrice: string;
}

interface ChartDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface LeveragePreset {
  label: string;
  value: number;
}

interface TimeInterval {
  label: string;
  value: string;
}

// =============================================================================
// CONTEXT & STATE MANAGEMENT
// =============================================================================

interface AppState {
  user: User | null;
  theme: 'light' | 'dark';
  selectedMarket: Market | null;
  balances: Balance[];
  positions: Position[];
  orders: Order[];
  recentTrades: Trade[];
  orderBook: OrderBook;
  ticker: Ticker | null;
  isConnected: boolean;
}

interface AppContextType extends AppState {
  setUser: (user: User | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setSelectedMarket: (market: Market | null) => void;
  setBalances: (balances: Balance[]) => void;
  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
  setOrderBook: (ob: OrderBook) => void;
  setTicker: (ticker: Ticker) => void;
  connect: () => void;
  disconnect: () => void;
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

class TradingApiService {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private subscriptions: Set<string> = new Set();
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(baseUrl: string = '/api', wsUrl: string = 'wss://stream.tigerex.com') {
    this.baseUrl = baseUrl;
    this.wsUrl = wsUrl;
  }

  private getAuthHeaders(): HeadersInit {
    const token = typeof window !== 'undefined' ? localStorage.getItem('tigerex_token') : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  }

  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API Error: ${response.status}`);
    }
    return response.json();
  }

  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API Error: ${response.status}`);
    }
    return response.json();
  }

  async put<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API Error: ${response.status}`);
    }
    return response.json();
  }

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API Error: ${response.status}`);
    }
    return response.json();
  }

  // WebSocket connection
  connectWebSocket(onMessage: (data: any) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[WS] Connected to trading stream');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // Resubscribe to previous subscriptions
          this.subscriptions.forEach(channel => {
            this.sendSubscribe(channel);
          });
          
          // Start heartbeat
          this.startHeartbeat();
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle different message types
            if (data.type === 'heartbeat') {
              // Heartbeat response
              return;
            }
            
            // Route to appropriate handler
            const handler = this.messageHandlers.get(data.channel || data.type);
            if (handler) {
              handler(data);
            }
            
            onMessage(data);
          } catch (e) {
            console.error('[WS] Parse error:', e);
          }
        };

        this.ws.onclose = (event) => {
          console.log('[WS] Connection closed:', event.code, event.reason);
          this.stopHeartbeat();
          
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connectWebSocket(() => {}).catch(console.error);
    }, delay);
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  subscribe(channel: string, symbol?: string) {
    const subscriptionKey = symbol ? `${channel}:${symbol}` : channel;
    this.subscriptions.add(subscriptionKey);
    
    this.sendSubscribe(channel, symbol);
  }

  private sendSubscribe(channel: string, symbol?: string) {
    this.send({
      action: 'subscribe',
      channel,
      symbol,
    });
  }

  unsubscribe(channel: string, symbol?: string) {
    const subscriptionKey = symbol ? `${channel}:${symbol}` : channel;
    this.subscriptions.delete(subscriptionKey);
    
    this.send({
      action: 'unsubscribe',
      channel,
      symbol,
    });
  }

  onMessage(channel: string, handler: (data: any) => void) {
    this.messageHandlers.set(channel, handler);
  }

  offMessage(channel: string) {
    this.messageHandlers.delete(channel);
  }

  disconnect() {
    this.stopHeartbeat();
    this.subscriptions.clear();
    this.messageHandlers.clear();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Trading API methods
  async getMarkets(): Promise<Market[]> {
    return this.get<Market[]>('/markets');
  }

  async getOrderBook(symbol: string, depth: number = 20): Promise<OrderBook> {
    return this.get<OrderBook>(`/orderbook/${symbol}?depth=${depth}`);
  }

  async getRecentTrades(symbol: string, limit: number = 50): Promise<Trade[]> {
    return this.get<Trade[]>(`/trades/${symbol}?limit=${limit}`);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return this.get<Ticker>(`/ticker/${symbol}`);
  }

  async getBalances(): Promise<Balance[]> {
    return this.get<Balance[]>('/balances');
  }

  async getPositions(): Promise<Position[]> {
    return this.get<Position[]>('/positions');
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const endpoint = symbol ? `/orders?symbol=${symbol}` : '/orders';
    return this.get<Order[]>(endpoint);
  }

  async getOrderHistory(symbol?: string, limit: number = 100): Promise<Order[]> {
    const endpoint = symbol ? `/orders/history?symbol=${symbol}&limit=${limit}` : `/orders/history?limit=${limit}`;
    return this.get<Order[]>(endpoint);
  }

  async placeOrder(orderData: {
    symbol: string;
    side: 'buy' | 'sell';
    type: string;
    quantity: string;
    price?: string;
    stopPrice?: string;
    timeInForce?: string;
    postOnly?: boolean;
    reduceOnly?: boolean;
    leverage?: number;
    marginMode?: string;
  }): Promise<Order> {
    return this.post<Order>('/orders', orderData);
  }

  async cancelOrder(orderId: string): Promise<void> {
    return this.delete(`/orders/${orderId}`);
  }

  async cancelAllOrders(symbol?: string): Promise<void> {
    const endpoint = symbol ? `/orders?symbol=${symbol}` : '/orders';
    return this.delete(endpoint);
  }

  async setLeverage(symbol: string, leverage: number, marginMode: 'cross' | 'isolated' = 'cross'): Promise<void> {
    return this.post('/margin/leverage', { symbol, leverage, marginMode });
  }

  async addMargin(symbol: string, amount: string): Promise<void> {
    return this.post('/margin/add', { symbol, amount });
  }

  async reduceMargin(symbol: string, amount: string): Promise<void> {
    return this.post('/margin/reduce', { symbol, amount });
  }
}

// Singleton instance
const apiService = new TradingApiService();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const formatNumber = (num: string | number, decimals: number = 2): string => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatPrice = (price: string | number): string => {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(p)) return '0.00';
  if (p >= 10000) return formatNumber(p, 2);
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

const formatTime = (timestamp: number | string): string => {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDateTime = (timestamp: number | string): string => {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const abbreviateNumber = (num: number): string => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

const calculateOrderValue = (price: string | number, quantity: string | number): number => {
  return parseFloat(String(price)) * parseFloat(String(quantity));
};

// =============================================================================
// CUSTOM HOOKS
// =============================================================================

function useWebSocketConnection(symbol: string) {
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [], spread: '0', spreadPercent: '0', midPrice: '0' });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const connect = async () => {
      try {
        await apiService.connectWebSocket((data) => {
          switch (data.type) {
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
        });

        apiService.subscribe('orderbook', symbol);
        apiService.subscribe('trades', symbol);
        apiService.subscribe('ticker', symbol);

        setIsConnected(true);
      } catch (error) {
        console.error('WebSocket connection failed:', error);
      }
    };

    connect();

    return () => {
      apiService.unsubscribe('orderbook', symbol);
      apiService.unsubscribe('trades', symbol);
      apiService.unsubscribe('ticker', symbol);
    };
  }, [symbol]);

  return { orderBook, trades, ticker, isConnected };
}

function useOrderEntry() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<string>('limit');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');
  const [timeInForce, setTimeInForce] = useState('GTC');
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => {
    return calculateOrderValue(price, quantity);
  }, [price, quantity]);

  const availableBalance = useMemo(() => {
    // In real implementation, get from context
    return '10000.00';
  }, []);

  const estimatedFee = useMemo(() => {
    // Maker fee 0.02%, Taker fee 0.04%
    const feeRate = orderType === 'market' ? 0.0004 : 0.0002;
    return total * feeRate;
  }, [total, orderType]);

  const handleSubmit = async (symbol: string) => {
    if (!price && orderType !== 'market') {
      setError('Please enter a price');
      return;
    }
    if (!quantity) {
      setError('Please enter a quantity');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const orderData = {
        symbol,
        side,
        type: orderType,
        quantity,
        price: orderType === 'market' ? undefined : price,
        stopPrice: ['stop_loss', 'stop_limit', 'take_profit'].includes(orderType) ? stopPrice : undefined,
        timeInForce: ['limit', 'stop_limit'].includes(orderType) ? timeInForce : undefined,
        postOnly,
        reduceOnly,
        leverage,
        marginMode,
      };

      await apiService.placeOrder(orderData);
      
      // Reset form
      setQuantity('');
      setPrice('');
      setStopPrice('');
    } catch (e: any) {
      setError(e.message || 'Failed to place order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    side, setSide,
    orderType, setOrderType,
    price, setPrice,
    stopPrice, setStopPrice,
    quantity, setQuantity,
    leverage, setLeverage,
    marginMode, setMarginMode,
    timeInForce, setTimeInForce,
    postOnly, setPostOnly,
    reduceOnly, setReduceOnly,
    isSubmitting,
    error,
    total,
    availableBalance,
    estimatedFee,
    handleSubmit,
  };
}

function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  };

  return [storedValue, setValue];
}

// =============================================================================
// COMPONENTS
// =============================================================================

// Header Component
const Header: React.FC = () => {
  const { theme, setTheme, user, isConnected } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 flex items-center justify-between">
      {/* Left - Logo & Navigation */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">T</span>
          </div>
          <span className="text-xl font-bold text-gray-900 dark:text-white">TigerEx</span>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {['Markets', 'Trade', 'Earn', 'Futures', 'NFT'].map((item) => (
            <button
              key={item}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {item}
            </button>
          ))}
        </nav>
      </div>

      {/* Center - Search */}
      <div className="hidden lg:flex items-center flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search markets, currencies..."
            className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-2">
        {/* Connection Status */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{isConnected ? 'Live' : 'Offline'}</span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg relative"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* Profile */}
        {user ? (
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex items-center gap-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">{user.username[0].toUpperCase()}</span>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
        ) : (
          <button className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600">
            Log In
          </button>
        )}
      </div>
    </header>
  );
};

// Market Selector Component
const MarketSelector: React.FC<{
  markets: Market[];
  selectedMarket: Market | null;
  onSelectMarket: (market: Market) => void;
}> = ({ markets, selectedMarket, onSelectMarket }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites' | 'gainers' | 'losers'>('all');

  const filteredMarkets = useMemo(() => {
    let result = markets;

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.symbol.toLowerCase().includes(searchLower) ||
          m.baseAsset.toLowerCase().includes(searchLower)
      );
    }

    switch (filter) {
      case 'gainers':
        result = result.filter((m) => parseFloat(m.priceChangePercent24h) > 0);
        break;
      case 'losers':
        result = result.filter((m) => parseFloat(m.priceChangePercent24h) < 0);
        break;
      // favorites would need a separate store
    }

    return result.sort((a, b) => parseFloat(b.quoteVolume24h) - parseFloat(a.quoteVolume24h));
  }, [markets, search, filter]);

  return (
    <div className="w-72 border-r border-gray-200 dark:border-gray-800 flex flex-col">
      {/* Search & Filter */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'gainers', 'losers'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 px-2 py-1 text-xs rounded-lg transition-colors ${
                filter === f
                  ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Markets List */}
      <div className="flex-1 overflow-y-auto">
        {filteredMarkets.map((market) => {
          const isPositive = parseFloat(market.priceChangePercent24h) >= 0;
          const isSelected = selectedMarket?.symbol === market.symbol;

          return (
            <button
              key={market.symbol}
              onClick={() => onSelectMarket(market)}
              className={`w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                isSelected ? 'bg-orange-50 dark:bg-orange-900/10' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm text-gray-900 dark:text-white">
                  {market.symbol}
                </span>
                <span className={`text-xs font-medium ${
                  isPositive ? 'text-green-500' : 'text-red-500'
                }`}>
                  {formatPercent(market.priceChangePercent24h)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-900 dark:text-white font-medium">
                  ${formatPrice(market.price)}
                </span>
                <span className="text-gray-500">
                  Vol: {abbreviateNumber(parseFloat(market.quoteVolume24h))}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Ticker Display Component
const TickerDisplay: React.FC<{ ticker: Ticker | null; symbol: string }> = ({ ticker, symbol }) => {
  if (!ticker) return null;

  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;

  return (
    <div className="h-12 border-b border-gray-200 dark:border-gray-800 px-4 flex items-center gap-6">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-gray-900 dark:text-white">{symbol}</span>
        <span className={`text-sm px-1.5 py-0.5 rounded ${
          isPositive ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
        }`}>
          {formatPercent(ticker.priceChangePercent)}
        </span>
      </div>

      <div className="text-2xl font-bold text-gray-900 dark:text-white">
        ${formatPrice(ticker.lastPrice)}
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <div>
          <span className="text-gray-400">24h High</span>
          <span className="ml-1 text-gray-900 dark:text-white">${formatPrice(ticker.high24h)}</span>
        </div>
        <div>
          <span className="text-gray-400">24h Low</span>
          <span className="ml-1 text-gray-900 dark:text-white">${formatPrice(ticker.low24h)}</span>
        </div>
        <div>
          <span className="text-gray-400">24h Vol</span>
          <span className="ml-1 text-gray-900 dark:text-white">{abbreviateNumber(parseFloat(ticker.volume24h))}</span>
        </div>
        <div>
          <span className="text-gray-400">Bid</span>
          <span className="ml-1 text-green-500">{formatPrice(ticker.bidPrice)}</span>
        </div>
        <div>
          <span className="text-gray-400">Ask</span>
          <span className="ml-1 text-red-500">{formatPrice(ticker.askPrice)}</span>
        </div>
      </div>
    </div>
  );
};

// Order Book Component
const OrderBookComponent: React.FC<{ orderBook: OrderBook; onPriceClick: (price: string) => void }> = ({ 
  orderBook, 
  onPriceClick 
}) => {
  const maxQuantity = useMemo(() => {
    const allQuantities = [
      ...orderBook.bids.map((b) => parseFloat(b.quantity)),
      ...orderBook.asks.map((a) => parseFloat(a.quantity)),
    ];
    return Math.max(...allQuantities, 1);
  }, [orderBook]);

  const calculatePercentage = (quantity: number) => {
    return (quantity / maxQuantity) * 100;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="grid grid-cols-3 gap-2 px-2 py-1 text-xs text-gray-500 border-b border-gray-200 dark:border-gray-800">
        <span>Price ({orderBook.bids[0]?.price ? 'USDT' : ''})</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (reversed, lowest at bottom) */}
      <div className="flex-1 overflow-y-auto flex flex-col-reverse">
        {orderBook.asks.slice(0, 15).map((level, i) => (
          <div
            key={`ask-${i}`}
            className="grid grid-cols-3 gap-2 px-2 py-0.5 text-xs relative hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
            onClick={() => onPriceClick(level.price)}
          >
            {/* Background bar */}
            <div
              className="absolute inset-y-0 right-0 bg-red-500/10"
              style={{ width: `${calculatePercentage(parseFloat(level.quantity))}%` }}
            />
            <span className="text-red-500 relative z-10">{formatPrice(level.price)}</span>
            <span className="text-right text-gray-900 dark:text-white relative z-10">{formatQuantity(level.quantity)}</span>
            <span className="text-right text-gray-500 relative z-10">{formatQuantity(level.total)}</span>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div className="px-2 py-1 text-xs text-center border-y border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        <span className="text-gray-500">Spread: </span>
        <span className="text-gray-900 dark:text-white">{formatPrice(orderBook.spread)}</span>
        <span className="text-gray-400 ml-1">({orderBook.spreadPercent}%)</span>
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-y-auto">
        {orderBook.bids.slice(0, 15).map((level, i) => (
          <div
            key={`bid-${i}`}
            className="grid grid-cols-3 gap-2 px-2 py-0.5 text-xs relative hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
            onClick={() => onPriceClick(level.price)}
          >
            {/* Background bar */}
            <div
              className="absolute inset-y-0 right-0 bg-green-500/10"
              style={{ width: `${calculatePercentage(parseFloat(level.quantity))}%` }}
            />
            <span className="text-green-500 relative z-10">{formatPrice(level.price)}</span>
            <span className="text-right text-gray-900 dark:text-white relative z-10">{formatQuantity(level.quantity)}</span>
            <span className="text-right text-gray-500 relative z-10">{formatQuantity(level.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Recent Trades Component
const RecentTrades: React.FC<{ trades: Trade[] }> = ({ trades }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-3 gap-2 px-2 py-1 text-xs text-gray-500 border-b border-gray-200 dark:border-gray-800">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {trades.map((trade, i) => (
          <div
            key={trade.id || i}
            className="grid grid-cols-3 gap-2 px-2 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <span className={trade.side === 'buy' ? 'text-green-500' : 'text-red-500'}>
              {formatPrice(trade.price)}
            </span>
            <span className="text-right text-gray-900 dark:text-white">
              {formatQuantity(trade.quantity)}
            </span>
            <span className="text-right text-gray-500">{trade.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Trading Chart Component
const TradingChart: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [interval, setInterval] = useState('1h');
  const [chartType, setChartType] = useState<'candlestick' | 'line' | 'area'>('candlestick');

  const intervals: TimeInterval[] = [
    { label: '1m', value: '1m' },
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '4h', value: '4h' },
    { label: '1D', value: '1d' },
    { label: '1W', value: '1w' },
  ];

  // Generate mock chart data
  const chartData = useMemo(() => {
    const data: ChartDataPoint[] = [];
    let basePrice = symbol.includes('BTC') ? 67000 : symbol.includes('ETH') ? 3500 : 100;
    const now = Date.now();
    
    for (let i = 100; i >= 0; i--) {
      const time = now - i * 3600000;
      const volatility = basePrice * 0.02;
      const open = basePrice + (Math.random() - 0.5) * volatility;
      const close = open + (Math.random() - 0.5) * volatility;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      
      data.push({
        time,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000,
      });
      
      basePrice = close;
    }
    
    return data;
  }, [symbol]);

  return (
    <div className="flex flex-col h-full">
      {/* Chart Controls */}
      <div className="flex items-center justify-between p-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-1">
          {intervals.map((int) => (
            <button
              key={int.value}
              onClick={() => setInterval(int.value)}
              className={`px-2 py-1 text-xs rounded ${
                interval === int.value
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {int.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setChartType('candlestick')}
            className={`p-1.5 rounded ${chartType === 'candlestick' ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          >
            <Activity className="w-4 h-4" />
          </button>
          <button
            onClick={() => setChartType('line')}
            className={`p-1.5 rounded ${chartType === 'line' ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          >
            <LineChart className="w-4 h-4" />
          </button>
          <button
            onClick={() => setChartType('area')}
            className={`p-1.5 rounded ${chartType === 'area' ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          >
            <BarChart3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex-1 p-4 relative">
        <div className="absolute inset-4 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <BarChart3 className="w-16 h-16 mx-auto mb-2 opacity-50" />
            <p className="text-sm">TradingView Chart</p>
            <p className="text-xs opacity-75">Integration Ready</p>
          </div>
        </div>

        {/* Grid overlay for visual reference */}
        <div className="absolute inset-4 grid grid-cols-6 grid-rows-4 pointer-events-none opacity-5">
          {[...Array(6)].map((_, i) => (
            <div key={`v-${i}`} className="border-r border-gray-300" />
          ))}
          {[...Array(4)].map((_, i) => (
            <div key={`h-${i}`} className="border-b border-gray-300" />
          ))}
        </div>
      </div>
    </div>
  );
};

// Order Form Component
const OrderForm: React.FC<{
  symbol: string;
  currentPrice: string;
  onPriceChange: (price: string) => void;
}> = ({ symbol, currentPrice, onPriceChange }) => {
  const {
    side, setSide,
    orderType, setOrderType,
    price, setPrice,
    stopPrice, setStopPrice,
    quantity, setQuantity,
    leverage, setLeverage,
    marginMode, setMarginMode,
    timeInForce, setTimeInForce,
    postOnly, setPostOnly,
    reduceOnly, setReduceOnly,
    isSubmitting,
    error,
    total,
    availableBalance,
    estimatedFee,
    handleSubmit,
  } = useOrderEntry();

  const [showLeverageSlider, setShowLeverageSlider] = useState(false);

  const leveragePresets: LeveragePreset[] = [
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
    { label: '5x', value: 5 },
    { label: '10x', value: 10 },
    { label: '20x', value: 20 },
    { label: '50x', value: 50 },
    { label: '100x', value: 100 },
  ];

  const orderTypes = [
    { value: 'limit', label: 'Limit' },
    { value: 'market', label: 'Market' },
    { value: 'stop_loss', label: 'Stop Loss' },
    { value: 'stop_limit', label: 'Stop Limit' },
    { value: 'take_profit', label: 'Take Profit' },
    { value: 'trailing_stop', label: 'Trailing' },
  ];

  const timeInForceOptions = [
    { value: 'GTC', label: 'GTC' },
    { value: 'IOC', label: 'IOC' },
    { value: 'FOK', label: 'FOK' },
  ];

  return (
    <div className="flex flex-col h-full p-3 space-y-3">
      {/* Buy/Sell Toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            side === 'buy'
              ? 'bg-green-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            side === 'sell'
              ? 'bg-red-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Order Type */}
      <div className="flex gap-1 flex-wrap">
        {orderTypes.map((type) => (
          <button
            key={type.value}
            onClick={() => setOrderType(type.value)}
            className={`px-2 py-1 text-xs rounded-lg transition-colors ${
              orderType === type.value
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {/* Leverage */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Leverage</span>
          <button
            onClick={() => setShowLeverageSlider(!showLeverageSlider)}
            className="text-orange-500 hover:text-orange-600"
          >
            {leverage}x
          </button>
        </div>

        {showLeverageSlider && (
          <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg space-y-2">
            <input
              type="range"
              min="1"
              max="125"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex gap-1 flex-wrap">
              {leveragePresets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setLeverage(preset.value)}
                  className={`px-2 py-0.5 text-xs rounded ${
                    leverage === preset.value
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Margin Mode Toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setMarginMode('cross')}
            className={`flex-1 py-1 text-xs rounded ${
              marginMode === 'cross'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}
          >
            Cross
          </button>
          <button
            onClick={() => setMarginMode('isolated')}
            className={`flex-1 py-1 text-xs rounded ${
              marginMode === 'isolated'
                ? 'bg-purple-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}
          >
            Isolated
          </button>
        </div>
      </div>

      {/* Price Input */}
      {orderType !== 'market' && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Price</label>
          <div className="relative">
            <input
              type="number"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                onPriceChange(e.target.value);
              }}
              placeholder={currentPrice}
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
            />
            <button
              onClick={() => setPrice(currentPrice)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-orange-500 hover:text-orange-600"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Stop Price */}
      {['stop_loss', 'stop_limit', 'take_profit'].includes(orderType) && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Stop Price</label>
          <input
            type="number"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
          />
        </div>
      )}

      {/* Quantity Input */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Amount</label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0.00"
          className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
        />
        <div className="flex gap-1 mt-1">
          {['25%', '50%', '75%', '100%'].map((pct) => (
            <button
              key={pct}
              onClick={() => {
                const balance = parseFloat(availableBalance);
                const priceVal = parseFloat(price || currentPrice);
                if (priceVal > 0) {
                  const percent = parseInt(pct) / 100;
                  setQuantity(String((balance / priceVal) * percent));
                }
              }}
              className="flex-1 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              {pct}
            </button>
          ))}
        </div>
      </div>

      {/* Time in Force (for limit orders) */}
      {orderType === 'limit' && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Time in Force</label>
          <div className="flex gap-1">
            {timeInForceOptions.map((tif) => (
              <button
                key={tif.value}
                onClick={() => setTimeInForce(tif.value)}
                className={`flex-1 py-1 text-xs rounded ${
                  timeInForce === tif.value
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                {tif.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Options */}
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={postOnly}
            onChange={(e) => setPostOnly(e.target.checked)}
            className="rounded"
          />
          <span className="text-gray-500">Post Only</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
            className="rounded"
          />
          <span className="text-gray-500">Reduce Only</span>
        </label>
      </div>

      {/* Order Summary */}
      <div className="text-xs space-y-1 p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <div className="flex justify-between">
          <span className="text-gray-500">Total</span>
          <span className="text-gray-900 dark:text-white font-medium">${formatNumber(total, 2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Est. Fee</span>
          <span className="text-gray-600 dark:text-gray-400">${formatNumber(estimatedFee, 4)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Available</span>
          <span className="text-gray-600 dark:text-gray-400">${availableBalance}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-500 p-2 bg-red-50 dark:bg-red-900/10 rounded-lg flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={() => handleSubmit(symbol)}
        disabled={isSubmitting || !quantity}
        className={`w-full py-3 rounded-lg font-medium text-sm transition-colors ${
          side === 'buy'
            ? 'bg-green-500 hover:bg-green-600 text-white disabled:bg-green-300'
            : 'bg-red-500 hover:bg-red-600 text-white disabled:bg-red-300'
        } disabled:cursor-not-allowed`}
      >
        {isSubmitting ? 'Placing Order...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol.split('/')[0]}`}
      </button>
    </div>
  );
};

// Open Orders Component
const OpenOrders: React.FC<{ orders: Order[]; onCancel: (orderId: string) => void }> = ({ orders, onCancel }) => {
  if (orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        <div className="text-center">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No open orders</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-200 dark:border-gray-800">
            <th className="py-2 px-2 text-left">Time</th>
            <th className="py-2 px-2 text-left">Symbol</th>
            <th className="py-2 px-2 text-left">Type</th>
            <th className="py-2 px-2 text-right">Price</th>
            <th className="py-2 px-2 text-right">Amount</th>
            <th className="py-2 px-2 text-right">Filled</th>
            <th className="py-2 px-2 text-right">Total</th>
            <th className="py-2 px-2 text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.orderId} className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="py-2 px-2 text-gray-500">{formatTime(order.createdAt)}</td>
              <td className="py-2 px-2">
                <span className={order.side === 'buy' ? 'text-green-500' : 'text-red-500'}>
                  {order.side.toUpperCase()}
                </span>
                {' '}{order.symbol}
              </td>
              <td className="py-2 px-2 text-gray-500">{order.type}</td>
              <td className="py-2 px-2 text-right">${formatPrice(order.price)}</td>
              <td className="py-2 px-2 text-right">{formatQuantity(order.quantity)}</td>
              <td className="py-2 px-2 text-right">{formatPercent((parseFloat(order.filledQuantity) / parseFloat(order.quantity)) * 100)}</td>
              <td className="py-2 px-2 text-right">${formatNumber(parseFloat(order.price) * parseFloat(order.quantity), 2)}</td>
              <td className="py-2 px-2 text-center">
                <button
                  onClick={() => onCancel(order.orderId)}
                  className="text-red-500 hover:text-red-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Positions Component
const PositionsComponent: React.FC<{ positions: Position[] }> = ({ positions }) => {
  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        <div className="text-center">
          <PieChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No open positions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-200 dark:border-gray-800">
            <th className="py-2 px-2 text-left">Symbol</th>
            <th className="py-2 px-2 text-left">Side</th>
            <th className="py-2 px-2 text-right">Size</th>
            <th className="py-2 px-2 text-right">Entry</th>
            <th className="py-2 px-2 text-right">Mark</th>
            <th className="py-2 px-2 text-right">Liq. Price</th>
            <th className="py-2 px-2 text-right">PnL</th>
            <th className="py-2 px-2 text-right">Margin</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const pnlValue = parseFloat(pos.unrealizedPnl);
            const isProfit = pnlValue >= 0;

            return (
              <tr key={pos.id} className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-2 px-2 font-medium">{pos.symbol}</td>
                <td className="py-2 px-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    pos.side === 'long' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                  }`}>
                    {pos.side.toUpperCase()} {pos.leverage}x
                  </span>
                </td>
                <td className="py-2 px-2 text-right">{formatQuantity(pos.size)}</td>
                <td className="py-2 px-2 text-right">${formatPrice(pos.entryPrice)}</td>
                <td className="py-2 px-2 text-right">${formatPrice(pos.markPrice)}</td>
                <td className="py-2 px-2 text-right text-gray-500">${formatPrice(pos.liquidationPrice)}</td>
                <td className={`py-2 px-2 text-right font-medium ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                  ${formatNumber(pnlValue, 2)} ({pos.unrealizedPnlPercent})
                </td>
                <td className="py-2 px-2 text-right">${formatNumber(pos.margin, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Balance Widget Component
const BalanceWidget: React.FC<{ balances: Balance[] }> = ({ balances }) => {
  const [showAll, setShowAll] = useState(false);

  const displayedBalances = showAll ? balances : balances.slice(0, 5);
  const totalUSD = useMemo(() => {
    return balances.reduce((sum, b) => sum + parseFloat(b.usdValue.replace(/,/g, '') || '0'), 0);
  }, [balances]);

  return (
    <div className="space-y-2">
      <div className="p-3 bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg text-white">
        <div className="text-xs opacity-75">Total Portfolio Value</div>
        <div className="text-2xl font-bold">${formatNumber(totalUSD, 2)}</div>
      </div>

      <div className="space-y-1">
        {displayedBalances.map((balance) => (
          <div
            key={balance.currency}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-medium">
                {balance.currency[0]}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{balance.currency}</div>
                <div className="text-xs text-gray-500">{formatQuantity(balance.total)}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900 dark:text-white">${balance.usdValue}</div>
              <div className={`text-xs ${parseFloat(balance.change24h) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatPercent(balance.change24h)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {balances.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-sm text-orange-500 hover:text-orange-600 font-medium"
        >
          {showAll ? 'Show Less' : `Show All (${balances.length})`}
        </button>
      )}
    </div>
  );
};

// =============================================================================
// MAIN TRADING TERMINAL COMPONENT
// =============================================================================

export function TradingTerminal() {
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Mock data for demo
  const [markets] = useState<Market[]>([
    { symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', price: '67523.45', priceChange24h: '1234.56', priceChangePercent24h: '1.86', high24h: '68000.00', low24h: '66500.00', volume24h: '25000', quoteVolume24h: '1687000000', lastUpdate: Date.now() },
    { symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', price: '3542.18', priceChange24h: '45.23', priceChangePercent24h: '1.29', high24h: '3600.00', low24h: '3500.00', volume24h: '150000', quoteVolume24h: '531327000', lastUpdate: Date.now() },
    { symbol: 'BNB/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', price: '598.32', priceChange24h: '-5.67', priceChangePercent24h: '-0.94', high24h: '605.00', low24h: '595.00', volume24h: '50000', quoteVolume24h: '29916000', lastUpdate: Date.now() },
    { symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', price: '172.45', priceChange24h: '8.23', priceChangePercent24h: '5.01', high24h: '175.00', low24h: '165.00', volume24h: '80000', quoteVolume24h: '13796000', lastUpdate: Date.now() },
    { symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', price: '0.5234', priceChange24h: '-0.0123', priceChangePercent24h: '-2.30', high24h: '0.5400', low24h: '0.5200', volume24h: '200000', quoteVolume24h: '104680', lastUpdate: Date.now() },
  ]);

  const [orderBook, setOrderBook] = useState<OrderBook>({
    bids: [
      { price: '67520.00', quantity: '2.5432', total: '171692.65', percentage: 80 },
      { price: '67518.50', quantity: '1.2345', total: '83355.35', percentage: 40 },
      { price: '67515.00', quantity: '3.2156', total: '217123.98', percentage: 100 },
      { price: '67512.00', quantity: '0.8765', total: '59195.78', percentage: 27 },
      { price: '67510.00', quantity: '2.1234', total: '143345.34', percentage: 66 },
      { price: '67508.50', quantity: '1.5678', total: '105831.63', percentage: 49 },
      { price: '67505.00', quantity: '4.2345', total: '285876.02', percentage: 100 },
      { price: '67502.00', quantity: '0.9876', total: '66664.07', percentage: 31 },
      { price: '67500.00', quantity: '2.3456', total: '158328.00', percentage: 73 },
      { price: '67498.00', quantity: '1.4567', total: '98321.45', percentage: 45 },
    ],
    asks: [
      { price: '67525.00', quantity: '1.8765', total: '126678.71', percentage: 58 },
      { price: '67528.00', quantity: '2.3456', total: '158452.86', percentage: 73 },
      { price: '67530.00', quantity: '3.5678', total: '241019.87', percentage: 100 },
      { price: '67532.50', quantity: '1.1234', total: '75857.34', percentage: 35 },
      { price: '67535.00', quantity: '2.8765', total: '194234.28', percentage: 89 },
      { price: '67538.00', quantity: '0.7654', total: '51709.46', percentage: 24 },
      { price: '67540.00', quantity: '3.2345', total: '218459.80', percentage: 100 },
      { price: '67542.50', quantity: '1.6543', total: '111738.18', percentage: 51 },
      { price: '67545.00', quantity: '2.1234', total: '143489.43', percentage: 66 },
      { price: '67548.00', quantity: '1.0987', total: '74224.76', percentage: 34 },
    ],
    spread: '5.00',
    spreadPercent: '0.0074',
    midPrice: '67522.50',
  });

  const [recentTrades] = useState<Trade[]>([
    { id: '1', price: '67523.50', quantity: '0.5432', time: '12:34:56', side: 'buy', timestamp: Date.now() },
    { id: '2', price: '67522.00', quantity: '1.2345', time: '12:34:55', side: 'sell', timestamp: Date.now() - 1000 },
    { id: '3', price: '67525.00', quantity: '0.8765', time: '12:34:54', side: 'buy', timestamp: Date.now() - 2000 },
    { id: '4', price: '67520.50', quantity: '2.3456', time: '12:34:53', side: 'sell', timestamp: Date.now() - 3000 },
    { id: '5', price: '67522.50', quantity: '0.5432', time: '12:34:52', side: 'buy', timestamp: Date.now() - 4000 },
  ]);

  const [ticker, setTicker] = useState<Ticker>({
    lastPrice: '67523.45',
    priceChange: '1234.56',
    priceChangePercent: '1.86',
    high24h: '68000.00',
    low24h: '66500.00',
    volume24h: '25000',
    quoteVolume24h: '1687000000',
    bidPrice: '67520.00',
    askPrice: '67525.00',
    openPrice: '66288.89',
  });

  const [currentPrice, setCurrentPrice] = useState('');

  // Initialize user and balances
  useEffect(() => {
    setUser({
      userId: 'demo-user-1',
      email: 'demo@tigerex.com',
      username: 'DemoTrader',
      kycLevel: 'intermediate',
      twoFactorEnabled: true,
      marginEnabled: true,
      futuresEnabled: true,
      tradingExperience: 'advanced',
    });

    setBalances([
      { currency: 'BTC', available: '0.5432', locked: '0.1', total: '0.6432', usdValue: '43,427', change24h: '2.5' },
      { currency: 'ETH', available: '5.2341', locked: '0', total: '5.2341', usdValue: '18,545', change24h: '1.8' },
      { currency: 'USDT', available: '10,000', locked: '500', total: '10,500', usdValue: '10,500', change24h: '0' },
      { currency: 'BNB', available: '25.5', locked: '0', total: '25.5', usdValue: '15,257', change24h: '-0.5' },
      { currency: 'SOL', available: '100', locked: '10', total: '110', usdValue: '18,969', change24h: '5.2' },
      { currency: 'XRP', available: '5000', locked: '0', total: '5000', usdValue: '2,617', change24h: '-1.2' },
      { currency: 'ADA', available: '10000', locked: '0', total: '10000', usdValue: '4,500', change24h: '0.8' },
    ]);

    setPositions([
      {
        id: 'pos-1',
        symbol: 'BTC/USDT',
        side: 'long',
        size: '0.5',
        entryPrice: '65000.00',
        markPrice: '67523.45',
        liquidationPrice: '58500.00',
        unrealizedPnl: '1261.73',
        unrealizedPnlPercent: '3.88',
        leverage: '10',
        margin: '3250.00',
        marginRatio: '75.5',
        mode: 'cross',
      },
    ]);

    setSelectedMarket(markets[0]);
    setIsConnected(true);
  }, []);

  const handlePriceClick = (price: string) => {
    setCurrentPrice(price);
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      await apiService.cancelOrder(orderId);
      setOrders(orders.filter((o) => o.orderId !== orderId));
    } catch (error) {
      console.error('Failed to cancel order:', error);
    }
  };

  const appState: AppContextType = {
    user,
    theme,
    selectedMarket,
    balances,
    positions,
    orders,
    recentTrades,
    orderBook,
    ticker,
    isConnected,
    setUser,
    setTheme,
    setSelectedMarket,
    setBalances,
    setPositions,
    setOrders,
    setOrderBook,
    setTicker,
    connect: () => setIsConnected(true),
    disconnect: () => setIsConnected(false),
  };

  return (
    <AppContext.Provider value={appState}>
      <div className={`min-h-screen bg-gray-50 dark:bg-gray-950 ${theme}`}>
        <Header />

        <div className="flex h-[calc(100vh-3.5rem)]">
          {/* Market List */}
          <MarketSelector
            markets={markets}
            selectedMarket={selectedMarket}
            onSelectMarket={setSelectedMarket}
          />

          {/* Main Trading Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Ticker */}
            {selectedMarket && <TickerDisplay ticker={ticker} symbol={selectedMarket.symbol} />}

            {/* Trading View */}
            <div className="flex-1 grid grid-cols-12 gap-2 p-2 min-h-0">
              {/* Chart */}
              <div className="col-span-8 row-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                <TradingChart symbol={selectedMarket?.symbol || 'BTC/USDT'} />
              </div>

              {/* Order Book */}
              <div className="col-span-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-2">
                <OrderBookComponent orderBook={orderBook} onPriceClick={handlePriceClick} />
              </div>

              {/* Trade History */}
              <div className="col-span-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-2">
                <RecentTrades trades={recentTrades} />
              </div>
            </div>

            {/* Order Form & Positions */}
            <div className="h-80 border-t border-gray-200 dark:border-gray-800 p-2">
              <div className="grid grid-cols-12 gap-2 h-full">
                {/* Order Form */}
                <div className="col-span-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-y-auto">
                  {selectedMarket && (
                    <OrderForm
                      symbol={selectedMarket.symbol}
                      currentPrice={currentPrice || ticker.lastPrice}
                      onPriceChange={setCurrentPrice}
                    />
                  )}
                </div>

                {/* Open Orders */}
                <div className="col-span-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-2 overflow-y-auto">
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">Open Orders</div>
                  <OpenOrders orders={orders} onCancel={handleCancelOrder} />
                </div>

                {/* Positions */}
                <div className="col-span-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-2 overflow-y-auto">
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">Positions</div>
                  <PositionsComponent positions={positions} />
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Balances */}
          <div className="w-72 border-l border-gray-200 dark:border-gray-800 p-2 overflow-y-auto bg-white dark:bg-gray-900">
            <BalanceWidget balances={balances} />
          </div>
        </div>
      </div>
    </AppContext.Provider>
  );
}

export default TradingTerminal;