# TigerEx CEX — Global Commercial Launch Readiness Audit

Date: 2026-11-13
Scope: what is working, what is not working, what is missing, and what gaps
remain before TigerEx can be launched globally as a commercial CEX comparable to
Binance, Bybit, KuCoin, Coinbase, Gemini, Gate, Kraken, Bitget and Robinhood.

This is an engineering status report grounded in the repository as it stands
today. It is **not** a legal, regulatory or financial-promotion opinion. A real
launch also requires the non-engineering work listed in Section D (licences,
audit, liquidity, insurance, banking, support).

---

## 0. Ground truth measured in this repository

| Layer | Evidence | Count |
| --- | --- | --- |
| Frontend API route handlers | `src/app/api/**/route.ts` | 472 |
| — DB-backed handlers (`src/lib/db`) | no external backend needed | 260 |
| — Proxies to `TIGEREX_BACKEND_URL` (fail-closed 503) | `src/lib/backend-url.ts` | 133 |
| Frontend pages | `src/app/**/page.tsx` | 138 |
| Frontend components | `src/components/**/*.tsx` | 42 |
| Frontend logic modules | `src/lib/**/*.ts` | 158 |
| Logic tests | `scripts/test/*.test.cjs` (73 files) | 1045 pass |
| Go tests | `backend/go` `func Test*` | 305 |
| Secondary module dirs | `TigerEx/*` | 173 (many overlapping) |
| Environment variables | `.env.example` | 94 |

Verified toolchains in this environment: Node 24, npm 12. Go, Rust and CMake are
**not installed here**, so `go build/test`, `cargo test` and `ctest` were not run
in this session; their status below is taken from CI configuration and prior
sessions, not re-measured now.

Build/test results re-measured today: `npx tsc --noEmit` clean;
`npm run test:logic` = 1045 pass / 0 fail.

---

## A. What is WORKING (verified, self-contained, tested)

### A.1 Money movement and the ledger — strong

- **Double-entry journal** (`src/lib/db/journal.ts`, `src/lib/db/accounting.ts`)
  is the authoritative record; `balances` is a materialised view. `recordEntry`
  refuses a leg set that does not sum to zero per asset and SHA-256 chains each
  entry to the previous one (`verifyChain()`), so edits/reordering are detectable.
- **Every value-moving engine now journals**, verified this session:
  spot, futures, funding, liquidation, ADL, margin (borrow/repay/liquidation),
  ETF, options, earn subscriptions/rewards, convert, user-to-user transfers,
  bridge-out, OTC block, referral payouts, P2P escrow release/dispute.
  Custody moves call `recordDeposit`/`reverseDeposit`/`recordWithdrawal`.
- **`reconcileJournal()`** compares the journal's per-asset net user holding
  against `balances` and reports drift; exposed at `GET /api/admin/journal`.
- **Ledger primitives** (`debitAvailable`, `creditAvailable`, `lockAvailable`,
  `unlockAvailable`, `consumeLocked`) spread a movement across every balance row
  that holds an asset, so a multi-row asset cannot be driven negative or strand
  funds.
- **Zero-sum invariants** are enforced and tested (futures insurance share,
  funding payers→receivers, ADL clawback, ETF, options, earn, convert fee,
  bridge fee, OTC desk legs).
- New regression tests added this session:
  `scripts/test/journal-engine-coverage.test.cjs` (margin, ETF, options, earn)
  and an ADL case in `scripts/test/journal-futures.test.cjs`.

### A.2 Trading engines — real, in-repo, no external exchange

- **Spot** (`spot-engine.ts`, 1132 lines + pure `orderbook.ts`): limit, market,
  stop-limit, stop-market, iceberg; price-time priority; maker/taker fees; funds
  reserved before matching; a fill settles real balances and journals.
- **Futures/perp** (`futures-engine.ts`): linear contracts, leverage, one-way /
  hedge modes, funding, mark price, insurance fund, ADL, conditional orders
  (stop-loss, take-profit, trailing stop), reduce-only, liquidation.
- **Margin** (`margin-engine.ts`): cross/isolated mode, collateral LTV,
  borrow/repay, liquidation, interest curve.
- **Options** (`options-engine.ts`) and **leveraged tokens / ETF**
  (`etf-engine.ts`) with Black-Scholes-style pricing and NAV rebalancing.
- **P2P** (`p2p/market.ts`): ads, escrow, order lifecycle state machine,
  dispute split.
- **Copy trading**, **grid/DCA bots**, **earn** (flexible/locked subscriptions,
  launchpool, rewards), **convert**, **OTC/RFQ**, **referral**.
