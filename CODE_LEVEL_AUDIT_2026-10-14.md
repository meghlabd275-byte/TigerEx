# TigerEx source audit — 2026-10-14

This report is based on direct source inspection, not on the repository's existing status/marketing Markdown. It is a source-level gap assessment, not a penetration test or a certification.

## Scope and reproducible evidence

Inspected source paths on `main`:
- `src/lib/api/client.ts` — browser API/auth client, token persistence, refresh flow, WebSocket authentication.
- `src/lib/client.ts` — second API SDK, API-key header handling and WebSocket subscription.
- `src/lib/authFlow.ts` — registration-status heuristic and password-strength UI helper.
- `src/lib/identity.ts` — client-side email/phone normalization.
- `src/lib/security/unavailable-auth-provider.ts` and `src/lib/security/unavailable-admin-operation.ts` — fail-closed handlers.
- `TigerEx/rest_api_gateway/internal/middleware/auth.go` — JWT/API-key middleware.
- `TigerEx/rest_api_gateway/internal/services/trading.go` and `market_data.go` — trading and market data services.
- `backend/go/internal/wallet/service.go` — wallet, deposit-address and withdrawal implementation.
- Root `package.json` — available scripts and dependency stack.

Repository API reported 3,252 tracked tree entries at the inspected revision. This is too large to honestly claim that every line of every file has been manually audited in one pass; follow-up work must use per-service reviews and automated scans.

## Confirmed findings from code

### P1 — Authentication/session handling
1. `src/lib/api/client.ts` stored access and refresh bearer tokens in `localStorage`, where any successful same-origin script injection can read them. Prefer server-set `HttpOnly; Secure; SameSite` cookies with CSRF protections, or a BFF/session architecture. The current client architecture still needs that migration.
2. The same client passed a WebSocket bearer token in the URL query string (`?token=...`). URLs can leak into proxy/access logs, diagnostics and telemetry. Replace with a short-lived, single-use WebSocket ticket or authenticated cookie handshake; never log credentials.
3. The refresh handler previously attempted refresh only when the in-memory refresh token existed, so reloads could bypass refresh. It also had no explicit one-retry guard, and an expired refresh token could recurse through the same 401 branch. A fix was committed to read the persisted token, exclude `/auth/refresh` from automatic refresh, retry the original request once, validate the returned token pair, and clear tokens after refresh failure. This is a targeted fix, not a complete session-security redesign.
4. `src/lib/authFlow.ts` contains `isProbablyRegistered`, which guesses account existence from strings containing `registered`, `demo`, `test`, `user`, `@tigerex`, or numbers ending in `0000`. This is not an authoritative registration check and must not be used for access control or account decisions; account status must come from a server-side identity provider. Review all call sites before removing/renaming it.
5. `src/lib/client.ts` accepts an API key in a browser-instantiable SDK and sends it in `X-API-Key`; it also sends the key in a WebSocket subscription message. Browser-distributed secrets are not secret. This SDK must not be used with privileged exchange/admin keys in frontend code. Use server-side scoped API keys, hash-at-rest verification, IP/permission restrictions, rotation and audit logs.
6. JWT middleware has a fail-closed API-key path until a persistent hashed verifier is configured. That is safer than accepting arbitrary keys, but means authenticated API-key access is not operational until the verifier, key lifecycle and permissions are implemented.

### P1 — Orders, ledger and custody
1. `TigerEx/rest_api_gateway/internal/services/trading.go` has in-memory order/trade maps. `CreateOrder` now returns 503 until matching, risk, reservation and settlement are connected, but other methods still operate over process-local maps. Restart/redeploy loses state; this service is not a durable source of truth.
2. `TigerEx/rest_api_gateway/internal/services/market_data.go` starts with empty in-memory maps and returns 503 for unavailable feeds. This is correctly fail-closed but does not constitute a connected live feed, historical market-data store, sequence recovery, or multi-region distribution.
3. `backend/go/internal/wallet/service.go` explicitly labels wallet persistence and address generation as placeholders. `CreateDefaultWallets` discards wallet objects; `GetWallets` returns an empty list; `GetBalance` synthesizes a zero-balance object; `GetDepositAddress` creates address-shaped random strings instead of deriving valid chain addresses. These are blockers for any real custody/deposit/withdrawal deployment. Disable those routes until chain-specific derivation, persistent ledger, node/indexer verification, signing and reconciliation are implemented.
4. The wallet service uses `float64` for money amounts. Replace monetary values with fixed-point integer units or a rigorously specified decimal type; apply atomic double-entry ledger postings and idempotency keys in database transactions.
5. No source inspection in this pass establishes a single canonical execution path that joins authentication, authorization, balance reservation, matching, fees, ledger posting, chain settlement and reconciliation. This integration is a launch blocker.

### P1 — Market data and WebSockets
- Market-data maps are process-local. A live adapter, upstream authentication, stale-feed detection, exchange sequence validation, snapshot/delta resynchronization, backpressure, durable historical candles and recovery must be demonstrated.
- WebSocket client reconnection reuses the original token argument. Introduce short-lived ticket renewal, bounded reconnect jitter, message-size limits, per-channel authorization and explicit stale-session termination.
- Validate all WebSocket subscription payloads and ensure user-private channels are authorized server-side for every subscription and event.

