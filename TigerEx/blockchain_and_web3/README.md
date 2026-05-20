# Blockchain and Web3 Infrastructure

> **Domain**: Multi-chain wallet management and blockchain integrations.

## Languages

### Rust (Primary)
- Memory safety critical for custody
- Excellent cryptography ecosystem
- Async blockchain clients
- High performance parsing

### Solidity (Smart Contracts)
- Token standards (ERC-20, ERC-721)
- Staking protocols
- Governance contracts

### Go
- Blockchain indexers
- RPC proxies

## Submodules

### multi_chain_wallets/
- Bitcoin, Ethereum, Solana, Polygon support
- HD wallet derivation
- Key management

### mpc_wallet_engine/
- Multi-party computation
- Threshold signatures
- Distributed key generation

### custody_platform/
- Hot wallet management
- Cold storage operations
- Hardware security module integration

### blockchain_nodes/
- Full node operations
- Validator integration
- RPC infrastructure

### chain_indexers/
- Transaction indexing
- Balance tracking
- Historical data query

### bridge_infrastructure/
- Cross-chain messaging
- Asset bridging
- Relay networks

## Security Requirements

- MPC threshold signatures (3-of-5 minimum)
- HSM-backed key storage
- Rate limited withdrawals
- Manual approval workflows for large transfers

## Supported Chains

```
Tier 1 (Full Support):
- Bitcoin (BTC)
- Ethereum (ETH)
- Solana (SOL)
- Polygon (MATIC)

Tier 2 (Integrated):
- BSC
- Avalanche
- Arbitrum
- Optimism
```