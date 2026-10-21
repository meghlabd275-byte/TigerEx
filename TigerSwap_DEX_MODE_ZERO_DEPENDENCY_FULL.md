# TigerSwap — TigerEx DEX Mode: Zero-Dependency Feature Roadmap

> Product requirements and implementation roadmap. This document does **not** mean these features are already implemented, audited, funded, or production-ready.

## Core principle

TigerSwap is the planned standalone DEX mode within TigerEx. It aims to build its own AMMs, order-book/perpetuals engine, router/aggregator, indexers, oracle infrastructure, bridge relayer, bots, and administration instead of relying on other CEX/DEX products or their trading APIs.

Reference landscape reviewed in the request: Uniswap V2/V3/V4, PancakeSwap, Curve, Balancer, Sushi, Trader Joe, Orca, Raydium, Jupiter, 1inch, 0x, dYdX, GMX, Gains Network, Hyperliquid, Aster, Drift, Vertex, ApolloX, ApeX, WOOFi, QuickSwap, Velodrome, Aerodrome, Camelot, Thena, DODO, Bancor, Kyber, and Cetus.

“Zero dependency” means no runtime dependence on third-party CEX/DEX trading APIs or SDKs for core execution. It does not remove the need for chain protocols, independently operated nodes, security audits, and appropriately selected external data sources where explicitly configured. Wallet compatibility also requires implementing the relevant public standards.

## A. User / trader functionality

### 1. Wallets, chains, and gas
- Self-built wallet connectors for MetaMask, Rabby, Phantom, Solflare, Trust, OKX, Bitget, TokenPocket, SafePal, Ledger, Trezor, WalletConnect v2 compatibility, and TigerWallet (MPC, account abstraction, HD wallet support).
- Multi-chain roadmap targeting 150+ networks: EVM chains; Solana, Sui, Aptos, Sei, Injective, Cosmos/ Osmosis, THORChain, Bitcoin and UTXO chains, XRP, XLM, Cardano, Polkadot, NEAR, TRON, TON, and relevant token/inscription standards.
- Self-operated RPC/node infrastructure with health monitoring, failover, rate limits, chain finality checks, and reorg handling.
- Own paymaster/gas treasury design for sponsored transactions and optional fee payment in supported assets. Free-swap promotions must have explicit eligibility, abuse controls, and treasury limits.

### 2. Swap engine and routing
- Self-built constant-product V2 pools and factory/router.
- Concentrated-liquidity V3 pools, fee tiers, NFT positions, range management, and position accounting.
- V4-style hook architecture with reviewed dynamic fees, TWAMM, on-chain limit orders, compounding, and anti-MEV mechanisms.
- Stable-swap pools for RUSD/USDT/USDC/RYUSD, with invariant and depeg protections.
- Weighted pools and portfolio pools.
- Single-sided liquidity entry/exit and zap flows.
- Multi-hop routing, quote simulation, slippage bounds, price impact limits, and splitting across TigerSwap-owned pools.
- TigerAggregator over TigerSwap’s own indexed pools and own execution venues; no claim of best price outside the supported universe.
- MEV protection design using private transaction submission where available, commit/reveal or batch mechanisms where suitable, and sandwich-risk monitoring.
- Gas-sponsored swaps with solver/settlement rules, failure handling, and clear fee disclosure.
- Limit orders, DCA, TWAP, TWAMM, OTC block trades, and bridge-plus-swap workflows.
- TigerBridge is a separate high-risk subsystem requiring independent threat modeling, limits, replay protection, validator/relayer security, and audits.

### 3. Liquidity
- Add/remove liquidity for V2, concentrated, stable, and weighted pools.
- Zaps, LP position accounting, fee/reward claims, and V2-to-V3 migration tools.
- Self-indexed pool analytics: TVL, volume, fees, APR/APY assumptions, impermanent-loss estimates, and per-position history.
- LP locks and migrations with transparent lock terms, emergency behavior, and admin controls.

### 4. Farms, staking, and governance
- LP farms, stable LP farms, single-token staking, and multi-reward pools.
- Auto-compounding vaults with strategy allowlists, withdrawal safeguards, loss limits, and strategy accounting.
- veTGR-style time-locked voting, gauge weights, bribes, boosted rewards, and protocol-fee distributions.
- Staking designs for TGR/RUSD/RYUSD, LP assets, and optional liquid-staking representations.
- All advertised APR/APY values must be calculated from disclosed assumptions and on-chain reward budgets; fixed or guaranteed yield claims must not be implied.

