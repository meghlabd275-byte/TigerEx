# AGENTS.md

Repository-specific knowledge for agents working in TigerEx.

## Delivery policy — read first

Commit and push **directly to `main`**. Do not open pull requests, and do not
create feature branches for normal work. This is the repository owner's explicit
standing instruction and it overrides the default branch-and-PR workflow.

- Push every completed change to `origin main` in the same session.
- Keep commits scoped and give each one a message that explains what changed and
  why, since there is no PR description to carry that context.
- Verify before pushing (`go build ./...`, `go test`, `cargo test`, `ctest`,
  `npx tsc --noEmit`, `node --test`) — nothing is gated behind review now.

## Repository layout

TigerEx is a multi-language crypto exchange:

- `backend/go` — Go services. Module `tigerex/backend`, Go 1.21 in `go.mod` (CI uses 1.23).
  - `cmd/*` — runnable binaries. `cmd/API` is the HTTP API.
  - `internal/*` — reusable libraries (`api`, `wallet`, `admin`, `trading`, `perpetual`, `services`, ...).
  - `services/*` — domain services (`auth`, `trading`, `order`, `kyc`, `p2p`, ...).
- `backend/rust` — Rust crates. `matching-engine`, `wallet`, `derivatives`, `cold_wallet`, ...
- `backend/cpp` — C++ low-latency engine (`hft_engine`).
- `TigerEx/` — Next.js frontend, plus a separate `rest_api_gateway` / `websocket_gateway` Go module.
- `TigerEx/database_schema/complete_schema.sql` — canonical PostgreSQL schema, applied by `server/db/migrate.js`.

## Where the matching engine lives

The authoritative matching engine is **Rust** (`backend/rust/matching-engine`). Do not
add a second matching engine in Go: the legacy Go engine that used to sit at
`backend/go/*.go` was retired for exactly this reason.

The latency-critical C++ engine at `backend/cpp/matching_engine` (spot order book,
risk checks, fixed-point arithmetic) is the pre-trade path, not a second engine:
it prices and matches an incoming order, the Rust engine is the settlement
authority. Conditional orders (StopLoss, TakeProfit, OCO, TrailingStop) are
implemented there: they park off-book in `MatchingEngine::conditional_orders_`
and are activated by `check_conditional_orders`, which the engine calls itself
after every trade. `execute_match` rejects a conditional type that reaches it
unactivated — that is a programming error, not a supported path.

## Retired legacy Go code

`backend/go/_legacy/` holds an earlier, unreferenced generation of the Go backend
(19 files: `admin_service.go`, `complete_api_gateway.go`, `exchange_api_clients.go`, ...).
It is excluded from the build by the `_` directory prefix. Do not re-enable it or
copy code out of it without review:

- It contains clients for third-party exchanges (Binance, OKX, Bybit), which
  violates the project rule that TigerEx never depends on another exchange.
- It contains 16 competing `main()` functions and duplicate type declarations.
- Parts are simulated (KYC/AML screening, some wallet paths).

The supported implementation is `internal/*` + `services/*` + `cmd/*`.

## Admin console

The admin console authenticates against `admin_users` (bcrypt) and opens a
session in `admin_sessions`; that token is a distinct privilege from a trader
session, so `readAuthToken()` is not sufficient for an admin route. Admin
routes call `requireAdmin()` from `src/lib/auth/admin.ts`, which joins
`admin_sessions` to `admin_users` and rejects a non-active account.

`admin_users` is empty unless `TIGEREX_BOOTSTRAP_ADMIN_EMAIL` and
`TIGEREX_BOOTSTRAP_ADMIN_PASSWORD` (16+ chars) are set at first migration. No
default account or password is ever created.

Sign-in is `/admin/login`, which posts to `/api/admin/auth/login` and stores the
returned token under `localStorage['tigerex_admin_token']`; `/api/admin/auth/logout`
deletes the `admin_sessions` row. Both `/api/admin/auth/login` and every trader
auth route (`/api/auth/login`, `/api/auth/register`, the OTP send/verify family)
pass `enforceRequestGuards` first, so credential guessing and OTP spam are
rate-limited per client address.

Every administrative mutation appends to `admin_audit_log` via
`recordAdminAction()`. The trail is append-only; `/api/admin/audit` reads it
and nothing updates or deletes it.

## Market listing

Listing is native and DB-backed, and does not need an external backend:

