# TigerEx CEX Mode — Full Feature Gap & Admin Roadmap

> **Status: requirements backlog, not an implementation or production-readiness claim.** This document records target features to audit and build. It does not establish that any feature exists, that TigerEx matches another exchange, or that the platform is safe for live trading. Every feature needs implementation evidence, tests, operational controls, security review, and applicable legal/regulatory review.

## Benchmark scope

Compare TigerEx against Binance, Coinbase Advanced, OKX, Bybit, Bitget, MEXC, Gate.io, KuCoin, Kraken, Crypto.com, BingX, BitMart, HTX, LBank, WhiteBIT, Bitfinex, Bitstamp, Upbit, Bithumb, and Phemex. The comparison below is a project-supplied high-level checklist, not an independently verified current feature-by-feature audit of every named exchange.

## Guiding architecture

Target an independently operated CEX: its own matching engine, order books, account/ledger, risk engine, custody orchestration, API gateway, and administration. Do not depend on another exchange API or mirror another exchange's liquidity. This does not mean literally zero third-party dependencies: blockchain networks, infrastructure, oracle sources, licensed payment/card partners, and regulated services may still be required.

## A. User and trader features

### 1. Account, security, KYC, wallets
- Self-managed email/phone authentication, social sign-in where appropriate, passkeys, session management, and secure recovery; no mandatory Firebase Auth dependency.
- KYC tiers with document checks, OCR, liveness/face matching, manual review, risk-based limits, privacy controls, and audit trails. Any example dollar limits must be approved through jurisdictional/legal and risk review.
- TOTP, email/SMS verification, passkeys, anti-phishing codes, withdrawal address allowlists, device/session/login history, IP restrictions, API-key IP allowlists, and automatic security locks.
- Sub-accounts with isolated balances, permissions, and API keys.
- Unified account across spot, futures, margin, and options only after cross-margin and portfolio-risk systems are independently validated.
- Funding, spot, futures, margin, earn, copy, and bot ledgers; custody using reviewed MPC/HSM/multisig controls, separation of duties, key ceremonies, and recovery plans. Never expose plaintext private keys through APIs.

### 2. Spot trading
- Limit, market, stop-limit, stop-market, OCO, trailing stop, TWAP, iceberg, post-only, FOK, IOC, scale, and trigger orders.
- Quote/base asset families involving RUSD, USDT, USDC, RYUSD, TGR, BTC, and ETH, subject to token, custody, liquidity, and legal review. Example pairs: BTC/RUSD, BTC/USDT, BTC/USDC, ETH/RUSD, ETH/USDT, ETH/USDC, TGR/RUSD, TGR/USDT, TGR/USDC, and SOL/RUSD.
- Convert, institutional OTC/RFQ, P2P, one-click buy/sell, recurring buy, and auto-invest.
- Token listing review, contract verification, custody support, liquidity plans, market integrity, and delisting controls. A target of 1,000+ pairs is not a safe default listing policy.

### 3. Futures and perpetuals
- Linear USDT-M and USDC-M; proposed RUSD-M and TGR-M; inverse COIN-M; quarterly/bi-quarterly/delivery futures; perpetual swaps; and TradFi-linked products only where lawful and operationally supported.
- Limit, market, stop-limit, stop-market, trailing stop, post-only, FOK, IOC, TP/SL close, and reduce-only.
- Cross/isolated margin, one-way/hedge modes, eligible collateral, funding history/forecast, mark/index prices, insurance funds, ADL, and contract risk tiers.
- Independent oracle aggregation with source-quality checks, staleness/outlier handling, deviation controls, fallbacks, and emergency market pauses.
- Do not enable 125x–1001x leverage simply because the draft lists it. Leverage, maintenance margin, liquidation, insurance, and ADL parameters require stress testing, legal review, and conservative launch limits.

### 4. Margin trading
- Cross margin, isolated margin, and portfolio margin only after risk validation.
- Admin-configurable pairs, collateral haircuts/LTV, borrow pools, interest curves, auto-borrow/repay, liquidation thresholds, partial liquidation, and incentives.
- Draft collateral ratios, interest rates, thresholds, and bonuses are hypotheses for risk modelling, not approved parameters.
- Borrowing, reservations, repayments, and liquidation must be atomic, ledger-backed, and auditable.

