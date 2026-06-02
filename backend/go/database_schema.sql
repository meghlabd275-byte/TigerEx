-- ================================================
-- TigerEx Complete Database Schema
-- Version 2.0.0 - Production Ready
-- ================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ================================================
-- USERS & AUTHENTICATION
-- ================================================

-- Users table
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(255) NOT NULL,
    
    -- Personal Info
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    phone VARCHAR(50),
    country VARCHAR(2) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    
    -- Authentication
   two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    two_factor_backup_codes TEXT[],
    
    -- Security
    login_attempts INTEGER DEFAULT 0,
    lock_until TIMESTAMP,
    last_login TIMESTAMP,
    last_login_ip INET,
    last_password_change TIMESTAMP DEFAULT NOW(),
    password_history JSONB DEFAULT '[]',
    
    -- Status
    status VARCHAR(20) DEFAULT 'active':: VARCHAR(20),
    -- active, suspended, deactivated, pending_verification
    
    -- Tier & Limits
    tier INTEGER DEFAULT 0,
    kyc_tier INTEGER DEFAULT 0,
    trading_enabled BOOLEAN DEFAULT TRUE,
    withdrawal_enabled BOOLEAN DEFAULT TRUE,
    deposit_enabled BOOLEAN DEFAULT TRUE,
    
    -- Referral
    referrer_id UUID,
    referral_code VARCHAR(20) UNIQUE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_referral_code ON users(referral_code);

