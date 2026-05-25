/**
 * API Client (Minimal TypeScript)
 * Lightweight client for communicating with Go backend services
 */

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private ws: WebSocket | null = null;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  // Generic request methods
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...options.headers,
      },
    });
    return response.json();
  }

  // ============ Trading Endpoints ============
  
  async createOrder(order: {
    symbol: string;
    side: string;
    type: string;
    quantity: string;
    price?: string;
    timeInForce?: string;
  }): Promise<any> {
    return this.request('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    return this.request(`/api/v1/orders/${orderId}`, { method: 'DELETE' });
  }

  async getOrders(options?: { symbol?: string; status?: string }): Promise<any[]> {
    const params = new URLSearchParams(options as any);
    return this.request(`/api/v1/orders?${params}`);
  }

  async getOrder(orderId: string): Promise<any> {
    return this.request(`/api/v1/orders/${orderId}`);
  }

  async getTrades(symbol?: string, limit = 50): Promise<any[]> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (symbol) params.set('symbol', symbol);
    return this.request(`/api/v1/trades?${params}`);
  }

  // ============ Market Endpoints ============

  async getMarkets(): Promise<any[]> {
    return this.request('/api/v1/markets');
  }

  async getTicker(symbol: string): Promise<any> {
    return this.request(`/api/v1/markets/${symbol}/ticker`);
  }

  async getOrderBook(symbol: string, limit = 20): Promise<any> {
    return this.request(`/api/v1/markets/${symbol}/orderbook?limit=${limit}`);
  }

  async getKlines(symbol: string, interval: string, limit = 100): Promise<any[]> {
    return this.request(`/api/v1/markets/${symbol}/klines?interval=${interval}&limit=${limit}`);
  }

  // ============ Wallet Endpoints ============

  async getWallets(): Promise<any[]> {
    return this.request('/api/v1/wallets');
  }

  async getBalance(currency?: string): Promise<any> {
    const params = currency ? `?currency=${currency}` : '';
    return this.request(`/api/v1/balance${params}`);
  }

  async getDepositAddress(currency: string, chain?: string): Promise<{ address: string; memo?: string }> {
    const params = new URLSearchParams({ currency });
    if (chain) params.set('chain', chain);
    return this.request(`/api/v1/wallets/deposit-address?${params}`);
  }

  async withdraw(params: {
    currency: string;
    amount: string;
    address: string;
    chain?: string;
  }): Promise<any> {
    return this.request('/api/v1/wallets/withdraw', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getTransactions(options?: {
    currency?: string;
    type?: string;
    status?: string;
    limit?: number;
  }): Promise<any[]> {
    const params = new URLSearchParams(options as any);
    return this.request(`/api/v1/transactions?${params}`);
  }

  // ============ User Endpoints ============

  async getProfile(): Promise<any> {
    return this.request('/api/v1/user/profile');
  }

  async updateProfile(data: any): Promise<any> {
    return this.request('/api/v1/user/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ============ WebSocket Connection ============

  connectWebSocket(channels: string[]): void {
    const wsUrl = this.baseUrl.replace('http', 'ws') + '/ws';
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({
        action: 'subscribe',
        channels,
        apiKey: this.apiKey,
      }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Dispatch to appropriate handler
      this.handleWsMessage(data);
    };
  }

  private handleWsMessage(data: any): void {
    // Override in subclass to handle messages
    console.log('WS Message:', data);
  }

  disconnectWebSocket(): void {
    this.ws?.close();
    this.ws = null;
  }

  // ============ Subscription ============

  subscribe(channel: string): void {
    this.ws?.send(JSON.stringify({ action: 'subscribe', channel }));
  }

  unsubscribe(channel: string): void {
    this.ws?.send(JSON.stringify({ action: 'unsubscribe', channel }));
  }
}

// Helper to create client instance
export function createClient(config: {
  baseUrl: string;
  apiKey: string;
}): ApiClient {
  return new ApiClient(config.baseUrl, config.apiKey);
}

// Export only the client, not implementations
export default ApiClient;