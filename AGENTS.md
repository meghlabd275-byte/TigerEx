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
