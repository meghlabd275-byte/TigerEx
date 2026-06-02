-- =============================================================================
-- TigerEx Complete Database Schema - Production Ready
-- Version 3.0.0
-- Author: OpenHands AI Agent
-- =============================================================================

-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "timescaledb";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =============================================================================
-- CORE USERS & AUTHENTICATION
-- =============================================================================

-- Users Table with full user data
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(255) NOT NULL,
    password_version INTEGER DEFAULT 1,
    
    -- Profile
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    phone VARCHAR(50),
    country_code CHAR(2) NOT NULL DEFAULT 'XX',
    timezone VARCHAR(50) DEFAULT 'UTC',
    locale VARCHAR(10) DEFAULT 'en-US',
    
    -- Verification
    kyc_level SMALLINT DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 3),
    kyc_tier SMALLINT DEFAULT 0,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    phone_verified_at TIMESTAMP WITH TIME ZONE,
    identity_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Security
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret_encrypted BYTEA,
    two_factor_backup_codes TEXT[],
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    password_history JSONB DEFAULT '[]',
    
    -- Account Status
    account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN (
        'pending', 'active', 'suspended', 'locked', 'closed', 'pending_kyc'
    )),
    trading_enabled BOOLEAN DEFAULT TRUE,
    deposit_enabled BOOLEAN DEFAULT TRUE,
    withdrawal_enabled BOOLEAN DEFAULT TRUE,
    api_enabled BOOLEAN DEFAULT TRUE,
    
    -- Risk & Compliance
    risk_score SMALLINT DEFAULT 50 CHECK (risk_score BETWEEN 0 AND 100),
    risk_category VARCHAR(20) DEFAULT 'standard' CHECK (risk_category IN (
        'standard', 'premium', 'institutional', 'vip', 'pro'
    )),
    jurisdiction VARCHAR(3) DEFAULT 'XXX',
    restricted BOOLEAN DEFAULT FALSE,
    flagged BOOLEAN DEFAULT FALSE,
    flag_reason VARCHAR(255),
    
    -- Referral
    referral_code VARCHAR(50) UNIQUE,
    referrer_id UUID REFERENCES users(user_id),
    
    -- Analytics
    source VARCHAR(50),
    campaign VARCHAR(255),
    tags JSONB DEFAULT '[]',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_country ON users(country_code);
CREATE INDEX idx_users_kyc_level ON users(kyc_level);
CREATE INDEX idx_users_status ON users(account_status);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;

-- User Sessions
CREATE TABLE user_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    session_token_hash VARCHAR(255) NOT NULL,
    refresh_token_hash VARCHAR(255),
    
    -- Device Info
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_id VARCHAR(255),
    device_name VARCHAR(255),
    device_type VARCHAR(50),
    browser VARCHAR(100),
    os VARCHAR(100),
    location_city VARCHAR(100),
    location_country VARCHAR(2),
    
    -- Security
    trusted_device BOOLEAN DEFAULT FALSE,
    cors_origin VARCHAR(255),
    
    -- Lifecycle
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason VARCHAR(255)
);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON user_sessions(session_token_hash);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_sessions_created_at ON user_sessions(created_at);

