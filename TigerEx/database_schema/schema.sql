-- =====================================================
-- TigerEx Database Schema - PostgreSQL
-- Version: 1.0.0
-- Target: High-performance trading system (100M TPS)
-- =====================================================

-- =====================================================
-- USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    kyc_level INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    can_trade BOOLEAN DEFAULT false,
    can_withdraw BOOLEAN DEFAULT false,
    can_deposit BOOLEAN DEFAULT false,
    country VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created ON users(created_at);

-- =====================================================
-- USER SESSIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    refresh_token VARCHAR(500),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- =====================================================
-- ACCOUNTS (Wallets)
-- =====================================================
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(10) NOT NULL,
    balance NUMERIC(30, 18) DEFAULT 0,
    locked_balance NUMERIC(30, 18) DEFAULT 0,
    available_balance NUMERIC(30, 18) GENERATED ALWAYS AS (balance - locked_balance) STORED,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, currency)
);

CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_accounts_currency ON accounts(currency);

-- =====================================================
-- MARKETS
-- =====================================================
CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    min_quantity NUMERIC(30, 18) DEFAULT 0.0001,
    max_quantity NUMERIC(30, 18),
    min_price NUMERIC(30, 18) DEFAULT 0.01,
    max_price NUMERIC(30, 18),
    tick_size NUMERIC(30, 18) DEFAULT 0.01,
    lot_size NUMERIC(30, 18) DEFAULT 0.0001,
    maker_fee NUMERIC(10, 6) DEFAULT 0.001,
    taker_fee NUMERIC(10, 6) DEFAULT 0.001,
    status VARCHAR(20) DEFAULT 'trading',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_markets_symbol ON markets(symbol);

-- =====================================================
-- ORDERS
-- =====================================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    side VARCHAR(10) NOT NULL, -- BUY, SELL
    type VARCHAR(20) NOT NULL, -- LIMIT, MARKET, STOP, etc.
    quantity NUMERIC(30, 18) NOT NULL,
    price NUMERIC(30, 18),
    stop_price NUMERIC(30, 18),
    filled_quantity NUMERIC(30, 18) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    time_in_force VARCHAR(10) DEFAULT 'GTC',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT valid_side CHECK (side IN ('BUY', 'SELL')),
    CONSTRAINT valid_type CHECK (type IN ('LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LIMIT', 'TAKE_PROFIT'))
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_market ON orders(market_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- =====================================================
-- TRADES (Filled Orders)
-- =====================================================
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id),
    counter_order_id UUID,
    market_id UUID NOT NULL REFERENCES markets(id),
    side VARCHAR(10) NOT NULL,
    price NUMERIC(30, 18) NOT NULL,
    quantity NUMERIC(30, 18) NOT NULL,
    fee NUMERIC(30, 18) DEFAULT 0,
    fee_currency VARCHAR(10),
    maker BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trades_order ON trades(order_id);
CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_created ON trades(created_at DESC);

-- =====================================================
-- POSITIONS (Margin Trading)
-- =====================================================
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id),
    side VARCHAR(10) NOT NULL,
    quantity NUMERIC(30, 18) NOT NULL,
    entry_price NUMERIC(30, 18) NOT NULL,
    unrealized_pnl NUMERIC(30, 18) DEFAULT 0,
    realized_pnl NUMERIC(30, 18) DEFAULT 0,
    leverage INT DEFAULT 1,
    liquidation_price NUMERIC(30, 18),
    status VARCHAR(20) DEFAULT 'open',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, market_id) WHERE status = 'open'
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_status ON positions(status);

-- =====================================================
-- TRANSACTIONS (Deposits/Withdrawals)
-- =====================================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    type VARCHAR(20) NOT NULL, -- DEPOSIT, WITHDRAWAL, TRANSFER
    amount NUMERIC(30, 18) NOT NULL,
    fee NUMERIC(30, 18) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    tx_hash VARCHAR(100), -- Blockchain transaction hash
    address VARCHAR(255), -- Destination address
    network VARCHAR(20),
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT valid_type CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER'))
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_hash ON transactions(tx_hash);

-- =====================================================
-- KYC RECORDS
-- =====================================================
CREATE TABLE IF NOT EXISTS kyc_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    level INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    document_type VARCHAR(50),
    document_number VARCHAR(100),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    dob DATE,
    address VARCHAR(500),
    verified_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_kyc_user ON kyc_records(user_id);
CREATE INDEX idx_kyc_status ON kyc_records(status);

-- =====================================================
-- API KEYS
-- =====================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(100) UNIQUE NOT NULL,
    secret_hash VARCHAR(255) NOT NULL,
    permissions TEXT[], -- READ, WRITE, WITHDRAW
    ip_whitelist TEXT[],
    expired_at TIMESTAMP,
    last_used_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_key ON api_keys(key);

-- =====================================================
-- AUDIT LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Updateaccount balance
CREATE OR REPLACE FUNCTION update_account_balance(
    p_account_id UUID,
    p_amount NUMERIC,
    p_lock BOOLEAN DEFAULT false
)
RETURNS VOID AS $$
BEGIN
    IF p_lock THEN
        UPDATE accounts 
        SET locked_balance = locked_balance + p_amount,
            updated_at = NOW()
        WHERE id = p_account_id;
    ELSE
        UPDATE accounts 
        SET balance = balance + p_amount,
            updated_at = NOW()
        WHERE id = p_account_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Get account balance with lock
CREATE OR REPLACE FUNCTION get_account_with_lock(p_user_id UUID, p_currency VARCHAR)
RETURNS TABLE(balance NUMERIC, available NUMERIC, locked NUMERIC) AS $$
BEGIN
    RETURN QUERY
    SELECT a.balance, a.available_balance, a.locked_balance
    FROM accounts a
    WHERE a.user_id = p_user_id AND a.currency = p_currency
    FOR UPDATE;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PARTITIONS (For high volume tables)
-- =====================================================

-- Partition trades by month for scalability
CREATE TABLE IF NOT EXISTS trades_partitioned (
    LIKE trades INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE IF NOT EXISTS trades_2026_06 PARTITION OF trades_partitioned
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS trades_2026_07 PARTITION OF trades_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Partition orders by month
CREATE TABLE IF NOT EXISTS orders_partitioned (
    LIKE orders INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS orders_2026_06 PARTITION OF orders_partitioned
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- =====================================================
-- PERFORMANCE TUNING
-- =====================================================

-- Analyze tables for query planner
ANALYZE users;
ANALYZE accounts;
ANALYZE orders;
ANALYZE trades;
ANALYZE transactions;

-- Set table statistics target
ALTER TABLE users ALTER COLUMN status SET STATISTICS 100;
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 100;

-- =============================================================================
-- LEDGER TABLE (for transaction history)
-- =============================================================================
CREATE TABLE IF NOT EXISTS ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- deposit, withdrawal, trade, fee, adjustment
    amount DECIMAL(36, 18) NOT NULL,
    balance DECIMAL(36, 18) NOT NULL,
    reference VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ledger_account ON ledger(account_id);
CREATE INDEX idx_ledger_type ON ledger(type);
CREATE INDEX idx_ledger_created ON ledger(created_at);

-- Vacuum regularly
CREATE CONCURRENTLY IF NOT EXISTS vacuum_schedule(
    job_name TEXT,
    table_name TEXT,
    schedule TEXT
);