### P2 — Frontend/API correctness
- `src/lib/api/client.ts` defaults to plain HTTP and WS localhost URLs. Production must require explicit HTTPS/WSS configuration and reject insecure production origins.
- Multiple API clients and multiple auth implementations increase the chance of divergent security and inconsistent error handling. Select one canonical client/session model and deprecate duplicates.
- `src/lib/identity.ts` validation is a UX format check, not authoritative email verification or robust global phone-number validation. Use server-side normalization and verified OTP/email challenges.
- `src/lib/api/client.ts` builds some path/query values by string concatenation (e.g. symbol/order IDs). Encode path segments and use `URLSearchParams` consistently.
- Browser console logs in the WebSocket client should be replaced by redacted, structured telemetry. Never log tokens, OTPs, API keys, wallet secrets or sensitive account data.

## Exchange competitor comparison (capability domains)

A meaningful comparison with Binance, Bybit, Bitget, OKX, Gate.io and Coinbase is capability-by-capability, not a single binary checklist. Their exact product availability differs by country, entity, asset, account tier and regulation. The following are required parity domains to verify against official product/API docs before claiming parity:

| Domain | Required implementation/evidence in TigerEx |
|---|---|
| Spot trading | Durable order lifecycle, matching priority, cancel/replace, partial fills, IOC/FOK/GTC, market protection, post-only, stop/conditional orders, OCO/bracket where supported, fees and self-trade prevention |
| Derivatives | Perpetual/futures/options where licensed; mark/index prices, funding, isolated/cross/portfolio margin, maintenance tiers, liquidation engine, ADL/insurance fund, reduce-only and risk limits |
| Market data | REST + authenticated/public WebSockets, order-book snapshots/deltas with sequence IDs, trades, tickers, candles, exchange info, rate-limit semantics and replay/recovery |
| Accounts/security | Email/phone verification, MFA/passkeys, device/session management, refresh rotation/revocation, API key scopes/IP allowlists, subaccounts, role policies and immutable audit trails |
| Wallet/custody | Real chain-specific address derivation, deposit confirmations/reorg handling, travel-rule controls, withdrawal allowlists, velocity limits, dual approval, HSM/MPC signing, hot/cold separation and reconciliation |
| Funding/fiat | Real payment-provider/bank rails, card/on-ramp providers, internal transfers, P2P escrow/dispute handling and chargeback/settlement reconciliation |
| Earn/finance | Staking, lending/borrowing, savings, structured products and collateral/liquidation only when product economics, custody and jurisdiction are implemented and reviewed |
| Pro/institutional | FIX/API gateways, broker/prime workflows, OTC RFQ, portfolio margin, managed subaccounts, reporting and auditable client permissions |
| Compliance | Jurisdiction-aware onboarding, sanctions/PEP screening, transaction monitoring, case management, suspicious activity reporting, travel rule, tax/account statements and retention controls |
| Reliability | Durable event log, idempotency, transactional ledger, disaster recovery, tested backups, region failover, SLOs, observability, rate limiting and capacity/load tests |
| Client/product | Accessible responsive web/mobile UX, localization, accessibility, exportable history, notifications, customer support and transparent status/incident communication |

Do not label any row complete until source, integration tests, operational configuration and evidence prove it. Never copy another exchange's private implementation or claim that every feature exists based on UI components alone.

## Architecture direction

- **C++**: isolated low-latency matching/risk-critical hot path only after deterministic replay, memory-safety hardening, fuzzing and benchmark evidence.
- **Rust**: security-sensitive services, protocol validation and custody orchestration where it materially improves memory safety.
- **Go**: API gateways, distributed control plane, background jobs and operations.
- **Python**: offline/async ML and research; model outputs must not bypass deterministic risk controls.
- **Next.js/React/TypeScript/Tailwind**: client UI only. No exchange, custody, or administrator secrets in browser bundles.
- Use PostgreSQL transactions for the canonical ledger/order state, an append-only event log/outbox, Redis only for ephemeral/cache/rate-limit use, and independently managed secrets (KMS/HSM/MPC) for key material. Avoid dual-write designs without outbox/idempotency.

## Release blockers

- No production customer funds, real withdrawals or live trading until real ledger/matching/settlement paths replace placeholders and are tested end-to-end.
- Migrate bearer tokens out of `localStorage` and URL query strings.
- Add persistent API-key lifecycle and admin RBAC, encrypted provider credential storage with rotation, approval/audit workflows, and least-privilege separation.
- Run unit/integration/contract tests, Go race tests, Rust/C++ sanitizers and fuzzers, frontend type-check/build, dependency/SBOM scans, secret scans, SAST/DAST, load/chaos/recovery tests and independent penetration testing.
- Validate licensing, AML/KYC and product legality in every launch jurisdiction.

## Validation and commit note

A targeted refresh-flow correction was committed to `main` on 2026-10-14. It was applied through GitHub's repository API; this is not a local `git push`. The change has not been represented as build-tested in this environment. CI must pass before release. This report does not certify TigerEx as production-ready and does not promise zero vulnerabilities.
