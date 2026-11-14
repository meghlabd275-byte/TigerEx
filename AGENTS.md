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
- The authoritative record of a money movement is the append-only double-entry
  journal (`src/lib/db/journal.ts` + `src/lib/db/accounting.ts`), not the
  `balances` table. `balances` is a materialised view; the journal is the source
  of truth. `recordEntry` refuses a leg set that does not sum to zero per asset,
  and chains each entry to the one before it by SHA-256, so an edited or
  re-ordered entry is detectable with `verifyChain()`. Every entry is meant to
  be written in the same SQLite transaction as the balance move it describes.
  Custody moves call `recordDeposit`/`reverseDeposit`/`recordWithdrawal`/
  `reverseWithdrawal`; a spot fill calls `recordTrade` (two balanced entries,
  one per asset, each fee accruing to the `fees` account). `reconcileJournal()`
  compares the journal's net user holding per asset against `balances` and
  reports drift; `GET /api/admin/journal` exposes both. Removing the newest
  entry is a valid chain prefix, so the head hash needs an external anchor to
  catch a truncated tail. Do not write a balance outside the ledger, and do not
  add a balance-mutating path without a matching journal entry.
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

Also audited and made real (each has tests): `audit` (SHA-256 hash-chained,
tamper-evident log), `subaccount` (unique ids, 300-per-parent cap, per-parent
unique names), `prime_brokerage` (tiered fee discount, no flat 10%),
`social_trading` (no id collision, no self-copy), `yield_optimizer`,
`metrics` (rejects empty keys and non-finite gauges), `reports` (real gain
lots, not filename strings) and `migrations` (tracks state, refuses a rollback
that would skip applied migrations). `cargo test --lib` in each of these eight
crate directories passes (45 tests total).

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
- **Copy trading has two settlement paths.** `copy-engine.ts` mirrors a leader's
  CEX fills; `dex/copy-service.ts` mirrors a leader's TigerSwap swaps. The DEX
  path records each mirror in `dex_copy_mirrors`, whose unique index on
  `(follow_id, leader_swap_id)` guarantees a leader swap is copied at most once,
  and the mirror row is written in the same step as the swap so a crash cannot
  double-copy. `POST /api/dex/copy` settles pending mirrors from the follower's
  own balance; a mirror the follower cannot fund is skipped and reported rather
  than aborting the batch. `runKeeperCycle` also settles every active follower's
  pending DEX mirrors (`runDexCopySweep`), so a copy settles on the keeper's
  schedule and not only when the follower opens the page.
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

## Vendored TigerSwap (TigerEx DEX mode)

