# TigerEx Trading Platform Specification

## Project Overview
- **Project Name:** TigerEx
- **Type:** Cryptocurrency Exchange Trading Platform
- **Core Functionality:** Full-featured trading platform with spot, futures, margin, options, P2P, DeFi products, and wallet management
- **Target Users:** Traders (non-admin users) seeking professional crypto trading tools
- **Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS

---

## User/Trader Features Specification

### 1. Trading Features

#### 1.1 Spot Trading (`/trade/[symbol]`)
- Market/Limit orders with real-time execution
- Order book with bid/ask levels
- Trading charts (TradingView integration)
- Recent trades feed
- Open orders management
- Order history

#### 1.2 Markets (`/markets`)
- Complete market overview
- Price charts, volume, 24h change
- Search and filter pairs
- Market cap, circulating supply

#### 1.3 Alpha Trading (`/alpha`)
- New token listings
- Alpha opportunities
- Early trading signals
- Token launch information

#### 1.4 Futures (`/futures`)
- USDT-M futures
- COIN-M futures
- Perpetual contracts
- Leverage slider (1-125x)
- Position management
- Funding rates display

#### 1.5 Margin Trading (`/margin`)
- Cross margin mode
- Isolated margin mode
- Margin calculator
- Liquidation warnings
- Borrow/Lend functionality

#### 1.6 Options (`/options`)
- Call options
- Put options
- Expiry dates
- Strike prices
- Greeks display
- Option chain

#### 1.7 P2P Trading (`/p2p`)
- Buy/Sell crypto with fiat
- Multiple payment methods
- Escrow protection
- Dispute resolution
- User ratings

#### 1.8 TradFi (`/tradfi`)
- Stocks CFD trading
- Indices trading
- Forex pairs
- Commodity CFDs

#### 1.9 Quick Trade (`/quick-trade`)
- One-click trading
- Favorite pairs
- Quick amounts

#### 1.10 Pre-market (`/premarket`)
- Pre-IPO token sales
- IEO platform
- Token allocation

### 2. DeFi & Earn Features

#### 2.1 Earn Products (`/earn`)
- Overview of all earn products
- APY/APR display
- Lock periods

#### 2.2 Staking (`/earn/staking`)
- Flexible staking
- Locked staking
- Staking rewards
- Validator info

#### 2.3 Launchpad (`/earn/launchpad`)
- Token sales
- Allocation system
- Sale milestones

#### 2.4 Launch Pool (`/earn/launchpool`)
- Yield farming
- Token rewards
- Farm pairs

#### 2.5 Liquidity Mining (`/earn/liquidity-mining`)
- LP rewards
- Pool TVL
- Impermanent loss protection

#### 2.6 Cloud Mining (`/earn/cloud-mining`)
- Hashrate packages
- Mining contracts
- Daily rewards

#### 2.7 ETF Trading (`/earn/etf`)
- ETF listings
- Real-time pricing
- Portfolio tracking

### 3. Wallet Features

#### 3.1 Wallet Overview (`/wallet`)
- Total balance display
- Asset allocation
- PnL tracking

#### 3.2 Deposit (`/wallet/deposit`)
- Crypto deposits
- Network selection
- QR code display
- Address copy

#### 3.3 Withdraw (`/wallet/withdraw`)
- Crypto withdrawals
- Network fees
- Withdrawal limits

#### 3.4 Transfer (`/wallet/transfer`)
- Internal transfers
- External transfers
- Transfer history

#### 3.5 History (`/wallet/history`)
- Transaction history
- Filter by type
- Export functionality

#### 3.6 Addresses (`/wallet/addresses`)
- Address book
- Labels
- Multiple chains

### 4. Auth Features

#### 4.1 Login (`/login`)
- Email/password login
- Social login buttons
- Remember me

#### 4.2 Register (`/register`)
- Email registration
- Password requirements
- Referral code

#### 4.3 2FA (`/2fa`)
- Google Authenticator
- SMS verification
- Backup codes

#### 4.4 KYC (`/kyc`)
- ID verification
- Selfie verification
- Proof of address

### 5. Utility Features

#### 5.1 Convert (`/convert`)
- Instant conversion
- Rate display
- Conversion history

#### 5.2 Coupons (`/coupons`)
- Coupon claiming
- Coupon redemption
- Active coupons

#### 5.3 Red Packets (`/redpacket`)
- Create red packets
- Random/fixed amounts
- Distribution tracking

---

## UI/UX Specification

### Design System
- **Primary Color:** #FF6B35 (Tiger Orange)
- **Background:** #0A0A0F (Deep Black)
- **Surface:** #14141A (Card Background)
- **Text Primary:** #FFFFFF
- **Text Secondary:** #9CA3AF
- **Accent:** #10B981 (Success Green)
- **Error:** #EF4444 (Error Red)
- **Border:** rgba(255,255,255,0.1)

### Typography
- **Headings:** Inter Bold
- **Body:** Inter Regular
- **Monospace:** JetBrains Mono (for numbers)

### Components
- Buttons: Primary (orange), Secondary (outline), Ghost
- Cards: Rounded corners (12px), subtle borders
- Tables: Striped rows, hover effects
- Forms: Floating labels, validation states
- Charts: TradingView-style with orange/green colors

---

## Acceptance Criteria

### Trading
- [ ] All order types execute correctly
- [ ] Order book updates in real-time
- [ ] Charts render with live data
- [ ] Positions track correctly

### Wallet
- [ ] Deposits generate correct addresses
- [ ] Withdrawals process correctly
- [ ] Transfers complete instantly
- [ ] History is accurate

### Earn Products
- [ ] APY calculations are accurate
- [ ] Rewards distribute correctly
- [ ] Lock periods enforce properly

### Auth
- [ ] Login/logout works
- [ ] 2FA setup works
- [ ] KYC submission works