-- User sessions
CREATE TABLE user_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB,
    
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    last_activity_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- API Keys
CREATE TABLE api_keys (
    key_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(10),
    
    -- Permissions
    permissions TEXT[] DEFAULT '{trade}',
    ip_whitelist INET[],
    
    -- Rate limits
    rate_limit_weight INTEGER DEFAULT 1,
    rate_limit_monthly BIGINT,
    
    -- Usage tracking
    requests_count BIGINT DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- ================================================
-- ACCOUNTS & BALANCES
-- ================================================

-- Wallets/Accounts
CREATE TABLE wallets (
    wallet_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    -- spot, funding, trading, margin, futures, options, institutional
    
    name VARCHAR(100),
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(20),
    is_default BOOLEAN DEFAULT FALSE,
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_type ON wallets(type);
CREATE INDEX idx_wallets_currency ON wallets(currency);

-- Balances
CREATE TABLE balances (
    balance_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(wallet_id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    
    available DECIMAL(32, 16) DEFAULT 0,
    locked DECIMAL(32, 16) DEFAULT 0,
    
    -- Interest earned (for savings/earn products)
    interest_earned DECIMAL(32, 16) DEFAULT 0,
    last_interest_calculated_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, wallet_id, currency)
);

CREATE INDEX idx_balances_user_id ON balances(user_id);
CREATE INDEX idx_balances_wallet_id ON balances(wallet_id);
CREATE INDEX idx_balances_currency ON balances(currency);

-- Balance history
CREATE TABLE balance_history (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(wallet_id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    
    balance_before DECIMAL(32, 16) NOT NULL,
    balance_after DECIMAL(32, 16) NOT NULL,
    change_amount DECIMAL(32, 16) NOT NULL,
    
    -- Transaction reference
    transaction_id UUID,
    transaction_type VARCHAR(50),
    -- deposit, withdrawal, trade, fee, transfer, interest, rebate, adjustment
    
    reference_id VARCHAR(255),
    reference_type VARCHAR(50),
    
    note TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_balance_history_user_id ON balance_history(user_id);
CREATE INDEX idx_balance_history_wallet_id ON balance_history(wallet_id);
CREATE INDEX idx_balance_history_created_at ON balance_history(created_at DESC);
CREATE INDEX idx_balance_history_transaction_id ON balance_history(transaction_id);

-- Convert balance_history to hypertable
SELECT create_hypertable('balance_history', 'created_at', chunk_time_interval => INTERVAL '1 day');

-- ================================================
-- MARKETS & TRADING PAIRS
-- ================================================

-- Markets
CREATE TABLE markets (
    market_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(20) NOT NULL,
    quote_currency VARCHAR(20) NOT NULL,
    
    -- Market type
    type VARCHAR(20) DEFAULT 'spot',
    -- spot, margin, futures, perpetual, options
    
    -- Price specification
    price_precision INTEGER DEFAULT 8,
    quantity_precision INTEGER DEFAULT 8,
    min_price DECIMAL(32, 16),
    max_price DECIMAL(32, 16),
    tick_size DECIMAL(32, 16) DEFAULT 0.01,
    min_quantity DECIMAL(32, 16),
    max_quantity DECIMAL(32, 16),
    min_notional DECIMAL(32, 16),
    
    -- Trading rules
    trading_enabled BOOLEAN DEFAULT TRUE,
    cancel_only BOOLEAN DEFAULT FALSE,
    order_types TEXT[],
    
    -- Trading fees
    maker_fee DECIMAL(10, 6) DEFAULT 0.001,
    taker_fee DECIMAL(10, 6) DEFAULT 0.001,
    
    -- Market status
    status VARCHAR(20) DEFAULT 'active',
    -- active, suspended, post_only
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_markets_symbol ON markets(symbol);
CREATE INDEX idx_markets_base_currency ON markets(base_currency);
CREATE INDEX idx_markets_quote_currency ON markets(quote_currency);
CREATE INDEX idx_markets_status ON markets(status);

-- Market tickers (24h stats)
CREATE TABLE market_tickers (
    market_id UUID REFERENCES markets(market_id),
    period_start TIMESTAMP NOT NULL,
    
    last_price DECIMAL(32, 16),
    price_change DECIMAL(32, 16),
    price_change_percent DECIMAL(10, 6),
    high_price DECIMAL(32, 16),
    low_price DECIMAL(32, 16),
    volume_base DECIMAL(32, 16),
    volume_quote DECIMAL(32, 16),
    trades_count BIGINT,
    
    PRIMARY KEY (market_id, period_start)
);

SELECT create_hypertable('market_tickers', 'period_start', chunk_time_interval => INTERVAL '1 minute');

-- ================================================
-- ORDERS
-- ================================================

-- Orders
CREATE TABLE orders (
    order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- Order identification
    client_order_id VARCHAR(100),
    side VARCHAR(10) NOT NULL,
    -- buy, sell
    
    market_symbol VARCHAR(20) NOT NULL,
    
    -- Order type
    order_type VARCHAR(20) NOT NULL DEFAULT 'limit',
    -- limit, market, stop_loss, stop_limit, take_profit, trailing_stop, iceberg
    
    time_in_force VARCHAR(10) DEFAULT 'GTC',
    -- GTC, IOC, FOK, GTX, GTT
    
    price DECIMAL(32, 16),
    stop_price DECIMAL(32, 16),
    
    quantity DECIMAL(32, 16) NOT NULL,
    filled_quantity DECIMAL(32, 16) DEFAULT 0,
    remaining_quantity DECIMAL(32, 16) GENERATED ALWAYS AS (quantity - filled_quantity) STORED,
    
    avg_fill_price DECIMAL(32, 16),
    
    -- Order value
    order_value DECIMAL(32, 16),
    filled_value DECIMAL(32, 16),
    
    -- Fees
    fees DECIMAL(32, 16) DEFAULT 0,
    commission DECIMAL(32, 16) DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'new',
    -- pending_new, new, partially_filled, filled, canceled, rejected, expired
    
    reject_reason TEXT,
    
    -- Leverage (for margin/futures)
    leverage DECIMAL(10, 4),
    
    -- Execution info
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    expired_at TIMESTAMP,
    traded_at TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_market_symbol ON orders(market_symbol);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_side ON orders(side);
CREATE INDEX idx_orders_client_order_id ON orders(client_order_id);

-- Convert orders to hypertable
SELECT create_hypertable('orders', 'created_at', chunk_time_interval => INTERVAL '1 day');

-- Order history (for all order state changes)
CREATE TABLE order_history (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(order_id) ON DELETE CASCADE,
    
    previous_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    
    filled_quantity_change DECIMAL(32, 16),
    price_change DECIMAL(32, 16),
    
    message TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_order_history_order_id ON order_history(order_id);
CREATE INDEX idx_order_history_created_at ON order_history(created_at DESC);

-- ================================================
-- TRADES
-- ================================================

-- Trades
CREATE TABLE trades (
    trade_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(order_id),
    counter_order_id UUID REFERENCES orders(order_id),
    
    market_symbol VARCHAR(20) NOT NULL,
    
    -- Trade parties
    maker_user_id UUID REFERENCES users(user_id),
    taker_user_id UUID REFERENCES users(user_id),
    
    -- Execution
    side VARCHAR(10) NOT NULL,
    price DECIMAL(32, 16) NOT NULL,
    quantity DECIMAL(32, 16) NOT NULL,
    quote_quantity DECIMAL(32, 16) NOT NULL,
    
    -- Fees
    maker_fee DECIMAL(32, 16),
    taker_fee DECIMAL(32, 16),
    maker_fee_rate DECIMAL(10, 6),
    taker_fee_rate DECIMAL(10, 6),
    
    -- Party fees (who paid)
    maker_commission DECIMAL(32, 16),
    taker_commission DECIMAL(32, 16),
    
    -- Is maker/taker
    is_maker BOOLEAN,
    is_self_trade BOOLEAN DEFAULT FALSE,
    
    -- P&L (for positions)
    realized_pnl DECIMAL(32, 16),
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_maker_user_id ON trades(maker_user_id);
CREATE INDEX idx_trades_taker_user_id ON trades(taker_user_id);
CREATE INDEX idx_trades_market_symbol ON trades(market_symbol);
CREATE INDEX idx_trades_created_at ON trades(created_at DESC);

SELECT create_hypertable('trades', 'created_at', chunk_time_interval => INTERVAL '1 day');

-- ================================================
-- POSITIONS (Margin/Futures)
-- ================================================

-- Positions
CREATE TABLE positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    market_symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    -- long, short
    
    size DECIMAL(32, 16) NOT NULL,
    entry_price DECIMAL(32, 16) NOT NULL,
    
    -- Margins
    margin DECIMAL(32, 16) NOT NULL,
    isolated_margin DECIMAL(32, 16),
    
    -- Liquidation
    liquidation_price DECIMAL(32, 16),
    stop_loss_price DECIMAL(32, 16),
    take_profit_price DECIMAL(32, 16),
    
    -- Leverage
    leverage DECIMAL(10, 4) DEFAULT 1,
    position_mode VARCHAR(20) DEFAULT 'cross',
    -- cross, isolated
    
    -- P&L
    unrealized_pnl DECIMAL(32, 16) DEFAULT 0,
    realized_pnl DECIMAL(32, 16) DEFAULT 0,
    
    -- Mark price (for P&L calculation)
    mark_price DECIMAL(32, 16),
    
    status VARCHAR(20) DEFAULT 'open',
    -- open, closed, liquidating, liquidated
    
    opened_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_market_symbol ON positions(market_symbol);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_opened_at ON positions(opened_at DESC);

-- ================================================
-- DEPOSITS & WITHDRAWALS
-- ================================================

-- Deposits
CREATE TABLE deposits (
    deposit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(20),
    
    amount DECIMAL(32, 16) NOT NULL,
    fee DECIMAL(32, 16) DEFAULT 0,
    net_amount DECIMAL(32, 16) GENERATED ALWAYS AS (amount - fee) STORED,
    
    -- Source
    tx_hash VARCHAR(255),
    from_address VARCHAR(255),
    deposit_address VARCHAR(255) REFERENCES wallet_addresses(address),
    
    -- Confirmations
    confirmations_required INTEGER,
    confirmations_received INTEGER DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending',
    -- pending, processing, completed, failed, flagged
    
    processed_at TIMESTAMP,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_currency ON deposits(currency);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX idx_deposits_created_at ON deposits(created_at DESC);

-- Withdrawals
CREATE TABLE withdrawals (
    withdrawal_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(20),
    
    amount DECIMAL(32, 16) NOT NULL,
    fee DECIMAL(32, 16) DEFAULT 0,
    net_amount DECIMAL(32, 16) GENERATED ALWAYS AS (amount - fee) STORED,
    
    -- Destination
    to_address VARCHAR(255) NOT NULL,
    to_address_tag VARCHAR(255),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending',
    -- pending, processing, pending_approval, completed, failed, canceled, flagged
    
    approved_by UUID,
    approved_at TIMESTAMP,
    
    -- Blockchain
    tx_hash VARCHAR(255),
    
    note TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_currency ON withdrawals(currency);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_to_address ON withdrawals(to_address);
CREATE INDEX idx_withdrawals_created_at ON withdrawals(created_at DESC);

-- Wallet addresses
CREATE TABLE wallet_addresses (
    address_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(20) NOT NULL,
    address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(255),
    
    type VARCHAR(20) DEFAULT 'deposit',
    -- deposit, trading, hot, cold
    
    label VARCHAR(100),
    is_default BOOLEAN DEFAULT FALSE,
    
   created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallet_addresses_user_id ON wallet_addresses(user_id);
CREATE INDEX idx_wallet_addresses_address ON wallet_addresses(address);
CREATE INDEX idx_wallet_addresses_currency ON wallet_addresses(currency);

-- ================================================
-- KYC & COMPLIANCE
-- ================================================

-- KYC Applications
CREATE TABLE kyc_applications (
    application_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    tier INTEGER NOT NULL,
    
    status VARCHAR(20) DEFAULT 'pending',
    -- pending, submitted, under_review, approved, rejected, suspended
    
    rejection_reason TEXT,
    
    -- Documents
    documents JSONB DEFAULT '[]',
    -- [{type: 'id_front', type: 'id_back', type: 'selfie', ...}]
    
    -- Verification results
    verification_score INTEGER,
    verification_notes TEXT,
    
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    
    expires_at TIMESTAMP,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_kyc_applications_user_id ON kyc_applications(user_id);
CREATE INDEX idx_kyc_applications_status ON kyc_applications(status);

-- Suspicious activity
CREATE TABLE suspicious_activity (
    activity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID REFERENCES users(user_id),
    
    type VARCHAR(50) NOT NULL,
    -- unusual_login, large_withdrawal, rapid_trading, self_trade, ...
    
    severity VARCHAR(20) DEFAULT 'low',
    -- low, medium, high, critical
    
    description TEXT,
    details JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'open',
    -- open, investigated, resolved, escalated
    
    resolved_by UUID,
    resolution_note TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

CREATE INDEX idx_suspicious_activity_user_id ON suspicious_activity(user_id);
CREATE INDEX idx_suspicious_activity_status ON suspicious_activity(status);
CREATE INDEX idx_suspicious_activity_created_at ON suspicious_activity(created_at DESC);

-- ================================================
-- TRANSACTIONS & PAYMENTS
// ================================================

-- Internal transfers
CREATE TABLE internal_transfers (
    transfer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID REFERENCES users(user_id),
    to_user_id UUID REFERENCES users(user_id),
    
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(32, 16) NOT NULL,
    
    status VARCHAR(20) DEFAULT 'completed',
    -- pending, completed, failed, canceled
    
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_internal_transfers_from_user_id ON internal_transfers(from_user_id);
CREATE INDEX idx_internal_transfers_to_user_id ON internal_transfers(to_user_id);

-- ================================================
-- EARN PRODUCTS (Staking, Savings, etc.)
// ================================================

-- Staking positions
CREATE TABLE staking_positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    asset VARCHAR(20) NOT NULL,
    amount DECIMAL(32, 16) NOT NULL,
    
    reward DECIMAL(32, 16) DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'active',
    -- active, unstaking, withdrawn
    
    started_at TIMESTAMP DEFAULT NOW(),
    unstaked_at TIMESTAMP,
    withdrawn_at TIMESTAMP
);

CREATE INDEX idx_staking_positions_user_id ON staking_positions(user_id);
CREATE INDEX idx_staking_positions_asset ON staking_positions(asset);

-- Savings accounts
CREATE TABLE savings_accounts (
    account_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    balance DECIMAL(32, 16) DEFAULT 0,
    
    accrued_interest DECIMAL(32, 16) DEFAULT 0,
    last_accrued_at TIMESTAMP,
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_savings_accounts_user_id ON savings_accounts(user_id);

-- ================================================
-- P2P TRADING
// ================================================

-- P2P Orders
CREATE TABLE p2p_orders (
    p2p_order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    side VARCHAR(10) NOT NULL,
    -- buy, sell
    
    fiat_currency VARCHAR(3) NOT NULL,
    
   -- Price
    price_type VARCHAR(20) NOT NULL,
    -- fixed, floating
    
    price DECIMAL(32, 16),
    price_percentage DECIMAL(10, 4),
    market_index INTEGER,
    
    amount DECIMAL(32, 16) NOT NULL,
    available_amount DECIMAL(32, 16) GENERATED ALWAYS AS (amount) STORED,
    
    limit_amount_min DECIMAL(32, 16),
    limit_amount_max DECIMAL(32, 16),
    
    payment_methods TEXT[],
    
    status VARCHAR(20) DEFAULT 'active',
    -- active, paused, completed, canceled, dispute, resolved
    
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_p2p_orders_user_id ON p2p_orders(user_id);
CREATE INDEX idx_p2p_orders_fiat_currency ON p2p_orders(fiat_currency);
CREATE INDEX idx_p2p_orders_status ON p2p_orders(status);

-- P2P Trades
CREATE TABLE p2p_trades (
    trade_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES p2p_orders(p2p_order_id),
    buyer_id UUID REFERENCES users(user_id),
    seller_id UUID REFERENCES users(user_id),
    
    amount DECIMAL(32, 16) NOT NULL,
    price DECIMAL(32, 16) NOT NULL,
    total DECIMAL(32, 16) GENERATED ALWAYS AS (amount * price) STORED,
    
    payment_method VARCHAR(50),
    
    status VARCHAR(20) DEFAULT 'pending',
    -- pending, paid, completed, disputed, canceled, refunded
    
    buyer_confirmed_at TIMESTAMP,
    seller_confirmed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_p2p_trades_order_id ON p2p_trades(order_id);
CREATE INDEX idx_p2p_trades_buyer_id ON p2p_trades(buyer_id);
CREATE INDEX idx_p2p_trades_seller_id ON p2p_trades(seller_id);

-- ================================================
-- NFTS
// ================================================

-- NFT Collections
CREATE TABLE nft_collections (
    collection_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES users(user_id),
    
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20),
    description TEXT,
    
    contract_address VARCHAR(100),
    standard VARCHAR(20) DEFAULT 'ERC-721',
    -- ERC-721, ERC-1155
    
    royalty_percentage DECIMAL(10, 4) DEFAULT 0,
    
    metadata JSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_nft_collections_creator_id ON nft_collections(creator_id);

-- NFTs
CREATE TABLE nfts (
    nft_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID REFERENCES nft_collections(collection_id),
    token_id VARCHAR(100) NOT NULL,
    
    owner_id UUID REFERENCES users(user_id),
    
    metadata JSONB,
    token_uri TEXT,
    
    status VARCHAR(20) DEFAULT 'active',
    -- active, burned, marketplace
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_nfts_collection_id ON nfts(collection_id);
CREATE INDEX idx_nfts_token_id ON nfts(collection_id, token_id);
CREATE INDEX idx_nfts_owner_id ON nfts(owner_id);

-- NFT Transfers
CREATE TABLE nft_transfers (
    transfer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nft_id UUID REFERENCES nft(nft_id),
    
    from_user_id UUID REFERENCES users(user_id),
    to_user_id UUID REFERENCES users(user_id),
    
    price DECIMAL(32, 16),
    transaction_hash VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- ================================================
-- FEE & REBATE STRUCTURES
// ================================================

-- Fee schedules
CREATE TABLE fee_schedules (
    schedule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    -- maker, taker, withdrawal, deposit
    
    tier INTEGER NOT NULL,
    volume_threshold DECIMAL(32, 16),
    holdings_threshold DECIMAL(32, 16),
    
    fee_rate DECIMAL(10, 6) NOT NULL,
    
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fee_schedules_type ON fee_schedules(type);
CREATE INDEX idx_fee_schedules_tier ON fee_schedules(tier);

-- ================================================
-- ADMIN & OPERATIONS
// ================================================

-- Admin users
CREATE TABLE admins (
    admin_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id),
    
    role VARCHAR(50) NOT NULL,
    -- super_admin, compliance, operations, finance, support
    
    permissions TEXT[] DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Audit logs
CREATE TABLE audit_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    actor_id UUID REFERENCES users(user_id),
    -- can be user_id or admin_id
    
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    
    changes JSONB,
    ip_address INET,
    user_agent TEXT,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

SELECT create_hypertable('audit_logs', 'created_at', chunk_time_interval => INTERVAL '1 day');

-- ================================================
-- ANALYTICS
// ================================================

-- API Usage logs
CREATE TABLE api_usage (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID,
    api_key_id UUID,
    
    endpoint VARCHAR(255),
    method VARCHAR(10),
    ip_address INET,
    
    response_code INTEGER,
    response_time_ms INTEGER,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX idx_api_usage_endpoint ON api_usage(endpoint);
CREATE INDEX idx_api_usage_created_at ON api_usage(created_at DESC);

SELECT create_hypertable('api_usage', 'created_at', chunk_time_interval => INTERVAL '1 hour');

-- ================================================
-- FUNCTIONS & TRIGGERS
-- ================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_balances_updated_at BEFORE UPDATE ON balances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_markets_updated_at BEFORE UPDATE ON markets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================
-- SEEDS
-- ================================================

-- Insert default markets
INSERT INTO markets (symbol, base_currency, quote_currency, price_precision, quantity_precision, min_price, max_price, tick_size, min_quantity, status) VALUES
('BTC/USDT', 'BTC', 'USDT', 8, 8, 0.01, 1000000, 0.01, 0.00001, 'active'),
('ETH/USDT', 'ETH', 'USDT', 8, 8, 0.01, 50000, 0.01, 0.0001, 'active'),
('BNB/USDT', 'BNB', 'USDT', 8, 8, 0.01, 10000, 0.01, 0.001, 'active'),
('SOL/USDT', 'SOL', 'USDT', 8, 8, 0.001, 5000, 0.001, 0.01, 'active'),
('XRP/USDT', 'XRP', 'USDT', 8, 8, 0.0001, 100, 0.0001, 1, 'active'),
('ADA/USDT', 'ADA', 'USDT', 8, 8, 0.001, 10, 0.001, 1, 'active'),
('DOGE/USDT', 'DOGE', 'USDT', 8, 8, 0.0001, 10, 0.0001, 10, 'active'),
('AVAX/USDT', 'AVAX', 'USDT', 8, 8, 0.01, 1000, 0.01, 0.01, 'active'),
('DOT/USDT', 'DOT', 'USDT', 8, 8, 0.001, 500, 0.001, 0.1, 'active'),
('MATIC/USDT', 'MATIC', 'USDT', 8, 8, 0.0001, 50, 0.0001, 1, 'active'),
('LINK/USDT', 'LINK', 'USDT', 8, 8, 0.01, 500, 0.01, 0.01, 'active'),
('UNI/USDT', 'UNI', 'USDT', 8, 8, 0.01, 200, 0.01, 0.1, 'active'),
('ATOM/USDT', 'ATOM', 'USDT', 8, 8, 0.01, 500, 0.01, 0.01, 'active'),
('LTC/USDT', 'LTC', 'USDT', 8, 8, 0.01, 5000, 0.01, 0.001, 'active'),
('BCH/USDT', 'BCH', 'USDT', 8, 8, 0.01, 5000, 0.01, 0.001, 'active'),
-- ETF pairs
('BTC/ETH', 'BTC', 'ETH', 8, 8, 0.0001, 100, 0.0001, 0.001, 'active'),
('ETH/BNB', 'ETH', 'BNB', 8, 8, 0.001, 1000, 0.001, 0.01, 'active');

-- Insert default fee schedules
INSERT INTO fee_schedules (name, type, tier, volume_threshold, fee_rate) VALUES
('Standard Maker', 'maker', 0, 0, 0.001),
('Standard Taker', 'taker', 0, 0, 0.001),
('VIP 1 Maker', 'maker', 1, 100000, 0.0008),
('VIP 1 Taker', 'taker', 1, 100000, 0.0008),
('VIP 2 Maker', 'maker', 2, 1000000, 0.0006),
('VIP 2 Taker', 'taker', 2, 1000000, 0.0006),
('VIP 3 Maker', 'maker', 3, 10000000, 0.0004),
('VIP 3 Taker', 'taker', 3, 10000000, 0.0004),
('VIP 4 Maker', 'maker', 4, 100000000, 0.0002),
('VIP 4 Taker', 'taker', 4, 100000000, 0.0001);

-- Admin role
INSERT INTO admins (role, permissions) VALUES
('super_admin', ARRAY['*']),
('compliance', ARRAY['view_users', 'view_kyc', 'approve_kyc', 'reject_kyc', 'freeze_account']),
('operations', ARRAY['view_orders', 'view_trades', 'view_balances', 'force_cancel_order']),
('finance', ARRAY['view_withdrawals', 'approve_withdrawal', 'reject_withdrawal']),
('support', ARRAY['view_users', 'view_orders']);