- **Rust matching engine** (`backend/rust/matching-engine`) is the settlement
  authority; the C++ engine (`backend/cpp/matching_engine`) is the pre-trade
  path with conditional orders. The retired Go engine stays retired.
- **TigerSwap DEX** (`src/lib/dex/*`, vendored `tigerswap/`): pools
  (v2/stable/weighted/v3), swaps, farms, vaults, lending with flash loans, veTGR,
  bridge, OTC, perps, options, NFT, launchpad — with a documented ledger-invariant
  set and 44-check e2e (`npm run test:e2e:dex`).

### A.3 Custody, deposits, withdrawals — real

- **Deposit scanner** (`wallet/scanner.ts`): per-chain cursor, credit exactly
  once after `confirmations >= required`, guarded status transitions.
- **Reorg reversal** (`reverseReorgedDeposits`): re-validates recent credits,
  withdraws via `debitAvailable`, marks `reorg_shortfall`, places a hold.
- **Withdrawal signing** (`wallet/payout.ts`): HD-derived per-user key
  (BIP-32/44), EIP-155 signing, atomic nonce allocation in `chain_nonces`.
- **2FA on money-out** (`wallet/withdrawals.ts`) with an explicit, auditable
  API-key bypass on `/api/v1/withdraw`.
- Custody tests: `scripts/test/custody.test.cjs` and related.

### A.4 Auth, KYC, admin, security — real

- Email/phone auth, OTP family, TOTP 2FA, password reset, session issue/rotate,
  social sign-in scaffolding, MetaMask challenge/login.
- **Admin console**: `admin_users` (bcrypt) + `admin_sessions`, `requireAdmin()`
  joins both and rejects non-active accounts; admin TOTP 2FA; append-only
  `admin_audit_log` via `recordAdminAction()`; `admin_users` is empty unless
  `TIGEREX_BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD` are set at first migration.
- **Request guards** (`enforceRequestGuards`) rate-limit credential guessing and
  OTP spam on login/register/OTP families.
- **KYC** is in-house (`src/lib/kyc/image.ts`, `mrz.ts`, `submission.ts`), with
  an admin review queue; **sanctions** (`compliance/sanctions.ts`) and
  **proof-of-reserves** reconciliation (`compliance/reserves.ts`) exist.
- **In-house identity checks** (`src/lib/kyc/`): a dependency-free image
  decoder (`png.ts` RGB/RGBA/gray/palette/interlaced, `jpeg.ts` baseline and
  progressive, `decode.ts` dispatch), face detection
  (`face.ts` — YCbCr skin mask, morphological open, connected components,
  size/aspect/fill gate), a liveness assessment (`liveness.ts` — face framing,
  in-frame, Laplacian sharpness, inter-frame motion) and document-to-selfie
  comparison (`match.ts`). `identity-checks.ts` runs them over the applicant's
  own images; `submitApplication` records the result encrypted on the document
  row and surfaces it to the reviewer via `/api/admin/kyc`. A deployment may
  refuse a submission that fails liveness with
  `TIGEREX_KYC_REQUIRE_LIVENESS=1`. No external KYC/face provider is consulted.
  Tests: `scripts/test/kyc-image-decode.test.cjs`,
  `kyc-identity-checks.test.cjs`, `kyc-submission-identity.test.cjs`.
- **Market-integrity surveillance** (`compliance/surveillance.ts`): detects
  self-matching, wash trading, layering and spoofing over a rolling
  `spot_trades`/`orders` window; alerts persist idempotently and are read from
  `GET/POST/PUT /api/admin/surveillance`. Wired into the scheduler cycle.
- **FATF travel rule** (`compliance/travel-rule.ts`): enforced inside
  `createWithdrawal` at a configurable USD threshold, refusing incomplete
  originator/beneficiary data and recording a hash-committed message.
- **Destination risk scoring** (`compliance/address-risk.ts`): scores a
  withdrawal destination from local data only (sanctions match, operator list,
  first-seen, address book) and blocks or queues it accordingly.
- **Withdrawal maker-checker** (`wallet/approvals.ts`): a withdrawal's USD value
  maps to the number of *distinct* admin approvals it needs; the admin action
  route refuses `broadcast` until the tier is met. Tiers at
  `GET/PUT /api/admin/withdrawal-tiers`.
- **API keys** (`api/api-auth.ts`, `api/v1-guard.ts`) with IP allowlists,
  scopes and no secret material returned.

### A.5 Scheduling and ops

