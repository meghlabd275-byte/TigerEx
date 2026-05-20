# TigerEx - Institutional Cryptocurrency Exchange

> **Architecture Note**: This structure represents a production-grade institutional exchange system designed for Binance/Bybit/Coinbase scale operations.

TigerEx is architected as a polyglot system where each layer uses the optimal language based on:
- Latency requirements (nanosecond, microsecond, millisecond)
- Memory behavior and safety requirements  
- Concurrency models
- Regulatory and compliance needs
- Operational scalability

## Domain Overview

| Domain | Primary Languages | Latency Profile |
|--------|-----------------|----------------|
| Ultra Low Latency | C++, Rust, FPGA | Nanosecond - Microsecond |
| Distributed Backend | Go, Rust | Millisecond |
| Banking & Finance | Java, Kotlin | Second+ |
| Blockchain & Web3 | Rust, Solidity, Go | Variable |
| AI & Quant | Python, Rust, CUDA | Variable |
| Frontend | TypeScript, Kotlin, Swift | Interactive |

## Directory Structure

```
TigerEx/
├── ultra_low_latency_domain/     # C++ matching engine, Rust risk
├── distributed_exchange_backend/   # Go microservices, APIs
├── banking_and_enterprise_finance/ # Java enterprise systems
├── blockchain_and_web3/         # Rust wallets, Solidity contracts
├── ai_quant_and_research/       # Python ML, CUDA training
├── frontend_ecosystem/         # TypeScript, mobile apps
├── data_and_storage_architecture/ # SQL, NoSQL, Vector DBs
├── realtime_messaging_backbone/ # Kafka, NATS, Pulsar
├── infrastructure_and_sre/     # K8s, Terraform, observability
└── language_ownership_matrix/   # Language-specific ownership
```

## Technology Stack

### Low Latency Layer
- **C++17/20** - Matching engine, orderbook, HFT paths
- **Rust** - Ultra-low latency risk, wallet signing
- **FPGA/Verilog** - Hardware acceleration, feed handlers

### Backend Layer
- **Go** - API gateway, WebSocket, streaming
- **Rust** - High-performance microservices

### Enterprise Layer
- **Java 21** - Banking, compliance, reporting
- **Kotlin** - Android mobile

### Frontend Layer
- **TypeScript/React** - Web trading terminals
- **Swift** - iOS applications

### AI/Quant Layer
- **Python** - ML models, research, fraud detection
- **CUDA** - GPU training clusters

## Getting Started

See individual domain READMEs for setup instructions.

## Why Polyglot Architecture?

An exchange at Binance scale processes:
- 5M+ orders/second core matching
- Millions of WebSocket connections
- Billions in daily volume
- Regulatory compliance requirements

No single language optimizes for all these constraints simultaneously. Elite exchanges allocate languages by latency domain, safety domain, and operational domain.

**The "best" language depends on the problem domain.**