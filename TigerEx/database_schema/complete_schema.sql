// =============================================================================
// TIGEREX v3.0 - COMPLETE DATABASE SCHEMA
// All tables for production exchange
// =============================================================================

-- ============================================================================
// TIGEREX v3.0 - COMPLETE DATABASE SCHEMA
// PostgreSQL Schema for Production Exchange
// ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
// USERS & AUTHENTICATION
-- ============================================================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(255) NOT NULL,
    kyc_level SMALLINT DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 4),
    kyc_status VARCHAR(20) DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'in_review', 'approved', 'rejected', 'expired')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'locked', 'closed')),
    
    -- Verification
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    phone VARCHAR(20),
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    
    -- Referral
    referral_code VARCHAR(50) UNIQUE,
    referred_by UUID REFERENCES users(id),
    
    -- Risk & Compliance
    risk_score SMALLINT DEFAULT 50 CHECK (risk_score BETWEEN 0 AND 100),
    risk_category VARCHAR(20) DEFAULT 'standard' CHECK (risk_category IN ('standard', 'premium', 'institutional', 'vip')),
    jurisdiction VARCHAR(3) DEFAULT 'XXX',
    
    -- Trading Limits
    daily_deposit_limit DECIMAL(20, 8) DEFAULT 10000,
    daily_withdrawal_limit DECIMAL(20, 8) DEFAULT 10000,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_kyc_level ON users(kyc_level);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- User profiles
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    nationality VARCHAR(3),
    country_of_residence VARCHAR(3),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    address TEXT,
    address_verified BOOLEAN DEFAULT FALSE,
    bio TEXT,
    avatar_url TEXT,
    language_preference VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    trading_experience VARCHAR(20) DEFAULT 'intermediate',
    investment_goal TEXT[],
    annual_income VARCHAR(30),
    net_worth VARCHAR(30),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);

-- User sessions
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255),
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_id VARCHAR(255),
    location VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- Login history
CREATE TABLE login_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    location VARCHAR(255),
    success BOOLEAN DEFAULT TRUE,
    failure_reason VARCHAR(255)
);

CREATE INDEX idx_login_history_user_id ON login_history(user_id);
CREATE INDEX idx_login_history_timestamp ON login_history(login_timestamp DESC);

-- API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id VARCHAR(64) UNIQUE NOT NULL,
    secret_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    permissions TEXT[],
    ip_whitelist INET[],
    trading_enabled BOOLEAN DEFAULT TRUE,
    withdrawal_enabled BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_id ON api_keys(key_id);

-- ============================================================================
// KYC & COMPLIANCE
-- ============================================================================

-- KYC Records
CREATE TABLE kyc_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level SMALLINT DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'expired')),
    provider VARCHAR(50),
    provider_ref VARCHAR(255),
    
    -- Personal info
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    nationality VARCHAR(3),
    country_of_residence VARCHAR(3),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(3),
    
    -- Document
    document_type VARCHAR(50),
    document_number VARCHAR(100),
    document_expiry DATE,
    document_front_url TEXT,
    document_back_url TEXT,
    document_verified BOOLEAN DEFAULT FALSE,
    
    -- Selfie
    selfie_url TEXT,
    face_verified BOOLEAN DEFAULT FALSE,
    
    -- Video verification
    video_url TEXT,
    video_verified BOOLEAN DEFAULT FALSE,
    
    -- AML
    aml_status VARCHAR(20),
    aml_score DECIMAL(5, 2),
    pep_status BOOLEAN DEFAULT FALSE,
    sanctions_status BOOLEAN DEFAULT FALSE,
    adverse_media BOOLEAN DEFAULT FALSE,
    
    -- Risk
    risk_score SMALLINT DEFAULT 0,
    risk_category VARCHAR(20),
    risk_factors TEXT[],
    
    -- Review
    reviewer_id UUID REFERENCES users(id),
    review_notes TEXT,
    reject_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_verified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_kyc_user_id ON kyc_records(user_id);
CREATE INDEX idx_kyc_status ON kyc_records(status);

-- AML Checks
CREATE TABLE aml_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    check_type VARCHAR(50),
    status VARCHAR(20),
    match_found BOOLEAN DEFAULT FALSE,
    match_type VARCHAR(50),
    match_details TEXT,
    risk_level VARCHAR(20),
    score DECIMAL(5, 2),
    provider VARCHAR(50),
    provider_ref VARCHAR(255),
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_aml_checks_user_id ON aml_checks(user_id);
CREATE INDEX idx_aml_checks_checked_at ON aml_checks(checked_at DESC);

