/**
 * TigerEx API Client
 * TypeScript client for interacting with TigerEx backend services
 */

import { 
  User, 
  LoginRequest, 
  LoginResponse, 
  RegisterRequest, 
  RegisterResponse,
  Wallet,
  Market,
  Order,
  OrderBook,
  Trade,
  Ticker,
  DepositAddress,
  WithdrawalRequest,
  TransferRequest,
  ApiResponse,
  PaginatedResponse
} from './types';

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

class AuthService {
  private token: string | null = null;
  private refreshToken: string | null = null;

  setTokens(accessToken: string, refreshToken: string) {
    this.token = accessToken;
    this.refreshToken = refreshToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('tigerex_access_token', accessToken);
      localStorage.setItem('tigerex_refresh_token', refreshToken);
    }
  }

  clearTokens() {
    this.token = null;
    this.refreshToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tigerex_access_token');
      localStorage.removeItem('tigerex_refresh_token');
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('tigerex_access_token');
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      return this.request<T>(endpoint, options);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'An error occurred' }));
      throw new ApiError(response.status, error.message);
    }

    return response.json();
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.request<ApiResponse<LoginResponse>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (response.data) {
      this.setTokens(response.data.access_token, response.data.refresh_token);
    }
    
    return response.data;
  }

  async loginWithOTP(email: string, password: string, otp: string): Promise<LoginResponse> {
    const response = await this.request<ApiResponse<LoginResponse>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, otp }),
    });

    if (response.data) {
      this.setTokens(response.data.access_token, response.data.refresh_token);
    }
    
    return response.data;
  }

  async register(data: RegisterRequest): Promise<RegisterResponse> {
    const response = await this.request<ApiResponse<RegisterResponse>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearTokens();
    }
  }

  async refreshAccessToken(): Promise<void> {
    const refreshToken = this.refreshToken || (typeof window !== 'undefined' ? localStorage.getItem('tigerex_refresh_token') : null);
    if (!refreshToken) {
      this.clearTokens();
      throw new Error('No refresh token available');
    }

    const response = await this.request<ApiResponse<LoginResponse>>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (response.data) {
      this.setTokens(response.data.access_token, response.data.refresh_token);
    }
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.request<ApiResponse<User>>('/auth/me');
    return response.data;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.request('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.request('/auth/password-reset/reset', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async setup2FA(): Promise<{ secret: string; qr_code_url: string; recovery_codes: string[] }> {
    const response = await this.request<ApiResponse<{ secret: string; qr_code_url: string; recovery_codes: string[] }>>('/auth/2fa/setup', {
      method: 'POST',
    });
    return response.data;
  }

  async verify2FA(code: string): Promise<void> {
    await this.request('/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disable2FA(code: string): Promise<void> {
    await this.request('/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }
}

class WalletService {
  constructor(private api: AuthService) {}

  async getBalances(): Promise<Wallet[]> {
    const response = await this.api.request<ApiResponse<Wallet[]>>('/wallet/balances');
    return response.data;
  }

  async getBalance(currency: string): Promise<Wallet> {
    const response = await this.api.request<ApiResponse<Wallet>>(`/wallet/balances/${currency}`);
    return response.data;
  }

  async getDepositAddress(currency: string, network: string): Promise<DepositAddress> {
    const response = await this.api.request<ApiResponse<DepositAddress>>(`/wallet/deposit/address`, {
      method: 'POST',
      body: JSON.stringify({ currency, network }),
    });
    return response.data;
  }

  async getAllDepositAddresses(currency: string): Promise<DepositAddress[]> {
    const response = await this.api.request<ApiResponse<DepositAddress[]>>(`/wallet/deposit/addresses/${currency}`);
    return response.data;
  }

  async withdraw(data: WithdrawalRequest): Promise<{ withdrawal_id: string }> {
    const response = await this.api.request<ApiResponse<{ withdrawal_id: string }>>('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  }

  async transfer(data: TransferRequest): Promise<void> {
    await this.api.request('/wallet/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getHistory(params?: {
    currency?: string;
    type?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<any>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
    }
    const response = await this.api.request<ApiResponse<PaginatedResponse<any>>>(`/wallet/history?${queryParams}`);
    return response.data;
  }
}

class MarketService {
  constructor(private api: AuthService) {}

  async getMarkets(): Promise<Market[]> {
    const response = await this.api.request<ApiResponse<Market[]>>('/market/markets');
    return response.data;
  }

  async getMarket(symbol: string): Promise<Market> {
    const response = await this.api.request<ApiResponse<Market>>(`/market/markets/${symbol}`);
    return response.data;
  }

  async getTickers(): Promise<Record<string, Ticker>> {
    const response = await this.api.request<ApiResponse<Record<string, Ticker>>>('/market/tickers');
    return response.data;
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const response = await this.api.request<ApiResponse<Ticker>>(`/market/tickers/${symbol}`);
    return response.data;
  }

  async getOrderBook(symbol: string, limit: number = 20): Promise<OrderBook> {
    const response = await this.api.request<ApiResponse<OrderBook>>(`/market/orderbook/${symbol}?limit=${limit}`);
    return response.data;
  }

  async getRecentTrades(symbol: string, limit: number = 50): Promise<Trade[]> {
    const response = await this.api.request<ApiResponse<Trade[]>>(`/market/trades/${symbol}?limit=${limit}`);
    return response.data;
  }

  async getKlines(symbol: string, interval: string, start?: number, end?: number, limit?: number): Promise<any[]> {
    let url = `/market/klines/${symbol}?interval=${interval}`;
    if (start) url += `&start=${start}`;
    if (end) url += `&end=${end}`;
    if (limit) url += `&limit=${limit}`;
    const response = await this.api.request<ApiResponse<any[]>>(url);
    return response.data;
  }
}

class TradingService {
  constructor(private api: AuthService) {}

  async createOrder(order: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop_loss' | 'stop_limit';
    quantity: string;
    price?: string;
    stop_price?: string;
    time_in_force?: 'GTC' | 'IOC' | 'FOK';
  }): Promise<Order> {
    const response = await this.api.request<ApiResponse<Order>>('/trading/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });
    return response.data;
  }

  async cancelOrder(orderId: string): Promise<Order> {
    const response = await this.api.request<ApiResponse<Order>>(`/trading/orders/${orderId}/cancel`, {
      method: 'POST',
    });
    return response.data;
  }

  async getOrder(orderId: string): Promise<Order> {
    const response = await this.api.request<ApiResponse<Order>>(`/trading/orders/${orderId}`);
    return response.data;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    let url = '/trading/orders/open';
    if (symbol) url += `?symbol=${symbol}`;
    const response = await this.api.request<ApiResponse<Order[]>>(url);
    return response.data;
  }

  async getOrderHistory(params?: {
    symbol?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Order>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
    }
    const response = await this.api.request<ApiResponse<PaginatedResponse<Order>>>(`/trading/orders/history?${queryParams}`);
    return response.data;
  }

  async getTradeHistory(params?: {
    symbol?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Trade>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
    }
    const response = await this.api.request<ApiResponse<PaginatedResponse<Trade>>>(`/trading/trades?${queryParams}`);
    return response.data;
  }
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  connect(token?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const wsUrl = token ? `${WS_URL}?token=${token}` : WS_URL;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect(token);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect(token?: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(token), this.reconnectDelay);
      this.reconnectDelay *= 2;
    }
  }

  private handleMessage(message: { channel: string; data: any }): void {
    const listeners = this.listeners.get(message.channel);
    if (listeners) {
      listeners.forEach((callback) => callback(message.data));
    }
  }

  subscribe(channel: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
      this.ws?.send(JSON.stringify({ action: 'subscribe', channel }));
    }

    this.listeners.get(channel)?.add(callback);

    return () => {
      const listeners = this.listeners.get(channel);
      listeners?.delete(callback);
      if (listeners?.size === 0) {
        this.listeners.delete(channel);
        this.ws?.send(JSON.stringify({ action: 'unsubscribe', channel }));
      }
    };
  }

  unsubscribe(channel: string): void {
    this.listeners.delete(channel);
    this.ws?.send(JSON.stringify({ action: 'unsubscribe', channel }));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }

  // Convenience methods for common subscriptions
  onOrderBook(symbol: string, callback: (data: OrderBook) => void): () => void {
    return this.subscribe(`orderbook:${symbol}`, callback);
  }

  onTicker(symbol: string, callback: (data: Ticker) => void): () => void {
    return this.subscribe(`ticker:${symbol}`, callback);
  }

  onTrade(symbol: string, callback: (data: Trade) => void): () => void {
    return this.subscribe(`trade:${symbol}`, callback);
  }

  onUserOrder(callback: (data: Order) => void): () => void {
    return this.subscribe('user:orders', callback);
  }

  onUserTrade(callback: (data: Trade) => void): () => void {
    return this.subscribe('user:trades', callback);
  }

  onUserBalance(callback: (data: any) => void): () => void {
    return this.subscribe('user:balance', callback);
  }
}

// Export singleton instances
export const api = new AuthService();
export const walletService = new WalletService(api);
export const marketService = new MarketService(api);
export const tradingService = new TradingService(api);
export const wsService = new WebSocketService();

export { AuthService, WalletService, MarketService, TradingService, WebSocketService };
export { ApiError };
