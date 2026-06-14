-- TigerEx PostgreSQL Database Schema
-- Complete production-ready database for a Binance-level exchange
-- PostgreSQL 14+

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "hstore";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE user_status AS ENUM (
    'pending',
    'email_verified',
    'kyc_pending',
    'kyc_verified',
    'suspended',
    'banned',
    'closed'
);

CREATE TYPE kyc_level AS ENUM (
    'none',
    'basic',
    'intermediate',
    'full',
    'institutional'
);

CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop_market', 'stop_limit', 'trailing_stop');
CREATE TYPE order_time_in_force AS ENUM ('gtc', 'ioc', 'fok', 'gtx');
CREATE TYPE order_status AS ENUM ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired');
CREATE TYPE position_side AS ENUM ('long', 'short', 'both');

CREATE TYPE trade_type AS ENUM ('spot', 'margin', 'futures', 'options');

CREATE TYPE transaction_type AS ENUM (
    'deposit',
    'withdrawal',
    'trade_buy',
    'trade_sell',
    'fee',
    'transfer',
    'airdrop',
    'staking_reward',
    'loan',
    'repayment',
    'adjustment',
    'distribution',
    'burn'
);

CREATE TYPE transaction_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE wallet_type AS ENUM ('hot', 'cold', 'warm', 'institutional', 'trading');

CREATE TYPE verification_type AS ENUM (
    'email',
    'phone',
    'kyc_id',
    'kyc_address',
    'kyc_selfie',
    'kyc_document',
    '2fa',
    'withdrawal_whitelist'
);

CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- ============================================
-- TABLES: USERS & ACCOUNTS
-- ============================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email CITEXT UNIQUE NOT NULL,
    username VARCHAR(32) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status user_status DEFAULT 'pending',
    kyc_level kyc_level DEFAULT 'none',
    
    -- Personal info (encrypted)
    first_name_encrypted BYTEA,
    last_name_encrypted BYTEA,
    date_of_birth_encrypted BYTEA,
    national_id_encrypted BYTEA,
    
    -- Account settings
    prefer_spot_encrypted BOOLEAN DEFAULT true,
    prefer_margin_encrypted BOOLEAN DEFAULT false,
    prefer_futures_encrypted BOOLEAN DEFAULT false,
    trading_view_encrypted VARCHAR(10) DEFAULT 'chart',
    timezone_encrypted VARCHAR(50) DEFAULT 'UTC',
    language_encrypted VARCHAR(10) DEFAULT 'en',
    
    -- Security
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    last_login_at TIMESTAMP,
    last_login_ip INET,
    last_login_user_agent TEXT,
    force_password_change BOOLEAN DEFAULT false,
    enable_2fa BOOLEAN DEFAULT false,
    2fa_secret_encrypted BYTEA,
    
    -- Referral
    referrer_id UUID REFERENCES users(id),
    referral_code VARCHAR(32) UNIQUE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Version for optimistic locking
    version INTEGER DEFAULT 1
);

-- Indexes for users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_referral_code ON users(referral_code);

-- User sessions
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason TEXT
);

CREATE INDEX idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    permissions TEXT[] DEFAULT '{}',
    ip_whitelist INET[],
    rate_limit INTEGER DEFAULT 600,
    enabled BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_keys_key ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- ============================================
-- TABLES: WALLETS & BALANCES
-- ============================================

-- Wallets (user wallet addresses per currency)
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    wallet_type wallet_type DEFAULT 'trading',
    address VARCHAR(100),
    memo VARCHAR(100),
    is_default BOOLEAN DEFAULT false,
    label VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_wallets_user ON wallets(user_id, currency);

-- Account balances (per user per currency)
CREATE TABLE balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    available DECIMAL(30, 18) DEFAULT 0,
    locked DECIMAL(30, 18) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE(user_id, currency)
);

CREATE INDEX idx_balances_user ON balances(user_id);

-- Balance change history (for auditing)
CREATE TABLE balance_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    change_amount DECIMAL(30, 18) NOT NULL,
    balance_after DECIMAL(30, 18) NOT NULL,
    change_type transaction_type NOT NULL,
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_balance_changes_user ON balance_changes(user_id, created_at DESC);

-- ============================================
-- TABLES: MARKETS & TRADING PAIRS
-- ============================================

