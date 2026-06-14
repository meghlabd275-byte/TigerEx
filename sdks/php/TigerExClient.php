<?php
/**
 * TigerEx PHP SDK
 * Production-grade PHP SDK for TigerEx exchange API
 */

namespace TigerEx\SDK;

class TigerExClient
{
    private $apiKey;
    private $apiSecret;
    private $baseUrl;
    private $timeout;
    private $testnet;

    public function __construct(
        string $apiKey = '',
        string $apiSecret = '',
        bool $testnet = false,
        int $timeout = 30000
    ) {
        $this->apiKey = $apiKey;
        $this->apiSecret = $apiSecret;
        $this->testnet = $testnet;
        $this->baseUrl = $testnet 
            ? 'https://api-test.tigerex.com' 
            : 'https://api.tigerex.com';
        $this->timeout = $timeout;
    }

    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================

    private function sign(string $message): string
    {
        return hash_hmac('sha256', $message, $this->apiSecret);
    }

    private function buildQueryString(array $params): string
    {
        ksort($params);
        $query = http_build_query($params, '', '&');
        return $query;
    }

    private function request(
        string $method,
        string $endpoint,
        array $params = [],
        bool $signed = false
    ): array {
        $timestamp = round(microtime(true) * 1000);
        $queryString = $this->buildQueryString($params);

        $url = $this->baseUrl . $endpoint;
        if ($method === 'GET' && !empty($queryString)) {
            $url .= '?' . $queryString;
        }

        $headers = [
            'Content-Type: application/json',
            'User-Agent: TigerEx-PHP-SDK/1.0.0',
        ];

        if (!empty($this->apiKey)) {
            $headers[] = 'X-MEX-APIKEY: ' . $this->apiKey;
        }

        if ($signed) {
            $signature = $this->sign($queryString . '&timestamp=' . $timestamp);
            $headers[] = 'X-MEX-SIGNATURE: ' . $signature;
        }

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT_MS, $this->timeout);

        if ($method === 'POST' || $method === 'PUT') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($params));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            throw new \Exception('cURL Error: ' . $error);
        }

        return json_decode($response, true);
    }

    // =========================================================================
    // MARKET DATA
    // =========================================================================

    public function ping(): array
    {
        return $this->request('GET', '/api/v3/ping');
    }

    public function time(): array
    {
        return $this->request('GET', '/api/v3/time');
    }

    public function exchangeInfo(string $symbol = ''): array
    {
        return $this->request('GET', '/api/v3/exchangeInfo', [
            'symbol' => $symbol,
        ]);
    }

    public function tickerPrice(string $symbol): array
    {
        return $this->request('GET', '/api/v3/ticker/price', [
            'symbol' => $symbol,
        ]);
    }

    public function ticker24h(string $symbol = ''): array
    {
        return $this->request('GET', '/api/v3/ticker/24hr', [
            'symbol' => $symbol,
        ]);
    }

    public function bookTicker(string $symbol): array
    {
        return $this->request('GET', '/api/v3/ticker/bookTicker', [
            'symbol' => $symbol,
        ]);
    }

    public function depth(string $symbol, int $limit = 100): array
    {
        return $this->request('GET', '/api/v3/depth', [
            'symbol' => $symbol,
            'limit' => $limit,
        ]);
    }

    public function trades(string $symbol, int $limit = 500): array
    {
        return $this->request('GET', '/api/v3/trades', [
            'symbol' => $symbol,
            'limit' => $limit,
        ]);
    }

    public function klines(string $symbol, string $interval = '1m', int $limit = 500): array
    {
        return $this->request('GET', '/api/v3/klines', [
            'symbol' => $symbol,
            'interval' => $interval,
            'limit' => $limit,
        ]);
    }

    public function avgPrice(string $symbol, int $minutes = 5): array
    {
        return $this->request('GET', '/api/v3/avgPrice', [
            'symbol' => $symbol,
            'minutes' => $minutes,
        ]);
    }

    // =========================================================================
    // ACCOUNT
    // =========================================================================

    public function account(): array
    {
        return $this->request('GET', '/api/v3/account', [], true);
    }

    public function myTrades(string $symbol, array $options = []): array
    {
        $params = array_merge(['symbol' => $symbol], $options);
        return $this->request('GET', '/api/v3/myTrades', $params, true);
    }

    // =========================================================================
    // ORDERS
    // =========================================================================

    public function order(string $symbol, int $orderId = null, string $origClientOrderId = null): array
    {
        $params = ['symbol' => $symbol];
        if ($orderId) $params['orderId'] = $orderId;
        if ($origClientOrderId) $params['origClientOrderId'] = $origClientOrderId;
        return $this->request('GET', '/api/v3/order', $params, true);
    }

    public function openOrders(string $symbol = ''): array
    {
        return $this->request('GET', '/api/v3/openOrders', [
            'symbol' => $symbol,
        ], true);
    }

    public function allOrders(string $symbol, array $options = []): array
    {
        $params = array_merge(['symbol' => $symbol], $options);
        return $this->request('GET', '/api/v3/allOrders', $params, true);
    }

    public function createOrder(array $order): array
    {
        return $this->request('POST', '/api/v3/order', $order, true);
    }

    public function cancelOrder(string $symbol, int $orderId = null, string $origClientOrderId = null): array
    {
        $params = ['symbol' => $symbol];
        if ($orderId) $params['orderId'] = $orderId;
        if ($origClientOrderId) $params['origClientOrderId'] = $origClientOrderId;
        return $this->request('DELETE', '/api/v3/order', $params, true);
    }

    // =========================================================================
    // CONVENIENCE METHODS
    // =========================================================================

    public function buyLimit(string $symbol, float $quantity, float $price, array $options = []): array
    {
        return $this->createOrder(array_merge([
            'symbol' => $symbol,
            'side' => 'BUY',
            'type' => 'LIMIT',
            'quantity' => $quantity,
            'price' => $price,
        ], $options));
    }

    public function sellLimit(string $symbol, float $quantity, float $price, array $options = []): array
    {
        return $this->createOrder(array_merge([
            'symbol' => $symbol,
            'side' => 'SELL',
            'type' => 'LIMIT',
            'quantity' => $quantity,
            'price' => $price,
        ], $options));
    }

    public function buyMarket(string $symbol, float $quantity, array $options = []): array
    {
        return $this->createOrder(array_merge([
            'symbol' => $symbol,
            'side' => 'BUY',
            'type' => 'MARKET',
            'quantity' => $quantity,
        ], $options));
    }

    public function sellMarket(string $symbol, float $quantity, array $options = []): array
    {
        return $this->createOrder(array_merge([
            'symbol' => $symbol,
            'side' => 'SELL',
            'type' => 'MARKET',
            'quantity' => $quantity,
        ], $options));
    }

    // =========================================================================
    // WALLET
    // =========================================================================

    public function depositAddress(string $coin, string $network = ''): array
    {
        $params = ['coin' => $coin];
        if ($network) $params['network'] = $network;
        return $this->request('GET', '/api/v3/deposit/address', $params, true);
    }

    public function depositHistory(array $options = []): array
    {
        return $this->request('GET', '/api/v3/deposit/history', $options, true);
    }

    public function withdraw(string $coin, string $address, float $amount, string $network = ''): array
    {
        $params = [
            'coin' => $coin,
            'address' => $address,
            'amount' => $amount,
        ];
        if ($network) $params['network'] = $network;
        return $this->request('POST', '/api/v3/withdraw/apply', $params, true);
    }

    public function withdrawHistory(array $options = []): array
    {
        return $this->request('GET', '/api/v3/withdraw/history', $options, true);
    }

    // =========================================================================
    // MARGIN
    // =========================================================================

    public function marginAccount(): array
    {
        return $this->request('GET', '/sapi/v3/margin/account', [], true);
    }

    public function createMarginOrder(array $order): array
    {
        return $this->request('POST', '/sapi/v3/margin/order', $order, true);
    }

    // =========================================================================
    // FUTURES
    // =========================================================================

    public function futuresAccount(): array
    {
        return $this->request('GET', '/fapi/v3/account', [], true);
    }

    public function futuresPosition(string $symbol = ''): array
    {
        return $this->request('GET', '/fapi/v3/position', [
            'symbol' => $symbol,
        ], true);
    }

    public function createFuturesOrder(array $order): array
    {
        return $this->request('POST', '/fapi/v3/order', $order, true);
    }

    // =========================================================================
    // STAKING
    // =========================================================================

    public function stakingStakes(string $product): array
    {
        return $this->request('GET', '/sapi/v1/staking/position', [
            'product' => $product,
        ], true);
    }

    public function stakingSubscribe(string $product, float $amount, string $asset): array
    {
        return $this->request('POST', '/sapi/v1/staking/subscribe', [
            'product' => $product,
            'amount' => $amount,
            'asset' => $asset,
        ], true);
    }

    public function stakingRedeem(string $product, float $amount, string $asset): array
    {
        return $this->request('POST', '/sapi/v1/staking/redeem', [
            'product' => $product,
            'amount' => $amount,
            'asset' => $asset,
        ], true);
    }
}