-- API Keys
CREATE TABLE api_keys (
    key_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    key_name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(15) NOT NULL,
    key_suffix VARCHAR(15),
    
    -- Permissions
    permissions TEXT[] DEFAULT '{read}',
    rate_limit_plan VARCHAR(50) DEFAULT 'standard',
    rate_limit_monthly BIGINT DEFAULT 1000000,
    
    -- Restrictions  
    ip_whitelist INET[],
    cors_origins VARCHAR(255)[],
    referrers VARCHAR(255)[],
    
    -- Access
    access_level VARCHAR(20) DEFAULT 'user' CHECK (access_level IN (
        'user', 'trader', 'withdrawer', 'admin'
    )),
    
    -- Lifecycle
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    request_count BIGINT DEFAULT 0,
    total_request_bytes BIGINT DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_created_at ON api_keys(created_at);

-- =============================================================================
-- WALLETS & ACCOUNTS
-- =============================================================================

-- Wallets (Accounts)
CREATE TABLE wallets (
    wallet_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    wallet_type VARCHAR(30) NOT NULL CHECK (wallet_type IN (
        'spot', 'funding', 'trading', 'margin', 'futures', 
        'options', 'savings', 'staking', 'institutional', 'custody'
    )),
    wallet_name VARCHAR(100),
    currency VARCHAR(20) NOT NULL,
    network VARCHAR(20),
    
    -- Configuration
    is_default BOOLEAN DEFAULT FALSE,
    is_visible BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    
    -- Integration
    master_wallet BOOLEAN DEFAULT FALSE,
    hot_wallet BOOLEAN DEFAULT FALSE,
    cold_wallet BOOLEAN DEFAULT FALSE,
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_type ON wallets(wallet_type);
CREATE INDEX idx_wallets_currency ON wallets(currency);
CREATE UNIQUE INDEX idx_wallets_user_type_currency 
    ON wallets(user_id, wallet_type, currency) WHERE wallet_type = 'spot';

-- Balances
CREATE TABLE balances (
    balance_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(wallet_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    
    -- Amounts in native precision
    available_amount NUMERIC(32, 16) DEFAULT 0,
    locked_amount NUMERIC(32, 16) DEFAULT 0,
    order_locked_amount NUMERIC(32, 16) DEFAULT 0,
    
    -- Interest calculations (for savings/staking)
    interest_accrued NUMERIC(32, 16) DEFAULT 0,
    interest_last_calculated_at TIMESTAMP WITH TIME ZONE,
    
    -- Staking
    stake_amount NUMERIC(32, 16) DEFAULT 0,
    stake_reward_pending NUMERIC(32, 16) DEFAULT 0,
    stake_started_at TIMESTAMP WITH TIME ZONE,
    stake_unlock_height BIGINT,
    
    -- Cross-chain (for bridges)
    bridge_deposits_pending NUMERIC(32, 16) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, wallet_id, currency)
);

CREATE INDEX idx_balances_user_id ON balances(user_id);
CREATE INDEX idx_balances_wallet_id ON balances(wallet_id);
CREATE INDEX idx_balances_currency ON balances(currency);

-- Balance Change History (Append-Only for Audit)
CREATE TABLE balance_changes (
    change_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID NOT NULL,
    wallet_id UUID NOT NULL,
    currency VARCHAR(20) NOT NULL,
    
    -- Change details
    change_type VARCHAR(50) NOT NULL,
    change_amount NUMERIC(32, 16) NOT NULL,
    balance_before NUMERIC(32, 16) NOT NULL,
    balance_after NUMERIC(32, 16) NOT NULL,
    balance_locked_before NUMERIC(32, 16),
    balance_locked_after NUMERIC(32, 16),
    
    -- References
    order_id UUID,
    transaction_id UUID,
    trade_id UUID,
    deposit_id UUID,
    withdrawal_id UUID,
    transfer_id UUID,
    earn_id UUID,
    
    -- Reason
    reason VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    
    -- Actor (system, user, admin)
    actor_type VARCHAR(20) DEFAULT 'system',
    actor_id UUID,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_balance_changes_user_id ON balance_changes(user_id);
CREATE INDEX idx_balance_changes_wallet_id ON balance_changes(wallet_id);
CREATE INDEX idx_balance_changes_order_id ON balance_changes(order_id);
CREATE INDEX idx_balance_changes_transaction_id ON balance_changes(transaction_id);
CREATE INDEX idx_balance_changes_created_at ON balance_changes(created_at DESC);

SELECT create_hypertable('balance_changes', 'created_at', 
    chunk_time_interval => INTERVAL '1 hour');

-- Wallet Addresses
CREATE TABLE wallet_addresses (
    address_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50) NOT NULL,
    network VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    address_tag TEXT,
    
    address_type VARCHAR(20) DEFAULT 'deposit' CHECK (address_type IN (
        'deposit', 'withdrawal', 'internal', 'contract', 'reward'
    )),
    
    label VARCHAR(255),
    is_default_for_withdrawal BOOLEAN DEFAULT FALSE,
    is_default_for_deposit BOOLEAN DEFAULT FALSE,
    
    -- QR Code
    qr_code_uri TEXT,
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    first_confirmation_at TIMESTAMP WITH TIME ZONE,
    confirmation_count INTEGER DEFAULT 0,
    
    -- Tag derivation
    tag_derivation_key VARCHAR(100),
    tag_derivation_index BIGINT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_addresses_user_id ON wallet_addresses(user_id);
CREATE INDEX idx_wallet_addresses_currency ON wallet_addresses(currency);
CREATE INDEX idx_wallet_addresses_blockchain ON wallet_addresses(blockchain);
CREATE INDEX idx_wallet_addresses_address ON wallet_addresses(address);

-- =============================================================================
-- MARKETS & TRADING PAIRS
-- =============================================================================

-- Markets (Trading Pairs)
CREATE TABLE markets (
    market_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_symbol VARCHAR(20) UNIQUE NOT NULL,
    
    base_currency VARCHAR(20) NOT NULL,
    quote_currency VARCHAR(20) NOT NULL,
    
    -- Market Type
    market_type VARCHAR(20) DEFAULT 'spot' CHECK (market_type IN (
        'spot', 'margin', 'futures', 'perpetual', 'options', 'index'
    )),
    underlying_symbol VARCHAR(20),
    settlement_currency VARCHAR(20),
    
    -- Precision
    price_precision INTEGER DEFAULT 8,
    quantity_precision INTEGER DEFAULT 8,
    quote_precision INTEGER DEFAULT 8,
    
    -- Price Range
    min_price NUMERIC(32, 16),
    max_price NUMERIC(32, 16),
    tick_size NUMERIC(32, 16) DEFAULT 0.01,
    min_quantity NUMERIC(32, 16),
    max_quantity NUMERIC(32, 16),
    min_notional NUMERIC(32, 16),
    max_notional NUMERIC(32, 16),
    
    -- Lot Size (for order quantity)
    lot_size NUMERIC(32, 16) DEFAULT 1,
    step_size NUMERIC(32, 16) DEFAULT 1,
    
    -- Circuit Breakers
    price_change_24h_max_percent NUMERIC(10, 4),
    price_change_24h_max_absolute NUMERIC(32, 16),
    halt_duration_minutes INTEGER DEFAULT 30,
    
    -- Trading Hours
    trading_hours VARCHAR(100) DEFAULT '24/7',
    allow_instant_cancel BOOLEAN DEFAULT FALSE,
    
    -- Order Types Supported
    order_types TEXT[] DEFAULT ARRAY['limit', 'market'],
    time_in_force TEXT[] DEFAULT ARRAY['GTC', 'IOC', 'FOK'],
    
    -- Permissions
    is_spot_enabled BOOLEAN DEFAULT TRUE,
    is_margin_enabled BOOLEAN DEFAULT FALSE,
    is_trading_enabled BOOLEAN DEFAULT TRUE,
    cancel_only BOOLEAN DEFAULT FALSE,
    is_post_only BOOLEAN DEFAULT FALSE,
    
    -- Fees
    maker_fee NUMERIC(10, 6) DEFAULT 0.001,
    taker_fee NUMERIC(10, 6) DEFAULT 0.001,
    
    -- Status
    market_status VARCHAR(20) DEFAULT 'active' CHECK (market_status IN (
        'active', 'halted', 'closed', 'launching', 'delisted'
    )),
    status_reason VARCHAR(255),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    launched_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_markets_symbol ON markets(market_symbol);
CREATE INDEX idx_markets_base_quote ON markets(base_currency, quote_currency);
CREATE INDEX idx_markets_type ON markets(market_type);
CREATE INDEX idx_markets_status ON markets(market_status);

-- Market State (for circuit breakers)
CREATE TABLE market_states (
    state_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_id UUID REFERENCES markets(market_id) ON DELETE CASCADE,
    
    -- Last Price
    last_price NUMERIC(32, 16),
    last_quantity NUMERIC(32, 16),
    
    -- 24h Stats
    open_price NUMERIC(32, 16),
    high_price NUMERIC(32, 16),
    low_price NUMERIC(32, 16),
    close_price NUMERIC(32, 16),
    price_change NUMERIC(32, 16),
    price_change_percent NUMERIC(10, 6),
    
    -- Volume
    volume_24h_base NUMERIC(32, 16),
    volume_24h_quote NUMERIC(32, 16),
    volume_24h_ref NUMERIC(32, 16),
    
    -- Trades
    trades_24h INTEGER DEFAULT 0,
    trades_24h_long INTEGER DEFAULT 0,
    trades_24h_short INTEGER DEFAULT 0,
    
    -- Average Price
    vwap_24h NUMERIC(32, 16),
    twap_1h NUMERIC(32, 16),
    
    -- Circluit Breaker
    halted BOOLEAN DEFAULT FALSE,
    halt_reason VARCHAR(255),
    halt_started_at TIMESTAMP WITH TIME ZONE,
    halt_ends_at TIMESTAMP WITH TIME ZONE,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_market_states_market_id ON market_states(market_id);
CREATE INDEX idx_market_states_updated ON market_states(updated_at DESC);

SELECT create_hypertable('market_states', 'updated_at', 
    chunk_time_interval => INTERVAL '1 minute');

-- =============================================================================
-- ORDERS
-- =============================================================================

-- Orders
CREATE TABLE orders (
    order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    market_symbol VARCHAR(20) NOT NULL,
    
    -- Order Spec
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type VARCHAR(20) NOT NULL CHECK (order_type IN (
        'limit', 'market', 'stop_loss', 'stop_limit', 
        'take_profit', 'take_limit', 'trailing_stop',
        'oco', 'iceberg', 'twap', 'accumulate_distribute'
    )),
    time_in_force VARCHAR(10) NOT NULL DEFAULT 'GTC' CHECK (time_in_force IN (
        'GTC', 'IOC', 'FOK', 'GTX', 'GTT', 'SIA', 'FAS'
    )),
    
    -- Prices
    limit_price NUMERIC(32, 16),
    stop_price NUMERIC(32, 16),
    iceberg_display_qty NUMERIC(32, 16),
    
    -- Quantities
    quantity NUMERIC(32, 16) NOT NULL,
    filled_quantity NUMERIC(32, 16) DEFAULT 0,
    remaining_quantity NUMERIC(32, 16) GENERATED ALWAYS AS (
        quantity - filled_quantity
    ) STORED,
    
    -- Average Price
    avg_fill_price NUMERIC(32, 16),
    
    -- Value & Fees
    order_value NUMERIC(32, 16),
    filled_value NUMERIC(32, 16),
    commission NUMERIC(32, 16) DEFAULT 0,
    commission_asset VARCHAR(20),
    
    -- Leverage (for margin/futures)
    leverage NUMERIC(10, 4),
    margin_used NUMERIC(32, 16),
    position_mode VARCHAR(20) DEFAULT 'cross' CHECK (position_mode IN ('cross', 'isolated')),
    
    -- Status
    order_status VARCHAR(20) DEFAULT 'new' CHECK (order_status IN (
        'pending_new', 'new', 'partially_filled', 'filled', 
        'canceled', 'rejected', 'expired', 'pending_cancel'
    )),
    status_reason VARCHAR(255),
    reject_reason VARCHAR(255),
    
    -- Client Info
    client_order_id VARCHAR(100),
    client_connection_id VARCHAR(100),
    
    -- Execution Info
    trigger_price NUMERIC(32, 16),
    triggered_at TIMESTAMP WITH TIME ZONE,
    activated_at TIMESTAMP WITH TIME ZONE,
    
    -- Expiry
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Self-trade prevention
    self_trade_prevention VARCHAR(20) DEFAULT 'decrement_take' CHECK (
        self_trade_prevention IN ('decrement_take', 'increment_provide', 
        'cancel_rest', 'cancel_both')
    ),
    
    -- Post-only
    post_only BOOLEAN DEFAULT FALSE,
    reduce_only BOOLEAN DEFAULT FALSE,
    
    -- Attribution
    source VARCHAR(50),
    campaign VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP WITH TIME ZONE,
    traded_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_market_symbol ON orders(market_symbol);
CREATE INDEX idx_orders_side ON orders(side);
CREATE INDEX idx_orders_type ON orders(order_type);
CREATE INDEX idx_orders_status ON orders(order_status);
CREATE INDEX idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

SELECT create_hypertable('orders', 'created_at', 
    chunk_time_interval => INTERVAL '1 hour');

-- Order Routing
CREATE TABLE order_routing (
    route_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(order_id) ON DELETE SET NULL,
    
    -- Routing
    venue VARCHAR(50),
    venue_order_id VARCHAR(100),
    venue_order_uuid VARCHAR(100),
    
    -- Venue Result
    venue_status VARCHAR(50),
    venue_error_code VARCHAR(50),
    venue_error_message TEXT,
    
    routed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    venue_response_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_order_routing_order_id ON order_routing(order_id);

-- =============================================================================
-- TRADES
-- =============================================================================

-- Trades
CREATE TABLE trades (
    trade_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    order_id UUID REFERENCES orders(order_id) ON DELETE SET NULL,
    counter_order_id UUID REFERENCES orders(order_id) ON DELETE SET NULL,
    
    market_symbol VARCHAR(20) NOT NULL,
    
    -- Participants  
    maker_user_id UUID REFERENCES users(user_id),
    taker_user_id UUID REFERENCES users(user_id),
    maker_order_id UUID,
    taker_order_id UUID,
    
    -- Trade Details
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    price NUMERIC(32, 16) NOT NULL,
    quantity NUMERIC(32, 16) NOT NULL,
    quote_quantity NUMERIC(32, 16) GENERATED ALWAYS AS (price * quantity) STORED,
    
    -- Index Price (for mark price)
    index_price NUMERIC(32, 16),
    mark_price NUMERIC(32, 16),
    
    -- Fees
    maker_fee NUMERIC(32, 16) DEFAULT 0,
    taker_fee NUMERIC(32, 16) DEFAULT 0,
    maker_fee_rate NUMERIC(10, 6) DEFAULT 0.001,
    taker_fee_rate NUMERIC(10, 6) DEFAULT 0.001,
    
    -- Fee Assets
    maker_fee_asset VARCHAR(20),
    taker_fee_asset VARCHAR(20),
    
    -- Role
    is_maker BOOLEAN,
    role VARCHAR(10) CHECK (role IN ('maker', 'taker')),
    is_self_trade BOOLEAN DEFAULT FALSE,
    
    -- Funding (for perpetual)
    funding_rate NUMERIC(10, 8),
    funding_index NUMERIC(10, 8),
    
    -- P&L (for positions)
    realized_pnl NUMERIC(32, 16) DEFAULT 0,
    closed_pnl NUMERIC(32, 16) DEFAULT 0,
    
    -- Liquidation
    is_liquidation BOOLEAN DEFAULT FALSE,
    liquidation_type VARCHAR(50),
    
    -- BlockChain (for settlement)
    block_hash VARCHAR(255),
    block_number BIGINT,
    transaction_hash VARCHAR(255),
    log_index INTEGER,
    
    fee_zero_until TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_counter_order_id ON trades(counter_order_id);
CREATE INDEX idx_trades_maker_user ON trades(maker_user_id);
CREATE INDEX idx_trades_taker_user ON trades(taker_user_id);
CREATE INDEX idx_trades_market ON trades(market_symbol);
CREATE INDEX idx_trades_created_at ON trades(created_at DESC);

SELECT create_hypertable('trades', 'created_at', 
    chunk_time_interval => INTERVAL '1 minute');

-- Trade Fees (Daily Aggregation)
CREATE TABLE trade_fees (
    fee_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    user_id UUID NOT NULL,
    currency VARCHAR(20) NOT NULL,
    
    -- Period
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Volume
    trading_volume NUMERIC(32, 16) DEFAULT 0,
    trading_count BIGINT DEFAULT 0,
    
    -- Fees
    maker_fees NUMERIC(32, 16) DEFAULT 0,
    taker_fees NUMERIC(32, 16) DEFAULT 0,
    
    -- Discounts applied
    volume_discount NUMERIC(10, 6) DEFAULT 0,
    holding_discount NUMERIC(10, 6) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, currency, period_start)
);

CREATE INDEX idx_trade_fees_user ON trade_fees(user_id);
CREATE INDEX idx_trade_fees_period ON trade_fees(period_start);

-- =============================================================================
-- POSITIONS (Margin/Futures)
-- =============================================================================

-- Positions
CREATE TABLE positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    market_symbol VARCHAR(20) NOT NULL,
    position_side VARCHAR(10) NOT NULL CHECK (position_side IN ('long', 'short')),
    
    size NUMERIC(32, 16) NOT NULL,
    entry_price NUMERIC(32, 16) NOT NULL,
    
    -- Margins
    margin NUMERIC(32, 16) NOT NULL,
    isolated_margin NUMERIC(32, 16),
    maintenance_margin NUMERIC(32, 16),
    
    -- Un realized P&L
    unrealized_pnl NUMERIC(32, 16) DEFAULT 0,
    unrealized_roe_percent NUMERIC(10, 4) DEFAULT 0,
    
    -- Liquidation
    liquidation_price NUMERIC(32, 16),
    stop_loss_price NUMERIC(32, 16),
    take_profit_price NUMERIC(32, 16),
    
    -- Leverage
    leverage NUMERIC(10, 4) NOT NULL,
    position_mode VARCHAR(20) DEFAULT 'cross' CHECK (position_mode IN ('cross', 'isolated')),
    
    -- Mark Price (for P&L calc)
    mark_price NUMERIC(32, 16),
    last_mark_price_updated_at TIMESTAMP WITH TIME ZONE,
    
    -- Funding
    cumulative_funding NUMERIC(32, 16) DEFAULT 0,
    last_funding_paid_at TIMESTAMP WITH TIME ZONE,
    
    -- Cooldown
    reduce_only BOOLEAN DEFAULT FALSE,
    close_on_trigger BOOLEAN DEFAULT FALSE,
    
    -- Status
    position_status VARCHAR(20) DEFAULT 'open' CHECK (
        position_status IN ('open', 'closing', 'closed', 'liquidating', 'liquidated')
    ),
    close_reason VARCHAR(50),
    
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_market ON positions(market_symbol);
CREATE INDEX idx_positions_status ON positions(position_status);
CREATE INDEX idx_positions_opened ON positions(opened_at DESC);

-- Position History
CREATE TABLE position_history (
    hist_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID REFERENCES positions(position_id) ON DELETE SET NULL,
    
    size_before NUMERIC(32, 16),
    size_after NUMERIC(32, 16),
    entry_price_before NUMERIC(32, 16),
    entry_price_after NUMERIC(32, 16),
    pnl_realized NUMERIC(32, 16),
    
    reason VARCHAR(50),
    trigger_source VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

SELECT create_hypertable('position_history', 'created_at', 
    chunk_time_interval => INTERVAL '1 hour');

-- =============================================================================
-- DEPOSITS & WITHDRAWALS
-- =============================================================================

-- Deposits
CREATE TABLE deposits (
    deposit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50),
    network VARCHAR(50),
    
    amount NUMERIC(32, 16) NOT NULL,
    gross_amount NUMERIC(32, 16),
    fee NUMERIC(32, 16) DEFAULT 0,
    
    -- Source Address
    from_address TEXT,
    from_address_tag TEXT,
    
    -- Destination Address
    to_address_uuid UUID REFERENCES wallet_addresses(address_id),
    to_address TEXT,
    to_address_tag TEXT,
    
    -- TX Hash
    tx_hash VARCHAR(255),
    tx_hash_outbound VARCHAR(255),
    tx_confirmations INTEGER DEFAULT 0,
    tx_confirmations_required INTEGER DEFAULT 6,
    tx_block_number BIGINT,
    tx_timestamp TIMESTAMP WITH TIME ZONE,
    
    -- Source
    deposit_type VARCHAR(20) DEFAULT 'external' CHECK (deposit_type IN (
        'external', 'internal', 'sub_account', 'airdrop', 'staking', 'reward', 'refund'
    )),
    source_platform VARCHAR(50),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'crediting', 'completed', 'failed', 
        'flagged', 'blocked', 'cancelled', 'returned'
    )),
    status_reason VARCHAR(255),
    admin_notes TEXT,
    
    -- AML Screening
    aml_screened BOOLEAN DEFAULT FALSE,
    aml_status VARCHAR(20),
    
    -- Timestamps
    processed_at TIMESTAMP WITH TIME ZONE,
    credited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_currency ON deposits(currency);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX idx_deposits_to_address ON deposits(to_address);
CREATE INDEX idx_deposits_created_at ON deposits(created_at DESC);

-- Withdrawals
CREATE TABLE withdrawals (
    withdrawal_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    currency VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50),
    network VARCHAR(50),
    
    amount NUMERIC(32, 16) NOT NULL,
    gross_amount NUMERIC(32, 16),
    fee NUMERIC(32, 16) DEFAULT 0,
    
    -- Destination
    to_addressuuid UUID REFERENCES wallet_addresses(address_id),
    to_address TEXT NOT NULL,
    to_address_tag TEXT,
    
    -- TX
    tx_hash VARCHAR(255),
    tx_hash_outbound VARCHAR(255),
    tx_confirmations INTEGER DEFAULT 0,
    tx_confirmations_required INTEGER DEFAULT 6,
    tx_block_number BIGINT,
    tx_fee_used NUMERIC(32, 16),
    
    -- Priority
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN (
        'low', 'normal', 'high', 'critical'
    )),
    
    -- Withdrawal Type
    withdrawal_type VARCHAR(20) DEFAULT 'external' CHECK (withdrawal_type IN (
        'external', 'internal', 'sub_account', 'fee_refund'
    )),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'pending_approval', 'processing', 'pending_tx', 'broadcast',
        'completed', 'failed', 'rejected', 'cancelled', 'flagged', 'blocked'
    )),
    status_reason VARCHAR(255),
    
    -- Approval (for large withdrawals)
    approved_by UUID REFERENCES users(user_id),
    approved_at TIMESTAMP WITH TIME ZONE,
    approval_note TEXT,
    
    -- OTP Verification
    otp_verified BOOLEAN DEFAULT FALSE,
    otp_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Cancellation
    cancelled_by UUID REFERENCES users(user_id),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason VARCHAR(255),
    
    -- Processing
    processed_by UUID REFERENCES users(user_id),
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Notes
    user_note TEXT,
    admin_notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_currency ON withdrawals(currency);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_to_address ON withdrawals(to_address);
CREATE INDEX idx_withdrawals_created_at ON withdrawals(created_at DESC);

-- =============================================================================
-- KYC & COMPLIANCE
-- =============================================================================

-- KYC Applications
CREATE TABLE kyc_applications (
    application_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    kyc_level SMALLINT NOT NULL,
    
    application_type VARCHAR(20) DEFAULT 'primary' CHECK (application_type IN (
        'primary', 'upgrade', 'reverification', 'appeal'
    )),
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'submitted', 'under_review', 'additional_info',
        'approved', 'rejected', 'expired', 'cancelled'
    )),
    
    rejection_reason VARCHAR(255),
    
    -- Documents
    documents JSONB DEFAULT '[]',
    -- [{type, url, hash, uploaded_at}]
    
    -- Verification Attempt
    verification_attempts INTEGER DEFAULT 0,
    last_verification_at TIMESTAMP WITH TIME ZONE,
    
    -- Third-Party Provider
    provider VARCHAR(50),
    provider_application_id VARCHAR(255),
    provider_result JSONB,
    
    -- Auto-Decision
    auto_approved BOOLEAN DEFAULT FALSE,
    auto_rejected BOOLEAN DEFAULT FALSE,
    auto_decision_reason VARCHAR(255),
    
    -- Manual Review
    reviewed_by UUID REFERENCES users(user_id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    override_reason TEXT,
    
    expires_at TIMESTAMP WITH TIME ZONE,
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_applications_user ON kyc_applications(user_id);
CREATE INDEX idx_kyc_applications_status ON kyc_applications(status);

-- Suspicious Activity Reports
CREATE TABLE suspicious_activity (
    report_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Alert
    alert_type VARCHAR(50) NOT NULL,
    alert_severity VARCHAR(20) DEFAULT 'medium' CHECK (alert_severity IN (
        'low', 'medium', 'high', 'critical'
    )),
    alert_description TEXT,
    alert_details JSONB DEFAULT '{}',
    
    -- Entities
    user_id UUID REFERENCES users(user_id),
    order_id UUID,
    deposit_id UUID,
    withdrawal_id UUID,
    transaction_id UUID,
    
    -- Resolution
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN (
        'open', 'investigating', 'resolved', 'escalated', 'false_positive'
    )),
    resolution VARCHAR(255),
    resolution_notes TEXT,
    
    assigned_to UUID REFERENCES users(user_id),
    resolved_by UUID REFERENCES users(user_id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sar_user_id ON suspicious_activity(user_id);
CREATE INDEX idx_sar_status ON suspicious_activity(status);
CREATE INDEX idx_sar_type ON suspicious_activity(alert_type);

-- Travel Rule (FATF)
CREATE TABLE travel_rules (
    rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Transfer
    transfer_id UUID NOT NULL,
    transfer_type VARCHAR(20) NOT NULL CHECK (transfer_type IN ('deposit', 'withdrawal')),
    
    -- Sender/Recipient info ((required for amounts over threshold)
    sender_name VARCHAR(100),
    sender_account_number VARCHAR(100),
    sender_address TEXT,
    sender_legalatura VARCHAR(255),
    sender_country_code CHAR(2),
    
    recipient_name VARCHAR(100),
    recipient_account_number VARCHAR(100),
    recipient_address TEXT,
    recipient_country_code CHAR(2),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', ' Collected', 'transmitted', 'received', 'failed'
    )),
    
   vasp_id VARCHAR(50),
    chain_completed BOOLEAN DEFAULT FALSE,
    chain_completed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_travel_rules_transfer ON travel_rules(transfer_id);

-- =============================================================================
-- EARN PRODUCTS (Staking, Savings, etc.)
-- =============================================================================

-- Earn Products (Definitions)
CREATE TABLE earn_products (
    product_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    product_name VARCHAR(100) NOT NULL,
    product_type VARCHAR(30) NOT NULL CHECK (product_type IN (
        'staking', 'savings', 'defi', 'launchpool', 'nft_staking'
    )),
    
    asset VARCHAR(20) NOT NULL,
    reward_asset VARCHAR(20),
    
    -- Terms
    duration_days INTEGER,
    duration_hours INTEGER,
    flexible BOOLEAN DEFAULT FALSE,
    lock_period VARCHAR(50),
    
    -- Rewards
    apy_min NUMERIC(10, 6),
    apy_max NUMERIC(10, 6),
    apy_reward_frequency VARCHAR(20) DEFAULT 'daily',
    
    -- Limits
    min_subscrion NUMERIC(32, 16),
    max_subscrion NUMERIC(32, 16),
    total_cap NUMERIC(32, 16),
    user_cap NUMERIC(32, 16),
    
    current_subscription NUMERIC(32, 16) DEFAULT 0,
    participant_count INTEGER DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'paused', 'completed', 'sold_out'
    )),
    
    start_at TIMESTAMP WITH TIME ZONE,
    end_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_earn_products_type ON earn_products(product_type);
CREATE INDEX idx_earn_products_asset ON earn_products(asset);
CREATE INDEX idx_earn_products_status ON earn_products(status);

-- Earn Subscriptions
CREATE TABLE earn_subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    product_id UUID REFERENCES earn_products(product_id) ON DELETE CASCADE,
    
    subscription_type VARCHAR(20) DEFAULT 'flexible' CHECK (subscription_type IN ('flexible', 'locked')),
    
    amount NUMERIC(32, 16) NOT NULL,
    locked_until TIMESTAMP WITH TIME ZONE,
    
    reward_earned NUMERIC(32, 16) DEFAULT 0,
    reward_claimed NUMERIC(32, 16) DEFAULT 0,
    reward_pending NUMERIC(32, 16) DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'unlocking', 'completed', 'early_unstaked'
    )),
    
    claimed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_earn_subs_user ON earn_subscriptions(user_id);
CREATE INDEX idx_earn_subs_product ON earn_subscriptions(product_id);

-- =============================================================================
-- P2P TRADING
-- =============================================================================

-- P2P Orders
CREATE TABLE p2p_orders (
    p2p_order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    
    side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
    fiat_currency CHAR(3) NOT NULL,
    
    -- Price
    price_type VARCHAR(20) NOT NULL CHECK (price_type IN ('fixed', 'floating')),
    price_percentage NUMERIC(10, 4),
    reference_market VARCHAR(20),
    
    amount NUMERIC(32, 16) NOT NULL,
    available_amount NUMERIC(32, 16) GENERATED ALWAYS AS (amount) STORED,
    
    limit_per_order_min NUMERIC(32, 16),
    limit_per_order_max NUMERIC(32, 16),
    
    payment_methods TEXT[],
    remark TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'paused', 'completed', 'canceled', 'suspended'
    )),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_p2p_orders_user ON p2p_orders(user_id);