-- Markets (trading pairs)
CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(20) NOT NULL,
    quote_currency VARCHAR(20) NOT NULL,
    
    -- Market settings
    status VARCHAR(20) DEFAULT 'online',
    is_trading_enabled BOOLEAN DEFAULT true,
    min_price DECIMAL(30, 18),
    max_price DECIMAL(30, 18),
    price_precision INTEGER DEFAULT 8,
    min_quantity DECIMAL(30, 18),
    max_quantity DECIMAL(30, 18),
    quantity_precision INTEGER DEFAULT 8,
    min_notional DECIMAL(30, 18),
    
    -- Fee structure
    maker_fee DECIMAL(10, 6) DEFAULT 0.001,
    taker_fee DECIMAL(10, 6) DEFAULT 0.001,
    
    -- Market data
    last_price DECIMAL(30, 18),
    last_quantity DECIMAL(30, 18),
    volume_24h DECIMAL(30, 18) DEFAULT 0,
    volume_usd_24h DECIMAL(30, 18) DEFAULT 0,
    price_change_24h DECIMAL(30, 18) DEFAULT 0,
    high_24h DECIMAL(30, 18),
    low_24h DECIMAL(30, 18),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_markets_symbol ON markets(symbol);

-- Currencies
CREATE TABLE currencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) DEFAULT 'crypto',
    decimals INTEGER DEFAULT 18,
    precision INTEGER DEFAULT 8,
    min_withdrawal DECIMAL(30, 18),
    max_withdrawal DECIMAL(30, 18),
    withdrawal_fee DECIMAL(30, 18),
    is_deposit_enabled BOOLEAN DEFAULT true,
    is_withdrawal_enabled BOOLEAN DEFAULT true,
    is_trading_enabled BOOLEAN DEFAULT true,
    is_network_active BOOLEAN DEFAULT true,
    contract_address VARCHAR(100),
    network VARCHAR(50),
    explorer_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_currencies_symbol ON currencies(symbol);

-- ============================================
-- TABLES: ORDERS & TRADES
-- ============================================

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID REFERENCES markets(id),
    symbol VARCHAR(20) NOT NULL,
    
    -- Order details
    side order_side NOT NULL,
    type order_type NOT NULL,
    time_in_force order_time_in_force DEFAULT 'gtc',
    
    -- Prices & quantities
    price DECIMAL(30, 18),
    stop_price DECIMAL(30, 18),
    quantity DECIMAL(30, 18) NOT NULL,
    filled_quantity DECIMAL(30, 18) DEFAULT 0,
    average_fill_price DECIMAL(30, 18),
    
    -- Status
    status order_status DEFAULT 'pending',
    rejection_reason TEXT,
    
    -- Execution
    client_order_id VARCHAR(100),
    fee_currency VARCHAR(20),
    fee_paid DECIMAL(30, 18) DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    executed_at TIMESTAMP WITH TIME ZONE,
    expired_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_market ON orders(market_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_client_id ON orders(client_order_id);

-- Trades (filled orders)
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    market_id UUID REFERENCES markets(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Trade details
    side order_side NOT NULL,
    price DECIMAL(30, 18) NOT NULL,
    quantity DECIMAL(30, 18) NOT NULL,
    quote_quantity DECIMAL(30, 18) NOT NULL,
    
    -- Fees
    fee_amount DECIMAL(30, 18) DEFAULT 0,
    fee_currency VARCHAR(20),
    
    -- Counterparty
    counter_user_id UUID REFERENCES users(id),
    counter_order_id UUID REFERENCES orders(id),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trades_order ON trades(order_id);
CREATE INDEX idx_trades_user ON trades(user_id, created_at DESC);
CREATE INDEX idx_trades_market ON trades(market_id, created_at DESC);

-- ============================================
-- TABLES: POSITIONS & MARGIN
-- ============================================

-- Positions (for margin/futures)
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID REFERENCES markets(id),
    symbol VARCHAR(20) NOT NULL,
    
    -- Position details
    side position_side NOT NULL,
    quantity DECIMAL(30, 18) DEFAULT 0,
    entry_price DECIMAL(30, 18),
    liquidation_price DECIMAL(30, 18),
    unrealized_pnl DECIMAL(30, 18) DEFAULT 0,
    realized_pnl DECIMAL(30, 18) DEFAULT 0,
    
    -- Margin
    margin DECIMAL(30, 18) DEFAULT 0,
    leverage DECIMAL(10, 2) DEFAULT 0,
    
    -- Timestamps
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_market ON positions(market_id);

-- Margin accounts
CREATE TABLE margin_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    collateral DECIMAL(30, 18) DEFAULT 0,
    debt DECIMAL(30, 18) DEFAULT 0,
    interest_accrued DECIMAL(30, 18) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, currency)
);

