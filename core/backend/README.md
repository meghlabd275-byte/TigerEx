# TigerEx Enterprise Backend Microservices
## Go-based High-Performance Backend Services

### Running Services
```bash
cd server && go run cmd/main.go
```

### API Endpoints

#### Unified Auth (Smart Email/Phone Detection)
- POST /api/v1/auth/register - Smart register with auto email/phone detection
- POST /api/v1/auth/login - Smart login with auto detection
- POST /api/v1/auth/reset-password - Password reset with auto detection
- POST /api/v1/auth/2fa/reset - 2FA reset with verification

#### Trading
- POST /api/v1/spot/orders - Place orders
- GET /api/v1/spot/orderbook/:symbol - Order book
- GET /api/v1/spot/klines/:symbol - Charts

#### Wallet
- GET /api/v1/wallet/balances - All balances
- POST /api/v1/wallet/deposit - Deposit
- POST /api/v1/wallet/withdraw - Withdraw
- POST /api/v1/wallet/transfer - Internal transfer

#### Admin (/admin)
- Full admin system already implemented

### Performance
- 2M+ TPS matching engine (C++)
- <10ms latency
- Horizontal scaling ready