-- Compliance Alerts
CREATE TABLE compliance_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
    transaction_ids UUID[],
    amount DECIMAL(20, 8),
    currency VARCHAR(20),
    assigned_to UUID REFERENCES users(id),
    resolution TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_compliance_alerts_user_id ON compliance_alerts(user_id);
CREATE INDEX idx_compliance_alerts_status ON compliance_alerts(status);
CREATE INDEX idx_compliance_alerts_created_at ON compliance_alerts(created_at DESC);

-- ============================================================================
// MARKETS & TRADING PAIRS
-- ============================================================================

-- Markets
CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_asset VARCHAR(20) NOT NULL,
    quote_asset VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'trading' CHECK (status IN ('trading', 'halt', 'maintenance', 'suspended')),
    
    -- Trading rules
    min_price DECIMAL(20, 8) DEFAULT 0,
    max_price DECIMAL(20, 8),
    tick_size DECIMAL(20, 8) NOT NULL,
    lot_size DECIMAL(20, 8) NOT NULL,
    min_quantity DECIMAL(20, 8) NOT NULL,
    max_quantity DECIMAL(20, 8),
    price_precision SMALLINT DEFAULT 2,
    quantity_precision SMALLINT DEFAULT 8,
    
    -- Fees
    maker_fee DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee DECIMAL(10, 8) DEFAULT 0.002,
    
    -- Leverage
    leverage_enabled BOOLEAN DEFAULT FALSE,
    max_leverage DECIMAL(5, 2) DEFAULT 1,
    
    -- Filters
    min_notional DECIMAL(20, 8) DEFAULT 10,
    price_filter_enabled BOOLEAN DEFAULT TRUE,
    lot_filter_enabled BOOLEAN DEFAULT TRUE,
    market_filter_enabled BOOLEAN DEFAULT TRUE,
    
    -- UI Display
    display_priority SMALLINT DEFAULT 100,
    price_change_threshold DECIMAL(10, 8),
    create_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_markets_symbol ON markets(symbol);
CREATE INDEX idx_markets_status ON markets(status);

-- Market Ticker (real-time)
CREATE TABLE market_tickers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID NOT NULL REFERENCES markets(id),
    last_price DECIMAL(20, 8) NOT NULL,
    price_change DECIMAL(20, 8) DEFAULT 0,
    price_change_percent DECIMAL(10, 8) DEFAULT 0,
    high_24h DECIMAL(20, 8) DEFAULT 0,
    low_24h DECIMAL(20, 8) DEFAULT 0,
    volume_24h DECIMAL(20, 8) DEFAULT 0,
    quote_volume_24h DECIMAL(20, 8) DEFAULT 0,
    bid_price DECIMAL(20, 8) DEFAULT 0,
    ask_price DECIMAL(20, 8) DEFAULT 0,
    open_price DECIMAL(20, 8) DEFAULT 0,
    close_price DECIMAL(20, 8) DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tickers_market_id ON market_tickers(market_id);
CREATE INDEX idx_tickers_timestamp ON market_tickers(timestamp DESC);