`tigerswap/` is a vendored copy of the standalone
[`meghlabd275-byte/TigerSwap`](https://github.com/meghlabd275-byte/TigerSwap)
repository, integrated here as TigerEx's on-chain DEX layer. It is a real,
tested subtree — not a placeholder — and its own CI/build artifacts are
git-ignored, so it never affects the root Next.js build.

The vendored copy tracks upstream `TigerSwap` `main`. When upstream lands fixes,
re-vendor and re-apply the local-only additions listed under "TigerSwap
local-only deltas" below; `git -C <upstream> log` shows what moved.

What it adds that the root repo did not have: a **Solidity contract layer**
(26 contracts: V2/V3 factory, router, stable and weighted pools, zap, TWAP,
options, perps, lending with flash loans, veTGE vote-escrow, staking, bridge,
OTC, NFT marketplace, meme launchpad, locker, governance, price oracle, quoter,
call-based `TigerSwapSafeERC20`) with **28 Foundry test suites / 731 passing
tests**, plus an independent Go DEX backend (aggregator, order matching,
indexer, AMM, a Rust-engine bot control plane) and a small Next.js DEX UI.

Wiring rules:

- `tsconfig.json` excludes `tigerswap/**`, so the root `tsc` and `next build`
  never compile the vendored app. Do not remove that exclude.
- `.gitignore` ignores `tigerswap/contracts/{out,cache,lib}`,
  `tigerswap/**/node_modules`, `tigerswap/**/.next` and
  `tigerswap/frontend/.test-build`. Third-party Solidity deps are **not**
  vendored; `tigerswap/contracts/install-deps.sh` fetches the pinned revisions
  (`forge-std` v1.9.4, OpenZeppelin v5.0.2 — OZ is pinned to a tag whose
  `pragma` is satisfiable by `solc 0.8.20`). `foundry.toml` sets
  `skip = ["lib/**"]` so the vendored third-party test trees are not compiled.
- The vendored `go.mod` declares `go 1.26.0` and builds with that toolchain.
- CI jobs `tigerswap-contracts` (`forge build`/`forge test`), `tigerswap-go`
  (`go build`/`go test`), `tigerswap-rust` (`cargo test`), `tigerswap-cpp`
  (cmake + ctest), `tigerswap-python` (SDK + ML pytest) and `tigerswap-java`
  (`build.sh`) keep every vendored layer green.

Verify locally:

```bash
# contracts (needs Foundry; deps are fetched by the script)
cd tigerswap/contracts && ./install-deps.sh && forge build && forge test

# Go backend (needs Go 1.26+; auto-downloads via the toolchain directive)
cd tigerswap/backend && go build ./... && go test ./...
```

## TigerSwap security audit (2026-11)

Line-by-line audit of the vendored DEX layer. Five real defects were found and
fixed, each with a regression test that fails against the old code:

1. **Cross-site WebSocket hijacking** — `backend/go/distributed/{cache,trading}`
   set `CheckOrigin: func(...) bool { return true }`. Now same-origin /
   `TIGEREX_WS_ALLOWED_ORIGINS` allowlist, matching `order_matching`.
   `trading/origin_test.go` covers it; keep that test when re-vendoring, since
   upstream still ships the fail-open `CheckOrigin`.
2. **Governance could never execute** — `TigerSwapGovernance.executeProposal`
   built calldata with `abi.encodeWithSignature(sig, calldatas[i])`, passing the
   encoded args as a single argument, so every call reverted. Now prefixes the
   selector to the encoded args (blank signature forwards verbatim).
3. **Bridge threshold fail-open** — `TigerSwapBridge.completeBridge` required
   `valid >= validatorThreshold`, and the threshold defaults to 0, so a bridge
   deployed without `setValidatorThreshold` accepted an empty signature set and
   released locked funds. Now reverts `THRESHOLD_NOT_SET` when unset.
4. **Staking ignored ERC20 returns (SWC-104)** — `TigerSwapStaking.stake/
   withdraw/getReward` did not check transfer results, so a false-returning
   token let `stake` mint phantom balance and `withdraw` zero a balance without
   paying. Now checked. `test/FalseReturnERC20.sol` exercises this.
5. The two Go origin checks and the four contract fixes are covered by new
   tests.

Upstream later re-worked the same surface with a call-based
`TigerSwapSafeERC20` helper (accepts a zero-length return like USDT, rejects an
explicit `false`) and routed every ERC-20 transfer through it. The vendored copy
has both: the helper plus the local regression tests. The liquidation-bot seizure
clamp is a local-only fix — upstream still computes `seize = repay + bonus`
unclamped, which over-reports collateral and can yield a negative bonus on a
deeply underwater position; the vendored copy clamps to the collateral value
(`backend/rust/bots/src/guard.rs`) with tests.

## TigerSwap local-only deltas (re-apply after re-vendoring)

These are in the vendored copy but not in upstream `TigerSwap` `main`:

- `backend/go/distributed/trading/main.go` + `origin_test.go` — origin allowlist.
- `backend/rust/bots/src/guard.rs` + `tests/bots.rs` — liquidation seizure clamp.
- `contracts/foundry.toml` — `skip = ["lib/**"]`.
- `contracts/install-deps.sh`, `contracts/test/FalseReturnERC20.sol` — dep pinning
  and the false-return token, used by the staking regression test.
- `contracts/test/TigerSwapGovernance.t.sol` — double-execute, timelock and
  blank-signature-value tests.

Verified clean (no change needed): lending/margin interest index math,
perps payout caps and liquidation, options LP-collateral reservation and
Black-Scholes, the xyK/stable/weighted/concentrated AMM math, meme bonding
curve, veTGR decay, locker boost math, oracle median + staleness, vault
inflation mitigation, and the Go matching engine (price-time priority,
self-trade prevention, maker pricing). No SQL string concatenation, no
hardcoded secrets, no fake data.

## Secondary TigerEx/ modules (audited, fail-closed)

The `TigerEx/` tree holds several secondary modules beside the canonical
`backend/go` + `src/lib` code. They are small, mostly unwired, and were a rich
source of fail-open stubs. Each of these is now fail-closed and gated in CI
(`.github/workflows/ci.yml`, job `test` for Go and job `rust` for the crates):

- `TigerEx/kyc_aml` — `VerifyDocument` requires a `DocumentVerifier` and refuses
  without one; `runInitialAMLScreening` consults an `AMLScreener` and records
  PENDING (never a fabricated PASS) when none is set; `UpgradeKYC` returns the
  profile to review; `ScreenTransaction` flags real structuring. Test:
  `go test ./...` from `TigerEx/kyc_aml`.
- `TigerEx/payment_integration` — the Stripe/Simplex/Moonpay adapters return
  `ErrProviderNotImplemented` rather than `(nil, nil)`; a nil refund result is
  rejected so `RefundPayment` cannot dereference it.
- `TigerEx/health_check` — `DatabaseCheck`/`RedisCheck`/`APICheck` dial the real
  dependency and report unhealthy when the address is unset.
- `TigerEx/mpc_wallet`, `TigerEx/hardware_wallet`, `TigerEx/self_custody_wallet`
  — key-material operations return a typed error instead of a fabricated
  address, signature or balance. Run each with
  `rustc --edition 2021 --crate-type lib --test <path> -o /tmp/x && /tmp/x`.

`TigerEx/compliance_and_regulatory/reporting_system/compliance.py` files a CTR
only through a real sink and screens only against a loaded sanctions list;
`pytest` in that directory covers the fail-closed paths.

Deliberately not changed (verified, not defects):

- The WebSocket origin checks in `TigerEx/websocket_gateway/cmd/server.go`,
  `TigerEx/distributed_exchange_backend` and `backend/go/rest_api_gateway` allow
  a *missing* `Origin` header for native/mobile clients, which never send one.
  Browsers always send it, so this is not a cross-site hijack vector; requiring
  it would break those clients. Lookalike/other-origin requests are rejected.
- `core/wallet/crypto.rs` is orphaned (no `Cargo.toml`, referenced by nothing) and
  its `TimeLock`/`SessionToken` use hardcoded AES keys. It is dead code with
  sample data, not a live path; do not wire it as-is.

## TigerSmartChain integration surface (registry-driven)

Chains and tokens are operator configuration, never compiled in. A chain exists
only once an admin lists it; nothing dials a node the operator did not
configure.

- `src/lib/chains/` — `chain-networks.ts` (EVM aliases, EIP-55 checks),
  `evm-rpc.ts`, `registry.ts` (`blockchain_chains` / `blockchain_tokens` in the
  DB, parameterized SQL only), `onchain.ts` (balance reads; a node reporting the
  wrong chain id fails closed), `tigersmartchain.ts` (registers TGR, plus RUSD
  when `TIGEREX_TSC_RUSD_ADDRESS` is set), `bootstrap.ts`.
- Admin: `src/app/api/admin/chains` and `.../tokens` (both `requireAdmin` +
  `enforceRequestGuards` + `recordAdminAction`), pages `src/app/admin/chains`
  and `src/app/admin/tokens`. Public read routes `/api/chains` and
  `/api/wallet/onchain`.
- `src/instrumentation.ts` runs the bootstrap in the Node runtime only (pulling
  `better-sqlite3`/`crypto` into Edge broke `next build`; keep the guard).
- TSC parameters come from the chain itself. The chain id is fixed by the
  daemon: `cmd/tigersmartchaind/src/main.rs` defaults `--chain-id` to **9001**
  (testnet **9000**), the chain's Go SDK (`sdk/go/client.go`) and Python SDK
  (`ChainID.MAINNET = 9001`, `TESTNET = 9000`) agree, and its Helm deployment
  (`deployment/helm/tigersmartchain/values.yaml`) sets `chainId: 9001`. Native
  coin TGR, 18 decimals. RUSD ("Royal Tiger USD") is a 1:1
  USD stablecoin and the chain's `TokenFactoryWithPresets.Stablecoin` preset
  creates stablecoins with **6** decimals, so RUSD defaults to 6. The node URL,
  the explorer URL, the RUSD contract address and the RUSD decimals are
  environment variables (`TIGEREX_TSC_RPC_URL`, `TIGEREX_TSC_TESTNET_RPC_URL`,
  `TIGEREX_TSC_EXPLORER_URL`, `TIGEREX_TSC_RUSD_ADDRESS`,
  `TIGEREX_TSC_RUSD_DECIMALS`); an unset RPC URL means the chain is simply not
  served, and no explorer URL is invented. A deployment running its own network
  may pin the id it serves with `TIGEREX_TSC_CHAIN_ID` (testnet
  `TIGEREX_TSC_TESTNET_CHAIN_ID`); the on-chain reader still refuses a node whose
  `eth_chainId` differs from whatever is recorded. Never substitute a
  placeholder address — the wallet would read a contract that does not exist and
  report a zero balance.
- Tests: `scripts/test/chains.test.cjs`; `npm run test:logic` includes the chain
  modules via `scripts/build-logic-tests.cjs`.
- Two separate surfaces reference TSC and must not be conflated. This one (the
  wallet/registry) is chain-id agnostic and reads the id from the daemon default
  or `TIGEREX_TSC_CHAIN_ID` (**9001**). The vendored DEX under `tigerswap/`
  keeps its own internal chain registry keyed on **6666** (`config/blockchains.go`,
  `services/services.go`), which is the id TigerSmartChain's README and ENS/bridge
  modules advertise; the DEX resolves the node URL from
  `TIGERSWAP_RPC_<chainID>` and does not assert `eth_chainId`, so the two keys do
  not share state and neither is authoritative over the other. Treat the id as
  deployment configuration on both surfaces rather than unifying them blindly.

`backend/rust/cmd/tigerex_ecosystem` is the Rust side of the same surface.
`TigerEcosystem::new()` seeds nothing; a caller supplies chains, tokens, pools
and bridges through `register_deployment(DeploymentConfig)`. `TigerTokens::new`
takes the real TGR/RUSD addresses. `FeeCollection` books each fee against the
source it was recorded with and `collect_fees` reports exactly that — it no
longer apportions a total into 30%/10% buckets. Run
`cargo test --lib` from the crate directory.

`integrations/` is a standalone Go module (`tigerex/integrations`, wired into
CI job `test`). It holds the cross-product registry and shared arithmetic:
chain/token registry (a node URL, and a contract address for a non-native
token, are required), basis-point bridge fees, a constant-product pool
(`x*y=k`, positive price impact), and a fee ledger that reports only fees
actually recorded. Typed errors with stable codes (`IsCode`). Address
derivation, signing and chain reads stay in the wallet service that owns the
keys — this package never generates an address or a signature.

## Python analytics / ML layer (`backend/python`)

`backend/python/src/analytics/*` and `backend/python/src/ml/*` are the AI/ML and
analytics layer. They are pure computation over caller-supplied data — no
network, no database, no fabricated prices — and each module also has a
`__main__` self-test. Until now the layer had no declared dependencies and no CI
job, so a regression in it would have shipped unnoticed.

- Dependencies are declared in `backend/python/requirements.txt` (`numpy`,
  `pandas`). The heavy optional models (scikit-learn, torch, xgboost) are
  imported behind a guard in `ml/__init__.py` and are not needed to import or
  test the layer; `FraudDetector.predict` raises when no fitted model is
  available rather than reporting a benign score.
- Tests live in `backend/python/tests/` and run with `python -m pytest` from
  `backend/python` (config in `pytest.ini`, path bootstrap in `tests/conftest.py`).
  CI job `python-analytics` runs the suite and the module self-tests.
- Fund/compliance invariants the tests pin: an unpriced holding is refused
  rather than valued at zero; a rebalance refuses an unpriced asset; risk-parity
  allocation fails closed instead of returning an empty book; the backtester
  never sees a future bar; the fraud engine scores a listed jurisdiction as
  decisive (60 points, so it always alerts) and rejects a negative amount.


## Custody: deposits, withdrawals and the worker loop

The on-chain custody layer lives in `src/lib/wallet/` and is driven by the
scheduler in `src/lib/ops/scheduler.ts` (`/api/worker/tick` in production).

- `scanner.ts` — deposit scanning. A per-chain cursor in `chain_cursors` bounds
  the block range; ERC-20 `Transfer` logs and native transfers to a known
  deposit address are recorded in `deposits` once, keyed on
  `(network, tx_hash, address)`. A deposit is credited exactly once, only after
  `confirmations >= required_confirmations`, and the credit is written under a
  status guard (`pending` → `crediting` → `credited`) so a concurrent sweep
  cannot double-credit. `deposits.block_number` records the height it was
  credited from.
- `reverseReorgedDeposits` — reorg safety. Each cycle it re-validates the
  most recently credited deposits (`TIGEREX_REORG_DEPTH`, default 100) against
  `eth_getTransactionReceipt`: a transaction that has vanished, or that now
  sits at a different height, is no longer backed by the canonical chain, so the
  credit is withdrawn through `debitAvailable`. The reversal is idempotent
  (status guard). When the user already spent the credit the debit fails, the
  deposit is marked `reorg_shortfall`, and a withdrawal hold is placed rather
  than letting a negative balance stand.
- `payout.ts` — withdrawal signing. The key is HD-derived per user
  (`src/lib/wallet/hd.ts`, BIP-32/44); a withdrawal is signed EIP-155, sent from
  the user's own address, and recorded in `chain_transactions`. The reservation
  is consumed in the same transaction that records the hash. A mined
  transaction completes the withdrawal; a reverted one returns the reservation.
- **Nonce allocation must be atomic.** `allocateNonce` reads the node's pending
  nonce as a floor and keeps a monotonic counter per `(chain_key, address)` in
  `chain_nonces`, advancing it inside one write transaction. Two payouts signed
  from the same address in the same instant would otherwise read the same
  `eth_getTransactionCount` and sign the same nonce: the chain accepts one and
  drops the other, and the dropped withdrawal is recorded as broadcast while the
  funds never leave. The counter resyncs to the node when it runs more than
  `TIGEREX_NONCE_MAX_DRIFT` (default 16) ahead, so a transaction dropped from
  the mempool does not stall every later payout.
- **2FA on the money-out path.** `createWithdrawal`
  (`src/lib/wallet/withdrawals.ts`) verifies a TOTP code when the account has
  `two_factor_enabled`, unless the caller marks the request `apiKeyAuthorized`
  (the programmatic `/api/v1/withdraw` path, where the API key is the
  credential). Keep the bypass explicit so it stays auditable.

Tests: `scripts/test/custody.test.cjs` (deposits, withdrawals, nonce allocation,
reorg reversal), plus `freeze`, `payout`, `scanner`, `sanctions`,
`health-metrics`, `market-seed` and `wallet-withdrawals`. Each fund-safety fix
has a regression test that fails against the old code and asserts the resulting
balances, not just a status column.

## Admin console 2FA and verification-code delivery

- **Admin 2FA.** An admin session can approve withdrawals, so the console
  requires an authenticator (TOTP) once enrolled. `src/lib/auth/admin-2fa.ts`
  (framework-free, unit tested) stores the secret AES-256-GCM encrypted and
  enables 2FA only after a code proves possession. `authenticateAdmin` returns
  `two_factor_required` when the password is right but the code is missing and
  opens no session; `/api/admin/auth/2fa` (requireAdmin) manages enrolment.
  `admin_users.two_factor_enabled` / `two_factor_secret` carry the state, with a
  migration for existing databases.
- **Verification codes go out by email or SMS.** `src/lib/security/email.ts`
  (SMTP, `nodemailer`) and `src/lib/security/sms.ts` (a provider-neutral HTTPS
  carrier gateway) each build a sender from environment config and return none
  when unconfigured, so `issueOtp` fails closed rather than reporting an
  undelivered code as sent. A provider error removes the record. Phone sign-up
  is a supported path, so `TIGEREX_SMS_WEBHOOK_URL` / `TIGEREX_SMS_API_KEY` must
  be set for it to complete.
- Tests: `scripts/test/admin-2fa.test.cjs`, `scripts/test/sms-otp.test.cjs`
  (the SMS test drives a real local HTTP gateway).

## Market integrity, travel rule and destination risk (`src/lib/compliance`)

Three self-contained compliance engines, all reading only the venue's own
tables and all unit tested (`scripts/test/compliance-surveillance.test.cjs`):

- `surveillance.ts` — market-integrity surveillance. `runSurveillanceCycle()`
  scans a rolling window of `spot_trades` and `orders` and raises alerts for
  self-matching, wash trading (two accounts round-tripping with no net position),
  layering and spoofing (large short-lived far-from-mid cancels against a small
  fill). Alerts persist to `surveillance_alerts` with a
  `UNIQUE(kind, user_id, symbol, bucket)` key so a re-run of the same minute
  raises nothing new. Wired into `runScheduledCycle` (`surveillance.scan`) and
  `GET/POST/PUT /api/admin/surveillance`.
- `travel-rule.ts` — FATF Recommendation 16. `assertTravelRuleSatisfied()` is
  required for a transfer at or above `travel_rule_threshold_usd` (default 1000
  USD) or for any unpriced transfer, and refuses a missing originator
  name/account/country or beneficiary account. `createWithdrawal` calls it after
  the KYC-limit checks and records a hash-committed message in
  `travel_rule_messages`. Admin: `GET/PUT /api/admin/travel-rule`.
- `address-risk.ts` — destination scoring from local data only (sanctions match,
  operator `address_risk_entries`, first-seen, and the user's own
  address-book/history in `withdrawal_whitelist`). A blocked address or a
  first-time high-value destination (`HIGH_VALUE_USD`, default 10000) is refused
  in `createWithdrawal`; an accepted transfer records the outcome so the next
  withdrawal to it is trusted. Admin: `GET/POST/DELETE /api/admin/address-risk`.

No third-party risk API is consulted; every signal is derived from a table the
venue owns.

## Withdrawal maker-checker (`src/lib/wallet/approvals.ts`)

A withdrawal's USD value (`withdrawals.amount_usd`, written at creation) maps to
the number of *distinct* admin approvals it needs before it can settle. Tiers
live in `withdrawal_approval_tiers` (`min_usd`, `required_approvals`); an empty
table is the default single approval. `setWithdrawalApprovalTiers` is
fail-closed: positive values, integer counts of at least 1, distinct thresholds,
and a count that never decreases as the value rises. Approvals are one row per
`(withdrawal, approver)` in `withdrawal_approvals`, so one operator cannot
satisfy a 2-of-N by approving twice. The admin withdrawal route records the
approval before settling and refuses `broadcast` with `APPROVALS_REQUIRED` until
the tier is met. Admin: `GET/PUT /api/admin/withdrawal-tiers`.

## Verified toolchain matrix (this environment)

Every layer builds and its tests pass: TypeScript (`npx tsc --noEmit`,
`npm run test:logic` 1045, `npm run build`), Go 1.23 (`go build ./...`,
`go test ./...`), C++ (`cmake --build`, `ctest` 2 suites), Rust
(`cargo test --lib` in `backend/rust/matching-engine`, 13), Python
(`python -m pytest` in `backend/python`). No layer is a placeholder.
