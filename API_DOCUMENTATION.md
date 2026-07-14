# TigerEx API Documentation

**Version**: 2.0.0  
**Base URL**: `https://api.tigerex.io/api/v1` (or `http://localhost:8080/api/v1` for development)  
**Authentication**: JWT Bearer Token

---

## Table of Contents

1. [Authentication](#authentication)
2. [Wallet Endpoints](#wallet-endpoints)
3. [Trading Endpoints](#trading-endpoints)
4. [Futures Endpoints](#futures-endpoints)
5. [KYC Endpoints](#kyc-endpoints)
6. [Payment Endpoints](#payment-endpoints)
7. [Staking Endpoints](#staking-endpoints)
8. [Trading Bots](#trading-bots)
9. [Admin Endpoints](#admin-endpoints)
10. [Webhooks](#webhooks)

---

## Authentication

All endpoints (except public ones) require JWT authentication.

**Header Format:**
```
Authorization: Bearer {access_token}
```

### Register

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "username",
  "password": "password123",
  "referralCode": "optional"
}

Response (201):
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "username",
      "kycLevel": 0
    },
    "accessToken": "jwt_token",
    "refreshToken": "jwt_token",
    "referralCode": "REF123ABC"
  }
}
```

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response (200):
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "username",
      "kycLevel": 2,
      "emailVerified": true,
      "twoFactorEnabled": false
    },
    "accessToken": "jwt_token",
    "refreshToken": "jwt_token"
  }
}
```

### Get Current User

```http
GET /auth/me
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "username",
    "kycLevel": 2,
    "country": "US",
    "createdAt": "2026-07-14T12:00:00Z"
  }
}
```

---

## Wallet Endpoints

### Get Balance

```http
GET /wallet/balance
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "data": {
    "balances": [
      {
        "asset": "USDT",
        "free": "1000.50",
        "locked": "500.00",
        "total": "1500.50"
      },
      {
        "asset": "BTC",
        "free": "0.25",
        "locked": "0.05",
        "total": "0.30"
      }
    ]
  }
}
```

---

## Trading Endpoints

### Get Exchange Info

```http
GET /exchange/info

Response (200):
{
  "success": true,
  "data": [
    {
      "symbol": "BTCUSDT",
      "base_asset": "BTC",
      "quote_asset": "USDT",
      "status": "trading",
      "maker_fee": 0.001,
      "taker_fee": 0.001
    },
    // ... 85+ more pairs
  ]
}
```

### Get Ticker

```http
GET /ticker/24hr?symbol=BTCUSDT

Response (200):
{
  "success": true,
  "data": {
    "symbol": "BTCUSDT",
    "lastPrice": "65000.00",
    "priceChange": "1500.00",
    "priceChangePercent": "2.36",
    "highPrice": "65750.00",
    "lowPrice": "63500.00",
    "volume": "150.50",
    "quoteVolume": "9787500.00"
  }
}
```

### Place Order

```http
POST /order
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "side": "buy",
  "type": "limit",
  "quantity": "0.5",
  "price": "64500.00"
}

Response (200):
{
  "success": true,
  "data": {
    "orderId": "uuid",
    "symbol": "BTCUSDT",
    "side": "buy",
    "type": "limit",
    "price": "64500.00",
    "quantity": "0.5",
    "filledQuantity": "0.5",
    "status": "filled",
    "createdAt": "2026-07-14T12:00:00Z"
  }
}
```

### Get Open Orders

```http
GET /openOrders?symbol=BTCUSDT
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "data": [
    {
      "orderId": "uuid",
      "symbol": "BTCUSDT",
      "side": "buy",
      "type": "limit",
      "price": 64500,
      "origQty": 0.5,
      "executedQty": 0.25,
      "remainingQty": 0.25,
      "status": "partially_filled",
      "createdTime": 1689340800000
    }
  ]
}
```

---

## Futures Endpoints

### Create Futures Order

```http
POST /futures/order
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "side": "long",
  "type": "market",
  "quantity": "1",
  "leverage": "10"
}

Response (200):
{
  "success": true,
  "data": {
    "orderId": "uuid",
    "symbol": "BTCUSDT",
    "side": "long",
    "quantity": "1",
    "leverage": "10",
    "marginRequired": "6500.00",
    "estimatedLiquidationPrice": "58500.00"
  }
}
```

### Get Futures Positions

```http
GET /futures/positions
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "symbol": "BTCUSDT",
      "side": "long",
      "quantity": 1,
      "entryPrice": 65000,
      "currentPrice": 65500,
      "liquidationPrice": 58500,
      "leverage": 10,
      "unrealizedPnL": "500.00",
      "marginUsed": "6500.00",
      "status": "open"
    }
  ]
}
```

### Set TP/SL

```http
POST /futures/tp-sl
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "side": "long",
  "takeProfitPrice": "67000",
  "stopLossPrice": "63000"
}

Response (200):
{
  "success": true,
  "message": "TP/SL orders created"
}
```

---

## KYC Endpoints

### Submit KYC

```http
POST /kyc/submit
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "1990-01-15",
  "nationality": "US",
  "documentType": "passport",
  "documentNumber": "ABC123456",
  "address": "123 Main St",
  "city": "New York",
  "country": "US",
  "postalCode": "10001"
}

Response (200):
{
  "success": true,
  "data": {
    "submissionId": "uuid",
    "status": "pending",
    "amlRiskLevel": "low",
    "message": "KYC submission received. Manual review in progress."
  }
}
```

### Get KYC Status

```http
GET /kyc/status
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "data": {
    "kycLevel": 2,
    "levelName": "Intermediate KYC",
    "description": "ID verification complete",
    "status": "verified",
    "limits": {
      "dailyWithdrawal": 5000,
      "dailyDeposit": 20000,
      "dailyTrading": 100000
    },
    "aml": {
      "riskLevel": "low",
      "pepStatus": "not_listed",
      "sanctionsStatus": "not_listed"
    },
    "requirements": ["email_verified", "personal_info", "id_verified"]
  }
}
```

---

## Payment Endpoints

### Get Payment Methods

```http
GET /payment/methods
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "methodType": "bank_transfer",
      "provider": "stripe",
      "accountHolder": "John Doe",
      "bank_name": "Bank of America",
      "status": "active",
      "verified": true,
      "createdAt": "2026-07-14T12:00:00Z"
    }
  ]
}
```

### Deposit Fiat

```http
POST /deposit/fiat
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "currency": "USD",
  "amount": 1000,
  "provider": "stripe",
  "methodId": "uuid"
}

Response (200):
{
  "success": true,
  "data": {
    "depositId": "uuid",
    "referenceCode": "DEP-1689340800-ABC123",
    "status": "pending",
    "amount": "1000",
    "fee": "29.00",
    "netCredit": "971.00",
    "provider": "stripe",
    "estimatedCompletion": "1-2 business days"
  }
}
```

### Withdraw Crypto

```http
POST /withdraw/crypto
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "currency": "BTC",
  "amount": 0.5,
  "address": "1A1z7agoat..."
}

Response (200):
{
  "success": true,
  "data": {
    "withdrawalId": "uuid",
    "referenceCode": "WD-1689340800-XYZ789",
    "status": "pending",
    "amount": "0.5",
    "networkFee": "0.0005",
    "netAmount": "0.4995",
    "destination": "1A1z7agoat...",
    "estimatedConfirmation": "10-30 minutes",
    "network": "Bitcoin"
  }
}
```

---

## Staking Endpoints

### Get Staking Products

```http
GET /staking/products

Response (200):
{
  "success": true,
  "data": [
    {
      "asset": "BTC",
      "name": "Bitcoin Staking",
      "minAmount": 0.001,
      "rates": {
        "flexible": "2%",
        "30days": "4%",
        "90days": "8%",
        "180days": "12%",
        "365days": "15%"
      }
    }
  ]
}
```

### Start Staking

```http
POST /staking/start
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "asset": "BTC",
  "amount": 1.5,
  "lockDays": 90
}

Response (200):
{
  "success": true,
  "data": {
    "positionId": "uuid",
    "asset": "BTC",
    "amount": "1.5",
    "rate": "8.00%",
    "lockDays": 90,
    "estimatedDaily": "0.00329"
  }
}
```

---

## Trading Bots

### Create Bot

```http
POST /bots/create
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "botType": "GRID",
  "symbol": "BTCUSDT",
  "gridCount": 10,
  "minPrice": 60000,
  "maxPrice": 70000,
  "investAmount": 5000
}

Response (200):
{
  "success": true,
  "data": {
    "botId": "uuid",
    "name": "Grid-BTCUSDT",
    "symbol": "BTCUSDT",
    "gridCount": 10,
    "investAmount": "5000",
    "gridPrices": ["60000", "61111", "62222", ...]
  }
}
```

### Start Bot

```http
POST /bots/{botId}/start
Authorization: Bearer {access_token}

Response (200):
{
  "success": true,
  "message": "Bot started"
}
```

---

## Admin Endpoints

### Get Dashboard

```http
GET /admin/dashboard
Authorization: Bearer {admin_token}

Response (200):
{
  "success": true,
  "data": {
    "metrics": {
      "totalUsers": 5234,
      "activeUsers": 1823,
      "totalVolume24h": 125000000,
      "totalTrades": 45678,
      "totalDeposits": 2500000,
      "totalWithdrawals": 1800000
    },
    "database": {
      "users": 5234,
      "trades": 45678,
      "orders": 12345,
      "wallets": 28904
    }
  }
}
```

---

## Webhooks

### Create Webhook

```http
POST /webhooks
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "url": "https://myapp.com/webhook",
  "events": ["order.created", "trade.executed", "balance.updated"],
  "headers": {
    "X-Custom-Header": "value"
  }
}

Response (200):
{
  "success": true,
  "data": {
    "webhookId": "uuid",
    "apiKey": "webhook_key_xyz",
    "url": "https://myapp.com/webhook",
    "events": ["order.created", "trade.executed", "balance.updated"]
  }
}
```

### Webhook Event Format

All webhook events include:

```json
{
  "event": "order.created",
  "timestamp": "2026-07-14T12:00:00Z",
  "data": {
    "orderId": "uuid",
    "symbol": "BTCUSDT",
    "side": "buy",
    "quantity": "0.5"
  },
  "signature": "hmac_sha256_signature"
}
```

---

## Error Handling

All errors return appropriate HTTP status codes:

```http
Response (400):
{
  "success": false,
  "error": "Invalid order parameters"
}

Response (401):
{
  "success": false,
  "error": "Invalid token"
}

Response (403):
{
  "success": false,
  "error": "Not authorized"
}

Response (404):
{
  "success": false,
  "error": "Resource not found"
}

Response (500):
{
  "success": false,
  "error": "Internal server error"
}
```

---

## Rate Limiting

- **Limit**: 1000 requests per 15 minutes
- **Rate Limit Header**: `X-RateLimit-Remaining`
- **Reset Time Header**: `X-RateLimit-Reset`

---

## WebSocket (Real-time Updates)

Connect to: `wss://api.tigerex.io` (or `ws://localhost:8080` for development)

```javascript
const socket = io('http://localhost:8080');

// Authenticate
socket.emit('authenticate', { token: 'access_token' });

// Listen for events
socket.on('order.updated', (data) => {
  console.log('Order updated:', data);
});

socket.on('trade.executed', (data) => {
  console.log('Trade executed:', data);
});
```

---

## SDK Examples

### JavaScript/TypeScript

```typescript
import { TigerExAPI } from 'tigerex-sdk';

const client = new TigerExAPI({
  baseURL: 'https://api.tigerex.io',
  apiKey: 'your_api_key'
});

// Register
const user = await client.auth.register({
  email: 'user@example.com',
  username: 'username',
  password: 'password'
});

// Place order
const order = await client.trading.placeOrder({
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'limit',
  quantity: 0.5,
  price: 65000
});

// Get balance
const balance = await client.wallet.getBalance();
```

---

## Changelog

### v2.0.0 (2026-07-14)
- Added futures trading with leverage
- Added KYC/AML system
- Added payment gateway integration
- Added trading bots and automation
- Added staking products
- Added admin dashboard
- Added webhooks and integrations

### v1.0.0 (2026-06-15)
- Initial release with spot trading
- 86 trading pairs
- Real order matching engine
- JWT authentication