### 5. Options, leveraged tokens, and TradFi
- European call/put options, strike/expiry management, cash settlement, pricing/risk models, and independent order books.
- Leveraged tokens/ETFs with NAV calculation, rebalancing, disclosures, and risk controls.
- Stocks, forex, commodities, and indices only with a lawful, licensed, appropriately collateralized and independently priced structure. Clearly distinguish synthetic exposure from ownership of an underlying asset.
- Admin listing for options, ETFs, stocks, forex, commodities, and indices.

### 6. Earn, staking, structured products, launch products
- Flexible/fixed earn, staking, supported-chain validator operations, auto-invest/DCA, dual investment, shark-fin-style structured products, vaults, launchpad/launchpool, and allocation/vesting.
- Disclose yield sources, lockups, redemption limits, principal risk, counterparty/contract risk, and reward funding. Do not represent example high APYs as guaranteed.
- RYUSD or other stablecoin/vault products need separate reserve, collateral, redemption, legal, and smart-contract design and audit.

### 7. Copy trading and bots
- Spot/futures/bot copy trading; PnL/ROI/win-rate history; follower limits; fixed-size/ratio modes; stop limits; max exposure; stop-copy and close controls.
- Spot/futures grid, DCA, martingale, infinity grid, smart rebalance, funding/spot-futures arbitrage, market making, TWAP, and AI-assisted strategies.
- Bot scopes, kill switches, order/exposure caps, backtesting, paper trading, monitoring, and per-user loss controls. Arbitrage is not guaranteed profit; martingale can amplify losses.
- Configurable market-maker spread, depth, refresh and inventory-skew parameters constrained by market-integrity rules.

### 8. Pay, P2P, referrals, VIP, cards
- Internal payments by account/email/phone/QR with recipient verification and ledger settlement.
- P2P escrow, merchant verification, disputes, fraud monitoring, supported fiat/payment methods, and geographic restrictions. Bank, bKash, Nagad, PayPal and other rails depend on provider terms and local law.
- Referral, affiliate, broker/FIX, and VIP programs with transparent rules and fraud controls; example commissions are proposals, not approved rates.
- Virtual/physical cards only through an appropriately licensed issuing bank/program manager and card-network-approved program.

### 9. Analytics, social, APIs, statements
- Portfolio balances, realized/unrealized PnL, asset/chain breakdown, history, and auditable statements.
- Leaderboards with anti-manipulation protections and clear PnL/ROI methodology.
- Social posts/follows/chat with abuse reporting and moderation.
- REST, WebSocket, and FIX gateways with documented authentication/signing, scopes, rate limits, IP allowlists, replay protection, idempotency, versioning, and usage analytics.
- CSV transaction exports and jurisdiction-appropriate tax/statements.

## B. Admin requirements

### 1. User, KYC, risk, wallet, security
- User search/profile, balances, positions, orders, KYC, ban/unban, freezes, withdrawal blocks, carefully verified 2FA recovery, and sub-account management.
- KYC queue, evidence access controls, OCR/liveness results, manual decisions, reason codes, and audit records.
- Risk dashboard for exposure, liquidation queues, insurance funds, ADL, funding, oracle deviation, and emergency pauses.
- Hot/warm/cold wallet monitoring, chain confirmations, withdrawal/deposit queues, gas/fees, key ceremonies, and MPC/multisig approvals.
- Admin MFA, least-privilege RBAC, separation of duties, immutable audit logs, and alerts for sensitive actions.

