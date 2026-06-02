-- =============================================================================
-- TIGGEREX v3.0 - COMPLETE PRODUCTION DATABASE SCHEMA
-- PostgreSQL Database for Cryptocurrency Exchange Platform
-- =============================================================================

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE order_type AS ENUM (
    'market', 'limit', 'stop_loss', 'stop_limit', 'stop_market',
    'take_profit', 'trailing_stop', 'oco', 'oto', 'iceberg', 
    'twap', 'post_only', 'fok', 'ioc'
);

CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM (
    'pending_new', 'new', 'partially_filled', 'filled', 
    'canceled', 'rejected', 'expired', 'pending_cancel', 'pending_modify'
);

CREATE TYPE time_in_force AS ENUM ('GTC', 'IOC', 'FOK', 'GTX', 'GTT');

CREATE TYPE wallet_type AS ENUM (
    'spot', 'funding', 'trading', 'margin', 'futures', 
    'savings', 'staking', 'vault'
);

CREATE TYPE wallet_status AS ENUM ('active', 'suspended', 'closed', 'locked');

CREATE TYPE deposit_status AS ENUM (
    'pending', 'processing', 'crediting', 'completed', 
    'failed', 'flagged', 'blocked', 'cancelled', 'returned'
);

CREATE TYPE deposit_type AS ENUM (
    'external', 'internal', 'sub_account', 'staking', 
    'reward', 'airdrop', 'refund', 'cashback', 'referral'
);

CREATE TYPE withdrawal_status AS ENUM (
    'pending', 'pending_otp', 'pending_email', 'pending_approval',
    'processing', 'pending_tx', 'broadcast', 'completed',
    'failed', 'rejected', 'cancelled', 'flagged', 'blocked'
);

CREATE TYPE withdrawal_priority AS ENUM ('low', 'normal', 'high', 'critical');

CREATE TYPE kyc_level AS ENUM ('none', 'basic', 'intermediate', 'advanced', 'institutional');

CREATE TYPE transaction_type AS ENUM (
    'deposit', 'withdrawal', 'transfer', 'trade', 
    'fee', 'rebate', 'interest', 'bonus', 'adjustment'
);

CREATE TYPE position_mode AS ENUM ('isolated', 'cross', 'leverage');

-- =============================================================================
-- USERS & AUTHENTICATION
-- =============================================================================

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    password_hash VARCHAR(255) NOT NULL,
    password_changed_at TIMESTAMP WITH TIME ZONE,
    salt VARCHAR(64),
    
    -- Profile
    username VARCHAR(50) UNIQUE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    date_of_birth DATE,
    country_code VARCHAR(3),
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    
    -- KYC
    kyc_level kyc_level DEFAULT 'none',
    kyc_status VARCHAR(50) DEFAULT 'pending',
    kyc_submitted_at TIMESTAMP WITH TIME ZONE,
    kyc_verified_at TIMESTAMP WITH TIME ZONE,
    kyc_rejected_at TIMESTAMP WITH TIME ZONE,
    kyc_rejection_reason TEXT,
    
    -- Security
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    two_factor_type VARCHAR(20) DEFAULT 'totp',
    anti_phishing_code VARCHAR(20),
    login_otp_enabled BOOLEAN DEFAULT FALSE,
    withdrawal_otp_enabled BOOLEAN DEFAULT TRUE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    is_staff BOOLEAN DEFAULT FALSE,
    is_superuser BOOLEAN DEFAULT FALSE,
    is_beta_tester BOOLEAN DEFAULT FALSE,
    
    -- Limits (based on KYC)
    daily_withdrawal_limit DECIMAL(20, 8) DEFAULT 0,
    monthly_withdrawal_limit DECIMAL(20, 8) DEFAULT 0,
    max_position_size DECIMAL(20, 8) DEFAULT 0,
    
    -- Referral
    referred_by UUID REFERENCES users(user_id),
    referral_code VARCHAR(20) UNIQUE,
    referral_count INTEGER DEFAULT 0,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);

-- User Sessions
CREATE TABLE user_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255),
    
    ip_address INET,
    user_agent TEXT,
    device_id VARCHAR(255),
    device_type VARCHAR(50),
    browser VARCHAR(100),
    os VARCHAR(100),
    location_country VARCHAR(3),
    location_city VARCHAR(100),
    
    is_active BOOLEAN DEFAULT TRUE,
    is_current BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    terminated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- Login History