CREATE INDEX idx_p2p_orders_fiat ON p2p_orders(fiat_currency);
CREATE INDEX idx_p2p_orders_status ON p2p_orders(status);

-- P2P Trades
CREATE TABLE p2p_trades (
    trade_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES p2p_orders(p2p_order_id) ON DELETE SET NULL,
    buyer_id UUID REFERENCES users(user_id),
    seller_id UUID REFERENCES users(user_id),
    
    crypto_amount NUMERIC(32, 16) NOT NULL,
    price_per_unit NUMERIC(32, 16) NOT NULL,
    fiat_amount NUMERIC(32, 16) GENERATED ALWAYS AS (crypto_amount * price_per_unit) STORED,
    
    payment_method VARCHAR(50) NOT NULL,
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'awaiting_payment', 'paid', 'disputed', 'completed', 
        'canceled', 'refunded', 'partially_refunded'
    )),
    
    buyer_confirmed_at TIMESTAMP WITH TIME ZONE,
    seller_confirmed_at TIMESTAMP WITH TIME ZONE,
    
    dispute_reason TEXT,
    dispute_notes TEXT,
    dispute_result VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_p2p_trades_order ON p2p_trades(order_id);
CREATE INDEX idx_p2p_trades_buyer ON p2p_trades(buyer_id);
CREATE INDEX idx_p2p_trades_seller ON p2p_trades(seller_id);