// ============================================================================
// WEBSOCKET CLIENT
// ============================================================================

class WebSocketClient
{
    private $ws;
    private $url;
    private $subscriptions = [];
    private $connected = false;

    public function __construct(bool $testnet = false, string $apiKey = '')
    {
        $this->url = ($testnet ? 'wss://stream-test.tigerex.com/ws' : 'wss://stream.tigerex.com/ws');
        if ($apiKey) {
            $this->url .= '?apiKey=' . $apiKey;
        }
    }

    public function connect(): bool
    {
        $this->ws = @fsockopen(
            parse_url($this->url, PHP_URL_HOST),
            parse_url($this->url, PHP_URL_PORT) ?: 443,
            $errno,
            $errstr,
            5
        );

        if (!$this->ws) {
            return false;
        }

        stream_set_blocking($this->ws, false);
        $this->connected = true;
        return true;
    }

    public function disconnect(): void
    {
        if ($this->ws) {
            fclose($this->ws);
            $this->ws = null;
        }
        $this->connected = false;
    }

    public function subscribe(array $streams): void
    {
        $this->send([
            'method' => 'SUBSCRIBE',
            'params' => $streams,
            'id' => time(),
        ]);
        $this->subscriptions = array_merge($this->subscriptions, $streams);
    }

    public function unsubscribe(array $streams): void
    {
        $this->send([
            'method' => 'UNSUBSCRIBE',
            'params' => $streams,
            'id' => time(),
        ]);
        $this->subscriptions = array_diff($this->subscriptions, $streams);
    }

    private function send(array $data): void
    {
        if ($this->ws) {
            fwrite($this->ws, json_encode($data) . "\n");
        }
    }

    public function isConnected(): bool
    {
        return $this->connected;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

function createClient(
    string $apiKey = '',
    string $apiSecret = '',
    bool $testnet = false
): TigerExClient {
    return new TigerExClient($apiKey, $apiSecret, $testnet);
}

function createWebSocketClient(bool $testnet = false, string $apiKey = ''): WebSocketClient
{
    return new WebSocketClient($testnet, $apiKey);
}

// ============================================================================
// VERSION
// ============================================================================

const VERSION = '1.0.0';