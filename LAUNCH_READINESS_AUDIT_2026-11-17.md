# TigerEx — Global Commercial Launch Readiness Audit

Date: 2026-11-17
Scope: what works, what does not work, what is missing, and what gaps remain
before TigerEx can launch globally as a commercial CEX comparable to Binance,
Bybit, KuCoin, Coinbase, Gemini, Gate, Kraken, Bitget and Robinhood.

This report is **evidence-based**: every claim below was re-verified against the
running application and the current source tree in this session. It is an
engineering status report, **not** a legal, regulatory or financial-promotion
opinion. A real launch also requires the non-engineering work in Section E.

---

## 0. Method and ground truth

Verified live in this session:

- Built and ran the Next.js app (standalone) against a throwaway SQLite DB and
  exercised the real HTTP API end to end (register → OTP → login → trade).
- Ran every test suite: frontend logic **1142 passed**, Go **30 packages ok**,
  Rust matching-engine **17 passed**, C++ **2/2 suites passed**,
  `npx tsc --noEmit` clean, `go build ./...` clean.

| Layer | Evidence | Count |
| --- | --- | --- |
| Frontend API route handlers | `src/app/api/**/route.ts` | 483 |
| — admin handlers | `src/app/api/admin/**/route.ts` | 83 |
| — proxies to `TIGEREX_BACKEND_URL` | grep `backendBaseUrl` | 126 |
| Frontend pages | `src/app/**/page.tsx` | 138 |
| Frontend logic tests | `npm run test:logic` | 1142 pass |
| Go packages with tests | `go test ./...` | 30 ok |
| Rust matching-engine tests | `cargo test --lib` | 17 pass |
| C++ engine suites | `ctest` | 2 pass |

**Two runtime stacks exist and are not unified.** The *live* money path is the
Next.js app + `src/lib/*` on **SQLite** (`better-sqlite3`, WAL). The *other* stack
is the Go gateway (`cmd/tigerex-api`) + **PostgreSQL** + the Rust matching engine,
which is not wired to the frontend. The 126 proxy routes bridge them only in
theory and mostly 404/503 in practice (Section C).

---

## A. What is WORKING (verified end to end, this session)

### A.1 Authentication — real and correct
- `POST /api/auth/register` → OTP issued and verified → `POST /api/auth/login`
  returns a bearer token that authorises protected routes. Verified with a live
  user (`e2e@example.com`).
- OTP is hashed (SHA-256), **account-bound**, TTL 600 s, 5-attempt cap
  (`src/lib/security/*`). Credential routes pass `enforceRequestGuards`
  (origin + per-IP rate limit).
- Admin console auth is separate: `admin_users` (bcrypt) → `admin_sessions`,
  enforced by `requireAdmin()`. Wrong password returns `INVALID_CREDENTIALS`
  (verified live). Admin 2FA (TOTP, AES-256-GCM secret) is implemented and
  unit-tested.

### A.2 Spot trading — real matching and settlement
- Listed `BTC/RUSD`; placed a resting BUY and a crossing SELL: they matched,
  balances moved, fees were charged. A second **two-user** test (maker resting
  SELL @ 62000×0.02, taker BUY) also matched and settled to both users.
- Verified in the DB: `spot_trades` row written, **12 journal entries / 12 legs,
  every entry sums to zero per asset**, `fees` account accrues the taker fee.
- The engine (`src/lib/trading/spot-engine.ts` + pure `orderbook.ts`) implements
  price-time priority, partial fills, iceberg, self-trade prevention, and
  reconstructs the book from open orders per call.
- Conditional orders work: a `stop_limit` BUY returned `pending_trigger` and is
  parked off-book, then activated on a trade through the stop
  (`activateStopOrders`), with OCO cancellation wired.

### A.3 Derivatives — real math, one-way mode correct
- Opened a 10× long 0.01 BTC/RUSD: margin 60 RUSD locked, fee 0.3 charged,
  liquidation price computed. Moved the oracle, closed it: **realised PnL
  59.67** (= 60 gross − 0.33 close fee), position `closed`, margin released.
- `contract-math.ts` handles linear **and** inverse contracts; funding, ADL,
  risk supervisor (liquidation) all route through it.
- Requires an oracle price: with none, orders fail closed with `NO_MARK_PRICE`
  (correct, but see C — there is no external price feed).

### A.4 Ledger, journal and accounting — strong
- All money moves through `src/lib/db/ledger.ts` (`debitAvailable` /
  `creditAvailable` / `lockAvailable` / `unlockAvailable` / `consumeLocked`),
  spreading a movement across every wallet row for an asset.
- Double-entry journal (`src/lib/db/journal.ts` + `accounting.ts`):
  `recordEntry` refuses a leg set that does not sum to zero, chains entries by
  SHA-256, and `verifyChain()` detects edits. Verified zero-sum on all live
  entries.