- `src/lib/ops/scheduler.ts` runs one idempotent cycle (deposits, withdrawal
  sync, settlement, liquidation, DEX keeper, reserves reconciliation) behind a
  distributed lock; `/api/worker/tick` and an in-process timer both call it.
- Health and metrics modules (`ops/health.ts`, `ops/metrics.ts`).
- Deployment: `Dockerfile{,.api,.ws,.frontend,.admin}`, `docker-compose.yml`,
  `k8s/{api,frontend,production}`, `DEPLOYMENT.md`.

### A.6 Multi-language breadth

- Go backend (`backend/go`: `internal/*`, `services/*`, `cmd/*`) builds and
  tests in CI (305 tests). Rust crates, C++ engine, Python analytics/ML layer,
  five SDKs (`sdks/{go,java,node,php,python}`), a `mobile/` (React Native) and a
  `desktop/` (Tauri) app, and an `integrations/` registry module.

---

## B. What is NOT WORKING (deliberate fail-closed, by design)

These return an explicit error rather than fabricated data. They are correct
behaviour under the "no simulation" rule, but each is a launch blocker until a
real dependency is wired:

1. **Go gateway stubs** (`backend/go/internal/api/gateway.go`): market data,
   order book, trade feed, matching engine + durable ledger, order service,
   account ledger, deposit address derivation, withdrawal history all return
   `unavailable` (`503`). They need real providers bound before the Go gateway
   can serve a live venue.
2. **133 frontend routes proxy to `TIGEREX_BACKEND_URL`** and fail closed with
   `503` when it is unset. With no backend configured, those features are dark
   (e.g. some `orders/history`, `fiat/deposit`, `fiat/withdraw`, `custody/*`,
   `marketMaker/balance`).
3. **Market-maker** has only a proxy route (`/api/marketMaker/balance`) and no
   self-hosted MM bot wired to the venue's own books.
4. **Payment providers** (`TigerEx/payment_integration`) return
   `ErrProviderNotImplemented` for Stripe/Simplex/Moonpay — no live fiat
   on/off-ramp.
5. **`server/admin-system.js`** is real but not mounted by `server/index.js`, so
   its routes are unreachable.
6. **Second Node backend** (`server/index.js`, port 3000) is separate from the
   canonical Go gateway (8080) that `NEXT_PUBLIC_API_URL` points at.
7. **`backend/go/_legacy/`** (19 files) is excluded from the build and must not
   be re-enabled (external-exchange clients, 16 `main()`s, simulated paths).
8. **`TigerEx/*` secondary modules**: many are small, unwired and were sources of
   fail-open stubs; the audited ones are now fail-closed, but they are still not
   mounted into the live path.
9. **`backend/rust/cmd/*`** (~91 crates) are largely generated placeholders;
   ~30 have been audited and made real with tests, the rest remain untrusted.
10. **`core/wallet/crypto.rs`** is orphaned dead code with hardcoded AES keys —
    must not be wired as-is.

---

## C. What is MISSING (features not present or not product-complete)

### C.1 Product / feature gaps

- **Full order-type coverage**: spot lacks OCO, trailing stop, TWAP, post-only,
  FOK/IOC/GTX exposure at the product layer, scale, and trigger orders (the
  orderbook supports TIF internally but the product surface is limit/market/
  stop-limit/stop-market/iceberg).
- **Unified Trading Account (UTA)** across spot/futures/margin/options with
  portfolio margin and multi-asset collateral/haircuts.
- **Portfolio margin** (only cross/isolated exist).
- **Deliverable/quarterly futures**, inverse COIN-M at product level, and
  TradFi-linked instruments (only an admin `tradfi/markets` route exists).
- **Sub-accounts at scale** (300/master) with per-sub-account API keys and
  isolated balances — `account/subaccounts.ts` exists but is not a full product.
- **Copy trading for CEX** is partial; DEX copy is more complete than CEX copy.
- **Public market-data WebSocket contract for the CEX** (depth/trades/kline/
  user-data streams) is not clearly the single documented, versioned contract
  the SDKs and frontends share.
- **Broker / white-label program** (only an admin page + route exist).
- **Affiliate/institutional onboarding, VIP tiers, fee-schedule management** are
  partial.
- **Referral, campaign, competition, coupon, red-packet** modules exist but are
  thin.
- **Mobile and desktop apps** exist as scaffolds, not full parity clients.

### C.2 Engineering gaps

- **Backend routing concentration**: the canonical Go gateway is thin stubs; the
  real logic largely lives in the frontend `src/lib/*` (SQLite). There is no
  single production data store decision made end-to-end — the schema exists for
  PostgreSQL (`TigerEx/database_schema/complete_schema.sql`) while the live
  logic runs on SQLite via `better-sqlite3`. **This SQLite↔PostgreSQL split is
  the single biggest architectural gap for a global venue.**
