// =============================================================================
// TIGEREX v3.0 - COMPLETE MOBILE APP (React Native)
// Cross-platform mobile application for iOS/Android
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, FlatList, Alert, Dimensions, Modal, Switch,
  ActivityIndicator, RefreshControl, SafeAreaView, StatusBar
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface User {
  userId: string;
  email: string;
  username: string;
  kycLevel: number;
  twoFactorEnabled: boolean;
}

interface Balance {
  asset: string;
  available: number;
  locked: number;
  total: number;
  usdValue: number;
}

interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

interface Order {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_limit';
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: string;
}

interface Trade {
  tradeId: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  time: string;
}

interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number;
}

// =============================================================================
// API SERVICE
// =============================================================================

const API_BASE_URL = 'https://api.tigerex.com';
const WS_URL = 'wss://stream.tigerex.com';

class ApiService {
  private token: string | null = null;
  private ws: WebSocket | null = null;

  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    if (!response.ok) throw new Error('Login failed');
    
    const data = await response.json();
    this.token = data.token;
    return data;
  }

  async register(email: string, password: string, username: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username }),
    });
    
    if (!response.ok) throw new Error('Registration failed');
  }

  async getBalances(): Promise<Balance[]> {
    const response = await fetch(`${API_BASE_URL}/wallet/balances`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    
    if (!response.ok) throw new Error('Failed to fetch balances');
    return response.json();
  }

  async getMarkets(): Promise<Market[]> {
    const response = await fetch(`${API_BASE_URL}/markets`);
    if (!response.ok) throw new Error('Failed to fetch markets');
    return response.json();
  }

  async getOrderBook(symbol: string): Promise<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }> {
    const response = await fetch(`${API_BASE_URL}/markets/${symbol}/orderbook`);
    if (!response.ok) throw new Error('Failed to fetch order book');
    return response.json();
  }

  async getRecentTrades(symbol: string): Promise<Trade[]> {
    const response = await fetch(`${API_BASE_URL}/markets/${symbol}/trades`);
    if (!response.ok) throw new Error('Failed to fetch trades');
    return response.json();
  }

  async placeOrder(order: {
    symbol: string;
    side: 'buy' | 'sell';
    type: string;
    quantity: number;
    price?: number;
    stopPrice?: number;
  }): Promise<Order> {
    const response = await fetch(`${API_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(order),
    });
    
    if (!response.ok) throw new Error('Failed to place order');
    return response.json();
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params = symbol ? `?symbol=${symbol}` : '';
    const response = await fetch(`${API_BASE_URL}/orders/open${params}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    
    if (!response.ok) throw new Error('Failed to fetch orders');
    return response.json();
  }

  async cancelOrder(orderId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/orders/${orderId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    
    if (!response.ok) throw new Error('Failed to cancel order');
  }

  async getDepositAddress(asset: string): Promise<{ address: string; memo?: string }> {
    const response = await fetch(`${API_BASE_URL}/wallet/deposit/${asset}/address`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    
    if (!response.ok) throw new Error('Failed to get deposit address');
    return response.json();
  }

  async requestWithdrawal(request: {
    asset: string;
    address: string;
    amount: number;
    memo?: string;
  }): Promise<{ withdrawalId: string }> {
    const response = await fetch(`${API_BASE_URL}/wallet/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) throw new Error('Failed to request withdrawal');
    return response.json();
  }

  connectWebSocket(onMessage: (data: any) => void) {
    this.ws = new WebSocket(WS_URL);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
    };
  }

  subscribe(channel: string, symbol?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'subscribe', channel, symbol }));
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

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const formatNumber = (num: number, decimals = 4): string => {
  return num.toFixed(decimals);
};

const formatPercent = (num: number): string => {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const abbreviateNumber = (num: number): string => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

// =============================================================================
// THEME & COLORS
// =============================================================================

const Colors = {
  primary: '#f97316', // TigerEx Orange
  secondary: '#ea580c',
  success: '#22c55e',
  danger: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  
  background: {
    light: '#ffffff',
    dark: '#0f0f0f',
    card: {
      light: '#f9fafb',
      dark: '#1a1a1a',
    },
  },
  
  text: {
    primary: {
      light: '#111827',
      dark: '#f9fafb',
    },
    secondary: {
      light: '#6b7280',
      dark: '#9ca3af',
    },
  },
  
  border: {
    light: '#e5e7eb',
    dark: '#374151',
  },
};

// =============================================================================
// NAVIGATION TYPES
// =============================================================================

type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Trade: { symbol: string };
  AssetDetail: { asset: string };
  OrderDetail: { orderId: string };
};

type MainTabParamList = {
  Markets: undefined;
  Trade: undefined;
  Wallet: undefined;
  Orders: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// =============================================================================
// SCREEN COMPONENTS
// =============================================================================

// Login Screen
const LoginScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await apiService.login(email, password);
      navigation.replace('Main');
    } catch (err) {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>TigerEx</Text>
        <Text style={styles.subtitle}>Trade Crypto Worldwide</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.linkText}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// Markets Screen
const MarketsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadMarkets = async () => {
    try {
      const data = await apiService.getMarkets();
      setMarkets(data);
    } catch (err) {
      console.error('Failed to load markets:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadMarkets();
  }, []);

  const filteredMarkets = markets.filter(m =>
    m.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.baseAsset.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderMarket = ({ item }: { item: Market }) => (
    <TouchableOpacity
      style={styles.marketItem}
      onPress={() => navigation.navigate('Trade', { symbol: item.symbol })}
    >
      <View style={styles.marketLeft}>
        <Text style={styles.marketSymbol}>{item.symbol}</Text>
        <Text style={styles.marketBase}>{item.baseAsset}</Text>
      </View>
      <View style={styles.marketRight}>
        <Text style={styles.marketPrice}>${formatNumber(item.price, item.price > 1 ? 2 : 6)}</Text>
        <Text style={[styles.marketChange, item.change24h >= 0 ? styles.positive : styles.negative]}>
          {formatPercent(item.change24h)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Markets</Text>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search markets..."
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredMarkets}
          renderItem={renderMarket}
          keyExtractor={(item) => item.symbol}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMarkets(); }} />
          }
        />
      )}
    </SafeAreaView>
  );
};

// Trade Screen
const TradeScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { symbol } = route.params || { symbol: 'BTCUSDT' };
  
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [currentPrice, setCurrentPrice] = useState(67432.50);
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop_limit'>('limit');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load order book and trades
    const loadData = async () => {
      try {
        const [ob, trades] = await Promise.all([
          apiService.getOrderBook(symbol),
          apiService.getRecentTrades(symbol),
        ]);
        setOrderBook(ob);
        setRecentTrades(trades);
      } catch (err) {
        console.error('Failed to load trade data:', err);
      }
    };

    loadData();

    // Connect WebSocket for real-time updates
    apiService.connectWebSocket((data) => {
      if (data.channel === 'orderbook') {
        setOrderBook(data.data);
      } else if (data.channel === 'trades') {
        setRecentTrades(prev => [data.data, ...prev.slice(0, 49)]);
        setCurrentPrice(data.data.price);
      }
    });

    apiService.subscribe('orderbook', symbol);
    apiService.subscribe('trades', symbol);

    return () => {
      apiService.disconnect();
    };
  }, [symbol]);

  const handlePlaceOrder = async () => {
    if (!quantity) {
      Alert.alert('Error', 'Please enter quantity');
      return;
    }

    setLoading(true);

    try {
      await apiService.placeOrder({
        symbol,
        side: orderSide,
        type: orderType,
        quantity: parseFloat(quantity),
        price: orderType !== 'market' ? parseFloat(price) : undefined,
      });

      Alert.alert('Success', 'Order placed successfully');
      setQuantity('');
      setPrice('');
    } catch (err) {
      Alert.alert('Error', 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const calculateTotal = () => {
    const qty = parseFloat(quantity) || 0;
    const prc = orderType === 'market' ? currentPrice : (parseFloat(price) || currentPrice);
    return qty * prc;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.tradeHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>←</Text>
        </TouchableOpacity>
        <Text style={styles.tradeSymbol}>{symbol}</Text>
        <Text style={styles.currentPrice}>${formatNumber(currentPrice, 2)}</Text>
      </View>

      <View style={styles.tradeContent}>
        {/* Order Book */}
        <View style={styles.orderBook}>
          <Text style={styles.sectionTitle}>Order Book</Text>
          <View style={styles.orderBookHeader}>
            <Text style={styles.orderBookHeaderText}>Price</Text>
            <Text style={styles.orderBookHeaderText}>Amount</Text>
            <Text style={styles.orderBookHeaderText}>Total</Text>
          </View>
          
          {/* Asks (Sells) */}
          {orderBook.asks.slice(0, 8).reverse().map((ask, i) => (
            <View key={`ask-${i}`} style={styles.orderBookRow}>
              <View style={[styles.orderBookBar, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]} />
              <Text style={styles.askPrice}>{formatNumber(ask.price, 2)}</Text>
              <Text style={styles.orderBookText}>{formatNumber(ask.quantity, 4)}</Text>
              <Text style={styles.orderBookText}>{formatNumber(ask.total, 4)}</Text>
            </View>
          ))}

          {/* Spread */}
          <View style={styles.spreadRow}>
            <Text style={styles.spreadText}>Spread</Text>
            <Text style={styles.spreadValue}>
              {orderBook.asks[0] && orderBook.bids[0] 
                ? formatNumber(orderBook.asks[0].price - orderBook.bids[0].price, 2)
                : '0.00'}
            </Text>
          </View>

          {/* Bids (Buys) */}
          {orderBook.bids.slice(0, 8).map((bid, i) => (
            <View key={`bid-${i}`} style={styles.orderBookRow}>
              <View style={[styles.orderBookBar, { backgroundColor: 'rgba(34, 197, 94, 0.2)' }]} />
              <Text style={styles.bidPrice}>{formatNumber(bid.price, 2)}</Text>
              <Text style={styles.orderBookText}>{formatNumber(bid.quantity, 4)}</Text>
              <Text style={styles.orderBookText}>{formatNumber(bid.total, 4)}</Text>
            </View>
          ))}
        </View>

        {/* Order Form */}
        <View style={styles.orderForm}>
          {/* Buy/Sell Toggle */}
          <View style={styles.orderToggle}>
            <TouchableOpacity
              style={[styles.toggleButton, orderSide === 'buy' && styles.buyActive]}
              onPress={() => setOrderSide('buy')}
            >
              <Text style={[styles.toggleText, orderSide === 'buy' && styles.buyText]}>Buy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, orderSide === 'sell' && styles.sellActive]}
              onPress={() => setOrderSide('sell')}
            >
              <Text style={[styles.toggleText, orderSide === 'sell' && styles.sellText]}>Sell</Text>
            </TouchableOpacity>
          </View>

          {/* Order Type */}
          <View style={styles.orderTypeContainer}>
            {(['market', 'limit', 'stop_limit'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.orderTypeButton, orderType === type && styles.orderTypeActive]}
                onPress={() => setOrderType(type)}
              >
                <Text style={[styles.orderTypeText, orderType === type && styles.orderTypeTextActive]}>
                  {type === 'market' ? 'Market' : type === 'limit' ? 'Limit' : 'Stop'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Price Input */}
          {orderType !== 'market' && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Price</Text>
              <TextInput
                style={styles.input}
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder={formatNumber(currentPrice, 2)}
              />
            </View>
          )}

          {/* Quantity Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Amount</Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          {/* Percentage Buttons */}
          <View style={styles.percentButtons}>
            {[25, 50, 75, 100].map((pct) => (
              <TouchableOpacity key={pct} style={styles.percentButton}>
                <Text style={styles.percentButtonText}>{pct}%</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Total */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>${formatNumber(calculateTotal(), 2)}</Text>
          </View>

          {/* Place Order Button */}
          <TouchableOpacity
            style={[styles.button, orderSide === 'buy' ? styles.buyButton : styles.sellButton]}
            onPress={handlePlaceOrder}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {orderSide === 'buy' ? 'Buy' : 'Sell'} {symbol.split('USDT')[0]}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

// Wallet Screen
const WalletScreen: React.FC = () => {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBalances = async () => {
    try {
      const data = await apiService.getBalances();
      setBalances(data);
    } catch (err) {
      console.error('Failed to load balances:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBalances();
  }, []);

  const totalValue = balances.reduce((sum, b) => sum + b.usdValue, 0);

  const renderBalance = ({ item }: { item: Balance }) => (
    <TouchableOpacity style={styles.balanceItem}>
      <View style={styles.balanceLeft}>
        <View style={styles.assetIcon}>
          <Text style={styles.assetIconText}>{item.asset.slice(0, 2)}</Text>
        </View>
        <View>
          <Text style={styles.assetName}>{item.asset}</Text>
          <Text style={styles.assetBalance}>{formatNumber(item.available, 4)}</Text>
        </View>
      </View>
      <View style={styles.balanceRight}>
        <Text style={styles.assetValue}>${formatNumber(item.usdValue, 2)}</Text>
        {item.locked > 0 && (
          <Text style={styles.lockedText}>Locked: {formatNumber(item.locked, 4)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Wallet</Text>
      </View>

      {/* Total Balance Card */}
      <View style={styles.totalBalanceCard}>
        <Text style={styles.totalBalanceLabel}>Total Balance</Text>
        <Text style={styles.totalBalanceValue}>{formatCurrency(totalValue)}</Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.walletActions}>
        <TouchableOpacity style={styles.walletActionButton}>
          <Text style={styles.walletActionIcon}>↓</Text>
          <Text style={styles.walletActionText}>Deposit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.walletActionButton}>
          <Text style={styles.walletActionIcon}>↑</Text>
          <Text style={styles.walletActionText}>Withdraw</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.walletActionButton}>
          <Text style={styles.walletActionIcon}>↔</Text>
          <Text style={styles.walletActionText}>Transfer</Text>
        </TouchableOpacity>
      </View>

      {/* Balances List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={balances}
          renderItem={renderBalance}
          keyExtractor={(item) => item.asset}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBalances(); }} />
          }
        />
      )}
    </SafeAreaView>
  );
};

// Orders Screen
const OrdersScreen: React.FC = () => {
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');

  const loadOrders = async () => {
    try {
      const [open, history] = await Promise.all([
        apiService.getOpenOrders(),
        apiService.getOpenOrders(), // In production, call different endpoint
      ]);
      setOpenOrders(open);
      setOrderHistory(history);
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleCancelOrder = async (orderId: string) => {
    try {
      await apiService.cancelOrder(orderId);
      setOpenOrders(prev => prev.filter(o => o.orderId !== orderId));
      Alert.alert('Success', 'Order cancelled');
    } catch (err) {
      Alert.alert('Error', 'Failed to cancel order');
    }
  };

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={styles.orderItem}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderSymbol}>{item.symbol}</Text>
        <Text style={[styles.orderSide, item.side === 'buy' ? styles.buyText : styles.sellText]}>
          {item.side.toUpperCase()}
        </Text>
      </View>
      <View style={styles.orderDetails}>
        <View>
          <Text style={styles.orderDetailLabel}>Price</Text>
          <Text style={styles.orderDetailValue}>${formatNumber(item.price, 2)}</Text>
        </View>
        <View>
          <Text style={styles.orderDetailLabel}>Amount</Text>
          <Text style={styles.orderDetailValue}>{formatNumber(item.quantity, 4)}</Text>
        </View>
        <View>
          <Text style={styles.orderDetailLabel}>Filled</Text>
          <Text style={styles.orderDetailValue}>{formatNumber(item.filled, 4)}</Text>
        </View>
      </View>
      <View style={styles.orderFooter}>
        <Text style={styles.orderStatus}>{item.status}</Text>
        {activeTab === 'open' && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => handleCancelOrder(item.orderId)}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Orders</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'open' && styles.tabActive]}
          onPress={() => setActiveTab('open')}
        >
          <Text style={[styles.tabText, activeTab === 'open' && styles.tabTextActive]}>
            Open Orders
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.tabActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            Order History
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={activeTab === 'open' ? openOrders : orderHistory}
          renderItem={renderOrder}
          keyExtractor={(item) => item.orderId}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No orders</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

// Settings Screen
const SettingsScreen: React.FC = () => {
  const [twoFactor, setTwoFactor] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [biometric, setBiometric] = useState(false);

  const renderSettingItem = (
    title: string,
    description: string,
    value: boolean,
    onToggle: (value: boolean) => void
  ) => (
    <View style={styles.settingItem}>
      <View>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#767577', true: Colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Settings</Text>
      </View>

      <ScrollView style={styles.settingsContent}>
        {/* Security Section */}
        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>Security</Text>
          {renderSettingItem(
            'Two-Factor Authentication',
            'Protect your account with 2FA',
            twoFactor,
            setTwoFactor
          )}
          {renderSettingItem(
            'Biometric Login',
            'Use Face ID or fingerprint to login',
            biometric,
            setBiometric
          )}
        </View>

        {/* Notifications Section */}
        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>Notifications</Text>
          {renderSettingItem(
            'Push Notifications',
            'Receive alerts for trades and deposits',
            notifications,
            setNotifications
          )}
        </View>

        {/* Account Section */}
        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>Account</Text>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>KYC Verification</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>API Keys</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Bank Accounts</Text>
          </TouchableOpacity>
        </View>

        {/* Support Section */}
        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>Support</Text>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Help Center</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Contact Support</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Terms of Service</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsLink}>
            <Text style={styles.settingsLinkText}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>

        <Text style={styles.version}>TigerEx v3.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

// =============================================================================
// MAIN APP COMPONENT
// =============================================================================

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Auth" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Trade" component={TradeScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

// Main Tab Navigator
const MainTabs: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.text.secondary.dark,
        tabBarStyle: {
          backgroundColor: Colors.background.dark,
          borderTopColor: Colors.border.dark,
        },
      }}
    >
      <Tab.Screen
        name="Markets"
        component={MarketsScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💰</Text>,
        }}
      />
      <Tab.Screen
        name="Orders"
        component={OrdersScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tab.Navigator>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.dark,
  },
  
  header: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  
  logo: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.primary,
  },
  
  subtitle: {
    fontSize: 14,
    color: Colors.text.secondary.dark,
  },
  
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.text.primary.dark,
  },
  
  backButton: {
    fontSize: 24,
    color: Colors.text.primary.dark,
  },
  
  // Form Styles
  form: {
    padding: 20,
  },
  
  input: {
    backgroundColor: Colors.background.card.dark,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    color: Colors.text.primary.dark,
    fontSize: 16,
  },
  
  searchInput: {
    backgroundColor: Colors.background.card.dark,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    color: Colors.text.primary.dark,
  },
  
  inputGroup: {
    marginBottom: 12,
  },
  
  inputLabel: {
    color: Colors.text.secondary.dark,
    marginBottom: 4,
    fontSize: 14,
  },
  
  button: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  
  primaryButton: {
    backgroundColor: Colors.primary,
  },
  
  buyButton: {
    backgroundColor: Colors.success,
  },
  
  sellButton: {
    backgroundColor: Colors.danger,
  },
  
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  
  linkText: {
    color: Colors.primary,
    textAlign: 'center',
    marginTop: 16,
  },
  
  error: {
    color: Colors.danger,
    textAlign: 'center',
    marginBottom: 12,
  },
  
  // Market Styles
  marketItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
  },
  
  marketLeft: {
    flex: 1,
  },
  
  marketSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.primary.dark,
  },
  
  marketBase: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
    marginTop: 2,
  },
  
  marketRight: {
    alignItems: 'flex-end',
  },
  
  marketPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.primary.dark,
  },
  
  marketChange: {
    fontSize: 12,
    marginTop: 2,
  },
  
  positive: {
    color: Colors.success,
  },
  
  negative: {
    color: Colors.danger,
  },
  
  // Trade Styles
  tradeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
  },
  
  tradeSymbol: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text.primary.dark,
    marginLeft: 16,
  },
  
  currentPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.primary,
    marginLeft: 'auto',
  },
  
  tradeContent: {
    flex: 1,
    flexDirection: 'row',
  },
  
  orderBook: {
    flex: 1,
    padding: 8,
  },
  
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text.secondary.dark,
    marginBottom: 8,
  },
  
  orderBookHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  
  orderBookHeaderText: {
    fontSize: 10,
    color: Colors.text.secondary.dark,
  },
  
  orderBookRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 4,
    position: 'relative',
  },
  
  orderBookBar: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
  },
  
  askPrice: {
    fontSize: 12,
    color: Colors.danger,
    zIndex: 1,
  },
  
  bidPrice: {
    fontSize: 12,
    color: Colors.success,
    zIndex: 1,
  },
  
  orderBookText: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
    zIndex: 1,
  },
  
  spreadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border.dark,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
    marginVertical: 4,
  },
  
  spreadText: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
  },
  
  spreadValue: {
    fontSize: 12,
    color: Colors.text.primary.dark,
  },
  
  orderForm: {
    flex: 1,
    padding: 12,
    backgroundColor: Colors.background.card.dark,
  },
  
  orderToggle: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  
  toggleButton: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: Colors.background.dark,
  },
  
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text.secondary.dark,
  },
  
  buyActive: {
    backgroundColor: Colors.success,
  },
  
  sellActive: {
    backgroundColor: Colors.danger,
  },
  
  buyText: {
    color: '#fff',
  },
  
  sellText: {
    color: '#fff',
  },
  
  orderTypeContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  
  orderTypeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    borderRadius: 4,
    backgroundColor: Colors.background.dark,
  },
  
  orderTypeActive: {
    backgroundColor: Colors.primary,
  },
  
  orderTypeText: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
  },
  
  orderTypeTextActive: {
    color: '#fff',
  },
  
  percentButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  
  percentButton: {
    padding: 8,
    borderRadius: 4,
    backgroundColor: Colors.background.dark,
  },
  
  percentButtonText: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
  },
  
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border.dark,
  },
  
  totalLabel: {
    fontSize: 14,
    color: Colors.text.secondary.dark,
  },
  
  totalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text.primary.dark,
  },
  
  // Wallet Styles
  totalBalanceCard: {
    backgroundColor: Colors.primary,
    margin: 16,
    padding: 20,
    borderRadius: 12,
  },
  
  totalBalanceLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  
  totalBalanceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },
  
  walletActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  
  walletActionButton: {
    alignItems: 'center',
  },
  
  walletActionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  
  walletActionText: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
  },
  
  balanceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
  },
  
  balanceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  assetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  
  assetIconText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  
  assetName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.primary.dark,
  },
  
  assetBalance: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
    marginTop: 2,
  },
  
  balanceRight: {
    alignItems: 'flex-end',
  },
  
  assetValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.primary.dark,
  },
  
  lockedText: {
    fontSize: 10,
    color: Colors.warning,
    marginTop: 2,
  },
  
  // Order Styles
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
  },
  
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  
  tabText: {
    fontSize: 14,
    color: Colors.text.secondary.dark,
  },
  
  tabTextActive: {
    color: Colors.primary,
  },
  
  orderItem: {
    backgroundColor: Colors.background.card.dark,
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  
  orderSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.primary.dark,
  },
  
  orderSide: {
    fontSize: 12,
    fontWeight: '600',
  },
  
  orderDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  
  orderDetailLabel: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
  },
  
  orderDetailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text.primary.dark,
    marginTop: 2,
  },
  
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border.dark,
  },
  
  orderStatus: {
    fontSize: 12,
    color: Colors.warning,
  },
  
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.danger + '20',
    borderRadius: 4,
  },
  
  cancelButtonText: {
    fontSize: 12,
    color: Colors.danger,
  },
  
  // Settings Styles
  settingsContent: {
    flex: 1,
  },
  
  settingsSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
  },
  
  settingsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text.secondary.dark,
    marginBottom: 12,
  },
  
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  
  settingTitle: {
    fontSize: 16,
    color: Colors.text.primary.dark,
  },
  
  settingDescription: {
    fontSize: 12,
    color: Colors.text.secondary.dark,
    marginTop: 2,
  },
  
  settingsLink: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.dark,
  },
  
  settingsLinkText: {
    fontSize: 16,
    color: Colors.text.primary.dark,
  },
  
  logoutButton: {
    margin: 16,
    padding: 16,
    backgroundColor: Colors.danger + '20',
    borderRadius: 8,
    alignItems: 'center',
  },
  
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.danger,
  },
  
  version: {
    textAlign: 'center',
    color: Colors.text.secondary.dark,
    marginBottom: 32,
  },
  
  // Common Styles
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  
  emptyText: {
    fontSize: 16,
    color: Colors.text.secondary.dark,
  },
});

export default App;