-- ============================================================================
// ORDERS & TRADES
-- ============================================================================

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    
    -- Order details
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('market', 'limit', 'stop_loss', 'stop_limit', 'stop_market', 'take_profit', 'trailing_stop', 'oco')),
    time_in_force VARCHAR(10) DEFAULT 'GTC' CHECK (time_in_force IN ('GTC', 'IOC', 'FOK', 'GTX', 'GTT')),
    
    -- Prices
    price DECIMAL(20, 8),
    stop_price DECIMAL(20, 8),
    trigger_price DECIMAL(20, 8),
    trailing_delta DECIMAL(20, 8),
    
    -- Quantities
    quantity DECIMAL(20, 8) NOT NULL,
    filled_quantity DECIMAL(20, 8) DEFAULT 0,
    remaining_quantity DECIMAL(20, 8),
    
    -- Fees
    maker_fee_rate DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee_rate DECIMAL(10, 8) DEFAULT 0.002,
    fee DECIMAL(20, 8) DEFAULT 0,
    fee_currency VARCHAR(20),
    
    -- Execution
    average_fill_price DECIMAL(20, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('pending', 'new', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired')),
    
    -- Margin/Futures
    leverage DECIMAL(5, 2) DEFAULT 1,
    position_mode VARCHAR(20) DEFAULT 'cross',
    margin_mode VARCHAR(20) DEFAULT 'cross',
    reduce_only BOOLEAN DEFAULT FALSE,
    
    -- Flags
    is_post_only BOOLEAN DEFAULT FALSE,
    is_iceberg BOOLEAN DEFAULT FALSE,
    iceberg_quantity DECIMAL(20, 8),
    
    -- Linked orders (OCO)
    linked_order_id UUID REFERENCES orders(id),
    
    -- Client info
    client_order_id VARCHAR(100),
    source VARCHAR(20) DEFAULT 'api',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP WITH TIME ZONE,
    expired_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_market_id ON orders(market_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_user_market ON orders(user_id, market_id);
CREATE INDEX idx_orders_client_order_id ON orders(client_order_id);

-- Trades
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id VARCHAR(50) UNIQUE NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    
    -- Counterparty
    taker_user_id UUID NOT NULL REFERENCES users(id),
    maker_user_id UUID NOT NULL REFERENCES users(id),
    taker_order_id UUID NOT NULL,
    maker_order_id UUID NOT NULL,
    
    -- Trade details
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    price DECIMAL(20, 8) NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    quote_quantity DECIMAL(20, 8) NOT NULL,
    
    -- Fees
    maker_fee DECIMAL(20, 8) DEFAULT 0,
    taker_fee DECIMAL(20, 8) DEFAULT 0,
    
    -- Role
    role VARCHAR(10) CHECK (role IN ('maker', 'taker')),
    is_self_trade BOOLEAN DEFAULT FALSE,
    
    -- Realized PnL (for futures)
    realized_pnl DECIMAL(20, 8),
    
    -- Timestamp
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_market_id ON trades(market_id);
CREATE INDEX idx_trades_taker_user_id ON trades(taker_user_id);
CREATE INDEX idx_trades_maker_user_id ON trades(maker_user_id);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);

-- ============================================================================
// POSITIONS (Margin/Futures)
// ============================================================================

-- Margin Positions
CREATE TABLE margin_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    
    side VARCHAR(10) CHECK (side IN ('long', 'short')),
    size DECIMAL(20, 8) DEFAULT 0,
    entry_price DECIMAL(20, 8) DEFAULT 0,
    margin DECIMAL(20, 8) DEFAULT 0,
    isolated_margin DECIMAL(20, 8) DEFAULT 0,
    
    leverage DECIMAL(5, 2) DEFAULT 1,
    liquidation_price DECIMAL(20, 8),
    mark_price DECIMAL(20, 8),
    index_price DECIMAL(20, 8),
    
    unrealized_pnl DECIMAL(20, 8) DEFAULT 0,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    
    margin_ratio DECIMAL(10, 8),
    auto_topup_enabled BOOLEAN DEFAULT FALSE,
    
    position_mode VARCHAR(20) DEFAULT 'cross',
    
    -- Timestamps
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_margin_positions_user_id ON margin_positions(user_id);
CREATE INDEX idx_margin_positions_market_id ON margin_positions(market_id);
CREATE INDEX idx_margin_positions_status ON margin_positions(size);

-- Futures Positions
CREATE TABLE futures_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    contract_symbol VARCHAR(20) NOT NULL,
    
    side VARCHAR(10) CHECK (side IN ('long', 'short')),
    size DECIMAL(20, 8) DEFAULT 0,
    entry_price DECIMAL(20, 8) DEFAULT 0,
    margin DECIMAL(20, 8) DEFAULT 0,
    isolated_margin DECIMAL(20, 8) DEFAULT 0,
    
    leverage DECIMAL(5, 2) DEFAULT 1,
    liquidation_price DECIMAL(20, 8),
    mark_price DECIMAL(20, 8),
    index_price DECIMAL(20, 8),
    fair_price DECIMAL(20, 8),
    
    unrealized_pnl DECIMAL(20, 8) DEFAULT 0,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    funding_fee DECIMAL(20, 8) DEFAULT 0,
    
    stop_loss_price DECIMAL(20, 8),
    take_profit_price DECIMAL(20, 8),
    
    position_mode VARCHAR(20) DEFAULT 'cross',
    
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_futures_positions_user_id ON futures_positions(user_id);
CREATE INDEX idx_futures_positions_symbol ON futures_positions(contract_symbol);

-- ============================================================================
// WALLETS & TRANSACTIONS
// ============================================================================

-- Wallets
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    currency VARCHAR(20) NOT NULL,
    chain VARCHAR(50),
    wallet_type VARCHAR(20) DEFAULT 'hot' CHECK (wallet_type IN ('hot', 'cold', 'warm', 'custody', 'multisig')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'locked', 'suspended')),
    
    address TEXT,
    public_key TEXT,
    
    balance DECIMAL(20, 8) DEFAULT 0,
    available_balance DECIMAL(20, 8) DEFAULT 0,
    locked_balance DECIMAL(20, 8) DEFAULT 0,
    pending_deposit DECIMAL(20, 8) DEFAULT 0,
    pending_withdrawal DECIMAL(20, 8) DEFAULT 0,
    
    minimum_balance DECIMAL(20, 8) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_wallets_user_currency ON wallets(user_id, currency, chain);
CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- Deposits
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deposit_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    currency VARCHAR(20) NOT NULL,
    chain VARCHAR(50),
    
    amount DECIMAL(20, 8) NOT NULL,
    fee DECIMAL(20, 8) DEFAULT 0,
    net_amount DECIMAL(20, 8) NOT NULL,
    
    from_address TEXT,
    to_address TEXT,
    tx_hash VARCHAR(255),
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirming', 'completed', 'failed', 'canceled')),
    confirmations INT DEFAULT 0,
    required_confirmations INT DEFAULT 3,
    
    provider VARCHAR(50),
    provider_ref VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_created_at ON deposits(created_at DESC);

-- Withdrawals
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    withdrawal_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    currency VARCHAR(20) NOT NULL,
    chain VARCHAR(50),
    
    amount DECIMAL(20, 8) NOT NULL,
    fee DECIMAL(20, 8) DEFAULT 0,
    network_fee DECIMAL(20, 8) DEFAULT 0,
    net_amount DECIMAL(20, 8) NOT NULL,
    
    to_address TEXT NOT NULL,
    memo TEXT,
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'canceled')),
    
    provider VARCHAR(50),
    provider_ref VARCHAR(255),
    tx_hash VARCHAR(255),
    
    two_factor_verified BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_created_at ON withdrawals(created_at DESC);