-- =============================================================================
-- NFTS
-- =============================================================================

-- NFT Collections
CREATE TABLE nft_collections (
    collection_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    
    collection_name VARCHAR(100) NOT NULL,
    collection_symbol VARCHAR(20),
    description TEXT,
    
    contract_address VARCHAR(100),
    contract_standard VARCHAR(20) DEFAULT 'ERC-721',
    
    royalty_percentage NUMERIC(10, 4) DEFAULT 0,
    royalty_recipient VARCHAR(100),
    
    blockchain VARCHAR(50),
    network VARCHAR(50),
    
    featured BOOLEAN DEFAULT FALSE,
   Verified BOOLEAN DEFAULT FALSE,
    
    total_supply BIGINT DEFAULT 0,
    holder_count INTEGER DEFAULT 0,
    
    metadata URIJSONB DEFAULT '{}',
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nft_collections_creator ON nft_collections(creator_id);
CREATE INDEX idx_nft_collections_contract ON nft_collections(contract_address);

-- NFTs
CREATE TABLE nfts (
    nft_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID REFERENCES nft_collections(collection_id) ON DELETE CASCADE,
    token_id VARCHAR(100) NOT NULL,
    
    owner_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    
    metadata JSONB DEFAULT '{}',
    token_uri TEXT,
    token_hash VARCHAR(255),
    
    -- Royalty
    royalties NUMERIC(10, 4) DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'listed', 'auction', 'burned', 'transferred'
    )),
    
    listing_price NUMERIC(32, 16),
    listing_expiry TIMESTAMP WITH TIME ZONE,
    
    last_sale_price NUMERIC(32, 16),
    last_sale_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(collection_id, token_id)
);

