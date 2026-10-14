# TigerEx production remediation record — 2026-10-14

## Scope

This pass inspected the tracked repository structure and executable paths across the Next.js frontend, Node API, Go/Rust/C++ modules, database schemas, Docker/CI configuration, and the existing source audit. It did not treat existing Markdown status claims as proof of functionality.

The repository is a large multi-service monorepo with multiple competing backends and schemas. A literal manual review of every line in one pass would not be an honest claim; the confirmed gaps below are based on direct source inspection plus build/static scans.

## Implemented in this revision

- Removed fabricated balances, USD totals, transaction history, market rows, prices, and favorites from the primary `/wallet` and `/markets` pages.
- Connected those pages to the canonical TypeScript API client and rendered explicit unavailable/unauthenticated states instead of synthetic data.
- Rejected authenticated browser WebSocket connections that put bearer tokens in query strings. The remaining implementation requires a future short-lived server-issued ticket or HttpOnly session handshake.
- Made production browser configuration fail closed unless API and WebSocket origins use HTTPS/WSS.
- Upgraded Next.js from 14.2.3 to 14.2.35, the latest 14.x release available at audit time.
- Added API liveness/readiness probes that check PostgreSQL and Redis, request correlation IDs, `X-Request-ID`, `trust proxy` configuration, `x-powered-by` removal, and a restrictive API CSP.
- Removed credential-shaped provider and secret values from the committed environment examples.
- Gated the legacy Binance websocket connector behind the explicit `BINANCE_WS_URL` environment variable instead of silently depending on Binance.
- Fixed the dashboard build failure caused by Next typed-route validation and documented the remaining route/domain issues through the build evidence.

## Validation

- `npm run type-check`: passed.
- `npm run build`: passed with Next.js 14.2.35.
- `node --check server/index.js`: passed.
- `npm audit --omit=dev`: reduced to 4 remaining findings after non-breaking lockfile remediation: 1 moderate, 2 high, and 1 critical. The remaining critical Next.js fix requires a breaking upgrade to Next.js 16; this was not silently applied because it requires a React/framework migration and full regression pass.
- Go, Rust, and native C++ tests could not run in this sandbox because those toolchains are not installed. CI remains the authoritative native-language gate.

## Confirmed release blockers still present

These are deliberately not replaced with fake logic:

1. Multiple services still contain explicit `mock`, `demo`, auto-approval, synthetic-price, or `not implemented` paths. They must be removed or disabled per product boundary before production exposure.
2. Wallet custody is not proven end to end: chain-specific derivation, HSM/MPC signing, durable double-entry ledger, confirmations/reorg handling, reconciliation, withdrawal policy/approval, and travel-rule workflows require implementation and integration evidence.
3. The canonical durable order lifecycle is not established across authentication, authorization, reservation, matching, risk, fees, settlement, outbox, replay, and idempotency.
4. The repository contains multiple schemas and service entry points; one authoritative schema and one production deployment topology must be selected.
5. Derivatives, margin, options, earn, staking, P2P, copy trading, fiat rails, OTC/institutional, compliance, and admin/provider credential workflows require domain-by-domain real integrations and jurisdictional review. UI routes alone are not feature parity.
6. A zero-vulnerability or zero-bug claim is not supportable without Go race tests, Rust/C++ sanitizers and fuzzing, SAST/DAST, SBOM review, load/chaos/recovery testing, secret scanning, and an independent penetration test.

TigerEx must remain fail-closed for unbacked trading, custody, deposits, withdrawals, and financial products until these blockers have verified implementations and operational controls.
