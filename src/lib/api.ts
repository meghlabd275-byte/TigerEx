// TigerEx API Client Library - Updated for Go Backend
// Point to local backend during development

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// =============================================================================
// TYPES
// =============================================================================

export interface User {
  userId: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  countryCode: string;
  kycLevel: number;
  accountStatus: string;
  twoFactorEnabled: boolean;
  createdAt: number;
}

export interface Wallet {
  walletId: string;
  walletType: string;
  currency: string;
  balance: number;
  locked: number;
  available: number;
}

export interface Balance {
  currency: string;
  available: number;
  locked: number;
  total: number;
}

export interface Order {
  orderId: string;
  clientOrderId?: string;
  marketSymbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market' | 'stop_loss' | 'stop_limit';
  quantity: number;
  filledQuantity: number;
  remaining: number;
  price: number;
  stopPrice?: number;
  averagePrice: number;
  commission: number;
  status: OrderStatus;
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  createdAt: number;
  updatedAt: number;
}

export type OrderStatus = 
  | 'pending_new' 
  | 'new' 
  | 'partially_filled' 
  | 'filled' 
  | 'canceled' 
  | 'rejected' 
  | 'expired';

export interface Trade {
  tradeId: string;
  orderId: string;
  marketSymbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  commission: number;
  isMaker: boolean;
  timestamp: number;
}

export interface OrderBook {
  lastUpdateId: number;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export interface PriceLevel {
  price: number;
  quantity: number;
  total?: number;
}

export interface Ticker {
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  tradesCount: number;
}

export interface Market {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  pricePrecision: number;
  quantityPrecision: number;
  status: string;
}

export interface Deposit {
  depositId: string;
  currency: string;
  amount: number;
  txHash?: string;
  confirmations: number;
  status: DepositStatus;
  createdAt: number;
}

export type DepositStatus = 
  | 'pending' 
  | 'processing' 
  | 'completed' 
  | 'failed';

export interface Withdrawal {
  withdrawalId: string;
  currency: string;
  amount: number;
  toAddress: string;
  txHash?: string;
  status: WithdrawalStatus;
  createdAt: number;
}

export type WithdrawalStatus = 
  | 'pending' 
  | 'pending_approval' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: APIError;
}

export interface APIError {
  code: number;
  message: string;
  field?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: User;
}

export interface ExchangeInfo {
  timezone: string;
  serverTime: number;
  symbols: Market[];
}

// =============================================================================
// API CLIENT
// =============================================================================

