# TigerEx CEX Mode — Deeper Feature Gap & Admin Roadmap

> **Status: requirements backlog, not an implementation or production-readiness claim.** This document records target features to audit and build. It does not establish that any feature exists, that TigerEx matches another exchange, or that the platform is safe for live trading. Every feature needs implementation evidence, tests, operational controls, security review, and applicable legal/regulatory review.

## Benchmark scope

Compare TigerEx against Binance, Coinbase Advanced, OKX, Bybit, Bitget, MEXC, Gate.io, KuCoin, Kraken, Crypto.com, BingX, BitMart, HTX, LBank, WhiteBIT, Bitfinex, Bitstamp, Upbit, Bithumb, and Phemex. The comparison below is a project-supplied high-level checklist, not an independently verified current feature-by-feature audit of every named exchange.

## Guiding architecture

Target an independently operated CEX: its own matching engine, order books, account/ledger, risk engine, custody orchestration, API gateway, and administration. Do not depend on another exchange API or mirror another exchange's liquidity.

"Zero dependency" means **no runtime dependence on another exchange's trading API, order books, or liquidity**. It does **not** mean literally zero third-party dependencies: blockchain networks, self-hosted nodes, infrastructure, oracle data sources, licensed payment/card partners, custody hardware (HSM), and regulated services are still required. Where this document names a third-party product (for example Sumsub, Fireblocks, Chainlink, Pyth), it describes a capability to be **self-built**, and the named product is the benchmark, not a dependency.

## Current repository state (audit starting point)

This section grounds the roadmap in the repository as it stands. Directory presence is **not** evidence of a working, tested, or safe feature — each entry must be confirmed with code, tests, and operational evidence before it is marked implemented.

- ~173 module directories exist under `TigerEx/`, with overlapping/duplicate domains (for example `p2p_trading` and `p2p_service`; `wallet_service`, `wallet_system`, `user_wallet`; `security`, `security_v2`, `security_auditing`). Consolidation is required before feature claims.
- No `spot_markets`, `futures_markets`, or `margin_markets` listing schema was found in the repository. Market-listing administration (Section B.2) is therefore **missing**.
- No market-maker bot implementation was found (only incidental matches in unrelated admin/constants files). The self-built CEX market-maker bot (Section A.7) is therefore **missing**.
- Partial implementations exist for matching engine, copy trading, grid trading, earn, options, P2P, referral, launchpad, dual investment, and TradFi stock trading. Each is **unverified** against the acceptance gates in Section C.
- The repository is a shallow clone; historical/CI evidence for individual modules is not available from this checkout alone.

---

## A. User and trader features

### 1. Account, security, KYC, wallets

- Self-managed email/phone authentication, social sign-in (Google, Apple, Telegram, Discord) where appropriate, passkeys/WebAuthn, session management, device/session/login history, and secure recovery. No mandatory Firebase Auth dependency.
- KYC tiers with document capture, self-built OCR, liveness/face matching, manual review queue, risk-based limits, privacy controls, and immutable audit trails. Any example dollar limits (for example "Level 0 $10k withdraw") must be approved through jurisdictional/legal and risk review before use.
- TOTP, email/SMS verification, passkeys, biometric unlock (FaceID/TouchID), anti-phishing codes, withdrawal address allowlists, device management, IP allowlists, API-key IP allowlists, and automatic security locks.
- Sub-accounts (target scale: hundreds per master, e.g. 300) with isolated balances, permissions, and API keys, for teams and trading firms.
- Unified trading account (UTA) spanning spot, futures (USDT-M/USDC-M/COIN-M), margin, and options **only after** cross-margin and portfolio-risk systems are independently validated. Multi-asset collateral with per-asset haircuts.
- Funding, spot, futures, margin, earn, copy, and bot ledgers with free instant internal transfers between them. Custody using reviewed MPC/HSM/multisig controls, separation of duties, key ceremonies, and recovery plans. Never expose plaintext private keys through APIs.

### 2. Spot trading