-- Internal Transfers
CREATE TABLE internal_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id VARCHAR(50) UNIQUE NOT NULL,
    from_user_id UUID NOT NULL REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    from_wallet_id UUID REFERENCES wallets(id),
    to_wallet_id UUID REFERENCES wallets(id),
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    fee DECIMAL(20, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_internal_transfers_from_user ON internal_transfers(from_user_id);
CREATE INDEX idx_internal_transfers_to_user ON internal_transfers(to_user_id);

-- ============================================================================
// EARN PRODUCTS
-- ============================================================================

-- Earn Products
CREATE TABLE earn_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('staking', 'savings', 'launchpad', 'launchpool', 'defi', 'fdusd')),
    currency VARCHAR(20) NOT NULL,
    chain VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold_out', 'ended')),
    
    min_apy DECIMAL(10, 8),
    max_apy DECIMAL(10, 8),
    current_apy DECIMAL(10, 8),
    distribution_days INT DEFAULT 1,
    
    duration_days INT DEFAULT 0,
    min_duration_days INT DEFAULT 0,
    max_duration_days INT,
    
    min_amount DECIMAL(20, 8),
    max_amount DECIMAL(20, 8),
    total_capacity DECIMAL(20, 8),
    current_subscribed DECIMAL(20, 8) DEFAULT 0,
    
    allow_early_unlock BOOLEAN DEFAULT FALSE,
    early_unlock_fee DECIMAL(10, 8),
    
    project_name VARCHAR(100),
    token_symbol VARCHAR(20),
    hard_cap_per_user DECIMAL(20, 8),
    
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_earn_products_type ON earn_products(type);
CREATE INDEX idx_earn_products_status ON earn_products(status);
CREATE INDEX idx_earn_products_currency ON earn_products(currency);

-- Earn Subscriptions
CREATE TABLE earn_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    product_id UUID NOT NULL REFERENCES earn_products(id),
    
    amount DECIMAL(20, 8) NOT NULL,
    currency VARCHAR(20) NOT NULL,
    
    apy DECIMAL(10, 8),
    duration_days INT,
    
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    unlock_date TIMESTAMP WITH TIME ZONE,
    
    pending_earnings DECIMAL(20, 8) DEFAULT 0,
    claimed_earnings DECIMAL(20, 8) DEFAULT 0,
    last_claimed_at TIMESTAMP WITH TIME ZONE,
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    early_unlocked BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_earn_subscriptions_user_id ON earn_subscriptions(user_id);
CREATE INDEX idx_earn_subscriptions_product_id ON earn_subscriptions(product_id);
CREATE INDEX idx_earn_subscriptions_status ON earn_subscriptions(status);

-- ============================================================================
// P2P TRADING
// ============================================================================

