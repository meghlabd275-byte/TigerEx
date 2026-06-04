-- TigerEx Database Migrations
-- Version: 001_initial_schema

-- Migration: 001_initial_schema.sql
-- Description: Initial database schema for TigerEx exchange

BEGIN;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    two_factor_secret VARCHAR(255),
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    kyc_level INTEGER DEFAULT 0,
    kyc_status VARCHAR(50) DEFAULT 'pending',
    status VARCHAR(50) DEFAULT 'active',
    referrer_id UUID REFERENCES users(id),
    referral_code VARCHAR(20) UNIQUE,
    country VARCHAR(10),
    language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    last_login_at TIMESTAMP,
    last_login_ip VARCHAR(45),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================
-- USER SESSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);

-- ============================================
-- API KEYS
-- ============================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id VARCHAR(64) UNIQUE NOT NULL,
    key_secret_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    permissions JSONB DEFAULT '[]',
    ip_whitelist TEXT[],
    rate_limit INTEGER DEFAULT 600,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- WALLETS
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    wallet_type VARCHAR(20) DEFAULT 'spot',
    balance DECIMAL(30, 18) DEFAULT 0,
    available_balance DECIMAL(30, 18) DEFAULT 0,
    locked_balance DECIMAL(30, 18) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, currency, wallet_type)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- ============================================
-- DEPOSIT ADDRESSES
-- ============================================
CREATE TABLE IF NOT EXISTS deposit_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(30) NOT NULL,
    address VARCHAR(500) NOT NULL,
    address_tag VARCHAR(500),
    is_primary BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(30, 18) NOT NULL,
    fee DECIMAL(30, 18) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'pending',
    tx_hash VARCHAR(255),
    from_address VARCHAR(500),
    to_address VARCHAR(500),
    network VARCHAR(30),
    confirmations INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trans_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_trans_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_trans_status ON transactions(status);

-- ============================================
-- MARKETS
-- ============================================
CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(20) NOT NULL,
    quote_currency VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'trading',
    base_precision INTEGER DEFAULT 8,
    quote_precision INTEGER DEFAULT 8,
    min_price DECIMAL(30, 18),
    max_price DECIMAL(30, 18),
    tick_size DECIMAL(30, 18),
    min_quantity DECIMAL(30, 18),
    min_notional DECIMAL(30, 18),
    maker_fee DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee DECIMAL(10, 8) DEFAULT 0.001,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_symbol ON markets(symbol);

-- ============================================
-- ORDERS
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_order_id VARCHAR(100),
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(20) NOT NULL,
    price DECIMAL(30, 18),
    stop_price DECIMAL(30, 18),
    quantity DECIMAL(30, 18) NOT NULL,
    filled_quantity DECIMAL(30, 18) DEFAULT 0,
    avg_fill_price DECIMAL(30, 18),
    time_in_force VARCHAR(10) DEFAULT 'GTC',
    status VARCHAR(20) DEFAULT 'new',
    is_liquidation BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    filled_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================
-- TRADES
-- ============================================
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    price DECIMAL(30, 18) NOT NULL,
    quantity DECIMAL(30, 18) NOT NULL,
    maker_order_id UUID,
    taker_order_id UUID,
    maker_user_id UUID,
    taker_user_id UUID,
    maker_fee DECIMAL(30, 18) DEFAULT 0,
    taker_fee DECIMAL(30, 18) DEFAULT 0,
    is_maker BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);

-- ============================================
-- KYC DOCUMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    issuing_country VARCHAR(10),
    file_urls JSONB DEFAULT '[]',
    extracted_data JSONB DEFAULT '{}',
    verification_status VARCHAR(30) DEFAULT 'pending',
    rejection_reason TEXT,
    verified_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ADMIN USERS
-- ============================================
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    permissions JSONB DEFAULT '[]',
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ADMIN AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES admin_users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_log(created_at DESC);

-- ============================================
-- TRADING FEES
-- ============================================
CREATE TABLE IF NOT EXISTS trading_fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier_name VARCHAR(50) NOT NULL,
    maker_fee DECIMAL(10, 8) NOT NULL,
    taker_fee DECIMAL(10, 8) NOT NULL,
    min_volume_30d DECIMAL(30, 18),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- SEED DATA
-- ============================================
INSERT INTO markets (symbol, base_currency, quote_currency, tick_size, min_quantity, min_notional, maker_fee, taker_fee) VALUES
('BTCUSDT', 'BTC', 'USDT', '0.01', '0.00001', '10', 0.001, 0.001),
('ETHUSDT', 'ETH', 'USDT', '0.01', '0.0001', '10', 0.001, 0.001),
('BNBUSDT', 'BNB', 'USDT', '0.01', '0.001', '10', 0.001, 0.001),
('SOLUSDT', 'SOL', 'USDT', '0.001', '0.01', '10', 0.001, 0.001),
('XRPUSDT', 'XRP', 'USDT', '0.0001', '1', '10', 0.001, 0.001),
('ADAUSDT', 'ADA', 'USDT', '0.0001', '1', '10', 0.001, 0.001),
('DOGEUSDT', 'DOGE', 'USDT', '0.00001', '1', '10', 0.001, 0.001);

INSERT INTO trading_fees (tier_name, maker_fee, taker_fee, min_volume_30d) VALUES
('standard', 0.001, 0.001, 0),
('vip1', 0.0008, 0.001, 100000),
('vip2', 0.0006, 0.0008, 1000000),
('vip3', 0.0004, 0.0006, 10000000);

COMMIT;