- `POST/GET/PUT/DELETE /api/admin/pairs` — spot pairs (`trading_pairs`),
  validated by `src/lib/markets/listing.ts`.
- `POST/GET/PUT/DELETE /api/admin/futures/markets` — linear (USDT/USDC/RUSD/
  RYUSD/TGR-margined), inverse (COIN_M) and dated contracts
  (`futures_markets`), validated by `src/lib/markets/futures.ts`.
- `POST/GET/PUT/DELETE /api/admin/margin/markets` — cross and isolated margin
  (`margin_markets`), same module. An isolated pool is the same row with
  `mode = 'isolated'`, so it needs no separate table.

Validation is fail-closed and unit-tested (`scripts/test/listing.test.cjs`,
`scripts/test/futures.test.cjs`). Notable invariants: a perpetual must not
carry a `deliveryTimeNs` and a dated contract must; `initialMarginRate` must be
at least `maintenanceMarginRate`; each collateral asset's LTV must be below
*its own* entry in `liquidationThresholds`; a fee is a fraction in `[0, 1)`.
`minNotional` defaults to 1, never 0.

## Build and test

```bash
cd backend/go
go build ./...          # must be green
go test ./...           # must be green
```

C++ matching engine (no OpenSSL; it uses no crypto primitives, so requiring the
dev headers only blocked builds):

```bash
cd backend/cpp/matching_engine
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j
ctest --test-dir build --output-on-failure   # 2 suites, both must pass
```

Frontend:

```bash
npx tsc --noEmit        # must be green
npm run test:logic      # pure-logic suite
npm run build           # must be green
```

## Auth token keys (frontend)

Trader sessions are written to `localStorage['tigerex_access_token']`; the admin
console writes `localStorage['tigerex_admin_token']`. Nothing writes
`tigerex_token`, `token` or `auth_token`. Read the token through
`readAuthToken()` in `src/lib/auth/token.ts` rather than touching
`localStorage` directly — 22 views once read the dead keys and therefore sent
no credential.

## Frontend data routes

`src/app/api/**/route.ts` splits into two kinds:

- **Same-origin handlers backed by `src/lib/db`** (`/api/wallet/balance`,
  `/api/market/ticker24h`, `/api/market/exchangeInfo`, `/api/candles`, the
  `/api/auth/*` and `/api/admin/*` families). These work with no external
  backend and are what self-contained views should call.
- **Proxies to `TIGEREX_BACKEND_URL`** (`src/lib/backend-url.ts`). They fail
  closed with 503 when the backend is unset. Do not give them a default host.

Before wiring a new view, confirm the route exists under `src/app/api`; the
mounted terminal page used to call `/api/orders`, `/api/positions`,
`/api/balances` and `/api/market/candles`, none of which were ever served.

CI (`.github/workflows/ci.yml`) runs:

```bash
cd backend/go
go test -mod=mod . ./internal/api ./internal/wallet ./internal/perpetual \
  ./internal/admin ./internal/trading ./services/admin ./cmd/admin_service
```

## Database schema (canonical)

`TigerEx/database_schema/complete_schema.sql` is applied by
`server/db/migrate.js`, which `server/index.js` calls on every startup (and
exits the process if it fails). Two rules follow from that:

- The file must stay valid PostgreSQL. It once used JavaScript `//` comments
  on line 1, which PostgreSQL rejects, so migration failed and the API could
  never start. Comments are `--`.
- The migration re-runs on every boot, so every object needs a guard:
  `CREATE TABLE/INDEX IF NOT EXISTS`, and `DROP TRIGGER IF EXISTS` before
  `CREATE TRIGGER`. Do not add a second `CREATE TABLE` for an existing table.

`server/index.js` queries must match this schema. `orders` and `trades` have no
`symbol` column (only `market_id`), so symbol filters and tickers join
`markets`. Timestamps are `trades.timestamp` and `orders.created_at`; fees are
`maker_fee`/`taker_fee` selected by `trades.role`; counterparties are
`taker_user_id`/`maker_user_id`. `wallets` uses `locked_balance`, `kyc_records`
uses `level`, and `users` has `jurisdiction` (not `country`).

## Admin backends (two exist)