### 2. Market listing administration
- Spot listing fields: symbol, base/quote, chain, contract, decimals, logo, market-data source, fee schedule, status, stablecoin classification, review checklist, and project approval.
- Futures market configuration: symbol, contract/settlement type, contract size, tick/lot size, max leverage, funding interval/caps, oracle, risk parameters, status, and delivery schedule.
- Separate perpetual-market configuration with funding, oracle/risk settings, and active/paused/maintenance states.
- Margin-market configuration: pair, cross/isolated mode, collateral eligibility, LTV/haircuts, borrowable assets, interest model, liquidation threshold/bonus, risk tier, and status.
- Add/edit/pause/delist actions must be permissioned, validated, audited, and protected from accidental or unauthorized changes.
- Separate eligibility, pricing, risk, and legal checks for options, leveraged tokens, stocks, forex, commodities, and indices.

### 3. Fees, revenue, treasury, buyback
- Configurable spot/futures fees, VIP tiers, discounts, referral/affiliate/broker rules, and margin interest.
- Revenue dashboards for fees, interest, liquidations, withdrawals, conversion spreads, P2P, pay, and cards.
- Treasury monitoring by chain/asset, fee collection, approvals, and reconciliation.
- Buyback/burn controls with public rules, independent approvals, verifiable execution, and legal review.

### 4. Risk, emergency, oracle, insurance, audit
- Pause/unpause per market/product and for deposits, withdrawals, or the platform; circuit breakers and controlled recovery.
- Insurance-fund monitoring, replenishment policies, liquidation queues, partial liquidation, and ADL thresholds.
- Oracle source/fallback management, deviation and staleness thresholds, and automated pauses.
- Token/wallet/user blocklists and allowlists with documented reasons and review processes.
- Immutable audit events for listings, fee changes, permissions, risk settings, emergency controls, and treasury actions.

### 5. Bot, copy, earn, P2P, pay, referral admin
- Create/approve/monitor/disable bot strategies with performance, risk, and kill-switch controls.
- Approve copied traders, set follower/exposure caps, configure profit-share rules, and review copy positions.
- Create earn products with caps, terms, reward source, redemption rules, and risk disclosures.
- Approve launchpad projects; manage sales, vesting, allocation, and eligibility.
- Manage P2P merchants, ads, orders, disputes, escrow, fiat methods, and geographic restrictions.
- Manage pay/card limits, fees, transaction reviews, referral/affiliate/broker programs, and VIP tiers.

### 6. Analytics, support, API admin
- Metrics for users, activity, spot/futures volume, open interest, fees, deposits/withdrawals, P2P, payments, and cards.
- Built-in support tickets, chat, knowledge base, escalation, and auditability.
- API key lifecycle, scopes, rate limits, broker/FIX access, WebSocket limits, and abuse detection/revocation.

## C. Architecture and acceptance gates

1. **Ledger first:** double-entry ledger, immutable journal, idempotency, reconciliation, atomic state transitions, and balance invariants.
2. **Matching engine:** deterministic sequencing, selected price-time priority, replay/recovery, bounded queues, persistence, and reproducible tests. “1M TPS” is an unverified target until benchmarked on declared hardware and realistic workloads.
3. **Custody:** chain-specific address derivation, secure signing, HSM/MPC/multisig controls, withdrawal policy engine, on-chain verification, confirmation/finality policy, replay prevention, and reconciliation.
4. **Market data/oracles:** source validation, stale-data handling, manipulation controls, monitoring, and emergency fallback.
5. **Security:** threat modelling, secrets management, TLS, strict origin allowlists, strong JWT/session validation, MFA/RBAC, rate limits, DDoS strategy, dependency scanning, penetration tests, incident response, and backup/restore drills.
6. **Reliability:** SLOs, observability, capacity testing, failover, disaster recovery, migrations, and staged releases.
7. **Quality gates:** unit/integration/property/fuzz/race/load/reconciliation tests, security review, and independent audit.
8. **Compliance:** jurisdiction-specific review for exchange operation, KYC/AML, sanctions, custody, derivatives, tokenized securities, fiat rails, cards, privacy, and disclosures.

## D. Delivery status and completion criteria

This file is a **feature and admin requirements backlog**. It does not implement these features, establish parity with any exchange, certify security, or authorize production trading. For each item, record status as missing/partial/implemented/tested/production-validated and link the relevant code, tests, security review, and operational evidence before marking it complete.
