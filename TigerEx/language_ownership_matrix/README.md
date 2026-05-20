# Language Ownership Matrix

Documentation of which language owns which components.

## C++ : Ultra-Low Latency

Owners: matching_engine, orderbook_core, hft_execution, feed_handlers, smart_order_routing, low_latency_networking, hardware_acceleration, nanosecond_systems

**Use Cases:**
- Matching engine (core)
- Lock-free orderbook
- Kernel bypass networking (DPDK)
- Hardware timestamp parsing

## Rust : Safety-Critical Infrastructure

Owners: custody, wallets, settlement, risk_engine, blockchain_nodes, payment_core, security_systems, proof_of_reserves, transaction_integrity, memory_safe_infrastructure

**Use Cases:**
- Custody and wallet signing
- Settlement systems
- Pre-trade risk checks
- Blockchain node operators

## Go : Distributed Systems

Owners: microservices, websocket_infrastructure, grpc_services, streaming_platforms, distributed_systems, realtime_apis, orchestration_services, cloud_native_infrastructure

**Use Cases:**
- API Gateways
- WebSocket servers
- Event streaming
- Microservices

## Java : Enterprise Finance

Owners: banking_systems, compliance, enterprise_workflows, financial_reporting, institutional_operations, accounting, reconciliation, regulated_financial_systems

**Use Cases:**
- Banking integrations
- Compliance reporting
- Accounting engines
- Enterprise workflows

## Python : AI and Research

Owners: ai_models, machine_learning, quant_research, backtesting, fraud_detection, analytics, llm_systems, automation

**Use Cases:**
- ML model training
- Quantitative research
- Fraud detection
- Analytics pipelines

## TypeScript : Frontend

Owners: web_frontend, dashboards, realtime_ui, trading_terminal, admin_systems, sdk_development, frontend_bff_layers

**Use Cases:**
- Trading web apps
- Admin dashboards
- SDKs
- BFF layers

## Kotlin : Android

Owners: android_apps, banking_mobile_features, secure_mobile_payments, realtime_mobile_trading

**Use Cases:**
- Android trading app
- Secure payments

## Swift : iOS

Owners: ios_apps, secure_enclave, apple_pay, institutional_mobile_tools, mobile_wallet_security

**Use Cases:**
- iOS trading app
- Secure enrollment

## Solidity : Smart Contracts

Owners: tokenization, staking_protocols, governance, rwa_contracts, smart_contract_protocols

**Use Cases:**
- Token contracts
- Staking programs

## Zig : Experimental

Owners: experimental_low_latency, custom_memory_management, networking_research, embedded_hft_components

**Use Cases:**
- Alternative allocator research
- Embedded low-latency tools

## CUDA : GPU Computing

Owners: ai_training, inference_acceleration, quant_compute, gpu_parallel_processing

**Use Cases:**
- ML model training
- Large-scale simulation

## Verilog/VHDL : Hardware

Owners: fpga_matching_acceleration, packet_processing, feed_handlers, smartnic_logic, hardware_trading_paths

**Use Cases:**
- FPGA feed handlers
- SmartNIC offload
- Hardware trading

---

## Summary Table

| Language | Count | Primary Use |
|---------|-------|-----------|
| C++ | 8 | Matching Engine |
| Rust | 10 | Security Infra |
| Go | 8 | Distributed Backend |
| Java | 8 | Enterprise Finance |
| Python | 8 | AI/ML |
| TypeScript | 7 | Frontend |
| Kotlin | 4 | Android |
| Swift | 5 | iOS |
| Solidty | 5 | Smart Contracts |
| Zig | 4 | Experimental |
| CUDA | 4 | GPU Computing |
| Verilog/VHDL | 5 | Hardware |