### A.5 Custody, compliance, ops — real logic, fail-closed
- HD wallet (BIP-39/32/44), atomic nonce allocation (`chain_nonces`), reorg
  reversal, withdrawal maker-checker tiers, travel rule, address risk scoring,
  sanctions screening, AML case management, market surveillance — all present,
  self-contained, and unit-tested.
- Scheduler (`src/lib/ops/scheduler.ts`) runs deposit scan/confirm/reorg,
  withdrawal sync, settlement, surveillance, AML; triggered by
  `/api/worker/tick` (token-guarded) and a k8s CronJob.

### A.6 Multi-language breadth — real, tested
- Rust `matching-engine` (17 tests), C++ `matching_engine` (2 suites), Python
  analytics (`pytest`), the vendored TigerSwap DEX (28 Foundry suites / 731
  tests). These build and pass. They are **not** in the live CEX money path.

---

## B. What is NOT WORKING (fail-closed by design — each is a launch blocker)

These return an explicit error instead of fabricated data. Correct per the "no
simulation" rule, but each is a missing dependency that must be wired:

1. **Deposits.** `GET /api/wallet/address` returns `{"addresses":[]}` — no
   deposit address is derivable because `TIGEREX_HD_MNEMONIC` and a chain RPC are
   unset. `GET /api/wallet/networks` returns empty. No crypto can be received.
2. **Withdrawals.** `createWithdrawal` fails `CHAIN_NOT_CONFIGURED` — nothing
   can be sent.
3. **Futures without an oracle.** Every order fails `NO_MARK_PRICE`; there is no
   external price feed (Section C).
4. **Margin.** Borrow fails `UNKNOWN_MARKET` — `margin_markets` is unseeded.
5. **Fiat on/off-ramp.** No live provider; the adapters return
   `ErrProviderNotImplemented`. No card/bank rails.
6. **Options.** There is no `/api/options/instruments`; the instruments endpoint
   returns the HTML app shell (unserved route).
7. **126 proxy routes** forward to `TIGEREX_BACKEND_URL` and 503 when it is
   unset. They also target paths the Go gateway does not serve (see C.1), so
   they would 404 even when configured.
8. **Staking product.** `POST /api/staking/stake` is a proxy (not DB-backed) and
   is unreferenced by any view.
9. **Mobile app** hardcodes `https://api.tigerex.com` (`mobile/App.tsx:112`), a
   domain that is not configured anywhere in the repo.

---

## C. What is MISSING (engineering gaps)

### C.1 Backend split — the single biggest gap
- The live venue runs on **SQLite via `better-sqlite3`**. The k8s frontend
  deployment pins `DB_PATH=/data/tigerex.db` with `replicas: 1` and
  `strategy: Recreate` (a ReadWriteOnce volume). This **cannot** serve a global,
  multi-region, high-throughput venue: no horizontal scaling, no sharding.
- The Go gateway + PostgreSQL + Rust engine stack exists and is tested but is
  **not connected** to the frontend. `NEXT_PUBLIC_API_URL` points at a Go gateway
  that (a) serves routes under `/api/v1` and bare paths, while 126 frontend
  proxies call mismatched paths, and (b) reports `unavailable` for market data,
  orders, balances and custody unless a DSN, mnemonic and matching-engine binary
  are all supplied.
- **Verdict:** there is no single production data store or single matching
  authority wired end to end. This must be resolved before scale.

### C.2 Market data — no feed
- Prices exist only as **operator-entered** rows via `POST /api/admin/oracle`.
  There is no external price ingestion, no index/mark feed, no trade-tape
  ingestion from the Rust engine into the live DB. Without this, futures, margin,
  liquidations and funding cannot run on their own.
- Public market data over HTTP works (ticker/depth/klines from own tables) and an
  **SSE** stream exists (`/api/market/stream`), but there is **no private
  user-data WebSocket** (order/fill push). Clients must poll
  (`/api/order/openOrders`, `/api/orders/history`).

### C.3 Derivatives product gaps
- **Hedge mode is broken (confirmed live).** In hedge mode the order side is
  taken from `positionSide` (`futures-engine.ts`), so a "close" long
  (`side:"sell"`, `positionSide:"long"`, `reduceOnly:true`) is classified as an
  **increase**: the position grew 0.03 → 0.04 instead of closing. A hedge-mode
  position **cannot be reduced or closed through the API**. Only one-way mode
  (`positionSide:"both"`, what the current UI sends) closes correctly. Any client
  using hedge mode — a standard Binance/Bybit feature — would silently double
  exposure.
