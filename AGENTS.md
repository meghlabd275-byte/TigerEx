# AGENTS.md

Repository-specific knowledge for agents working in TigerEx.

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

## Build and test

```bash
cd backend/go
go build ./...          # must be green
go test ./...           # must be green
```

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
