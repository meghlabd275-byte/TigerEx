/**
 * TigerEx Node.js SDK
 * Production-grade TypeScript/JavaScript SDK for TigerEx exchange API
 */

import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { EventEmitter } from 'events';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface Config {
    apiKey: string;
    apiSecret: string;
    testnet?: boolean;
    baseUrl?: string;
    timeout?: number;
}

export interface APIResponse<T = any> {
    success: boolean;
    data?: T;
    error?: {
        code: number;
        message: string;
    };
}

// ============================================================================
// CLIENT
// ============================================================================

export class TigerExClient extends EventEmitter {
    private config: Config;
    private baseURL: string;
    private timeout: number;
    private lastResponseTime: number = 0;

    constructor(config: Config) {
        super();
        if (!config || typeof config !== 'object') {
            throw new TypeError('A TigerEx SDK configuration is required');
        }
        if (config.apiKey && !config.apiSecret) {
            throw new TypeError('apiSecret is required when apiKey is configured');
        }
        const configuredBase = config.baseUrl || (config.testnet
            ? 'https://api-test.tigerex.com'
            : 'https://api.tigerex.com');
        let parsedBase: URL;
        try {
            parsedBase = new URL(configuredBase);
        } catch {
            throw new TypeError('baseUrl must be a valid absolute URL');
        }
        const localHttp = parsedBase.protocol === 'http:' &&
            (parsedBase.hostname === 'localhost' || parsedBase.hostname === '127.0.0.1' || parsedBase.hostname === '::1');
        if (parsedBase.protocol !== 'https:' && !localHttp) {
            throw new TypeError('HTTPS is required for SDK traffic; HTTP is allowed only for loopback development');
        }
        if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
            throw new TypeError('baseUrl must not contain credentials, a query string, or a fragment');
        }
        this.config = { ...config };
        this.baseURL = configuredBase.replace(/\/+$/, '');
        this.timeout = config.timeout ?? 30000;
        if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 120000) {
            throw new RangeError('timeout must be an integer between 1 and 120000 milliseconds');
        }
    }

    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================

    private async request<T = any>(
        method: string,
        endpoint: string,
        params: Record<string, any> = {},
        signed: boolean = false
    ): Promise<T> {
        const timestamp = Date.now();
        const normalizedMethod = method.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(normalizedMethod)) {
            throw new TypeError(`Unsupported HTTP method: ${method}`);
        }
        if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
            throw new TypeError('endpoint must be an absolute path on the configured API origin');
        }

        const requestParams: Record<string, any> = { ...params };
        if (signed) requestParams.timestamp = timestamp;
        const queryString = this.buildQueryString(requestParams);
        const url = `${this.baseURL}${endpoint}${(normalizedMethod === 'GET' || normalizedMethod === 'DELETE') && queryString ? `?${queryString}` : ''}`;
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'TigerEx-Node-SDK/1.0.0',
        };

        if (this.config.apiKey) headers['X-MEX-APIKEY'] = this.config.apiKey;
        if (signed) headers['X-MEX-SIGNATURE'] = this.sign(queryString);

        const bodyParams = (normalizedMethod === 'POST' || normalizedMethod === 'PUT')
            ? JSON.stringify(requestParams)
            : undefined;
        if (bodyParams !== undefined) headers['Content-Length'] = Buffer.byteLength(bodyParams).toString();

        const options: https.RequestOptions = {
            method: normalizedMethod,
            headers,
            timeout: this.timeout,
        };

        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const finishError = (error: Error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const transport = this.baseURL.startsWith('https:') ? https : http;
            const req = transport.request(url, options, (res) => {
                const chunks: Buffer[] = [];
                let totalBytes = 0;
                const maxResponseBytes = 10 * 1024 * 1024;
                res.on('data', (chunk: Buffer | string) => {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    totalBytes += bytes.length;
                    if (totalBytes > maxResponseBytes) {
                        req.destroy(new Error('TigerEx API response exceeded the 10 MiB safety limit'));
                        return;
                    }
                    chunks.push(bytes);
                });
                res.on('end', () => {
                    if (settled) return;
                    settled = true;
                    this.lastResponseTime = Date.now() - timestamp;
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed: any;
                    try {
                        parsed = raw.length ? JSON.parse(raw) : {};
                    } catch {
                        reject(new Error(`TigerEx API returned invalid JSON (HTTP ${res.statusCode ?? 'unknown'})`));
                        return;
                    }
                    if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
                        const message = typeof parsed?.error?.message === 'string'
                            ? parsed.error.message
                            : typeof parsed?.message === 'string'
                                ? parsed.message
                                : `TigerEx API request failed with HTTP ${res.statusCode}`;
                        const error: any = new Error(message);
                        error.statusCode = res.statusCode;
                        error.response = parsed;
                        reject(error);
                        return;
                    }
                    resolve(parsed as T);
                });
                res.on('error', finishError);
            });

            req.on('error', finishError);
            req.on('timeout', () => req.destroy(new Error('TigerEx API request timed out')));
            if (bodyParams !== undefined) req.write(bodyParams);
            req.end();
        });
    }

    private buildQueryString(params: Record<string, any>): string {
        const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
            `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        return Object.keys(params)
            .filter((key) => params[key] !== undefined && params[key] !== null)
            .sort()
            .map((key) => {
                const value = params[key];
                if (typeof value === 'object') {
                    throw new TypeError(`Query parameter "${key}" must be a scalar value`);
                }
                return `${encode(key)}=${encode(String(value))}`;
            })
            .join('&');
    }

    private sign(message: string): string {
        return crypto
            .createHmac('sha256', this.config.apiSecret)
            .update(message)
            .digest('hex');
    }

* TigerEx Node.js SDK
 * Production-grade TypeScript/JavaScript SDK for TigerEx exchange API
 */

import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { EventEmitter } from 'events';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface Config {
    apiKey: string;
    apiSecret: string;
    testnet?: boolean;
    baseUrl?: string;
    timeout?: number;
}

export interface APIResponse<T = any> {
    success: boolean;
    data?: T;
    error?: {
        code: number;
        message: string;
    };
}

// ============================================================================
// CLIENT
// ============================================================================

export class TigerExClient extends EventEmitter {
    private config: Config;
    private baseURL: string;
    private timeout: number;
    private lastResponseTime: number = 0;

    constructor(config: Config) {
        super();
        if (!config || typeof config !== 'object') {
            throw new TypeError('A TigerEx SDK configuration is required');
        }
        if (config.apiKey && !config.apiSecret) {
            throw new TypeError('apiSecret is required when apiKey is configured');
        }
        const configuredBase = config.baseUrl || (config.testnet
            ? 'https://api-test.tigerex.com'
            : 'https://api.tigerex.com');
        let parsedBase: URL;
        try {
            parsedBase = new URL(configuredBase);
        } catch {
            throw new TypeError('baseUrl must be a valid absolute URL');
        }
        const localHttp = parsedBase.protocol === 'http:' &&
            (parsedBase.hostname === 'localhost' || parsedBase.hostname === '127.0.0.1' || parsedBase.hostname === '::1');
        if (parsedBase.protocol !== 'https:' && !localHttp) {
            throw new TypeError('HTTPS is required for SDK traffic; HTTP is allowed only for loopback development');
        }
        if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
            throw new TypeError('baseUrl must not contain credentials, a query string, or a fragment');
        }
        this.config = { ...config };
        this.baseURL = configuredBase.replace(/\\/+$/, '');
        this.timeout = config.timeout ?? 30000;
        if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 120000) {
            throw new RangeError('timeout must be an integer between 1 and 120000 milliseconds');
        }
    }

    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================

    private async request<T = any>(
        method: string,
        endpoint: string,
        params: Record<string, any> = {},
        signed: boolean = false
    ): Promise<T> {
        const timestamp = Date.now();
        const normalizedMethod = method.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(normalizedMethod)) {
            throw new TypeError(`Unsupported HTTP method: ${method}`);
        }
        if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
            throw new TypeError('endpoint must be an absolute path on the configured API origin');
        }

        const requestParams: Record<string, any> = { ...params };
        if (signed) requestParams.timestamp = timestamp;
        const queryString = this.buildQueryString(requestParams);
        const url = `${this.baseURL}${endpoint}${(normalizedMethod === 'GET' || normalizedMethod === 'DELETE') && queryString ? `?${queryString}` : ''}`;
        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'TigerEx-Node-SDK/1.0.0',
        };

        if (this.config.apiKey) headers['X-MEX-APIKEY'] = this.config.apiKey;
        if (signed) headers['X-MEX-SIGNATURE'] = this.sign(queryString);

        const bodyParams = (normalizedMethod === 'POST' || normalizedMethod === 'PUT')
            ? JSON.stringify(requestParams)
            : undefined;
        if (bodyParams !== undefined) headers['Content-Length'] = Buffer.byteLength(bodyParams).toString();

        const options: https.RequestOptions = {
            method: normalizedMethod,
            headers,
            timeout: this.timeout,
        };

        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const finishError = (error: Error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const transport = this.baseURL.startsWith('https:') ? https : http;
            const req = transport.request(url, options, (res) => {
                const chunks: Buffer[] = [];
                let totalBytes = 0;
                const maxResponseBytes = 10 * 1024 * 1024;
                res.on('data', (chunk: Buffer | string) => {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    totalBytes += bytes.length;
                    if (totalBytes > maxResponseBytes) {
                        req.destroy(new Error('TigerEx API response exceeded the 10 MiB safety limit'));
                        return;
                    }
                    chunks.push(bytes);
                });
                res.on('end', () => {
                    if (settled) return;
                    settled = true;
                    this.lastResponseTime = Date.now() - timestamp;
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed: any;
                    try {
                        parsed = raw.length ? JSON.parse(raw) : {};
                    } catch {
                        reject(new Error(`TigerEx API returned invalid JSON (HTTP ${res.statusCode ?? 'unknown'})`));
                        return;
                    }
                    if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
                        const message = typeof parsed?.error?.message === 'string'
                            ? parsed.error.message
                            : typeof parsed?.message === 'string'
                                ? parsed.message
                                : `TigerEx API request failed with HTTP ${res.statusCode}`;
                        const error: any = new Error(message);
                        error.statusCode = res.statusCode;
                        error.response = parsed;
                        reject(error);
                        return;
                    }
                    resolve(parsed as T);
                });
                res.on('error', finishError);
            });

            req.on('error', finishError);
            req.on('timeout', () => req.destroy(new Error('TigerEx API request timed out')));
            if (bodyParams !== undefined) req.write(bodyParams);
            req.end();
        });
    }

    private buildQueryString(params: Record<string, any>): string {
        const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
            `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        return Object.keys(params)
            .filter((key) => params[key] !== undefined && params[key] !== null)
            .sort()
            .map((key) => {
                const value = params[key];
                if (typeof value === 'object') {
                    throw new TypeError(`Query parameter "${key}" must be a scalar value`);
                }
                return `${encode(key)}=${encode(String(value))}`;
            })
            .join('&');
    }

    private sign(message: string): string {
        return crypto
            .createHmac('sha256', this.config.apiSecret)
            .update(message)
            .digest('hex');
    }

    private generateUUID(): string {
        // Node's CSPRNG-backed UUID implementation; never use Math.random()
        // for request identifiers, idempotency keys, or security-sensitive IDs.
        return crypto.randomUUID();
    }

    // =========================================================================
    // MARKET DATA
    // =========================================================================

    async ping(): Promise<APIResponse> {
        return this.request('GET', '/api/v3/ping');
    }

    async time(): Promise<APIResponse<{ serverTime: number }>> {
        return this.request('GET', '/api/v3/time');
    }

    async exchangeInfo(symbol?: string): Promise<APIResponse> {
        const params = symbol ? { symbol } : {};
        return this.request('GET', '/api/v3/exchangeInfo', params);
    }

    async tickerPrice(symbol: string): Promise<APIResponse<{ symbol: string; price: string }>> {
        return this.request('GET', '/api/v3/ticker/price', { symbol });
    }

    async ticker24h(symbol?: string): Promise<APIResponse> {
        const params = symbol ? { symbol } : {};
        return this.request('GET', '/api/v3/ticker/24hr', params);
    }

    async bookTicker(symbol: string): Promise<APIResponse> {
        return this.request('GET', '/api/v3/ticker/bookTicker', { symbol });
    }

    async depth(symbol: string, limit: number = 100): Promise<APIResponse> {
        return this.request('GET', '/api/v3/depth', { symbol, limit });
    }

    async trades(symbol: string, limit: number = 500): Promise<APIResponse> {
        return this.request('GET', '/api/v3/trades', { symbol, limit });
    }

    async klines(symbol: string, interval: string = '1m', limit: number = 500): Promise<APIResponse> {
        return this.request('GET', '/api/v3/klines', { symbol, interval, limit });
    }

    async avgPrice(symbol: string, minutes: number = 5): Promise<APIResponse> {
        return this.request('GET', '/api/v3/avgPrice', { symbol, minutes });
    }

    // =========================================================================
    // ACCOUNT
    // =========================================================================

    async account(): Promise<APIResponse> {
        return this.request('GET', '/api/v3/account', {}, true);
    }

    async myTrades(symbol: string, options: {
        startTime?: number;
        endTime?: number;
        limit?: number;
    } = {}): Promise<APIResponse> {
        return this.request('GET', '/api/v3/myTrades', { symbol, ...options }, true);
    }

    // =========================================================================
    // ORDERS
    // =========================================================================

    async order(symbol: string, orderId?: number, origClientOrderId?: string): Promise<APIResponse> {
        const params: any = { symbol };
        if (orderId) params.orderId = orderId;
        if (origClientOrderId) params.origClientOrderId = origClientOrderId;
        return this.request('GET', '/api/v3/order', params, true);
    }

    async openOrders(symbol?: string): Promise<APIResponse> {
        const params = symbol ? { symbol } : {};
        return this.request('GET', '/api/v3/openOrders', params, true);
    }

    async allOrders(symbol: string, options: {
        startTime?: number;
        endTime?: number;
        limit?: number;
    } = {}): Promise<APIResponse> {
        return this.request('GET', '/api/v3/allOrders', { symbol, ...options }, true);
    }

    async createOrder(order: {
        symbol: string;
        side: 'BUY' | 'SELL';
        type: 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'STOP_LIMIT';
        quantity: number;
        price?: number;
        stopPrice?: number;
        timeInForce?: 'GTC' | 'IOC' | 'FOK';
        newClientOrderId?: string;
    }): Promise<APIResponse> {
        return this.request('POST', '/api/v3/order', order, true);
    }

    async cancelOrder(symbol: string, orderId?: number, origClientOrderId?: string): Promise<APIResponse> {
        const params: any = { symbol };
        if (orderId) params.orderId = orderId;
        if (origClientOrderId) params.origClientOrderId = origClientOrderId;
        return this.request('DELETE', '/api/v3/order', params, true);
    }

    // =========================================================================
    // CONVENIENCE METHODS
    // =========================================================================

    async buyLimit(symbol: string, quantity: number, price: number, options: any = {}): Promise<APIResponse> {
        return this.createOrder({
            symbol,
            side: 'BUY',
            type: 'LIMIT',
            quantity,
            price,
            ...options,
        });
    }

    async sellLimit(symbol: string, quantity: number, price: number, options: any = {}): Promise<APIResponse> {
        return this.createOrder({
            symbol,
            side: 'SELL',
            type: 'LIMIT',
            quantity,
            price,
            ...options,
        });
    }

    async buyMarket(symbol: string, quantity: number, options: any = {}): Promise<APIResponse> {
        return this.createOrder({
            symbol,
            side: 'BUY',
            type: 'MARKET',
            quantity,
            ...options,
        });
    }

    async sellMarket(symbol: string, quantity: number, options: any = {}): Promise<APIResponse> {
        return this.createOrder({
            symbol,
            side: 'SELL',
            type: 'MARKET',
            quantity,
            ...options,
        });
    }

    // =========================================================================
    // WALLET
    // =========================================================================

    async depositAddress(coin: string, network?: string): Promise<APIResponse> {
        const params: any = { coin };
        if (network) params.network = network;
        return this.request('GET', '/api/v3/deposit/address', params, true);
    }

    async depositHistory(options: {
        coin?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
    } = {}): Promise<APIResponse> {
        return this.request('GET', '/api/v3/deposit/history', options, true);
    }

    async withdraw(coin: string, address: string, amount: number, network?: string, options: any = {}): Promise<APIResponse> {
        const params: any = { coin, address, amount, ...options };
        if (network) params.network = network;
        return this.request('POST', '/api/v3/withdraw/apply', params, true);
    }

    async withdrawHistory(options: {
        coin?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
    } = {}): Promise<APIResponse> {
        return this.request('GET', '/api/v3/withdraw/history', options, true);
    }

    // =========================================================================
    // MARGIN
    // =========================================================================

    async marginAccount(): Promise<APIResponse> {
        return this.request('GET', '/sapi/v3/margin/account', {}, true);
    }

    async createMarginOrder(order: any): Promise<APIResponse> {
        return this.request('POST', '/sapi/v3/margin/order', order, true);
    }

    async marginOrder(symbol: string, orderId?: number): Promise<APIResponse> {
        const params: any = { symbol };
        if (orderId) params.orderId = orderId;
        return this.request('GET', '/sapi/v3/margin/order', params, true);
    }

    async marginTrades(symbol: string): Promise<APIResponse> {
        return this.request('GET', '/sapi/v3/margin/myTrades', { symbol }, true);
    }

    // =========================================================================
    // FUTURES
    // =========================================================================

    async futuresAccount(): Promise<APIResponse> {
        return this.request('GET', '/fapi/v3/account', {}, true);
    }

    async futuresPosition(symbol?: string): Promise<APIResponse> {
        const params = symbol ? { symbol } : {};
        return this.request('GET', '/fapi/v3/position', params, true);
    }

    async createFuturesOrder(order: any): Promise<APIResponse> {
        return this.request('POST', '/fapi/v3/order', order, true);
    }

    async futuresOrder(symbol: string, orderId?: number): Promise<APIResponse> {
        const params: any = { symbol };
        if (orderId) params.orderId = orderId;
        return this.request('GET', '/fapi/v3/order', params, true);
    }

    // =========================================================================
    // STAKING
    // =========================================================================

    async stakingStakes(product: string): Promise<APIResponse> {
        return this.request('GET', '/sapi/v1/staking/position', { product }, true);
    }

    async stakingSubscribe(product: string, amount: number, asset: string): Promise<APIResponse> {
        return this.request('POST', '/sapi/v1/staking/subscribe', { product, amount, asset }, true);
    }

    async stakingRedeem(product: string, amount: number, asset: string): Promise<APIResponse> {
        return this.request('POST', '/sapi/v1/staking/redeem', { product, amount, asset }, true);
    }
}

