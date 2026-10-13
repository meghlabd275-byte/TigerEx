# TigerEx repository audit and remediation record

Audit date: 2026-10-14  
Repository: https://github.com/meghlabd275-byte/TigerEx  
Audited revision before remediation: 1e731e69e7eaf695033294c9c2665a0128b25795

## Executive result

**Not production-ready for customer assets or live trading.** The repository contains many overlapping implementations, some explicitly labelled complete or production-ready while other status documents and source code show unfinished integration. This source-level review is not a full security audit or proof that every file is correct.

## High-severity findings confirmed in source

1. **JWT authentication accepted fabricated claims** — `TigerEx/rest_api_gateway/internal/middleware/auth.go`: `parseJWT` previously checked only the three-part token shape and returned fixed `user_123` claims without signature verification or expiry validation. The updated implementation verifies HS256, signature, expiry, issuer, and audience, and rejects the known development default secret.
2. **API keys authenticated as a shared default identity** — the same middleware previously accepted a sufficiently long key without database lookup and assigned `default_user`. API-key auth now fails closed until a persistent verifier exists.
3. **Market orders were fabricated as filled** — `TigerEx/rest_api_gateway/internal/services/trading.go` stored orders in process memory and filled market orders at a hard-coded 50,000 price. Order creation now returns an API error 503 until durable matching, risk, balance reservation, and settlement are wired.
4. **Market metadata and prices were seeded from constants** — `TigerEx/rest_api_gateway/internal/services/market_data.go` previously seeded symbols and static prices. The default seed was removed; no feed means no market data.
5. **A second gateway returned fake account/trading/market data** — `TigerEx/distributed_exchange_backend/api_gateway/main.go` previously set `demo_user` when any X-API-Key header existed and emitted hard-coded tickers/order books/balances and successful-looking order responses. These paths now fail closed with 503; an arbitrary API-key header no longer authenticates.
6. **Wallet functions contain placeholder custody logic** — `backend/go/internal/wallet/service.go` documents placeholder persistence and creates address-shaped strings from random bytes; withdrawal flow comments describe unimplemented fund locking and broadcast. Do not enable deposits or withdrawals through this service.
7. **Deployment and CI configuration mismatch** — root `package.json` has no `test` script, while `.github/workflows/ci.yml` invokes `npm test`. The root Dockerfile installs production-only dependencies before invoking a build that normally needs development dependencies. `docker-compose.yml` references several Dockerfiles that were not present in the audited recursive tree. Validate each deployment path before use.
8. **Multiple competing implementations** — the recursive tree has 1,653 tracked files and multiple matching engines, gateways, wallets, auth services, and frontend trees. There is no demonstrated single, tested end-to-end production path connecting them. Some documentation claims 10M+ TPS and sub-microsecond latency without reproducible benchmark artifacts in the inspected project files.

## Changes in this commit

- Replace fake JWT claims with HS256 verification and registered-claim checks; reject the known default JWT secret.
- Fail closed for API keys because there is no verified persistent key lookup in this middleware.
- Disable in-memory order acceptance and hard-coded market-order fills.
- Remove seeded mock market symbols/prices from the REST gateway market-data service.
- Make the separate distributed gateway return 503 for unconfigured market data, trading, and account-ledger endpoints; stop accepting any arbitrary API-key header as identity.
- Add unit tests for JWT tampering, default secret rejection, API-key fail-closed behavior, disabled order execution, and empty unconfigured market data.

## Requirements still outstanding

A complete exchange still requires a single canonical service topology; PostgreSQL-backed transactional double-entry ledger; durable order/event sequencing and replay; matching-engine recovery/failover; live market feeds; chain-specific address derivation and node/indexer connections; HSM/MPC custody; withdrawal policy and signing controls; liquidity-provider adapters; validated spot/derivatives risk and liquidation; MFA/passkeys and session revocation; persistent admin RBAC and encrypted provider credentials; KYC/AML/compliance integrations; reconciliation, disaster recovery, load tests, fuzzing, dependency scanning, threat modelling, and independent penetration/security review.

## Validation status

Changes and tests were prepared through GitHub's repository API. This environment did not run Go/Node/Rust/C++ build pipelines before this commit. GitHub Actions and local builds must pass before treating the change as verified. The fail-closed behavior intentionally disables affected endpoints instead of fabricating success. This is a safety remediation, not a production-readiness certification.

## Release gate

Do not accept customer funds, expose withdrawal signing, or advertise live trading until the end-to-end system is implemented, independently reviewed, load-tested, disaster-recovery tested, and legally approved for each operating jurisdiction.
