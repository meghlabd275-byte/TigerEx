# Realtime Messaging Backbone

Message streaming infrastructure powering real-time operations.

## Primary: Kafka

Kafka powers most event streaming:
- Market data distribution
- Order events
- Wallet events
- Audit streams

### Topics Structure
```
market_data.{symbol}    - Per-symbol market data
orders.{account_id}    - Per-account order events  
wallet.{currency}      - Wallet events
audit                - All audit events
replay               - Replay streams
```

## Alternate: NATS

Lightweight messaging:
- Service discovery
- Health monitoring
- Internal RPC

## Alternate: Pulsar

Geo-distributed:
- Multi-region replication
- Lower latency than Kafka

## CQRS Pattern

Uses event sourcing for:
- Order history
- Balance tracking
- Audit trails
- State reconstruction