### 5. Perpetuals and futures DEX
- Own oracle-priced pooled-liquidity perpetuals and own Rust CLOB/matching engine designs.
- Order types: limit, market, stop, take-profit/stop-loss, trailing, TWAP, post-only, and reduce-only.
- Funding-rate calculation, mark/index prices, open-interest limits, liquidation, insurance funds, and funding-arbitrage analytics.
- Collateral/settlement design for RUSD, USDT, USDC, RYUSD, and supported crypto collateral; USDT- and USDC-margined contracts are explicit requirements.
- Admin-controlled future-market and perps listings, risk parameters, status, tick/lot sizes, contract size, settlement asset, funding interval/caps, leverage caps, and oracle configuration.
- Potential crypto and tokenized/trad-fi reference markets (stocks, FX, commodities, indices) require lawful access to data, clear synthetic/derivative disclosures, and jurisdictional approval before launch.
- The stated “1M TPS” and “1001x leverage” are aspirational/requested targets, not validated performance or safe defaults. No market should launch on those claims without independent load tests, risk validation, legal review, and conservative risk limits.

### 6. Options, margin, lending, and structured products
- Options AMM for calls/puts, expiry/strike management, pricing/risk models, exercise/settlement, and volatility/risk analytics.
- Covered-call and put-selling vault concepts with explicit loss scenarios and withdrawal rules.
- Isolated and cross spot margin; collateral eligibility, borrowable assets, interest models, LTV, maintenance thresholds, partial liquidation, and liquidation bonuses.
- Perps margin, isolated lending pools, lending/supply/borrow caps, utilization monitoring, and flash-loan concepts.
- Margin markets and lending pools must be listable/configurable in admin. Flash loans and all lending/derivative products require dedicated invariant testing, liquidation simulations, and legal review.

### 7. Launchpad and NFTs
- IDO launchpad, token/meme launch workflows, bonding curves, fair-launch/liquidity bootstrapping pools, and post-launch liquidity creation.
- NFT marketplace with supported quote assets and on-chain order/settlement logic.
- Launch approval, project due diligence, abuse controls, token metadata validation, and transparent fees.

### 8. Trading bots
- Market-making and concentrated-liquidity range/rebalance bots.
- Spot/perps grid, DCA, arbitrage across TigerSwap-owned pools, TWAP, rebalancing, yield/compounding, and liquidation automation.
- New-token launch monitoring/sniping with transaction simulation and explicit risk controls.
- Copy trading for swaps and perps, opt-in wallet following, performance attribution, and safeguards against misleading leaderboards.
- Bot controls: API/key permissions, spending limits, max slippage, drawdown limits, kill switch, audit trail, dry-run mode, and user-visible strategy risks.
- Bots must not imply guaranteed profit or manipulate markets.

### 9. Analytics and social
- Own indexer and DEX analytics for pairs, prices, volume, liquidity, holders, transactions, pool events, and chain health.
- Multi-chain portfolio tracker, realized/unrealized PnL, positions, and DeFi activity.
- Trader leaderboard based on disclosed methodology and anti-Sybil protections.
- Social/community features, followed wallets, smart-money/whale alerts, new-listing alerts, and on-chain signals.
- Indexer correctness must account for chain reorganizations, token decimals, spam tokens, missing events, and historical backfills.

## B. TigerSwap administration

### 1. Token, pool, liquidity, and farm administration
- Token listing: chain, contract, symbol, decimals, metadata/logo, tags, verification status, risk flags, price-feed mapping, and user-submitted listing review.
- Create/edit/pause/delist V2, V3, stable, and weighted pools; configure fee tiers, tick spacing, weights, initial price, and liquidity.
- Stable-pool parameters and concentration/weighted-pool controls.
- Pool pause, emergency actions, token/wallet/pool denylist, max price impact, slippage controls, and liquidity management.
- Create farms, configure reward assets/emissions/duration/boosts, manage gauges/bribes, and track reward liabilities.
- Admin treasury liquidity seeding must require explicit approvals, wallet controls, and immutable audit records; example seed amounts in the request are not authorization to transfer funds.

### 2. Futures, perps, and market listings
- Dedicated database-backed futures-market, perps-market, and margin-market configuration; add/edit/pause/delist with approval workflow.
- Configure symbol, contract type (RUSD-M, USDT-M, USDC-M, RYUSD-M, COIN-M, TGR-M), base/quote/settlement asset, contract size, tick/lot size, leverage caps, funding interval/rate caps, mark/index oracle, maintenance/initial margin, liquidation fees, insurance allocation, and status.
- Support the explicit requirement for USDT/USDC futures contracts with TigerSwap’s own orderbooks and settlement logic.
- Support perpetual, quarterly, bi-quarterly, and delivery product types only when the contract and settlement lifecycle are implemented and tested.
- Oracle deviation circuit breakers, maximum open interest, per-asset risk tiers, funding/mark-price overrides with dual approval, and market-level pause controls.
- Leverage and risk values in this roadmap are proposed configuration examples, not approved production defaults.