CREATE INDEX idx_nfts_collection ON nfts(collection_id);
CREATE INDEX idx_nfts_owner ON nfts(owner_id);
CREATE INDEX idx_nfts_token_id ON nfts(collection_id, token_id);

-- NFT Transactions
CREATE TABLE nft_transfers (
    transfer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nft_id UUID REFERENCES nfts(nft_id) ON DELETE SET NULL,
    
    from_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    to_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    
    -- Sale Info
    sale_price NUMERIC(32, 16),
    sale_price_usd NUMERIC(32, 16),
    royalty_paid NUMERIC(32, 16),
    
    -- TX
    transaction_hash VARCHAR(255),
    
    transfer_type VARCHAR(50) DEFAULT 'transfer',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nft_transfers_nft ON nft_transfers(nft_id);
CREATE INDEX idx_nft_transfers_from ON nft_transfers(from_user_id);
CREATE INDEX idx_nft_transfers_to ON nft_transfers(to_user_id);

-- =============================================================================
-- API USAGE & ANALYTICS
-- =============================================================================

-- API Request Logs
CREATE TABLE api_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identifiers
    user_id UUID,
    api_key_id UUID,
    session_id UUID,
    
    -- Request
    method VARCHAR(10) NOT NULL,
    path VARCHAR(255) NOT NULL,
    query_string TEXT,
    request_body_hash VARCHAR(255),
    content_type VARCHAR(50),
    content_length INTEGER,
    
    -- Client
    ip_address INET,
    user_agent TEXT,
    cors_origin VARCHAR(255),
    referer VARCHAR(255),
    
    -- Response
    status_code INTEGER,
    response_bytes BIGINT,
    processing_time_ms INTEGER,
    
    -- Rate Limit
    rate_limit_remaining INTEGER,
    
    -- Errors
    error_code VARCHAR(50),
    error_message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_requests_user ON api_requests(user_id);
CREATE INDEX idx_api_requests_key ON api_requests(api_key_id);
CREATE INDEX idx_api_requests_path ON api_requests(path);
CREATE INDEX idx_api_requests_status ON api_requests(status_code);
CREATE INDEX idx_api_requests_created ON api_requests(created_at DESC);

SELECT create_hypertable('api_requests', 'created_at', 
    chunk_time_interval => INTERVAL '5 minutes');

-- =============================================================================
-- AUDIT LOGS
-- =============================================================================

-- Audit Logs
CREATE TABLE audit_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor
    actor_type VARCHAR(20) NOT NULL, -- user, admin, system, api_key
    actor_id UUID NOT NULL,
    actor_ip INET,
    
    -- Action
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255),
    
    -- Changes
    changes JSONB,
    changes_summary TEXT,
    
    -- Response
    outcome VARCHAR(20) DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
    failure_reason TEXT,
    
    -- Context
    user_agent TEXT,
    request_id VARCHAR(100),
    
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_type, actor_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