- Order types: limit, market, stop-limit, stop-market, OCO, trailing stop, TWAP, iceberg, post-only, FOK, IOC, scale, and trigger.
- Quote/base asset families involving RUSD, USDT, USDC, RYUSD, TGR, BTC, and ETH, subject to token, custody, liquidity, and legal review. Example pairs: BTC/RUSD, BTC/USDT, BTC/USDC, ETH/RUSD, ETH/USDT, ETH/USDC, TGR/RUSD, TGR/USDT, TGR/USDC, SOL/RUSD, TSLA/RUSD, AAPL/RUSD, GOLD/RUSD.
- USDT and USDC spot markets are required, served by TigerEx-owned order books — not mirrored from any other exchange.
- Convert (zero/low-fee), institutional OTC/RFQ for large blocks, P2P, one-click buy/sell, recurring buy, and auto-invest.
- Token listing review, contract verification, custody support, liquidity plans, market-integrity monitoring, and delisting controls. A target of 1,000+ pairs is a listing-capacity goal, **not** a safe default listing policy.

### 3. Futures and perpetuals

- Linear USDT-M and USDC-M; proposed RUSD-M and TGR-M; inverse COIN-M; quarterly/bi-quarterly/delivery futures; perpetual swaps; and TradFi-linked products (stocks/forex/commodities/indices) only where lawful and operationally supported.
- Order types: limit, market, stop-limit, stop-market, trailing stop, post-only, FOK, IOC, TP/SL-as-close, reduce-only.
- Cross/isolated margin, one-way/hedge modes, eligible multi-asset collateral, funding history and predicted funding, mark/index prices, insurance funds, ADL, and contract risk tiers.
- Independent oracle aggregation (for example Chainlink + Pyth + TigerEx trades, median of sources) with source-quality checks, staleness/outlier handling, deviation controls, fallbacks, and emergency market pauses. Not a mirror of another exchange's mark price.
- **Do not enable 125x–1001x leverage simply because the draft lists it.** Leverage, maintenance margin, liquidation, insurance, and ADL parameters require stress testing, legal review, and conservative launch limits.

### 4. Margin trading

- Cross margin, isolated margin, and portfolio margin only after risk validation. Per-pair cross/isolated configuration.
- Admin-configurable pairs, collateral haircuts/LTV, borrow pools, interest curves (base/kink/jump), auto-borrow/repay, liquidation thresholds, partial liquidation, and liquidator incentives.
- Draft collateral ratios (for example BTC 70% / ETH 65% / TGR 50% / RUSD 90%), interest rates (for example 5% APY base), thresholds, and bonuses are **hypotheses for risk modelling, not approved parameters**.
- Borrowing, reservations, repayments, and liquidation must be atomic, ledger-backed, and auditable.

### 5. Options, leveraged tokens, and TradFi

- European call/put options, strike/expiry management, cash settlement, pricing/risk models, and independent order books.
- Leveraged tokens/ETFs with NAV calculation, daily rebalancing, disclosures, and risk controls.
- Stocks, forex, commodities, and indices only with a lawful, licensed, appropriately collateralized and independently priced structure. Clearly distinguish synthetic exposure from ownership of an underlying asset.
- Admin listing for options, ETFs, stocks, forex, commodities, and indices.

### 6. Earn, staking, structured products, launch products

- Flexible/fixed earn, staking, supported-chain validator operations, auto-invest/DCA, dual investment, shark-fin-style structured products, vaults, launchpad/launchpool, and allocation/vesting.
- Disclose yield sources, lockups, redemption limits, principal risk, counterparty/contract risk, and reward funding. **Do not represent example high APYs (for example RYUSD 15%) as guaranteed.**
- RYUSD or other stablecoin/vault products need separate reserve, collateral, redemption, legal, and smart-contract design and audit.

### 7. Copy trading and bots

- Spot/futures/bot copy trading; PnL/ROI/win-rate history; leaderboards; follower limits; fixed-size/ratio modes; stop limits; max exposure; stop-copy and close controls.
- Spot/futures grid, DCA, martingale, infinity grid, smart rebalance, funding/spot-futures arbitrage, market making, TWAP, and AI-assisted strategies.
- **Self-built CEX market-maker bot** (the capability Hummingbot/3Commas/Cryptohopper provide, reimplemented in-house with no third-party dependency): configurable spread, per-side depth, refresh interval, and inventory skew, constrained by market-integrity rules and per-market kill switches.
- Bot scopes, kill switches, order/exposure caps, backtesting, paper trading, monitoring, and per-user loss controls. Arbitrage is not guaranteed profit; martingale can amplify losses.

### 8. Pay, P2P, referrals, VIP, cards

