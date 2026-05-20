# Data and Storage Architecture

Multi-model database strategy optimized for exchange workloads.

## Transactional SQL

### PostgreSQL / CockroachDB
Banking and ledger data:
- ACID transactions
- Financial accounting
- Compliance audits
- User data

### TiDB
Distributed MySQL:
- Horizontal scaling
- HTAP workloads

## Ultra Low Latency Storage

### Redis / DragonflyDB
Hot path caching:
- Order book snapshots
- Session data
- Rate limiting
- Pub/Sub

### RocksDB / ScyllaDB
Low-latency persistence:
- Time-series orderbook
- Trade history
- Tick data

## Analytical Platforms

### ClickHouse
Analytical queries:
- Trading analytics
- User behavior
- Business intelligence
- Ad-hoc queries

### Snowflake / BigQuery
Cloud data warehousing:
- Historical analysis
- Regulatory reporting
- ML feature storage

## Time Series

### QuestDB / TimescaleDB
Time-series optimized:
- Market data ticks
- Price history
- OHLCV candles

## Vector Databases

### Qdrant / Milvus
AI/ML storage:
- Embeddings storage
- Similarity search
- Fraud detection features

## Archive

### S3 / MinIO
Cold storage:
- Parquet data lakes
- Trade archives
- Compliance records