### 3. Margin and lending administration
- Configure margin pairs, cross/isolated modes, collateral and borrowable assets, LTV, liquidation thresholds/bonuses, interest-rate curves, risk tiers, and active/paused status.
- Create isolated lending pools with independent collateral, borrow assets, caps, and liquidation parameters.
- Monitor health factors, utilization, borrow/supply caps, partial liquidations, bad debt, and liquidation-bot permissions.
- Parameter changes require validation, role-based approval, timelocks where appropriate, and audit logs.

### 4. Fees, revenue, treasury, and TGR governance
- Configure swap, perps, margin, borrowing, and other protocol fees within bounded policies.
- Configure revenue splits between LPs, veTGR, treasury, and insurance; manage treasury balances and buyback/burn programs.
- Display all fee allocations and token emissions transparently. Example percentage splits and APYs from the request are proposals only and require governance, legal, and economic review.

### 5. Risk, security, and emergency controls
- Global and per-chain/pool/market pause; circuit breakers; token/wallet/pool allow/deny lists; oracle registry and deviation monitoring.
- Price-impact and slippage limits; MEV monitoring; insurance-fund tracking and replenishment rules.
- Immutable or tamper-evident admin audit logs identifying actor, action, before/after values, approvals, timestamp, and request context.
- Strong RBAC, MFA, hardware-backed secrets where possible, dual control for high-risk actions, session/device protections, key rotation, and incident-response runbooks.
- Never allow an admin panel to expose private keys or bypass contract-level safety checks.

### 6. User, bridge, launchpad, and rewards administration
- Wallet/user activity views limited by role and privacy policy; ban/unban controls with reason and audit trail.
- Pool TVL/volume/fees and treasury liquidity views.
- Farm, gauge, bribe, airdrop, and reward-program creation and management.
- TigerBridge chain/asset configuration, fees, liquidity limits, relayer health, pause/recovery procedures, and reconciliation.
- IDO/meme launch approval, bonding-curve limits, launch fees, and post-launch liquidity settings.

### 7. Analytics dashboard
- Cross-chain TVL, 24-hour volume/fees, active wallets, pool/farm counts, perps open interest, margin borrowed, and chain/indexer health.
- Pool analytics: TVL, volume, fees, APR assumptions, IL estimates, and LP distribution.
- Perps analytics: volume, open interest, funding, liquidations, trader PnL, insurance balance, and oracle deviations.
- Margin analytics: borrow/supply, utilization, health-factor distribution, liquidations, bad debt, and interest income.
- Revenue analytics: source, allocation, treasury, LP, governance, and insurance accounting.

## C. Architecture and delivery requirements

- Solidity contracts for EVM pools, vaults, staking/governance, launchpad, NFT market, margin/perps components where appropriate; independent implementations must not copy third-party code without license and security review.
- Rust for performance-sensitive matching, routing, indexing, and bot services; Go for distributed APIs/services; C++ only where profiling proves it is justified; Python for research, risk analytics, and ML workflows.
- Next.js, React, TypeScript/TSX, and Tailwind CSS for user and admin frontends.
- Use durable databases, event streaming, caches, observability, key management, backups, and disaster recovery selected for each service. No Supabase dependency for TigerEx.
- Build from small, auditable modules. Maintain reproducible builds, dependency and license inventory, SBOM, threat models, fuzz/property tests, invariant tests, testnet deployments, independent audits, monitoring, incident drills, and staged mainnet rollout.
- Separate UI placeholders from working features. No fabricated prices, balances, transactions, wallet addresses, or trade fills.
- “No missing features versus top 30 DEXs” is a product aspiration, not a verifiable guarantee. Feature parity must be assessed against a dated scope matrix and tested acceptance criteria.

## D. Suggested release gates

1. **Foundation:** threat model, chain/node operations, indexer, wallet connections, monitoring, deployment pipeline, and admin RBAC.
2. **Spot AMM:** V2 pools and router, token/pool administration, events/indexing, swaps, LP accounting, and comprehensive tests.
3. **Liquidity expansion:** concentrated and stable pools, analytics, zaps, and reviewed pool hooks.
4. **Trading services:** limit orders, routing, gas sponsorship, and MEV mitigations with clear failure semantics.
5. **Yield and governance:** staking/farms/vaults/gauges only after accounting and withdrawal tests.
6. **Advanced markets:** perps, CLOB, options, margin, lending, and flash loans only after independent audits and adversarial simulations.
7. **Cross-chain and bots:** bridge, automated strategies, launchpad/NFT, and social analytics only after subsystem-specific security gates.
8. **Production approval:** legal/compliance sign-off, external audits, bug bounty, load testing, recovery drills, capped initial exposure, and monitored rollout.

## Final scope

TigerSwap is intended to be a self-built DEX product inside TigerEx—not a thin wrapper over Uniswap, PancakeSwap, Curve, Balancer, Jupiter, 1inch, 0x, GMX, Hyperliquid, dYdX, Aave, or another exchange’s trading API. The feature list above is a requirements roadmap and must not be represented as implemented functionality until code, tests, deployments, audits, and operational evidence confirm it.