- Internal payments by account/email/phone/QR with recipient verification and ledger settlement.
- P2P escrow, merchant verification, disputes, fraud monitoring, supported fiat/payment methods, and geographic restrictions. Bank, bKash, Nagad, PayPal and other rails depend on provider terms and local law.
- Referral, affiliate, broker/FIX, and VIP programs with transparent rules and fraud controls; example commissions (for example referral 40%, affiliate 50%, VIP 0–9 tiers) are proposals, not approved rates.
- Virtual/physical cards only through an appropriately licensed issuing bank/program manager and card-network-approved program.

### 9. Analytics, social, APIs, statements

- Portfolio balances, realized/unrealized PnL, asset/chain breakdown, history, and auditable statements.
- Leaderboards with anti-manipulation protections and clear PnL/ROI methodology.
- Social posts/follows/chat with abuse reporting and moderation.
- REST, WebSocket, and FIX gateways with documented authentication/signing, scopes, rate limits, IP allowlists, replay protection, idempotency, versioning, and usage analytics. Self-built gateway — do not copy another exchange's API spec or gateway.
- CSV transaction exports and jurisdiction-appropriate tax/statements.

---

## B. Admin requirements

### 1. User, KYC, risk, wallet, security admin

- User search/profile, balances, positions, orders, KYC, ban/unban, freezes, withdrawal blocks, carefully verified 2FA recovery, and sub-account management.
- KYC queue, evidence access controls, OCR/liveness results, manual decisions, reason codes, and audit records.
- Risk dashboard for exposure, liquidation queues, insurance funds, ADL, funding, oracle deviation, and emergency pauses.
- Hot/warm/cold wallet monitoring, chain confirmations, withdrawal/deposit queues, gas/fees, key ceremonies, and MPC/multisig approvals.
- Admin MFA, least-privilege RBAC, separation of duties, immutable audit logs, and alerts for sensitive actions.

### 2. Market listing administration (spot, futures, perps, margin)

**Spot listing admin.** Fields: symbol, base/quote, chain, contract, decimals, logo, market-data source, listing fee, status (active/paused/delisting), stablecoin classification, review checklist, and project approval. Backed by a `spot_markets` table. Approve/reject project submissions.

**Futures market listing admin (required).** Backed by a `futures_markets` table. Fields:
- Symbol (for example BTC/RUSD, BTC/USDT, BTC/USDC, ETH/RUSD, ETH/USDT, ETH/USDC, TGR/RUSD, TGR/USDT, TGR/USDC, SOL/RUSD, TSLA/RUSD, AAPL/RUSD, GOLD/RUSD, EURUSD/RUSD), base, quote.
- Settlement asset (RUSD/USDT/USDC/RYUSD/BTC/ETH/TGR); contract type (RUSD-M/USDT-M/USDC-M/COIN-M/TGR-M).
- Contract size, tick size, max leverage (with conservative, risk-approved defaults), funding interval and cap, oracle sources, risk parameters (maintenance margin, initial margin, liquidation fee, insurance-fund contribution).
- Status (active/paused/delisting/maintenance); listing type (perpetual/quarterly/bi-quarterly/delivery).
- USDT and USDC futures markets are required and served by TigerEx-owned order books — not mirrored from another exchange.

**Perpetual (perps) listing admin (required).** A distinct `perpetual_markets` configuration with symbol, contract type, leverage, funding, oracle, risk parameters, and active/paused/maintenance states.

**Margin listing admin (required).** Backed by a `margin_markets` table. Fields:
- Pair (for example BTC/RUSD, ETH/RUSD, TGR/RUSD, SOL/RUSD), mode (cross/isolated), leverage, collateral eligibility and LTV, borrowable assets, interest model (base/kink/jump), liquidation threshold, liquidation bonus, risk tier, and status.
- Isolated pools: per-pool collateral eligibility, borrowable asset, LTV, threshold, bonus, and interest model.
- All draft ratios and rates (for example BTC 70% LTV, 75% threshold, 5% bonus) are **risk-modelling inputs, not approved parameters**.

**Add/edit/pause/delist actions must be permissioned, validated, audited, and protected from accidental or unauthorized changes.** Separate eligibility, pricing, risk, and legal checks for options, leveraged tokens, stocks, forex, commodities, and indices.

### 3. Fees, revenue, treasury, buyback admin

- Configurable spot/futures fees, VIP tiers, token-holding discounts, referral/affiliate/broker rules, and margin interest. Self-built fee engine.
- Revenue dashboards for fees, interest, liquidations, withdrawals, conversion spreads, P2P, pay, and cards.
- Treasury monitoring by chain/asset, fee collection, approvals, and reconciliation.
- Buyback/burn controls with public rules, independent approvals, verifiable execution, and legal review.

