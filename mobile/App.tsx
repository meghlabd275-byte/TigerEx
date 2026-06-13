/**
 * TigerEx Mobile App - Complete Trading Application
 * Full-featured mobile trading app for iOS and Android
 * Supports spot, futures, margin, and options trading
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  FlatList,
  Modal,
  Alert,
  StatusBar,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  Animated,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
  Linking,
  Share,
  Vibration,
  NativeModules,
  NativeEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList, DrawerItem, DrawerContentComponentProps } from '@react-navigation/drawer';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { VictoryChart, VictoryLine, VictoryAxis, VictoryTheme, VictoryCandlestick, VictoryBar } from 'victory-native';
import Svg, { Path, Circle, Rect, Line, G, Text as SvgText, Polygon } from 'react-native-svg';
import { BarCodeScanner } from 'react-native-barcode-scanner-google';
import * as Keychain from 'react-native-keychain';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import * as Animatable from 'react-native-animatable';
import { LinearGradient } from 'react-native-linear-gradient';
import { BlurView } from '@react-native-community/blur';
import { v4 as uuidv4 } from 'uuid';
import { Picker } from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { WebView } from 'react-native-webview';
import { MMKV } from 'react-native-mmkv';
import Shimmer from 'react-native-shimmer';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

const COLORS = {
  // Primary Colors
  primary: '#1E88E5',
  primaryDark: '#1565C0',
  primaryLight: '#42A5F5',
  
  // Secondary Colors
  secondary: '#FF6D00',
  secondaryDark: '#E65100',
  secondaryLight: '#FF9E40',
  
  // Neutral Colors
  background: '#0D1117',
  surface: '#161B22',
  surfaceLight: '#21262D',
  card: '#1C2128',
  cardLight: '#2D333B',
  
  // Text Colors
  textPrimary: '#FFFFFF',
  textSecondary: '#8B949E',
  textMuted: '#484F58',
  textInverse: '#0D1117',
  
  // Status Colors
  success: '#2EA043',
  successLight: '#3FB950',
  warning: '#D29922',
  warningLight: '#E3B341',
  error: '#F85149',
  errorLight: '#FF6B6B',
  info: '#58A6FF',
  
  // Chart Colors
  bullish: '#26A69A',
  bearish: '#EF5350',
  neutral: '#6366F1',
  
  // Gradient
  gradientStart: '#1E88E5',
  gradientEnd: '#1565C0',
};

const FONTS = {
  regular: Platform.OS === 'ios' ? 'System' : 'Roboto',
  medium: Platform.OS === 'ios' ? 'System' : 'Roboto',
  bold: Platform.OS === 'ios' ? 'System' : 'Roboto',
  light: Platform.OS === 'ios' ? 'System' : 'Roboto',
};

const API_BASE_URL = 'https://api.tigerex.com';
const WS_BASE_URL = 'wss://stream.tigerex.com';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface User {
  userId: string;
  email: string;
  username: string;
  phone?: string;
  kycLevel: number;
  status: string;
  createdAt: number;
  twoFactorEnabled: boolean;
}

interface Wallet {
  walletId: string;
  userId: string;
  currency: string;
  balance: string;
  locked: string;
  address?: string;
}

interface Ticker {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  high: string;
  low: string;
  volume: string;
  quoteVolume: string;
}

interface Order {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  price: string;
  quantity: string;
  filledQuantity: string;
  averagePrice: string;
  status: string;
  timeInForce: string;
  createdAt: number;
  stopPrice?: string;
}

interface Trade {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  quantity: string;
  fee: string;
  createdAt: number;
}

interface Position {
  positionId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: string;
  entryPrice: string;
  markPrice: string;
  leverage: number;
  unrealizedPnl: string;
  liquidationPrice: string;
  margin: string;
}

interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  precision: number;
  scale: number;
}

interface StakingProduct {
  productId: string;
  currency: string;
  name: string;
  apy: string;
  minAmount: string;
  lockPeriod: number;
}

interface LendingProduct {
  productId: string;
  currency: string;
  apy: string;
  termDays: number;
}

// ============================================================================
// STORAGE SERVICE
// ============================================================================

const storage = new MMKV();

interface StorageKeys {
  AUTH_TOKEN: string;
  USER_DATA: string;
  THEME: string;
  LANGUAGE: string;
  PIN_ENABLED: string;
  BIOMETRIC_ENABLED: string;
  NOTIFICATIONS_ENABLED: string;
  FAVORITES: string;
}

const StorageService = {
  setItem: async (key: keyof StorageKeys, value: string) => {
    storage.set(key, value);
  },
  
  getItem: async (key: keyof StorageKeys): Promise<string | undefined> => {
    return storage.getString(key);
  },
  
  removeItem: async (key: keyof StorageKeys) => {
    storage.delete(key);
  },
  
  clear: async () => {
    storage.clearAll();
  },
};

// ============================================================================
// API CLIENT
// ============================================================================

class ApiClient {
  private static instance: ApiClient;
  private token: string | null = null;
  
  private constructor() {}
  
  static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }
  
  setToken(token: string) {
    this.token = token;
  }
  
  clearToken() {
    this.token = null;
  }
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    
    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }
    
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Request failed');
      }
      
      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
  
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }
  
  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }
  
  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }
  
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

const api = ApiClient.getInstance();

// ============================================================================
// WEBSOCKET CLIENT
// ============================================================================

class WebSocketClient {
  private static instance: WebSocketClient;
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  
  private constructor() {}
  
  static getInstance(): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient();
    }
    return WebSocketClient.instance;
  }
  
  connect(streams: string[]) {
    return new Promise<void>((resolve, reject) => {
      try {
        const streamParams = streams.join('/');
        this.ws = new WebSocket(`${WS_BASE_URL}/stream?streams=${streamParams}`);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.notifyListeners(data);
          } catch (error) {
            console.error('WebSocket message parse error:', error);
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
        
        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.reconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  subscribe(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }
  
  unsubscribe(event: string, callback: (data: any) => void) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }
  
  private notifyListeners(data: any) {
    const event = data.event || 'default';
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }
  }
  
  private async reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));
      this.reconnectDelay *= 2;
    }
  }
  
  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

const ws = WebSocketClient.getInstance();

// ============================================================================
// AUTHENTICATION SERVICE
// ============================================================================

const AuthService = {
  login: async (email: string, password: string): Promise<User> => {
    try {
      const response = await api.post<{ token: string; user: User }>('/api/v2/auth/login', {
        email,
        password,
      });
      
      await StorageService.setItem('AUTH_TOKEN', response.token);
      api.setToken(response.token);
      
      return response.user;
    } catch (error) {
      throw error;
    }
  },
  
  register: async (email: string, password: string, username: string): Promise<User> => {
    try {
      const response = await api.post<{ token: string; user: User }>('/api/v2/auth/register', {
        email,
        password,
        username,
      });
      
      await StorageService.setItem('AUTH_TOKEN', response.token);
      api.setToken(response.token);
      
      return response.user;
    } catch (error) {
      throw error;
    }
  },
  
  logout: async () => {
    await StorageService.removeItem('AUTH_TOKEN');
    api.clearToken();
  },
  
  getCurrentUser: async (): Promise<User | null> => {
    try {
      const token = await StorageService.getItem('AUTH_TOKEN');
      if (!token) return null;
      
      api.setToken(token);
      const user = await api.get<User>('/api/v2/auth/me');
      return user;
    } catch (error) {
      return null;
    }
  },
  
  enable2FA: async (): Promise<string> => {
    const response = await api.post<{ qrCode: string }>('/api/v2/auth/2fa/enable');
    return response.qrCode;
  },
  
  verify2FA: async (code: string): Promise<void> => {
    await api.post('/api/v2/auth/2fa/verify', { code });
  },
  
  resetPassword: async (email: string): Promise<void> => {
    await api.post('/api/v2/auth/reset-password', { email });
  },
  
  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await api.post('/api/v2/auth/change-password', {
      oldPassword,
      newPassword,
    });
  },
  
  setupBiometric: async (): Promise<boolean> => {
    try {
      const credentials = await Keychain.getGenericPassword();
      if (credentials) return true;
      
      return false;
    } catch (error) {
      return false;
    }
  },
  
  enableBiometric: async (): Promise<boolean> => {
    try {
      await Keychain.setGenericPassword('tigerex', 'biometric');
      await StorageService.setItem('BIOMETRIC_ENABLED', 'true');
      return true;
    } catch (error) {
      return false;
    }
  },
  
  loginWithBiometric: async (): Promise<User | null> => {
    try {
      const credentials = await Keychain.getGenericPassword();
      if (!credentials) return null;
      
      return await AuthService.getCurrentUser();
    } catch (error) {
      return null;
    }
  },
};

// ============================================================================
// TRADING SERVICE
// ============================================================================

const TradingService = {
  getMarkets: async (): Promise<Market[]> => {
    return api.get<Market[]>('/api/v2/exchangeInfo');
  },
  
  getTicker: async (symbol: string): Promise<Ticker> => {
    return api.get<Ticker>(`/api/v2/ticker/${symbol}`);
  },
  
  getAllTickers: async (): Promise<Ticker[]> => {
    return api.get<Ticker[]>('/api/v2/ticker/all');
  },
  
  getOrderBook: async (symbol: string, limit: number = 20): Promise<{ bids: string[][]; asks: string[][] }> => {
    return api.get<{ bids: string[][]; asks: string[][] }>(`/api/v2/depth/${symbol}?limit=${limit}`);
  },
  
  getKlines: async (symbol: string, interval: string, limit: number = 500): Promise<Kline[]> => {
    return api.get<Kline[]>(`/api/v2/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  },
  
  getRecentTrades: async (symbol: string, limit: number = 100): Promise<Trade[]> => {
    return api.get<Trade[]>(`/api/v2/trades/${symbol}?limit=${limit}`);
  },
  
  createOrder: async (order: {
    symbol: string;
    side: 'buy' | 'sell';
    orderType: string;
    quantity: string;
    price?: string;
    stopPrice?: string;
    timeInForce?: string;
  }): Promise<Order> => {
    return api.post<Order>('/api/v2/order', order);
  },
  
  cancelOrder: async (orderId: string): Promise<Order> => {
    return api.delete<Order>(`/api/v2/order/${orderId}`);
  },
  
  getOrders: async (symbol?: string, limit: number = 100): Promise<Order[]> => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (symbol) params.append('symbol', symbol);
    return api.get<Order[]>(`/api/v2/orders?${params}`);
  },
  
  getOpenOrders: async (): Promise<Order[]> => {
    return api.get<Order[]>('/api/v2/openOrders');
  },
  
  getTrades: async (symbol?: string, limit: number = 100): Promise<Trade[]> => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (symbol) params.append('symbol', symbol);
    return api.get<Trade[]>(`/api/v2/trades?${params}`);
  },
  
  getPositions: async (): Promise<Position[]> => {
    return api.get<Position[]>('/api/v2/positions');
  },
  
  setLeverage: async (symbol: string, leverage: number): Promise<void> => {
    await api.post(`/api/v2/leverage`, { symbol, leverage });
  },
  
  setMarginMode: async (symbol: string, mode: 'isolated' | 'cross'): Promise<void> => {
    await api.post(`/api/v2/marginMode`, { symbol, mode });
  },
};

// ============================================================================
// WALLET SERVICE
// ============================================================================

const WalletService = {
  getBalances: async (): Promise<Wallet[]> => {
    return api.get<Wallet[]>('/api/v2/balance');
  },
  
  getDepositAddress: async (currency: string): Promise<{ address: string; memo?: string }> => {
    return api.get<{ address: string; memo?: string }>(`/api/v2/deposit/address/${currency}`);
  },
  
  createWithdrawal: async (params: {
    currency: string;
    amount: string;
    address: string;
    memo?: string;
    network?: string;
  }): Promise<{ withdrawalId: string }> => {
    return api.post<{ withdrawalId: string }>('/api/v2/withdraw', params);
  },
  
  getWithdrawals: async (currency?: string, limit: number = 100) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (currency) params.append('currency', currency);
    return api.get(`/api/v2/withdrawals?${params}`);
  },
  
  getDeposits: async (currency?: string, limit: number = 100) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (currency) params.append('currency', currency);
    return api.get(`/api/v2/deposits?${params}`);
  },
  
  getInternalTransfers: async (limit: number = 100) => {
    return api.get(`/api/v2/transfers?limit=${limit}`);
  },
  
  createInternalTransfer: async (params: {
    email: string;
    currency: string;
    amount: string;
  }) => {
    return api.post('/api/v2/transfer', params);
  },
};

// ============================================================================
// STAKING & EARN SERVICE
// ============================================================================

const EarnService = {
  getStakingProducts: async (): Promise<StakingProduct[]> => {
    return api.get<StakingProduct[]>('/api/v2/staking/products');
  },
  
  stake: async (params: { productId: string; amount: string }) => {
    return api.post('/api/v2/staking', params);
  },
  
  unstake: async (positionId: string) => {
    return api.post(`/api/v2/staking/${positionId}/unstake`);
  },
  
  getStakingPositions: async () => {
    return api.get('/api/v2/staking/positions');
  },
  
  getLendingProducts: async (): Promise<LendingProduct[]> => {
    return api.get<LendingProduct[]>('/api/v2/lending/products');
  },
  
  lend: async (params: { productId: string; amount: string }) => {
    return api.post('/api/v2/lending', params);
  },
  
  getLendingPositions: async () => {
    return api.get('/api/v2/lending/positions');
  },
  
  getLeveragedTokens: async () => {
    return api.get('/api/v2/leveraged/tokens');
  },
};

// ============================================================================
// KYC SERVICE
// ============================================================================

const KycService = {
  getKycStatus: async () => {
    return api.get('/api/v2/kyc/status');
  },
  
  submitKyc: async (params: {
    documentType: string;
    documentNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    country: string;
  }) => {
    return api.post('/api/v2/kyc/submit', params);
  },
  
  uploadDocument: async (documentType: string, uri: string) => {
    const formData = new FormData();
    formData.append('document', {
      uri,
      type: 'image/jpeg',
      name: 'document.jpg',
    } as any);
    formData.append('documentType', documentType);
    
    return api.post('/api/v2/kyc/document', formData);
  },
  
  submitSelfie: async (uri: string) => {
    const formData = new FormData();
    formData.append('selfie', {
      uri,
      type: 'image/jpeg',
      name: 'selfie.jpg',
    } as any);
    
    return api.post('/api/v2/kyc/selfie', formData);
  },
  
  startVideoVerification: async () => {
    return api.post('/api/v2/kyc/video/start');
  },
};

// ============================================================================
// SCREENS
// ============================================================================

// Splash Screen
const SplashScreen = () => {
  const [fadeAnim] = useState(new Animated.Value(0));
  
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();
  }, []);
  
  return (
    <Animated.View style={[styles.splashContainer, { opacity: fadeAnim }]}>
      <LinearGradient
        colors={[COLORS.gradientStart, COLORS.gradientEnd]}
        style={styles.splashGradient}
      >
        <Svg width={120} height={120} viewBox="0 0 100 100">
          <Path
            d="M50 10 L90 90 L10 90 Z"
            fill="none"
            stroke={COLORS.textPrimary}
            strokeWidth="4"
          />
          <Circle cx="50" cy="55" r="15" fill={COLORS.textPrimary} />
          <Text x="50" y="80" fill={COLORS.textPrimary} fontSize="24" fontWeight="bold" textAnchor="middle">
            TigerEx
          </Text>
        </Svg>
        <Text style={styles.splashText}>The Ultimate Trading Experience</Text>
      </LinearGradient>
    </Animated.View>
  );
};

// Login Screen
const LoginScreen = ({ navigation }: any) => {
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
      await AuthService.login(email, password);
      navigation.replace('Main');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.loginContainer}
    >
      <ScrollView contentContainerStyle={styles.loginScrollContent}>
        <View style={styles.loginLogoContainer}>
          <Svg width={80} height={80} viewBox="0 0 100 100">
            <Path
              d="M50 10 L90 90 L10 90 Z"
              fill="none"
              stroke={COLORS.primary}
              strokeWidth="4"
            />
          </Svg>
          <Text style={styles.loginTitle}>TigerEx</Text>
          <Text style={styles.loginSubtitle}>Sign in to continue</Text>
        </View>
        
        <View style={styles.loginForm}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
            />
          </View>
          
          {error ? <Text style={styles.errorText}>{error}</Text>}
          
          <TouchableOpacity
            style={styles.loginButton}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.textPrimary} />
            ) : (
              <Text style={styles.loginButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
          
          <View style={styles.loginLinks}>
            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
              <Text style={styles.linkText}>Forgot Password?</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.linkText}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </View>
        
        <View style={styles.socialLogin}>
          <Text style={styles.socialText}>Or continue with</Text>
          
          <View style={styles.socialButtons}>
            <TouchableOpacity style={styles.socialButton}>
              <Svg width={24} height={24} viewBox="0 0 24 24">
                <Path
                  d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 17.703c-2.389 2.389-6.272 2.389-8.661 0-.729.729-1.903 1.216-1.168 2.508 2.389 0 4.778-1.168 6.096-1.168 1.168 1.168 2.636 1.168 3.804 0 .949-.949 1.512-2.337 1.512-3.804-.729 1.457-1.457 2.635-1.583 2.462z"
                  fill={COLORS.textPrimary}
                />
              </Svg>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.socialButton}>
              <Svg width={24} height={24} viewBox="0 0 24 24">
                <Path
                  d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.545 17.077c-3.353 0-6.553-1.165-8.949-3.271l-1.917-1.917c1.164-1.164 2.626-1.965 4.203-2.209-.576-1.737-.226-3.608.983-4.937l1.894 1.894c.712-.712 1.966-.699 2.679.014.714.713.726 1.967.013 2.679l-1.888 1.887c.329 1.164.988 2.204 1.877 2.925l1.717-1.717c-1.165-1.001-2.052-2.261-2.516-3.752l1.917-1.917c.576.576 1.376.941 2.261 1.047.01.013.013.039.013.065-.013 2.389-.949 4.655-2.635 6.341l-1.948-1.948c1.052-1.052 1.712-2.461 1.827-3.983H14.13c-.127 1.789-.949 3.456-2.313 4.813l1.738 1.738z"
                  fill={COLORS.textPrimary}
                />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// Register Screen
const RegisterScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  
  const handleRegister = async () => {
    if (!email || !username || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (!agreed) {
      setError('Please agree to the terms and conditions');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await AuthService.register(email, password, username);
      navigation.replace('Main');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.registerContainer}
    >
      <ScrollView contentContainerStyle={styles.registerScrollContent}>
        <Text style={styles.registerTitle}>Create Account</Text>
        <Text style={styles.registerSubtitle}>Join TigerEx today</Text>
        
        <View style={styles.registerForm}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Choose a username"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Create a password"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm your password"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
            />
          </View>
          
          <TouchableOpacity
            style={styles.checkboxContainer}
            onPress={() => setAgreed(!agreed)}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              I agree to the Terms of Service and Privacy Policy
            </Text>
          </TouchableOpacity>
          
          {error ? <Text style={styles.errorText}>{error}</Text>}
          
          <TouchableOpacity
            style={styles.registerButton}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.textPrimary} />
            ) : (
              <Text style={styles.registerButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>
          
          <View style={styles.loginLinks}>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.linkText}>Already have an account? Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// Home Screen
const HomeScreen = ({ navigation }: any) => {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  useFocusEffect(
    useCallback(() => {
      loadTickers();
    }, [])
  );
  
  const loadTickers = async () => {
    try {
      const data = await TradingService.getAllTickers();
      setTickers(data);
    } catch (error) {
      console.error('Failed to load tickers:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  
  const onRefresh = () => {
    setRefreshing(true);
    loadTickers();
  };
  
  const renderTicker = ({ item }: { item: Ticker }) => {
    const isPositive = parseFloat(item.priceChangePercent) >= 0;
    
    return (
      <TouchableOpacity
        style={styles.tickerCard}
        onPress={() => navigation.navigate('MarketDetail', { symbol: item.symbol })}
      >
        <View style={styles.tickerInfo}>
          <Text style={styles.tickerSymbol}>{item.symbol}</Text>
          <Text style={styles.tickerPrice}>{parseFloat(item.price).toFixed(2)}</Text>
        </View>
        <View style={[styles.tickerChange, isPositive ? styles.positiveChange : styles.negativeChange]}>
          <Text style={[styles.tickerChangeText, isPositive ? styles.positiveText : styles.negativeText]}>
            {isPositive ? '+' : ''}{parseFloat(item.priceChangePercent).toFixed(2)}%
          </Text>
        </View>
      </TouchableOpacity>
    );
  };
  
  return (
    <View style={styles.homeContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Markets</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Search')}>
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path
              d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              fill={COLORS.textPrimary}
            />
          </Svg>
        </TouchableOpacity>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={tickers}
          renderItem={renderTicker}
          keyExtractor={(item) => item.symbol}
          contentContainerStyle={styles.tickerList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.primary}
            />
          }
        />
      )}
    </View>
  );
};

// Market Detail Screen
const MarketDetailScreen = ({ route, navigation }: any) => {
  const { symbol } = route.params;
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [orderBook, setOrderBook] = useState<{ bids: string[][]; asks: string[][] } | null>(null);
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartInterval, setChartInterval] = useState('1h');
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState('limit');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [total, setTotal] = useState('');
  
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [symbol, chartInterval])
  );
  
  const loadData = async () => {
    try {
      const [tickerData, obData, klineData] = await Promise.all([
        TradingService.getTicker(symbol),
        TradingService.getOrderBook(symbol),
        TradingService.getKlines(symbol, chartInterval),
      ]);
      
      setTicker(tickerData);
      setOrderBook(obData);
      setKlines(klineData);
      setPrice(tickerData.price);
    } catch (error) {
      console.error('Failed to load market data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const calculateTotal = () => {
    if (price && quantity) {
      const totalValue = parseFloat(price) * parseFloat(quantity);
      setTotal(totalValue.toFixed(2));
    }
  };
  
  const handlePlaceOrder = async () => {
    try {
      await TradingService.createOrder({
        symbol,
        side: orderSide,
        orderType,
        quantity,
        price: orderType === 'market' ? undefined : price,
      });
      
      Alert.alert('Success', 'Order placed successfully');
      setQuantity('');
      setTotal('');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };
  
  if (loading || !ticker) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
  
  return (
    <ScrollView style={styles.marketDetailContainer}>
      <View style={styles.marketDetailHeader}>
        <View>
          <Text style={styles.marketSymbol}>{ticker.symbol}</Text>
          <Text style={styles.marketPrice}>{parseFloat(ticker.price).toFixed(2)}</Text>
        </View>
        <View style={[styles.changeContainer, isPositive ? styles.positiveChange : styles.negativeChange]}>
          <Text style={[styles.changeText, isPositive ? styles.positiveText : styles.negativeText]}>
            {isPositive ? '+' : ''}{parseFloat(ticker.priceChangePercent).toFixed(2)}%
          </Text>
        </View>
      </View>
      
      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>24h High</Text>
          <Text style={styles.statValue}>{parseFloat(ticker.high).toFixed(2)}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>24h Low</Text>
          <Text style={styles.statValue}>{parseFloat(ticker.low).toFixed(2)}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>24h Volume</Text>
          <Text style={styles.statValue}>{parseFloat(ticker.volume).toFixed(2)}</Text>
        </View>
      </View>
      
      {/* Chart */}
      <View style={styles.chartContainer}>
        <View style={styles.intervalSelector}>
          {['1m', '5m', '15m', '1h', '4h', '1d'].map((interval) => (
            <TouchableOpacity
              key={interval}
              style={[styles.intervalButton, chartInterval === interval && styles.intervalButtonActive]}
              onPress={() => setChartInterval(interval)}
            >
              <Text style={[styles.intervalText, chartInterval === interval && styles.intervalTextActive]}>
                {interval}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <View style={styles.chart}>
          {/* Simplified chart representation */}
          <Svg width={SCREEN_WIDTH - 32} height={200}>
            {klines.slice(-50).map((kline, index) => {
              const x = (index / 50) * (SCREEN_WIDTH - 32);
              const open = parseFloat(kline.open);
              const close = parseFloat(kline.close);
              const high = parseFloat(kline.high);
              const low = parseFloat(kline.low);
              const isGreen = close >= open;
              
              return (
                <G key={index}>
                  <Line
                    x1={x}
                    y1={200 - ((high / parseFloat(ticker.high)) * 180)}
                    x2={x}
                    y2={200 - ((low / parseFloat(ticker.high)) * 180)}
                    stroke={isGreen ? COLORS.bullish : COLORS.bearish}
                    strokeWidth="1"
                  />
                  <Rect
                    x={x - 2}
                    y={200 - ((Math.max(open, close) / parseFloat(ticker.high)) * 180)}
                    width="4"
                    height={Math.abs((close - open) / parseFloat(ticker.high)) * 180}
                    fill={isGreen ? COLORS.bullish : COLORS.bearish}
                  />
                </G>
              );
            })}
          </Svg>
        </View>
      </View>
      
      {/* Order Book */}
      {orderBook && (
        <View style={styles.orderBookContainer}>
          <Text style={styles.sectionTitle}>Order Book</Text>
          <View style={styles.orderBookRow}>
            <View style={styles.orderBookColumn}>
              <Text style={styles.orderBookHeader}>Price</Text>
              {orderBook.asks.slice(0, 5).map((ask, index) => (
                <Text key={index} style={styles.askPrice}>{parseFloat(ask[0]).toFixed(2)}</Text>
              ))}
            </View>
            <View style={styles.orderBookColumn}>
              <Text style={styles.orderBookHeader}>Amount</Text>
              {orderBook.asks.slice(0, 5).map((ask, index) => (
                <Text key={index} style={styles.askAmount}>{parseFloat(ask[1]).toFixed(4)}</Text>
              ))}
            </View>
            <View style={styles.orderBookColumn}>
              <Text style={styles.orderBookHeader}>Price</Text>
              {orderBook.bids.slice(0, 5).map((bid, index) => (
                <Text key={index} style={styles.bidPrice}>{parseFloat(bid[0]).toFixed(2)}</Text>
              ))}
            </View>
            <View style={styles.orderBookColumn}>
              <Text style={styles.orderBookHeader}>Amount</Text>
              {orderBook.bids.slice(0, 5).map((bid, index) => (
                <Text key={index} style={styles.bidAmount}>{parseFloat(bid[1]).toFixed(4)}</Text>
              ))}
            </View>
          </View>
        </View>
      )}
      
      {/* Order Form */}
      <View style={styles.orderFormContainer}>
        <View style={styles.orderTypeTabs}>
          <TouchableOpacity
            style={[styles.orderTypeTab, orderSide === 'buy' && styles.buyTabActive]}
            onPress={() => setOrderSide('buy')}
          >
            <Text style={[styles.orderTypeTabText, orderSide === 'buy' && styles.buyTabText]}>Buy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.orderTypeTab, orderSide === 'sell' && styles.sellTabActive]}
            onPress={() => setOrderSide('sell')}
          >
            <Text style={[styles.orderTypeTabText, orderSide === 'sell' && styles.sellTabText]}>Sell</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.orderTypeSelector}>
          {['limit', 'market', 'stop_limit'].map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.orderTypeButton, orderType === type && styles.orderTypeButtonActive]}
              onPress={() => setOrderType(type)}
            >
              <Text style={[styles.orderTypeButtonText, orderType === type && styles.orderTypeButtonTextActive]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        
        {orderType !== 'market' && (
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Price</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              onEndEditing={calculateTotal}
              placeholder="0.00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
        )}
        
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Amount</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={(text) => {
              setQuantity(text);
              calculateTotal();
            }}
            placeholder="0.00"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="decimal-pad"
          />
        </View>
        
        <View style={styles.totalContainer}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{total || '0.00'} USDT</Text>
        </View>
        
        <TouchableOpacity
          style={[
            styles.placeOrderButton,
            orderSide === 'buy' ? styles.buyButton : styles.sellButton,
          ]}
          onPress={handlePlaceOrder}
        >
          <Text style={styles.placeOrderButtonText}>
            {orderSide === 'buy' ? 'Buy' : 'Sell'} {symbol.replace('USDT', '')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// Portfolio Screen
const PortfolioScreen = () => {
  const [balances, setBalances] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  
  useFocusEffect(
    useCallback(() => {
      loadBalances();
    }, [])
  );
  
  const loadBalances = async () => {
    try {
      const data = await WalletService.getBalances();
      setBalances(data);
    } catch (error) {
      console.error('Failed to load balances:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const totalValue = balances.reduce((sum, wallet) => {
    // In real app, would convert to USD using price data
    return sum + parseFloat(wallet.balance);
  }, 0);
  
  const renderBalance = ({ item }: { item: Wallet }) => (
    <View style={styles.balanceCard}>
      <View style={styles.balanceInfo}>
        <Text style={styles.balanceCurrency}>{item.currency}</Text>
        <Text style={styles.balanceAmount}>{parseFloat(item.balance).toFixed(4)}</Text>
      </View>
      {parseFloat(item.locked) > 0 && (
        <Text style={styles.balanceLocked}>Locked: {parseFloat(item.locked).toFixed(4)}</Text>
      )}
    </View>
  );
  
  return (
    <View style={styles.portfolioContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Portfolio</Text>
      </View>
      
      <View style={styles.totalValueContainer}>
        <Text style={styles.totalValueLabel}>Total Balance</Text>
        <Text style={styles.totalValueAmount}>${totalValue.toFixed(2)}</Text>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={balances}
          renderItem={renderBalance}
          keyExtractor={(item) => item.currency}
          contentContainerStyle={styles.balanceList}
        />
      )}
    </View>
  );
};

// Earn Screen
const EarnScreen = ({ navigation }: any) => {
  const [stakingProducts, setStakingProducts] = useState<StakingProduct[]>([]);
  const [lendingProducts, setLendingProducts] = useState<LendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('staking');
  
  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [])
  );
  
  const loadProducts = async () => {
    try {
      const [staking, lending] = await Promise.all([
        EarnService.getStakingProducts(),
        EarnService.getLendingProducts(),
      ]);
      
      setStakingProducts(staking);
      setLendingProducts(lending);
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const renderProduct = (product: StakingProduct | LendingProduct) => {
    const isStaking = 'lockPeriod' in product;
    const apy = isStaking 
      ? (product as StakingProduct).apy 
      : (product as LendingProduct).apy;
    
    return (
      <View key={product.productId} style={styles.productCard}>
        <View style={styles.productHeader}>
          <Text style={styles.productCurrency}>{product.currency}</Text>
          <Text style={styles.productApy}>{apy}% APY</Text>
        </View>
        <Text style={styles.productName}>
          {isStaking 
            ? (product as StakingProduct).name 
            : `${(product as LendingProduct).termDays} Day${(product as LendingProduct).termDays > 1 ? 's' : ''} Lending`}
        </Text>
        <Text style={styles.productMin}>
          Min: {product.minAmount} {product.currency}
        </Text>
        <TouchableOpacity style={styles.productButton}>
          <Text style={styles.productButtonText}>Stake</Text>
        </TouchableOpacity>
      </View>
    );
  };
  
  return (
    <View style={styles.earnContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Earn</Text>
      </View>
      
      <View style={styles.earnTabs}>
        <TouchableOpacity
          style={[styles.earnTab, activeTab === 'staking' && styles.earnTabActive]}
          onPress={() => setActiveTab('staking')}
        >
          <Text style={[styles.earnTabText, activeTab === 'staking' && styles.earnTabTextActive]}>
            Staking
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.earnTab, activeTab === 'lending' && styles.earnTabActive]}
          onPress={() => setActiveTab('lending')}
        >
          <Text style={[styles.earnTabText, activeTab === 'lending' && styles.earnTabTextActive]}>
            Lending
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.earnTab, activeTab === 'leveraged' && styles.earnTabActive]}
          onPress={() => setActiveTab('leveraged')}
        >
          <Text style={[styles.earnTabText, activeTab === 'leveraged' && styles.earnTabTextActive]}>
            Leveraged
          </Text>
        </TouchableOpacity>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.productList}>
          {activeTab === 'staking' && stakingProducts.map(renderProduct)}
          {activeTab === 'lending' && lendingProducts.map(renderProduct)}
          {activeTab === 'leveraged' && (
            <View style={styles.productCard}>
              <View style={styles.productHeader}>
                <Text style={styles.productCurrency}>BTCBULL</Text>
                <Text style={styles.productApy}>3x Long</Text>
              </View>
              <Text style={styles.productName}>3X Long Bitcoin Token</Text>
              <TouchableOpacity style={styles.productButton}>
                <Text style={styles.productButtonText}>Buy</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

// Profile Screen
const ProfileScreen = ({ navigation }: any) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  useFocusEffect(
    useCallback(() => {
      loadUser();
    }, [])
  );
  
  const loadUser = async () => {
    try {
      const data = await AuthService.getCurrentUser();
      setUser(data);
    } catch (error) {
      console.error('Failed to load user:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleLogout = async () => {
    await AuthService.logout();
    navigation.replace('Login');
  };
  
  const menuItems = [
    { icon: 'wallet', label: 'Wallets', screen: 'Wallets' },
    { icon: 'history', label: 'Transaction History', screen: 'Transactions' },
    { icon: 'security', label: 'Security', screen: 'Security' },
    { icon: 'verification', label: 'KYC Verification', screen: 'KYC' },
    { icon: 'api', label: 'API Keys', screen: 'APIKeys' },
    { icon: 'help', label: 'Help & Support', screen: 'Support' },
  ];
  
  return (
    <View style={styles.profileContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : user ? (
        <ScrollView>
          <View style={styles.profileHeader}>
            <View style={styles.avatarContainer}>
              <Text style={styles.avatarText}>
                {user.username.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.username}>{user.username}</Text>
            <Text style={styles.email}>{user.email}</Text>
            <View style={styles.kycBadge}>
              <Text style={styles.kycBadgeText}>
                KYC Level {user.kycLevel}
              </Text>
            </View>
          </View>
          
          <View style={styles.menuSection}>
            {menuItems.map((item, index) => (
              <TouchableOpacity key={index} style={styles.menuItem}>
                <Text style={styles.menuItemText}>{item.label}</Text>
                <Svg width={24} height={24} viewBox="0 0 24 24">
                  <Path
                    d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"
                    fill={COLORS.textSecondary}
                  />
                </Svg>
              </TouchableOpacity>
            ))}
          </View>
          
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={styles.loginPrompt}>
          <Text style={styles.loginPromptText}>Please sign in to view your profile</Text>
          <TouchableOpacity
            style={styles.loginPromptButton}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.loginPromptButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ============================================================================
// NAVIGATION
// ============================================================================

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
const Drawer = createDrawerNavigator();

const HomeStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Home" component={HomeScreen} />
    <Stack.Screen name="MarketDetail" component={MarketDetailScreen} />
  </Stack.Navigator>
);

const MainTabs = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      tabBarIcon: ({ focused, color, size }) => {
        let icon: string = '';
        
        switch (route.name) {
          case 'Home':
            icon = 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z';
            break;
          case 'Trade':
            icon = 'M3 17h18v2H3v-2zm0-7h18v2H3v-2zm0-7h18v2H3V3z';
            break;
          case 'Earn':
            icon = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.5-2.14-2.38-.62-4.04-1.61-4.04-3.64 0-1.51 1.04-2.63 2.89-2.99l1.82.15V8h2.67v1.97c1.86.45 2.82 1.5 2.82 2.76 0 .93-.55 1.46-1.73 1.46-1.33 0-2.17-.62-2.17-1.62 0-.93.62-1.37 2.09-1.76 1.8-.47 3.6-.76 3.6-2.97 0-1.41-.93-2.5-2.73-2.88V4h-2.67v1.95c-1.9.48-2.91 1.52-2.91 2.83 0 .96.57 1.54 1.64 1.54 1.38 0 2.08-.78 2.08-1.76 0-.76-.41-1.31-2.02-1.76-1.78-.5-3.42-.87-3.42-3.05 0-1.57 1.09-2.66 2.87-2.97V1h-2.67v1.9c-1.72.41-2.76 1.36-2.76 2.83 0 .83.46 1.44 1.46 1.44.93 0 1.72-.53 1.72-1.49 0-.79-.49-1.34-1.97-1.75-1.84-.51-3.45-.95-3.45-3.15 0-1.68 1.27-2.78 3.07-3.04V2h2.67v1.86c1.77.32 2.78 1.3 2.78 2.83 0 .84-.45 1.44-1.45 1.44-1.01 0-1.81-.59-1.81-1.64 0-.82.59-1.38 1.81-1.74 1.64-.49 3.24-.9 3.24-2.96 0-1.45-.88-2.47-2.68-2.83V1h-2.66v1.9c-1.64.38-2.62 1.24-2.62 2.83 0 .9.51 1.53 1.45 1.53 1.04 0 1.86-.63 1.86-1.69 0-.83-.58-1.38-1.92-1.76-1.54-.44-3.04-.82-3.04-2.99 0-1.58 1.19-2.65 2.95-2.93V2h2.66v1.87c1.6.28 2.57 1.14 2.57 2.71 0 .85-.5 1.47-1.42 1.47-.96 0-1.73-.6-1.73-1.64 0-.84.63-1.4 1.95-1.76 1.74-.48 3.42-.87 3.42-3.01 0-1.52-1.13-2.59-2.79-2.9V1h-2.67v1.9c-1.61.35-2.56 1.2-2.56 2.79 0 .88.48 1.5 1.4 1.5.98 0 1.76-.62 1.76-1.64 0-.84-.61-1.39-1.95-1.76-1.74-.48-3.38-.86-3.38-2.99 0-1.56 1.15-2.63 2.83-2.93V2h2.67v1.87c1.55.26 2.49 1.1 2.49 2.72 0 .83-.46 1.44-1.39 1.44-1.01 0-1.81-.59-1.81-1.64 0-.82.59-1.38 1.81-1.74';
            break;
          case 'Portfolio':
            icon = 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z';
            break;
          case 'Profile':
            icon = 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
            break;
        }
        
        return (
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path d={icon} fill={color} />
          </Svg>
        );
      },
      tabBarActiveTintColor: COLORS.primary,
      tabBarInactiveTintColor: COLORS.textSecondary,
      tabBarStyle: styles.tabBar,
      tabBarLabelStyle: styles.tabBarLabel,
    })}
  >
    <Tab.Screen name="Home" component={HomeStack} options={{ tabBarLabel: 'Markets' }} />
    <Tab.Screen name="Trade" component={MarketDetailScreen} options={{ tabBarLabel: 'Trade' }} />
    <Tab.Screen name="Earn" component={EarnScreen} options={{ tabBarLabel: 'Earn' }} />
    <Tab.Screen name="Portfolio" component={PortfolioScreen} options={{ tabBarLabel: 'Portfolio' }} />
    <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
  </Tab.Navigator>
);

// Main Navigator
const MainNavigator = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Main" component={MainTabs} />
    <Stack.Screen name="Login" component={LoginScreen} />
    <Stack.Screen name="Register" component={RegisterScreen} />
  </Stack.Navigator>
);

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // Common Styles
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceLight,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  
  // Splash Screen
  splashContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  splashGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashText: {
    fontSize: 18,
    color: COLORS.textPrimary,
    marginTop: 20,
  },
  
  // Login Screen
  loginContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loginScrollContent: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  loginLogoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  loginTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 16,
  },
  loginSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  loginForm: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 16,
    color: COLORS.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  loginButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  loginLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  linkText: {
    color: COLORS.primary,
    fontSize: 14,
  },
  socialLogin: {
    marginTop: 40,
    alignItems: 'center',
  },
  socialText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginBottom: 16,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  socialButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 16,
    marginHorizontal: 8,
  },
  
  // Register Screen
  registerContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  registerScrollContent: {
    flexGrow: 1,
    padding: 24,
  },
  registerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 60,
  },
  registerSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  registerForm: {
    marginTop: 32,
  },
  registerButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  registerButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  checkboxLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  
  // Home Screen
  homeContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  tickerList: {
    padding: 16,
  },
  tickerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tickerInfo: {
    flex: 1,
  },
  tickerSymbol: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  tickerPrice: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  tickerChange: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  positiveChange: {
    backgroundColor: COLORS.success + '20',
  },
  negativeChange: {
    backgroundColor: COLORS.error + '20',
  },
  tickerChangeText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  positiveText: {
    color: COLORS.success,
  },
  negativeText: {
    color: COLORS.error,
  },
  
  // Market Detail Screen
  marketDetailContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  marketDetailHeader: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  marketSymbol: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  marketPrice: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  changeContainer: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  changeText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  statValue: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  chartContainer: {
    padding: 16,
  },
  intervalSelector: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  intervalButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 8,
  },
  intervalButtonActive: {
    backgroundColor: COLORS.primary,
  },
  intervalText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  intervalTextActive: {
    color: COLORS.textPrimary,
  },
  chart: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 8,
  },
  orderBookContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  orderBookRow: {
    flexDirection: 'row',
  },
  orderBookColumn: {
    flex: 1,
  },
  orderBookHeader: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  askPrice: {
    fontSize: 12,
    color: COLORS.error,
    textAlign: 'right',
  },
  askAmount: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'right',
  },
  bidPrice: {
    fontSize: 12,
    color: COLORS.success,
    textAlign: 'right',
  },
  bidAmount: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'right',
  },
  orderFormContainer: {
    padding: 16,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  orderTypeTabs: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  orderTypeTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  buyTabActive: {
    backgroundColor: COLORS.success,
  },
  sellTabActive: {
    backgroundColor: COLORS.error,
  },
  orderTypeTabText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textSecondary,
  },
  buyTabText: {
    color: COLORS.textPrimary,
  },
  sellTabText: {
    color: COLORS.textPrimary,
  },
  orderTypeSelector: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  orderTypeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  orderTypeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  orderTypeButtonText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  orderTypeButtonTextActive: {
    color: COLORS.textPrimary,
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 16,
  },
  totalLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  placeOrderButton: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buyButton: {
    backgroundColor: COLORS.success,
  },
  sellButton: {
    backgroundColor: COLORS.error,
  },
  placeOrderButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  
  // Portfolio Screen
  portfolioContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  totalValueContainer: {
    padding: 24,
    alignItems: 'center',
  },
  totalValueLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  totalValueAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  balanceList: {
    padding: 16,
  },
  balanceCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  balanceInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceCurrency: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  balanceAmount: {
    fontSize: 18,
    color: COLORS.textPrimary,
  },
  balanceLocked: {
    fontSize: 14,
    color: COLORS.warning,
    marginTop: 4,
  },
  
  // Earn Screen
  earnContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  earnTabs: {
    flexDirection: 'row',
    padding: 16,
  },
  earnTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  earnTabActive: {
    borderBottomColor: COLORS.primary,
  },
  earnTabText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  earnTabTextActive: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  productList: {
    padding: 16,
  },
  productCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productCurrency: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  productApy: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  productName: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  productMin: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  productButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  productButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  
  // Profile Screen
  profileContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  profileHeader: {
    padding: 24,
    alignItems: 'center',
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 16,
  },
  email: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  kycBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 12,
  },
  kycBadgeText: {
    color: COLORS.textPrimary,
    fontSize: 12,
  },
  menuSection: {
    paddingHorizontal: 16,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceLight,
  },
  menuItemText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  logoutButton: {
    margin: 16,
    backgroundColor: COLORS.error,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  loginPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loginPromptText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  loginPromptButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  
  // Tab Bar
  tabBar: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceLight,
    paddingTop: 8,
    paddingBottom: 8,
    height: 60,
  },
  tabBarLabel: {
    fontSize: 12,
    marginTop: 4,
  },
});

// ============================================================================
// APP ENTRY POINT
// ============================================================================

const App = () => {
  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: COLORS.primary,
            background: COLORS.background,
            card: COLORS.surface,
            text: COLORS.textPrimary,
            border: COLORS.surfaceLight,
            notification: COLORS.primary,
          },
        }}
      >
        <MainNavigator />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
};

export default App;