-- P2P Offers
CREATE TABLE p2p_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    currency VARCHAR(20) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    min_amount DECIMAL(20, 8),
    max_amount DECIMAL(20, 8),
    filled_amount DECIMAL(20, 8) DEFAULT 0,
    available_amount DECIMAL(20, 8),
    terms TEXT,
    completion_rate DECIMAL(5, 2) DEFAULT 100,
    payment_window_minutes INT DEFAULT 30,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_p2p_offers_user_id ON p2p_offers(user_id);
CREATE INDEX idx_p2p_offers_status ON p2p_offers(status);
CREATE INDEX idx_p2p_offers_currency ON p2p_offers(currency);

-- P2P Trades
CREATE TABLE p2p_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id VARCHAR(50) UNIQUE NOT NULL,
    offer_id UUID NOT NULL REFERENCES p2p_offers(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    
    currency VARCHAR(20) NOT NULL,
    crypto_currency VARCHAR(20) DEFAULT 'USDT',
    fiat_amount DECIMAL(20, 8) NOT NULL,
    crypto_amount DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'locked', 'released', 'cancelled', 'disputed')),
    
    buyer_confirmed BOOLEAN DEFAULT FALSE,
    seller_confirmed BOOLEAN DEFAULT FALSE,
    
    payment_deadline TIMESTAMP WITH TIME ZONE,
    released_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_p2p_trades_offer_id ON p2p_trades(offer_id);
CREATE INDEX idx_p2p_trades_buyer_id ON p2p_trades(buyer_id);
CREATE INDEX idx_p2p_trades_seller_id ON p2p_trades(seller_id);
CREATE INDEX idx_p2p_trades_status ON p2p_trades(status);

-- ============================================================================
// NOTIFICATIONS
// ============================================================================

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('push', 'email', 'sms', 'telegram', 'in_app')),
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    retry_count INT DEFAULT 0,
    error TEXT
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- Push Tokens
CREATE TABLE push_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_id VARCHAR(255),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_push_tokens_user_id ON push_tokens(user_id);
CREATE UNIQUE INDEX idx_push_tokens_token ON push_tokens(token);

-- ============================================================================
// ADMIN & AUDIT
-- ============================================================================

-- Admin Actions Log
CREATE TABLE admin_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX idx_admin_actions_created_at ON admin_actions(created_at DESC);

-- Audit Log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
// UPDATE TIMESTAMP TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_margin_positions_updated_at BEFORE UPDATE ON margin_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_futures_positions_updated_at BEFORE UPDATE ON futures_positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_earn_subscriptions_updated_at BEFORE UPDATE ON earn_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_p2p_offers_updated_at BEFORE UPDATE ON p2p_offers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_p2p_trades_updated_at BEFORE UPDATE ON p2p_trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
// DEPOSITS & WITHDRAWALS
-- ============================================================================

-- Deposits
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(50),
    amount DECIMAL(20, 8) NOT NULL,
    txid VARCHAR(255) UNIQUE,
    address VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_txid ON deposits(txid);

-- Withdrawals
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(50),
    amount DECIMAL(20, 8) NOT NULL,
    fee DECIMAL(20, 8) DEFAULT 0,
    address VARCHAR(255) NOT NULL,
    txid VARCHAR(255) UNIQUE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_txid ON withdrawals(txid);

-- ============================================================================
// FUTURES & MARGIN TRADING
-- ============================================================================

-- Futures Positions
CREATE TABLE futures_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN (
        'long',
        'short'
    )),
    quantity DECIMAL(20, 8) NOT NULL,
    entry_price DECIMAL(20, 8),
    liquidation_price DECIMAL(20, 8),
    leverage DECIMAL(5, 2) NOT NULL,
    margin_mode VARCHAR(20) NOT NULL CHECK (margin_mode IN (
        'cross',
        'isolated'
    )),
    position_mode VARCHAR(20) NOT NULL CHECK (position_mode IN (
        'one_way',
        'hedge'
    )),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN (
        'open',
        'closed',
        'liquidated'
    )),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_futures_positions_user_id ON futures_positions(user_id);
CREATE INDEX idx_futures_positions_symbol ON futures_positions(symbol);
CREATE INDEX idx_futures_positions_status ON futures_positions(status);

-- Margin Accounts
CREATE TABLE margin_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    balance DECIMAL(20, 8) DEFAULT 0,
    locked_balance DECIMAL(20, 8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, currency)
);

CREATE INDEX idx_margin_accounts_user_id ON margin_accounts(user_id);
CREATE INDEX idx_margin_accounts_currency ON margin_accounts(currency);