### 4. Risk, emergency, oracle, insurance, audit admin

- Pause/unpause per market/product and for deposits, withdrawals, or the platform; circuit breakers and controlled recovery.
- Insurance-fund monitoring, replenishment policies, liquidation queues, partial liquidation, and ADL thresholds.
- Oracle source/fallback management, deviation and staleness thresholds, and automated pauses.
- Token/wallet/user blocklists and allowlists with documented reasons and review processes.
- Immutable audit events for listings, fee changes, permissions, risk settings, emergency controls, and treasury actions.

### 5. Bot, copy, earn, P2P, pay, referral admin

- Create/approve/monitor/disable bot strategies (including the self-built market-maker bot) with performance, risk, and kill-switch controls.
- Approve copied traders, set follower/exposure caps, configure profit-share rules, and review copy positions.
- Create earn products with caps, terms, reward source, redemption rules, and risk disclosures.
- Approve launchpad projects; manage sales, vesting, allocation, and eligibility.
- Manage P2P merchants, ads, orders, disputes, escrow, fiat methods, and geographic restrictions.
- Manage pay/card limits, fees, transaction reviews, referral/affiliate/broker programs, and VIP tiers.

### 6. Analytics, support, API admin

- Metrics for users, activity, spot/futures volume, open interest, fees, deposits/withdrawals, P2P, payments, and cards.
- Built-in support tickets, chat, knowledge base, escalation, and auditability.
- API key lifecycle, scopes, rate limits, broker/FIX access, WebSocket limits, and abuse detection/revocation.

---

## C. Architecture and acceptance gates

1. **Ledger first:** double-entry ledger, immutable journal, idempotency, reconciliation, atomic state transitions, and balance invariants.
2. **Matching engine:** deterministic sequencing, selected price-time priority, replay/recovery, bounded queues, persistence, and reproducible tests. "1M TPS" is an unverified target until benchmarked on declared hardware and realistic workloads.
3. **Custody:** chain-specific address derivation, secure signing, HSM/MPC/multisig controls, withdrawal policy engine, on-chain verification, confirmation/finality policy, replay prevention, and reconciliation.
4. **Market data/oracles:** source validation, stale-data handling, manipulation controls, monitoring, and emergency fallback.
5. **Security:** threat modelling, secrets management, TLS, strict origin allowlists, strong JWT/session validation, MFA/RBAC, rate limits, DDoS strategy, dependency scanning, penetration tests, incident response, and backup/restore drills.
6. **Reliability:** SLOs, observability, capacity testing, failover, disaster recovery, migrations, and staged releases.
7. **Quality gates:** unit/integration/property/fuzz/race/load/reconciliation tests, security review, and independent audit.
8. **Compliance:** jurisdiction-specific review for exchange operation, KYC/AML, sanctions, custody, derivatives, tokenized securities, fiat rails, cards, privacy, and disclosures.

---

## D. Delivery status and completion criteria

This file is a **feature and admin requirements backlog**. It does not implement these features, establish parity with any exchange, certify security, or authorize production trading. For each item, record status as missing/partial/implemented/tested/production-validated and link the relevant code, tests, security review, and operational evidence before marking it complete.

### Suggested release gates

1. **Foundation:** ledger, matching engine, custody orchestration, auth/KYC, admin RBAC, monitoring, deployment pipeline.
2. **Spot:** order types, owned order books, USDT/USDC/RUSD markets, listing admin, reconciliation tests.
3. **Derivatives:** futures/perps listing admin, funding, oracle aggregation, insurance fund, ADL, risk tiers — after stress testing.
4. **Margin:** cross/isolated/portfolio margin, borrow pools, interest curves, liquidation engine — after independent risk review.
5. **Extended products:** options, leveraged tokens, TradFi — only with licensing and pricing/risk validation.
6. **Yield and programs:** earn, structured products, launchpad, copy trading, bots (including the market-maker bot) — after accounting and kill-switch tests.
7. **Payments and growth:** pay, P2P, cards, referral/VIP/broker — after legal and provider review.
8. **Production approval:** legal/compliance sign-off, external audits, bug bounty, load testing, recovery drills, capped initial exposure, and monitored rollout.

### No-missing-feature claim

"No single missing feature versus the top 20 CEXs" is a product aspiration, not a verifiable guarantee. Feature parity must be assessed against a dated scope matrix with tested acceptance criteria, and any public claim of parity, safety, or readiness must be supported by evidence rather than this backlog.