- **Scalability**: SQLite cannot serve a global, multi-region, high-throughput
  exchange. Matching is per-process; there is no sharded/partitioned matching,
  no horizontally scaled order-book service, no Kafka/Redis-backed fanout in the
  live path (Redis/Kafka are only in config/compose).
- **Market data pipeline**: no real feed ingestion (no exchange-owned trade/order
  ingestion from the Rust engine into the frontend/DB at production volume).
- **Observability**: metrics/health modules exist, but no Prometheus/Grafana
  wiring, no tracing, no SLOs/alerts in the live path (Sentry DSN only).
- **Disaster recovery**: no documented RPO/RTO, backup/restore drills, or
  multi-region failover.
- **Duplicate/overlapping modules** under `TigerEx/` (e.g. `p2p_trading` vs
  `p2p_service`) require consolidation before any "implemented" claim.

### C.3 Data / schema gaps

- The PostgreSQL canonical schema and the SQLite live schema must be reconciled
  and migrated (single source of truth).
- Historical backfill, tick-data retention and archive strategy are undefined.

---

## D. What is STILL A GAP (non-code, but launch-blocking)

These cannot be closed by code alone and are required for a commercial global
launch:

1. **Regulatory licensing** per jurisdiction (VASP/MSB/MiCA/VARA/state MTLs etc.),
   legal entity structure, and terms of service / privacy policy review.
2. **Independent security audit** (application, smart contract, infrastructure,
   key-management) and a bug-bounty program.
3. **Custody assurance**: MPC/HSM key ceremony, separation of duties, cold/hot
   split, proof-of-reserves attestation by a third party, and insurance.
4. **Banking / fiat rails**: payment partners, SEPA/SWIFT/card acquiring, and a
   licensed fiat on/off-ramp (currently `ErrProviderNotImplemented`).
5. **Liquidity**: real market-making and order-book depth (no self-hosted MM bot
   yet; cannot mirror other exchanges).
6. **KYC/AML operations**: analyst staffing, sanctions/watchlist data licensing,
   transaction-monitoring tuning. The transaction-monitoring (market-integrity
   surveillance), travel-rule and destination-risk engines now exist in-repo, but
   a live watchlist feed and analyst staffing remain operations work.
7. **Customer support** (24/7), incident response, and a documented runbook.
8. **Market-integrity monitoring**, delisting policy, and listing review process.
9. **Penetration testing**, WAF/DDoS protection, and rate-limit tuning at load.
10. **Performance/load testing** to a stated TPS/latency target and a capacity
    plan.
11. **Tax reporting** tooling per jurisdiction and user-facing statements.
12. **Accessibility, i18n/localisation QA** for target markets.

---

## E. Prioritised path to "launchable"

**P0 — platform must not lose funds or lie**
1. Single production datastore decision (PostgreSQL) and migration off SQLite.
2. Bind real providers into the Go gateway (market data, ledger, order service,
   custody) so the 133 proxy routes come alive; keep fail-closed until then.
3. Independent security audit + custody/key-management review.

**P1 — product parity**
4. UTA + portfolio margin; full order-type set; deliverable/inverse futures.
5. Self-hosted market-maker bot wired to the venue's own books.
6. Public, versioned market-data + user-data WebSocket contract shared by SDKs.

**P2 — scale and operate**
7. Horizontal matching/order-book scaling; Redis/Kafka fanout; observability
   (Prometheus/Grafana/tracing), SLOs and alerts.
8. DR plan, backups, multi-region failover.

**P3 — go-to-market**
9. Licensing, banking/fiat rails, liquidity, insurance, support, legal docs.

---

## F. Bottom line

TigerEx is a **broad, real, well-tested codebase** with a genuinely strong
self-contained core: a chained double-entry ledger that every money-mover now
writes to and that reconciles, real spot/futures/margin/options/ETF/P2P/DEX
engines, real custody scanning/payout with reorg safety and atomic nonces, and a
real admin/KYC/security stack. It is **not yet a globally launchable commercial
CEX**, because the live path still runs on SQLite, the canonical Go gateway is
fail-closed stubs, fiat rails are unimplemented, there is no self-hosted
market-maker, the data pipeline is not production-grade, and the non-code
licensing/audit/liquidity/insurance work has not been done.

The engineering gap to close first is the **datastore + gateway wiring**; the
business gap to close first is **licensing + audit + liquidity**.