-- ============================================
-- TABLES: DEPOSITS & WITHDRAWALS
-- ============================================

-- Deposits
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    tx_hash VARCHAR(100),
    from_address VARCHAR(100),
    to_address VARCHAR(100) NOT NULL,
    confirmations INTEGER DEFAULT 0,
    required_confirmations INTEGER DEFAULT 10,
    status transaction_status DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_deposits_user ON deposits(user_id);
CREATE INDEX idx_deposits_tx ON deposits(tx_hash);
CREATE INDEX idx_deposits_status ON deposits(status);

-- Withdrawals
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    fee DECIMAL(30, 18) DEFAULT 0,
    net_amount DECIMAL(30, 18) NOT NULL,
    to_address VARCHAR(100) NOT NULL,
    tx_hash VARCHAR(100),
    status transaction_status DEFAULT 'pending',
    rejection_reason TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);

-- Withdrawal whitelist
CREATE TABLE withdrawal_whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    address VARCHAR(100) NOT NULL,
    network VARCHAR(50),
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLES: KYC & VERIFICATIONS
-- ============================================

-- KYC Records
CREATE TABLE kyc_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kyc_level kyc_level DEFAULT 'none',
    
    -- Document info
    document_type VARCHAR(50),
    document_number VARCHAR(100),
    document_front BYTEA,
    document_back BYTEA,
    document_selfie BYTEA,
    proof_of_address BYTEA,
    
    -- Verification
    verification_status verification_status DEFAULT 'pending',
    verified_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    -- External references
    external_reference VARCHAR(100),
    provider VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_kyc_user ON kyc_records(user_id);

-- AML Flags
CREATE TABLE aml_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flag_type VARCHAR(50) NOT NULL,
    risk_score INTEGER DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id)
);

-- ============================================
-- TABLES: FEES & REVENUE
-- ============================================

-- Fee collection
CREATE TABLE fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    fee_type VARCHAR(50) NOT NULL,
    reference_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_fees_user ON fees(user_id);
CREATE INDEX idx_fees_created ON fees(created_at DESC);

-- Revenue distribution
CREATE TABLE revenue_distributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    total_revenue DECIMAL(30, 18) NOT NULL,
    platform_share DECIMAL(30, 18),
    team_share DECIMAL(30, 18),
    rewards_share DECIMAL(30, 18),
    treasury_share DECIMAL(30, 18),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLES: AUDIT & COMPLIANCE
-- ============================================

-- Audit logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- API request logs
CREATE TABLE api_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    api_key_id UUID REFERENCES api_keys(id),
    method VARCHAR(10) NOT NULL,
    path VARCHAR(255) NOT NULL,
    query_params JSONB,
    request_body JSONB,
    response_status INTEGER,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_logs_user ON api_logs(user_id, created_at DESC);
CREATE INDEX idx_api_logs_path ON api_logs(path);

-- ============================================
-- TABLES: TRADING BOTS
-- ============================================

-- Bot configurations
CREATE TABLE trading_bots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_type VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    
    -- Statistics
    total_pnl DECIMAL(30, 18) DEFAULT 0,
    trade_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trading_bots_user ON trading_bots(user_id);

-- Bot trades
CREATE TABLE bot_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
    market_id UUID REFERENCES markets(id),
    side order_side NOT NULL,
    quantity DECIMAL(30, 18) NOT NULL,
    price DECIMAL(30, 18) NOT NULL,
    pnl DECIMAL(30, 18) DEFAULT 0,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bot_trades_bot ON bot_trades(bot_id, executed_at DESC);

-- ============================================
-- TABLES: PROOF OF RESERVES
-- ============================================

-- Merkle tree snapshots
CREATE TABLE merkle_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_hash VARCHAR(100) NOT NULL,
    tree_root_hash VARCHAR(100) NOT NULL,
    total_liabilities DECIMAL(30, 18) NOT NULL,
    total_reserves DECIMAL(30, 18) NOT NULL,
    coverage_ratio DECIMAL(10, 6) NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Individual account proofs