- No unified trading account (UTA) / portfolio margin (only cross + isolated).
- No dated-contract liquidity or listed inverse markets beyond the code path.
- Conditional order coverage at the product surface is limit/market/stop-limit/
  stop-market/iceberg (no product-level trailing-stop/TWAP/post-only/FOK surface).

### C.4 Order types, ops and infra
- **No FIX/binary/colocated API** in the live path (`backend/go/fix_api` exists
  but is unwired).
- **No load/latency test.** The only benchmark is a C++ unit artifact; there is
  no TPS/latency/soak evidence for a matching engine at exchange scale.
- **No Kafka/Redis in the live path** (Redis appears only in `server/index.js`
  and one DEX module); no event fanout, no stream replication.
- **Observability** is `/api/metrics` (Prometheus text) + `/api/health` only; no
  Grafana/tracing/SLOs/alerts wired; no status page or incident tooling.
- **No DR story:** no documented RPO/RTO, backups, or multi-region failover for
  the SQLite volume.
- **i18n:** 32 languages declared, only `en` + `zh` real; the rest alias to `en`.
- **`/api/v2`** is documented in `docs/openapi.yaml` but does not exist.

### C.5 Breadth items (present but not product-complete)
Sub-accounts (cap exists, not a full product), CEX copy trading (partial),
broker/white-label, affiliate/VIP/rebate programs (thin), mobile/desktop clients
(scaffolds, not parity). 173 folders under `TigerEx/` are mostly unwired
secondary modules with duplicate concepts (e.g. `p2p_trading` vs `p2p_service`).

---

## D. What is STILL A GAP (non-code, launch-blocking)

These are not code defects but gate a commercial global launch and are not
present in the repository:

1. **Licences / regulatory registration** per jurisdiction (VASP, MiCA, MSB,
   MTL, etc.) and a licensing roadmap.
2. **Jurisdiction gating at onboarding** — restricted-country blocking on
   registration/KYC (compliance modules exist; the geo gate is not enforced as a
   product control).
3. **Independent security audit** of the custody/matching code by a third party
   and a published bug-bounty program.
4. **Proof-of-reserves attestation** by an auditor (the Merkle-tree code exists;
   the attestation does not).
5. **Banking / fiat partnerships** and a live PSP integration.
6. **Market-making / liquidity** so order books are not empty at launch.
7. **Customer support** (24/7 desk, ticketing), legal terms, AML/CFT program
   sign-off, and an incident/comms plan.
8. **Insurance** for hot-wallet exposure and a cold-storage custody policy.

---

## E. Prioritised path to a launchable venue

**P0 — correctness (do first):**
1. Fix the hedge-mode reduce bug in `futures-engine.ts` and add a regression test
   asserting the position shrinks and balances settle (not just a status field).
2. Wire a real price feed (external index + mark) so derivatives/liquidations
   run without manual oracle entry.

**P1 — the platform (do next):**
3. Choose one production stack (Go gateway + PostgreSQL + Rust engine) and wire
   the frontend to it; retire or repoint the 126 mismatched proxies.
4. Replace SQLite with the Postgres store for all live money paths; make the
   matching authority the Rust engine with a durable, replicated store.
5. Add private user-data streams (WS) and a versioned public market-data contract.
6. Wire custody: HD mnemonic + chain RPC + KMS/HSM so deposits/withdrawals work.

**P2 — scale and ops:**
7. Redis/Kafka fanout, horizontal order-book service, load/soak/latency tests
   with published TPS targets.
8. Observability (metrics/tracing/SLOs/alerts), status page, DR plan with
   RPO/RTO and drills.

**P3 — product and compliance breadth:**
9. UTA/portfolio margin, full order-type surface, sub-accounts, broker program,
   CEX copy trading, fiat rails, real i18n.
10. Licences, jurisdiction gating, external audit, PoR attestation, support.

---

## F. Bottom line

TigerEx is a **genuinely working single-node CEX core**: auth, spot matching and
settlement, one-way derivatives with real PnL, a zero-sum double-entry ledger,
custody/compliance logic, and multi-language engines — all verified and tested
(1142 + 30 + 17 + 2 tests green).

It is **not launch-ready as a global commercial exchange**. The blockers are
structural, not cosmetic:

- the live venue runs on a **single-node SQLite** instance;
- the Go/Postgres/Rust production stack is **not wired** to the frontend;
- there is **no price feed**, so derivatives/margin/liquidations are manual;
- **deposits and withdrawals cannot move funds** (no chain/KMS configured);
- a **confirmed hedge-mode bug silently doubles exposure** instead of closing;
- and the entire non-engineering layer (licences, audit, banking, liquidity,
  support) is absent.

Realistic read: the code core is a strong, honest foundation; the distance to a
Binance/Coinbase-class launch is a **platform re-architecture plus the full
regulatory/operational stack**, not a bug-fix sprint.