CREATE TABLE login_history (
    login_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    login_type VARCHAR(50) NOT NULL, -- 'email', 'google', 'apple', 'api_key', '2fa'
    
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_type VARCHAR(50),
    browser VARCHAR(100),
    os VARCHAR(100),
    
    location_country VARCHAR(3),
    location_city VARCHAR(100),
    location_coords POINT,
    
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_login_history_user_id ON login_history(user_id);
CREATE INDEX idx_login_history_created_at ON login_history(created_at);
CREATE INDEX idx_login_history_ip ON login_history(ip_address);

-- API Keys
CREATE TABLE api_keys (
    api_key_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    key_id VARCHAR(64) UNIQUE NOT NULL,
    key_secret_hash VARCHAR(255) NOT NULL,
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- Permissions
    can_read BOOLEAN DEFAULT TRUE,
    can_trade BOOLEAN DEFAULT FALSE,
    can_withdraw BOOLEAN DEFAULT FALSE,
    allowed_ips INET[],
    allowed_apis TEXT[],
    
    -- Rate limits
    rate_limit_per_minute INTEGER DEFAULT 60,
    rate_limit_per_hour INTEGER DEFAULT 1000,
    
    is_active BOOLEAN DEFAULT TRUE,
    is_expired BOOLEAN DEFAULT FALSE,
    
    last_used_at TIMESTAMP WITH TIME ZONE,
    last_ip INET,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_id ON api_keys(key_id);

-- =============================================================================
-- KYC & COMPLIANCE
-- =============================================================================

CREATE TABLE kyc_documents (
    document_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    document_type VARCHAR(50) NOT NULL, -- 'passport', 'id_card', 'driver_license', 'utility_bill', 'bank_statement'
    document_number VARCHAR(100),
    document_front_url TEXT,
    document_back_url TEXT,
    document_verification_url TEXT,
    
    issuing_country VARCHAR(3),
    expiry_date DATE,
    
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'verified', 'rejected', 'expired'
    rejection_reason TEXT,
    verified_by UUID REFERENCES users(user_id),
    verified_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_kyc_documents_user_id ON kyc_documents(user_id);

CREATE TABLE kyc_verifications (
    verification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    verification_type VARCHAR(50) NOT NULL, -- 'email', 'phone', 'identity', 'address', 'liveness'
    
    status VARCHAR(50) DEFAULT 'pending',
    verification_data JSONB,
    verification_result JSONB,
    verification_score DECIMAL(5, 2),
    
    provider VARCHAR(50), -- ' Jumio', 'Onfido', 'Sumsub'
    provider_reference VARCHAR(255),
    
    rejection_reasons TEXT[],
    verified_by UUID REFERENCES users(user_id),
    verified_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_kyc_verifications_user_id ON kyc_verifications(user_id);

-- AML Screening
CREATE TABLE aml_screening (
    screening_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id),
    transaction_id UUID,
    
    screening_type VARCHAR(50) NOT NULL, -- 'user_kyc', 'deposit', 'withdrawal', 'transfer', 'transaction'
    
    subject_type VARCHAR(50), -- 'user', 'address', 'transaction'
    subject_identifier VARCHAR(500),
    
    risk_score DECIMAL(5, 2),
    risk_level VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
    risk_factors JSONB,
    
    sanctions_screened BOOLEAN DEFAULT FALSE,
    pep_screened BOOLEAN DEFAULT FALSE,
    adverse_media_screened BOOLEAN DEFAULT FALSE,
    
    is_blacklisted BOOLEAN DEFAULT FALSE,
    blacklist_reason TEXT,
    
    provider VARCHAR(50),
    provider_reference VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_aml_screening_user_id ON aml_screening(user_id);
CREATE INDEX idx_aml_screening_address ON aml_screening(subject_identifier);

-- =============================================================================
-- CURRENCIES & MARKETS
-- =============================================================================

CREATE TABLE currencies (
    currency_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'crypto', 'fiat', 'stablecoin', 'token'
    
    blockchain VARCHAR(50),
    contract_address VARCHAR(255),
    decimals INTEGER DEFAULT 18,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_deposit_enabled BOOLEAN DEFAULT TRUE,
    is_withdrawal_enabled BOOLEAN DEFAULT TRUE,
    is_trading_enabled BOOLEAN DEFAULT TRUE,
    
    -- Fees
    deposit_fee DECIMAL(20, 10) DEFAULT 0,
    withdrawal_fee DECIMAL(20, 10) DEFAULT 0,
    maker_fee DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee DECIMAL(10, 8) DEFAULT 0.002,
    
    -- Limits
    min_deposit DECIMAL(20, 8) DEFAULT 0,
    max_deposit DECIMAL(20, 8),
    min_withdrawal DECIMAL(20, 8) DEFAULT 0,
    max_withdrawal DECIMAL(20, 8),
    
    -- Confirmations
    min_confirmations INTEGER DEFAULT 3,
    
    -- Metadata
    icon_url TEXT,
    website_url TEXT,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_currencies_symbol ON currencies(symbol);
CREATE INDEX idx_currencies_type ON currencies(type);

CREATE TABLE currency_networks (
    network_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency_id UUID NOT NULL REFERENCES currencies(currency_id) ON DELETE CASCADE,
    
    network VARCHAR(50) NOT NULL,
    name VARCHAR(100),
    
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Address format
    address_regex VARCHAR(255),
    memo_regex VARCHAR(255),
    address_is_case_sensitive BOOLEAN DEFAULT TRUE,
    
    -- Fees
    deposit_fee DECIMAL(20, 10) DEFAULT 0,
    withdrawal_fee DECIMAL(20, 10) DEFAULT 0,
    
    -- Limits
    min_deposit DECIMAL(20, 8) DEFAULT 0,
    max_deposit DECIMAL(20, 8),
    min_withdrawal DECIMAL(20, 8) DEFAULT 0,
    max_withdrawal DECIMAL(20, 8),
    
    -- Confirmations
    min_confirmations INTEGER DEFAULT 3,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_currency_networks_currency ON currency_networks(currency_id);

CREATE TABLE markets (
    market_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE NOT NULL, -- 'BTC/USDT'
    base_currency VARCHAR(20) NOT NULL,
    quote_currency VARCHAR(20) NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_trading_enabled BOOLEAN DEFAULT TRUE,
    is_margin_enabled BOOLEAN DEFAULT FALSE,
    is_futures_enabled BOOLEAN DEFAULT FALSE,
    
    -- Price filters
    min_price DECIMAL(20, 8) DEFAULT 0,
    max_price DECIMAL(20, 8),
    tick_size DECIMAL(20, 8) DEFAULT 0.01,
    price_precision INTEGER DEFAULT 8,
    
    -- Quantity filters
    min_quantity DECIMAL(20, 8) DEFAULT 0,
    max_quantity DECIMAL(20, 8),
    step_size DECIMAL(20, 8) DEFAULT 0.001,
    quantity_precision INTEGER DEFAULT 8,
    
    -- Order value filters
    min_order_value DECIMAL(20, 8) DEFAULT 0,
    max_order_value DECIMAL(20, 8),
    
    -- Fees
    maker_fee DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee DECIMAL(10, 8) DEFAULT 0.002,
    
    -- Market maker
    is_market_maker_enabled BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_markets_symbol ON markets(symbol);
CREATE INDEX idx_markets_base ON markets(base_currency);
CREATE INDEX idx_markets_quote ON markets(quote_currency);

CREATE TABLE market_24h_stats (
    market_id UUID PRIMARY KEY REFERENCES markets(market_id),
    
    open_price DECIMAL(20, 8) DEFAULT 0,
    high_price DECIMAL(20, 8) DEFAULT 0,
    low_price DECIMAL(20, 8) DEFAULT 0,
    close_price DECIMAL(20, 8) DEFAULT 0,
    
    volume_base DECIMAL(20, 18) DEFAULT 0,
    volume_quote DECIMAL(20, 18) DEFAULT 0,
    volume_trades INTEGER DEFAULT 0,
    
    price_change DECIMAL(20, 8) DEFAULT 0,
    price_change_percent DECIMAL(10, 4) DEFAULT 0,
    
    bid_price DECIMAL(20, 8) DEFAULT 0,
    bid_quantity DECIMAL(20, 18) DEFAULT 0,
    ask_price DECIMAL(20, 8) DEFAULT 0,
    ask_quantity DECIMAL(20, 18) DEFAULT 0,
    
    last_trade_id UUID,
    last_trade_time TIMESTAMP WITH TIME ZONE,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- BALANCES & WALLETS
-- =============================================================================

CREATE TABLE wallets (
    wallet_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    wallet_type wallet_type NOT NULL,
    name VARCHAR(100),
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(50),
    
    address VARCHAR(255),
    public_key VARCHAR(500),
    private_key_encrypted TEXT,
    
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_user_currency ON wallets(user_id, currency);

CREATE TABLE balances (
    balance_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(wallet_id),
    currency VARCHAR(20) NOT NULL,
    
    available_balance DECIMAL(20, 18) DEFAULT 0,
    locked_balance DECIMAL(20, 18) DEFAULT 0,
    frozen_balance DECIMAL(20, 18) DEFAULT 0,
    pending_balance DECIMAL(20, 18) DEFAULT 0,
    
    -- Interest (savings/staking)
    interest_accrued DECIMAL(20, 18) DEFAULT 0,
    interest_rate DECIMAL(10, 8) DEFAULT 0,
    last_interest_at TIMESTAMP WITH TIME ZONE,
    
    -- Staking
    stake_amount DECIMAL(20, 18) DEFAULT 0,
    stake_reward_pending DECIMAL(20, 18) DEFAULT 0,
    stake_started_at TIMESTAMP WITH TIME ZONE,
    stake_end_at TIMESTAMP WITH TIME ZONE,
    stake_unbonding_end TIMESTAMP WITH TIME ZONE,
    
    -- Total
    total_balance DECIMAL(20, 18) GENERATED ALWAYS AS (
        available_balance + locked_balance + frozen_balance + pending_balance + stake_amount
    ) STORED,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, currency)
);

CREATE INDEX idx_balances_user_id ON balances(user_id);
CREATE INDEX idx_balances_currency ON balances(currency);

-- Deposit Addresses
CREATE TABLE deposit_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(50) NOT NULL,
    
    address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(255),
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_deposit_addresses_user ON deposit_addresses(user_id, currency);
CREATE UNIQUE INDEX idx_deposit_addresses_unique ON deposit_addresses(user_id, currency, network);

-- =============================================================================
-- DEPOSITS
-- =============================================================================

CREATE TABLE deposits (
    deposit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id),
    
    currency VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50),
    network VARCHAR(50),
    
    amount DECIMAL(20, 18) NOT NULL,
    fee DECIMAL(20, 18) DEFAULT 0,
    gross_amount DECIMAL(20, 18) NOT NULL,
    
    from_address VARCHAR(255),
    from_address_tag VARCHAR(255),
    to_address VARCHAR(255) NOT NULL,
    to_address_tag VARCHAR(255),
    
    tx_hash VARCHAR(255),
    block_hash VARCHAR(255),
    block_number BIGINT,
    block_timestamp TIMESTAMP WITH TIME ZONE,
    
    confirmations INTEGER DEFAULT 0,
    confirmations_required INTEGER DEFAULT 6,
    
    deposit_type deposit_type DEFAULT 'external',
    status deposit_status DEFAULT 'pending',
    
    internal_transfer_id UUID,
    credited_wallet_id UUID,
    
    error_message TEXT,
    admin_notes TEXT,
    
    -- Security
    risk_score DECIMAL(5, 2),
    risk_flags TEXT[],
    flagged_reason TEXT,
    
    processed_by UUID REFERENCES users(user_id),
    processed_at TIMESTAMP WITH TIME ZONE,
    credited_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_currency ON deposits(currency);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX idx_deposits_created_at ON deposits(created_at);
CREATE INDEX idx_deposits_address ON deposits(to_address);

-- =============================================================================
-- WITHDRAWALS
-- =============================================================================

CREATE TABLE withdrawals (
    withdrawal_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50),
    network VARCHAR(50),
    
    amount DECIMAL(20, 18) NOT NULL,
    fee DECIMAL(20, 18) DEFAULT 0,
    gross_amount DECIMAL(20, 18) NOT NULL,
    net_amount DECIMAL(20, 18) NOT NULL,
    
    to_address VARCHAR(255) NOT NULL,
    to_address_tag VARCHAR(255),
    memo VARCHAR(255),
    
    tx_hash VARCHAR(255),
    block_hash VARCHAR(255),
    block_number BIGINT,
    
    confirmations INTEGER DEFAULT 0,
    confirmations_required INTEGER DEFAULT 6,
    
    priority withdrawal_priority DEFAULT 'normal',
    status withdrawal_status DEFAULT 'pending',
    
    -- Security
    otp_verified BOOLEAN DEFAULT FALSE,
    otp_used_at TIMESTAMP WITH TIME ZONE,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    phone_verified BOOLEAN DEFAULT FALSE,
    
    risk_score DECIMAL(5, 2),
    risk_flags TEXT[],
    
    -- Address whitelist
    is_address_whitelisted BOOLEAN DEFAULT FALSE,
    
    -- Approval workflow
    approved_by UUID REFERENCES users(user_id),
    approved_at TIMESTAMP WITH TIME ZONE,
    approval_note TEXT,
    
    -- Cancellation
    cancelled_by UUID REFERENCES users(user_id),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    
    -- Processing
    processed_by UUID REFERENCES users(user_id),
    processed_at TIMESTAMP WITH TIME ZONE,
    broadcast_at TIMESTAMP WITH TIME ZONE,
    
    user_note TEXT,
    admin_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_currency ON withdrawals(currency);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_created_at ON withdrawals(created_at);
CREATE INDEX idx_withdrawals_address ON withdrawals(to_address);

-- Withdrawal Address Whitelist
CREATE TABLE withdrawal_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    label VARCHAR(100) NOT NULL,
    address VARCHAR(255) NOT NULL,
    address_tag VARCHAR(255),
    memo VARCHAR(255),
    
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(50),
    
    is_verified BOOLEAN DEFAULT FALSE,
    verification_type VARCHAR(50),
    
    withdrawal_count INTEGER DEFAULT 0,
    last_withdrawal_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, currency, address)
);

CREATE INDEX idx_withdrawal_whitelist_user ON withdrawal_addresses(user_id);

-- =============================================================================
-- INTERNAL TRANSFERS
-- =============================================================================

CREATE TABLE internal_transfers (
    transfer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID NOT NULL REFERENCES users(user_id),
    to_user_id UUID NOT NULL REFERENCES users(user_id),
    
    from_wallet_id UUID REFERENCES wallets(wallet_id),
    to_wallet_id UUID REFERENCES wallets(wallet_id),
    
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(20, 18) NOT NULL,
    fee DECIMAL(20, 18) DEFAULT 0,
    
    status VARCHAR(50) DEFAULT 'pending',
    
    memo VARCHAR(255),
    reference_id VARCHAR(100),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT
);

CREATE INDEX idx_transfers_from_user ON internal_transfers(from_user_id);
CREATE INDEX idx_transfers_to_user ON internal_transfers(to_user_id);
CREATE INDEX idx_transfers_created_at ON internal_transfers(created_at);

-- Balance Changes (Audit Trail)
CREATE TABLE balance_changes (
    change_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(wallet_id),
    currency VARCHAR(20) NOT NULL,
    
    change_type VARCHAR(50) NOT NULL, -- 'credit', 'debit', 'lock', 'unlock', 'freeze', 'unfreeze'
    change_amount DECIMAL(20, 18) NOT NULL,
    
    balance_before DECIMAL(20, 18),
    balance_after DECIMAL(20, 18),
    
    order_id UUID,
    trade_id UUID,
    deposit_id UUID,
    withdrawal_id UUID,
    transfer_id UUID,
    
    reason VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_balance_changes_user_id ON balance_changes(user_id);
CREATE INDEX idx_balance_changes_currency ON balance_changes(currency);
CREATE INDEX idx_balance_changes_created_at ON balance_changes(created_at);
CREATE INDEX idx_balance_changes_order_id ON balance_changes(order_id);
CREATE INDEX idx_balance_changes_trade_id ON balance_changes(trade_id);

-- =============================================================================
-- ORDERS & TRADES
-- =============================================================================

CREATE TABLE orders (
    order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_order_id VARCHAR(100),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    market_id UUID REFERENCES markets(market_id),
    symbol VARCHAR(20) NOT NULL,
    
    side order_side NOT NULL,
    type order_type NOT NULL,
    
    price DECIMAL(20, 8),
    stop_price DECIMAL(20, 8),
    trigger_price DECIMAL(20, 8),
    trailing_delta DECIMAL(20, 8),
    
    quantity DECIMAL(20, 18) NOT NULL,
    filled_quantity DECIMAL(20, 18) DEFAULT 0,
    remaining_quantity DECIMAL(20, 18),
    
    display_quantity DECIMAL(20, 18), -- For iceberg orders
    
    average_fill_price DECIMAL(20, 8) DEFAULT 0,
    order_value DECIMAL(20, 18) DEFAULT 0,
    
    maker_fee_rate DECIMAL(10, 8) DEFAULT 0.001,
    taker_fee_rate DECIMAL(10, 8) DEFAULT 0.002,
    fee_currency VARCHAR(20),
    
    time_in_force time_in_force DEFAULT 'GTC',
    expire_time TIMESTAMP WITH TIME ZONE,
    
    status order_status DEFAULT 'pending_new',
    
    is_reduce_only BOOLEAN DEFAULT FALSE,
    is_close_only BOOLEAN DEFAULT FALSE,
    is_post_only BOOLEAN DEFAULT FALSE,
    is_iceberg BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    
    self_trade_prevention VARCHAR(50),
    
    position_id UUID,
    position_mode position_mode,
    leverage DECIMAL(10, 2) DEFAULT 1,
    
    contingency_order_id UUID,
    
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    filled_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    expired_at TIMESTAMP WITH TIME ZONE,
    
    cancellation_reason TEXT
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX idx_orders_user_symbol ON orders(user_id, symbol);

CREATE TABLE trades (
    trade_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    market_id UUID REFERENCES markets(market_id),
    symbol VARCHAR(20) NOT NULL,
    
    order_id UUID NOT NULL REFERENCES orders(order_id),
    counter_order_id UUID REFERENCES orders(order_id),
    
    user_id UUID NOT NULL REFERENCES users(user_id),
    counter_user_id UUID REFERENCES users(user_id),
    
    side order_side NOT NULL,
    role VARCHAR(10) NOT NULL, -- 'maker', 'taker'
    
    price DECIMAL(20, 8) NOT NULL,
    quantity DECIMAL(20, 18) NOT NULL,
    quote_quantity DECIMAL(20, 18) NOT NULL,
    
    maker_fee DECIMAL(20, 18) DEFAULT 0,
    taker_fee DECIMAL(20, 18) DEFAULT 0,
    fee_currency VARCHAR(20),
    
    realized_pnl DECIMAL(20, 18),
    unrealized_pnl DECIMAL(20, 18),
    
    is_taker BOOLEAN NOT NULL,
    is_maker BOOLEAN NOT NULL,
    is_self_trade BOOLEAN DEFAULT FALSE,
    
    trade_type VARCHAR(20) DEFAULT 'normal', -- 'normal', 'liquidation', 'adl'
    liquidation_order BOOLEAN DEFAULT FALSE,
    
    fee_maker_taker VARCHAR(10),
    
    position_id UUID,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_created_at ON trades(created_at);
CREATE INDEX idx_trades_market_time ON trades(market_id, created_at);

-- =============================================================================
-- POSITIONS (MARGIN & FUTURES)
-- =============================================================================

CREATE TABLE positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    market_id UUID REFERENCES markets(market_id),
    symbol VARCHAR(20) NOT NULL,
    
    side order_side NOT NULL, -- 'long' or 'short'
    size DECIMAL(20, 18) DEFAULT 0,
    open_quantity DECIMAL(20, 18) DEFAULT 0,
    
    entry_price DECIMAL(20, 8) DEFAULT 0,
    mark_price DECIMAL(20, 8) DEFAULT 0,
    liquidation_price DECIMAL(20, 8),
    bankruptcy_price DECIMAL(20, 8),
    
    leverage DECIMAL(10, 2) DEFAULT 1,
    margin DECIMAL(20, 18) DEFAULT 0,
    isolated_margin DECIMAL(20, 18),
    cross_margin_used DECIMAL(20, 18),
    
    maintenance_margin DECIMAL(20, 18) DEFAULT 0,
    margin_ratio DECIMAL(10, 8) DEFAULT 0,
    
    unrealized_pnl DECIMAL(20, 18) DEFAULT 0,
    unrealized_pnl_percent DECIMAL(10, 4) DEFAULT 0,
    total_realized_pnl DECIMAL(20, 18) DEFAULT 0,
    
    funding_fee DECIMAL(20, 18) DEFAULT 0,
    funding_rate DECIMAL(10, 8) DEFAULT 0,
    last_funding_time TIMESTAMP WITH TIME ZONE,
    
    position_mode position_mode DEFAULT 'cross',
    auto_add_margin BOOLEAN DEFAULT FALSE,
    
    risk_level VARCHAR(20) DEFAULT 'normal',
    liquidation_progress DECIMAL(5, 2) DEFAULT 0,
    
    is_auto_deleveraged BOOLEAN DEFAULT FALSE,
    adl_rank INTEGER,
    
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(user_id, symbol, position_mode)
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_symbol ON positions(symbol);
CREATE INDEX idx_positions_user_symbol ON positions(user_id, symbol);

-- Position History (for audit)
CREATE TABLE position_history (
    history_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID NOT NULL REFERENCES positions(position_id),
    
    action VARCHAR(50) NOT NULL, -- 'open', 'add', 'reduce', 'close', 'liquidation', 'adl'
    
    size_before DECIMAL(20, 18),
    size_after DECIMAL(20, 18),
    
    entry_price_before DECIMAL(20, 8),
    entry_price_after DECIMAL(20, 8),
    
    margin_before DECIMAL(20, 18),
    margin_after DECIMAL(20, 18),
    
    pnl DECIMAL(20, 18),
    fee DECIMAL(20, 18),
    
    trade_id UUID REFERENCES trades(trade_id),
    order_id UUID REFERENCES orders(order_id),
    
    reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_position_history_position ON position_history(position_id);

-- =============================================================================
-- STAKING & SAVINGS
-- =============================================================================

CREATE TABLE staking_products (
    product_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    min_stake DECIMAL(20, 18) DEFAULT 0,
    max_stake DECIMAL(20, 18),
    
    min_lock_period INTEGER, -- in days
    max_lock_period INTEGER,
    early_unstaking_penalty DECIMAL(5, 4) DEFAULT 0,
    
    apr DECIMAL(10, 4) DEFAULT 0, -- Annual Percentage Rate
    apy DECIMAL(10, 4) DEFAULT 0, -- Annual Percentage Yield
    
    is_active BOOLEAN DEFAULT TRUE,
    is_auto_staking BOOLEAN DEFAULT FALSE,
    
    max_total_stake DECIMAL(20, 18),
    current_total_stake DECIMAL(20, 18) DEFAULT 0,
    
    starts_at TIMESTAMP WITH TIME ZONE,
    ends_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_staking_products_currency ON staking_products(currency);

CREATE TABLE staking_positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    product_id UUID NOT NULL REFERENCES staking_products(product_id),
    
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(20, 18) NOT NULL,
    
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    lock_end_date TIMESTAMP WITH TIME ZONE,
    
    is_auto_staking BOOLEAN DEFAULT FALSE,
    is_early_unstaked BOOLEAN DEFAULT FALSE,
    
    total_rewards DECIMAL(20, 18) DEFAULT 0,
    claimed_rewards DECIMAL(20, 18) DEFAULT 0,
    pending_rewards DECIMAL(20, 18) DEFAULT 0,
    
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'unbonding', 'completed', 'withdrawn'
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_staking_positions_user ON staking_positions(user_id);
CREATE INDEX idx_staking_positions_product ON staking_positions(product_id);

CREATE TABLE savings_products (
    product_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    currency VARCHAR(20) NOT NULL,
    
    product_type VARCHAR(20) NOT NULL, -- 'flexible', 'fixed'
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    min_amount DECIMAL(20, 18) DEFAULT 0,
    max_amount DECIMAL(20, 18),
    
    min_term_days INTEGER,
    max_term_days INTEGER,
    
    apr DECIMAL(10, 4) DEFAULT 0,
    
    interest_accrual_daily BOOLEAN DEFAULT TRUE,
    interest_claim_frequency VARCHAR(20) DEFAULT 'daily', -- 'daily', 'weekly', 'monthly', 'maturity'
    
    is_active BOOLEAN DEFAULT TRUE,
    is_auto_subscribe BOOLEAN DEFAULT FALSE,
    is_renewable BOOLEAN DEFAULT FALSE,
    
    max_total_amount DECIMAL(20, 18),
    current_total_amount DECIMAL(20, 18) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE savings_positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    product_id UUID NOT NULL REFERENCES savings_products(product_id),
    
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(20, 18) NOT NULL,
    
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    maturity_date TIMESTAMP WITH TIME ZONE,
    
    interest_rate DECIMAL(10, 8),
    expected_interest DECIMAL(20, 18),
    
    total_interest DECIMAL(20, 18) DEFAULT 0,
    claimed_interest DECIMAL(20, 18) DEFAULT 0,
    
    status VARCHAR(50) DEFAULT 'active',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_savings_positions_user ON savings_positions(user_id);

-- =============================================================================
-- P2P TRADING
-- =============================================================================

CREATE TABLE p2p_orders (
    order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    advert_id UUID NOT NULL,
    advertiser_id UUID NOT NULL REFERENCES users(user_id),
    trader_id UUID NOT NULL REFERENCES users(user_id),
    
    side order_side NOT NULL, -- 'buy' (from advertiser), 'sell' (from advertiser)
    
    fiat_currency VARCHAR(10) NOT NULL,
    fiat_amount DECIMAL(20, 8) NOT NULL,
    crypto_amount DECIMAL(20, 18) NOT NULL,
    price_per_unit DECIMAL(20, 8) NOT NULL,
    crypto_currency VARCHAR(20) NOT NULL,
    
    payment_method_id UUID,
    
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'paid', 'completed', 'cancelled', 'disputed', 'refunded'
    
    payment_deadline TIMESTAMP WITH TIME ZONE,
    cancelled_by UUID,
    cancel_reason TEXT,
    
    released_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    dispute_id UUID,
    dispute_status VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_p2p_orders_advertiser ON p2p_orders(advertiser_id);
CREATE INDEX idx_p2p_orders_trader ON p2p_orders(trader_id);
CREATE INDEX idx_p2p_orders_status ON p2p_orders(status);

CREATE TABLE p2p_adverts (
    advert_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    side order_side NOT NULL,
    
    crypto_currency VARCHAR(20) NOT NULL,
    fiat_currency VARCHAR(10) NOT NULL,
    
    price_type VARCHAR(20) NOT NULL, -- 'fixed', 'floating'
    price_percentage DECIMAL(5, 2), -- For floating: offset from market (e.g., -5 for 5% below)
    fixed_price DECIMAL(20, 8), -- For fixed price
    
    min_amount DECIMAL(20, 8),
    max_amount DECIMAL(20, 8),
    
    payment_methods UUID[],
    
    completion_rate DECIMAL(5, 2) DEFAULT 100,
    total_orders INTEGER DEFAULT 0,
    avg_release_time INTEGER, -- in minutes
    
    is_active BOOLEAN DEFAULT TRUE,
    auto_reply TEXT,
    
    terms TEXT,
    instructions TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_p2p_adverts_user ON p2p_adverts(user_id);
CREATE INDEX idx_p2p_adverts_currency ON p2p_adverts(crypto_currency);

-- =============================================================================
-- VAULTS
-- =============================================================================

CREATE TABLE vaults (
    vault_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    balance DECIMAL(20, 18) DEFAULT 0,
    locked_balance DECIMAL(20, 18) DEFAULT 0,
    
    multi_sig_enabled BOOLEAN DEFAULT TRUE,
    time_lock_hours INTEGER DEFAULT 24,
    
    withdrawal_limit_24h DECIMAL(20, 18),
    withdrawal_limit_7d DECIMAL(20, 18),
    
    required_signers INTEGER DEFAULT 1,
    total_signers INTEGER DEFAULT 1,
    
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vaults_user ON vaults(user_id);

CREATE TABLE vault_withdrawal_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id UUID NOT NULL REFERENCES vaults(vault_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    currency VARCHAR(20) NOT NULL,
    amount DECIMAL(20, 18) NOT NULL,
    to_address VARCHAR(255) NOT NULL,
    
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'completed', 'expired'
    
    time_lock_end TIMESTAMP WITH TIME ZONE,
    
    approved_by UUID REFERENCES users(user_id),
    approved_at TIMESTAMP WITH TIME ZONE,
    
    completed_at TIMESTAMP WITH TIME ZONE,
    
    tx_hash VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vault_requests_vault ON vault_withdrawal_requests(vault_id);

-- =============================================================================
-- REFERRALS & REWARDS
-- =============================================================================

CREATE TABLE referral_rewards (
    reward_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    referrer_id UUID NOT NULL REFERENCES users(user_id),
    referee_id UUID NOT NULL REFERENCES users(user_id),
    
    reward_type VARCHAR(50) NOT NULL, -- 'signup', 'first_deposit', 'first_trade', 'trade_volume', 'commission'
    
    currency VARCHAR(20),
    amount DECIMAL(20, 18),
    
    status VARCHAR(50) DEFAULT 'pending',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    claimed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_referral_rewards_referrer ON referral_rewards(referrer_id);
CREATE INDEX idx_referral_rewards_referee ON referral_rewards(referee_id);

-- Trading Competitions
CREATE TABLE trading_competitions (
    competition_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    name VARCHAR(200) NOT NULL,
    description TEXT,
    
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    market_id UUID REFERENCES markets(market_id),
    
    prize_pool JSONB NOT NULL, -- [{rank: 1, prize: {currency: 'USDT', amount: 1000}}]
    
    metrics VARCHAR(50) NOT NULL, -- 'volume', 'pnl', 'trades'
    
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE competition_participants (
    participant_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL REFERENCES trading_competitions(competition_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    metrics_value DECIMAL(20, 8) DEFAULT 0,
    rank INTEGER,
    
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(competition_id, user_id)
);

CREATE INDEX idx_competition_participants ON competition_participants(competition_id);

-- =============================================================================
-- AUDIT & COMPLIANCE
-- =============================================================================

CREATE TABLE audit_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID REFERENCES users(user_id),
    
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    
    ip_address INET,
    user_agent TEXT,
    
    old_values JSONB,
    new_values JSONB,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Notifications
CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    type VARCHAR(100) NOT NULL,
    title VARCHAR(200),
    message TEXT,
    
    data JSONB DEFAULT '{}',
    
    is_read BOOLEAN DEFAULT FALSE,
    is_pushed BOOLEAN DEFAULT FALSE,
    is_emailed BOOLEAN DEFAULT FALSE,
    
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- Support Tickets
CREATE TABLE support_tickets (
    ticket_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    
    category VARCHAR(50),
    priority VARCHAR(20) DEFAULT 'normal',
    
    status VARCHAR(50) DEFAULT 'open',
    
    assigned_to UUID REFERENCES users(user_id),
    resolved_by UUID REFERENCES users(user_id),
    
    closed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tickets_user ON support_tickets(user_id);
CREATE INDEX idx_tickets_status ON support_tickets(status);

CREATE TABLE support_messages (
    message_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(ticket_id),
    
    sender_id UUID NOT NULL,
    sender_type VARCHAR(20) NOT NULL, -- 'user', 'support'
    
    message TEXT NOT NULL,
    attachments JSONB,
    
    is_internal BOOLEAN DEFAULT FALSE, -- Internal note (not visible to user)
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_ticket ON support_messages(ticket_id);

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_balances_updated_at BEFORE UPDATE ON balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Generate referral code
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS VARCHAR(20) AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code VARCHAR(20) := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Create initial user referral code
CREATE OR REPLACE FUNCTION set_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := generate_referral_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_user_referral_code BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION set_referral_code();

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Insert default currencies
INSERT INTO currencies (symbol, name, type, blockchain, decimals, is_active) VALUES
('BTC', 'Bitcoin', 'crypto', 'bitcoin', 8, true),
('ETH', 'Ethereum', 'crypto', 'ethereum', 18, true),
('USDT', 'Tether', 'stablecoin', 'ethereum', 6, true),
('USDC', 'USD Coin', 'stablecoin', 'ethereum', 6, true),
('BNB', 'BNB', 'crypto', 'bsc', 18, true),
('SOL', 'Solana', 'crypto', 'solana', 9, true),
('XRP', 'Ripple', 'crypto', 'ripple', 6, true),
('ADA', 'Cardano', 'crypto', 'cardano', 6, true),
('DOGE', 'Dogecoin', 'crypto', 'dogecoin', 8, true),
('DOT', 'Polkadot', 'crypto', 'polkadot', 10, true);

-- Insert default markets
INSERT INTO markets (symbol, base_currency, quote_currency, tick_size, step_size, price_precision, quantity_precision, is_active) VALUES
('BTC/USDT', 'BTC', 'USDT', 0.01, 0.00001, 8, 8, true),
('ETH/USDT', 'ETH', 'USDT', 0.01, 0.0001, 8, 8, true),
('BNB/USDT', 'BNB', 'USDT', 0.01, 0.001, 8, 8, true),
('SOL/USDT', 'SOL', 'USDT', 0.001, 0.01, 8, 8, true),
('XRP/USDT', 'XRP', 'USDT', 0.0001, 0.1, 8, 8, true),
('ADA/USDT', 'ADA', 'USDT', 0.0001, 1, 8, 8, true),
('DOGE/USDT', 'DOGE', 'USDT', 0.00001, 10, 8, 8, true),
('DOT/USDT', 'DOT', 'USDT', 0.001, 0.1, 8, 8, true),
('ETH/BTC', 'ETH', 'BTC', 0.000001, 0.0001, 8, 8, true),
('BNB/BTC', 'BNB', 'BTC', 0.000001, 0.001, 8, 8, true);

-- =============================================================================
-- PERMISSIONS & RBAC
-- =============================================================================

CREATE TABLE roles (
    role_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE user_roles (
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(roles(role_id) ON DELETE CASCADE),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by UUID REFERENCES users(user_id),
    PRIMARY KEY (user_id, role_id)
);

-- Insert default roles
INSERT INTO roles (name, description, permissions) VALUES
('admin', 'Full system access', '["*"]'),
('support', 'Customer support', '["read:users", "read:orders", "read:deposits", "read:withdrawals", "update:tickets"]'),
('compliance', 'Compliance officer', '["read:*", "kyc:*", "aml:*"]'),
('trader', 'Regular trader', '["trade:*", "wallet:*"]'),
('viewer', 'Read-only access', '["read:public"]');

-- =============================================================================
-- INDEXES & PERFORMANCE
-- =============================================================================

-- Additional indexes for performance
CREATE INDEX idx_deposits_user_created ON deposits(user_id, created_at DESC);
CREATE INDEX idx_withdrawals_user_created ON withdrawals(user_id, created_at DESC);
CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX idx_trades_user_created ON trades(user_id, created_at DESC);

-- Partial indexes for common queries
CREATE INDEX idx_balances_non_zero ON balances(user_id, currency) WHERE available_balance > 0;
CREATE INDEX idx_orders_open ON orders(user_id, symbol) WHERE status IN ('new', 'partially_filled');
CREATE INDEX idx_positions_active ON positions(user_id, symbol) WHERE size != 0;

-- Composite indexes for reporting
CREATE INDEX idx_trades_daily ON trades(DATE(created_at), symbol);
CREATE INDEX idx_orders_hourly ON orders(DATE(created_at), EXTRACT(HOUR FROM created_at), symbol);

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================