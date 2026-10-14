# TigerEx source audit — pass 3 — 2026-10-14

This record reflects executable source inspection of the latest `main` branch. Existing repository status documents were not used as evidence.

## Confirmed source defects remediated

- `src/app/api/order/place/route.ts` inserted directly into a local SQLite database and marked market orders `filled` without matching-engine execution, balance reservation, fee calculation, settlement, or durable idempotency. It now requires an authenticated session and proxies to the canonical order backend over a configured secure API origin.
- `src/app/api/kyc/verify-identity-otp/route.ts` verified OTPs in a process-local `Map`, which is unsafe across replicas and not an identity-control implementation. It now delegates to the authenticated KYC backend and fails closed when unavailable.
- `src/app/api/settings/change-email/route.ts` logged the old/new address and returned success without changing durable account state or requiring security verification. It now delegates to the authenticated account backend and fails closed when unavailable.

## Capability baseline checked

Official documentation confirms that the named competitors expose production API surfaces beyond a static route catalog:

- Bybit V5 unifies spot, derivatives, options, order, position, account, asset, margin, and portfolio-margin operations.[1]
- Bitget documents unified-account modes with spot, spot margin, USDT/USDC/coin-margined futures, shared collateral, debt, equity, and maintenance-margin calculations.[2]
- OKX documents REST and WebSocket APIs, explicit read/trade/withdraw API permissions, IP binding, signed private requests, spot/margin/swap/futures/options instruments, and private account event streams.[3]
- Gate API v4 documents spot, margin, futures, authenticated automation, price-time matching, POC/iceberg orders, P2P merchant operations, and cross-exchange trading APIs.[4]
- Coinbase Advanced Trade documents REST order management and WebSocket market/account updates; its product roadmap also distinguishes spot and derivatives gateways and additional order types.[5]
- Binance’s public API landing page exposes market-data, trading, user, deposit, broker, liquidation, fiat, and related API sections.[6]

## Remaining release blockers found by source scan

The repository still contains explicit simulated or incomplete paths in custody, blockchain signing, KYC/AML screening, fiat/payment providers, derivatives/oracle data, DEX routing, websocket market feeds, admin dashboards, and multiple Go/Rust/C++ services. Examples include `server/handlers/handlers.go`, `server/kyc-compliance.js`, `integrations/unified_integration.go`, `core/integrations/include/tigerex_integrations.hpp`, `backend/go/internal/handlers/wallet.go`, `backend/rust/cmd/oracle_service`, and `TigerEx/wallet_service`.

Feature names and route existence do not prove parity. Production parity requires verified implementations for matching, reservations, double-entry ledger settlement, chain broadcast and confirmation, reorg/reconciliation handling, risk/liquidation, API-key permissions and rotation, durable OTP/MFA, compliance-provider decisions, audit trails, websocket fanout, rate-limit enforcement, recovery, and load/chaos testing.

## Validation

- `npm run type-check`: passed.
- `npm run build`: passed. Build output still reports expected dynamic-route diagnostics for request-dependent APIs and backend connection failures when no backend is running; these are not treated as successful integrations.
- `node --check server/index.js`: passed.
- `git diff --check`: passed.

## References

[1]: https://bybit-exchange.github.io/docs/v5/intro "Bybit V5 API Introduction"
[2]: https://www.bitget.com/api-doc "Bitget API Documentation — Unified Trading Account"
[3]: https://www.okx.com/docs-v5/en/ "OKX API Documentation"
[4]: https://www.gate.io/docs/developers/apiv4/en/ "Gate API v4 Documentation"
[5]: https://docs.cdp.coinbase.com/advanced-trade/docs/welcome "Coinbase Advanced Trade API"
[6]: https://www.binance.com/en/binance-api "Binance API"