SELECT create_hypertable('audit_logs', 'created_at', 
    chunk_time_interval => INTERVAL '1 hour');

-- =============================================================================
-- TRIGGERS & FUNCTIONS
-- =============================================================================

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updates timestamp triggers
ALTER TABLE users ENABLE TRIGGER ALL;
ALTER TABLE wallets ENABLE TRIGGER ALL;
ALTER TABLE balances ENABLE TRIGGER ALL;
ALTER TABLE markets ENABLE TRIGGER ALL;
ALTER TABLE orders ENABLE TRIGGER ALL;
ALTER TABLE deposits ENABLE TRIGGER ALL;
ALTER TABLE withdrawals ENABLE TRIGGER ALL;
ALTER TABLE kyc_applications ENABLE TRIGGER ALL;
ALTER TABLE earn_subscriptions ENABLE TRIGGER ALL;

CREATE TRIGGER update_users_timestamp 
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_wallets_timestamp 
    BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_balances_timestamp 
    BEFORE UPDATE ON balances FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_markets_timestamp 
    BEFORE UPDATE ON markets FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_orders_timestamp 
    BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_deposits_timestamp 
    BEFORE UPDATE ON deposits FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_withdrawals_timestamp 
    BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_kyc_timestamp 
    BEFORE UPDATE ON kyc_applications FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_earn_timestamp 
    BEFORE UPDATE ON earn_subscriptions FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- =============================================================================
