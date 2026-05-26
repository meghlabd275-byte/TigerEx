#!/usr/bin/env python3
"""
TigerEx - Python to Rust/Go Conversion Guide

This file lists all Python files that should be converted to Rust or Go
for optimal performance and low latency.

CONVERSION PRIORITY:
====================

TIER 1 - CRITICAL (Microsecond Latency Required):
------------------------------------------------
1. backend/python/src/order/manager.py         -> Go (order_manager.go) ✓ DONE
2. backend/python/src/risk_management/risk_manager.py -> Go (risk_manager.go) ✓ DONE
3. backend/python/src/stream/processor.py    -> Rust (streaming processor)
4. backend/python/src/ws/handler.py          -> Rust (websocket handler)
5. backend/python/src/matching/              -> C++ or Rust

TIER 2 - HIGH PERFORMANCE (Millisecond Latency):
-------------------------------------------------
6. backend/python/src/analytics/pipeline.py   -> Go
7. backend/python/src/analytics/trading_analytics.py -> Go
8. backend/python/src/cache/manager.py        -> Go (Redis client)
9. backend/python/src/limit/checker.py       -> Go
10. backend/python/src/routing/router.py      -> Go

TIER 3 - BUSINESS LOGIC (Moderate Latency OK):
----------------------------------------------
11. backend/python/src/api/handlers.py       -> Go
12. backend/python/src/billing/billing.py     -> Python (keep)
13. backend/python/src/notification/notify.py -> Python (keep)
14. backend/python/src/aml/checker.py         -> Python (keep)
15. backend/python/src/audit/logger.py       -> Go

TIER 4 - ML/ANALYTICS (Can Remain Python):
-------------------------------------------
16. backend/python/src/ml/                    -> Python (GPU acceleration)
17. backend/python/src/analytics/             -> Python (pandas/numpy)
18. backend/python/src/research/              -> Python (keep)

CONVERSION MAPPING BY LANGUAGE:
=============================

RUST (Performance-Critical):
- Matching engine
- WebSocket handler
- Stream processor
- Cryptographic operations
- High-frequency trading

GO (Microservices):
- Order management
- Risk management
- Wallet management
- API handlers
- Analytics pipelines
- Cache management

C++ (Ultra-Low Latency):
- Core matching engine
- Price aggregation
- Network protocols

PYTHON (Business Logic):
- KYC/AML services
- Billing/Accounting
- Notifications
- Admin operations
- ML models

FILES ALREADY CONVERTED:
========================
✓ core_exchange_engine/order_manager.go
✓ margin_trading/risk_manager.go
✓ user_wallet/wallet_manager.go

FILES TO CONVERT NEXT:
======================
1. backend/python/src/stream/processor.py -> Rust
2. backend/python/src/ws/handler.py -> Rust
3. backend/python/src/cache/manager.py -> Go
4. backend/python/src/analytics/pipeline.py -> Go
"""

# Quick reference for conversion
CONVERSION_GUIDE = """
RUST BEST FOR:
- Zero-cost abstractions
- Memory safety without GC
- Concurrency without data races
- Embeddable
- High-frequency trading

GO BEST FOR:
- Microservices
- Network services
- CLI tools
- DevOps tooling
- Quick prototyping

C++ BEST FOR:
- Matching engines
- Protocol implementation
- Hardware access
- Games/Graphics
"""

if __name__ == "__main__":
    print("TigerEx Conversion Guide")
    print("=" * 40)
    print(__doc__)