# TigerEx Enterprise Readiness Audit

This audit converts the enterprise exchange requirement into implementation gates. It is intentionally explicit about gaps so no production launch depends on mocked, isolated, or disconnected modules.

## Non-negotiable platform gates

1. **No placeholder workflows in production paths**: all auth, KYC, wallet, trading, Web3 and admin operations must call versioned backend APIs backed by persistent storage, audit logs, queues and observability.
2. **Unified identity input**: login, register, reset password, 2FA reset, contact change, deletion and recovery flows must use a single smart identity input that auto-detects email vs phone and sends an explicit `type` flag to backend validation.
3. **Theme parity**: every platform must consume the same design-token contract for light/dark state and persist the setting locally while syncing user preference after login.
4. **Security freeze policy**: email, phone, password or 2FA changes must create a 48-hour withdrawal hold record that is globally enforced by wallet withdrawal services and automatically expires.
5. **KYC withdrawal gate**: withdrawal APIs must deny funds movement unless KYC status is approved and no security freeze is active.
6. **Seed phrase policy**: user seed phrases and private keys must never be stored in plaintext or exposed to operators. Privileged wallet actions require MPC/HSM/threshold signing and auditable delegated permissions.

## Required production services

| Domain | Required services | Production gate |
| --- | --- | --- |
| Auth | password, OTP, OAuth, passkey, 2FA, lockout, trusted device | Persistent attempt counters, signed sessions, device registry, OTP rate limits |
| KYC | personal data, document upload, liveness, admin review | Encrypted PII store, object storage, review queues, immutable status history |
| Wallet | deposit, withdraw, transfer, history, addresses | Ledger double-entry accounting, chain listeners, withdrawal policy engine |
| Trading | spot, margin, futures, options, P2P, TradFi, ETF | Matching engine, risk engine, market data, WebSocket fanout, liquidation engine |
| Web3 wallet | create/import, send, receive, swap, DApp connect, multisig | Local encrypted key vault, chain adapters, transaction simulation, signing policy |
| Master wallet | fees, liquidity routing, network/token admin, revenue collection | MPC/HSM signing, role-based approvals, audit log, reconciliation jobs |
| Cross-platform | web, mobile, desktop, WeChat | Shared API schema, design tokens, auth SDK, realtime event contract |

## Current repo gaps to close before production

- Several product pages still contain static/demo market data and must be replaced with API/WebSocket-backed state.
- Backend routing is concentrated in one Go file and should be split into auth, wallet, KYC, account, trading and feature modules with tests.
- Database schemas, migrations and persistence contracts are incomplete for OTP, lockout, device trust, KYC review, withdrawal freeze and deletion grace periods.
- Mobile, desktop and mini-program apps need shared auth/theme SDK bindings instead of standalone screens.
- Master wallet and Web3 wallet code must be connected to audited signing infrastructure before any mainnet operation.

## Implementation sequence

1. Stabilize backend module imports and CI so `go test ./...`, TypeScript checking and production builds pass.
2. Add database migrations and repository layers for auth attempts, OTP, KYC, freezes, devices, deletion requests and audit logs.
3. Replace simulated frontend handlers with API client calls and generated OpenAPI types.
4. Connect real-time trading and wallet streams through authenticated WebSocket channels.
5. Add platform SDK packages consumed by Android, iOS, desktop, web and WeChat builds.
6. Integrate MPC/HSM-backed signing and enforce policy approvals for master-wallet operations.