// ============================================================================
// WEBSOCKET CLIENT
// ============================================================================

export class WebSocketClient extends EventEmitter {
    private ws: any = null;
    private url: string;
    private subscriptions: Set<string> = new Set();
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 5000;
    private isConnected: boolean = false;

    constructor(options: {
        testnet?: boolean;
        apiKey?: string;
    } = {}) {
        super();
        this.url = options.testnet 
            ? 'wss://stream-test.tigerex.com/ws'
            : 'wss://stream.tigerex.com/ws';
        
        if (options.apiKey) {
            // Keep query credentials correctly encoded. Prefer server-side auth tokens
            // for private streams where the exchange supports them.
            this.url += `?apiKey=${encodeURIComponent(options.apiKey)}`;
        }
    }

    connect(): void {
        try {
            // In browser environment, use native WebSocket
            if (typeof window !== 'undefined') {
                this.ws = new (window as any).WebSocket(this.url);
            } else {
                // Never report a successful connection without a real WebSocket transport.
                this.isConnected = false;
                this.emit('error', new Error('Node.js WebSocket transport is not configured. Install and wire a supported WebSocket implementation before connecting.'));
                return;
            }

            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.emit('open');
                
                // Resubscribe to previous streams
                if (this.subscriptions.size > 0) {
                    this.subscribe(Array.from(this.subscriptions));
                }
            };

            this.ws.onmessage = (event: any) => {
                try {
                    const data = JSON.parse(event.data);
                    this.emit('message', data);
                    
                    // Emit specific event types
                    if (data.e) {
                        this.emit(data.e, data);
                    }
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };

            this.ws.onerror = (error: any) => {
                this.emit('error', error);
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                this.emit('close');
                this.reconnect();
            };
        } catch (error) {
            console.error('WebSocket connection error:', error);
        }
    }

    private reconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
                this.connect();
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    subscribe(streams: string[]): void {
        streams.forEach(s => this.subscriptions.add(s));
        
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: streams,
                id: Date.now(),
            }));
        }
    }

    unsubscribe(streams: string[]): void {
        streams.forEach(s => this.subscriptions.delete(s));
        
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: streams,
                id: Date.now(),
            }));
        }
    }

    isConnected(): boolean {
        return this.isConnected;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createClient(config: Config): TigerExClient {
    return new TigerExClient(config);
}

export function createWebSocketClient(options?: any): WebSocketClient {
    return new WebSocketClient(options);
}

// ============================================================================
// VERSION
// ============================================================================

export const VERSION = '1.0.0';

export default {
    TigerExClient,
    WebSocketClient,
    createClient,
    createWebSocketClient,
    VERSION,
};