CREATE TABLE account_proofs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_id UUID NOT NULL REFERENCES merkle_snapshots(id),
    user_id UUID NOT NULL REFERENCES users(id),
    balance DECIMAL(30, 18) NOT NULL,
    merkle_proof BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_account_proofs_snapshot ON account_proofs(snapshot_id);
CREATE INDEX idx_account_proofs_user ON account_proofs(user_id);

-- ============================================
-- TABLES: STAKING & EARN
-- ============================================

-- Staking positions
CREATE TABLE staking_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    locked_amount DECIMAL(30, 18) DEFAULT 0,
    rewards DECIMAL(30, 18) DEFAULT 0,
    apy DECIMAL(10, 6) DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ends_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_staking_user ON staking_positions(user_id);

-- Earn products
CREATE TABLE earn_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    currency VARCHAR(20) NOT NULL,
    product_type VARCHAR(50) NOT NULL,
    min_amount DECIMAL(30, 18),
    max_amount DECIMAL(30, 18),
    apy DECIMAL(10, 6) NOT NULL,
    duration_days INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Earn subscriptions
CREATE TABLE earn_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES earn_products(id),
    amount DECIMAL(30, 18) NOT NULL,
    expected_payout DECIMAL(30, 18) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE INDEX idx_earn_subs_user ON earn_subscriptions(user_id);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_balances_updated_at BEFORE UPDATE ON balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Version increment trigger
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_users_version BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER increment_balances_version BEFORE UPDATE ON balances
    FOR EACH ROW EXECUTE FUNCTION increment_version();

-- ============================================
-- PERFORMANCE VIEWS
-- ============================================

-- Market ticker view
CREATE VIEW market_ticker AS
SELECT
    m.symbol,
    m.base_currency,
    m.quote_currency,
    m.last_price,
    m.price_change_24h,
    m.volume_24h,
    m.volume_usd_24h,
    m.high_24h,
    m.low_24h,
    m.updated_at
FROM markets m
WHERE m.status = 'online';

-- User portfolio view
CREATE VIEW user_portfolio AS
SELECT
    u.id as user_id,
    u.email,
    b.currency,
    b.available,
    b.locked,
    b.available + b.locked as total,
    c.price_usd,
    (b.available + b.locked) * COALESCE(c.price_usd, 0) as value_usd
FROM users u
JOIN balances b ON b.user_id = u.id
LEFT JOIN currency_prices c ON c.currency = b.currency;

-- ============================================
-- CURRENCY PRICES (for portfolio value)
-- ============================================

CREATE TABLE currency_prices (
    currency VARCHAR(20) PRIMARY KEY,
    price_usd DECIMAL(30, 18),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- SEEDS
-- ============================================

-- Insert default currencies
INSERT INTO currencies (symbol, name, type, decimals, precision) VALUES
('BTC', 'Bitcoin', 'crypto', 8, 8),
('ETH', 'Ethereum', 'crypto', 18, 8),
('TGR', 'Tiger Coin', 'crypto', 18, 8),
('RUSD', 'Royal Tiger USD', 'stablecoin', 18, 2),
('USDT', 'Tether USD', 'stablecoin', 6, 2),
('USDC', 'USD Coin', 'stablecoin', 6, 2),
('BNB', 'BNB', 'crypto', 18, 8),
('SOL', 'Solana', 'crypto', 9, 8),
('MATIC', 'Polygon', 'crypto', 18, 8),
('AVAX', 'Avalanche', 'crypto', 18, 8);

-- Insert default markets
INSERT INTO markets (symbol, base_currency, quote_currency, maker_fee, taker_fee) VALUES
('TGR/USDT', 'TGR', 'USDT', 0.001, 0.001),
('TGR/USDC', 'TGR', 'USDC', 0.001, 0.001),
('ETH/USDT', 'ETH', 'USDT', 0.001, 0.001),
('BTC/USDT', 'BTC', 'USDT', 0.001, 0.001),
('BNB/USDT', 'BNB', 'USDT', 0.001, 0.001),
('SOL/USDT', 'SOL', 'USDT', 0.001, 0.001),
('ETH/BTC', 'ETH', 'BTC', 0.001, 0.001),
('BTC/USDC', 'BTC', 'USDC', 0.001, 0.001);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_changes_created ON balance_changes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_created ON deposits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created ON withdrawals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_logs(created_at DESC);

-- Analyze tables for query planner
ANALYZE users;
ANALYZE balances;
ANALYZE orders;
ANALYZE trades;
ANALYZE markets;
ANALYZE currencies;