The canonical API is the Go gateway (`backend/go/internal/api/gateway.go`,
served on 8080; the frontend's `NEXT_PUBLIC_API_URL` points at it). Its order,
balance, deposit and withdrawal handlers are deliberate fail-closed stubs that
return `unavailable` — this is the "no simulation" rule, not a bug.

`server/index.js` (Node, port 3000) and `server/admin-system.js` are a second,
separate backend. `admin-system.js` is real but is not mounted by
`server/index.js`, so its routes are currently unreachable.

## CI status

- `CI` passes: `backend-go` (build + test), `test` (REST/WebSocket gateway, admin
  panel, frontend type-check), `rust`, `cpp-matching-engine`, `build` (Next.js).
- `Dependency security audit` and `Security Scanning` fail on `main` too. Those
  failures come from npm/Next.js frontend advisories, not from the Go code.
- The WebSocket upgrader lives once, in `internal/ws/handler.go`, with an explicit
  `TIGEREX_CORS_ORIGINS` allowlist and a handshake timeout. Do not add a second
  `upgrader` var in `internal/ws`.

## Engineering conventions

- **No simulation or fabricated data.** Fail closed with an explicit error rather
  than returning placeholder prices, balances, addresses, or success responses.
- **No dependency on other exchanges.** No Binance/OKX/Bybit APIs, no liquidity
  mirroring, no third-party KYC (Sumsub) or custody (Fireblocks) providers.
- **Never return secret key material.** Seed phrases, private keys and signing
  material must never be serialized into an HTTP response or written to logs.
- Use parameterized SQL only. The schema uses UUID primary keys and `DECIMAL`
  amounts; pass amounts as strings.
- Compare timestamps in SQL through `datetime()`, never lexically. Rows store
  `created_at` as `datetime('now')` (`YYYY-MM-DD HH:MM:SS`), but a window bound
  built with `Date.toISOString()` is `...THH:MM:SS.sssZ`. The literal `T` sorts
  after the space, so `created_at >= ?` silently drops every row. Write
  `datetime(created_at) >= datetime(?)` instead.
- Move balances only through the ledger (`src/lib/db/ledger.ts`). An asset can
  live in more than one balance row (one per wallet type), so `availableBalance()`
  is a total across rows. Checking that total and then debiting a single row
  (`ORDER BY ... LIMIT 1`) drives the chosen row negative and strands funds on
  release. Use `debitAvailable`/`creditAvailable`/`lockAvailable`/`unlockAvailable`/
  `consumeLocked`, which spread a movement across every row that holds the asset.
- A movement between accounts must be zero-sum: debit the payer, then credit the
  receiver from exactly what was collected. Never credit a receiver with a fresh
  balance while routing the payer's money elsewhere — that mints the asset.
  `applyFunding` (`src/lib/trading/futures-engine.ts`) is the reference: payers'
  funding pays the receivers pro rata; only an unsettleable payer's surplus goes
  to the insurance fund, and a shortfall scales receivers down instead of being
  conjured. Rewards likewise come from a funded account (`earn_rewards` in
  `treasury_accounts`), never from nothing.
- Read a zone-less DB timestamp in JS through `parseUtcTimestamp` in
  `src/lib/trading/candles.ts`, not `Date.parse`. `Date.parse` treats
  `YYYY-MM-DD HH:MM:SS` as local time, shifting it by the host offset; the
  helper reads that shape as UTC and leaves a zone-carrying value to
  `Date.parse`.
- Write Go error paths so that a missing dependency (DB, Redis, RPC) surfaces as
  an error, not as a zero value.

## Rust backend (`backend/rust`) status

`cargo test --lib` in `backend/rust` (crate `tigerex-security`) passes: 31 tests.

The `backend/rust/cmd/*` directories are ~91 independent crates. Many were
generated placeholders whose functions returned fabricated constants and
fail-open booleans. Treat any `cmd/*/src/lib.rs` you have not personally
verified as untrusted. Each crate is its own Cargo project: run
`cargo test --lib` from inside the crate directory, not the repo root.

Audited and made real (each has tests):

- `hsm` - Ed25519 key store; `verify` no longer returns `true` unconditionally.
- `mpc` - Shamir sharing over GF(256) with threshold signing (was literal strings).
- `identity_v2` - DIDs and credentials from real Ed25519 keys (was a constant DID
  and an always-true verifier).
- `regulatory_ai` - jurisdiction/KYC/sanctions rule engine (was always compliant).
- `aml_ai` - graduated risk scoring (was fixed 0.1 / 10k threshold).
- `oracle` - median of fresh validated sources with a deviation guard (was
  echoing any f64, including NaN and negatives).
- `funding`, `margin`, `collateral`, `insurance_fund`, `treasury`,
  `referral_program`, `incentives`, `order_auction` - real accounting and risk
  math (were constants, missing validation, or prefix-match bugs).
- `websocket_v2`, `rest_api_v2` - wired to the real `marketdata` crate.

Known remaining placeholder crates in `cmd/` (not yet audited), e.g.
`audit`, `subaccount`, `prime_brokerage`, `social_trading`, `yield_optimizer`,
`metrics`, `reports`, `migrations`, and others. Prefer fixing the ones that
guard funds, auth, or market data first.

Conventions for these crates: return `Result` with a typed error enum, reject
non-finite and non-positive amounts, fail closed on unknown keys/symbols, and
add a `#[cfg(test)] mod tests` that asserts the failure cases the old code got
wrong.

## TigerSwap (the DEX)

`src/lib/dex/*` is the DEX logic and `src/app/api/dex/**` + `src/app/dex/**`
expose it; the admin side is `src/app/api/admin/dex/**` + `src/app/admin/dex/**`.
It is self-contained: no Uniswap/Pancake/1inch/GMX/Hyperliquid SDK or API is
consulted, the router is local, and an empty table yields an empty result rather
than a placeholder.

Pool kinds and their invariants:

- `v2` — constant product over `reserves`.
- `stable` — StableSwap, needs a positive `amplification`.
- `weighted` — `weights` is a JSON **number** array that sums to 1, parsed with
  `parseNumberArray`. Parsing it with `parseStringArray` rejected every weighted
  pool and made `loadActivePools` throw, which took down the router for all pairs.
- `v3` — concentrated. Active liquidity is derived from the seeded reserves at
  creation, and a swap writes its new `sqrt_price` back. A pool created with
  zero liquidity could never be quoted or traded, and skipping the price write
  made every following quote price against the pre-trade price.

`PUT /api/admin/dex/pools` is a partial update (`validatePoolUpdate`): it writes
only the fields present, so a status or fee change never rewrites tokens or
reserves. A PUT that must resend the whole row would silently zero a pool.

### DEX ledger invariants (the ones that guard funds)

Every DEX settlement moves real balances through `src/lib/db/ledger.ts`; nothing
may credit a balance the venue did not take in. The rules the code must keep:

- **A locked reservation equals the position it backs.** A perpetual locks its
  margin on open, so close must `unlockAvailable` and then move only the *net*
  (realised PnL, which already carries both fees) — never credit the margin back
  on top of the unlock. The same shape applies to a liquidation: the unlock
  already returns the margin, so move only the seized part (`debitAvailable` of
  `collateral - max(0, equity - penalty)`), never credit the surviving equity on
  top of it. Crediting either back let a trader mint settlement asset by opening
  and closing, or by being liquidated.
- **A seizure consumes the locked collateral, it does not unlock it.**
  `liquidateBorrow` credits the liquidator the seized collateral, so the
  borrower's copy must leave entirely: `consumeLocked`, never `unlockAvailable`.
  Unlocking moved the collateral into the borrower's *available* balance while
  the liquidator was also credited it, minting a second copy.
- **Funding is a zero-sum transfer between reservations.** It moves locked
  balance from payers to receivers (`consumeLocked` / `creditLocked`), never from
  available, so the reservations still add up to the collateral afterwards. It
  previously changed only `dex_perp_positions.collateral`, which left a receiver
  unable to close ("insufficient locked balance").
- **The gasless allowance counts sponsored swaps, not every swap.** A sponsored
  swap is recorded with `dex_swaps.sponsored = 1`, and `claimSponsoredSwap` counts
  only those rows for the day. Counting all of a trader's swaps let a busy trader
  exhaust the free allowance with swaps they paid for.
- **An OTC block settles against desk inventory, never the book.** `requestQuote`
  prices from the venue's own order book, and `executeQuote` then settles the
  block bilaterally against `dex_otc_desk:<ASSET>` (funded with `fundOtcDesk`) at
  the quoted price, so a large order moves no book price. The desk leg fails
  closed with `DESK_INVENTORY_LOW` when it does not hold what it would deliver,
  so a fill cannot conjure inventory; the quote's spread is the desk's revenue
  and is booked to the treasury, leaving the two legs balanced.
- **Rewards are paid from a funded account, not minted.** Farms settle against
  `dex_farm_rewards` in `treasury_accounts` (`fundFarmRewards`); a shortfall stays
  pending and is paid after a top-up rather than conjured. A farm with no funding
  pays zero.
- **The veTGR fee share is distributed from its pot, once per epoch.**
  `recordDexRevenue` credits the veTGR bucket to `dex_vetgr_fees`; the keeper's
  `distributeVetgrFees` debits that account and pays the lockers pro-rata by
  locked amount (the last holder takes the remainder so the parts sum exactly),
  and stamps the epoch so a per-cycle keeper pays once an epoch. With nothing
  locked the fees stay in the account, never paid to nobody.
- **Lending interest is a debt/supply adjustment, not a balance credit.**
  `accrueInterest` raises the borrower's debt and the market's `total_supply` (the
  supply position's claim), keeping a reserve cut; no user balance moves, so it
  cannot mint spendable funds. The market's `last_accrued_at` bounds the interval.
- **A protocol fee is withheld from the payer, never booked on its own.**
  `executeSwap` subtracts the settlement fee from the output *before* crediting
  the trader and books exactly that amount as revenue. Booking revenue without
  debiting the payer credited the treasury tokens no one gave up.
- **A pool's fee split is a carve-out, not a parallel credit.** A swap leaves the
  whole fee in the pool's reserves, so the LP share is already owned there; every
  other bucket (veTGR, treasury, insurance, burn) is removed from the pool
  (`applyPoolDeltas` returns the reserves it wrote, and the settlement subtracts
  the non-LP share) before `recordDexRevenue` credits it. Leaving the full fee in
  the pool *and* crediting the protocol shares counted the fee twice and grew the
  total supply by the treasury share on every swap.
- **A perpetual's PnL is settled against a funded counterparty pool, not
  minted.** The venue is the other side of every perp, so a realised gain is paid
  out of `dex_perp_pool` in `treasury_accounts` (`fundPerpPool` seeds it) and a
  realised loss (or a liquidation's seized margin, less the penalty the protocol
  books) is banked into it. A winning close on an empty pool fails closed with
  `REWARD_FUND_EMPTY` rather than crediting the trader value nobody posted; a
  liquidation that only deleted the seized margin destroyed value the pool was
  owed.
- **A borrow draws only the liquidity the lenders supplied.** `borrow` caps the
  amount at `total_supply - total_borrow`, matching `withdrawSupply` and
  `flashLoan`; without it the borrower was credited tokens the market never held.
- **A liquidation penalty is split against real value, never double-booked.**
  `liquidatePosition` books the insurance share to the backed `dex_insurance`
  account (which mirrors `insurance_funds`) and pays a named liquidator its
  bounty; booking the whole penalty to the treasury *and* incrementing
  `insurance_funds` separately made the insurance row an unbacked claim. With no
  named liquidator (the keeper, or an admin force-liquidation) the whole penalty
  goes to insurance, so the split always sums to the penalty exactly.
- **A liquidation bonus is the liquidator's whole reward, not revenue.**
  `liquidateBorrow` credits the liquidator the seized collateral and must not
  also book the bonus through `recordDexRevenue`, which would credit the treasury
  the same value a second time.
- **A bribe and a launch raise are escrowed transfers, not records.** A bribe
  debits the sponsor into a per-bribe account (`dex_bribe_escrow:<id>`) that
  `claimBribe` pays voters from; a launch contribution escrows the quote in
  `dex_launch_escrow:<projectId>` that `claimRaise` pays the project. Recording
  either without moving the funds left the venue owing tokens it never received.

When adding a settlement path, ask which of these it is and make the ledger
match the position row; then assert the *resulting balances* in a test, not just
the status column.

## Next.js version (frontend)

The frontend is on **Next.js 15.5**. Two things that bite:

- A route handler's dynamic segment is a promise:
  `context: { params: Promise<{ id: string }> }`, then `await context.params`.
  The synchronous `{ params: { id } }` form fails the production build with
  "invalid GET export".
- Every route that reads the database or the clock must export
  `dynamic = 'force-dynamic'`. Without it Next prerenders the handler once at
  build time and serves that frozen body forever — `/api/dex/pools` returned an
  empty list while the database held real pools, and `/api/stats` froze its
  timestamp at build time.

Frontend checks: `npx tsc --noEmit`, `npm run test:logic` (701 tests),
`npm run build`, `npm run test:e2e:dex` (44 checks). Clear `.next` before `tsc`
after a dependency or route change, or stale generated types under `.next/types`
produce phantom module errors.