export class TigerExClient {
  private baseURL: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
    this.loadTokens();
  }

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================

  async register(data: {
    email: string;
    username?: string;
    password: string;
    countryCode: string;
    referralCode?: string;
    termsAccepted: boolean;
  }): Promise<APIResponse<AuthTokens>> {
    const response = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    if (response.success && response.data) {
      this.setTokens(response.data.accessToken, response.data.refreshToken);
    }
    
    return response as APIResponse<AuthTokens>;
  }

  async login(email: string, password: string): Promise<APIResponse<AuthTokens>> {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    if (response.success && response.data) {
      this.setTokens(response.data.accessToken, response.data.refreshToken);
    }
    
    return response as APIResponse<AuthTokens>;
  }

  async logout(): Promise<APIResponse<void>> {
    const response = await this.request('/auth/logout', {
      method: 'POST',
    });
    
    this.clearTokens();
    return response;
  }

  async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;
    
    const response = await this.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    
    if (response.success && response.data) {
      this.setTokens(response.data.accessToken, response.data.refreshToken);
      return true;
    }
    
    return false;
  }

  // ==========================================================================
  // ACCOUNT
  // ==========================================================================

  async getAccountInfo(): Promise<APIResponse<User>> {
    return this.request('/api/v1/account/info');
  }

  async getProfile(): Promise<APIResponse<User>> {
    return this.request('/api/v1/account/profile');
  }

  async updateProfile(data: Partial<User>): Promise<APIResponse<User>> {
    return this.request('/api/v1/account/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ==========================================================================
  // WALLET
  // ==========================================================================

  async getBalances(walletType?: string): Promise<APIResponse<Balance[]>> {
    const params = walletType ? `?walletType=${walletType}` : '';
    return this.request(`/api/v1/account/balance${params}`);
  }

  async getDepositAddress(currency: string, network?: string): Promise<APIResponse<{
    address: string;
    addressTag?: string;
    currency: string;
    network: string;
  }>> {
    const params = new URLSearchParams({ currency });
    if (network) params.append('network', network);
    return this.request(`/api/v1/account/deposit/address?${params}`);
  }

  async getDeposits(limit: number = 50): Promise<APIResponse<Deposit[]>> {
    return this.request(`/api/v1/account/deposits?limit=${limit}`);
  }

  async requestWithdrawal(data: {
    currency: string;
    amount: number;
    toAddress: string;
    network?: string;
  }): Promise<APIResponse<Withdrawal>> {
    return this.request('/api/v1/account/withdraw', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWithdrawals(limit: number = 50): Promise<APIResponse<Withdrawal[]>> {
    return this.request(`/api/v1/account/withdrawals?limit=${limit}`);
  }

  async transfer(data: {
    toUserId: string;
    currency: string;
    amount: number;
  }): Promise<APIResponse<void>> {
    return this.request('/api/v1/account/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==========================================================================
  // TRADING
  // ==========================================================================

  async getExchangeInfo(): Promise<APIResponse<ExchangeInfo>> {
    return this.request('/api/v1/exchangeinfo');
  }

  async getMarkets(): Promise<APIResponse<Market[]>> {
    return this.request('/api/v1/markets');
  }

  async getOrderBook(symbol: string, limit: number = 20): Promise<APIResponse<OrderBook>> {
    return this.request(`/api/v1/depth/${symbol}?limit=${limit}`);
  }

  async getTicker(symbol: string): Promise<APIResponse<Ticker>> {
    return this.request(`/api/v1/ticker/${symbol}`);
  }

  async getAllTickers(): Promise<APIResponse<Ticker[]>> {
    return this.request('/api/v1/ticker/price');
  }

  async placeOrder(data: {
    marketSymbol: string;
    side: 'buy' | 'sell';
    orderType: 'limit' | 'market';
    quantity: number;
    price?: number;
    stopPrice?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    clientOrderId?: string;
  }): Promise<APIResponse<Order>> {
    return this.request('/api/v1/order', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async cancelOrder(orderId: string): Promise<APIResponse<Order>> {
    return this.request(`/api/v1/order/${orderId}`, {
      method: 'DELETE',
    });
  }

  async getOpenOrders(symbol?: string): Promise<APIResponse<Order[]>> {
    const params = symbol ? `?symbol=${symbol}` : '';
    return this.request(`/api/v1/openOrders${params}`);
  }

  async getOrderHistory(symbol?: string, limit: number = 50): Promise<APIResponse<Order[]>> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (symbol) params.append('symbol', symbol);
    return this.request(`/api/v1/allOrders?${params}`);
  }

  async getMyTrades(symbol?: string, limit: number = 50): Promise<APIResponse<Trade[]>> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (symbol) params.append('symbol', symbol);
    return this.request(`/api/v1/myTrades?${params}`);
  }

  // ==========================================================================
  // EARN PRODUCTS
  // ==========================================================================

  async getEarnProducts(): Promise<APIResponse<any[]>> {
    return this.request('/api/v1/earn/products');
  }

  async subscribeToEarn(data: {
    productId: string;
    amount: number;
  }): Promise<APIResponse<void>> {
    return this.request('/api/v1/earn/subscribe', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getEarnPositions(): Promise<APIResponse<any[]>> {
    return this.request('/api/v1/earn/positions');
  }

  // ==========================================================================
  // API KEYS
  // ==========================================================================

  async createAPIKey(data: {
    name: string;
    permissions: string[];
    expiresAt?: string;
  }): Promise<APIResponse<{
    keyId: string;
    key: string;
    keyPrefix: string;
    expiresAt?: string;
  }>> {
    return this.request('/api/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAPIKeys(): Promise<APIResponse<any[]>> {
    return this.request('/api/v1/api-keys');
  }

  async revokeAPIKey(keyId: string): Promise<APIResponse<void>> {
    return this.request(`/api/v1/api-keys/${keyId}`, {
      method: 'DELETE',
    });
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<APIResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });
      
      const data = await response.json();
      
      // Handle token refresh
      if (response.status === 401 && this.refreshToken) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry request
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(url, {
            ...options,
            headers,
          });
          return retryResponse.json();
        }
      }
      
      return data;
    } catch (error) {
      return {
        success: false,
        error: {
          code: -1,
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    
    if (typeof window !== 'undefined') {
      localStorage.setItem('tigerex_access_token', accessToken);
      localStorage.setItem('tigerex_refresh_token', refreshToken);
    }
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tigerex_access_token');
      localStorage.removeItem('tigerex_refresh_token');
    }
  }

  private loadTokens(): void {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('tigerex_access_token');
      this.refreshToken = localStorage.getItem('tigerex_refresh_token');
    }
  }

  // ==========================================================================
  // WEBSOCKET CONNECTION
  // ==========================================================================

  connectWebSocket(): TigerExWebSocket {
    return new TigerExWebSocket(this.baseURL.replace('https://', 'wss://'), this.accessToken);
  }
}

// =============================================================================
// WEBSOCKET CLIENT
// =============================================================================

export class TigerExWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string | null;
  private handlers: Map<string, ((data: any) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(baseURL: string, token: string | null = null) {
    this.url = `${baseURL}/ws`;
    this.token = token;
  }

  connect(): void {
    const wsUrl = this.token 
      ? `${this.url}?token=${this.token}`
      : this.url;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect();
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(streams: string[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: streams,
        id: Date.now(),
      }));
    }
  }

  unsubscribe(streams: string[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: streams,
        id: Date.now(),
      }));
    }
  }

  on(event: string, handler: (data: any) => void): void {
    const handlers = this.handlers.get(event) || [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: (data: any) => void): void {
    const handlers = this.handlers.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      this.handlers.set(event, handlers);
    }
  }

  private handleMessage(message: any): void {
    const event = message.e || message.stream;
    if (event) {
      const handlers = this.handlers.get(event) || [];
      handlers.forEach(handler => handler(message));
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect();
      }, Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000));
    }
  }
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default TigerExClient;