-- SEEDS & CONFIGURATION
-- =============================================================================

-- Insert default markets
INSERT INTO markets (market_symbol, base_currency, quote_currency, market_type, status) VALUES
-- Spot Markets
('BTC/USDT', 'BTC', 'USDT', 'spot', 'active'),
('ETH/USDT', 'ETH', 'USDT', 'spot', 'active'),
('BNB/USDT', 'BNB', 'USDT', 'spot', 'active'),
('SOL/USDT', 'SOL', 'USDT', 'spot', 'active'),
('XRP/USDT', 'XRP', 'USDT', 'spot', 'active'),
('ADA/USDT', 'ADA', 'USDT', 'spot', 'active'),
('DOGE/USDT', 'DOGE', 'USDT', 'spot', 'active'),
('AVAX/USDT', 'AVAX', 'USDT', 'spot', 'active'),
('DOT/USDT', 'DOT', 'USDT', 'spot', 'active'),
('MATIC/USDT', 'MATIC', 'USDT', 'spot', 'active'),
('LINK/USDT', 'LINK', 'USDT', 'spot', 'active'),
('UNI/USDT', 'UNI', 'USDT', 'spot', 'active'),
('ATOM/USDT', 'ATOM', 'USDT', 'spot', 'active'),
('LTC/USDT', 'LTC', 'USDT', 'spot', 'active'),
('BCH/USDT', 'BCH', 'USDT', 'spot', 'active'),
-- Cross Pairs
('ETH/BTC', 'ETH', 'BTC', 'spot', 'active'),
('BNB/ETH', 'BNB', 'ETH', 'spot', 'active');

-- Insert admin roles
INSERT INTO audit_logs (actor_type, actor_id, action, resource_type, outcome)
VALUES ('system', '00000000-0000-0000-0000-000000000000', 'init', 'database', 'success');

-- Create indexes for full text search (optional)
-- COMMENT ON INDEX idx_users_search IS 'For user search: email, username, name';

DO $$
BEGIN
    RAISE NOTICE 'TigerEx Database Schema v3.0 completed successfully';
END $$;